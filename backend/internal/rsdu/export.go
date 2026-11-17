package rsdu

import (
	"context"
	"fmt"
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
	sqlInsertForm  = "INSERT INTO {s}.VS_FORM (ID, ID_NODE, ID_TYPE, NAME, ALIAS, FILE_NAME, LAST_UPDATE) VALUES (?, ?, ?, ?, ?, ?, ?)"
	sqlUpdateForm  = "UPDATE {s}.VS_FORM SET ID_NODE = ?, ID_TYPE = ?, NAME = ?, ALIAS = ?, FILE_NAME = ?, LAST_UPDATE = ? WHERE ID = ?"
	sqlDeleteObj   = "DELETE FROM {s}.VS_OBJ_TUNE WHERE ID_FORM = ?"
	sqlDeleteTunes = "DELETE FROM {s}.VS_REGIM_TUNE WHERE ID_OWNLST IN (SELECT ID FROM {s}.VS_COMP WHERE ID_FORM = ?)"
	sqlDeleteComps = "DELETE FROM {s}.VS_COMP WHERE ID_FORM = ?"
	sqlInsertObj   = "INSERT INTO {s}.VS_OBJ_TUNE (ID_FORM, ID_TABLE, ID_PARAM) VALUES (?, ?, ?)"
	sqlInsertComp  = "INSERT INTO {s}.VS_COMP (ID, ID_FORM, ID_TCTRL, NAME, FEATURE, PRECISION, TAG) VALUES (?, ?, ?, ?, ?, ?, ?)"
	sqlInsertTune  = "INSERT INTO {s}.VS_REGIM_TUNE (ID_OWNLST, ID_REGIM, ID_TABLE, ID_PARAM, ID_GTOPT, SCALE) VALUES (?, ?, ?, ?, ?, ?)"
	seqForm        = "VS_FORM_S"
	seqComp        = "VS_COMP_S"
)

type tune struct{ regim, table, param, option, scale int64 }

type component struct {
	name           string
	tctrl, feature int64
	precision      int64
	tunes          []tune
}

// plan is everything an export writes, worked out before the transaction.
type plan struct {
	form     binding.Scheme // ID empty when registering
	group    int64
	fileName string
	object   *tune
	comps    []component
	bindings int
	skipped  []binding.ExportIssue
}

// Export writes the bindings of the diagram name, d, to its linked VS_FORM row, or registers a new one when req
// asks (or the diagram has none), in one transaction: the form row, then VS_OBJ_TUNE, VS_REGIM_TUNE and VS_COMP of
// the form deleted and inserted again (as RSDU's scheme editor saves). Items and bindings the check or the
// dictionaries can't place are skipped and listed. No other VS_FORM row is written.
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
		if res, err = p.exportTx(ctx, tx, pl, check); err != nil {
			_ = tx.Rollback()
			return err
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
	id, err := p.write(ctx, tx, pl, at)
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
	return &binding.ExportResult{Scheme: ref, Registered: registered, Components: len(pl.comps), Bindings: pl.bindings, Skipped: skipped}, nil
}

// plan resolves everything the export writes: the form's values, a component per bound item with a component type,
// a VS_REGIM_TUNE row per binding of the provider whose ref, kind and option RSDU knows, and the diagram's object.
func (p *Provider) plan(ctx context.Context, d *slddoc.Diagram, req binding.ExportRequest, check *binding.ExportCheck) (*plan, error) {
	pl := &plan{fileName: check.FileName}
	if check.Scheme != nil {
		pl.form = *check.Scheme
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
	item := func(kind string, id int, shape, stored string, precision int, features string, bs []slddoc.Binding) {
		tctrl, ok, _ := tcomp.of(shape, stored)
		if !ok || id <= 0 {
			return
		}
		c := component{name: strconv.Itoa(id), tctrl: tctrl, precision: int64(precision)}
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
		}
		if len(c.tunes) == 0 {
			return
		}
		pl.comps = append(pl.comps, c)
		pl.bindings += len(c.tunes)
	}
	for _, e := range d.Elements {
		item("element", e.ID, e.Shape, e.ComponentType, e.Precision, e.Features, e.Bindings)
	}
	for _, dd := range d.DigitalDevices {
		item("device", dd.ID, deviceShape, dd.ComponentType, dd.Precision, dd.Features, dd.Bindings)
	}
	for _, l := range d.Labels {
		item("label", l.ID, labelShape, l.ComponentType, l.Precision, l.Features, l.Bindings)
	}
	for _, w := range d.Connectors {
		item("wire", w.ID, wireShape+string(w.Kind), w.ComponentType, w.Precision, w.Features, w.Bindings)
	}
	if o := d.Object; o != nil && o.Source == p.Name() {
		if table, param, err := parseRef(o.Ref); err == nil {
			pl.object = &tune{table: table, param: param}
		} else {
			skip(binding.IssueBadRef, "", 0, "", o.Ref)
		}
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

// write runs pl in tx at time at and returns the form's id.
func (p *Provider) write(ctx context.Context, tx Tx, pl *plan, at time.Time) (int64, error) {
	exec := func(q string, args ...any) (int64, error) { return tx.Exec(ctx, p.d.SQL(q), args...) }
	dtyp := int64(p.cfg.SchemeType)
	var id int64
	if pl.form.Ref == "" {
		ids, err := p.nextVals(ctx, tx, seqForm, 1)
		if err != nil {
			return 0, err
		}
		id = ids[0]
		if _, err := exec(sqlInsertForm, id, pl.group, dtyp, pl.form.Name, pl.form.Alias, pl.fileName, at.Unix()); err != nil {
			return 0, err
		}
	} else {
		var err error
		if id, err = parseID("scheme id", pl.form.Ref); err != nil {
			return 0, err
		}
		n, err := exec(sqlUpdateForm, pl.group, dtyp, pl.form.Name, pl.form.Alias, pl.fileName, at.Unix(), id)
		if err != nil {
			return 0, err
		}
		if n != 1 {
			return 0, fmt.Errorf("%w: scheme %d", binding.ErrNotFound, id)
		}
		for _, q := range []string{sqlDeleteObj, sqlDeleteTunes, sqlDeleteComps} {
			if _, err := exec(q, id); err != nil {
				return 0, err
			}
		}
	}
	if pl.object != nil {
		if _, err := exec(sqlInsertObj, id, pl.object.table, pl.object.param); err != nil {
			return 0, err
		}
	}
	if len(pl.comps) == 0 {
		return id, nil
	}
	compIDs, err := p.nextVals(ctx, tx, seqComp, len(pl.comps))
	if err != nil {
		return 0, err
	}
	for i, c := range pl.comps {
		if _, err := exec(sqlInsertComp, compIDs[i], id, c.tctrl, c.name, c.feature, c.precision, nil); err != nil {
			return 0, err
		}
		for _, t := range c.tunes {
			if _, err := exec(sqlInsertTune, compIDs[i], t.regim, t.table, t.param, t.option, t.scale); err != nil {
				return 0, err
			}
		}
	}
	return id, nil
}
