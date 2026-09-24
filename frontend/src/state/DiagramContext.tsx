import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import * as api from '../lib/api'
import * as diagramOps from '../lib/diagramOps'
import { baseName, parentDir } from '../lib/diagramPath'
import { diagramFileKind, stripDiagramExtension } from '../lib/fileTransfer'
import { t } from '../i18n'
import type {
  Diagram,
  DiagramEntry,
  ElementSymbol,
  EditorConfig,
  EditorSettings,
  ConnectorKind,
} from '../types'
import { DiagramContext, type DiagramContextValue, type ImportLog, type PendingImport, type SelectionKind } from './useDiagramContext'

export function DiagramProvider({ children }: { children: ReactNode }) {
  const [diagramName, setDiagramName] = useState<string | null>(null)
  const [diagram, setDiagram] = useState<Diagram | null>(null)
  const [dirty, setDirty] = useState(false)
  const [currentDir, setCurrentDir] = useState('')
  const [diagrams, setDiagrams] = useState<DiagramEntry[]>([])
  const [elements, setElements] = useState<ElementSymbol[]>([])
  const [config, setConfig] = useState<EditorConfig | null>(null)
  const [selectedElementId, setSelectedElementIdState] = useState<number | null>(null)
  const [selection, setSelection] = useState<Map<number, SelectionKind>>(new Map())
  const [selectedConnectorId, setSelectedConnectorIdState] = useState<number | null>(null)
  const [selectedLabelId, setSelectedLabelIdState] = useState<number | null>(null)
  const [selectedDigitalDeviceId, setSelectedDigitalDeviceIdState] = useState<number | null>(null)
  const [armedSymbol, setArmedSymbolState] = useState<ElementSymbol | null>(null)
  const [armedWireKind, setArmedWireKindState] = useState<ConnectorKind | null>(null)
  const [armedLabel, setArmedLabelState] = useState(false)
  const [armedDigitalDevice, setArmedDigitalDeviceState] = useState(false)
  const [defaultVoltage, setDefaultVoltage] = useState<number | undefined>(undefined)
  const [importLog, setImportLog] = useState<ImportLog | null>(null)
  const [importLogOpen, setImportLogOpen] = useState(false)
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Navigates the File panel's own folder browser to dir (a folder row's
  // own full path, ".."'s parentDir(currentDir), or a just-opened/-saved
  // diagram's own containing folder) and re-fetches its immediate
  // contents. The one place diagrams/currentDir are ever both set, so
  // they can never drift apart the way two separate setters could.
  const browseDir = useCallback(async (dir: string) => {
    const entries = await api.listDiagrams(dir)
    setCurrentDir(dir)
    setDiagrams(entries ?? [])
  }, [])

  useEffect(() => {
    browseDir('').catch(e => setError((e as Error).message))
    api
      .listElements()
      .then(els => setElements(els ?? []))
      .catch(e => setError((e as Error).message))
    api.getConfig().then(setConfig).catch(e => setError((e as Error).message))
  }, [browseDir])

  // Keeps the browser tab title in sync with whichever diagram is open —
  // the same "*" dirty marker FilePanel's own Save button already shows,
  // so an unsaved change is visible even when that panel isn't.
  useEffect(() => {
    document.title = diagramName ? `${diagramName}${dirty ? ' *' : ''} — SLD Editor` : 'SLD Editor'
  }, [diagramName, dirty])

  const clearSelection = useCallback(() => {
    setSelectedElementIdState(null)
    setSelection(new Map())
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
    setSelection(id === null ? new Map() : new Map([[id, 'element']]))
    setSelectedConnectorIdState(null)
    setSelectedLabelIdState(null)
    setSelectedDigitalDeviceIdState(null)
    setArmedSymbolState(null)
  }, [])

  const selectConnector = useCallback((id: number | null) => {
    setSelectedConnectorIdState(id)
    setSelection(id === null ? new Map() : new Map([[id, 'connector']]))
    setSelectedElementIdState(null)
    setSelectedLabelIdState(null)
    setSelectedDigitalDeviceIdState(null)
    setArmedSymbolState(null)
  }, [])

  const selectLabel = useCallback((id: number | null) => {
    setSelectedLabelIdState(id)
    setSelection(id === null ? new Map() : new Map([[id, 'label']]))
    setSelectedElementIdState(null)
    setSelectedConnectorIdState(null)
    setSelectedDigitalDeviceIdState(null)
    setArmedSymbolState(null)
  }, [])

  const selectDigitalDevice = useCallback((id: number | null) => {
    setSelectedDigitalDeviceIdState(id)
    setSelection(id === null ? new Map() : new Map([[id, 'digitaldevice']]))
    setSelectedElementIdState(null)
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
    setSelection(new Map())
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
    setSelection(new Map())
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
    setSelection(new Map())
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
    setSelection(new Map())
    setSelectedConnectorIdState(null)
    setSelectedLabelIdState(null)
    setSelectedDigitalDeviceIdState(null)
  }, [])

  // Shift-click: toggles one {id, kind} entry in/out of the mixed
  // multi-selection instead of replacing it. The matching single-id field
  // (selectedElementId/selectedConnectorId/selectedLabelId/
  // selectedDigitalDeviceId) is updated to whichever id was just toggled,
  // for whenever the selection lands back down to exactly one entry —
  // Properties' single-item editor and busbar point handles ignore it
  // while the selection holds more than one entry regardless, so which
  // stale value the OTHER three single-id fields hold in that case doesn't
  // matter — see selection's own doc comment.
  const toggleSelection = useCallback(
    (id: number, kind: SelectionKind) => {
      const next = new Map(selection)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.set(id, kind)
      }
      setSelection(next)

      if (next.size === 0) {
        setSelectedElementIdState(null)
        setSelectedConnectorIdState(null)
        setSelectedLabelIdState(null)
        setSelectedDigitalDeviceIdState(null)
      } else if (next.size === 1) {
        const [[onlyId, onlyKind]] = next
        setSelectedElementIdState(onlyKind === 'element' ? onlyId : null)
        setSelectedConnectorIdState(onlyKind === 'connector' ? onlyId : null)
        setSelectedLabelIdState(onlyKind === 'label' ? onlyId : null)
        setSelectedDigitalDeviceIdState(onlyKind === 'digitaldevice' ? onlyId : null)
      } else {
        // More than one entry remains — Properties/Canvas's own
        // single-item features already ignore these once the selection
        // holds more than one entry, so just point the matching kind's
        // field at whichever id was just toggled, the same "don't-care
        // beyond size 1" behavior the old per-element-only toggle had.
        if (kind === 'element') setSelectedElementIdState(id)
        if (kind === 'connector') setSelectedConnectorIdState(id)
        if (kind === 'label') setSelectedLabelIdState(id)
        if (kind === 'digitaldevice') setSelectedDigitalDeviceIdState(id)
      }
      setArmedSymbolState(null)
    },
    [selection],
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
      setImportLog(null)
      setImportLogOpen(false)
      setError(warning ?? null)
      await browseDir(parentDir(name))
      if (preset) {
        const saved = await api.saveDiagram(name, d)
        setDiagram(saved.diagram)
        setError(saved.warning ?? null)
      }
    },
    [browseDir, clearSelection, config],
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
      setImportLog(null)
      setImportLogOpen(false)
      // Keeps the File panel's own browser showing wherever this diagram
      // actually lives — most often a no-op re-fetch of the folder it was
      // just opened from, but also correct if openDiagram is ever called
      // some other way (e.g. a future "recent files" list).
      await browseDir(parentDir(name))
    },
    [clearSelection, browseDir],
  )

  // fileName is the dropped/picked file's own name: its extension picks the
  // import path (.xml parsed as-is, .svg reconstructed via slddoc.Extract),
  // and, stripped, it's used as-is as the diagram name — so a subsequent
  // Save just writes/overwrites the server's own copy under that name (same
  // upsert semantics saveDiagramAs already has) rather than requiring a
  // separate Save As first. An .svg import additionally records its own
  // report as importLog (and opens the import log dialog), and — since
  // Extract never sets one — defaults editor.defaultVoltage to whichever
  // extracted voltage class the diagram uses most (mostUsedVoltage).
  const loadDiagramFromFile = useCallback(
    async (text: string, fileName: string) => {
      const kind = diagramFileKind(fileName)
      if (!kind) throw new Error(t('file.invalidDiagramFile', { name: fileName }))
      let raw: Diagram
      let log: ImportLog | null = null
      if (kind === 'svg') {
        const { diagram: extracted, report } = await api.importDiagramSVG(text)
        raw = extracted
        log = { fileName, report }
        const voltage = diagramOps.mostUsedVoltage(extracted)
        if (voltage !== undefined && extracted.editor?.defaultVoltage === undefined) {
          raw = { ...extracted, editor: { ...extracted.editor, defaultVoltage: voltage } }
        }
      } else {
        raw = await api.importDiagramXML(text)
      }
      const d = diagramOps.ensureLastId(raw)
      const suggestedName = stripDiagramExtension(fileName)
      setDiagramName(suggestedName)
      setDiagram(d)
      setDirty(true)
      setDefaultVoltage(d.editor?.defaultVoltage)
      clearSelection()
      setError(null)
      setImportLog(log)
      setImportLogOpen(log !== null)
      await browseDir(parentDir(suggestedName))
    },
    [clearSelection, browseDir],
  )

  // importDiagramFile is what a drop/pick actually calls: it checks
  // whether a diagram already exists on the server under the name the
  // import would take (the same path the next Save writes — see
  // loadDiagramFromFile) and, if so, parks the file as pendingImport for
  // ConfirmReloadDialog to ask "Reload or not" instead of loading it
  // straight away; otherwise it loads immediately.
  const importDiagramFile = useCallback(
    async (text: string, fileName: string) => {
      if (!diagramFileKind(fileName)) throw new Error(t('file.invalidDiagramFile', { name: fileName }))
      const name = stripDiagramExtension(fileName)
      const siblings = await api.listDiagrams(parentDir(name))
      if (siblings.some(e => !e.isDir && e.name === baseName(name))) {
        setPendingImport({ text, fileName, name })
        return
      }
      await loadDiagramFromFile(text, fileName)
    },
    [loadDiagramFromFile],
  )

  // Loads the parked pendingImport ("Reload") — cleared only once that
  // succeeds, so a failure leaves ConfirmReloadDialog open to show it.
  const confirmPendingImport = useCallback(async () => {
    if (!pendingImport) return
    await loadDiagramFromFile(pendingImport.text, pendingImport.fileName)
    setPendingImport(null)
  }, [pendingImport, loadDiagramFromFile])

  const cancelPendingImport = useCallback(() => setPendingImport(null), [])

  const saveDiagram = useCallback(async () => {
    if (!diagramName || !diagram) return
    const { diagram: d, warning } = await api.saveDiagram(diagramName, diagram)
    setDiagram(d)
    setDirty(false)
    setError(warning ?? null)
    await browseDir(currentDir)
  }, [diagramName, diagram, browseDir, currentDir])

  const saveDiagramAs = useCallback(
    async (name: string) => {
      if (!diagram) return
      const { diagram: d, warning } = await api.saveDiagram(name, diagram)
      setDiagramName(name)
      setDiagram(d)
      setDirty(false)
      setError(warning ?? null)
      await browseDir(parentDir(name))
    },
    [diagram, browseDir],
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

  // Dispatches every entry in the current mixed selection to the right
  // remove function in one updateDiagram call, so deleting a group that
  // mixes kinds (e.g. an element plus a wire plus a text label) is one
  // atomic diagram change rather than one per kind.
  const deleteSelected = useCallback(() => {
    if (selection.size === 0) return
    const entries = [...selection]
    updateDiagram(d =>
      entries.reduce((acc, [id, kind]) => {
        switch (kind) {
          case 'element':
            return diagramOps.removeElement(acc, id)
          case 'connector':
            return diagramOps.removeConnector(acc, id)
          case 'label':
            return diagramOps.removeLabel(acc, id)
          case 'digitaldevice':
            return diagramOps.removeDigitalDevice(acc, id)
        }
      }, d),
    )
    clearSelection()
  }, [selection, updateDiagram, clearSelection])

  const clearError = useCallback(() => setError(null), [])

  const value = useMemo<DiagramContextValue>(
    () => ({
      diagramName,
      diagram,
      dirty,
      currentDir,
      diagrams,
      browseDir,
      elements,
      config,
      error,
      selectedElementId,
      selection,
      toggleSelection,
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
      newDiagram,
      openDiagram,
      loadDiagramFromFile,
      importDiagramFile,
      pendingImport,
      confirmPendingImport,
      cancelPendingImport,
      importLog,
      importLogOpen,
      setImportLogOpen,
      saveDiagram,
      saveDiagramAs,
      updateDiagram,
      updateEditorSettings,
    }),
    [
      diagramName,
      diagram,
      dirty,
      currentDir,
      diagrams,
      browseDir,
      elements,
      config,
      error,
      selectedElementId,
      selection,
      toggleSelection,
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
      newDiagram,
      openDiagram,
      loadDiagramFromFile,
      importDiagramFile,
      pendingImport,
      confirmPendingImport,
      cancelPendingImport,
      importLog,
      importLogOpen,
      setImportLogOpen,
      saveDiagram,
      saveDiagramAs,
      updateDiagram,
      updateEditorSettings,
    ],
  )

  return <DiagramContext.Provider value={value}>{children}</DiagramContext.Provider>
}
