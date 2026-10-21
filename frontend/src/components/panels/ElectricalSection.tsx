import { useState } from 'react'
import { GroupHeader } from './GroupHeader'
import { t, type TranslationKey } from '../../i18n'
import { INTEGER_FIELDS } from '../../lib/electrical'

// The Properties panel's "Electrical parameters" group: one number input per
// field, empty meaning unset. groups holds one entry per block of fields (a
// transformer has one per winding, headed by its title); onChange gets the
// group index, the field and the new value (undefined clears it).

export interface ElectricalGroup {
  title?: string
  fields: string[]
  values: object
}

function numberValue(values: object, field: string): number | '' {
  const v = (values as Record<string, unknown>)[field]
  return typeof v === 'number' ? v : ''
}

export function ElectricalSection({
  groups,
  onChange,
}: {
  groups: ElectricalGroup[]
  onChange: (group: number, field: string, value: number | undefined) => void
}) {
  const [collapsed, setCollapsed] = useState(true)
  if (groups.every(g => g.fields.length === 0)) return null
  return (
    <div>
      <GroupHeader
        label={t('electrical.title')}
        collapsed={collapsed}
        onToggle={() => setCollapsed(c => !c)}
        topic="electrical-parameters"
      />
      {!collapsed && (
        <div className="space-y-2">
          {groups.map((g, gi) => (
            <div key={gi} className="space-y-1">
              {g.title && <p className="text-[11px] text-gray-400">{g.title}</p>}
              <div className="grid grid-cols-2 gap-1">
                {g.fields.map(field => (
                  <label key={field} className="block text-xs">
                    <span className="block text-gray-500 mb-0.5">{t(`electrical.${field}` as TranslationKey)}</span>
                    <input
                      type="number"
                      step={INTEGER_FIELDS.has(field) ? 1 : 'any'}
                      className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1"
                      value={numberValue(g.values, field)}
                      onChange={e => {
                        const raw = e.target.value
                        const n = INTEGER_FIELDS.has(field) ? Math.trunc(Number(raw)) : Number(raw)
                        onChange(gi, field, raw === '' || !Number.isFinite(n) ? undefined : n)
                      }}
                    />
                  </label>
                ))}
              </div>
            </div>
          ))}
          <p className="text-[10px] text-gray-500">{t('electrical.hint')}</p>
        </div>
      )}
    </div>
  )
}
