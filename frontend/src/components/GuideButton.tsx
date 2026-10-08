import { CircleHelp } from 'lucide-react'
import { t } from '../i18n'
import { useGuide } from '../lib/guide'

interface Props {
  /** Heading id in the user guide (its `{#id}` anchor). */
  topic: string
  size?: number
  className?: string
}

/** The "?" in a dialog's or panel's header: opens the user guide on that
 * dialog's topic. Stops mousedown/click from reaching the header, so it
 * never toggles a collapsible group or closes a backdrop. */
export function GuideButton({ topic, size = 14, className = '' }: Props) {
  const { openGuide } = useGuide()
  return (
    <button
      type="button"
      title={t('help.openTopic')}
      aria-label={t('help.openTopic')}
      onMouseDown={e => e.stopPropagation()}
      onClick={e => {
        e.stopPropagation()
        openGuide(topic)
      }}
      className={`shrink-0 text-gray-500 hover:text-accent font-normal normal-case ${className}`}
    >
      <CircleHelp size={size} />
    </button>
  )
}
