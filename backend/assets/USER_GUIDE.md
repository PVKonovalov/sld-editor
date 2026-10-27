# SLD Editor — User Guide

SLD Editor is a browser-based editor for single-line diagrams of power networks. A diagram is saved as an `.xsld`
file (the source of truth) together with an `.svg` rendering in the xsde2svg format that SCADA viewers use.

This guide describes how to work with the editor. For installing and running it, see `README.md`.

New to the editor? Start with [How to: draw a diagram step by step](#how-to).

## The window {#window}

- **Left rail**: buttons for the **File**, **Elements** and **Settings** panels (they share the left side; one is
  open at a time), the **Properties** toggle, and **Help** (this guide) and **About** at the bottom.
- **Canvas**: the diagram itself, with zoom buttons in the bottom-right corner.
- **Properties** panel: docked on the right. It can stay open together with the Elements panel.

The browser tab shows the open diagram's name, with `*` when it has unsaved changes. The editor guards them against
being lost: see [Unsaved changes](#unsaved).

## How to: draw a diagram step by step {#how-to}

This walk-through builds a simple feeder bay: a busbar, a disconnector and a breaker below it, a ground switch between
them, and a cable line leaving the bay. Each step links to the section that describes it in full.

### Step 1. Create the diagram {#how-to-create}

1. Click **File** on the left rail.
2. In the folder browser, go to the folder where the diagram should be stored.
3. Click **New**, enter a name, the page **Width** and **Height**, and the **default voltage** (for example 10 kV),
   then confirm.

An empty page opens, and the Properties panel on the right shows the diagram itself. See
[Creating and opening](#create-open).

### Step 2. Check the grid {#how-to-grid}

1. Click **Settings** on the left rail.
2. Keep **Snap to grid** and **Show grid** on: devices and wires then line up and connect exactly.
3. Turn on **Show nodes** to see every connection point as a small cross (green: connected, red: free).

See [Settings](#settings).

### Step 3. Draw the busbar {#how-to-busbar}

1. Click **Elements** on the left rail and expand the **Busbars** group.
2. Click **Busbar section** to arm it.
3. Press on the canvas where the busbar starts, drag to where it ends and release.
4. In Properties, enter its **Name** and check its **Voltage class**.

See [Placing elements](#placing).

### Step 4. Place the devices {#how-to-devices}

1. Expand **Switching devices**, click **Disconnector**, then click the canvas below the busbar.
2. Arm **Breaker** the same way and click below the disconnector. Placing is single-shot: arm the element again for
   each copy.
3. To turn a device, select it and press **R** (90° clockwise; **Shift+R** counter-clockwise) or **M** (mirror), or
   change **Orientation** (or **Mirror**) in Properties; its terminals and the wires on them turn with it. With
   several items selected, each device turns about its own anchor; items without an orientation stay as they are.
4. To move a device, hold **Ctrl** (**Cmd** on a Mac) and drag it. A plain drag pans the canvas.

Tip: a device whose terminal is dropped exactly onto the busbar is connected to it without a wire. See
[Moving, copying and deleting](#moving) and [Connections](#connections).

### Step 5. Connect with wires {#how-to-wiring}

1. Expand **Wires** and click **Buswork** to arm it.
2. Hold **Ctrl**/**Cmd** and click the busbar above the disconnector to start the wire there (or click a device's
   terminal cross to start from it).
3. Click to add bends if needed; the wire stays horizontal/vertical.
4. Click the disconnector's upper terminal to finish. The wire tool is disarmed after each wire.
5. Arm **Buswork** again and connect the disconnector's lower terminal to the breaker's upper one.

**Esc** cancels a wire in progress. See [Wiring](#wiring).

### Step 6. Add a ground switch on a tap {#how-to-tap}

1. Expand **Grounding**, arm **Ground switch** and place it beside the wire between the disconnector and the breaker.
2. Arm **Buswork**, click the ground switch's terminal, and finish by clicking the middle of that wire. The wire is
   split there and a real junction is created.

See [Wiring](#wiring) and [Editing a wire](#editing-wire).

### Step 7. Draw the outgoing line {#how-to-line}

1. In **Wires**, arm **Cable line** (or **Overhead line**).
2. Click the breaker's lower terminal, add bends, and double-click to end the line in mid-air (or click another
   device's terminal).
3. The line gets an automatic name (`Cable line-12`); select it to rename it in Properties.

### Step 8. Name the devices and add labels {#how-to-names}

1. Select a device and type its **Name** in Properties.
2. Click the caption icon next to the name to add a text label with that name beside the device.
3. Free text (titles, notes) comes from the **Text** element.

See [Properties](#properties).

### Step 9. Check the connections {#how-to-check}

1. With **Show nodes** on, look for red crosses: each one is a terminal or wire end that is not connected.
2. Select a device: the **Connections** section in Properties lists each of its ports and what is attached there.
3. Fix a gap by drawing a wire to it, or right-click → **Topology** → **Connect to…** where the drawing already
   touches.

See [Connections](#connections).

### Step 10. Repeat bays quickly {#how-to-repeat}

- Select the finished bay (hold **Ctrl**/**Cmd** and drag a frame around it), then press **Ctrl+C** / **Ctrl+V**, or
  **Alt**-drag it to place a copy with its wires.
- To reuse the bay in other diagrams, right-click → **Save as custom element…**; it appears in the Elements panel's
  **Custom elements** group.

See [Selecting](#selecting) and [Custom elements](#custom-elements).

### Step 11. Save and export {#how-to-save}

1. Click empty canvas so nothing is selected; Properties shows the diagram.
2. Click **Save**: the `.xsld` and its `.svg` are written to the server folder.
3. Under **Export**, pick **SVG** or **XSLD** and press **Download** to get the files on your computer.

Optionally, organise items into [layers](#layers) before saving. See [Saving and exporting](#save-export).

## Diagrams and files {#files}

### Creating and opening {#create-open}

- **File → New** asks for a name, the page width and height, and a default voltage. The diagram is created in the
  folder the File panel currently shows; a name may contain `/` to create it in a subfolder.
- **File → Open** is a folder browser: click a folder to enter it, `..` to go up, a diagram to open it.
- When an opened diagram has no default voltage, the editor asks for one. It is used for newly placed elements and
  wires.
- Other systems draw the same voltage level in slightly different colors. When a diagram's voltage class color is
  close to one of the server's standard voltage colors (within the RGB distance set by `voltage_color_tolerance`, 60
  in the bundled configuration), the same dialog lists it under **Match colors to presets**, for example `#d01025` → `#d02020` 220 kV.
  Ticked classes take the standard color, and its name when they have no name of their own (only a color code).
  If the diagram already has a class with that name, the two are merged (the row says "merge"): everything in the
  color-code class moves to the named one and the duplicate is removed. A name you typed yourself is kept, and only
  the color changes. Everything drawn in the class is recolored. Each color is matched to its nearest standard color only. **Properties
  → Voltage classes → Match preset colors…** opens the list again later.

### Folders {#folders}

- **File → New folder** creates an empty folder in the folder the File panel shows. A name may contain `/` to
  create nested folders at once.
- Hover a folder or diagram in the folder browser to show its **Rename or move** (pencil) and **Delete** (bin)
  buttons, and, after a moment, its full name when it is too long for the panel.
- **Rename or move** asks for the new path from the top folder, filled in with the current one. Change the last
  part to rename it, or the folder part to move it (for example `region1/sub-5` → `archive/sub-5`). Missing folders
  are created. A folder moves with everything in it, and it can't be moved into itself. When the open diagram is
  renamed or moved, directly or with its folder, it stays open under the new name, page address included, and its
  unsaved edits are kept.
- **Delete** asks first and can't be undone. It removes a diagram's `.xsld` and `.svg`. Only an empty folder can be
  deleted. Deleting the open diagram closes it, leaving the editor empty (any unsaved changes are lost, as the dialog
  warns), so even the last diagram of a folder can be deleted, and then the folder itself. A diagram, or a folder with
  anything in it, that another tab has open can't be deleted: the dialog lists those tabs, and Delete stays off until
  they close it (a tab counts as open until about two and a half minutes after its last contact).
- Both dialogs list the other tabs (by IP address) that have the diagram, or anything in the folder, open. Those
  tabs are not told about the change: saving there writes the diagram back under its old name.

### Importing {#import}

- Drop `.xsld`, `.svg`, `.xsde` or CIM (`.zip`, `.xml`) files anywhere on the window, or use **File → Load from file…**.
  While a file is uploaded and converted (a big CIM model takes a few seconds), the canvas shows **Importing
  <name>…** and the File panel waits.
- A Modus `.xsde` diagram is converted with xsde2svg first, then imported like its `.svg`. A single-page `.xsde`
  opens in the editor; each page of a multi-page one is saved into the current folder as `<name>`, `<name>_1`,
  `<name>_2`…, like several files at once.
- One file opens in the editor as an unsaved diagram; a CIM model is saved straight away as well. If a diagram of
  that name already exists in the current folder, the editor asks before loading it (saving, or for a CIM model the
  import itself, overwrites it).
- Several files at once are saved straight into the current folder; existing names are skipped, and the summary
  dialog can overwrite them.
- An `.svg` import (an xsde2svg drawing) shows an **import log**: what was recognised, the voltage classes found and
  what was skipped. **File → Show import log** reopens it.
- An `.xsde` import's log also lists the **converter messages**: errors, warnings and notes from xsde2svg (an object
  type it can't draw, a custom element that wasn't found…). For several pages or files, the summary shows how many
  messages each page has; click the count to see them. A file that can't be converted at all (e.g. damaged XML) is
  reported with the reason. The converter's colors and settings come from `xsde2svg.yml` and `workplace.xml`; see
  [Configuration](#configuration-xsde). A file whose header says UTF-8 but whose text is really Windows-1251 (as some Modus
  exports are) is read as Windows-1251, with a warning in the converter messages.
- xsde2svg draws each device at its own size step (each step √2 larger). An `.svg` import recovers the step from where
  the device's connection points lie, so the symbol fills the gap between its wires. Devices whose leads also stretch
  per instance (breakers, disconnectors and similar) get their size from their drawn body and their **Leads** from
  their two connection points.
- A device lead that ends a unit or two beside a wire (a T-tap, such as a ground switch on a feeder) is connected to
  that wire on import, splitting it there.
- A wire that ends on the middle of another wire (a T-junction in buswork), alone or together with a device's lead,
  is connected to it the same way; an overhead line is not split for it.
- A junction point (the dot) marks that everything crossing there is connected: every wire running through it,
  overhead lines included, is split at the dot and joined to it and to a busbar under it. Wires crossing without a
  dot stay separate.
- Diagrams imported before these two rules were added get them with **Repair diagram** (see
  [Repairing a diagram](#repair)).

### CIM files: profiles and names {#cim-files}

A CIM model in the European CGMES form (Common Grid Model Exchange Standard, versions 2.4.15 and 3.0) is not one
file but a set of RDF/XML documents (IEC 61970-552), one per **profile**, usually packed in a `.zip`. Each profile
describes one side of the same network; the documents refer to each other's objects by id (`rdf:ID` /
`rdf:about="#…"`, the object's `mRID`). Each document starts with a header (`md:FullModel`) giving its own id,
creation and scenario time, the profile(s) it holds (`md:Model.profile`, for example
`http://iec.ch/TC57/ns/CIM/CoreEquipment-EU/3.0`) and the documents it depends on (`md:Model.DependentOn`); an SSH
file, for example, depends on the EQ file of the same network.

**File names.** The usual convention is `<date>T<time>Z_<process>_<area>_<profile>_<version>.xml`:

- `<date>T<time>Z`: the scenario time in UTC, e.g. `20201202T1843Z`.
- `<process>`: the business process: `1D` day-ahead, `2D` two days ahead, `ID` intraday, `YR` year-ahead…
- `<area>`: who modelled it (a TSO such as `BE` or `NL`, a region, a model name) or `ASSEMBLED` for a merged model.
- `<profile>`: the profile code below. `_BD` marks the common **boundary** set shared by all parties.
- `<version>`: the file's version, e.g. `001`.

So `20201202T1843Z_1D_Svedala Area_EQ_001.xml` is the equipment of the Svedala test model for the day-ahead process
of 2 December 2020, 18:43 UTC. Names are a convention only: what a document holds is in its header, and the editor
looks at the content, never at the name.

| Code | Profile | Holds | Import | Export |
|---|---|---|---|---|
| EQ | Equipment (CGMES 3.0: Core Equipment) | The equipment and how it is connected: substations, voltage levels, base voltages, busbars, switches with their normal position, transformers and their ends, lines, loads, generators, terminals and connectivity nodes, ratings and impedances | Read: the network | Written (`<name>_EQ.xml`) |
| OP, SC | Operation, Short Circuit (CGMES 3.0) | Parts of EQ split off in 3.0: measurements and limits; short-circuit data. Often in the same file as EQ (its header then lists several profiles) | Merged, not used | Not written |
| EQ_BD | Boundary equipment (EQBD in 3.0) | The border points between areas: boundary connectivity nodes, their base voltages and lines to neighbours | Read with EQ when in the zip | Not written |
| TP | Topology | Topological nodes (buses): which connectivity nodes are joined by closed switches; in a bus-branch model, the only nodes there are | Read: a bus-branch model's topological nodes stand in for connectivity nodes | Not written |
| TP_BD | Boundary topology (2.4.15) | Topological nodes of the boundary | As TP | Not written |
| SSH | Steady State Hypothesis | The operating point to compute: switch states now (`open`), load P and Q, generator set points, tap positions, regulation | Merged, not used (a switch's position comes from EQ's `normalOpen`) | Not written |
| SV | State Variables | Results of a power flow: bus voltages and angles, flows, tap steps, which equipment is in service | Merged, not used | Not written |
| DL | Diagram Layout (IEC 61970-453) | Drawings: diagrams, where each object is drawn (points, rotation), texts, visibility layers | Read: each diagram becomes a page; without a DL the layout is generated | Written (`<name>_DL.xml`) |
| GL | Geographical Location | Coordinates of equipment on a map (locations, position points, coordinate system) | Merged, not used | Not written |
| DY | Dynamics | Models for dynamic simulation (machines, exciters, governors) | Merged, not used | Not written |

All `.xml` and `.rdf` files of a zip are read and merged, whatever their names; what the editor does not use simply
has no effect. An EQ document alone is enough for a drawing (see [CIM import](#cim-import)).

**`<NN>_<substation>_metadata.json`.** This file is not part of CIM. PowSyBl's single-line-diagram renderer writes it
next to each SVG it draws, for example `tools/cim-tools render <model> out/` writes `out/00_<substation>.svg` and
`out/00_<substation>_metadata.json` (see `docs/CIM_INTEROP.md`). It is a JSON object that ties the SVG to the
network, so an application showing the SVG can make it interactive (highlight, open, switch the right equipment):

- `metadataVersion`: the format version (for example `1.1`).
- `components`: the symbol types used (`BUSBAR_SECTION`, `BREAKER`, `DISCONNECTOR`, `TWO_WINDINGS_TRANSFORMER`…),
  with their size and CSS class.
- `nodes`: every drawn symbol: its SVG element `id`, its voltage level (`vid`), its `componentType`, its
  `equipmentId` in the network (the CIM mRID), whether a switch is `open`, and its labels.
- `wires`: every drawn wire: its SVG `id` and the two node ids it joins.
- `lines`, `feederInfos`, `busInfos`: line ends leaving the substation, the arrows and values drawn on feeders, the
  bus legends.
- `layoutParams`, `svgParams`: the settings PowSyBl drew with (cell sizes, spacing, padding; label and unit options).
- `networkId`, `networkName`, `networkDate`: the network it was drawn from.

The editor neither reads nor writes these files; import the CIM zip itself.

### CIM import {#cim-import}

A CIM model, as a `.zip` of CGMES profile files or one RDF/XML `.xml` file (the equipment from EQ, a bus-branch
model's buses from TP, the drawings from DL; the other profiles are read but not used, see
[CIM files](#cim-files)),
is imported like an `.xsde`: each diagram of its Diagram Layout (DL) becomes a diagram. A single one is saved into the current folder as
`<name>` and opens; several
are saved into a folder of the current folder named after the file, each diagram named after its DL diagram (for a
model laid out automatically, its substation), as in `<name>/AGGAN CT11`; a name already there is skipped. Both CGMES 3.0 and 2.4.15 are read, node-breaker and
bus-branch models alike (a bus-branch model's topological nodes stand in for connectivity nodes), and a file this
editor exported comes back as it was drawn. In a zip, every `.xml`/`.rdf` file is read, in any folder; hidden files
(a name starting with a dot) and the `__MACOSX` folder that macOS **Compress** adds are skipped.

When the model's layout was made by another tool, the import asks how to draw it (**Diagram layout of the model**):

- **Use model layout**: each of its diagrams becomes a page, drawn where that tool placed everything. Such layouts
  are often network overviews: one diagram for all substations, devices close together, no texts. A diagram that
  writes no texts at all gets the equipment's names from EQ: beside an upright device, over a lying one (stepping
  further away where names would overlap each other or a busbar), over a busbar's end and beside a line.
- **Lay out automatically**: the layout is set aside and each substation gets a page of its own, laid out as for a
  model without a layout (below), names included.

A file this editor exported, or a model without a layout, is imported without asking.

- Each device becomes the symbol of its CIM class at the point the layout gives it, rotated in steps of 90°, with its
  name, voltage class (one per base voltage, named like "110 kV" and coloured like the standard voltage of the same
  value, see [Voltage classes of a CIM import](#cim-voltage-colors); a voltage level whose base voltage is missing,
  often kept in a file not sent along, takes the voltage its name states, as in "ОРУ-110 кВ" or "6,3 kV"; a nominal
  voltage above 2000 kV, which no grid has, is taken as it is with a warning in the import log, since CIM's
  `nominalVoltage` is in kV and such a file has likely written volts), the
  switch position (`normalOpen`) and its [electrical parameters](#electrical-parameters). A class with a choice keeps
  it as its **CIM class** (an asynchronous machine becomes a motor with CIM class AsynchronousMachine). Loads,
  network infeeds and SVCs use the Load, Network infeed and Static var compensator symbols.
- AC line segments become overhead lines along their layout points (cable lines when the layout says so), with their
  parameters. Labels (or, where a layout writes none, the names) and visibility layers come along. A consumer or source this editor exported as a link to object
  comes back as one.
- Each device, line, terminal, transformer winding and connectivity node keeps its CIM identity (its mRID), saved in
  the diagram file, so exporting it again writes the same identities (see [CIM export](#cim-export)). Properties
  shows a selected device's or line's **mRID** (read-only, with a copy icon next to its label), and [Find](#find) finds an item
  by its mRID or one of its terminals'.
- What is connected comes from the model, never from the drawing: two items join only when they are on the same
  node, however the layout places them, and a CIM import is not run through **Repair diagram** (which joins what
  touches; better not used on one). Wire jumps and junction points follow the rules of drawing by hand
  ([Wiring](#wiring)): a buswork wire crossing a busbar, another buswork wire or a line of a different voltage class
  gets one **wire jump** (one per crossing), and every busbar–buswork connection a junction point. A crossing of
  the same voltage class stays a plain crossing, though the two are not connected. The import log counts the jumps
  and any crossing too cramped for one.
- Wires the layout draws for a connectivity node are kept. Whatever of a node they leave unconnected gets an
  orthogonal wire to the rest of it, to its busbar when it has one; the import log counts these.
- Layouts made by other tools often draw less than this editor exports, and they are completed:
  - A busbar drawn only as its connectivity node (a line for the node, none for the BusbarSection) becomes that
    busbar; a node drawn as a short bar shorter than two grid steps only marks a junction and is not drawn.
  - A terminal drawn as a polyline from its device to its node becomes a wire from the symbol's terminal, unless it
    runs over another device or a terminal of another node; then the connection is routed instead.
  - Each device is turned so its terminals are where the layout draws them, a quarter or half turn when the symbol
    lies on the other axis (a transformer drawn upright); a device with no terminals drawn is turned so they face
    what they connect to. No wire runs through a device to reach its far terminal.
  - A line the layout doesn't draw runs from its device to the marker of the substation at its other end (a
    Substation object), across to it when the way ahead is taken, or out as a short stub; it carries its name. The
    import log counts these line ends. A busbar or device the layout doesn't place on a diagram is not drawn there.
- A layout in other units is scaled so neighbouring devices are about six grid steps apart, snapped to the grid, and
  turned the right way up when its y axis points up.
- Equipment without a symbol here (a DC line, for example) is listed under **Skipped** in the import log.
- A model with equipment but no diagram layout (an EQ profile alone) is laid out automatically, on the model of
  PowSyBl's single-line layout: a diagram per substation (and one for equipment outside any), each voltage level a
  band with the highest voltage on top, its name (the voltage level's name, else its voltage) left of its busbars.
  - Bands go in rows, side by side, their busbars level, with the transformers on a row between: what a transformer
    steps down to goes on the row under the band of its highest winding, so a three-winding transformer's two lower
    voltages share a row. Its middle voltage moves up beside the highest when that makes the rows more even (HV and
    MV over the LV, as hand-drawn diagrams often have them). A bay leading to a transformer goes towards its row: down
    from the row above it, up from the row below. A voltage level no transformer reaches goes on the lowest row, and
    empty rows take no room.
  - A transformer reaching the page at one node only (an auxiliary transformer at the end of a cable) ends its bay
    like a load instead of standing on the transformer row.
  - Busbars that share a bay are parallel: full-width rows one under another. Busbars sharing none sit side by side.
  - Each bay (the devices between the busbars and what it feeds) takes columns of its own. Every device on a busbar
    has a column and drops straight onto its row, with a junction point there, crossing the busbars before it; each
    other device stands over the devices below it, and what the bay feeds (a line, a transformer, a load or
    generator) lies beyond them, a line to another substation as a short stub with its name.
  - The spacing follows hand-drawn diagrams: bays 9 grid steps apart on a busbar up to 20 kV and 12 above it, the
    columns of one bay (its legs to parallel busbars) 6 apart, devices 6 steps apart down a bay (4 between their
    terminals), a bay's first device terminal 2 steps from the busbar, and the busbar 2 steps past its outermost bays. Each device's name is right of it, on its own row; a name
    too long for the gap to the next bay takes a height of its own, by column. A connection the import adds between
    pieces of one node bends the way that runs over no device.
  - A bay is one straight run from the busbar to what it feeds, its breakers and disconnectors on it. Earthing is
    drawn off to the side: an earthing switch (or a disconnector followed by one, or a ground) on a node of the run is
    turned sideways, 2 steps right of the run at that node, with its name over it; a second one on the same node goes
    to the left. The bay gets the room its earthing needs. An earthing switch straight on a busbar keeps its own
    column.
  - Bus couplers (bays feeding nothing), bays leading to a transformer of a higher voltage and, on the top band, bays
    leading to a line go above the busbars; the others below. Transformers sit on a row between the bands of their
    windings, connected through free corridors, as are connections closing a ring. A lead never runs through another
    band nor along any wire or device: where its straight way is blocked (a three-winding transformer's lead to the
    band beyond the next one) it goes around, crossing a wire straight across only where there is no other way.
    A lead into a transformer never crosses the transformer itself: it reaches a winding from outside, going around
    the transformer when it comes from the other side, and it never crosses nor runs along a wire of its own node.
    When no such way exists, the lead is drawn anyway and the import log warns about it, naming the transformer.
  - Then the layout is tidied without changing its order: each busbar group with its bays moves only as a whole.
    The groups of one voltage class stay together, side by side on one row; each goes under the transformer it is
    fed from (a generator directly under its step-up transformer), and the row rises beside the band above where
    nothing is in the way. Transformers go under the bays feeding them, or over what they feed, so their leads come
    out straight; where a lead must turn, it makes a single jog in a corridor of its own, so that leads never cross. A move is
    kept only when it lowers the number of crossings (of leads with each other, or with another voltage class), then
    the bends of the transformer leads (a bend under a transformer counting more) and their length. Groups and
    transformers never overlap, nor do their names (a voltage level's name moves right of its busbars when only it is
    in the way), and everything stays on the page.
  - A voltage level without a busbar hangs its bays from a wire at its busiest node. The import log says the layout
    was generated.
- Not restored: a value the export wrote as 0 because it was unset comes back as a real 0; decorative shapes and
  digital devices were never exported; equipment the layout places on another diagram is not drawn on this one.

### Transformer winding voltages {#cim-winding-voltages}

A transformer whose windings all have the same voltage can't be right: the model most likely gives one base
voltage to every end, and then everything beyond the transformer is drawn in the wrong voltage band. So before
anything is laid out, the **Transformer winding voltages** dialog lists each such transformer with a field per
winding. The field starts at the winding's rated voltage (`ratedU`), else the model's voltage, both shown beside it.

- **Apply**: each changed winding takes its voltage, and so does everything connected to it up to the next
  transformer: its busbars, devices and lines. They get a voltage class of that voltage (named "<kV> kV") and their
  own voltage band in the automatic layout. A winding joined back to another winding of its own transformer, with no
  transformer between, is the only thing that changes; the import log says so.
- **Keep as in the model** (also Esc): the model's voltages are kept.

It is asked for a model with its own diagram layout too (the voltage classes are just as wrong), and for each
file of a multi-file import.

### Voltage classes of a CIM import {#cim-voltage-colors}

A CIM voltage class takes the name and color of the standard voltage (`voltage_colors`) of the same value, so
"110 kV", "110kV" and "110.0 kV" all match "110 kV". When a model uses voltages that none of them names (400 kV
when the configuration stops at 330 kV, say), the **New voltage classes** dialog lists them before anything is
opened or saved:

- **Pages**: how many of the model's diagrams use the class.
- **Nearest**: the standard voltage nearest to it, by ratio (400 kV → 330 kV, 17 kV → 10 kV, 135 kV → 110 kV). The
  class is given its color; with no standard voltage to compare, it is grey.
- **Color**: change the suggested color.
- **Add** (ticked): adds the class with its color to `voltage_colors` in the server's configuration file, so the
  next import matches it and it is offered for new classes, at once and without a restart. The file keeps its
  comments; the entry is written after the last one of the list. A server whose configuration file can't be
  written shows why and keeps the dialog open: untick **Add** to go on without it.

**Apply** gives every imported diagram these colors and adds the ticked classes. **Keep suggested** (or Esc)
imports with the suggested colors and adds nothing.

### Saving and exporting {#save-export}

With nothing selected, the Properties panel shows the diagram itself:

- **Save** writes the `.xsld` and its `.svg`. **Save As** saves a copy under a new name in the same folder.
- **Export**: pick a format and press **Download** to save the diagram to your computer: **XSLD** (the diagram file),
  **SVG** (the picture), or **CIM, CGMES 3.0** for other power system tools (see [CIM export](#cim-export)). The
  format you picked last is remembered in this browser. An SVG for rdss-dms should have every switching device in
  its normal position, **Open** or **Close**: rdss-dms draws a device's live state from the position it was exported
  in. After an SVG export, any device that is Intermediate, Faulty or has no State is listed under **Download**
  (click a name to find it on the canvas) — set each one and export again.
- **Width**, **Height** and **Background color** of the page, and the **Layers** and **Voltage classes** of the
  diagram (see [Layers and voltage classes](#layers)).
- **History**: when the diagram was saved and from which IP address (see [Several people on one diagram](#history)).

### CIM export {#cim-export}

**Export** with the **CIM, CGMES 3.0** format saves a zip of two CIM files (IEC 61970-552 RDF/XML, CGMES 3.0): `<name>_EQ.xml`, the
equipment and how it is connected, and `<name>_DL.xml`, the diagram layout (IEC 61970-453) that places it, each with its header (the DL depending on the EQ). No other
profile is written (see [CIM files](#cim-files)); tools such as PowSyBl derive the topology from EQ. The EQ
header also lists the ShortCircuit profile when the export holds short-circuit data (a line's zero-sequence values,
a busbar's peak current). As in the CGMES conformity models, every equipment has `Equipment.aggregate` and every
diagram object a name. The export is tested for import with PowSyBl but not validated against ENTSO-E's CGMES
constraints, so it is not a full CGMES model (no SSH, TP or SV). Unsaved edits are included.

- The diagram is split into substations by its connections: everything joined without passing through a line is one
  substation (transformers inside), named after its busbar with the most connections. A line end with no equipment
  around it (only wires, poles and the like) belongs to the substation at the line's other end. Each has a voltage level per
  voltage class, and an overhead or cable line runs between substations.
- A class's nominal voltage is read from its name ("110 kV", "6,3 кВ", "400 V"; a bare number is kV); a class still
  named after its colour takes the name of the standard voltage of that colour (`voltage_colors`). Equipment whose
  class holds no voltage takes the voltage of what it is switched to; where nothing around has one, its
  substation's (or the diagram's) most common voltage is used, and the export log says so.
- A switch or line with both ends on one node is left out, and a transformer with 4 windings is exported but noted,
  since some tools (PowSyBl among them) read only 2 or 3.
- Each device becomes its CIM class (breaker, disconnector, load break switch, ground disconnector, fuse, power
  transformer with an end per winding, synchronous machine, shunt or series compensator, busbar section, ground)
  with a terminal per connection point. A changeover knife switch becomes two disconnectors from its pivot. A switch's
  state gives its normal position; no state means closed.
- Some symbols can stand for more than one CIM class: pick it in Properties' **CIM class** list (shown only for
  them). A breaker can be a disconnecting circuit breaker, a generator or motor an asynchronous machine, a shunt
  reactor a Petersen coil, a starter a load break switch, a **Load** a conform or non-conform load, and a **Network
  infeed** an equivalent injection or energy source. These choices, and every symbol's default, come from the
  server's configuration (`cim.classes`, see [sld-editor.yaml](#configuration-editor)).
- **Load**, **Network infeed** and **Static var compensator** (under Other equipment in the palette) are symbols for
  CIM equipment that classic diagrams have no symbol for: a consumer, a connection to an outside network, and an SVC.
- Each overhead or cable line becomes an AC line segment in a line of its own name.
- A **link to object** stands for the outside object it points to: an energy consumer by default, or an energy
  source when its **CIM class** in Properties says so. It is connected at its start only; the arrow end is the object
  (**Reverse direction** swaps them), and something connected there is noted and left out. A consumer link has P and
  Q in its [electrical parameters](#electrical-parameters).
- Buswork wires, a busbar's connection points, junctions, wire jumps, poles, cable joints, current transformers,
  fault indicators and blocking filters join what they touch into one connectivity node. Current and voltage
  transformers, surge arresters, fault indicators and blocking filters are exported as auxiliary equipment on that
  node.
- Text labels become text objects, linked to their device; layers become visibility layers. Decorative shapes,
  digital devices and pictures of substations or power plants are not exported.
- Identifiers (mRIDs): what came from a CIM import keeps its own (devices, lines, their terminals, transformer windings,
  and a connectivity node whose wires and terminals all came from the same one). Everything else gets one derived from
  the diagram's name and item ids, so exporting the same diagram again keeps them too: what is drawn here, a copy
  (paste, duplicate, custom elements; a copy is new equipment), a node joining two imported ones, and the substations,
  voltage levels and other containers the export builds. A line cut in two keeps its identity on the first piece. An
  identity found twice (a file edited by hand) is kept once; the others get new ones, listed under the Export row.
  A kept identity that is not a UUID (from a source that doesn't follow CGMES 3.0) is written as it is and listed
  there too.

Values the files need but the diagram doesn't have (see [Electrical parameters](#electrical-parameters)) are written
as 0, or as the voltage class's nominal voltage for a rated voltage (among them an SVC's slope and a network infeed's
active power limits, which tools such as PowSyBl require). Under the Export row, the export lists each such
item and what was missing, as well as voltage classes without a voltage in the name and devices it could not export;
click an item to highlight it on the canvas.

### Repairing a diagram {#repair}

An `.svg` or `.xsde` import is repaired as it comes in: every device gets exactly its fixed ports on its terminals,
a busbar gets a port at each point where something meets it, wire ends and terminals lying on a wire or a junction
dot are joined to it, voltage classes get the server's standard names, and wires of zero length are removed (see
[Connections](#connections)). Opening a diagram never changes its connections; it only fixes duplicate or missing
ids, and then marks the diagram as changed.

A diagram saved before these rules existed, or edited outside the editor, can be repaired by hand: **Repair
diagram** in the diagram's Properties (nothing selected) applies the same repair to the diagram as it is now,
unsaved edits included. It is one step that **Undo** reverts, and the diagram is marked as changed until you save
it. "Nothing to repair" means the diagram already follows every rule.

### Unsaved changes {#unsaved}

- Opening another diagram, creating a new one, or importing a file while the open diagram has unsaved edits first
  asks: **Save** (then continue), **Don't save** (drop the edits) or **Cancel** (stay where you are). An id fix made
  automatically on opening doesn't count as an edit.
- Closing or reloading the browser tab with unsaved edits shows the browser's own "Leave site?" warning.
- The page address names the open diagram (`?diagram=folder/name`), so reloading the page opens it again (as last
  saved), and a bookmark or a link sent to a colleague opens it directly.
- While you edit, the editor keeps a recovery copy of the unsaved changes in your browser. If the tab was closed or
  crashed before you saved, the next time you start the editor (or open that diagram) it offers to **Restore** them,
  still unsaved, or **Discard** them; **Decide later** keeps the copy for next time. Saving deletes the copy. The copy
  lives only in this browser on this computer.

### Several people on one diagram {#history}

The editor does not lock a diagram: if two people edit the same one, the last **Save** wins and replaces the other's
changes. To help avoid that, a one-line amber message appears at the top of the window:

- **Also open by: 10.0.3.41 since 10:15 (2), 10.0.3.57 since 10:32** — the diagram is open in other browser
  tabs, shown by their computers' IP addresses and when the first tab from each opened it (with the date if not today; a number in brackets counts its tabs),
  earliest first. Agree who saves before both of you do. Hover over the message for a reminder of what it means.
- **Saved by 10.0.3.41 at 10:42. Your copy is out of date.** — someone saved the diagram after you opened or last
  saved it. Saving now would replace their changes; reopen the diagram to get them.

Each tab checks in once a minute, so the message can take up to a minute to appear or go away. A tab that is closed
stops counting at once. Opening times are kept only in the server's memory: after the server restarts, they show when
each tab first checked in again. The editor knows people only by IP address; your own other tabs are listed too.

Every save is recorded in the diagram file (`<history>` in the `.xsld`): the time and the IP address it came from.
With nothing selected, the **History** section of Properties lists them, newest first. The last 200 saves are kept.

## Moving around the canvas {#navigation}

| Action | How |
| --- | --- |
| Zoom | Mouse wheel, or the zoom buttons |
| Fit the page | The bottom zoom button |
| Pan | Drag with the left mouse button anywhere, on empty canvas or on an item. Dragging with the **middle mouse button**, or holding **Space** and dragging, also pans (even while a tool is armed) |

A plain left-drag never moves an item: hold **Ctrl** (**Cmd** on a Mac) to move it (see [Moving, copying and deleting](#moving)).

The bottom-left corner shows the cursor's position in diagram units (`x 1563  y 638`), the same coordinates
Properties and the Connections section use; with **Snap to grid** on it adds the grid point a click there would snap
to (`→ 1560, 640`). Move the mouse until it reads a point you're looking for.

## Placing elements {#placing}

1. Open the **Elements** panel and expand a group.
2. Click an element to arm it (the button stays highlighted), then click the canvas to place it. Placing is
   single-shot: the element is disarmed afterwards. Click the button again or press **Esc** to cancel.

**Placement keys:** some palette buttons show a letter in their top-right corner. Pressing that key (without
Ctrl/Cmd/Alt) arms the item the same as clicking the button, even with the Elements panel closed; pressing it again
disarms it. The bundled configuration uses **T** power transformer, **C** breaker, **D** disconnector, **B** busbar
and **W** buswork; an administrator sets them in the server configuration (`hot_keys`). They do nothing while you're
typing in a field or in the middle of a drag or drawing.

Some elements are drawn instead of clicked:

- **Busbar**, **Arrow**, **Rectangle**, **Small window**, **Button**, **Window icon**, **Table**, **Arc**:
  press on the canvas and drag from one corner or end to the other. A rectangle starts with square corners; set
  **Corner radius** in Properties to round them (0 = square, at most half the shorter side).
- **Circle**: press where the center goes (on the grid when snapping) and drag outward to set the radius, in steps of
  0.5; a plain click places a circle of radius 20. Ctrl/Cmd-drag from anywhere inside it to move it (the center stays
  on the grid); drag the square handle on its rim to change the radius. Properties has its center X/Y and radius,
  which may be any positive value, such as 0.5.
- **Line**, **Road**: click once per point. Double-click (or press **Enter**) to finish, once there are at least two
  points; **Backspace** removes the last point, **Esc** cancels. Afterwards, double-click the line to add a bend there,
  drag a point's square handle to move it, or click the handle (it fills in) and press **Delete** to remove that point
  (at least two stay).
- **Polygon**, **Container**: click once per corner. Click the first corner again (or press **Enter**) to close it,
  **Backspace** removes the last corner, **Esc** cancels. A container is a frame drawn around a group of equipment
  (usually dotted) with a caption; Properties sets the caption's text, position, size, color and rotation. Pressing on
  the empty space inside a container pans the canvas; to move a container, **Ctrl**/**Cmd**-drag its outline or caption.
- **Backdrop/image file**: drag a frame, then pick an image file (PNG, JPEG, BMP, SVG…) in the dialog that opens.
  The picture is stretched over the frame and saved inside the diagram file. It is placed beneath everything else, so
  it can serve as a backdrop. Until an image is chosen the frame is drawn dashed. In Properties, **Replace image…**
  picks another file and **Fit to image proportions** sets the frame's height from its width and the image's own
  aspect ratio.
- **Text** places a free text label; **Digital device** places a SCADA value readout.

Newly placed elements start at the default voltage (switching devices start closed). A device's fixed connection
points (its **terminals**) are shown as small crosses while it is selected: green where something is connected (a wire,
or another device's terminal on the same point), red where the terminal is still free.

## Selecting {#selecting}

| Action | How |
| --- | --- |
| Select one item | Click it |
| Add or remove an item | **Shift**-click or **Ctrl**-click (**Cmd**-click on a Mac) |
| Select everything inside an area | Hold **Ctrl** (**Cmd** on a Mac) and drag **left → right** from empty canvas: a solid frame picks only items fully inside it |
| Select everything an area touches | Hold **Ctrl** (**Cmd** on a Mac) and drag **right → left** from empty canvas: a dashed frame picks every item it touches |
| Clear the selection | Click empty canvas, or press **Esc** |

While the frame is being dragged, the items it would pick are highlighted. The frame adds to the current
selection (click empty canvas first to start over). When more than one item is selected, a
dashed box is drawn around the whole group, and Properties shows how many items are selected.

### Grouping {#grouping}

Items that belong together, such as a device and its caption or a whole bay, can be grouped so they are picked
as one:

- **Group**: select two or more items and press **Ctrl+G** (**Cmd+G**), or right-click → **Group**, or click
  **Group** in Properties. Selecting part of an existing group and grouping again merges it into the new group.
- A click on any member selects the whole group; Properties shows "Group of N items". **Shift**-click,
  **Ctrl**/**Cmd**-click and the selection frame add or remove whole groups, and **Ctrl**/**Cmd**-drag on any
  member moves the group.
- To work on one member, click it again while its group is selected: only that member is selected, with its
  own properties, and **Ctrl**/**Cmd**-drag moves just it. To get the whole group back, click empty canvas and
  then any member.
- **Ungroup**: select the group and press **Ctrl+Shift+G** (**Cmd+Shift+G**), or right-click → **Ungroup**, or
  click **Ungroup** in Properties.

A group only changes selection: drawing order, layers and connections stay as they are, and members may sit on
different layers (members on a hidden layer are left out of the selection). Groups don't nest. Copy/Paste,
Alt-drag and custom elements keep a copied group grouped, as a new group of its own. Deleting members leaves the
rest grouped while at least two remain. In the saved and exported SVG every member carries `data-group="<id>"`
with no extra `<g>` around them, so a viewer can find a whole group with `[data-group="<id>"]` and every
item still by its own id; importing that SVG restores the groups.

### Finding items {#find}

With nothing selected, the **Find** section in Properties searches the diagram (**Ctrl+F** / **Cmd+F** opens it):

- Type part of a name (`СВ-35`), a label's text, an id (`2138` or `#2138`) or a type (`breaker`, `capacitor`). The
  list updates as you type; an exact id comes first, then names starting with what you typed.
- An item imported from CIM is also found by its mRID, or that of one of its terminals or transformer windings, as
  it stands in a CIM file or a tool's message: `969f7caf-…`, `_969f7caf-…` or `#_969f7caf-…`, whole or in part.
- The type list narrows the search to one kind of item (with how many the diagram has), or lists them all.
- **Not connected only** lists just the items with a connection point nothing else is attached to: a device
  terminal with no wire or other device on it ("Port 1 free"), or a wire end left in mid-air ("Free end: To"),
  with their count. On its own it lists all of them; combined with a type (say, Ground switch) or a search, only
  those. Object links are left out: their arrow end points off the diagram by design. Busbars never count, as
  their connection points only exist where something is attached.
- Click a result, or move through the list with **↑**/**↓** and press **Enter**, to select it and center the canvas
  on it. Properties stays on Find, so you can go on through the results; click the item on the canvas to open its
  properties (clear the selection with **Esc**, or click empty canvas, to get back to Find). Items on a hidden layer
  are shown dimmed.

## Moving, copying and deleting {#moving}

| Action | How |
| --- | --- |
| Move | Hold **Ctrl** (**Cmd** on a Mac) and drag an item. Ctrl/Cmd-dragging any item of a multi-selection, or empty space inside its dashed box, moves the whole group. Without the key a drag pans the canvas. With the key held, a selected item's handles (corners, ends, bends, a circle's radius) move the item too instead of reshaping it |
| Duplicate by dragging | Hold **Alt** (**Option** on a Mac) and drag an item: a copy follows the cursor and the original stays. With a multi-selection, the whole group is copied |
| Copy | **Ctrl+C** (**Cmd+C**), or right-click → **Copy** |
| Paste | **Ctrl+V** (**Cmd+V**) pastes the copy two grid steps down and to the right of the original, a step further with each paste. Right-click → **Paste** pastes it where you clicked |
| Delete | **Delete** or **Backspace**, or right-click → **Delete** |

A pasted or duplicated copy becomes the new selection. Copies keep their wires and connections, and get new names
(`Breaker-12`). The copy buffer lasts while the browser tab is open and can be pasted into another diagram.

Moving respects **Snap to grid** (Settings): the item you drag lands on a grid point (a device by its connected
terminal), even if it was off the grid before, and the rest of a moved group keeps its place relative to it. Text
labels and digital devices move in whole grid steps instead. Wires attached to a moved device follow it. A device
whose terminal touches another device's terminal directly (a surge arrester standing on a ground, say) stays connected
when only one of them moves: a short buswork wire joins the two terminals, and it disappears again once you move them
back together.

### Snapping to the grid {#snap-to-grid}

Diagrams imported from xsde2svg often lie between grid points (a busbar at y = 691 on a grid of 10). With nothing
selected, **Snap to grid** in Properties moves the whole diagram onto the grid in one step:

- Busbar ends, wire bends, junctions and wire ends go to the nearest grid point. Points that were in line stay in
  line, so straight wires stay straight.
- Each device moves so that its connected terminal sits on its snapped connection point; a device with nothing
  connected snaps by its anchor. Lines, roads, polygons, rectangles and other drawn shapes snap every point.
- Connections are kept exactly as they were: nothing gets connected just because it now touches something. A wire
  squeezed to zero length is removed and its two ends joined.
- Text labels and digital devices stay where they are.

It uses the grid step from Settings, even when **Snap to grid** is off there. A note under the button tells how many
items moved; **Ctrl+Z** undoes the whole snap.

### Undo and redo {#undo}

- **Ctrl+Z** (**Cmd+Z** on a Mac) undoes the last change to the diagram; **Ctrl+Shift+Z** (**Cmd+Shift+Z**) or
  **Ctrl+Y** redoes it. The **Undo** and **Redo** buttons above the zoom buttons do the same.
- Every change counts: placing, moving, wiring, deleting, pasting, Properties edits, layers, voltage classes and the
  diagram's Settings. Typing in one Properties field counts as a single change.
- Up to 100 steps are kept. The history starts afresh when you open, create or import a diagram or restore a
  recovery copy; saving keeps it, and undoing back to the saved version clears the unsaved-changes mark.
- While a wire, line, polygon or selection frame is being drawn, or an item dragged, finish or cancel it (**Esc**)
  first. In a text field, Ctrl/Cmd+Z undoes the typing in that field instead.

## Wiring {#wiring}

Drawing a wire always starts by choosing its kind in the Elements panel's **Wires** group: **Buswork** (plain
wire), **Overhead line**, **Cable line** or **Object link**. The kind cannot be changed later. An object link's arrowhead
is drawn at the end where you finished it; **Reverse direction** (in Properties, or by right-clicking the link) moves
it to the other end.

The same group also has **Connector arrow**, which is not a wire kind: it is placed like an element and marks where a
line continues off the sheet. Its tail is its terminal, so draw the line from (or to) the tail; Properties sets its
length, direction in degrees and colors.

1. Click a wire kind to arm it.
2. Click a device's **terminal** to start the wire. To start on a busbar or on an existing wire, hold **Ctrl**/**Cmd**
   and click anywhere along it. To start in mid-air, double-click empty canvas.
3. Click to add bends; the wire stays horizontal/vertical.
4. Finish by clicking another terminal, any point of a busbar, or any point of an existing wire (an overhead line can
   only be joined at its two ends). Double-click to end the wire in mid-air.
5. **Esc** cancels the wire in progress.

Right-clicking a device or a wire also offers **Start buswork**, which starts a Buswork wire from it without using the
palette.

Its **Topology** submenu connects two points directly. Right-click near the terminal (or the point of a wire) to start
from, choose an item, then click the terminal, busbar point or wire point to connect to; **Esc** cancels.

- **Connect to…** joins the two into one electrical node without drawing anything. Use it where an imported drawing
  already touches but the connection is missing (the terminal cross stays red).
- **Create wire to…** draws a Buswork wire between the two.

Clicking the middle of a wire splits it there, as when a wire is drawn onto it.

A new wire takes the voltage class of where it starts: the device or busbar, or for a power transformer the winding
whose terminal it starts from (the windings can differ), or the wire it starts on. When that has none (an
autotransformer's tap terminal, an element without a voltage, a start in mid-air), it takes the voltage of where it
ends, and failing that the diagram's default voltage.

Where an edit connects a **Buswork** wire to a busbar (drawing the wire to or from it, dragging its end onto it,
drawing or moving the busbar over the wire's end, **Topology → Connect to…**), a **Junction point** is added on that
connection, with the busbar's voltage class and layer, unless one is there already. Connections that existed before
are not changed, and deleting the wire later leaves the dot.

Joining a wire in the middle of another wire splits it and creates a real junction. Overhead and cable lines get an
automatic name (`Overhead line-12`).

A **Buswork** wire that crosses a busbar, another buswork wire, an overhead or cable line or a link to object of a
different voltage class hops over it: a
**Wire jump** is put into the wire at the crossing, and the wire is cut around it, so the two stay unconnected and the
crossing is visible. The jump over a busbar is one size larger. It doesn't matter how the crossing came about: drawing
the wire, dragging its end or a bend, moving it or the device it is attached to, pasting it, changing its voltage, or
drawing or moving a busbar, an overhead or cable line or a link to object across it. The buswork wire is always the
one cut, never the busbar or the line; of two buswork wires,
the one you changed. A crossing at the same voltage, or too close to a bend or an end of the wire for the jump to fit,
stays a plain crossing, and crossings on lines an edit didn't touch are left as they are. The jumps are part of the
same edit, so **Ctrl+Z** undoes them together; a jump left behind when its wire is moved away stays until deleted.

### Different voltage classes {#voltage-mismatch}

The editor never silently connects two different voltage classes. When an edit would make such a connection, it
first asks **Connect different voltage classes?**, naming the classes and the number of connection points. This
covers finishing a wire on a terminal, busbar or wire, **Topology → Connect to…**, placing, dropping, moving,
rotating or pasting devices onto something, drawing, moving or reshaping a busbar over wire ends or terminals, and
dragging a wire end onto something.

- **Connect** makes the edit with those connections.
- **Don't connect** (also **Esc**) makes the same edit without them: those ends stay free and their crosses are red.

A class counts per terminal (a power transformer's terminal has its winding's voltage), and something with no
voltage class (an autotransformer's tap terminal, a decorative element) connects to anything. Connections that
already exist are kept, and an `.svg`/`.xsde` import or **Repair diagram** connects as before, since real diagrams
join different classes in many places.

### Editing a wire {#editing-wire}

Select a wire to show its handles (a click within a few pixels of a wire counts as a click on it):

- Drag a square handle to move a bend; the wire stays orthogonal.
- Drag a round handle (the middle of a segment) to add a bend there, or double-click the wire.
- Click a bend handle and press **Delete** to remove just that bend.
- Right-click a wire → **Delete segment** removes only the segment under the cursor.
- Right-click the node where exactly two buswork wires of the same voltage class meet, with no device or busbar on it → **Merge buswork** makes them one wire: the one with the lower id runs on through the other's points, and the node is removed. Undo reverses it.

A wire end that is not attached to anything is allowed; you can connect it later by dragging its hollow square end handle
exactly onto a device terminal, another wire's end, a busbar or another wire's line (that wire is split there into a
T junction; an overhead line is never tapped mid-span).

A wire end attached to a device terminal can't be dragged, so it is never torn off by accident. The exception is an
end whose connection point lies off the device's terminal (an imported drawing can leave a wire stopping short of a
transformer's lead, for example): its end handle is shown in amber. Drag it onto the terminal; the connection is kept
and every wire ending at that point follows. The handle disappears once the point is on the terminal.

When you open or import a diagram, the editor looks for such points itself: connection points up to 20 units off a
device's terminal, used by that one device only and carrying only buswork. If it finds any, it lists them and asks
**Move onto terminals** (each point moves onto its terminal and the buswork ends follow; the devices stay where they
are; one step of Undo) or **Leave as is** (the amber handles stay for fixing them one by one).

## Connections {#connections}

- Every device has a fixed number of connection points, defined by its shape: for example a breaker or a
  disconnector has two, a ground switch has one, and an enclosed substation has four, one in the middle of each
  side of its box (it is fed from whichever side the line arrives). They exist as soon as the device is placed and
  cannot be added or removed by the user.
- Several wires attached to the same terminal share it.
- Dropping a device so that one of its terminals lands exactly on a wire, a wire end or a busbar connects it there.
  A terminal that is only close to a wire still needs a wire drawn to it.
- A busbar gets one terminal for each connection point along it. Anything whose end lies exactly on the busbar is
  connected to it: a wire ended on it, a device terminal placed on it, or wire ends the busbar is drawn or moved
  over. A wire that only crosses a busbar is not connected. (A topology processor treats all of a busbar's terminals
  as one electrical node.)
- Rotating, mirroring or moving a device in Properties takes its connections along.
- Dropping a two-terminal device (a breaker, a wire jump…) onto a wire so that both its terminals lie on it puts it
  into the wire: the wire is cut out between the terminals and each piece ends on one of them.
- Deleting a wire leaves the devices' terminals as they are. Deleting a device also deletes the wires attached to
  it, except a device sitting in a wire (one wire on each terminal, continuing each other through it): deleting it
  joins the two wires back into one.
- **Settings → Show nodes** marks every electrical connection point on the canvas with a small cross, green when
  something is connected there and red when it is free (a terminal with nothing on it, or a wire end left in
  mid-air), which is useful for checking that things are really connected.
- The **Connections** section in Properties lists, for a selected device or busbar, each of its ports with the node
  it sits on (id and coordinates) and everything else attached there; for a selected wire, the same for its two ends.
  A port with nothing attached shows *not connected*, a wire end *free end*. A busbar port with nothing attached
  that isn't at either end of the busbar (left behind where a wire used to end) has a red bin button that removes it. Click a listed item to highlight it
  in amber on the canvas (the view pans to it when it is out of sight); the selection and Properties stay as they
  are, and clicking it again, or selecting anything, clears the highlight. To open its properties, select it on the
  canvas. Click the node's coordinates to center the canvas on that point (a ring flashes there).
- The scissors icon after a listed item disconnects just that item from this connection point; everything else
  there stays connected. So that a repair does not reconnect them (it joins anything lying exactly on a
  connection point, see [Repairing a diagram](#repair)), the two are also pulled apart: a detached wire end is drawn back one
  grid step along its wire (and shows as a red free end), a device touching another device or a busbar directly
  steps one grid step away from it, and a busbar point is dropped with the rest moved one step off the busbar.
  **Ctrl+Z** undoes it.

### Tracing {#trace}

Right-click a wire, busbar or device → **Trace** to highlight everything electrically joined to it, starting at the
connection point nearest the click (on an open breaker, the side you clicked). Wires, busbars and devices the trace
reaches are drawn orange; a device it can't pass is drawn red.

- **Respect switch states** (on by default): a breaker, disconnector or other switching device passes only when
  **Close**; **Open**, **Intermediate** and **Faulty** stop the trace, and so does a withdrawable device not racked in (any
  position but Service). It then shows what's energized from that point. Turn it off to see the whole network as
  drawn.
- **Through transformers** (off by default): a power transformer stops the trace, so it stays on one voltage level.
  Turn it on to continue through its windings to the other levels.
- Wires and busbars always pass, and so do devices with no state (fuses, current transformers, wire jumps…); a
  single-terminal device (a ground switch, a ground) is reached but leads nowhere.

- **Several sources:** while a trace is shown, **Trace** on another wire, busbar or device adds it as one more
  starting point (say, the second line feeding a substation); the trace then shows everything reachable from any of
  them. **Clear trace** removes the whole trace, all its starting points.
- **Dim the rest** fades everything the trace didn't reach, so with switch states respected and transformers passed
  the parts with no supply stand out.

A bar at the top of the canvas shows how many items the trace reached (and from how many sources) and has the switches
and a close button. The
trace follows your edits (opening a breaker in Properties cuts it at once). Right-click → **Clear trace**, the bar's
close button or **Esc** (with nothing selected) removes it. It is only a view: it isn't saved or undone.

**Fix voltage class** (right-click a device or wire that has a voltage class; not a transformer) gives its class to
everything electrically joined to it on its voltage level, as a trace with **Respect switch states** off and
**Through transformers** off finds it: through every switch, open or closed, up to the transformers. Devices,
busbars and wires it reaches take the class (things with no voltage class, such as decorative shapes, are left
alone), and so does the winding of each transformer that faces them; the transformer's other windings keep theirs.
Use it on a device whose class is right to fix a feeder imported or drawn with a wrong or unknown one. It is one
edit: **Undo** reverts all of it.

## Custom elements {#custom-elements}

Custom elements are predefined groups (for example a breaker with its disconnectors and ground switches) that you
place like a single element.

- They are listed in the Elements panel's last group, **Custom elements**. Arm one and click the canvas to place a
  copy of the whole group; its wires and connections come along.
- To create one, select the items, right-click → **Save as custom element…**, and enter a name. If the name is taken,
  the dialog offers to overwrite it. The new element appears in the palette at once.
- They are stored as ordinary `.xsld` files in the server's custom-elements folder, so they can also be edited by
  opening the file as a diagram.

## Properties {#properties}

Select a single item to edit it in the Properties panel:

- **Devices**: name (the caption icon beside it adds a text label with the name, linked to the device and placed to
  its right: size 10, left-aligned, bottom anchor, Arial, white; disabled once a label is linked to the device),
  voltage class, state (for switching devices), orientation and mirror, **Size** (the xsde2svg size
  step: 0 is the library size, each step √2 larger; its terminals and wires move along), **Leads** for breakers,
  disconnectors and fuses (xsde2svg's lead distance 2, 3 or 4: the terminals end up that many grid steps apart when
  **Snap to grid** is on, or that many times 10 when it is off, scaled by the size step; the grid step in force when
  you pick it is used, and later grid changes leave it alone. With snapping on, only lengths that put both terminals
  on grid points without moving the device are offered, so with a grid of 10 there is no 3. The body keeps its size.
  The current spacing is always listed, as its own entry when it matches none of them), and shape-specific fields
  (for example a transformer's windings or a lamp's colours).
- **Wires**: name and voltage class.
- **Text labels**: text, size, anchors, bold, colour, font, and the element it belongs to.
- **Digital devices**: SCADA name, default value and unit.

The voltage class list includes the server's standard voltages; choosing one that the diagram doesn't have yet adds
it. The last voltage chosen becomes the default for new elements.

### Electrical parameters {#electrical-parameters}

The collapsible **Electrical parameters** group in Properties stores nameplate data in the diagram file, for the CIM
export. Every field is optional: leave it empty when the value is unknown. Names and units follow CIM:

| Item | Parameters |
|---|---|
| Overhead and cable lines | length (km), R, X (Ω), B, G (S) for the whole line, and zero-sequence R0, X0, B0, G0 |
| Power transformer | per winding: rated voltage (kV), rated power (MVA), R, X (Ω), G, B (S), clock number (0–11) |
| Booster | rated power, rated voltage, R, X |
| Generator, synchronous compensator and motor | rated power, rated voltage, min/max P (MW), min/max Q (Mvar) |
| Capacitor, capacitor bank, shunt reactor | nominal voltage (kV), B and G per section (S), sections in total and in service |
| Reactor, choke coil | R, X |
| Switching devices and fuses | rated current (A) |
| Busbar | peak current (A) |
| Link to object (energy consumer) | P (MW), Q (Mvar) |
| Load | P (MW), Q (Mvar) |
| Network infeed | min/max P (MW), min/max Q (Mvar) |
| Static var compensator | capacitive and inductive rating (Ω), slope (kV/Mvar) |

Copying a device copies its parameters. When a line is split (a tap, or a busbar laid across it), the original
piece keeps the parameters and the new piece starts empty.

### Layers and voltage classes {#layers}

With nothing selected, Properties shows the diagram's **Layers** and **Voltage classes** (name, colour, how many items
use it). An element or wire without a voltage class is drawn grey.

Layers group items so they can be shown or hidden together (for example disconnectors, ground switches or CTs) and
set what is drawn on top. Every element, wire, text label and digital device is on exactly one layer; the base layer
always exists.

- **Add**, rename or delete layers. Items on a deleted layer move to the base layer. The `#` column counts the items
  on each layer.
- **Z** is the drawing order: a layer with a higher Z is drawn over one with a lower Z, both on the canvas and in the
  saved SVG. Layers with the same Z (all of them start at 0) are drawn together as usual: devices, then wires, then
  indicators, then text.
- The eye button hides a layer while you edit: its items are not drawn and cannot be clicked, selected or wired to.
  This is only a view setting; it is not saved and does not change the export.
- **New items go on** picks the layer that newly drawn or placed items (including custom elements) start on. Copies
  keep the layer of their original.
- To move items to another layer, select them and pick the **Layer** in Properties; with several items selected it
  moves them all.

The saved SVG marks every item that is not on the base layer with `data-layer` and lists the layers in a `<metadata>`
block, as xsde2svg does, so a viewer such as ctrlroom can switch layers on and off. Importing an xsde2svg SVG keeps its
layers; a layer number the file uses without naming it is added as "Layer N".

## Settings {#settings}

Grid spacing, **Snap to grid**, **Show grid**, **Show nodes** and the diagram's default voltage. These are saved with
the diagram.

## Configuration {#configuration}

These files are for whoever installs and runs the editor. `sld-editor.yaml` lives in the `config/` folder, the
converter's `xsde2svg.yml` and `workplace.xml` in `assets/` (`backend/config/` and `backend/assets/` in the source
tree). Relative paths inside them are resolved from the folder the editor is started in.

Behind a reverse proxy, run the proxy on the same machine and have it pass the client's address, so the history and
the "Also open by" message show real IP addresses instead of `127.0.0.1`. The editor trusts `X-Forwarded-For` /
`X-Real-IP` only from a proxy on the same machine. For nginx:

```nginx
location / {
    proxy_pass http://127.0.0.1:8090;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

### sld-editor.yaml {#configuration-editor}

The editor's own settings, read once at startup: restart the editor, then reload the page, after changing them. The
exceptions are `user_guide` and the two `xsde` files, which are read again on every use. A mistake in `palette` or
`hot_keys` or `cim.classes` stops the editor at startup with a message naming it.

| Key | What it sets |
|---|---|
| `server.bind` | Address and port the editor listens on, e.g. `0.0.0.0:8090`. |
| `logging.level` | Server log detail: `trace`, `debug`, `info`, `warn` or `error`. |
| `diagrams.dir` | Folder where diagrams are stored (the File panel's root). |
| `custom_elements.dir` | Folder whose `.xsld` files make the palette's **Custom elements** group. |
| `user_guide` | This guide's Markdown file; the Russian build shows `USER_GUIDE.ru.md` next to it. Empty hides **Help**. |
| `xsde.config` | `xsde2svg.yml` used by `.xsde` import (see below). Empty uses the converter's built-in copy. |
| `xsde.workplace` | `workplace.xml` used by `.xsde` import (see below). Empty: each file's own colors only. |
| `elements.libraries` | Element-library XML files (shapes, terminals), merged in order; a later file overrides a shape of an earlier one. |
| `editor.grid_spacing`, `snap`, `show_grid`, `background` | Defaults for a diagram that hasn't saved its own (see [Settings](#settings)). |
| `voltage_colors` | Standard voltage classes (`name`, `color`) offered for new classes and by **Match preset colors…**. A CIM import can add to it ([Voltage classes of a CIM import](#cim-voltage-colors)). |
| `voltage_color_tolerance` | How close (RGB distance, 0–441) a color must be to a standard one to be offered for replacement; 0 = exact only. |
| `state_colors`, `fpi_state_colors` | Open / Close / Intermediate (and, for switching devices, Faulty) fill colors of switching devices and fault passage indicators. |
| `position_states` | Labels of a withdrawable device's racking positions (Service / Normal / Test). |
| `indicators.default_fpi_text` | Text a fault passage indicator shows when it has none of its own. |
| `palette` | The Elements panel: groups (`name`, in display order) and their `items`, each an xsde2svg object type code. |
| `hot_keys` | Placement keys: a letter or digit → a palette item code (`r` and `m` are taken by rotate and mirror). |
| `cim.classes` | A symbol shape code, as in `palette` (`"28"` is a link to object) → the CIM classes an element of that shape can stand for, its default first ([CIM export](#cim-export)); a shape left out keeps the built-in list of its element class. Only CIM classes exported alike can be chosen: switches, machines, injections, shunts or auxiliary equipment (the file's comment lists them). |

Most single values can also be set by an environment variable named after the key path in capitals, e.g.
`SERVER_BIND`, `DIAGRAMS_DIR`, `XSDE_CONFIG`, `XSDE_WORKPLACE`, `EDITOR_GRID_SPACING` (lists comma-separated, e.g.
`ELEMENTS_LIBRARIES`). An environment variable wins over the file.

### xsde2svg.yml {#configuration-xsde}

Settings of the xsde2svg converter that `.xsde` import runs first (see [Importing](#import)). The bundled copy is the
one from the xsde2svg project; keep them in step when that project changes it.

| Key | What it sets |
|---|---|
| `colors` | The main table: a Modus color name (`черный`, `темно_голубой`, `10кВ`…) → an SVG color (`#962896`, `gray`). A color a diagram names but this table and the workplace don't know falls back to the default stroke. |
| `page.default.stroke` | Default line color when an object's own color can't be resolved. |
| `page.default.background` | Page background used when a page doesn't set its own color. |
| `page.default.width`, `high` | Not used: the page size comes from the objects themselves. |
| `page.grid.show`, `size` | Draws a grid into the converted page. Keep `show: false` for import. |
| `element_id_prefix` | Text put before every object id. **Keep it empty**: the import needs plain numeric ids. |
| `fonts` | Font substitution: a Modus font name → the font written into the SVG. |
| `units` | Measurement units grouped by quantity (`МОЩНОСТЬ`, `НАПРЯЖЕНИЕ`…), used by digital instruments (134). |

Besides these, a `.xsde` file brings its own color table (`<Styles>`): a color given there as `$BBGGRR` is used
directly, and a name it maps to another name is looked up in `colors`.

### workplace.xml {#configuration-workplace}

A Modus workplace style file (as saved by Modus GraphEditor), here only for its color palette: the `<Colors>` list of
`<Color name="…" value="…"/>`, e.g. the voltage classes under `КЛАСС_НАПР` (`0,4кВ`, `10кВ`, `110кВ`…). A `value` is
either `$BBGGRR` or a color name looked up in `xsde2svg.yml`'s `colors`. Other tables in the file are ignored.

When a diagram names a color that `colors` doesn't know, the converter looks it up here. A color the `.xsde` defines
itself replaces the workplace color of the same name. Without a workplace, diagrams that rely on the shared Modus
palette lose those colors (they fall back to the default stroke).

Colours matter to the editor: the import groups objects into **voltage classes** by color and names a class after the
`voltage_colors` entry of the same color. Wrong or missing colors show up as merged or unnamed voltage classes in the
import log. To match your Modus installation, replace `workplace.xml` with your own workplace file.

## Keyboard shortcuts {#shortcuts}

| Keys | Action |
| --- | --- |
| **Ctrl+C** / **Cmd+C** | Copy the selection |
| **Ctrl+V** / **Cmd+V** | Paste, offset from the original |
| **Ctrl+F** / **Cmd+F** | Find items (Properties → Find) |
| **R** / **Shift+R** | Rotate the selected devices 90° clockwise / counter-clockwise, each about its own anchor |
| **M** | Mirror the selected devices (on/off) |
| **Ctrl+G** / **Cmd+G** | Group the selection |
| **Ctrl+Shift+G** / **Cmd+Shift+G** | Ungroup the selected group(s) |
| A letter shown on a palette button (**T**, **C**, **D**, **B**, **W**…) | Arm that palette item; press again to disarm |
| **Ctrl+Z** / **Cmd+Z** | Undo the last change |
| **Ctrl+Shift+Z** / **Cmd+Shift+Z**, **Ctrl+Y** | Redo |
| **Delete** / **Backspace** | Delete the selection (or the selected bend of a wire, or point of a line or road) |
| **Esc** | Cancel the current tool or wire; otherwise clear the selection |
| **Space** (hold) | Pan by dragging, even while a tool is armed |
| **Enter** | Close the polygon being drawn, or finish the line or road being drawn |
| **Shift** / **Ctrl** / **Cmd** + click | Add or remove an item from the selection (on a Mac: **Shift** or **Cmd**) |
| **Ctrl** / **Cmd** + drag | Move the dragged item or selection; from empty canvas, draw a selection frame |
| **Alt** / **Option** + drag | Duplicate the dragged item or selection |

Shortcuts are ignored while typing in a text field.
