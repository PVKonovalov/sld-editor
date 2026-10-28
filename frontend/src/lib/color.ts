let context: CanvasRenderingContext2D | null | undefined

/** color (any CSS color, e.g. "lawngreen") as <input type="color"> takes it: #rrggbb, or grey when it can't be read. */
export function hexColor(color: string): string {
  const c = color.trim().toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(c)) return c
  if (/^#[0-9a-f]{3}$/.test(c)) return '#' + [...c.slice(1)].map(d => d + d).join('')
  if (context === undefined) context = document.createElement('canvas').getContext('2d')
  if (!context) return '#808080'
  context.fillStyle = '#808080'
  context.fillStyle = c
  return /^#[0-9a-f]{6}$/.test(context.fillStyle) ? context.fillStyle : '#808080'
}
