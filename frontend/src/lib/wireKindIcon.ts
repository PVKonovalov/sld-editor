// Small palette-preview icons for the ConnectorKinds the Elements panel's
// own "Wires" section offers to arm (see wireKindIcon.ts's sibling,
// elementIcon.ts, for the equipment-symbol equivalent). 'BusWork' (plain
// "Wire") is included here even though it's the routing tool's own
// underlying data default — drawing a connection at all now requires one
// of these buttons armed first (Canvas's own armedWireKind gate: a plain
// click, even squarely on a terminal, is otherwise just select/drag, not
// an implicit route start), so there has to be an explicit way to arm the
// plain case too. 'BusbarWire' was removed at the user's direction, since
// it had no rendering (or other) distinction from an ordinary wire to
// justify its own button — unlike 'OverheadLine'/'CableLine', which get
// real xsde2svg-catalog data (Kind, data-type code, an auto-generated
// Name) a plain wire never does. Drawn in the same viewBox="-32 -32 64
// 64" frame elementIconMarkup's icons use, styled to hint at how each
// kind actually differs once drawn (OverheadLine's real render is a
// heavier, tower-to-tower-looking line; CableLine's is dashed at
// "6 5" — its icon matches Render's own cableLineDash exactly, not just
// a conventional stand-in) rather than a literal preview.
export const WIRE_KIND_ICONS: Record<'BusWork' | 'OverheadLine' | 'CableLine' | 'LinkToObject', string> = {
  BusWork: `
    <line x1="-26" y1="0" x2="26" y2="0" stroke="currentColor" stroke-width="1.5" />
  `,
  OverheadLine: `
    <line x1="-24" y1="0" x2="24" y2="0" stroke="currentColor" stroke-width="2" />
    <line x1="-24" y1="-8" x2="-24" y2="8" stroke="currentColor" stroke-width="2" />
    <line x1="24" y1="-8" x2="24" y2="8" stroke="currentColor" stroke-width="2" />
  `,
  CableLine: `
    <line x1="-26" y1="0" x2="26" y2="0" stroke="currentColor" stroke-width="2" stroke-dasharray="6 5" />
  `,
  LinkToObject: `
    <line x1="-26" y1="0" x2="18" y2="0" stroke="currentColor" stroke-width="2" />
    <path d="M 26 0 L 14 -7 L 14 7 z" fill="currentColor" stroke="none" />
  `,
}

export const WIRE_KINDS = Object.keys(WIRE_KIND_ICONS) as ('BusWork' | 'OverheadLine' | 'CableLine' | 'LinkToObject')[]
