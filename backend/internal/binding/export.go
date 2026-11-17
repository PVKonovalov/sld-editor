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

// ExportChecker is a Provider that can tell, without writing, whether a diagram can be exported to it.
type ExportChecker interface {
	// CheckExport checks the diagram name, d, linked to scheme (nil: a new scheme would be registered, or the link
	// is of another provider and is reported by the caller). It does not check who holds the scheme.
	CheckExport(ctx context.Context, name string, d *slddoc.Diagram, scheme *slddoc.SchemeRef) (*ExportCheck, error)
	SchemeGroups(ctx context.Context) ([]SchemeGroup, error)
	SchemeTypes(ctx context.Context) ([]SchemeType, error)
}
