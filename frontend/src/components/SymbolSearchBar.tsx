import { t } from '../i18n'
import { GuideButton } from './GuideButton'

const buttonClass = 'px-2 py-0.5 rounded border border-surface-600 hover:bg-surface-600 text-gray-200'
const primaryClass = 'px-2 py-0.5 rounded bg-accent hover:bg-accent-hover text-white disabled:opacity-50'

/** The canvas bar of a symbol search (Canvas's symbolSearch): while the sample is set (Search), while it runs
 * (progress, a fraction), and the review of its matches (Similarity, counts, Place). onCancel ends it. */
export function SymbolSearchBar(
  props:
    | { phase: 'sample'; failed: boolean; onSearch: () => void; onCancel: () => void }
    | { phase: 'running'; progress: number; onCancel: () => void }
    | {
        phase: 'review'
        threshold: number
        shown: number
        rejected: number
        onThreshold: (v: number) => void
        onPlace: () => void
        onCancel: () => void
      },
) {
  return (
    <div className="flex items-center gap-3 rounded border border-surface-500 bg-surface-700/95 px-3 py-1.5 text-xs text-gray-200 shadow">
      <span className="font-medium">{t('symbolSearch.title')}</span>
      {props.phase === 'sample' && (
        <>
          <span className={props.failed ? 'text-state-warning' : 'text-gray-400'}>
            {t(props.failed ? 'symbolSearch.failed' : 'symbolSearch.sampleHint')}
          </span>
          <button type="button" className={primaryClass} onClick={props.onSearch}>
            {t('symbolSearch.search')}
          </button>
        </>
      )}
      {props.phase === 'running' && (
        <span className="text-gray-400 tabular-nums">
          {t('symbolSearch.running', { percent: Math.round(props.progress * 100) })}
        </span>
      )}
      {props.phase === 'review' && (
        <>
          <label className="flex items-center gap-1.5">
            {t('symbolSearch.similarity')}
            <input
              type="range"
              min={50}
              max={100}
              value={Math.round(props.threshold * 100)}
              onChange={e => props.onThreshold(Number(e.target.value) / 100)}
            />
            <span className="w-8 tabular-nums">{Math.round(props.threshold * 100)}%</span>
          </label>
          <span className="text-gray-400">
            {t('symbolSearch.counts', { shown: props.shown, rejected: props.rejected })}
          </span>
          <button
            type="button"
            className={primaryClass}
            disabled={props.shown - props.rejected === 0}
            onClick={props.onPlace}
          >
            {t('symbolSearch.place', { count: props.shown - props.rejected })}
          </button>
        </>
      )}
      <button type="button" className={buttonClass} onClick={props.onCancel}>
        {t('symbolSearch.cancel')}
      </button>
      <GuideButton topic="symbol-search" />
    </div>
  )
}
