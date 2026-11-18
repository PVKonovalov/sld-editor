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
