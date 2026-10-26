import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { t } from '../../i18n'

/** The CIM identity (mRID) an item was imported with, read-only, with a Copy icon; nothing when it has none.
 * Keyed by the caller on the mRID, so "Copied" lasts until another item is shown. */
export function MridRow({ mrid }: { mrid?: string }) {
  const [copied, setCopied] = useState(false)
  if (!mrid) return null
  const hint = t(copied ? 'properties.mridCopied' : 'properties.mridCopy')
  return (
    <div className="text-xs">
      <div className="flex items-center justify-between mb-1">
        <label htmlFor="item-mrid" className="text-gray-400" title={t('properties.mridHint')}>
          {t('properties.mrid')}
        </label>
        <button
          type="button"
          title={hint}
          aria-label={hint}
          onClick={() => navigator.clipboard.writeText(mrid).then(() => setCopied(true))}
          className="text-gray-400 hover:text-white"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      </div>
      <input
        id="item-mrid"
        className="w-full bg-surface-800 border border-surface-600 rounded px-2 py-1 font-mono opacity-50"
        value={mrid}
        title={mrid}
        readOnly
      />
    </div>
  )
}
