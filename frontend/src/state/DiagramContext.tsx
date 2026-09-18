import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import * as api from '../lib/api'
import * as diagramOps from '../lib/diagramOps'
import type { Diagram, DiagramInfo, ElementSymbol, EditorConfig, EditorSettings, ConnectorKind } from '../types'
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
  const [selectedLabelId, setSelectedLabelIdState] = useState<number | null>(null)
  const [selectedDigitalDeviceId, setSelectedDigitalDeviceIdState] = useState<number | null>(null)
  const [armedSymbol, setArmedSymbolState] = useState<ElementSymbol | null>(null)
  const [armedWireKind, setArmedWireKindState] = useState<ConnectorKind | null>(null)
  const [armedLabel, setArmedLabelState] = useState(false)
  const [armedDigitalDevice, setArmedDigitalDeviceState] = useState(false)
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

  // Keeps the browser tab title in sync with whichever diagram is open —
  // the same "*" dirty marker FilePanel's own Save button already shows,
  // so an unsaved change is visible even when that panel isn't.
  useEffect(() => {
    document.title = diagramName ? `${diagramName}${dirty ? ' *' : ''} — SLD Editor` : 'SLD Editor'
  }, [diagramName, dirty])

  const clearSelection = useCallback(() => {
    setSelectedElementIdState(null)
    setSelectedElementIds(new Set())
    setSelectedConnectorIdState(null)
    setSelectedLabelIdState(null)
    setSelectedDigitalDeviceIdState(null)
  }, [])

  // Deliberately doesn't touch armedWireKind (unlike armedSymbol): a route
  // start is a tight-radius terminal hit (findConnectionTarget), so a
  // slightly-off click meant to hit a terminal very often lands on the
  // element's own much wider hit target instead and selects it as a plain
  // click would — if that cleared the arm too, every near-miss would force
  // re-opening the palette and re-arming, which is exactly what made this
  // unusable before. armedWireKind only ever clears via armSymbol/
  // armWireKind themselves, Canvas's own Esc handler, or a route actually
  // completing (Canvas, once it does).
  const selectElement = useCallback((id: number | null) => {
    setSelectedElementIdState(id)
    setSelectedElementIds(id === null ? new Set() : new Set([id]))
    setSelectedConnectorIdState(null)
    setSelectedLabelIdState(null)
    setSelectedDigitalDeviceIdState(null)
    setArmedSymbolState(null)
  }, [])

  const selectConnector = useCallback((id: number | null) => {
    setSelectedConnectorIdState(id)
    setSelectedElementIdState(null)
    setSelectedElementIds(new Set())
    setSelectedLabelIdState(null)
    setSelectedDigitalDeviceIdState(null)
    setArmedSymbolState(null)
  }, [])

  const selectLabel = useCallback((id: number | null) => {
    setSelectedLabelIdState(id)
    setSelectedElementIdState(null)
    setSelectedElementIds(new Set())
    setSelectedConnectorIdState(null)
    setSelectedDigitalDeviceIdState(null)
    setArmedSymbolState(null)
  }, [])

  const selectDigitalDevice = useCallback((id: number | null) => {
    setSelectedDigitalDeviceIdState(id)
    setSelectedElementIdState(null)
    setSelectedElementIds(new Set())
    setSelectedConnectorIdState(null)
    setSelectedLabelIdState(null)
    setArmedSymbolState(null)
  }, [])

  const armSymbol = useCallback((symbol: ElementSymbol | null) => {
    setArmedSymbolState(symbol)
    setArmedWireKindState(null)
    setArmedLabelState(false)
    setArmedDigitalDeviceState(false)
    setSelectedElementIdState(null)
    setSelectedElementIds(new Set())
    setSelectedConnectorIdState(null)
    setSelectedLabelIdState(null)
    setSelectedDigitalDeviceIdState(null)
  }, [])

  // A wire kind "armed" from the Elements palette's own Wires section
  // (mutually exclusive with armedSymbol/selection, same as arming an
  // equipment symbol) — the routing tool's next completed route uses it
  // instead of the default 'BusWork', then Canvas clears it back to null
  // itself once that route finishes, single-shot just like armedSymbol.
  const armWireKind = useCallback((kind: ConnectorKind | null) => {
    setArmedWireKindState(kind)
    setArmedSymbolState(null)
    setArmedLabelState(false)
    setArmedDigitalDeviceState(false)
    setSelectedElementIdState(null)
    setSelectedElementIds(new Set())
    setSelectedConnectorIdState(null)
    setSelectedLabelIdState(null)
    setSelectedDigitalDeviceIdState(null)
  }, [])

  // The Elements panel's own "Text" button — click-to-place a standalone
  // Label, mutually exclusive with armedSymbol/armedWireKind/armedDigitalDevice/
  // selection the same way arming either of those already is.
  const armLabel = useCallback((armed: boolean) => {
    setArmedLabelState(armed)
    setArmedSymbolState(null)
    setArmedWireKindState(null)
    setArmedDigitalDeviceState(false)
    setSelectedElementIdState(null)
    setSelectedElementIds(new Set())
    setSelectedConnectorIdState(null)
    setSelectedLabelIdState(null)
    setSelectedDigitalDeviceIdState(null)
  }, [])

  // The Elements panel's own "Digital device" button — click-to-place a
  // shape-134 SCADA readout, mutually exclusive with
  // armedSymbol/armedWireKind/armedLabel/selection the same way arming any
  // of those already is.
  const armDigitalDevice = useCallback((armed: boolean) => {
    setArmedDigitalDeviceState(armed)
    setArmedSymbolState(null)
    setArmedWireKindState(null)
    setArmedLabelState(false)
    setSelectedElementIdState(null)
    setSelectedElementIds(new Set())
    setSelectedConnectorIdState(null)
    setSelectedLabelIdState(null)
    setSelectedDigitalDeviceIdState(null)
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
      setSelectedLabelIdState(null)
      setSelectedDigitalDeviceIdState(null)
      setArmedSymbolState(null)
    },
    [selectedElementIds],
  )

  // defaultVoltageName: an optional server voltage-color preset (by name,
  // from the New Diagram dialog) to seed this brand-new diagram with —
  // added as its first VoltageClass and recorded as Editor.DefaultVoltage,
  // then saved immediately (a second write right after the initial create)
  // so the very first .xml on disk already carries it, not just an
  // in-memory, still-dirty value waiting on the user's next explicit Save.
  const newDiagram = useCallback(
    async (name: string, width?: number, height?: number, defaultVoltageName?: string) => {
      const { diagram: created, warning } = await api.createDiagram(name, width, height)
      let d = created
      const preset = defaultVoltageName ? config?.voltageColors.find(v => v.name === defaultVoltageName) : undefined
      if (preset) {
        d = diagramOps.addVoltageClass(d, preset.name, preset.color)
        const voltageClass = d.voltageClasses[d.voltageClasses.length - 1]
        d = { ...d, editor: { ...d.editor, defaultVoltage: voltageClass.id } }
      }
      setDiagramName(name)
      setDiagram(d)
      setDirty(false)
      setDefaultVoltage(d.editor?.defaultVoltage)
      clearSelection()
      setError(warning ?? null)
      await refreshDiagrams()
      if (preset) {
        const saved = await api.saveDiagram(name, d)
        setDiagram(saved.diagram)
        setError(saved.warning ?? null)
      }
    },
    [refreshDiagrams, clearSelection, config],
  )

  const openDiagram = useCallback(
    async (name: string) => {
      const raw = await api.getDiagram(name)
      const d = diagramOps.ensureLastId(raw)
      setDiagramName(name)
      setDiagram(d)
      // ensureLastId returns the same object reference when it found
      // nothing to backfill (see its own doc comment) — a genuine
      // backfill (a missing lastId, or a legacy label still sharing id 0
      // with every other one) needs to reach disk, not just this
      // in-memory session, so it's flagged dirty the same as any other
      // edit rather than silently staying fixed only until the tab closes.
      setDirty(d !== raw)
      setDefaultVoltage(d.editor?.defaultVoltage)
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
    } else if (selectedLabelId !== null) {
      const id = selectedLabelId
      updateDiagram(d => diagramOps.removeLabel(d, id))
      clearSelection()
    } else if (selectedDigitalDeviceId !== null) {
      const id = selectedDigitalDeviceId
      updateDiagram(d => diagramOps.removeDigitalDevice(d, id))
      clearSelection()
    }
  }, [
    selectedElementIds,
    selectedConnectorId,
    selectedLabelId,
    selectedDigitalDeviceId,
    updateDiagram,
    clearSelection,
  ])

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
      selectedLabelId,
      selectedDigitalDeviceId,
      armedSymbol,
      armedWireKind,
      armedLabel,
      armedDigitalDevice,
      defaultVoltage,
      setDefaultVoltage,
      selectElement,
      selectConnector,
      selectLabel,
      selectDigitalDevice,
      armSymbol,
      armWireKind,
      armLabel,
      armDigitalDevice,
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
      selectedLabelId,
      selectedDigitalDeviceId,
      armedSymbol,
      armedWireKind,
      armedLabel,
      armedDigitalDevice,
      defaultVoltage,
      setDefaultVoltage,
      selectElement,
      selectConnector,
      selectLabel,
      selectDigitalDevice,
      armSymbol,
      armWireKind,
      armLabel,
      armDigitalDevice,
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
