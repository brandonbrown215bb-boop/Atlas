# Pack import and trace report — 2026-11-14

The reported `TC Natural Assets V1.34.dungeondraft_pack` is a valid Godot PCK v1 archive (410,504,662 bytes, 8,881 directory entries). One missing thumbnail has offset 0 and size 0. The payload-overlap check incorrectly treated this empty entry as data overlapping the directory. Empty entries now skip that overlap check; nonempty payload bounds, overlap, paths, and checksums are still validated. Empty texture images still fail extraction.

The full supplied pack was extracted into a test cache and registered: **4,438 textures, zero skipped**. A synthetic regression covers the zero-offset thumbnail and rejection of a nonempty entry pointing into the directory.

The initial trace black screen was not reproduced against the earlier saved world. The subsequent panel error identified `RingOut.isExteriorRing` recursion. The current saved Overworld (revision 48, 624 entities) reproduces that exact overflow while computing ocean minus land in `resolveGeography`.

Near-coincident intersections cause polygon-clipping's output rings to acquire circular enclosure relationships. Geography boolean operations now retry this specific stack overflow with temporary operands rounded to a micron grid. Successful operations keep their exact coordinates; saved entities are never rounded or rewritten. A failed retry still raises an error. No dependency changes were needed.

A nine-vertex regression reduced from the actual failing operands checks area and sampled land/water membership, input preservation, exact coordinates on successful operations, and rejection of invalid input. The Electron regression renders that same coastline and checks visible land and water pixels. A separate copy of the full current world now opens and renders with all 624 entities, zero page errors, zero panel errors, and zero error banners. The original world was only read.

Panels also catch React rendering failures and show the error stack with Retry panel, keeping the rest of the app open. Uncaught canvas callback errors and unhandled promise failures appear in the existing dismissible error banner. The recovery regression injects a panel fault, restores the valid world, retries the panel, and verifies reporting of an asynchronous callback failure.

Validation after the coastline fix: typecheck and production build passed; 49 unit test files / 183 tests passed; all four coastline/recovery and workflow-repair Electron tests passed. The three asset Electron tests passed during the pack fix. Electron ran outside the filesystem sandbox because it cannot launch inside it.

## Deleted-layer generation failure

The later `Missing entity layer: …:41:ocean` failure was reproduced against Overworld revision 905. Its 52 entities included a manual ocean still referencing deleted layer `layer-5857522b`. The old `layer.delete` command removed the layer without moving or removing its entities. Generation's whole-world validation correctly rejected that existing broken reference.

Opening a world now restores missing entity layers under their original IDs as `Recovered contents`, preserving every entity. Apply Repair does the same for an already-open map as one undoable operation. Deleting a populated layer is now disabled in the UI and rejected by the command; empty layers remain removable. The original saved world was not rewritten by this fix.

The real-world copy was opened and populated through Electron with seed 3, the locked Base layer, and the unlocked geography output layer. It finished with 323 entities (52 originals, 270 generated, and a generation boundary), every original entity unchanged, valid layer references, and no generator or renderer errors. Unit checks cover recovery on load, idempotence, undo/redo of repair, committing worker generation, and rejection of populated-layer deletion. The new Electron regression covers Repair → Populate → Save. Typecheck, production build, 185 unit tests, and all three layer-recovery/workflow Electron tests passed.

## Settlement suggestions restricted to the first traced island

The reported twelve suggestions were generated inside a saved 9.2 km island boundary, while the map is 368 km wide. Group selection supplied several traced land polygons; GeneratorPanel silently chose the first area as the entire run's boundary. The settlement sampling algorithm was operating on that tiny intended region, not the full map.

World generation now has an explicit `Generate across` choice, defaulting to Entire map. Selected area requires one selected polygon, so a trace group cannot silently choose its first island. The `generator.run` command honors `entireMap` even if an area ID is also supplied. `generator.reroll` supports `entireMap` to replace a small run's saved boundary with the current map bounds and replace its existing untouched output in one undo step. Manual geometry and other runs are preserved.

The generator panel also accepts commands with no return value, fixing the unrelated `Cannot read properties of undefined (reading 'genId')` message after successful settings changes.

The actual saved run was rerolled in a separate world copy using Entire map, Populate existing geography, and seed 2. All twelve suggestions moved out of the old tiny-island cluster and now cover five authored land regions. Old generated output was replaced, manual entities were identical, and Electron reported no generator or page errors. Unit tests cover an explicit selected-area run, whole-map generation overriding a selected island, expanded reroll, manual preservation, and undo. The new Electron test covers a selected trace group, scope controls, settings changes, whole-map distribution, reroll, and Accept. Typecheck, production build, 186 unit tests, and five relevant Electron tests passed.

## Unclosed output ring precision failure

The next saved Overworld (revision 1703, 411 entities) reproduced `Unable to complete output ring` during the land union. Its reported endpoints differed by approximately 2e-11 metres. The earlier precision retry only recognized a stack overflow, so it did not handle this second numerical failure.

The shared clipping helper now recognizes polygon-clipping's unclosed-ring and sweep-line topology failures as well as the earlier nesting overflow. It retries once with temporary operands on the same micron grid. Invalid input and unrelated errors still propagate; a failed retry also propagates. Both Polygon and MultiPolygon operands are supported. Every runtime boolean clipping caller now uses this helper, covering generation, geography, editing, fog, SVG import, inheritance, city diagnostics, and transfers. Successful operations and saved inputs remain exact.

A six-vertex fixture reduced from the real failing union checks total land area, sampled point membership, closed finite output rings, Polygon operands, and unchanged source geometry. The full saved world renders successfully after the fix. A separate copy also opened and rerolled through Electron with no page or generator errors, preserving manual geometry and replacing the old generated output. Typecheck, production build, all 187 unit tests, and the complete 32-test Electron suite passed.
