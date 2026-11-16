# Campaign Atlas — Code Audit (2026-11-16)

**What this repo does:** Campaign Atlas is an offline Windows desktop app (Electron, React, PixiJS) for drawing and generating fantasy maps: worlds, cities, dungeons and building interiors. It saves each world as a folder of JSON files. It also runs a local MCP server so an AI agent can edit the open world. ("MCP" is the protocol AI tools use to call an app.)

**Load assumed:** one person at one desktop, sometimes with one AI agent driving it through MCP. Maps hold a few thousand items: the largest sample is a 3,469-entity city, and the city generator can reach about 15,000.

**How this was checked:** All of `src/main/` and the renderer save/command code were read in full. Generators, rendering and tools were partly read (see *Not checked*). Findings 3, 4, 9 and 15 were reproduced with scratch scripts. The rest come from reading the code and its callers. No code was changed.

---

## Recommended order of changes

| Step | Findings | Why first |
|---|---|---|
| 1. Stop unsafe file writes | 1 | Security: writes outside the world folder |
| 2. Make saving reliable | 2, 5, 6, 3, 8, 7 | Edits or backups can be lost without warning |
| 3. Fix wrong results | 4, 9, 12, 13, 10, 11 | Data or display is wrong, but nothing is lost on disk |
| 4. Add the missing tests | 19 | Lock in steps 2 and 3 so they don't come back |
| 5. Fix slow paths | 15, 16, 17, 24, 25 | Freezes and lag on big maps |
| 6. Small fixes | 14, 18, 21, 22, 23, 26, 27, 28 | Low risk, small diffs |
| 7. Lean clean-up | 20, 29 | Less code to read and keep in sync |

### Status (2026-11-16, branch `fix/audit-save-safety`)

- **Fixed:** 1–15, 17–19, 21–29.
- **Partly fixed:**
  - **16:** The O(n²) wall-hatch scans and the stale overlays are fixed. Overlays and child previews are still rebuilt on every pan, but that cost now grows only in proportion to map size.
  - **20:** Duplicate area, clipping, point-in-ring and distance helpers are merged, and unused exports are removed.
- **River nodes (follow-up to 20):** `map.riverNodes` is no longer stored. `river.add` works out junctions from the rivers on the map, so a deleted or rerolled river leaves no junction to snap to. Old files that have the field still load; it is dropped on the next save.
- **Not done:**
  - `visual-review/` is still tracked in git; that waits for the owner's decision.

---

## Must fix

### 1. The AI agent, or a crafted world, can write files anywhere on disk
`src/main/worldFs.ts:191`, `src/main/worldFs.ts:238-243`, `src/renderer/model/commands.ts:684`
- **What this is:** Each map is saved to `maps/<mapId>.json`, and the map ID comes from the command input or from `world.json`.
- **Problem:** Nothing checks the ID's characters. An agent can run `map.create` with an ID like `../../../AppData/Roaming/Code/User/settings`, and autosave overwrites that file two seconds later. Opening a crafted world folder reads files outside it the same way. `src/main/transferFs.ts:14` already has the right check, but only for transfers.
- **Recommended change:** Move that check into `readAndParseWorld` and `saveDirtyWorldFiles` (allow only `/^[\w-]+$/`), and reject a payload whose key differs from `mapDoc.id`. Optionally add the same regex to `WorldMapSummarySchema.id` and to the `id`/`newId`/`childMapId` command inputs.
- **If we skip it:** A prompt-injected agent, or a world someone shared, can overwrite any `.json` file the user owns.

### 2. Switching worlds throws away the last edits
`src/renderer/app/App.tsx:258-283`, `src/main/agent.ts:196-231`, `src/renderer/model/agentBridge.ts:58-67`
- **What this is:** Edits are saved 2 seconds after the last change.
- **Problem:** Opening or creating a world (from the menu or the MCP `world_open`/`world_create` tools) makes the new world the open one, then `loadWorld` clears the unsaved changes. Nothing saves them first. If the delayed save fires in between, the main process refuses it with "not currently open".
- **Recommended change:** `await flushDirtyWorld()` before `openWorld`/`createWorld`/`restoreBackup` in `App.tsx`. For MCP, add a `world_flush` case to `handleAgentCall` and have `agent.ts` call it before `deps.openWorld`/`deps.createWorld`.
- **If we skip it:** An agent that edits and then opens another world loses those edits without any warning.

### 3. Undoing a map transfer is never saved
`src/renderer/model/commands.ts:1265-1272`, `src/renderer/model/store.ts:49-55`
- **What this is:** `world.applyTransfer` replaces all maps with `draft.maps = next.maps`.
- **Problem:** That makes one change record for the whole `maps` object. The code that marks maps "unsaved" only reacts to changes inside a single map, so after undo nothing is marked. Reproduced: undo a linked transfer and the link disappears on screen, then comes back on reopen.
- **Recommended change:** Assign maps one by one, the way `world.applyGenerated` already does: delete IDs that are gone, then `draft.maps[id] = next.maps[id]`.
- **If we skip it:** Undo looks like it worked, but the file on disk still has the old state.

### 4. "Replace" placement marks every area on the parent map as hand-made
`src/renderer/model/transfer.ts:102-110`
- **What this is:** When a map is placed with "replace", existing areas are cut out under its footprint.
- **Problem:** Every area goes through `replaceArea`, even ones far away that don't change, and each one becomes `origin:'manual'` with a new revision. Paths skip unchanged items (line 115); areas don't. Reproduced by running it.
- **Recommended change:** Skip an area when the cut gives back its original rings (mirror line 115), or add a bounding-box overlap check first.
- **If we skip it:** Every generated biome and building becomes "manual", so the next reroll duplicates them instead of replacing them, and linked sync reports everything as changed.

### 5. Closing the app can drop unsaved edits
`src/main/index.ts:68`, `src/preload/index.ts:19-21`
- **What this is:** On close, the app asks the renderer to save, then closes.
- **Problem:** The window is destroyed after 1.5 seconds no matter what, and it also closes when the save failed (preload sends "ready" in `finally`).
- **Recommended change:** Send an ok/failed flag with `atlas:ready-to-close`. On failure, cancel the close and show the error with a "Quit anyway?" dialog. Make the timeout much longer, or only use it when the renderer is hung.
- **If we skip it:** A slow save on a big world, or a failed one (for example, a Windows file lock on rename), closes with the edits gone.

### 6. One invalid map blocks every later save, and nothing retries
`src/renderer/model/persistence.ts:41-52`, `src/main/worldFs.ts:238-243`, `src/renderer/model/commands.ts:1512`
- **What this is:** Main checks each map against the schema while it writes them, one at a time.
- **Problem:** Commands don't check their own result. For example, `map.applyTrace` accepts `layerId: ""`. Saving that map throws halfway through the loop, so later maps aren't written, and every future save throws again. `flushDirtyWorld` has no `catch` and no retry.
- **Recommended change:**
  - In `saveDirtyWorldFiles`, parse all maps first, then write. Name the failing map in the error.
  - In `map.applyTrace`, use `layerId: z.string().min(1)` and check that the layer exists.
  - In `persistence.ts`, catch the error, keep the unsaved flags and schedule a retry.
- **If we skip it:** The user sees an error banner while nothing gets saved.

### 7. Copying a map to another world deletes that world's real backups
`src/main/transferFs.ts:83`
- **What this is:** `copyAssetSet` copies art files into the target world.
- **Problem:** It makes a full world backup for every new art file, and only 20 backups are kept. A map with 25 new images replaces all older backups with 20 near-identical ones. Those backups don't even help: they hold JSON, not art files.
- **Recommended change:** Delete `createBackup(targetPath);` on that line. `writeWorldTransaction` already makes a backup.
- **If we skip it:** One transfer wipes the target's restore history, and big worlds copy slowly.

### 8. A damaged index file is silently treated as empty, then overwritten
`src/main/worldFs.ts:318-323`, `src/main/packs.ts:199-200`
- **What this is:** `readAssetsIndex` and `PackLibrary.load` return `{}` or `[]` when parsing fails.
- **Problem:** The next image import (`importImageAsset`) or pack registration writes that empty list plus one new entry back to disk.
- **Recommended change:** Return empty only when the file is missing. If it exists but won't parse, throw.
- **If we skip it:** One bad entry, or a schema change, erases the metadata for every image in the world or every registered pack.

### 9. Moving a map moves revealed fog but not explored fog
`src/renderer/model/transfer.ts:78`
- **What this is:** Placement moves, rotates and scales everything in the copied map.
- **Problem:** Only `fog.revealed` is moved. `fog.explored` (the players' "already seen" memory) stays where it was. Reproduced by running it.
- **Recommended change:** Apply the same point mapping to `m.fog.explored` when it exists.
- **If we skip it:** After a rotated or scaled transfer, the player view shows remembered areas in the wrong place.

### 10. Open doors still block light and line of sight
`src/renderer/geom/visibility.ts:11-25`
- **What this is:** Wall segments are collected as light blockers.
- **Problem:** The door tool puts a door on top of a wall without cutting the wall. Opening the door removes the door blocker, but the wall underneath still blocks. UVTT export already cuts these gaps (`src/renderer/export/uvtt.ts:35-46`).
- **Recommended change:** Move that gap-cutting into a shared helper in `geom/` and use it in `collectLightBlockers` for open doors.
- **If we skip it:** Lighting, and the MCP line-of-sight command, show open doorways as dark.

### 11. Old walls and road edges stay on screen after switching maps
`src/renderer/render/MapView.tsx:351-355`, `src/renderer/render/MapView.tsx:565-571`
- **What this is:** Each layer gets one combined drawing for wall networks and road outlines.
- **Problem:** These drawings are only rebuilt for layers that currently show an item. Every new map uses the layer ID `layer-base`, so going from a dungeon to an empty map leaves the dungeon's walls drawn.
- **Recommended change:** On a map switch, clear the overlays for every entry in `layerContainers`, not just the layers being shown (or destroy `layerContainers` in the map-switch branch).
- **If we skip it:** "Ghost" walls appear on blank maps. This comes from reading the code; check it in the app first.

### 12. Rerolling after the boundary is deleted brings it back as a land area
`src/renderer/gen/framework.ts:58`, `src/renderer/gen/framework.ts:138`
- **What this is:** If the boundary area is gone, the generator builds a stand-in from the saved boundary.
- **Problem:** For city and world generators, line 138 then writes that stand-in into the map as a real manual land area.
- **Recommended change:** Use `...(source ? [region] : [])` at line 138.
- **If we skip it:** Deleted footprints come back as filled land after a reroll.

---

## Should fix

### 13. The locked-layer rule is checked in some commands and not others
`src/renderer/model/commands.ts:370-480`, `src/renderer/model/commands.ts:1336-1346`
- **What this is:** A locked layer is supposed to be read-only.
- **Problem:** `prop.stamp`, `entity.setTexture`, `map.importSvg`, `map.paintGeography` and `generator.dressArea` check the lock. `entity.add/update/delete/duplicate` and `map.paintBiome` don't, and `entity.update` can move an entity to a layer that doesn't exist. Painting a desert cuts into a forest on a locked layer, and the agent can edit locked content.
- **Recommended change:** One `assertEditableLayer(map, layerId)` helper, called in those commands (it also checks that the layer exists). In `paintBiome`, skip locked areas the way `paintGeography` does.
- **If we skip it:** Locking doesn't protect the work.

### 14. Asset tag and scale changes can overwrite each other
`src/main/packs.ts:210-262`
- **What this is:** `setAssetTags` and `setScale` read the list in memory, write it to a temp file, then rename it.
- **Problem:** Two quick calls both start from the same old list, and both use the same `.tmp` file. The second write erases the first change, or the rename fails.
- **Recommended change:** Chain every save on one promise queue, as the thumbnail code at `src/main/ipc.ts:77` already does.
- **If we skip it:** Fast tag edits are lost now and then.

### 15. Duplicating a large selection hangs the app
`src/renderer/model/commands.ts:485-488`
- **What this is:** For each selected item that belongs to a group, it scans every entity and then searches the selection array.
- **Problem:** The work grows with the selection size squared times the map size. Measured: 500 items 0.6 s, 1,000 items 2.1 s, 2,000 items 21 s. A whole city (3.4k items) would take about 100 seconds.
- **Recommended change:** Build `new Set(input.entityIds)` and a count of members per group once, then check each group once.
- **If we skip it:** Copy-pasting a generated city freezes the editor.

### 16. Every pan step redraws far more than it needs to
`src/renderer/render/MapView.tsx:513-515`, `src/renderer/render/MapView.tsx:572-622`
- **What this is:** Each pointer move updates the camera, which runs a full `syncScene`.
- **Problem:** It rebuilds wall and road overlays, child-map previews and the grid every time, and runs a wall-hatch check that scans all entities for each visible entity.
- **Recommended change:** Reuse the hatch check already built at line 563 (at lines 513 and 607). Rebuild overlays and child previews only when the map, its revision or the zoom step changes; panning only needs `scheduleRender`.
- **If we skip it:** Panning gets laggy as maps grow toward the generator limits.

### 17. PNG export gets slow fast on big maps
`src/renderer/render/renderPng.ts:105`
- **What this is:** The drawing loop filters the whole list again for every entity.
- **Problem:** A 15k-entity city does about 225 million checks per export. This also slows the MCP `render_png` tool and player-image export.
- **Recommended change:** Build a `Map<layerId, Entity[]>` once before the loop. Build the `new Set(urls)` at line 123 once, too.
- **If we skip it:** Exports and agent renders of big cities take seconds.

### 18. A failed pack import leaves its files behind
`src/main/dungeondraft.ts:66-97`
- **What this is:** Images are extracted into `userData/unpacked-packs/<uuid>` while the pack is checked.
- **Problem:** When a checksum fails halfway, that folder is never deleted, and each retry makes a new one.
- **Recommended change:** In a `catch`, call `rm(root, { recursive: true, force: true })`, then rethrow.
- **If we skip it:** Failed imports of a 2 GB pack quietly fill the disk.

### 19. The riskiest save paths have no tests
`src/renderer/model/persistence.test.ts`, `src/renderer/model/transfer.test.ts:30`, `src/renderer/geom/visibility.ts`
- **What this is:** Unit tests cover the main-process file code well. They don't cover the renderer's save logic.
- **Problem:** No test fails if a rejected save loses its unsaved flags, if undoing a transfer isn't marked unsaved (the `transfer.test.ts:30` title says "independently undoable" but never undoes), or if open doors block light (`visibility.ts` has no test).
- **Recommended change:** Add three small tests:
  - A failing `saveDirtyWorld` keeps the flags and retries.
  - Transfer, then undo, leaves the maps marked unsaved.
  - A light passes through an open door in a wall.
- **If we skip it:** Findings 3, 6 and 10 can come back unnoticed.

---

## Nice to have

### 20. Duplicate helpers, dead exports and repo bloat
- **What this is:** Small things that add reading and fixing work later.
- **Problem:**
  - Polygon-area math is written five times: `gen/city/city.ts:25`, `geom/geography.ts:11`, `gen/world/boundaries.ts:4`, `import/trace.ts:7`, `geom/svgRings.ts:16`.
  - Line clipping is written twice: `export/uvtt.ts:6` and `geom/clipInherit.ts:25`. Only the uvtt copy drops near-zero results.
  - Point-in-ring (`geom/hitTest.ts:150`, `geom/measure.ts:30`) and point-to-segment distance (`geom/measure.ts:41`, `geom/hitTest.ts:135`) each exist twice.
  - River-node rebuilding is copied five times with different rules: `group.applyTransform`, `sync.ts:63`, `pullFromParent`, `buildChildMapDoc`, `applyTrace`.
  - `gen/framework.ts:30` `listGenerators` and the re-exports in `render/lighting.ts:8` are unused.
  - About 15 exports are only used inside their own file, for example `HISTORY_CAP`, `CURRENT_FORMAT_VERSION`, `registerCommand`, `rotatePoint`, `hashString`.
  - `visual-review/` puts 135 MB of screenshots and JSON (74 files) in git.
- **Recommended change:** Keep one copy of each helper in `geom/` and delete the rest. Make one river-node rebuild helper. Drop the unused exports. Add `visual-review/` to `.gitignore` and `git rm --cached` it.
- **If we skip it:** Fixes go into one copy and miss the others, and every clone stays large.

### 21. Missing images are fetched again on every pan
`src/renderer/render/textures.ts:75-79`, `src/renderer/render/MapView.tsx:429-430`
- **What this is:** `loadAssetTexture` loads an image once and caches it.
- **Problem:** When the load fails, nothing is cached, so the next `syncScene` (every pointer move) asks for the same file again and logs another warning.
- **Recommended change:** Keep a `failed` Set of URLs and skip them until `assetsIndex` changes.
- **If we skip it:** A world with one deleted image file sends a request and a console warning per pan step.

### 22. Very large shapes crash bounding-box code
`src/renderer/gen/framework.ts:39-40`, `gen/world/drainage.ts:9-10`, `gen/world/world.ts:24-25`, `gen/dungeon/layout.ts:39-40`, `gen/city/city.ts:282,331`
- **What this is:** These compute a bounding box with `Math.min(...points.map(p => p.x))`.
- **Problem:** Spreading an array into a function call fails with "Maximum call stack size exceeded" past roughly 100k values, for example a traced coastline used as a generation region. Today's largest ring is 4.5k points, so this is not hit yet. `gen/world/rivers.ts:28` also re-scans the whole ring for every river point.
- **Recommended change:** Use the existing `bboxFromPoints` from `geom/hitTest.ts` everywhere.
- **If we skip it:** Generation on a detailed traced coastline throws.

### 23. Slow agent calls time out but keep running
`src/main/agent.ts:146-150`
- **What this is:** Every MCP call to the renderer gives up after 15 seconds.
- **Problem:** The renderer keeps working after the timeout. `world_copy_map`, `world_fork` or a large export can finish after the agent was told it failed, and an agent that retries makes a second copy.
- **Recommended change:** Use a longer timeout (for example 120 s) for the copy, fork, sync and export tools, and say in the error that the operation may still finish.
- **If we skip it:** Duplicate map copies in the target world after a slow transfer.

### 24. Each generation keeps full map copies in undo history
`src/renderer/model/commands.ts:1529-1537`, `src/renderer/model/history.ts:3`
- **What this is:** `world.applyGenerated` assigns each changed map as a whole new object.
- **Problem:** The undo entry then holds the full map before and after. History is capped at 200 entries, not by size, so about 20 rerolls of a 5 MB world map hold about 20 full copies. Each apply also parses the whole world through Immer proxies and turns it into JSON text three or more times.
- **Recommended change:** Inside a changed map, assign only `entities`, `generators` and `terrain` entries whose JSON differs. Parse `original(draft)` or the store state instead of the draft.
- **If we skip it:** Memory grows with each reroll on large worlds, and each apply pauses the UI.

### 25. Transforming a big group does a nested search
`src/renderer/model/commands.ts:1308-1310`
- **What this is:** `group.applyTransform` checks that every member has a change.
- **Problem:** `members.some(e => !input.changes.some(...))` is members × changes. For a 3.4k-entity city that is about 12 million checks, tens of milliseconds today.
- **Recommended change:** `const changed = new Set(input.changes.map(c => c.entityId))`, then `members.some(e => !changed.has(e.id))`.
- **If we skip it:** Moving a whole generated city stutters as cities grow.

### 26. Linked sync clones and converts every entity before checking for changes
`src/renderer/model/sync.ts:24-28`
- **What this is:** The sync loop goes over every entity ID on both maps.
- **Problem:** `convertLinkedEntity` (which clones and transforms) runs for every remote entity, before the `if (!theirChanged) continue` that skips most of them.
- **Recommended change:** Move the `remote` conversion below the `theirChanged` check.
- **If we skip it:** Sync previews of large linked maps do far more work than needed.

### 27. An unreadable imported image is saved as 1000×1000
`src/main/ipc.ts:346-351`
- **What this is:** Backdrop import reads the image size with `nativeImage.createFromPath`.
- **Problem:** If the file can't be decoded, the size is 0×0 and the code falls back to 1000×1000. The file is copied into the world and used anyway, so the user gets a broken image with a made-up size.
- **Recommended change:** If `img.isEmpty()`, throw "Cannot read this image" instead of importing it.
- **If we skip it:** Broken backdrops in the world with no clear error.

### 28. The MCP server reads request bodies of any size
`src/main/agent.ts:53-71`
- **What this is:** `readJsonBody` collects the whole request into memory before parsing.
- **Problem:** There is no size limit. Only a caller with the token gets this far, so the risk is low, but a runaway agent sending a huge `command_run` can exhaust the main process's memory.
- **Recommended change:** Stop reading and return 413 when the body passes a limit (for example 64 MB).
- **If we skip it:** A buggy agent can freeze the whole app.

### 29. A dead ternary hides that updating an entity always makes it manual
`src/renderer/model/commands.ts:411`
- **What this is:** `entity.update` builds the updated entity.
- **Problem:** `existing.origin === 'manual' ? 'manual' : 'manual'` always gives `'manual'`, so a reader can't tell whether turning generated items manual is intended.
- **Recommended change:** Write `origin: 'manual'` with a one-line comment saying edits make generated items manual.
- **If we skip it:** The next person may "fix" it the wrong way.

---

**Verdict:** Fix 1 (file writes outside the world folder) first. Then fix 2, 5, 6, 3, 8 and 7: they are all ways edits or backups are lost.

**Lean:** about −70 lines and −0 dependencies possible, plus 135 MB of tracked review files out of git.

**Not checked:**
- The app, the unit tests and the e2e tests were not run.
- `simplex-noise` and `d3-delaunay` are listed in `package.json` but missing from this machine's `node_modules`, so the world-generator tests can't run here until `npm install`.
- Only partly read: the tools (except `doorTool` and part of `selectTool`), `import/svg.ts`, most of `gen/world/`, `gen/dungeon/interior.ts`, and parts of `MapView.tsx`, `drawEntity.ts`, `city.ts` and `layout.ts`.
- Not read: `viewStore.ts`, `assetTags.ts`, `navigation.ts`, `drawingHistory.ts`, `player.ts`, `themes.ts`, `generationContext.ts`.
