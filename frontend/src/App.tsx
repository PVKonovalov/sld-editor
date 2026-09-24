import { useEffect, useRef, useState, type DragEvent } from 'react'
import { DiagramProvider } from './state/DiagramContext'
import { useDiagramContext } from './state/useDiagramContext'
import { Sidebar, type PanelId } from './components/Sidebar'
import { FilePanel } from './components/panels/FilePanel'
import { ElementsPanel } from './components/panels/ElementsPanel'
import { SettingsPanel } from './components/panels/SettingsPanel'
import { PropertiesPanel } from './components/panels/PropertiesPanel'
import { Canvas } from './components/Canvas'
import { ImportLogDialog } from './components/ImportLogDialog'
import { ConfirmReloadDialog } from './components/ConfirmReloadDialog'
import { diagramFileKind, readFileAsText } from './lib/fileTransfer'
import { t } from './i18n'

type LeftPanelId = Exclude<PanelId, 'properties'>

function Shell() {
  // Properties docks on the opposite side of the canvas from File/Elements/
  // Settings (see PanelShell's side prop), and is meant to stay open while
  // browsing the Elements palette or placing things, so it's tracked
  // independently rather than sharing one "active panel" slot with them.
  const [activeLeftPanel, setActiveLeftPanel] = useState<LeftPanelId | null>('file')
  const [propertiesOpen, setPropertiesOpen] = useState(false)
  const {
    diagramName,
    selectedElementId,
    selectedConnectorId,
    selectedLabelId,
    selectedDigitalDeviceId,
    importDiagramFile,
    pendingImport,
    importLogOpen,
    setImportLogOpen,
  } = useDiagramContext()
  const hadSelection = useRef(false)
  const hadDiagram = useRef(false)

  // A window-wide drop zone for loading a .xml/.svg file from the user's own
  // machine (see FilePanel's own "Load from file…" button for the
  // file-picker equivalent) — dragCounter (not a plain boolean) is needed
  // because a dragenter/dragleave pair fires for every descendant element
  // the pointer crosses while dragging over this div, not just its own
  // boundary; the overlay should only hide once the count returns to zero.
  const [dragCounter, setDragCounter] = useState(0)
  const [dropError, setDropError] = useState<string | null>(null)

  function hasFiles(e: DragEvent) {
    return Array.from(e.dataTransfer.types).includes('Files')
  }

  function handleDragEnter(e: DragEvent) {
    if (!hasFiles(e)) return
    e.preventDefault()
    setDragCounter(c => c + 1)
  }

  function handleDragOver(e: DragEvent) {
    if (!hasFiles(e)) return
    e.preventDefault()
  }

  function handleDragLeave(e: DragEvent) {
    if (!hasFiles(e)) return
    e.preventDefault()
    setDragCounter(c => Math.max(0, c - 1))
  }

  function handleDrop(e: DragEvent) {
    if (!hasFiles(e)) return
    e.preventDefault()
    setDragCounter(0)
    const file = e.dataTransfer.files[0]
    if (!file) return
    if (!diagramFileKind(file.name)) {
      setDropError(t('file.invalidDiagramFile', { name: file.name }))
      return
    }
    setDropError(null)
    readFileAsText(file)
      .then(text => importDiagramFile(text, file.name))
      .catch(err => setDropError((err as Error).message))
  }

  // Selecting something on the canvas brings the Properties panel forward
  // automatically, without fighting a panel the user deliberately closed:
  // this only fires on the null -> non-null transition, not on every
  // selection change.
  useEffect(() => {
    const hasSelection =
      selectedElementId !== null ||
      selectedConnectorId !== null ||
      selectedLabelId !== null ||
      selectedDigitalDeviceId !== null
    if (hasSelection && !hadSelection.current) {
      setPropertiesOpen(true)
    }
    hadSelection.current = hasSelection
  }, [selectedElementId, selectedConnectorId, selectedLabelId, selectedDigitalDeviceId])

  // Picking a diagram from the File panel (or creating one) surfaces its
  // own width/height in Properties the same way selecting something on the
  // canvas does, so opening one lands directly on editable diagram
  // properties instead of an empty "no selection" panel.
  useEffect(() => {
    const hasDiagram = diagramName !== null
    if (hasDiagram && !hadDiagram.current) {
      setPropertiesOpen(true)
    }
    hadDiagram.current = hasDiagram
  }, [diagramName])

  function togglePanel(id: PanelId) {
    if (id === 'properties') {
      setPropertiesOpen(open => !open)
      return
    }
    setActiveLeftPanel(current => (current === id ? null : id))
  }

  return (
    <div
      className="relative flex h-full w-full overflow-hidden"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <Sidebar activeLeftPanel={activeLeftPanel} propertiesOpen={propertiesOpen} onPanelToggle={togglePanel} />
      {activeLeftPanel === 'file' && <FilePanel onClose={() => setActiveLeftPanel(null)} />}
      {activeLeftPanel === 'elements' && <ElementsPanel onClose={() => setActiveLeftPanel(null)} />}
      {activeLeftPanel === 'settings' && <SettingsPanel onClose={() => setActiveLeftPanel(null)} />}
      <Canvas />
      {propertiesOpen && <PropertiesPanel onClose={() => setPropertiesOpen(false)} />}
      {dragCounter > 0 && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 pointer-events-none">
          <p className="text-lg text-white border-2 border-dashed border-white rounded-lg px-6 py-4">
            {t('file.dropOverlay')}
          </p>
        </div>
      )}
      {pendingImport && <ConfirmReloadDialog />}
      {importLogOpen && <ImportLogDialog onClose={() => setImportLogOpen(false)} />}
      {dropError && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-red-900/90 text-red-100 text-xs rounded px-3 py-2 shadow">
          <span>{dropError}</span>
          <button type="button" className="underline shrink-0" onClick={() => setDropError(null)}>
            {t('common.close')}
          </button>
        </div>
      )}
    </div>
  )
}

export default function App() {
  return (
    <DiagramProvider>
      <Shell />
    </DiagramProvider>
  )
}
