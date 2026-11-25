# Open questions

Undecided questions. When one is decided, record the decision where it belongs (design doc, README, user guide,
TODO.md) and remove it here.

## SCADA bindings (RSDU)

1. **Jumps to other editor diagrams.** Jumps to RSDU objects are stored explicitly in the `.xsld` (`kind="jump"`)
   and encoded the RSDU way only on export. Open: should a jump to another editor diagram (TODO.md "Links between
   diagrams") use the same binding with source `editor`?
2. **Register a scheme without exporting.** The design plans a **Register** button in the link dialog that creates
   the `VS_FORM` row without exporting components, so the scheme exists early (e.g. for an administrator to add it to
   `US_MENU`). Today a scheme is registered only by an export. Needed?
3. **Default RSDU group of a new scheme.** The design says the last group chosen per diagram folder becomes that
   folder's default. The editor proposes the group of the scheme exported last, whatever its folder. Keep that, or
   remember a group per folder?
4. **Edit from RSDU: concurrent edits.** A scheme edited at the same time in RSDU's own scheme editor and in this
   editor: the later export wins. Detect it (compare `VS_FORM` / `VS_COMP` with what the last import read) or accept?
   *Implemented 2026-11-18 with the default: not detected, the later export wins (stated in the guide and README).*
5. **Edit from RSDU: SVGs not made by xsde2svg.** `Extract` reads xsde2svg's markup (and the editor's own). A scheme
   whose SVG came from another tool imports as "Missing" placeholders. Refuse such a scheme, or offer its `.xsde` when
   one is available?
   *Implemented 2026-11-18 with the default: not refused; the form and import log show what was lost.* Found then:
   the pictures in ctrlroom's MinIO came from an older xsde2svg whose wires (`<polyline>`) carry no `data-type`, so
   they import without wires. Left as is (the guide says to import the `.xsde`); reading them by stroke style (width
   1 → 21, 3 → 22, dashed → 23, 4 → 24, arrow marker → 28, checked on one scheme) was offered and declined.
6. **Edit from RSDU: folder of the fetched diagram.** With `full_path: true`, mirror the folder part of `FILE_NAME`
   (a Modus path) under the diagrams directory, or always use the folder open in the File panel?
   *Implemented 2026-11-18 with the default: with `full_path: true` the folder of `FILE_NAME` (drive letter dropped),
   else the current folder; both editable, an existing diagram never overwritten.*
