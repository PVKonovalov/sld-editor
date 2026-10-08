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
3. To turn a device, select it and change **Orientation** (or **Mirror**) in Properties; its terminals turn with it.
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
3. Use **Download SVG** / **Download XSLD** to get the files on your computer.

Optionally, organise items into [layers](#layers) before saving. See [Saving and exporting](#save-export).

## Diagrams and files {#files}

### Creating and opening {#create-open}

- **File → New** asks for a name, the page width and height, and a default voltage. The diagram is created in the
  folder the File panel currently shows; a name may contain `/` to create it in a subfolder.
- **File → Open** is a folder browser: click a folder to enter it, `..` to go up, a diagram to open it.
- When an opened diagram has no default voltage, the editor asks for one. It is used for newly placed elements and
  wires.

### Importing {#import}

- Drop `.xsld` or `.svg` files anywhere on the window, or use **File → Load from file…**.
- One file opens in the editor as an unsaved diagram. If a diagram of that name already exists in the current
  folder, the editor asks before loading it (saving would overwrite it).
- Several files at once are saved straight into the current folder; existing names are skipped, and the summary
  dialog can overwrite them.
- An `.svg` import (an xsde2svg drawing) shows an **import log**: what was recognised, the voltage classes found and
  what was skipped. **File → Show import log** reopens it.
- xsde2svg draws each device at its own size step (each step √2 larger). An `.svg` import recovers the step from where
  the device's connection points lie, so the symbol fills the gap between its wires. Devices whose leads also stretch
  per instance (breakers, disconnectors and similar) get their size from their drawn body and their **Leads** from
  their two connection points.
- A device lead that ends a unit or two beside a wire (a T-tap, such as a ground switch on a feeder) is connected to
  that wire on import, splitting it there.

### Saving and exporting {#save-export}

With nothing selected, the Properties panel shows the diagram itself:

- **Save** writes the `.xsld` and its `.svg`. **Save As** saves a copy under a new name in the same folder.
- **Download XSLD** / **Download SVG** save the files to your computer.
- **Width**, **Height** and **Background color** of the page, and the **Layers** and **Voltage classes** of the
  diagram (see [Layers and voltage classes](#layers)).

When you open an older diagram, the editor may repair its connections (see [Connections](#connections)); the diagram is then
marked as changed. Save it to keep the repair.

### Unsaved changes {#unsaved}

- Opening another diagram, creating a new one, or importing a file while the open diagram has unsaved edits first
  asks: **Save** (then continue), **Don't save** (drop the edits) or **Cancel** (stay where you are). A repair made
  automatically on opening doesn't count as an edit.
- Closing or reloading the browser tab with unsaved edits shows the browser's own "Leave site?" warning.
- While you edit, the editor keeps a recovery copy of the unsaved changes in your browser. If the tab was closed or
  crashed before you saved, the next time you start the editor (or open that diagram) it offers to **Restore** them,
  still unsaved, or **Discard** them; **Decide later** keeps the copy for next time. Saving deletes the copy. The copy
  lives only in this browser on this computer.

## Moving around the canvas {#navigation}

| Action | How |
| --- | --- |
| Zoom | Mouse wheel, or the zoom buttons |
| Fit the page | The bottom zoom button |
| Pan | Drag with the left mouse button anywhere, on empty canvas or on an item. Dragging with the **middle mouse button**, or holding **Space** and dragging, also pans (even while a tool is armed) |

A plain left-drag never moves an item: hold **Ctrl** (**Cmd** on a Mac) to move it (see [Moving, copying and deleting](#moving)).

## Placing elements {#placing}

1. Open the **Elements** panel and expand a group.
2. Click an element to arm it (the button stays highlighted), then click the canvas to place it. Placing is
   single-shot: the element is disarmed afterwards. Click the button again or press **Esc** to cancel.

Some elements are drawn instead of clicked:

- **Busbar**, **Arrow**, **Rectangle**, **Small window**, **Circle**, **Button**, **Window icon**, **Table**, **Arc**:
  press on the canvas and drag from one corner or end to the other.
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

## Moving, copying and deleting {#moving}

| Action | How |
| --- | --- |
| Move | Hold **Ctrl** (**Cmd** on a Mac) and drag an item. Ctrl/Cmd-dragging any item of a multi-selection, or empty space inside its dashed box, moves the whole group. Without the key a drag pans the canvas |
| Duplicate by dragging | Hold **Alt** (**Option** on a Mac) and drag an item: a copy follows the cursor and the original stays. With a multi-selection, the whole group is copied |
| Copy | **Ctrl+C** (**Cmd+C**), or right-click → **Copy** |
| Paste | **Ctrl+V** (**Cmd+V**) pastes the copy two grid steps down and to the right of the original, a step further with each paste. Right-click → **Paste** pastes it where you clicked |
| Delete | **Delete** or **Backspace**, or right-click → **Delete** |

A pasted or duplicated copy becomes the new selection. Copies keep their wires and connections, and get new names
(`Breaker-12`). The copy buffer lasts while the browser tab is open and can be pasted into another diagram.

Moving respects **Snap to grid** (Settings): the item you drag lands on a grid point (a device by its connected
terminal), even if it was off the grid before, and the rest of a moved group keeps its place relative to it. Text
labels and digital devices move in whole grid steps instead. Wires attached to a moved device follow it.

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
wire), **Overhead line**, **Cable line** or **Object link**. The kind cannot be changed later.

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

Joining a wire in the middle of another wire splits it and creates a real junction. Overhead and cable lines get an
automatic name (`Overhead line-12`).

### Editing a wire {#editing-wire}

Select a wire to show its handles (a click within a few pixels of a wire counts as a click on it):

- Drag a square handle to move a bend; the wire stays orthogonal.
- Drag a round handle (the middle of a segment) to add a bend there, or double-click the wire.
- Click a bend handle and press **Delete** to remove just that bend.
- Right-click a wire → **Delete segment** removes only the segment under the cursor.

A wire end that is not attached to anything is allowed; you can connect it later by dragging its hollow square end handle
exactly onto a device terminal, another wire's end or a busbar.

## Connections {#connections}

- Every device has a fixed number of connection points, defined by its shape: for example a breaker or a
  disconnector has two, a ground switch has one. They exist as soon as the device is placed and cannot be added or
  removed by the user.
- Several wires attached to the same terminal share it.
- Dropping a device so that one of its terminals lands exactly on a wire, a wire end or a busbar connects it there.
  A terminal that is only close to a wire still needs a wire drawn to it.
- A busbar gets one terminal for each connection point along it. Anything whose end lies exactly on the busbar is
  connected to it: a wire ended on it, a device terminal placed on it, or wire ends the busbar is drawn or moved
  over. A wire that only crosses a busbar is not connected. (A topology processor treats all of a busbar's terminals
  as one electrical node.)
- Rotating, mirroring or moving a device in Properties takes its connections along.
- Deleting a wire leaves the devices' terminals as they are. Deleting a device also deletes the wires attached to
  it.
- **Settings → Show nodes** marks every electrical connection point on the canvas with a small cross, green when
  something is connected there and red when it is free, which is useful for checking that things are really connected.
- The **Connections** section in Properties lists, for a selected device or busbar, each of its ports with the node
  it sits on (id and coordinates) and everything else attached there; for a selected wire, the same for its two ends.
  A port with nothing attached shows *not connected*, a wire end *free end*. Click a listed item to select it.

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

## Keyboard shortcuts {#shortcuts}

| Keys | Action |
| --- | --- |
| **Ctrl+C** / **Cmd+C** | Copy the selection |
| **Ctrl+V** / **Cmd+V** | Paste, offset from the original |
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
