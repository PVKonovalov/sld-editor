import { useEffect, useRef, useState } from 'react'
import { DiagramProvider } from './state/DiagramContext'
import { useDiagramContext } from './state/useDiagramContext'
import { Sidebar, type PanelId } from './components/Sidebar'
import { FilePanel } from './components/panels/FilePanel'
import { ElementsPanel } from './components/panels/ElementsPanel'
import { SettingsPanel } from './components/panels/SettingsPanel'
import { PropertiesPanel } from './components/panels/PropertiesPanel'
import { Canvas } from './components/Canvas'

type LeftPanelId = Exclude<PanelId, 'properties'>

function Shell() {
  // Properties docks on the opposite side of the canvas from File/Elements/
  // Settings (see PanelShell's side prop), and is meant to stay open while
  // browsing the Elements palette or placing things, so it's tracked
  // independently rather than sharing one "active panel" slot with them.
  const [activeLeftPanel, setActiveLeftPanel] = useState<LeftPanelId | null>('file')
  const [propertiesOpen, setPropertiesOpen] = useState(false)
  const { diagramName, selectedElementId, selectedConnectorId, selectedLabelId } = useDiagramContext()
  const hadSelection = useRef(false)
  const hadDiagram = useRef(false)

  // Selecting something on the canvas brings the Properties panel forward
  // automatically, without fighting a panel the user deliberately closed:
  // this only fires on the null -> non-null transition, not on every
  // selection change.
  useEffect(() => {
    const hasSelection = selectedElementId !== null || selectedConnectorId !== null || selectedLabelId !== null
    if (hasSelection && !hadSelection.current) {
      setPropertiesOpen(true)
    }
    hadSelection.current = hasSelection
  }, [selectedElementId, selectedConnectorId, selectedLabelId])

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
    <div className="flex h-full w-full overflow-hidden">
      <Sidebar activeLeftPanel={activeLeftPanel} propertiesOpen={propertiesOpen} onPanelToggle={togglePanel} />
      {activeLeftPanel === 'file' && <FilePanel onClose={() => setActiveLeftPanel(null)} />}
      {activeLeftPanel === 'elements' && <ElementsPanel onClose={() => setActiveLeftPanel(null)} />}
      {activeLeftPanel === 'settings' && <SettingsPanel onClose={() => setActiveLeftPanel(null)} />}
      <Canvas />
      {propertiesOpen && <PropertiesPanel onClose={() => setPropertiesOpen(false)} />}
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
