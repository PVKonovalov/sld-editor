package binding

import (
	"context"

	"github.com/PVKonovalov/slddoc"
)

// Export check issue severities: an error stops the export, a warning only reports what is skipped or missing.
const (
	SeverityError   = "error"
	SeverityWarning = "warning"
)

// Export check issue codes; the frontend words them.
const (
	IssueNoSchemeType      = "noSchemeType"      // the scheme type is not configured
	IssueUnknownSchemeType = "unknownSchemeType" // the configured scheme type is not a scheme type of the provider
	IssueSchemeTypeDiffers = "schemeTypeDiffers" // the linked scheme has another type than the configured one
	IssueSchemeMissing     = "schemeMissing"     // the linked scheme is gone
	IssueSchemeHeld        = "schemeHeld"        // another diagram holds the linked scheme
	IssueOtherSourceScheme = "otherSourceScheme" // the diagram is linked to a scheme of another provider
	IssueNotLinked         = "notLinked"         // a new scheme would be registered
	IssueNoComponentType   = "noComponentType"   // the item's shape has no component type; it is skipped
	IssueBadID             = "badId"             // the item's id is not a positive integer
	IssueOtherSource       = "otherSource"       // bindings of another provider, skipped
	IssueNothingBound      = "nothingBound"      // no item has a binding of the provider
	IssueBadFileName       = "badFileName"       // the scheme file name can't be read by the viewer
	IssueSVGClash          = "svgClash"          // another scheme resolves to the same SVG file
	IssueNoSVGDir          = "noSvgDir"          // where the viewer reads SVGs is not configured
	IssueFileOfDiagram     = "fileOfDiagram"     // the linked scheme's file name is another diagram's path
	IssueSchemeExists      = "schemeExists"      // registering a new scheme while the linked one still exists
	IssueBadRef            = "badRef"            // a binding's object can't be written; it is skipped
	IssueUnknownKind       = "unknownKind"       // the provider has no binding type for the kind; skipped
	IssueUnknownOption     = "unknownOption"     // the provider has no such value option; skipped
	IssueDuplicate         = "duplicate"         // a binding the provider can't store twice for one item; skipped
	IssueBadComponent      = "badComponent"      // a component whose name is not an item id; skipped
	IssueMissingObject     = "missingObject"     // a binding's object no longer exists; kept, without a name
)

// ExportIssue is one finding of an export check. Item, Kind (element or device) and Shape name the diagram item it is
// about, when it is about one; Schemes are the provider's schemes involved (a clash); Detail is extra text (a source,
// a diagram name, a type).
type ExportIssue struct {
	Code     string   `json:"code"`
	Severity string   `json:"severity"`
	Item     int      `json:"item,omitempty"`
	Kind     string   `json:"kind,omitempty"`
	Shape    string   `json:"shape,omitempty"`
	Schemes  []Scheme `json:"schemes,omitempty"`
	Detail   string   `json:"detail,omitempty"`
}

// SchemeType is a type a provider's schemes can have.
type SchemeType struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// ExportCheck is what an export of a diagram would do and what stops it. Scheme is the linked scheme, nil for a new
// one; FileName is the scheme's file name (a new one: the diagram's path with .svg) and SVGPath where its picture
// goes. Bound counts the items with bindings of the provider. DefaultGroup is the group proposed for a new scheme.
type ExportCheck struct {
	OK           bool          `json:"ok"`
	Scheme       *Scheme       `json:"scheme,omitempty"`
	SchemeType   *SchemeType   `json:"schemeType,omitempty"`
	FileName     string        `json:"fileName"`
	SVGPath      string        `json:"svgPath,omitempty"`
	Bound        int           `json:"bound"`
	DefaultGroup string        `json:"defaultGroup,omitempty"`
	Issues       []ExportIssue `json:"issues"`
}

// Add appends an issue; an error makes the check fail.
func (c *ExportCheck) Add(i ExportIssue) {
	c.Issues = append(c.Issues, i)
	if i.Severity == SeverityError {
		c.OK = false
	}
}

// ExportRequest is what the user chose for an export: Register a new scheme (for an unlinked diagram, or one whose
// scheme is gone) rather than export to the linked one; the scheme's Name, Alias and Group ("" keeps a linked
// scheme's own).
type ExportRequest struct {
	Register bool   `json:"register"`
	Name     string `json:"name"`
	Alias    string `json:"alias"`
	Group    string `json:"group"`
}

// ExportResult is what an export wrote: the scheme link to save in the diagram, how many components and bindings,
// what was skipped, and where the scheme's SVG was delivered (SVGError when that failed).
type ExportResult struct {
	Scheme     slddoc.SchemeRef `json:"scheme"`
	Registered bool             `json:"registered"`
	Components int              `json:"components"`
	Bindings   int              `json:"bindings"`
	Skipped    []ExportIssue    `json:"skipped"`
	SVG        []string         `json:"svg,omitempty"`
	SVGError   string           `json:"svgError,omitempty"`
}

// SVGDeliverer is a Provider that delivers a scheme's picture where its viewer reads it.
type SVGDeliverer interface {
	// DeliverSVG puts svg where the viewer looks for the picture of scheme ref and returns where it went (none: no
	// destination configured).
	DeliverSVG(ctx context.Context, ref string, svg []byte) ([]string, error)
}

// ErrExportRefused is returned by an export its check stops; Check tells why.
type ErrExportRefused struct{ Check *ExportCheck }

func (e *ErrExportRefused) Error() string { return "binding: the export check failed" }

// ExportChecker is a Provider that can tell, without writing, whether a diagram can be exported to it.
type ExportChecker interface {
	// CheckExport checks the diagram name, d, linked to scheme (nil: a new scheme would be registered, or the link
	// is of another provider and is reported by the caller). It does not check who holds the scheme.
	CheckExport(ctx context.Context, name string, d *slddoc.Diagram, scheme *slddoc.SchemeRef) (*ExportCheck, error)
	SchemeGroups(ctx context.Context) ([]SchemeGroup, error)
	SchemeTypes(ctx context.Context) ([]SchemeType, error)
}

// SchemeBindings are the bindings a provider's scheme holds, read for import: the diagram's object and one Component
// per item. Issues are warnings about what could not be read as a binding.
type SchemeBindings struct {
	Scheme     Scheme          `json:"scheme"`
	Object     *slddoc.Binding `json:"object,omitempty"`
	Components []Component     `json:"components"`
	Issues     []ExportIssue   `json:"issues"`
}

// Component is what a scheme holds for one item: Item is its id, Shape the shape code of its component type ("" when
// the provider has none), Precision and Features as in slddoc.Element, and its bindings with names cached.
type Component struct {
	Item      int              `json:"item"`
	Shape     string           `json:"shape,omitempty"`
	Precision int              `json:"precision,omitempty"`
	Features  string           `json:"features,omitempty"`
	Bindings  []slddoc.Binding `json:"bindings"`
}
