# Phase 7 verification — complete through P7.4

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
