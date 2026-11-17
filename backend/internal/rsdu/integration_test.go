package rsdu

import (
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"os"
	"reflect"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/PVKonovalov/slddoc"

	"sld-editor/internal/binding"
	"sld-editor/internal/config"
)

// testDSNs are the integration databases: env var → driver. A DSN is a URL,
// oracle://user:password@host:port/service?sid=SID&schema=rsduadmin or postgres://user:password@host:port/db.
var testDSNs = []struct{ env, driver string }{
	{"RSDU_TEST_ORACLE", config.DriverOracle},
	{"RSDU_TEST_POSTGRES", config.DriverPostgres},
}

// integrationProvider returns the provider of env's DSN; it skips the test when env is unset.
func integrationProvider(t *testing.T, env, driver string) *Provider {
	t.Helper()
	raw := os.Getenv(env)
	if raw == "" {
		t.Skipf("%s is not set", env)
	}
	u, err := url.Parse(raw)
	if err != nil {
		t.Fatalf("%s: %v", env, err)
	}
	port, _ := strconv.Atoi(u.Port())
	pw, _ := u.User.Password()
	var cfg config.Bindings
	cfg.Provider = config.ProviderRSDU
	cfg.RSDU.Driver = driver
	cfg.RSDU.Schema = u.Query().Get("schema")
	cfg.RSDU.Read = config.DSN{
		Host: u.Hostname(), Port: port, User: u.User.Username(), Password: pw,
		Database: u.Path[min(1, len(u.Path)):], Sid: u.Query().Get("sid"),
	}
	c := &config.Config{Bindings: cfg}
	if err := c.ValidateBindings(); err != nil {
		t.Fatalf("%s: %v", env, err)
	}
	p, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { p.(*Provider).read.(*conn).Close() })
	return p.(*Provider)
}

func TestIntegrationDictionaries(t *testing.T) {
	got := map[string]*binding.Dictionaries{}
	for _, db := range testDSNs {
		t.Run(db.driver, func(t *testing.T) {
			p := integrationProvider(t, db.env, db.driver)
			ctx := context.Background()
			d, err := p.Dictionaries(ctx)
			if err != nil {
				t.Fatal(err)
			}
			var kinds []slddoc.BindingKind
			for _, k := range d.Kinds {
				kinds = append(kinds, k.Kind)
			}
			if !slices.Equal(kinds, kindOrder) {
				t.Errorf("kinds = %v", kinds)
			}
			if !slices.ContainsFunc(d.Options, func(o binding.Option) bool {
				return o.Alias == "GLT_BOOL_OPT_INSTANT" && o.Group == "GLOBAL_TYPE_BOOL" && o.Name != ""
			}) {
				t.Errorf("GLT_BOOL_OPT_INSTANT missing from %d options", len(d.Options))
			}
			if !slices.ContainsFunc(d.Features, func(f binding.Feature) bool { return f.Alias == "FEATURE_SIGN" && f.Mask == 1 }) {
				t.Errorf("FEATURE_SIGN missing: %+v", d.Features)
			}

			if tb, err := p.tables.Table(ctx, "VS_REGIM"); err != nil || tb != p.d.Schema+".VS_REGIM" {
				t.Errorf("Table(VS_REGIM) = %q, %v", tb, err)
			}
			if _, err := p.tables.Table(ctx, "NO_SUCH_TABLE_X"); err == nil {
				t.Error("Table(NO_SUCH_TABLE_X) accepted")
			}
			for _, col := range []string{"MODUS_TYPE", "ID_DTYP"} {
				if ok, err := p.tables.HasColumn(ctx, "VS_TCOMP", col); !ok || err != nil {
					t.Errorf("VS_TCOMP.%s: %v %v", col, ok, err)
				}
			}
			got[db.driver] = d
		})
	}
	if o, pg := got[config.DriverOracle], got[config.DriverPostgres]; o != nil && pg != nil && !reflect.DeepEqual(o, pg) {
		t.Errorf("dictionaries differ between Oracle and PostgreSQL:\noracle   %+v\npostgres %+v", o, pg)
	}
}

func findSection(ss []binding.Section, section string) *binding.Section {
	for i := range ss {
		if ss[i].Section == section {
			return &ss[i]
		}
		if s := findSection(ss[i].Children, section); s != nil {
			return s
		}
	}
	return nil
}

func countNodes(ns []binding.Node) int {
	n := len(ns)
	for _, c := range ns {
		n += countNodes(c.Children)
	}
	return n
}

// biggestNode returns the catalog node of list table with the most objects and their number.
func biggestNode(t *testing.T, p *Provider, table string) (string, int64) {
	t.Helper()
	var node, n int64
	err := each(context.Background(), p.read, p.d.SQL("SELECT ID_NODE, COUNT(*) FROM {s}."+table+
		" GROUP BY ID_NODE ORDER BY COUNT(*) DESC, ID_NODE FETCH FIRST 1 ROWS ONLY"), func(r Rows) error {
		return r.Scan(&node, &n)
	})
	if err != nil {
		t.Fatal(err)
	}
	return strconv.FormatInt(node, 10), n
}

func TestIntegrationBrowse(t *testing.T) {
	for _, db := range testDSNs {
		t.Run(db.driver, func(t *testing.T) {
			p := integrationProvider(t, db.env, db.driver)
			ctx := context.Background()

			sections, err := p.Sections(ctx)
			if err != nil {
				t.Fatal(err)
			}
			if len(sections) != 1 || sections[0].ID != "1" || len(sections[0].Children) == 0 || !strings.HasSuffix(sections[0].Ref, ":1") {
				t.Fatalf("sections root = %+v", sections)
			}

			// Electrical mode (ELREG_LIST_V) and data acquisition segment 1 (DA_V_LST_1) of a standard RSDU.
			for _, c := range []struct{ section, table string }{{"29", "ELREG_LIST_V"}, {"54", "DA_V_LST_1"}} {
				if findSection(sections, c.section) == nil {
					t.Errorf("section %s not in the tree", c.section)
					continue
				}
				start := time.Now()
				cat, err := p.Catalog(ctx, c.section)
				if err != nil {
					t.Fatal(err)
				}
				js, _ := json.Marshal(cat)
				t.Logf("catalog %s: %d nodes, %d bytes, %v", c.section, countNodes(cat), len(js), time.Since(start))
				if len(cat) == 0 || cat[0].Ref == "" || cat[0].Name == "" {
					t.Errorf("catalog %s = %+v", c.section, cat)
				}

				node, n := biggestNode(t, p, c.table)
				start = time.Now()
				objs, err := p.List(ctx, c.section, node)
				if err != nil {
					t.Fatal(err)
				}
				js, _ = json.Marshal(objs)
				t.Logf("biggest list %s/%s: %d objects (%d rows), %d bytes, %v", c.section, node, len(objs), n, len(js), time.Since(start))
				if int64(len(objs)) > n || len(objs) == 0 {
					t.Errorf("biggest list: %d objects of %d rows", len(objs), n)
				}
				query := strings.ToLower(objs[len(objs)/2].Name)
				res, err := p.Search(ctx, c.section, query, 50)
				if err != nil {
					t.Fatal(err)
				}
				i := slices.IndexFunc(res.Hits, func(h binding.Hit) bool { return h.Kind == binding.HitList })
				if i < 0 {
					t.Errorf("search %s %q: no list hit in %d", c.section, query, len(res.Hits))
					continue
				}
				hit := res.Hits[i]
				if !strings.Contains(strings.ToLower(hit.Name), query) {
					t.Errorf("hit %+v does not contain %q", hit, query)
				}
				objs, err = p.List(ctx, c.section, hit.Node)
				if err != nil {
					t.Fatal(err)
				}
				j := slices.IndexFunc(objs, func(o binding.Object) bool { return o.Ref == hit.Ref })
				if j < 0 {
					t.Errorf("hit %+v not in its node's list of %d", hit, len(objs))
					continue
				}
				o := objs[j]
				if c.table == "DA_V_LST_1" && (o.Cvalif == nil || o.Scale == nil) {
					t.Errorf("DA object without cvalif/scale: %+v", o)
				}
				t.Logf("list %s/%s: %d objects, e.g. %s %q type %q class %q", c.section, hit.Node, len(objs), o.Ref, o.Name, o.TypeAlias, o.Class)
			}

			start := time.Now()
			cat, err := p.Catalog(ctx, "1231")
			if err != nil {
				t.Fatal(err)
			}
			js, _ := json.Marshal(cat)
			t.Logf("catalog 1231 (OBJ_TREE): %d nodes, %d bytes, %v", countNodes(cat), len(js), time.Since(start))

			if _, err := p.Catalog(ctx, "999999999"); !errors.Is(err, binding.ErrNotFound) {
				t.Errorf("unknown section: %v", err)
			}
		})
	}
}

// firstID returns the smallest ID of rows of query, 0 when there are none.
func firstID(t *testing.T, p *Provider, query string, args ...any) int64 {
	t.Helper()
	var id int64
	err := each(context.Background(), p.read, p.d.SQL(query), func(r Rows) error {
		var v *int64
		if err := r.Scan(&v); err != nil {
			return err
		}
		if v != nil {
			id = *v
		}
		return nil
	}, args...)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func TestIntegrationResolve(t *testing.T) {
	for _, db := range testDSNs {
		t.Run(db.driver, func(t *testing.T) {
			p := integrationProvider(t, db.env, db.driver)
			ctx := context.Background()
			tid := func(name string) int64 {
				id, err := p.tableID(ctx, name)
				if err != nil {
					t.Fatal(err)
				}
				return id
			}
			cases := []struct {
				name, table, where string
				kind               slddoc.BindingKind
				option             string
				parent             bool
			}{
				{"data acquisition bool", "DA_V_LST_1", "ID_TYPE IN (SELECT d.ID FROM {s}.SYS_DTYP d JOIN {s}.SYS_GTYP g ON g.ID = d.ID_GTYPE WHERE g.DEFINE_ALIAS = 'GLOBAL_TYPE_BOOL')", slddoc.BindingMeas1, optionBool, true},
				{"data acquisition analog", "DA_V_LST_1", "ID_TYPE IN (SELECT d.ID FROM {s}.SYS_DTYP d JOIN {s}.SYS_GTYP g ON g.ID = d.ID_GTYPE WHERE g.DEFINE_ALIAS = 'GLOBAL_TYPE_ANALOG')", slddoc.BindingMeas1, optionAnalog, true},
				{"electrical mode", "ELREG_LIST_V", "1 = 1", slddoc.BindingMeas1, optionAnalog, true},
				{"equipment", "OBJ_TREE_PIN_V", "1 = 1", slddoc.BindingEquipment, optionComplex, false},
				{"scheme (jump)", "VS_FORM", "1 = 1", slddoc.BindingJump, optionComplex, false},
			}
			for _, c := range cases {
				id := firstID(t, p, "SELECT MIN(ID) FROM {s}."+c.table+" WHERE "+c.where)
				if id == 0 {
					t.Logf("%s: no object in %s, skipped", c.name, c.table)
					continue
				}
				r := ref(tid(c.table), id)
				start := time.Now()
				obj, err := p.Resolve(ctx, r)
				if err != nil {
					t.Fatalf("%s %s: %v", c.name, r, err)
				}
				t.Logf("%s %s: %+v, %v", c.name, r, *obj, time.Since(start))
				if obj.Ref != r || obj.Name == "" || obj.Kind != c.kind || obj.Option != c.option {
					t.Errorf("%s: %+v, want kind %s option %s", c.name, *obj, c.kind, c.option)
				}
				if c.parent && obj.ParentRef == "" {
					t.Errorf("%s: no parent", c.name)
				}
			}

			// A catalog node of the electrical mode: its parent is in the same table.
			sec, err := p.section(ctx, "29")
			if err != nil {
				t.Fatal(err)
			}
			node := firstID(t, p, "SELECT MIN(ID) FROM {s}."+sec.dir+" WHERE ID_PARENT > 0")
			obj, err := p.Resolve(ctx, ref(sec.dirID, node))
			if err != nil {
				t.Fatal(err)
			}
			if obj.Name == "" || !strings.HasPrefix(obj.ParentRef, strconv.FormatInt(sec.dirID, 10)+":") {
				t.Errorf("catalog node = %+v", *obj)
			}

			// A section of the object tree can't be bound; an object that doesn't exist isn't found.
			if _, err := p.Resolve(ctx, ref(tid(treeTableName), rootSection)); !errors.Is(err, binding.ErrInvalid) {
				t.Errorf("section: err = %v, want ErrInvalid", err)
			}
			if _, err := p.Resolve(ctx, ref(tid("VS_FORM"), 1<<40)); !errors.Is(err, binding.ErrNotFound) {
				t.Errorf("missing object: err = %v, want ErrNotFound", err)
			}
		})
	}
}

// TestIntegrationSuggest checks the automatic binding rules on real objects found in the database, then compares
// with what RSDU's own schemes store for components bound to a switch: every stored equipment, meas1 and meas2
// binding must be the one proposed for that switch (a scheme may store fewer, when bound by hand).
func TestIntegrationSuggest(t *testing.T) {
	for _, db := range testDSNs {
		t.Run(db.driver, func(t *testing.T) {
			p := integrationProvider(t, db.env, db.driver)
			ctx := context.Background()
			id := func(q string) string { return strconv.FormatInt(firstID(t, p, q), 10) }
			switchWith := func(otyp, meas string) string {
				return id("SELECT MIN(o.ID) FROM {s}.OBJ_TREE o JOIN {s}.SYS_OTYP t ON t.ID = o.ID_TYPE WHERE t.DEFINE_ALIAS = '" + otyp +
					"' AND EXISTS (SELECT 1 FROM {s}.MEAS_LIST m JOIN {s}.SYS_MEAS_TYPES mt ON mt.ID = m.ID_MEAS_TYPE WHERE m.ID_OBJ = o.ID AND mt.DEFINE_ALIAS = '" + meas + "')")
			}
			measOf := func(obj, meas string) string {
				return id("SELECT MIN(m.ID) FROM {s}.MEAS_LIST m JOIN {s}.SYS_MEAS_TYPES mt ON mt.ID = m.ID_MEAS_TYPE WHERE mt.DEFINE_ALIAS = '" + meas + "' AND m.ID_OBJ = " + obj)
			}
			ps, wd := switchWith("OTYP_POWER_SWITCH", measSwitchState), switchWith("OTYP_POWER_SWITCH_WITHDRAWABLE", measSwitchStateDraw)
			tid := func(name string) string {
				n, err := p.tableID(ctx, name)
				if err != nil {
					t.Fatal(err)
				}
				return strconv.FormatInt(n, 10)
			}
			pswt := tid("PSWT_LIST_V")
			cases := []struct {
				name, ref, kinds string
			}{
				{"power switch", "1024:" + ps, "equipment meas1"},
				{"withdrawable switch", "1024:" + wd, "equipment meas1 meas2"},
				{"switch state of a withdrawable", pswt + ":" + measOf(wd, measSwitchState), "equipment meas1 meas2"},
				{"drawer state", pswt + ":" + measOf(wd, measSwitchStateDraw), "equipment meas1 meas2"},
				{"device panel", tid("VP_PANEL") + ":" + id("SELECT MIN(p.ID) FROM {s}.VP_PANEL p JOIN {s}.SYS_OTYP t ON t.ID = p.ID_TYPE WHERE t.DEFINE_ALIAS = 'OTYP_DEVICE_PANEL'"), "jump"},
				{"scheme", tid("VS_FORM") + ":" + id("SELECT MIN(ID) FROM {s}.VS_FORM"), "jump"},
				{"transformer", "1024:" + id("SELECT MIN(o.ID) FROM {s}.OBJ_TREE o JOIN {s}.SYS_OTYP t ON t.ID = o.ID_TYPE WHERE t.DEFINE_ALIAS = 'OTYP_TWO_WINDING_TRANSFORMER'"), "equipment"},
				{"voltage", tid("ELREG_LIST_V") + ":" + id("SELECT MIN(v.ID) FROM {s}.ELREG_LIST_V v JOIN {s}.MEAS_LIST m ON m.ID = v.ID JOIN {s}.SYS_MEAS_TYPES mt ON mt.ID = m.ID_MEAS_TYPE WHERE mt.DEFINE_ALIAS = 'MEAS_U'"), "meas1"},
				{"data acquisition parameter", tid("DA_V_LST_1") + ":" + id("SELECT MIN(ID) FROM {s}.DA_V_LST_1"), ""},
			}
			for _, c := range cases {
				if strings.HasSuffix(c.ref, ":0") {
					t.Logf("%s: none in this database, skipped", c.name)
					continue
				}
				start := time.Now()
				bs, err := p.Suggest(ctx, c.ref, binding.Element{})
				if err != nil {
					t.Fatalf("%s %s: %v", c.name, c.ref, err)
				}
				var kinds []string
				for _, b := range bs {
					kinds = append(kinds, string(b.Kind))
					t.Logf("%s %s → %s %s %s %q, %v", c.name, c.ref, b.Kind, b.Ref, b.Option, b.Name, time.Since(start))
				}
				if strings.Join(kinds, " ") != c.kinds {
					t.Errorf("%s %s: kinds %v, want %s", c.name, c.ref, kinds, c.kinds)
				}
			}

			dict, err := p.dictionaries(ctx)
			if err != nil {
				t.Fatal(err)
			}
			kindOf := map[int64]slddoc.BindingKind{}
			for _, k := range []slddoc.BindingKind{slddoc.BindingEquipment, slddoc.BindingMeas1, slddoc.BindingMeas2} {
				kindOf[dict.regimID[k]] = k
			}
			stored := map[int64]map[slddoc.BindingKind]string{}
			var comps []int64
			q := `SELECT r.ID_OWNLST, r.ID_REGIM, r.ID_TABLE, r.ID_PARAM FROM {s}.VS_REGIM_TUNE r WHERE r.ID_OWNLST IN (
				SELECT e.ID_OWNLST FROM {s}.VS_REGIM_TUNE e JOIN {s}.OBJ_TREE o ON o.ID = e.ID_PARAM JOIN {s}.SYS_OTYP t ON t.ID = o.ID_TYPE
				WHERE e.ID_REGIM = ? AND e.ID_TABLE = 1024 AND t.DEFINE_ALIAS LIKE '%SWITCH%') ORDER BY r.ID_OWNLST`
			err = each(ctx, p.read, p.d.SQL(q), func(r Rows) error {
				var comp, regim, table, param int64
				if err := r.Scan(&comp, &regim, &table, &param); err != nil {
					return err
				}
				k, ok := kindOf[regim]
				if !ok || (len(comps) >= 60 && stored[comp] == nil) {
					return nil
				}
				if stored[comp] == nil {
					stored[comp] = map[slddoc.BindingKind]string{}
					comps = append(comps, comp)
				}
				stored[comp][k] = ref(table, param)
				return nil
			}, dict.regimID[slddoc.BindingEquipment])
			if err != nil {
				t.Fatal(err)
			}
			same := 0
			for _, c := range comps {
				bs, err := p.Suggest(ctx, stored[c][slddoc.BindingEquipment], binding.Element{})
				if err != nil {
					t.Fatal(err)
				}
				got := map[slddoc.BindingKind]string{}
				for _, b := range bs {
					got[b.Kind] = b.Ref
				}
				for k, v := range stored[c] {
					if got[k] != v {
						t.Errorf("component %d: stored %s %s, proposed %q", c, k, v, got[k])
					}
				}
				if len(got) == len(stored[c]) {
					same++
				}
			}
			t.Logf("components bound to a switch: %d compared, %d store exactly the proposed bindings, the others a subset", len(comps), same)
		})
	}
}

// TestIntegrationSchemes reads the scheme tree, one scheme and existence on a real RSDU.
func TestIntegrationSchemes(t *testing.T) {
	for _, db := range testDSNs {
		t.Run(db.driver, func(t *testing.T) {
			p := integrationProvider(t, db.env, db.driver)
			ctx := context.Background()
			tree, err := p.Schemes(ctx)
			if err != nil {
				t.Fatal(err)
			}
			if len(tree.Groups) == 0 || len(tree.Schemes) == 0 {
				t.Fatalf("groups %d, schemes %d", len(tree.Groups), len(tree.Schemes))
			}
			groups := map[string]bool{}
			for _, g := range tree.Groups {
				groups[g.ID] = true
			}
			files, updated := 0, 0
			for _, s := range tree.Schemes {
				if !groups[s.Group] {
					t.Errorf("scheme %s in unknown group %q", s.Ref, s.Group)
				}
				if s.FileName != "" {
					files++
				}
				if s.Updated != nil {
					updated++
				}
			}
			first := tree.Schemes[0]
			one, err := p.Scheme(ctx, first.Ref)
			if err != nil || one.Name != first.Name || one.FileName != first.FileName {
				t.Errorf("Scheme(%s) = %+v, %v", first.Ref, one, err)
			}
			if _, err := p.Scheme(ctx, "999999999999"); !errors.Is(err, binding.ErrNotFound) {
				t.Errorf("missing scheme: %v", err)
			}
			refs := []string{"999999999999", "bad"}
			for _, s := range tree.Schemes {
				refs = append(refs, s.Ref)
			}
			exist, err := p.SchemesExist(ctx, refs)
			if err != nil {
				t.Fatal(err)
			}
			n := 0
			for _, ok := range exist {
				if ok {
					n++
				}
			}
			if n != len(tree.Schemes) || exist["bad"] || exist["999999999999"] {
				t.Errorf("exist: %d of %d", n, len(tree.Schemes))
			}
			// A diagram named after a scheme's file gets that scheme among its candidates.
			var named binding.Scheme
			for _, s := range tree.Schemes {
				if s.FileName != "" {
					named = s
					break
				}
			}
			c := binding.RankCandidates(tree.Schemes, "sub/"+named.FileName, "")
			if !slices.ContainsFunc(c, func(x binding.Candidate) bool { return x.Ref == named.Ref }) {
				t.Errorf("scheme %s (%s) not among %d candidates", named.Ref, named.FileName, len(c))
			}
			t.Logf("groups %d, schemes %d (%d with a file name, %d with an update time); %d candidates for one name",
				len(tree.Groups), len(tree.Schemes), files, updated, len(c))
		})
	}
}

// TestIntegrationExportCheck checks, read-only, a diagram linked to an existing scheme of type 518 and a new one at
// the path of an existing scheme's file.
func TestIntegrationExportCheck(t *testing.T) {
	for _, db := range testDSNs {
		t.Run(db.driver, func(t *testing.T) {
			p := integrationProvider(t, db.env, db.driver)
			p.cfg.SchemeType = 518
			p.cfg.SVG.FullPath = true
			ctx := context.Background()
			types, err := p.SchemeTypes(ctx)
			if err != nil || !slices.ContainsFunc(types, func(s binding.SchemeType) bool { return s.ID == "518" }) {
				t.Fatalf("scheme types %+v, %v", types, err)
			}
			tcomp, err := p.componentTypes(ctx, 518)
			if err != nil || tcomp["41"] == 0 || tcomp[deviceShape] == 0 {
				t.Fatalf("component types %v, %v", tcomp, err)
			}
			schemes, err := p.allSchemes(ctx)
			if err != nil {
				t.Fatal(err)
			}
			i := slices.IndexFunc(schemes, func(s binding.Scheme) bool {
				_, err := svgFile(s.FileName, true)
				return s.TypeID == "518" && err == nil
			})
			if i < 0 {
				t.Fatal("no scheme of type 518 with an .svg or .xsde file")
			}
			linked := schemes[i]
			bound := []slddoc.Binding{{Source: config.ProviderRSDU, Kind: "equipment", Ref: "1:1"}}
			d := &slddoc.Diagram{
				Elements:       []slddoc.Element{{ID: 1, Shape: "41", Bindings: bound}, {ID: 2, Shape: "999999", Bindings: bound}},
				DigitalDevices: []slddoc.DigitalDevice{{ID: 3, Bindings: bound}},
			}
			c, err := p.CheckExport(ctx, "any", d, &slddoc.SchemeRef{Source: config.ProviderRSDU, Ref: linked.Ref})
			if err != nil {
				t.Fatal(err)
			}
			if c.Scheme == nil || c.Scheme.Ref != linked.Ref || c.SchemeType == nil || c.Bound != 3 || c.FileName != linked.FileName {
				t.Fatalf("linked check %+v", c)
			}
			var missing []int
			for _, is := range c.Issues {
				if is.Code == binding.IssueNoComponentType {
					missing = append(missing, is.Item)
				}
				if is.Code == binding.IssueBadFileName {
					t.Errorf("bad file name: %+v", is)
				}
			}
			if !slices.Equal(missing, []int{2}) {
				t.Errorf("items without a component type %v, want [2]", missing)
			}
			file, _ := svgFile(linked.FileName, true)
			c, err = p.CheckExport(ctx, strings.TrimSuffix(file, ".svg"), d, nil)
			if err != nil {
				t.Fatal(err)
			}
			if c.OK || !slices.ContainsFunc(c.Issues, func(i binding.ExportIssue) bool {
				return i.Code == binding.IssueSVGClash && slices.ContainsFunc(i.Schemes, func(s binding.Scheme) bool { return s.Ref == linked.Ref })
			}) {
				t.Errorf("new scheme at %s: %+v", file, c.Issues)
			}
			t.Logf("scheme %s: %d issues; component types for %d shapes", linked.Ref, len(c.Issues), len(tcomp))
		})
	}
}
