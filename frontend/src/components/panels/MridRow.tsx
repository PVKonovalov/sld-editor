import { useState } from 'react'
import { t } from '../../i18n'

/** The CIM identity (mRID) an item was imported with, read-only, with a Copy button; nothing when it has none.
 * Keyed by the caller on the mRID, so "Copied" lasts until another item is shown. */
export function MridRow({ mrid }: { mrid?: string }) {
  const [copied, setCopied] = useState(false)
  if (!mrid) return null
  return (
    <div className="block text-xs">
      <span className="block text-gray-400 mb-1" title={t('properties.mridHint')}>
        {t('properties.mrid')}
      </span>
      <div className="flex items-center gap-1">
        <span className="flex-1 min-w-0 truncate select-all font-mono text-gray-200" title={mrid}>
          {mrid}
        </span>
        <button
          type="button"
          className="shrink-0 rounded border border-surface-600 hover:bg-surface-600 text-gray-200 px-2 py-0.5"
          onClick={() => navigator.clipboard.writeText(mrid).then(() => setCopied(true))}
        >
          {copied ? t('properties.mridCopied') : t('properties.mridCopy')}
        </button>
      </div>
    </div>
  )
}
