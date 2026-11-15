# Verification — complete through Phase 8 + Workflow Repair

## Workflow repair verification — 2026-11-14

All workflow blockers recorded during the 2026-11-14 walkthrough have been resolved and verified end-to-end:

- **Existing map path (`Import Backdrop → Trace Geography → Populate Existing Geography → Develop Area → City → Interior`):**
  - Local backdrop tracing runs in `trace.worker.ts` with palette-based water detection, blue-dominance filtering, connected-component speckle cleanup, contour extraction (`maskPolygons`), and Zhang-Suen river skeletonization.
  - `TraceGeographyDialog.tsx` previews land, lakes, and river paths over the backdrop with water-colour sampling, sensitivity, land/water brushes, river correction, undo/redo, and one-step transactional `map.applyTrace`.
  - `Populate Existing Geography` fits tectonic elevation, climate, Priority-Flood drainage, rivers, and settlement suggestions inside accepted/traced land and lakes without replacing coastlines or treating synthetic `usage: 'boundary'` rectangles as dry land. Contradictory manual rivers outside land report a clear error without moving the river.
- **New world path (`Empty World → Generate Entire Map → Group Selection / Edit Parts → Develop Area → City → Interior`):**
  - Unified editor navigation (`navigateToMap` / `activateMapPanel`) updates the active map panel and editing context together while keeping secondary map panels and the player window independent. Auxiliary panels (`Generator`, `Assets`, `Places`, `Settings`) dock into the right-hand inspector pane so the `Maps` tree stays accessible.
  - Shared geography resolver (`geom/geography.ts`) resolves implicit/explicit ocean (`world extent − land`) and inland lakes consistently across rendering, child inheritance, biome painting, and city obstacle checks.
  - Group ownership (`groupId`, `group.applyTransform`, `Edit Parts`, `Return to generated`) selects and transforms generated results atomically without turning untouched generated members manual or leaving stale duplicates on reroll.
  - Plate-based terrain (`tectonics.ts`, `algorithmVersion: 2`) and Priority-Flood drainage (`drainage.ts`) drive connected mountain/rift structure and outlet-rooted rivers with physical widths in metres and bounded cartographic widths at world/region scale.
  - Configurable dungeon corridor width (default 2 squares / 10 ft), corridor-contact door openings, post-wall movement connectivity validation, shuffled room purposes, distinct built-in prop/terrain glyphs, and bounded screen-space selection highlights.
- **Verification:**
  - `npm run check`: passed, 48 files / 178 unit tests.
  - `npm run build`: passed (including `trace.worker` and `generation.worker`).
  - `npx playwright test`: passed, all 28 Electron E2E tests (including both end-to-end walkthroughs in `e2e/workflow-repair.spec.ts` and visual inspection of `world-cartography.png`, `town-cartography.png`, `trace-review.png`, `populated-trace.png`, and `traced-town-interior.png`).

## Earlier walkthrough notes (resolved above) — 2026-11-14

The manual walkthrough exposed a missing part of the core vision: populate a map from a backdrop reference or traced geography while preserving defined land/water boundaries and rivers. Import, tracing, procedural world generation and child-map inheritance exist individually, but the UI does not provide a complete, direct preserve-and-populate flow connecting them. The user explicitly confirmed this is a core requirement. Developing a child region only inherits existing shapes and does not close the gap. Earlier automated-verification completion statements below describe tested features, not completion of this core workflow.

The user is currently collecting notes, **not authorizing fixes**. Record this as a core blocker for later implementation discussion; do not substitute further manual tracing or child-map creation for the missing generation step. Related import zoom, draft Undo, inferred ocean, river width/branching and biome brush/picker findings are in `USER_CHECKS.md`.

## Fresh-world generation walkthrough failures — 2026-11-14

- **Map switching blocks access to the dungeon after parent/child zoom navigation.** User reports both untouched-dungeon reroll/Undo/Redo and save/reopen passed, but the map list then failed to change the displayed map after zoom transitions. Source shows map-list clicks updating only global `activeMapId` while the renderer continues honoring the panel-specific map set by zoom. Treat as a navigation blocker, not confirmed lost map data. Notes only.
- **World → developed settlement → city generation is blocked.** User confirms `No buildable ground remains inside this footprint`, followed by `Choose a city footprint no larger than 16 square kilometres` during resizing. Generated ocean covers the entire world footprint beneath visible land; inheritance retains it and city generation subtracts water without resolving that land/ocean overlap. This explains the dry-looking ground being unavailable, pending inspection of the exact saved constraints. The size guard uses bounding-box area, with no adequate size guidance while drawing/resizing and broken child overview/zoom. Both errors are recorded in `USER_CHECKS.md`; do not treat further manual resizing as the solution.
- Developed child-map navigation fails to offer a whole-area overview: user reports a top-left jump at the zoom handoff followed by panning only. Source shows zoom limits that can prevent fitting large children, automatic parent return at child minimum zoom, and destination zoom clamping without corresponding camera-offset correction. The actual child extent/camera still needs verification. This blocks the Develop Area walkthrough.
- Generated rivers visibly start/stop in apparently arbitrary inland locations. Record continuity and legible source/outlet failures; specific paths remain uninspected. The user also finds the overall generated appearance unsatisfactory and explicitly defers visual improvement until later.
- Fresh-generation screenshot shows settlement suggestions arranged in a narrow horizontal line with almost all remaining land snow-colored. Climate eligibility filtering may be restricting candidates to a thin latitude band due to the suspected bounds mismatch; live-world verification remains pending. Default mountain/hill art also reads as scattered pyramids, with both roles drawn using the same grey triangle.
  - Follow-up close-up shows tiny green/olive biome polygons around/beside the settlement strip. Other biomes exist but their coverage is severely compressed. Climate is generated before settlement placement, so these are eligible patches being chosen for settlement, not grass created by the house markers. This strengthens the shared climate-extent hypothesis without confirming the live bounds/settings.
- Clicking a built-in grey mountain/hill triangle floods the canvas with yellow selection color (user screenshot). Source points to a zoom-compensated selection stroke being multiplied by the built-in symbol's world-size scaling. Selection feedback can obscure the entire map.
- User reports Resize → Reroll produces a new landmass while leaving the old one. Static code is consistent with resized generated components becoming manual and therefore surviving reroll; the exact live entity/run remains unverified.
- Clicking/dragging the apparent landmass moves an individual biome area instead. Generated components lack coherent selection/group manipulation; accidental edits can become preserved manual fragments.
- User reports the output is overwhelmingly snow. Likely cause from source: climate uses unchanged root map bounds while the generation footprint can extend beyond them. Latitude extrapolation then produces extreme cold outside the assumed world extent. Verify against actual saved coordinates/settings before treating this as the confirmed cause.

These are failures in the main generation/editing workflow, not evidence that the user followed the wrong flow. Notes only; fixes remain unauthorized. Detailed observations and distinctions between reported behavior and static-code explanations are in `USER_CHECKS.md`.

## Notebook follow-up — 2026-11-14

Walkthrough addendum: the standalone dungeon result has now received direct user feedback: cramped one-square/five-foot corridors, a corridor/room contact without a visible doorway, and repetitive rocks/tables for dressing. The source's single-cell routing and minimum-connectivity door selection are consistent with the first two observations; exact saved doorway geometry and room-purpose settings remain uninspected. Details are in `USER_CHECKS.md`. Notes only; the earlier automated checks do not establish acceptable generated dungeon usability.

Implemented Place-linked scenery preservation, daily travel schedules/watch/camp marks, and P8 city/district generation. City output respects drawn constraints and district profiles, preserves named buildings/interiors on district rerolls, and uses portable fitted roof art. District runs are independent; choose the run by its footprint name. Actual enclosures and access roads remain drawn constraints.

Visual inspection also caught a renderer ordering bug: rebuilding a selected district fill appended it over buildings. Incremental rendering now restores model order. The city acceptance test compares the canvas before/after selection, allowing minor antialias differences while rejecting an overlay change.

- `npm run check`: passed, 46 files / 157 unit tests.
- `npm run build`: passed.
- `npx playwright test`: passed, all 25 Electron tests (57.5 seconds), outside the filesystem sandbox. No timeouts increased.
- Tests cover Place promotion/reroll/undo and locked layers; scheduled rest, partial days, overnight windows, exact finishes, marker interpolation and read-only MCP; city determinism, street frontage, non-overlap, holes, plateau edges, ordinary/secret gates, independent district rerolls, named interiors, fitted roof pixels and saved map files.
- Inspected [city](docs/verification/phase8-city.png), [fitted roof](docs/verification/phase8-roof-fit.png) and [scheduled travel](docs/verification/scheduled-travel.png). The blue/yellow roofs are deliberate test art for checking orientation, not supplied production art.
- No current verification blocker. The remaining city/art/travel preference checks are in `USER_CHECKS.md`. Dungeon loop/width and hydrology/climate improvements remain separate follow-ups.

## User-check pass — 2026-11-14

Completed ten original user-check entries and reduced the other thirteen to the checks that still need the user's preferences, actual packs, TV, second PC or Foundry. Details and inspected screenshots are in `docs/SELF_CHECKS.md`.

The city-reference workflow exposed a UI bug: Open Interior loaded the map but left Places in front when they shared a tab group. The button now activates its target map panel. Acceptance coverage checks that flow and reopening the same interior after restart.

- `npm run check`: passed, 45 files / 150 unit tests.
- `npm run build`: passed.
- `npm run e2e`: passed, all 24 Electron tests.
- No test timeouts increased. Electron tests run outside the filesystem sandbox.
- No current verification blocker. The portable EXE is not present in this checkout; packaging and second-PC execution remain pending.

## Previous phase-7 verification

P7.1 terrain is complete and committed as `fb7e016`. Its checks passed: 41 files / 135 unit tests, production build, and all 21 Electron tests. The rendered continent was inspected visually, including a manual central water cut.

P7.2 climate/rivers verification now passes. It adds persisted world climate, an editable custom biome table, parent-relative latitude, traced biome areas with manual overrides, downhill flow accumulation, rounded river paths, and generator settings/commands. Terrain draw order keeps manual edits above generated backgrounds. The phase-7 Electron test verifies custom biome editing, climate application, rivers, manual water preservation, reroll, undo/redo and persisted settings. The rendered continent was inspected visually.

P7.3 adds themed mountain/forest/hill symbols and unevenly spaced GM-only settlement suggestions. Checks cover deterministic placement, land/obstacle constraints, theme roles and built-in fallbacks, accept/dismiss/undo, player filtering, persisted suggestion markers and preservation of accepted places on reroll. The rendered decorated continent was inspected visually.

P7.4 adds re-climate to placement in the UI and MCP. Fixture copy/move/link checks prove that generated biomes adapt to the target world and latitude while manual areas, places/notes, coastline, rivers and developed child maps remain intact. Coverage and holes are preserved, including old climate under developed locations without footprint entities. App tests exercise an actual saved move with undo and an MCP copy.

The app test caught an existing transfer bug: generated entity fields acquired a different order after schema parsing, causing a false “World changed during transfer” error. Both snapshots are now normalized before comparison. A regression check proves generated moves apply undoably and that genuine newer edits still reject stale snapshots.

The previous blocker was a five-second timeout in this existing test:

```
src/renderer/gen/dungeon/dressing.test.ts:45
rerolls only dressing, preserves edits exactly, and scopes thin/add/reroll with one-step undo
Error: Test timed out in 5000ms.
```

Furniture placement repeatedly flattened wall geometry and recalculated nearest-wall distances during candidate sorting. Building the wall segments once and caching distances per candidate reduced the test from 3.78 seconds to 0.26 seconds in isolated runs. No assertions or timeouts were relaxed. The climate save assertion also checks the first biome rule directly, allowing the remaining built-in rules to stay in the table.

- `npm run check`: passed, 45 files / 147 unit tests.
- `npm run build`: passed.
- `npm run e2e`: passed, all 22 Electron tests.

No current automated-verification blocker. Phase 7 is complete. Human visual/art comparisons and the existing monitor/second-PC/Foundry checks remain in `USER_CHECKS.md`.

## Last completed phase-6 verification

- `npm run check`: passed, 39 files / 132 unit tests.
- `npm run build`: passed.
- `npm run e2e`: passed, all 20 Electron tests.
- Phase 6 checks cover deterministic output, flood-fill reachability of every clearing and entrance across water, bridge coverage and bridge length on a long manual trail, holes/concave footprints, manual area/prop/trail constraints, inherited land, water switches, themed art, reroll preservation, settings restoration, MCP commands, accept/undo and persisted generator records. The rendered woodland was inspected visually.
- Human forest/pyramid comparisons, real-art, TV/monitor, second-PC and Foundry checks remain in `USER_CHECKS.md`.

Electron cannot start inside this desktop app's filesystem sandbox (process exits before app startup). The same Electron suite runs successfully outside the sandbox. No app launch workaround or test timeout increase was added.

During P4.2, the new export test needed to wait for the renderer agent bridge before making MCP calls, and its status selector needed an accessible name to avoid Dockview's live status region. The saved image assertions then passed. The earlier P3.5 asset selector collision remains fixed.

The pre-existing uncommitted changes in `src/main/protocol.ts` and `e2e/backdrop-import.spec.ts` are preserved and remain outside all phase-7 work.
