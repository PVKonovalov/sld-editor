import { useState } from 'react'
import { Link2, X } from 'lucide-react'
import { t } from '../i18n'
import * as diagramOps from '../lib/diagramOps'
import { useDiagramContext } from '../state/useDiagramContext'
import { SchemePicker } from './SchemePicker'

/** After an .xsde import with proposed schemes: a non-modal offer to link the diagram. Choose… opens the scheme picker;
 * the link is an undoable edit saved with the diagram. */
export function SchemeOfferBanner() {
  const { schemeOffer, dismissSchemeOffer, diagramName, updateDiagram, config } = useDiagramContext()
  const [picking, setPicking] = useState(false)
  if (!schemeOffer || schemeOffer.name !== diagramName) return null
  const provider = config?.bindings?.provider ?? ''
  const free = schemeOffer.candidates.filter(c => !c.diagram)
  const best = free[0]
  return (
    <>
      <div
        role="status"
        className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 rounded border border-surface-500 bg-surface-700/95 px-3 py-2 text-xs text-gray-200 shadow"
      >
        <Link2 size={14} className="shrink-0 text-accent" />
        <span>
          {t(free.length === 1 ? 'schemes.offerOne' : 'schemes.offerMany', { name: best.name || best.ref, count: free.length })}
          {best.match === 'name' && <span className="ml-1 text-amber-300">{t('schemes.ambiguous')}</span>}
        </span>
        <button
          type="button"
          onClick={() => setPicking(true)}
          className="rounded bg-accent px-2 py-0.5 text-white hover:opacity-90"
        >
          {t('schemes.choose')}
        </button>
        <button
          type="button"
          onClick={dismissSchemeOffer}
          title={t('common.close')}
          aria-label={t('common.close')}
          className="text-gray-400 hover:text-white"
        >
          <X size={14} />
        </button>
      </div>
      {picking && (
        <SchemePicker
          name={schemeOffer.name}
          source={schemeOffer.source}
          onPick={s => {
            setPicking(false)
            updateDiagram(d => diagramOps.setDiagramScheme(d, { source: provider, ref: s.ref }))
            dismissSchemeOffer()
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </>
  )
}
