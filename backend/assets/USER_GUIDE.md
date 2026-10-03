# SLD Editor — User Guide

SLD Editor is a browser-based editor for single-line diagrams of power networks. A diagram is saved as an `.xsld`
file (the source of truth) together with an `.svg` rendering in the xsde2svg format that SCADA viewers use.

This guide describes how to work with the editor. For installing and running it, see `README.md`.

## The window

- **Left rail**: buttons for the **File**, **Elements** and **Settings** panels (they share the left side; one is
  open at a time), the **Properties** toggle, and **Help** (this guide) and **About** at the bottom.
- **Canvas**: the diagram itself, with zoom buttons in the bottom-right corner.
- **Properties** panel: docked on the right. It can stay open together with the Elements panel.

The browser tab shows the open diagram's name, with `*` when it has unsaved changes. The editor guards them against
being lost: see *Unsaved changes* below.

## Diagrams and files

### Creating and opening

- **File → New** asks for a name, the page width and height, and a default voltage. The diagram is created in the
  folder the File panel currently shows; a name may contain `/` to create it in a subfolder.
- **File → Open** is a folder browser: click a folder to enter it, `..` to go up, a diagram to open it.
- When an opened diagram has no default voltage, the editor asks for one. It is used for newly placed elements and
  wires.

### Importing

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

### Saving and exporting

With nothing selected, the Properties panel shows the diagram itself:

- **Save** writes the `.xsld` and its `.svg`. **Save As** saves a copy under a new name in the same folder.
- **Download XSLD** / **Download SVG** save the files to your computer.
- **Width**, **Height** and **Background color** of the page, and the **Layers** and **Voltage classes** of the
  diagram (see below).

When you open an older diagram, the editor may repair its connections (see *Connections* below); the diagram is then
marked as changed. Save it to keep the repair.

### Unsaved changes

- Opening another diagram, creating a new one, or importing a file while the open diagram has unsaved edits first
  asks: **Save** (then continue), **Don't save** (drop the edits) or **Cancel** (stay where you are). A repair made
  automatically on opening doesn't count as an edit.
- Closing or reloading the browser tab with unsaved edits shows the browser's own "Leave site?" warning.
- While you edit, the editor keeps a recovery copy of the unsaved changes in your browser. If the tab was closed or
  crashed before you saved, the next time you start the editor (or open that diagram) it offers to **Restore** them,
  still unsaved, or **Discard** them; **Decide later** keeps the copy for next time. Saving deletes the copy. The copy
  lives only in this browser on this computer.

## Moving around the canvas

| Action | How |
| --- | --- |
| Zoom | Mouse wheel, or the zoom buttons |
| Fit the page | The bottom zoom button |
| Pan | Hold **Space** and drag, or drag with the **middle mouse button** |

A plain left-drag on empty canvas does not pan: it draws a selection frame.

## Placing elements

1. Open the **Elements** panel and expand a group.
2. Click an element to arm it (the button stays highlighted), then click the canvas to place it. Placing is
   single-shot: the element is disarmed afterwards. Click the button again or press **Esc** to cancel.

Some elements are drawn instead of clicked:

- **Busbar**, **Line**, **Road**, **Arrow**, **Rectangle**, **Small window**, **Circle**, **Button**, **Window icon**,
  **Table**, **Arc**: press on the canvas and drag from one corner or end to the other.
- **Polygon**, **Container**: click once per corner. Click the first corner again (or press **Enter**) to close it,
  **Backspace** removes the last corner, **Esc** cancels. A container is a frame drawn around a group of equipment
  (usually dotted) with a caption; Properties sets the caption's text, position, size, color and rotation. Pressing on
  the empty space inside a container still starts a selection frame; grab a container by its outline or caption.
- **Backdrop/image file**: drag a frame, then pick an image file (PNG, JPEG, BMP, SVG…) in the dialog that opens.
  The picture is stretched over the frame and saved inside the diagram file. It is placed beneath everything else, so
  it can serve as a backdrop. Until an image is chosen the frame is drawn dashed. In Properties, **Replace image…**
  picks another file and **Fit to image proportions** sets the frame's height from its width and the image's own
  aspect ratio.
- **Text** places a free text label; **Digital device** places a SCADA value readout.

Newly placed elements start at the default voltage (switching devices start closed). A device's fixed connection
points (its **terminals**) are shown as small crosses while it is selected: green where something is connected (a wire,
or another device's terminal on the same point), red where the terminal is still free.

## Selecting

| Action | How |
| --- | --- |
| Select one item | Click it |
| Add or remove an item | **Shift**-click or **Ctrl**-click (**Cmd**-click on a Mac) |
| Select everything inside an area | Drag **left → right** from empty canvas: a solid frame picks only items fully inside it |
| Select everything an area touches | Drag **right → left** from empty canvas: a dashed frame picks every item it touches |
| Add a frame to the current selection | Hold **Shift** or **Ctrl**/**Cmd** while dragging the frame |
| Clear the selection | Click empty canvas, or press **Esc** |

While the frame is being dragged, the items it would pick are highlighted. When more than one item is selected, a
dashed box is drawn around the whole group, and Properties shows how many items are selected.

## Moving, copying and deleting

| Action | How |
| --- | --- |
| Move | Drag an item. Dragging any item of a multi-selection, or empty space inside its dashed box, moves the whole group |
| Duplicate by dragging | Hold **Alt** (**Option** on a Mac) and drag an item: a copy follows the cursor and the original stays. With a multi-selection, the whole group is copied |
| Copy | **Ctrl+C** (**Cmd+C**), or right-click → **Copy** |
| Paste | **Ctrl+V** (**Cmd+V**) pastes the copy two grid steps down and to the right of the original, a step further with each paste. Right-click → **Paste** pastes it where you clicked |
| Delete | **Delete** or **Backspace**, or right-click → **Delete** |

A pasted or duplicated copy becomes the new selection. Copies keep their wires and connections, and get new names
(`Breaker-12`). The copy buffer lasts while the browser tab is open and can be pasted into another diagram.

Moving respects **Snap to grid** (Settings). Wires attached to a moved device follow it.

## Wiring

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

### Editing a wire

Select a wire to show its handles:

- Drag a square handle to move a bend; the wire stays orthogonal.
- Drag a round handle (the middle of a segment) to add a bend there, or double-click the wire.
- Click a bend handle and press **Delete** to remove just that bend.
- Right-click a wire → **Delete segment** removes only the segment under the cursor.

A wire end that is not attached to anything is allowed; you can connect it later by dragging its hollow square end handle
exactly onto a device terminal, another wire's end or a busbar.

## Connections

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

## Custom elements

Custom elements are predefined groups (for example a breaker with its disconnectors and ground switches) that you
place like a single element.

- They are listed in the Elements panel's last group, **Custom elements**. Arm one and click the canvas to place a
  copy of the whole group; its wires and connections come along.
- To create one, select the items, right-click → **Save as custom element…**, and enter a name. If the name is taken,
  the dialog offers to overwrite it. The new element appears in the palette at once.
- They are stored as ordinary `.xsld` files in the server's custom-elements folder, so they can also be edited by
  opening the file as a diagram.

## Properties

Select a single item to edit it in the Properties panel:

- **Devices**: name (the caption icon beside it adds a text label with the name, linked to the device and placed to
  its right: size 10, left-aligned, bottom anchor, Arial, white), voltage class, state (for switching devices), orientation and mirror, **Size** (the xsde2svg size
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

### Layers and voltage classes

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

## Settings

Grid spacing, **Snap to grid**, **Show grid**, **Show nodes** and the diagram's default voltage. These are saved with
the diagram.

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| **Ctrl+C** / **Cmd+C** | Copy the selection |
| **Ctrl+V** / **Cmd+V** | Paste, offset from the original |
| **Delete** / **Backspace** | Delete the selection (or the selected bend of a wire) |
| **Esc** | Cancel the current tool or wire; otherwise clear the selection |
| **Space** (hold) | Pan by dragging |
| **Enter** | Close the polygon being drawn |
| **Shift** / **Ctrl** / **Cmd** + click | Add or remove an item from the selection |
| **Alt** / **Option** + drag | Duplicate the dragged item or selection |

Shortcuts are ignored while typing in a text field.
