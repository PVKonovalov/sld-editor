import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import * as api from '../lib/api'
import * as diagramOps from '../lib/diagramOps'
import { baseName, joinDiagramPath, parentDir } from '../lib/diagramPath'
import { diagramFileKind, stripDiagramExtension } from '../lib/fileTransfer'
import { prepareImport } from '../lib/importDiagram'
import { deleteDraft, getDraft, listDrafts, putDraft, type Draft } from '../lib/drafts'
import { t } from '../i18n'
import type {
  Diagram,
  DiagramEntry,
  CustomElement,
  ElementSymbol,
  EditorConfig,
  EditorSettings,
  ConnectorKind,
} from '../types'
import {
  DiagramContext,
  type BatchImport,
  type BatchImportItem,
  type DiagramContextValue,
  type DraftInfo,
  type ImportFile,
  type ImportLog,
  type PendingImport,
  type SelectionKind,
  type UnsavedChoice,
} from './useDiagramContext'

// importTargetName is the server path a dropped/picked file is imported
// under: the File panel's current folder joined with the file's own name
// minus its .xsld/.svg extension.
function importTargetName(dir: string, fileName: string): string {
  return joinDiagramPath(dir, stripDiagramExtension(fileName))
}

// How many undo steps are kept.
const UNDO_LIMIT = 100
// Edits in the same form field less than this apart are one undo step.
const FIELD_COALESCE_MS = 1000

// The form field being edited (focused), whose successive changes coalesce
// into one undo step; null for anything else (canvas, buttons, checkboxes).
function editingField(): Element | null {
  const el = document.activeElement
  if (el instanceof HTMLTextAreaElement) return el
  if (el instanceof HTMLInputElement && el.type !== 'checkbox' && el.type !== 'radio') return el
  return null
}

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
  const [customElements, setCustomElements] = useState<CustomElement[]>([])
  const [armedCustomElement, setArmedCustomElementState] = useState<CustomElement | null>(null)
  const [defaultVoltage, setDefaultVoltage] = useState<number | undefined>(undefined)
  const [importLog, setImportLog] = useState<ImportLog | null>(null)
  const [importLogOpen, setImportLogOpen] = useState(false)
  const [defaultVoltagePromptOpen, setDefaultVoltagePromptOpen] = useState(false)
  const [batchImport, setBatchImport] = useState<BatchImport | null>(null)
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Recovery drafts (lib/drafts.ts) offered by DraftRecoveryDialog, and the
  // "Save / Don't save / Cancel" question UnsavedChangesDialog asks before
  // unsaved edits would be replaced (see confirmLeave).
  // Layers hidden on the canvas: a view preference for this session only,
  // never saved and never affecting export.
  const [hiddenLayers, setHiddenLayers] = useState<ReadonlySet<number>>(new Set())
  const [recoverableDrafts, setRecoverableDrafts] = useState<DraftInfo[]>([])
  const [unsavedPrompt, setUnsavedPrompt] = useState<{ diagramName: string } | null>(null)
  const unsavedResolverRef = useRef<((proceed: boolean) => void) | null>(null)

  // The diagram exactly as openDiagram loaded it. Opening can already mark
  // a diagram dirty (a topology repair or id backfill that ought to reach
  // disk), but that is not the user's work: leaving it unsaved loses
  // nothing, since the next open repairs it again. So only a diagram that
  // differs from this one counts as having unsaved edits. null after an
  // import, whose whole content is unsaved.
  const openedRef = useRef<Diagram | null>(null)
  // Undo/redo history: whole Diagram snapshots, cheap because every edit is
  // an immutable diagramOps function that keeps untouched entries' object
  // references. diagramRef mirrors the diagram state synchronously (set
  // only through commitDiagram), so updateDiagram can apply its updater
  // outside a setState callback, where StrictMode would run it twice, and
  // record the diagram it replaced. cleanRef is the diagram as last
  // opened or saved: undoing or redoing back to it clears the dirty flag.
  const diagramRef = useRef<Diagram | null>(null)
  const cleanRef = useRef<Diagram | null>(null)
  const historyRef = useRef<{
    undo: Diagram[]
    redo: Diagram[]
    // Coalescing: edits made in the same task (one user action calling
    // updateDiagram more than once) are one step, and so are edits made
    // in quick succession while the same form field has focus (typing a
    // name, dragging a colour picker).
    sameTask: boolean
    field: Element | null
    fieldTime: number
  }>({ undo: [], redo: [], sameTask: false, field: null, fieldTime: 0 })
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  const syncHistoryFlags = useCallback(() => {
    setCanUndo(historyRef.current.undo.length > 0)
    setCanRedo(historyRef.current.redo.length > 0)
  }, [])

  // Every write of the diagram state goes through here. reset starts a new
  // history (another diagram replaced this one), clean marks d as the
  // version on disk (or null when nothing on disk matches it).
  const commitDiagram = useCallback(
    (d: Diagram | null, opts?: { reset?: boolean; clean?: Diagram | null }) => {
      diagramRef.current = d
      setDiagram(d)
      if (opts?.clean !== undefined) cleanRef.current = opts.clean
      if (opts?.reset) {
        historyRef.current = { undo: [], redo: [], sameTask: false, field: null, fieldTime: 0 }
        syncHistoryFlags()
      }
    },
    [syncHistoryFlags],
  )

  const latestRef = useRef({ diagramName, diagram, dirty })
  latestRef.current = { diagramName, diagram, dirty }
  const hasUnsavedEdits = useCallback(() => {
    const { diagram: d, dirty: isDirty } = latestRef.current
    return isDirty && d !== null && d !== openedRef.current
  }, [])

  // Navigates the File panel's own folder browser to dir (a folder row's
  // own full path, ".."'s parentDir(currentDir), or a just-opened/-saved
  // diagram's own containing folder) and re-fetches its immediate
  // contents. The one place diagrams/currentDir are ever both set, so
  // they can never drift apart the way two separate setters could.
  const browseDir = useCallback(async (dir: string) => {
    const entries = (await api.listDiagrams(dir)) ?? []
    setCurrentDir(dir)
    setDiagrams(entries)
    return entries
  }, [])

  useEffect(() => {
    browseDir('').catch(e => setError((e as Error).message))
    api
      .listElements()
      .then(els => setElements(els ?? []))
      .catch(e => setError((e as Error).message))
    api.getConfig().then(setConfig).catch(e => setError((e as Error).message))
    api
      .listCustomElements()
      .then(setCustomElements)
      .catch(e => setError((e as Error).message))
  }, [browseDir])

  // A draft is still worth offering only if its diagram was not saved after
  // it was written (or has never been saved at all, e.g. an import). A stale
  // one is deleted.
  const draftIsCurrent = useCallback(async (draft: Draft, entries?: DiagramEntry[]) => {
    const siblings = entries ?? (await api.listDiagrams(parentDir(draft.name))) ?? []
    const file = siblings.find(e => !e.isDir && e.name === baseName(draft.name))
    if (file && Date.parse(file.modTime) >= draft.savedAt) {
      void deleteDraft(draft.name)
      return false
    }
    return true
  }, [])

  // On startup, offer every draft left behind by a session that ended with
  // unsaved edits.
  useEffect(() => {
    listDrafts()
      .then(async drafts => {
        const current: DraftInfo[] = []
        for (const draft of drafts) {
          if (await draftIsCurrent(draft)) current.push({ name: draft.name, savedAt: draft.savedAt })
        }
        if (current.length > 0) setRecoverableDrafts(current.sort((a, b) => b.savedAt - a.savedAt))
      })
      .catch(e => console.warn('sld-editor: draft recovery:', e))
  }, [draftIsCurrent])

  // Writes a recovery draft a second after the last edit.
  useEffect(() => {
    if (!diagramName || !diagram || !dirty || diagram === openedRef.current) return
    const name = diagramName
    const handle = setTimeout(() => void putDraft(name, diagram), 1000)
    return () => clearTimeout(handle)
  }, [diagramName, diagram, dirty])

  // Closing or reloading the tab with unsaved edits asks first (the browser
  // shows its own generic prompt).
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (!hasUnsavedEdits()) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [hasUnsavedEdits])

  // Resolves to true when the open diagram may be replaced: right away if
  // it has no unsaved edits, otherwise once UnsavedChangesDialog's Save or
  // Don't save has run (false on Cancel).
  const confirmLeave = useCallback((): Promise<boolean> => {
    if (!hasUnsavedEdits()) return Promise.resolve(true)
    return new Promise(resolve => {
      unsavedResolverRef.current = resolve
      setUnsavedPrompt({ diagramName: latestRef.current.diagramName ?? '' })
    })
  }, [hasUnsavedEdits])

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

  // Hiding a layer drops whatever it holds from the selection, since its
  // items can no longer be seen or picked.
  const setLayerHidden = useCallback(
    (layer: number, hidden: boolean) => {
      setHiddenLayers(prev => {
        const next = new Set(prev)
        if (hidden) next.add(layer)
        else next.delete(layer)
        return next
      })
      if (!hidden || !diagram) return
      const onLayer = new Set<number>()
      for (const list of [diagram.elements, diagram.connectors, diagram.labels, diagram.digitalDevices])
        for (const x of list) if (x.layer === layer) onLayer.add(x.id)
      if ([...selection.keys()].some(id => onLayer.has(id))) clearSelection()
    },
    [diagram, selection, clearSelection],
  )

  // Every diagram starts with all of its layers shown.
  useEffect(() => setHiddenLayers(new Set()), [diagramName])

  const [findQuery, setFindQuery] = useState('')
  const [findType, setFindType] = useState('')
  const setFind = useCallback((query: string, type: string) => {
    setFindQuery(query)
    setFindType(type)
  }, [])
  useEffect(() => setFind('', ''), [diagramName, setFind])
  const [findFocusSeq, setFindFocusSeq] = useState(0)
  const requestFind = useCallback(() => setFindFocusSeq(n => n + 1), [])
  const [focusRequest, setFocusRequest] = useState<{ id: number; kind: SelectionKind; seq: number } | null>(null)
  const focusItem = useCallback(
    (id: number, kind: SelectionKind) => setFocusRequest(prev => ({ id, kind, seq: (prev?.seq ?? 0) + 1 })),
    [],
  )

  // Drops selected ids an edit removed (or a newly opened diagram doesn't
  // have), so the selection never points at an item that isn't there.
  useEffect(() => {
    if (selection.size === 0) return
    const ids = new Set<number>()
    if (diagram)
      for (const list of [diagram.elements, diagram.connectors, diagram.labels, diagram.digitalDevices])
        for (const x of list) ids.add(x.id)
    const kept = new Map([...selection].filter(([id]) => ids.has(id)))
    if (kept.size === selection.size) return
    const only = kept.size === 1 ? [...kept][0] : null
    setSelection(kept)
    setSelectedElementIdState(only && only[1] === 'element' ? only[0] : null)
    setSelectedConnectorIdState(only && only[1] === 'connector' ? only[0] : null)
    setSelectedLabelIdState(only && only[1] === 'label' ? only[0] : null)
    setSelectedDigitalDeviceIdState(only && only[1] === 'digitaldevice' ? only[0] : null)
  }, [diagram, selection])

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
    setArmedCustomElementState(null)
  }, [])

  const selectConnector = useCallback((id: number | null) => {
    setSelectedConnectorIdState(id)
    setSelection(id === null ? new Map() : new Map([[id, 'connector']]))
    setSelectedElementIdState(null)
    setSelectedLabelIdState(null)
    setSelectedDigitalDeviceIdState(null)
    setArmedSymbolState(null)
    setArmedCustomElementState(null)
  }, [])

  const selectLabel = useCallback((id: number | null) => {
    setSelectedLabelIdState(id)
    setSelection(id === null ? new Map() : new Map([[id, 'label']]))
    setSelectedElementIdState(null)
    setSelectedConnectorIdState(null)
    setSelectedDigitalDeviceIdState(null)
    setArmedSymbolState(null)
    setArmedCustomElementState(null)
  }, [])

  const selectDigitalDevice = useCallback((id: number | null) => {
    setSelectedDigitalDeviceIdState(id)
    setSelection(id === null ? new Map() : new Map([[id, 'digitaldevice']]))
    setSelectedElementIdState(null)
    setSelectedConnectorIdState(null)
    setSelectedLabelIdState(null)
    setArmedSymbolState(null)
    setArmedCustomElementState(null)
  }, [])

  const armSymbol = useCallback((symbol: ElementSymbol | null) => {
    setArmedSymbolState(symbol)
    setArmedWireKindState(null)
    setArmedLabelState(false)
    setArmedDigitalDeviceState(false)
    setArmedCustomElementState(null)
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
    setArmedCustomElementState(null)
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
    setArmedCustomElementState(null)
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
    setArmedCustomElementState(null)
    setSelectedElementIdState(null)
    setSelection(new Map())
    setSelectedConnectorIdState(null)
    setSelectedLabelIdState(null)
    setSelectedDigitalDeviceIdState(null)
  }, [])

  // The Elements panel's "Custom elements" group — click-to-place a copy of
  // a whole predefined diagram fragment (diagramOps.placeCustomElement),
  // mutually exclusive with every other arm/selection the same way.
  const armCustomElement = useCallback((custom: CustomElement | null) => {
    setArmedCustomElementState(custom)
    setArmedSymbolState(null)
    setArmedWireKindState(null)
    setArmedLabelState(false)
    setArmedDigitalDeviceState(false)
    setSelectedElementIdState(null)
    setSelection(new Map())
    setSelectedConnectorIdState(null)
    setSelectedLabelIdState(null)
    setSelectedDigitalDeviceIdState(null)
  }, [])

  const selectMany = useCallback((entries: Map<number, SelectionKind>) => {
    const only = entries.size === 1 ? [...entries][0] : null
    setSelection(new Map(entries))
    setSelectedElementIdState(only && only[1] === 'element' ? only[0] : null)
    setSelectedConnectorIdState(only && only[1] === 'connector' ? only[0] : null)
    setSelectedLabelIdState(only && only[1] === 'label' ? only[0] : null)
    setSelectedDigitalDeviceIdState(only && only[1] === 'digitaldevice' ? only[0] : null)
    setArmedSymbolState(null)
    setArmedCustomElementState(null)
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
  // so the very first .xsld on disk already carries it, not just an
  // in-memory, still-dirty value waiting on the user's next explicit Save.
  const newDiagramNow = useCallback(
    async (name: string, width?: number, height?: number, defaultVoltageName?: string) => {
      const { diagram: created, warning } = await api.createDiagram(name, width, height)
      let d = created
      const preset = defaultVoltageName ? config?.voltageColors.find(v => v.name === defaultVoltageName) : undefined
      if (preset) {
        d = diagramOps.addVoltageClass(d, preset.name, preset.color)
        const voltageClass = d.voltageClasses[d.voltageClasses.length - 1]
        d = { ...d, editor: { ...d.editor, defaultVoltage: voltageClass.id } }
      }
      void deleteDraft(name)
      openedRef.current = d
      setDiagramName(name)
      commitDiagram(d, { reset: true, clean: preset ? null : d })
      setDirty(false)
      setDefaultVoltage(d.editor?.defaultVoltage)
      clearSelection()
      setImportLog(null)
      setImportLogOpen(false)
      setDefaultVoltagePromptOpen(false)
      setError(warning ?? null)
      await browseDir(parentDir(name))
      if (preset) {
        const saved = await api.saveDiagram(name, d)
        commitDiagram(saved.diagram, { reset: true, clean: saved.diagram })
        setError(saved.warning ?? null)
      }
    },
    [browseDir, clearSelection, config, commitDiagram],
  )

  const openDiagramNow = useCallback(
    async (name: string) => {
      const raw = await api.getDiagram(name)
      // Both return the same reference when there's nothing to fix, so
      // d !== raw below still means "something actually changed".
      const d = diagramOps.normalizeTopology(
        diagramOps.applyPresetVoltageNames(diagramOps.ensureLastId(raw), config),
        elements,
      )
      openedRef.current = d
      setDiagramName(name)
      commitDiagram(d, { reset: true, clean: d === raw ? d : null })
      // ensureLastId returns the same object reference when it found
      // nothing to backfill (see its own doc comment) — a genuine
      // backfill (a missing lastId, or a legacy label still sharing id 0
      // with every other one) needs to reach disk, not just this
      // in-memory session, so it's flagged dirty the same as any other
      // edit rather than silently staying fixed only until the tab closes.
      // The same goes for a voltage class renamed from its preset
      // (applyPresetVoltageNames) and a topology repair (normalizeTopology:
      // missing fixed ports, duplicate ports, zero-length wires).
      setDirty(d !== raw)
      setDefaultVoltage(d.editor?.defaultVoltage)
      clearSelection()
      setImportLog(null)
      setImportLogOpen(false)
      setDefaultVoltagePromptOpen(diagramOps.needsVoltagePrompt(d, config))
      // Keeps the File panel's own browser showing wherever this diagram
      // actually lives — most often a no-op re-fetch of the folder it was
      // just opened from, but also correct if openDiagram is ever called
      // some other way (e.g. a future "recent files" list).
      const entries = await browseDir(parentDir(name))
      // Unsaved edits of this diagram left behind earlier are offered again.
      const draft = await getDraft(name)
      if (draft && (await draftIsCurrent(draft, entries))) {
        setRecoverableDrafts([{ name: draft.name, savedAt: draft.savedAt }])
      }
    },
    [clearSelection, browseDir, config, elements, draftIsCurrent],
  )

  const newDiagram = useCallback(
    async (name: string, width?: number, height?: number, defaultVoltageName?: string) => {
      if (!(await confirmLeave())) return false
      await newDiagramNow(name, width, height, defaultVoltageName)
      return true
    },
    [confirmLeave, newDiagramNow],
  )

  const openDiagram = useCallback(
    async (name: string) => {
      if (await confirmLeave()) await openDiagramNow(name)
    },
    [confirmLeave, openDiagramNow],
  )

  // Loads a dropped/picked file (see lib/importDiagram's prepareImport for
  // the .xsld/.svg paths) and makes it the working diagram under name — the
  // server path the next Save writes, i.e. the File panel's own current
  // folder joined with the file's name minus its extension (see
  // importTargetName) — marked dirty rather than saved, the same upsert
  // semantics saveDiagramAs already has. An .svg import also records its own
  // report as importLog (and opens the import log dialog).
  const loadDiagramFromFile = useCallback(
    async (text: string, fileName: string, name: string) => {
      const { diagram: d, report } = await prepareImport(text, fileName, config, elements)
      const log: ImportLog | null = report ? { fileName, report } : null
      openedRef.current = null
      setDiagramName(name)
      commitDiagram(d, { reset: true, clean: null })
      setDirty(true)
      setDefaultVoltage(d.editor?.defaultVoltage)
      clearSelection()
      setError(null)
      setImportLog(log)
      setImportLogOpen(log !== null)
      // An .svg import already gets a Default voltage picker in its own
      // import log dialog, so after one this only asks about preset colors,
      // once the import log is closed (App).
      setDefaultVoltagePromptOpen(diagramOps.needsVoltagePrompt(d, config))
      await browseDir(parentDir(name))
    },
    [clearSelection, browseDir, config, elements],
  )

  // importDiagramFile is what a single-file drop/pick calls: it checks
  // whether a diagram already exists on the server under the name the
  // import would take (importTargetName — inside the File panel's current
  // folder) and, if so, parks the file as pendingImport, with that name
  // fixed, for ConfirmReloadDialog to ask "Reload or not"; otherwise it
  // loads immediately.
  const importDiagramFile = useCallback(
    async (text: string, fileName: string) => {
      if (!diagramFileKind(fileName)) throw new Error(t('file.invalidDiagramFile', { name: fileName }))
      if (!(await confirmLeave())) return
      const name = importTargetName(currentDir, fileName)
      const siblings = await api.listDiagrams(parentDir(name))
      if (siblings.some(e => !e.isDir && e.name === baseName(name))) {
        setPendingImport({ text, fileName, name })
        return
      }
      await loadDiagramFromFile(text, fileName, name)
    },
    [loadDiagramFromFile, currentDir, confirmLeave],
  )

  // Loads the parked pendingImport ("Reload") — cleared only once that
  // succeeds, so a failure leaves ConfirmReloadDialog open to show it.
  const confirmPendingImport = useCallback(async () => {
    if (!pendingImport) return
    await loadDiagramFromFile(pendingImport.text, pendingImport.fileName, pendingImport.name)
    setPendingImport(null)
  }, [pendingImport, loadDiagramFromFile])

  // Imports several files at once straight to the server, into dir (the
  // File panel's current folder), without opening any of them — the open
  // diagram stays untouched. Each file is prepared (prepareImport) and saved
  // as dir/<file name>; one that fails doesn't stop the rest. A name that
  // already exists on the server (or was already taken by an earlier file
  // in this same batch) is skipped unless overwrite is set. Returns one
  // BatchImportItem per file, in order.
  const runBatchImport = useCallback(
    async (files: ImportFile[], dir: string, overwrite: boolean): Promise<BatchImportItem[]> => {
      const existing = new Set(
        overwrite ? [] : (await api.listDiagrams(dir)).filter(e => !e.isDir).map(e => e.name),
      )
      const items: BatchImportItem[] = []
      for (const file of files) {
        const name = importTargetName(dir, file.fileName)
        if (!diagramFileKind(file.fileName)) {
          items.push({ fileName: file.fileName, name, status: 'failed', message: t('file.invalidDiagramFile', { name: file.fileName }) })
          continue
        }
        if (existing.has(baseName(name))) {
          items.push({ fileName: file.fileName, name, status: 'skipped' })
          continue
        }
        try {
          const { diagram: d } = await prepareImport(file.text, file.fileName, config, elements)
          const { warning } = await api.saveDiagram(name, d)
          existing.add(baseName(name))
          items.push({ fileName: file.fileName, name, status: 'saved', message: warning })
        } catch (e) {
          items.push({ fileName: file.fileName, name, status: 'failed', message: (e as Error).message })
        }
      }
      return items
    },
    [config, elements],
  )

  const importDiagramFiles = useCallback(
    async (files: ImportFile[]) => {
      const dir = currentDir
      const items = await runBatchImport(files, dir, false)
      setBatchImport({ dir, files, items })
      await browseDir(dir)
    },
    [currentDir, runBatchImport, browseDir],
  )

  // Re-runs just the skipped files of the last batch, overwriting the
  // server's own copies.
  const overwriteBatchSkipped = useCallback(async () => {
    if (!batchImport) return
    const skipped = batchImport.items.filter(i => i.status === 'skipped').map(i => i.fileName)
    const files = batchImport.files.filter(f => skipped.includes(f.fileName))
    const redone = await runBatchImport(files, batchImport.dir, true)
    const byFile = new Map(redone.map(i => [i.fileName, i]))
    setBatchImport({ ...batchImport, items: batchImport.items.map(i => byFile.get(i.fileName) ?? i) })
    await browseDir(batchImport.dir)
  }, [batchImport, runBatchImport, browseDir])

  const cancelPendingImport = useCallback(() => setPendingImport(null), [])
  const closeBatchImport = useCallback(() => setBatchImport(null), [])

  const saveDiagram = useCallback(async () => {
    if (!diagramName || !diagram) return
    const { diagram: d, warning } = await api.saveDiagram(diagramName, diagram)
    void deleteDraft(diagramName)
    commitDiagram(d, { clean: d })
    setDirty(false)
    setError(warning ?? null)
    await browseDir(currentDir)
  }, [diagramName, diagram, browseDir, currentDir, commitDiagram])

  const saveDiagramAs = useCallback(
    async (name: string) => {
      if (!diagram) return
      const { diagram: d, warning } = await api.saveDiagram(name, diagram)
      if (diagramName) void deleteDraft(diagramName)
      void deleteDraft(name)
      setDiagramName(name)
      commitDiagram(d, { clean: d })
      setDirty(false)
      setError(warning ?? null)
      await browseDir(parentDir(name))
    },
    [diagram, diagramName, browseDir, commitDiagram],
  )

  const updateDiagram = useCallback(
    (updater: (d: Diagram) => Diagram) => {
      const prev = diagramRef.current
      if (!prev) return
      const next = updater(prev)
      if (next === prev) return
      const h = historyRef.current
      const field = editingField()
      const now = Date.now()
      const coalesce = h.sameTask || (field !== null && field === h.field && now - h.fieldTime < FIELD_COALESCE_MS)
      if (!coalesce) {
        h.undo.push(prev)
        if (h.undo.length > UNDO_LIMIT) h.undo.shift()
      }
      h.redo = []
      h.field = field
      h.fieldTime = now
      if (!h.sameTask) {
        h.sameTask = true
        setTimeout(() => (historyRef.current.sameTask = false), 0)
      }
      commitDiagram(next)
      setDirty(true)
      syncHistoryFlags()
    },
    [commitDiagram, syncHistoryFlags],
  )

  // Steps the history one way: the current diagram goes onto the other
  // stack. A diagram that is the last opened/saved one is clean again.
  const stepHistory = useCallback(
    (from: 'undo' | 'redo') => {
      const cur = diagramRef.current
      const h = historyRef.current
      const target = h[from].pop()
      if (!cur || !target) return
      h[from === 'undo' ? 'redo' : 'undo'].push(cur)
      h.field = null
      commitDiagram(target)
      const clean = target === cleanRef.current
      setDirty(!clean)
      // Back to what is on disk: the recovery draft holds edits no longer wanted.
      const name = latestRef.current.diagramName
      if (clean && name) void deleteDraft(name)
      syncHistoryFlags()
    },
    [commitDiagram, syncHistoryFlags],
  )
  const undo = useCallback(() => stepHistory('undo'), [stepHistory])
  const redo = useCallback(() => stepHistory('redo'), [stepHistory])

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

  // UnsavedChangesDialog's answer. Save rejects (keeping the question open)
  // if the save fails; Don't save also drops the diagram's recovery draft.
  const resolveUnsavedPrompt = useCallback(
    async (choice: UnsavedChoice) => {
      if (choice === 'save') await saveDiagram()
      if (choice === 'discard' && diagramName) await deleteDraft(diagramName)
      setUnsavedPrompt(null)
      const resolve = unsavedResolverRef.current
      unsavedResolverRef.current = null
      resolve?.(choice !== 'cancel')
    },
    [saveDiagram, diagramName],
  )

  // Restores draft name as the working diagram, with its edits still
  // unsaved.
  const restoreDraft = useCallback(
    async (name: string) => {
      const draft = await getDraft(name)
      setRecoverableDrafts(list => list.filter(d => d.name !== name))
      if (!draft) return
      if (name !== latestRef.current.diagramName && !(await confirmLeave())) return
      openedRef.current = null
      setDiagramName(name)
      commitDiagram(draft.diagram, { reset: true, clean: null })
      setDirty(true)
      setDefaultVoltage(draft.diagram.editor?.defaultVoltage)
      clearSelection()
      setImportLog(null)
      setImportLogOpen(false)
      setDefaultVoltagePromptOpen(false)
      await browseDir(parentDir(name))
    },
    [confirmLeave, clearSelection, browseDir],
  )

  const discardDraft = useCallback(async (name: string) => {
    await deleteDraft(name)
    setRecoverableDrafts(list => list.filter(d => d.name !== name))
  }, [])

  // "Decide later": the drafts stay stored and are offered again on the
  // next start, or when their diagram is opened.
  const closeDraftRecovery = useCallback(() => setRecoverableDrafts([]), [])

  const saveCustomElement = useCallback(async (name: string, template: Diagram, overwrite: boolean) => {
    const saved = await api.saveCustomElement(name, template, overwrite)
    setCustomElements(prev =>
      [...prev.filter(c => c.name !== saved.name), saved].sort((a, b) =>
        a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
      ),
    )
  }, [])

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
      selectMany,
      selectedConnectorId,
      selectedLabelId,
      selectedDigitalDeviceId,
      armedSymbol,
      armedWireKind,
      armedLabel,
      armedDigitalDevice,
      customElements,
      armedCustomElement,
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
      armCustomElement,
      saveCustomElement,
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
      defaultVoltagePromptOpen,
      setDefaultVoltagePromptOpen,
      importDiagramFiles,
      batchImport,
      overwriteBatchSkipped,
      closeBatchImport,
      saveDiagram,
      saveDiagramAs,
      updateDiagram,
      updateEditorSettings,
      undo,
      redo,
      canUndo,
      canRedo,
      hiddenLayers,
      setLayerHidden,
      findQuery,
      findType,
      setFind,
      findFocusSeq,
      requestFind,
      focusRequest,
      focusItem,
      unsavedPrompt,
      resolveUnsavedPrompt,
      recoverableDrafts,
      restoreDraft,
      discardDraft,
      closeDraftRecovery,
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
      selectMany,
      selectedConnectorId,
      selectedLabelId,
      selectedDigitalDeviceId,
      armedSymbol,
      armedWireKind,
      armedLabel,
      armedDigitalDevice,
      customElements,
      armedCustomElement,
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
      armCustomElement,
      saveCustomElement,
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
      defaultVoltagePromptOpen,
      setDefaultVoltagePromptOpen,
      importDiagramFiles,
      batchImport,
      overwriteBatchSkipped,
      closeBatchImport,
      saveDiagram,
      saveDiagramAs,
      updateDiagram,
      updateEditorSettings,
      undo,
      redo,
      canUndo,
      canRedo,
      hiddenLayers,
      setLayerHidden,
      findQuery,
      findType,
      setFind,
      findFocusSeq,
      requestFind,
      focusRequest,
      focusItem,
      unsavedPrompt,
      resolveUnsavedPrompt,
      recoverableDrafts,
      restoreDraft,
      discardDraft,
      closeDraftRecovery,
    ],
  )

  return <DiagramContext.Provider value={value}>{children}</DiagramContext.Provider>
}
