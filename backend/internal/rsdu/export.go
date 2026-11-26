package rsdu

import (
	"cmp"
	"context"
	"database/sql"
	"fmt"
	"maps"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/PVKonovalov/slddoc"

	"sld-editor/internal/binding"
)

// exportTimeout is a watchdog: an export transaction still running after it is rolled back with an error.
const exportTimeout = 2 * time.Minute

// maxText is the length of VS_FORM.NAME, ALIAS, FILE_NAME and VS_COMP.NAME on both databases.
const maxText = 255

const (
	seqForm = "VS_FORM_S"
	seqComp = "VS_COMP_S"
	// batchRows is how many rows one INSERT or DELETE statement carries.
	batchRows = 100
)

var (
	compColumns = []string{"ID", "ID_FORM", "ID_TCTRL", "NAME", "FEATURE", "PRECISION", "TAG"}
	tuneColumns = []string{"ID_OWNLST", "ID_REGIM", "ID_TABLE", "ID_PARAM", "ID_GTOPT", "SCALE"}
)

type tune struct{ regim, table, param, option, scale int64 }

type component struct {
	name           string
	tctrl, feature int64
	precision      int64
	tunes          []tune
	statuses       []slddoc.BindingStatus // of tunes, by index
	edited         bool                   // the item's ComponentEdited
}

// gone is a binding the provider has that the export deletes: regime and table of component name.
type gone struct {
	name         string
	regim, table int64
}

// plan is what the scheme should hold, worked out before the transaction.
type plan struct {
	form    binding.Scheme // Ref empty when registering
	orig    binding.Scheme // the form as RSDU has it
	preview bool           // only count what would be written
	deleted []gone
	// objectNew and objectGone: the diagram's object is new, its former one is to go.
	objectNew, objectGone bool
	group                 int64
	fileName              string
	object                *tune
	comps                 []component
	bindings              int
	skipped               []binding.ExportIssue
}

// Export writes the bindings of the diagram name, d, to its linked VS_FORM row, or registers a new one when req
// asks (or the diagram has none), in one transaction: of the form's VS_OBJ_TUNE, VS_COMP and VS_REGIM_TUNE rows
// only those d's statuses name (see flagged), and the form row when anything changed. Items and bindings the check or the dictionaries can't place are skipped and
// listed. No other VS_FORM row is written.
func (p *Provider) Export(ctx context.Context, name string, d *slddoc.Diagram, req binding.ExportRequest) (*binding.ExportResult, error) {
	begin, ok := p.read.(Beginner)
	if !ok {
		return nil, fmt.Errorf("%w: the connection can't write", binding.ErrNotImplemented)
	}
	ctx, cancel := context.WithTimeout(ctx, exportTimeout)
	defer cancel()
	var res *binding.ExportResult
	err := func() error {
		pl, check, err := p.prepare(ctx, name, d, req)
		if err != nil {
			return err
		}
		tx, err := begin.Begin(ctx)
		if err != nil {
			return err
		}
		pl.preview = req.Preview
		if res, err = p.exportTx(ctx, tx, pl, check); err != nil {
			_ = tx.Rollback()
			return err
		}
		if req.Preview {
			return tx.Rollback()
		}
		if err := tx.Commit(); err != nil {
			return fmt.Errorf("rsdu: commit: %w", err)
		}
		return nil
	}()
	return res, err
}

// prepare checks the export and plans what it writes; ErrExportRefused when the check fails.
func (p *Provider) prepare(ctx context.Context, name string, d *slddoc.Diagram, req binding.ExportRequest) (*plan, *slddoc.SchemeRef, error) {
	var linked *slddoc.SchemeRef
	if d.Scheme != nil && d.Scheme.Source == p.Name() && !req.Register {
		linked = d.Scheme
	}
	check, err := p.CheckExport(ctx, name, d, linked)
	if err != nil {
		return nil, nil, err
	}
	if !check.OK {
		return nil, nil, &binding.ErrExportRefused{Check: check}
	}
	pl, err := p.plan(ctx, d, req, check)
	return pl, linked, err
}

// exportTx writes pl in tx, left open, and returns what it wrote; linked is the scheme exported to (nil: registered).
func (p *Provider) exportTx(ctx context.Context, tx Tx, pl *plan, linked *slddoc.SchemeRef) (*binding.ExportResult, error) {
	at := time.Now().UTC().Truncate(time.Second)
	id, changes, err := p.write(ctx, tx, pl, at)
	if err != nil {
		return nil, err
	}
	registered := pl.form.Ref == ""
	ref := slddoc.SchemeRef{Source: p.Name(), Ref: strconv.FormatInt(id, 10), Exported: &at,
		Registered: registered || (linked != nil && linked.Registered)}
	skipped := pl.skipped
	if skipped == nil {
		skipped = []binding.ExportIssue{}
	}
	return &binding.ExportResult{Scheme: ref, Registered: registered, Preview: pl.preview, Components: len(pl.comps),
		Bindings: pl.bindings, Changes: changes, Skipped: skipped}, nil
}

// plan resolves everything the export writes: the form's values, a component per bound item with a component type,
// a VS_REGIM_TUNE row per binding of the provider whose ref, kind and option RSDU knows, and the diagram's object.
func (p *Provider) plan(ctx context.Context, d *slddoc.Diagram, req binding.ExportRequest, check *binding.ExportCheck) (*plan, error) {
	pl := &plan{fileName: check.FileName}
	if check.Scheme != nil {
		pl.form, pl.orig = *check.Scheme, *check.Scheme
	}
	formName := firstNonEmpty(strings.TrimSpace(req.Name), pl.form.Name)
	if formName == "" {
		return nil, fmt.Errorf("%w: the scheme needs a name", binding.ErrInvalid)
	}
	pl.form.Name = formName
	pl.form.Alias = firstNonEmpty(strings.TrimSpace(req.Alias), pl.form.Alias, formName)
	group := firstNonEmpty(strings.TrimSpace(req.Group), pl.form.Group)
	if group == "" {
		return nil, fmt.Errorf("%w: the scheme needs a group", binding.ErrInvalid)
	}
	var err error
	if pl.group, err = parseID("scheme group", group); err != nil {
		return nil, err
	}
	for what, v := range map[string]string{"scheme name": pl.form.Name, "scheme alias": pl.form.Alias, "file name": pl.fileName} {
		if utf8.RuneCountInString(v) > maxText {
			return nil, fmt.Errorf("%w: the %s is longer than %d characters", binding.ErrInvalid, what, maxText)
		}
	}

	dict, err := p.dictionaries(ctx)
	if err != nil {
		return nil, err
	}
	tcomp, err := p.componentTypes(ctx, p.cfg.SchemeType)
	if err != nil {
		return nil, err
	}
	masks := map[string]int64{}
	for _, f := range dict.public.Features {
		masks[f.Alias] = f.Mask
	}

	skip := func(code, kind string, item int, shape, detail string) {
		pl.skipped = append(pl.skipped, binding.ExportIssue{Code: code, Severity: binding.SeverityWarning, Item: item, Kind: kind, Shape: shape, Detail: detail})
	}
	for _, i := range check.Issues {
		if i.Code == binding.IssueNoComponentType || i.Code == binding.IssueOtherSource || i.Code == binding.IssueBadComponentType {
			pl.skipped = append(pl.skipped, i)
		}
	}
	item := func(kind string, id int, shape, stored string, precision int, features string, edited bool, bs []slddoc.Binding) {
		tctrl, ok, _ := tcomp.of(shape, stored)
		if !ok || id <= 0 {
			return
		}
		c := component{name: strconv.Itoa(id), tctrl: tctrl, precision: int64(precision), edited: edited}
		for f := range strings.SplitSeq(features, ",") {
			c.feature |= masks[strings.TrimSpace(f)]
		}
		seen := map[[2]int64]bool{}
		for _, b := range bs {
			if b.Source != p.Name() {
				continue
			}
			table, param, err := parseRef(b.Ref)
			if err != nil {
				skip(binding.IssueBadRef, kind, id, shape, b.Ref)
				continue
			}
			regim, ok := dict.regimID[b.Kind]
			if !ok {
				skip(binding.IssueUnknownKind, kind, id, shape, string(b.Kind))
				continue
			}
			opt := b.Option
			if b.Kind == slddoc.BindingJump || opt == "" {
				opt = kindOptions[b.Kind]
			}
			option, ok := dict.optionID[opt]
			if !ok {
				skip(binding.IssueUnknownOption, kind, id, shape, opt)
				continue
			}
			if key := [2]int64{regim, table}; seen[key] {
				skip(binding.IssueDuplicate, kind, id, shape, string(b.Kind))
				continue
			} else {
				seen[key] = true
			}
			scale := int64(b.Scale)
			if scale == 0 {
				scale = 1
			}
			c.tunes = append(c.tunes, tune{regim: regim, table: table, param: param, option: option, scale: scale})
			c.statuses = append(c.statuses, b.Status)
		}
		if len(c.tunes) == 0 {
			return
		}
		pl.comps = append(pl.comps, c)
		pl.bindings += len(c.tunes)
	}
	for _, e := range d.Elements {
		item("element", e.ID, e.Shape, e.ComponentType, e.Precision, e.Features, e.ComponentEdited, e.Bindings)
	}
	for _, dd := range d.DigitalDevices {
		item("device", dd.ID, deviceShape, dd.ComponentType, dd.Precision, dd.Features, dd.ComponentEdited, dd.Bindings)
	}
	for _, b := range d.BarInstruments {
		item("bar", b.ID, slddoc.BarInstrumentShape, b.ComponentType, b.Precision, b.Features, b.ComponentEdited, b.Bindings)
	}
	for _, l := range d.Labels {
		item("label", l.ID, labelShape, l.ComponentType, l.Precision, l.Features, l.ComponentEdited, l.Bindings)
	}
	for _, w := range d.Connectors {
		item("wire", w.ID, wireShape+string(w.Kind), w.ComponentType, w.Precision, w.Features, w.ComponentEdited, w.Bindings)
	}
	if o := d.Object; o != nil && o.Source == p.Name() {
		if table, param, err := parseRef(o.Ref); err == nil {
			pl.object = &tune{table: table, param: param}
			pl.objectNew = o.Status == slddoc.BindingNew
		} else {
			skip(binding.IssueBadRef, "", 0, "", o.Ref)
		}
	}
	for _, del := range d.DeletedBindings {
		if del.Source != p.Name() {
			continue
		}
		if del.Item == 0 {
			pl.objectGone = true
			continue
		}
		table, _, err := parseRef(del.Ref)
		regim, ok := dict.regimID[del.Kind]
		if err != nil || !ok {
			continue
		}
		pl.deleted = append(pl.deleted, gone{name: strconv.Itoa(del.Item), regim: regim, table: table})
	}
	return pl, nil
}

func firstNonEmpty(vs ...string) string {
	for _, v := range vs {
		if v != "" {
			return v
		}
	}
	return ""
}

// nextVals takes n values of the sequence seq.
func (p *Provider) nextVals(ctx context.Context, tx Tx, seq string, n int) ([]int64, error) {
	ids := make([]int64, 0, n)
	err := each(ctx, tx, p.d.NextVals(seq, n), func(r Rows) error {
		var id int64
		if err := r.Scan(&id); err != nil {
			return err
		}
		ids = append(ids, id)
		return nil
	})
	if err == nil && len(ids) != n {
		err = fmt.Errorf("rsdu: %s gave %d values, want %d", seq, len(ids), n)
	}
	return ids, err
}

// dbComp is a VS_COMP row of the form with its VS_REGIM_TUNE rows by regime and table.
type dbComp struct {
	id                        int64
	tctrl, feature, precision int64
	tunes                     map[[2]int64][]tune
}

// changes are the rows an export deletes, updates and inserts.
type changes struct {
	delComps []int64
	delTunes [][3]int64 // component, regime, table
	updComps []dbComp
	updTunes []ownedTune
	newComps []component
	newTunes []ownedTune
	obj      objChange
	rows     binding.ExportChanges // the rows these change
}

type ownedTune struct {
	comp int64
	t    tune
}

type objChange int

const (
	objKeep objChange = iota
	objInsert
	objUpdate
	objDelete
	objReplace
)

func (c *changes) empty() bool {
	return len(c.delComps)+len(c.delTunes)+len(c.updComps)+len(c.updTunes)+len(c.newComps)+len(c.newTunes) == 0 && c.obj == objKeep
}

// write runs pl in tx at time at and returns the form's id and the rows changed. A registered form gets everything
// inserted; a linked one gets only what pl's statuses name (see flagged). The form row itself is written when
// registering, when its fields differ or when anything else changed. A preview only counts.
func (p *Provider) write(ctx context.Context, tx Tx, pl *plan, at time.Time) (int64, binding.ExportChanges, error) {
	exec := func(q string, args ...any) (int64, error) { return tx.Exec(ctx, p.d.SQL(q), args...) }
	var n binding.ExportChanges
	dtyp := int64(p.cfg.SchemeType)
	if pl.form.Ref == "" {
		if pl.preview {
			n.Inserted = 1 + len(pl.comps) + pl.bindings
			if pl.object != nil {
				n.Inserted++
			}
			return 0, n, nil
		}
		ids, err := p.nextVals(ctx, tx, seqForm, 1)
		if err != nil {
			return 0, n, err
		}
		id := ids[0]
		if _, err := exec(sqlInsertForm, id, pl.group, dtyp, pl.form.Name, pl.form.Alias, pl.fileName, at.Unix()); err != nil {
			return 0, n, err
		}
		n.Inserted++
		ch := &changes{newComps: pl.comps}
		if pl.object != nil {
			ch.obj = objInsert
		}
		return id, n, p.apply(ctx, tx, id, pl, ch, &n)
	}
	id, err := parseID("scheme id", pl.form.Ref)
	if err != nil {
		return 0, n, err
	}
	ch, err := p.flagged(ctx, tx, id, pl)
	if err != nil {
		return 0, n, err
	}
	o := pl.orig
	if ch.empty() && o.Name == pl.form.Name && o.Alias == pl.form.Alias && o.FileName == pl.fileName &&
		o.Group == strconv.FormatInt(pl.group, 10) && o.TypeID == strconv.FormatInt(dtyp, 10) {
		return id, ch.rows, nil
	}
	if pl.preview {
		ch.rows.Updated++
		return id, ch.rows, nil
	}
	k, err := exec(sqlUpdateForm, pl.group, dtyp, pl.form.Name, pl.form.Alias, pl.fileName, at.Unix(), id)
	if err != nil {
		return 0, n, err
	}
	if k != 1 {
		return 0, n, fmt.Errorf("%w: scheme %d", binding.ErrNotFound, id)
	}
	n.Updated++
	return id, n, p.apply(ctx, tx, id, pl, ch, &n)
}

// flagged reads the rows of form id's components that pl's statuses name and returns what the statuses change, only
// that: a deleted binding's row is deleted (its component too when nothing is left of it), an edited one's updated, a
// new one inserted (updated when the row is there), an edited component updated; a new item's component is inserted
// with its new bindings. Rows without a status are never touched.
func (p *Provider) flagged(ctx context.Context, tx Tx, id int64, pl *plan) (*changes, error) {
	ch := &changes{}
	dels := map[string]map[[2]int64]bool{}
	for _, g := range pl.deleted {
		if dels[g.name] == nil {
			dels[g.name] = map[[2]int64]bool{}
		}
		dels[g.name][[2]int64{g.regim, g.table}] = true
	}
	want := map[string]*component{}
	for i := range pl.comps {
		c := &pl.comps[i]
		if c.edited || slices.ContainsFunc(c.statuses, func(s slddoc.BindingStatus) bool { return s != "" }) {
			want[c.name] = c
		}
	}
	names := slices.Sorted(maps.Keys(dels))
	for name := range want {
		if dels[name] == nil {
			names = append(names, name)
		}
	}
	slices.Sort(names)
	if len(names) > 0 {
		have, err := p.readComps(ctx, tx, id, names)
		if err != nil {
			return nil, err
		}
		for _, name := range names {
			flagComp(ch, want[name], dels[name], have[name])
		}
	}
	if pl.objectGone || pl.objectNew {
		var rows int
		err := each(ctx, tx, p.d.SQL(sqlReadObj), func(r Rows) error {
			var table, param sql.NullInt64
			rows++
			return r.Scan(&table, &param)
		}, id)
		if err != nil {
			return nil, err
		}
		switch {
		case pl.objectNew && rows == 0:
			ch.obj = objInsert
			ch.rows.Inserted++
		case pl.objectNew && rows == 1 && !pl.objectGone:
			ch.obj = objUpdate
			ch.rows.Updated++
		case pl.objectNew:
			ch.obj = objReplace
			ch.rows.Deleted += rows
			ch.rows.Inserted++
		case rows > 0:
			ch.obj = objDelete
			ch.rows.Deleted += rows
		}
	}
	return ch, nil
}

// flagComp adds to ch what the statuses of one item change: want its component (nil: none, or no status), dels the
// regime and table of its deleted bindings, rows its components in RSDU by id (only the first is written to).
func flagComp(ch *changes, want *component, dels map[[2]int64]bool, rows []*dbComp) {
	var flagged []tune
	if want != nil {
		for i, t := range want.tunes {
			if want.statuses[i] != "" {
				flagged = append(flagged, t)
			}
		}
	}
	if len(rows) == 0 {
		if len(flagged) > 0 {
			c := *want
			c.tunes = flagged
			ch.newComps = append(ch.newComps, c)
			ch.rows.Inserted += 1 + len(flagged)
		}
		return
	}
	r := rows[0]
	left := map[[2]int64]bool{}
	for key := range r.tunes {
		if !dels[key] {
			left[key] = true
		}
	}
	for _, t := range flagged {
		left[[2]int64{t.regim, t.table}] = true
	}
	if len(left) == 0 {
		ch.delComps = append(ch.delComps, r.id)
		ch.rows.Deleted++
		for _, ts := range r.tunes {
			ch.rows.Deleted += len(ts)
		}
		return
	}
	for _, key := range slices.SortedFunc(maps.Keys(dels), func(a, b [2]int64) int { return cmp.Or(cmp.Compare(a[0], b[0]), cmp.Compare(a[1], b[1])) }) {
		if ex := r.tunes[key]; len(ex) > 0 {
			ch.delTunes = append(ch.delTunes, [3]int64{r.id, key[0], key[1]})
			ch.rows.Deleted += len(ex)
		}
	}
	if want != nil && want.edited && (r.tctrl != want.tctrl || r.feature != want.feature || r.precision != want.precision) {
		ch.updComps = append(ch.updComps, dbComp{id: r.id, tctrl: want.tctrl, feature: want.feature, precision: want.precision})
		ch.rows.Updated++
	}
	for _, t := range flagged {
		key := [2]int64{t.regim, t.table}
		switch ex := r.tunes[key]; {
		case len(ex) == 0 || dels[key]:
			ch.newTunes = append(ch.newTunes, ownedTune{r.id, t})
			ch.rows.Inserted++
		case len(ex) > 1:
			ch.delTunes = append(ch.delTunes, [3]int64{r.id, key[0], key[1]})
			ch.newTunes = append(ch.newTunes, ownedTune{r.id, t})
			ch.rows.Deleted += len(ex)
			ch.rows.Inserted++
		case ex[0] != t:
			ch.updTunes = append(ch.updTunes, ownedTune{r.id, t})
			ch.rows.Updated++
		}
	}
}

// readComps reads the components of form id named names (VS_COMP.NAME, the item id) with their tunes, by name and id.
func (p *Provider) readComps(ctx context.Context, tx Tx, id int64, names []string) (map[string][]*dbComp, error) {
	have := map[string][]*dbComp{}
	byID := map[int64]*dbComp{}
	for chunk := range slices.Chunk(names, 500) {
		args := []any{id}
		for _, name := range chunk {
			args = append(args, name)
		}
		in := placeholders(len(chunk), 1)
		err := each(ctx, tx, p.d.SQL(fmt.Sprintf(sqlReadCompsByName, in)), func(r Rows) error {
			var c dbComp
			var name sql.NullString
			var tctrl, feature, precision sql.NullInt64
			if err := r.Scan(&c.id, &name, &tctrl, &feature, &precision); err != nil {
				return err
			}
			c.tctrl, c.feature, c.precision, c.tunes = tctrl.Int64, feature.Int64, precision.Int64, map[[2]int64][]tune{}
			have[name.String] = append(have[name.String], &c)
			byID[c.id] = &c
			return nil
		}, args...)
		if err != nil {
			return nil, err
		}
		err = each(ctx, tx, p.d.SQL(fmt.Sprintf(sqlReadTunesByName, in)), func(r Rows) error {
			var owner int64
			var regim, table, param, option, scale sql.NullInt64
			if err := r.Scan(&owner, &regim, &table, &param, &option, &scale); err != nil {
				return err
			}
			t := tune{regim: regim.Int64, table: table.Int64, param: param.Int64, option: option.Int64, scale: scale.Int64}
			if !scale.Valid || t.scale == 0 {
				t.scale = 1
			}
			if c := byID[owner]; c != nil {
				key := [2]int64{t.regim, t.table}
				c.tunes[key] = append(c.tunes[key], t)
			}
			return nil
		}, args...)
		if err != nil {
			return nil, err
		}
	}
	for _, rows := range have {
		slices.SortFunc(rows, func(a, b *dbComp) int { return cmp.Compare(a.id, b.id) })
	}
	return have, nil
}

// placeholders is "(?, ?, …)" of n groups of size parameters each, e.g. "((?, ?), (?, ?))" for n 2 and size 2.
func placeholders(n, size int) string {
	one := "?"
	if size > 1 {
		one = "(" + strings.TrimSuffix(strings.Repeat("?, ", size), ", ") + ")"
	}
	return "(" + strings.TrimSuffix(strings.Repeat(one+", ", n), ", ") + ")"
}

// apply writes ch to form id, deletes first, counting the rows in n.
func (p *Provider) apply(ctx context.Context, tx Tx, id int64, pl *plan, ch *changes, n *binding.ExportChanges) error {
	exec := func(q string, args ...any) (int64, error) { return tx.Exec(ctx, p.d.SQL(q), args...) }
	for chunk := range slices.Chunk(ch.delComps, batchRows) {
		args := make([]any, len(chunk))
		for i, c := range chunk {
			args[i] = c
		}
		k, err := exec(fmt.Sprintf(sqlDeleteOwned, placeholders(len(chunk), 1)), args...)
		if err != nil {
			return err
		}
		n.Deleted += int(k)
		if k, err = exec(fmt.Sprintf(sqlDeleteCompID, placeholders(len(chunk), 1)), args...); err != nil {
			return err
		}
		n.Deleted += int(k)
	}
	for chunk := range slices.Chunk(ch.delTunes, batchRows) {
		var args []any
		for _, t := range chunk {
			args = append(args, t[0], t[1], t[2])
		}
		k, err := exec(fmt.Sprintf(sqlDeleteTune, placeholders(len(chunk), 3)), args...)
		if err != nil {
			return err
		}
		n.Deleted += int(k)
	}
	switch ch.obj {
	case objDelete, objReplace:
		k, err := exec(sqlDeleteObj, id)
		if err != nil {
			return err
		}
		n.Deleted += int(k)
	case objUpdate:
		if _, err := exec(sqlUpdateObj, pl.object.table, pl.object.param, id); err != nil {
			return err
		}
		n.Updated++
	}
	if ch.obj == objInsert || ch.obj == objReplace {
		if _, err := exec(sqlInsertObj, id, pl.object.table, pl.object.param); err != nil {
			return err
		}
		n.Inserted++
	}
	for _, c := range ch.updComps {
		if _, err := exec(sqlUpdateComp, c.tctrl, c.feature, c.precision, c.id); err != nil {
			return err
		}
		n.Updated++
	}
	for _, t := range ch.updTunes {
		if _, err := exec(sqlUpdateTune, t.t.param, t.t.option, t.t.scale, t.comp, t.t.regim, t.t.table); err != nil {
			return err
		}
		n.Updated++
	}
	tunes := ch.newTunes
	if len(ch.newComps) > 0 {
		compIDs, err := p.nextVals(ctx, tx, seqComp, len(ch.newComps))
		if err != nil {
			return err
		}
		var rows [][]any
		for i, c := range ch.newComps {
			rows = append(rows, []any{compIDs[i], id, c.tctrl, c.name, c.feature, c.precision, nil})
			for _, t := range c.tunes {
				tunes = append(tunes, ownedTune{compIDs[i], t})
			}
		}
		if err := p.insertRows(ctx, tx, "VS_COMP", compColumns, rows, n); err != nil {
			return err
		}
	}
	var rows [][]any
	for _, t := range tunes {
		rows = append(rows, []any{t.comp, t.t.regim, t.t.table, t.t.param, t.t.option, t.t.scale})
	}
	return p.insertRows(ctx, tx, "VS_REGIM_TUNE", tuneColumns, rows, n)
}

// insertRows inserts rows into the schema's table, batchRows per statement.
func (p *Provider) insertRows(ctx context.Context, tx Tx, table string, cols []string, rows [][]any, n *binding.ExportChanges) error {
	for chunk := range slices.Chunk(rows, batchRows) {
		var args []any
		for _, r := range chunk {
			args = append(args, r...)
		}
		if _, err := tx.Exec(ctx, p.d.SQL(p.d.InsertRows(table, cols, len(chunk))), args...); err != nil {
			return err
		}
		n.Inserted += len(chunk)
	}
	return nil
}
