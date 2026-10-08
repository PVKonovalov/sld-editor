import { createContext, useContext } from 'react'

/** Opens the user guide window (GuideWindow), optionally scrolled to a
 * topic: a heading id from the guide's explicit `{#id}` anchors
 * (backend/assets/USER_GUIDE*.md), identical in every translation. */
export interface GuideApi {
  openGuide: (topic?: string) => void
}

// Provided by App's Shell; the no-op default only matters outside it.
export const GuideContext = createContext<GuideApi>({ openGuide: () => {} })

export function useGuide(): GuideApi {
  return useContext(GuideContext)
}
