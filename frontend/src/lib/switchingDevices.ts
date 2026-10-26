import type { Diagram, DiagramElement } from '../types'

// Classes whose base.xml template reacts to {state:...}/{fill} — every
// switching device with an Open/Close/Intermediate position, and so the
// only ones that get a State dropdown in Properties. Starter (76) also
// reacts to {state:...} for its own moving-part orientation, but — unlike
// every other class here — has no {fill}/data-fill color legend of its
// own (the real source never gave it one); it's included anyway since the
// dropdown itself is just "which of the three template variants to draw".
export const SWITCHING_DEVICE_CLASSES = new Set([
  'Breaker',
  'Disconnector',
  'Sectionalizer',
  'PowerCircuitBreaker',
  'LoadBreakSwitch',
  'GroundSwitch',
  'ShortCircuiter',
  'ShortCircuiterNoGround',
  'DisconnectorFuse',
  'Starter',
])

export const STATE_OPEN = 0
export const STATE_CLOSE = 1

// Switching devices an SVG export should not carry as they are: State other
// than Open/Close (Intermediate, Faulty) or none at all. rdss-dms animates a
// device's live state by rotating the blade drawn in the export, assuming it
// shows a normal position — an Intermediate (diagonal) blade comes out wrong in
// every live state, and a device without State has no data-state to animate.
export function abnormalSwitchingDevices(diagram: Diagram): DiagramElement[] {
  return diagram.elements.filter(
    el => SWITCHING_DEVICE_CLASSES.has(el.class) && el.state !== STATE_OPEN && el.state !== STATE_CLOSE,
  )
}
