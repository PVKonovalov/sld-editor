import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  Bold,
  Italic,
  TableCellsMerge,
  TableCellsSplit,
  Underline,
  type LucideIcon,
} from 'lucide-react'
import { useDiagramContext } from '../../state/useDiagramContext'
import * as diagramOps from '../../lib/diagramOps'
import { t, type TranslationKey } from '../../i18n'
import type { Diagram, DiagramElement, TableCell } from '../../types'

const MAP_WIDTH = 240
const MAP_MIN_HEIGHT = 40
const MAP_MAX_HEIGHT = 260

const inputClass = 'w-full bg-surface-800 border border-surface-600 rounded px-2 py-1'

function ToggleButton({
  icon: Icon,
  title,
  pressed,
  disabled,
  onClick,
}: {
  icon: LucideIcon
  title: TranslationKey
  pressed: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      title={t(title)}
      aria-label={t(title)}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={`p-1.5 rounded border disabled:opacity-40 disabled:cursor-not-allowed ${
        pressed
          ? 'bg-accent border-accent text-white'
          : 'bg-surface-800 border-surface-600 text-gray-400 hover:text-white hover:bg-surface-600'
      }`}
    >
      <Icon size={14} />
    </button>
  )
}

/** The grid of Table2 el drawn to scale: a click picks a cell, Shift-click stretches the pick to another one. */
function CellMap({
  el,
  rect,
  onPick,
}: {
  el: DiagramElement
  rect: diagramOps.TableRect | null
  onPick: (row: number, col: number, extend: boolean) => void
}) {
  const heights = el.rowHeights ?? []
  const widths = el.columnWidths ?? []
  const totalW = widths.reduce((a, b) => a + b, 0) || 1
  const totalH = heights.reduce((a, b) => a + b, 0) || 1
  const mapH = Math.min(MAP_MAX_HEIGHT, Math.max(MAP_MIN_HEIGHT, (MAP_WIDTH * totalH) / totalW))
  const tableFill = el.fill && el.fill !== 'none' ? el.fill : 'transparent'
  return (
    <div className="relative w-full border border-surface-600 rounded overflow-hidden" style={{ height: mapH }}>
      {(el.cells ?? []).map(cell => {
        const box = diagramOps.table2RectBox(el, {
          row0: cell.row,
          col0: cell.col,
          row1: cell.row + Math.max(cell.rowSpan ?? 1, 1) - 1,
          col1: cell.col + Math.max(cell.colSpan ?? 1, 1) - 1,
        })
        const picked =
          rect && cell.row >= rect.row0 && cell.row <= rect.row1 && cell.col >= rect.col0 && cell.col <= rect.col1
        const fill = cell.fill && cell.fill !== 'none' ? cell.fill : tableFill
        const text = (cell.text ?? '').split('\n').find(l => l.trim() !== '') ?? ''
        return (
          <button
            key={`${cell.row}:${cell.col}`}
            type="button"
            title={cell.text}
            onClick={e => onPick(cell.row, cell.col, e.shiftKey)}
            className={`absolute border border-surface-500 px-0.5 text-[9px] leading-tight overflow-hidden whitespace-nowrap text-ellipsis ${
              picked ? 'ring-2 ring-accent z-10' : 'hover:ring-1 hover:ring-gray-300'
            }`}
            style={{
              left: `${((box.x - el.x) / totalW) * 100}%`,
              top: `${((box.y - el.y) / totalH) * 100}%`,
              width: `${(box.width / totalW) * 100}%`,
              height: `${(box.height / totalH) * 100}%`,
              background: fill,
              color: cell.textColor ?? 'black',
              fontWeight: cell.bold ? 'bold' : undefined,
              fontStyle: cell.italic ? 'italic' : undefined,
              textAlign: cell.alignH === 'left' ? 'left' : cell.alignH === 'right' ? 'right' : 'center',
            }}
          >
            {text}
          </button>
        )
      })}
    </div>
  )
}

/** The Properties editor of Table2 el: grid size, the cell map, and the look of the picked cells. */
export function Table2Editor({
  el,
  swatchColor,
}: {
  el: DiagramElement
  swatchColor: (value: string | undefined, fallback: string) => string
}) {
  const { updateDiagram, tableCellRange, setTableCellRange } = useDiagramContext()
  const rect = diagramOps.table2RangeRect(el, tableCellRange)
  const picked = rect ? diagramOps.table2CellsIn(el, rect) : []
  const single = picked.length === 1 ? picked[0] : null
  const rows = el.rowHeights?.length ?? 1
  const cols = el.columnWidths?.length ?? 1

  function edit(fn: (d: Diagram) => Diagram) {
    updateDiagram(fn)
  }
  function patchCells(fields: Partial<TableCell>) {
    if (rect) edit(d => diagramOps.updateTable2Cells(d, el.id, rect, fields))
  }
  function pick(row: number, col: number, extend: boolean) {
    if (extend && tableCellRange?.id === el.id) setTableCellRange({ ...tableCellRange, focus: { row, col } })
    else setTableCellRange({ id: el.id, anchor: { row, col }, focus: { row, col } })
  }
  const all = (key: 'bold' | 'italic' | 'underline') => picked.length > 0 && picked.every(c => c[key])
  const first = picked[0]
  const canMerge = picked.length > 1
  const canSplit = picked.some(c => (c.rowSpan ?? 1) > 1 || (c.colSpan ?? 1) > 1)

  return (
    <>
      <div className="grid grid-cols-2 gap-1">
        <label className="block text-xs">
          <span className="block text-gray-400 mb-1">{t('properties.tableRows')}</span>
          <input
            type="number"
            min={1}
            className={inputClass}
            value={rows}
            onChange={e => edit(d => diagramOps.resizeTable2(d, el.id, Number(e.target.value), cols))}
          />
        </label>
        <label className="block text-xs">
          <span className="block text-gray-400 mb-1">{t('properties.tableColumns')}</span>
          <input
            type="number"
            min={1}
            className={inputClass}
            value={cols}
            onChange={e => edit(d => diagramOps.resizeTable2(d, el.id, rows, Number(e.target.value)))}
          />
        </label>
      </div>

      <div className="text-xs">
        <span className="block text-gray-400 mb-1">{t('properties.tableCells')}</span>
        <CellMap el={el} rect={rect} onPick={pick} />
        <span className="block text-[10px] text-gray-500 mt-1">{t('properties.tableCellsHint')}</span>
      </div>

      {rect && first && (
        <div className="space-y-2 border-t border-surface-600 pt-2">
          <span className="block text-xs text-gray-300">
            {rect.row0 === rect.row1 && rect.col0 === rect.col1
              ? t('properties.tableCellAt', { row: rect.row0 + 1, col: rect.col0 + 1 })
              : t('properties.tableCellRange', {
                  row0: rect.row0 + 1,
                  col0: rect.col0 + 1,
                  row1: rect.row1 + 1,
                  col1: rect.col1 + 1,
                })}
          </span>
          <div className="grid grid-cols-2 gap-1">
            <label className="block text-xs">
              <span className="block text-gray-400 mb-1">{t('properties.tableRowHeight')}</span>
              <input
                type="number"
                min={1}
                className={inputClass}
                value={el.rowHeights?.[rect.row0] ?? 0}
                onChange={e => {
                  const h = Number(e.target.value)
                  edit(d => {
                    let next = d
                    for (let r = rect.row0; r <= rect.row1; r++) next = diagramOps.updateTable2RowHeight(next, el.id, r, h)
                    return next
                  })
                }}
              />
            </label>
            <label className="block text-xs">
              <span className="block text-gray-400 mb-1">{t('properties.tableColumnWidth')}</span>
              <input
                type="number"
                min={1}
                className={inputClass}
                value={el.columnWidths?.[rect.col0] ?? 0}
                onChange={e => {
                  const w = Number(e.target.value)
                  edit(d => {
                    let next = d
                    for (let c = rect.col0; c <= rect.col1; c++) next = diagramOps.updateTable2ColumnWidth(next, el.id, c, w)
                    return next
                  })
                }}
              />
            </label>
          </div>
          {single && (
            <label className="block text-xs">
              <span className="block text-gray-400 mb-1">{t('properties.tableCellText')}</span>
              <textarea
                rows={Math.min(6, Math.max(2, (single.text ?? '').split('\n').length))}
                className={`${inputClass} resize-y`}
                value={single.text ?? ''}
                onChange={e => patchCells({ text: e.target.value })}
              />
            </label>
          )}
          <div className="flex flex-wrap items-end gap-1 text-xs">
            <ToggleButton icon={Bold} title="properties.labelBold" pressed={all('bold')} onClick={() => patchCells({ bold: !all('bold') })} />
            <ToggleButton icon={Italic} title="properties.labelItalic" pressed={all('italic')} onClick={() => patchCells({ italic: !all('italic') })} />
            <ToggleButton
              icon={Underline}
              title="properties.labelUnderline"
              pressed={all('underline')}
              onClick={() => patchCells({ underline: !all('underline') })}
            />
            <label className="ml-auto block w-20">
              <span className="block text-gray-400 mb-1">{t('properties.labelSize')}</span>
              <input
                type="number"
                min={1}
                className={inputClass}
                placeholder={String(11)}
                value={first.fontSize ?? ''}
                onChange={e => patchCells({ fontSize: Number(e.target.value) || undefined })}
              />
            </label>
          </div>
          <div className="flex gap-1">
            <ToggleButton icon={AlignLeft} title="properties.tableAlignLeft" pressed={first.alignH === 'left'} onClick={() => patchCells({ alignH: 'left' })} />
            <ToggleButton icon={AlignCenter} title="properties.tableAlignCenter" pressed={!first.alignH} onClick={() => patchCells({ alignH: undefined })} />
            <ToggleButton icon={AlignRight} title="properties.tableAlignRight" pressed={first.alignH === 'right'} onClick={() => patchCells({ alignH: 'right' })} />
            <span className="w-2" />
            <ToggleButton
              icon={AlignVerticalJustifyStart}
              title="properties.vAlignTop"
              pressed={first.alignV === 'top'}
              onClick={() => patchCells({ alignV: 'top' })}
            />
            <ToggleButton
              icon={AlignVerticalJustifyCenter}
              title="properties.vAlignMiddle"
              pressed={!first.alignV}
              onClick={() => patchCells({ alignV: undefined })}
            />
            <ToggleButton
              icon={AlignVerticalJustifyEnd}
              title="properties.vAlignBottom"
              pressed={first.alignV === 'bottom'}
              onClick={() => patchCells({ alignV: 'bottom' })}
            />
          </div>
          <div className="grid grid-cols-2 gap-1">
            <label className="block text-xs">
              <span className="flex items-center justify-between mb-1">
                <span className="text-gray-400">{t('properties.labelColor')}</span>
                <button
                  type="button"
                  className="text-[10px] text-gray-400 hover:text-white underline"
                  onClick={() => patchCells({ textColor: undefined })}
                >
                  {t('properties.tableDefault')}
                </button>
              </span>
              <input
                type="color"
                className="w-full h-8 bg-surface-800 border border-surface-600 rounded px-1 py-1"
                value={swatchColor(first.textColor, '#000000')}
                onChange={e => patchCells({ textColor: e.target.value })}
              />
            </label>
            <label className="block text-xs">
              <span className="flex items-center justify-between mb-1">
                <span className="text-gray-400">{t('properties.tableCellFill')}</span>
                <button
                  type="button"
                  className="text-[10px] text-gray-400 hover:text-white underline"
                  onClick={() => patchCells({ fill: undefined })}
                >
                  {t('properties.tableDefault')}
                </button>
              </span>
              <input
                type="color"
                className="w-full h-8 bg-surface-800 border border-surface-600 rounded px-1 py-1"
                value={swatchColor(first.fill ?? el.fill, '#ffffff')}
                onChange={e => patchCells({ fill: e.target.value })}
              />
            </label>
          </div>
          <div className="flex gap-1">
            <button
              type="button"
              disabled={!canMerge}
              onClick={() => {
                edit(d => diagramOps.mergeTable2Cells(d, el.id, rect))
                setTableCellRange({ id: el.id, anchor: { row: rect.row0, col: rect.col0 }, focus: { row: rect.row0, col: rect.col0 } })
              }}
              className="flex-1 flex items-center justify-center gap-1 text-xs px-2 py-1 rounded border border-surface-600 bg-surface-800 hover:bg-surface-600 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <TableCellsMerge size={14} />
              {t('properties.tableMerge')}
            </button>
            <button
              type="button"
              disabled={!canSplit}
              onClick={() => edit(d => diagramOps.unmergeTable2Cells(d, el.id, rect))}
              className="flex-1 flex items-center justify-center gap-1 text-xs px-2 py-1 rounded border border-surface-600 bg-surface-800 hover:bg-surface-600 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <TableCellsSplit size={14} />
              {t('properties.tableUnmerge')}
            </button>
          </div>
        </div>
      )}
    </>
  )
}
