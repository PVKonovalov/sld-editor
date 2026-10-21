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
  buttons.
- **Rename or move** asks for the new path from the top folder, filled in with the current one. Change the last
  part to rename it, or the folder part to move it (for example `region1/sub-5` → `archive/sub-5`). Missing folders
  are created. A folder moves with everything in it, and it can't be moved into itself. When the open diagram is
  renamed or moved, directly or with its folder, it stays open under the new name, page address included, and its
  unsaved edits are kept.
- **Delete** asks first and can't be undone. It removes a diagram's `.xsld` and `.svg`. Only an empty folder can be
  deleted, and the open diagram can't be deleted.
- Both dialogs list the other tabs (by IP address) that have the diagram, or anything in the folder, open. Those
  tabs are not told about the change: saving there writes the diagram back under its old name.

### Importing {#import}

- Drop `.xsld`, `.svg` or `.xsde` files anywhere on the window, or use **File → Load from file…**.
- A Modus `.xsde` diagram is converted with xsde2svg first, then imported like its `.svg`. A single-page `.xsde`
  opens in the editor; each page of a multi-page one is saved into the current folder as `<name>`, `<name>_1`,
  `<name>_2`…, like several files at once.
- One file opens in the editor as an unsaved diagram. If a diagram of that name already exists in the current
  folder, the editor asks before loading it (saving would overwrite it).
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

### Saving and exporting {#save-export}

With nothing selected, the Properties panel shows the diagram itself:

- **Save** writes the `.xsld` and its `.svg`. **Save As** saves a copy under a new name in the same folder.
- **Export**: pick a format and press **Download** to save the diagram to your computer: **XSLD** (the diagram file),
  **SVG** (the picture), or **CIM, CGMES 3.0** for other power system tools (see [CIM export](#cim-export)). The
  format you picked last is remembered in this browser.
- **Width**, **Height** and **Background color** of the page, and the **Layers** and **Voltage classes** of the
  diagram (see [Layers and voltage classes](#layers)).
- **History**: when the diagram was saved and from which IP address (see [Several people on one diagram](#history)).

### CIM export {#cim-export}

**Export** with the **CIM, CGMES 3.0** format saves a zip of two CIM files (IEC 61970-552 RDF/XML, CGMES 3.0): `<name>_EQ.xml`, the
equipment and how it is connected, and `<name>_DL.xml`, the diagram layout (IEC 61970-453) that places it. Unsaved
edits are included.

- The diagram becomes one substation with a voltage level per voltage class. A class's nominal voltage is read from
  its name ("110 kV", "6,3 кВ", "400 V"; a bare number is kV).
- Each device becomes its CIM class (breaker, disconnector, load break switch, ground disconnector, fuse, power
  transformer with an end per winding, synchronous machine, shunt or series compensator, busbar section, ground)
  with a terminal per connection point. A changeover knife switch becomes two disconnectors from its pivot. A switch's
  state gives its normal position; no state means closed.
- Each overhead or cable line becomes an AC line segment in a line of its own name.
- Buswork wires, a busbar's connection points, junctions, wire jumps, poles, cable joints, current transformers,
  fault indicators and blocking filters join what they touch into one connectivity node. Current and voltage
  transformers, surge arresters, fault indicators and blocking filters are exported as auxiliary equipment on that
  node.
- Text labels become text objects, linked to their device; layers become visibility layers. Decorative shapes, links
  to object, digital devices and pictures of substations or power plants are not exported.
- Identifiers are derived from the diagram's name and item ids, so exporting the same diagram again keeps them.

Values the files need but the diagram doesn't have (see [Electrical parameters](#electrical-parameters)) are written
as 0, or as the voltage class's nominal voltage for a rated voltage. Under the Export row, the export lists each such
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
  **Close**; **Open** and **Intermediate** stop the trace, and so does a withdrawable device not racked in (any
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
`hot_keys` stops the editor at startup with a message naming it.

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
| `voltage_colors` | Standard voltage classes (`name`, `color`) offered for new classes and by **Match preset colors…**. |
| `voltage_color_tolerance` | How close (RGB distance, 0–441) a color must be to a standard one to be offered for replacement; 0 = exact only. |
| `state_colors`, `fpi_state_colors` | Open / Close / Intermediate fill colors of switching devices and fault passage indicators. |
| `position_states` | Labels of a withdrawable device's racking positions (Service / Normal / Test). |
| `indicators.default_fpi_text` | Text a fault passage indicator shows when it has none of its own. |
| `palette` | The Elements panel: groups (`name`, in display order) and their `items`, each an xsde2svg object type code. |
| `hot_keys` | Placement keys: a letter or digit → a palette item code (`r` and `m` are taken by rotate and mirror). |

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
