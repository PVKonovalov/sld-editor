import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import * as api from '../lib/api'
import * as diagramOps from '../lib/diagramOps'
import type { Diagram, DiagramInfo, ElementSymbol, EditorConfig, EditorSettings } from '../types'
import { DiagramContext, type DiagramContextValue } from './useDiagramContext'

export function DiagramProvider({ children }: { children: ReactNode }) {
  const [diagramName, setDiagramName] = useState<string | null>(null)
  const [diagram, setDiagram] = useState<Diagram | null>(null)
  const [dirty, setDirty] = useState(false)
  const [diagrams, setDiagrams] = useState<DiagramInfo[]>([])
  const [elements, setElements] = useState<ElementSymbol[]>([])
  const [config, setConfig] = useState<EditorConfig | null>(null)
  const [selectedElementId, setSelectedElementIdState] = useState<number | null>(null)
  const [selectedElementIds, setSelectedElementIds] = useState<Set<number>>(new Set())
  const [selectedConnectorId, setSelectedConnectorIdState] = useState<number | null>(null)
  const [armedSymbol, setArmedSymbolState] = useState<ElementSymbol | null>(null)
  const [defaultVoltage, setDefaultVoltage] = useState<number | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)

  const refreshDiagrams = useCallback(async () => {
    setDiagrams((await api.listDiagrams()) ?? [])
  }, [])

  useEffect(() => {
    refreshDiagrams().catch(e => setError((e as Error).message))
    api
      .listElements()
      .then(els => setElements(els ?? []))
      .catch(e => setError((e as Error).message))
    api.getConfig().then(setConfig).catch(e => setError((e as Error).message))
  }, [refreshDiagrams])

  const clearSelection = useCallback(() => {
    setSelectedElementIdState(null)
    setSelectedElementIds(new Set())
    setSelectedConnectorIdState(null)
  }, [])

  const selectElement = useCallback((id: number | null) => {
    setSelectedElementIdState(id)
    setSelectedElementIds(id === null ? new Set() : new Set([id]))
    setSelectedConnectorIdState(null)
    setArmedSymbolState(null)
  }, [])

  const selectConnector = useCallback((id: number | null) => {
    setSelectedConnectorIdState(id)
    setSelectedElementIdState(null)
    setSelectedElementIds(new Set())
    setArmedSymbolState(null)
  }, [])

  const armSymbol = useCallback((symbol: ElementSymbol | null) => {
    setArmedSymbolState(symbol)
    setSelectedElementIdState(null)
    setSelectedElementIds(new Set())
    setSelectedConnectorIdState(null)
  }, [])

  // Shift-click: toggles one element in/out of the multi-selection instead
  // of replacing it. selectedElementId tracks whichever single id the set
  // still resolves to (the one just added, or the one left after a removal
  // brings the set back down to one/zero) so Properties' single-element
  // editor and busbar point handles keep working the moment the set is
  // back to size 1 — see selectedElementIds' own doc comment.
  const toggleElementSelection = useCallback(
    (id: number) => {
      const next = new Set(selectedElementIds)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      setSelectedElementIds(next)
      setSelectedElementIdState(next.size === 1 ? [...next][0] : next.size === 0 ? null : id)
      setSelectedConnectorIdState(null)
      setArmedSymbolState(null)
    },
    [selectedElementIds],
  )

  const newDiagram = useCallback(
    async (name: string, width?: number, height?: number) => {
      const { diagram: d, warning } = await api.createDiagram(name, width, height)
      setDiagramName(name)
      setDiagram(d)
      setDirty(false)
      clearSelection()
      setError(warning ?? null)
      await refreshDiagrams()
    },
    [refreshDiagrams, clearSelection],
  )

  const openDiagram = useCallback(
    async (name: string) => {
      const d = diagramOps.ensureLastId(await api.getDiagram(name))
      setDiagramName(name)
      setDiagram(d)
      setDirty(false)
      clearSelection()
    },
    [clearSelection],
  )

  const saveDiagram = useCallback(async () => {
    if (!diagramName || !diagram) return
    const { diagram: d, warning } = await api.saveDiagram(diagramName, diagram)
    setDiagram(d)
    setDirty(false)
    setError(warning ?? null)
    await refreshDiagrams()
  }, [diagramName, diagram, refreshDiagrams])

  const saveDiagramAs = useCallback(
    async (name: string) => {
      if (!diagram) return
      const { diagram: d, warning } = await api.saveDiagram(name, diagram)
      setDiagramName(name)
      setDiagram(d)
      setDirty(false)
      setError(warning ?? null)
      await refreshDiagrams()
    },
    [diagram, refreshDiagrams],
  )

  const updateDiagram = useCallback((updater: (d: Diagram) => Diagram) => {
    setDiagram(d => (d ? updater(d) : d))
    setDirty(true)
  }, [])

  const updateEditorSettings = useCallback(
    (patch: Partial<EditorSettings>) => {
      updateDiagram(d => ({ ...d, editor: { ...d.editor, ...patch } }))
    },
    [updateDiagram],
  )

  const deleteSelected = useCallback(() => {
    if (selectedElementIds.size > 0) {
      const ids = selectedElementIds
      updateDiagram(d => [...ids].reduce((acc, id) => diagramOps.removeElement(acc, id), d))
      clearSelection()
    } else if (selectedConnectorId !== null) {
      const id = selectedConnectorId
      updateDiagram(d => diagramOps.removeConnector(d, id))
      clearSelection()
    }
  }, [selectedElementIds, selectedConnectorId, updateDiagram, clearSelection])

  const clearError = useCallback(() => setError(null), [])

  const value = useMemo<DiagramContextValue>(
    () => ({
      diagramName,
      diagram,
      dirty,
      diagrams,
      elements,
      config,
      error,
      selectedElementId,
      selectedElementIds,
      toggleElementSelection,
      selectedConnectorId,
      armedSymbol,
      defaultVoltage,
      setDefaultVoltage,
      selectElement,
      selectConnector,
      armSymbol,
      deleteSelected,
      clearError,
      refreshDiagrams,
      newDiagram,
      openDiagram,
      saveDiagram,
      saveDiagramAs,
      updateDiagram,
      updateEditorSettings,
    }),
    [
      diagramName,
      diagram,
      dirty,
      diagrams,
      elements,
      config,
      error,
      selectedElementId,
      selectedElementIds,
      toggleElementSelection,
      selectedConnectorId,
      armedSymbol,
      defaultVoltage,
      setDefaultVoltage,
      selectElement,
      selectConnector,
      armSymbol,
      deleteSelected,
      clearError,
      refreshDiagrams,
      newDiagram,
      openDiagram,
      saveDiagram,
      saveDiagramAs,
      updateDiagram,
      updateEditorSettings,
    ],
  )

  return <DiagramContext.Provider value={value}>{children}</DiagramContext.Provider>
}
