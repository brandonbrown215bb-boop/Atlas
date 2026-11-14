# Architecture

## Process Boundaries

- **Main process (`src/main/`):**
  - Owns all filesystem access (`worldFs.ts`, `ipc.ts`), native dialogs, window lifecycle (`index.ts`, `windowBounds.ts`), custom protocols (`protocol.ts`, `pathSecurity.ts`), and the localhost MCP server (`agent.ts`).
  - `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` on all `BrowserWindow` instances.
  - `app://atlas/*` serves the built renderer bundle; `atlas-file://*` serves local assets only if `resolveAllowedPath` confirms the resolved realpath lies inside `userData`, the currently open world directory, or a registered pack folder.
- **Preload (`src/preload/index.ts`):**
  - Exposes a narrow typed `window.atlasApi` bridge via `contextBridge`.
- **Renderer (`src/renderer/`):**
  - Single renderer process hosts the main window and any `window.open` popouts (`popout.html`), allowing all Dockview panels to share one Zustand store without cross-process state sync.

## Purity Boundary

- Core `src/renderer/model/`, `geom/`, `gen/` and `export/uvtt.ts` must not import React, PixiJS, Electron, or touch the DOM.
- Note: `agentBridge.ts` lives in `model/` as the IPC adapter for the MCP server and calls `renderPng.ts`; core state (`schema.ts`, `migrate.ts`, `history.ts`, `commands.ts`, `store.ts`) remains pure and is tested directly in Node via Vitest.

## State, Commands, and Undo/Redo

1. All mutations to the open world go through registered commands in `src/renderer/model/commands.ts`.
2. `worldStore.execute` / `executeBatch` wraps `produceWithPatches` from Immer, pushing a single `HistoryEntry` (capped at 200) onto `history.ts` and marking only the touched `world.json` / `maps/<id>.json` dirty.
3. `persistence.ts` debounces dirty writes (2 seconds) via `atlas:world-save-dirty` and triggers periodic backups (10 minutes) when changes occurred.
4. `viewStore.ts` holds transient, non-undoable UI state (per-panel camera, selection, asset index, calibration state).

## Rendering Invariants

- **PixiJS is output-only:** `eventMode` stays `'none'` on all Pixi objects; pointer input and `setPointerCapture` are handled on the `<canvas>` DOM element.
- **Window-local APIs:** `MapView.tsx` uses `canvas.ownerDocument.defaultView` for `requestAnimationFrame`, `devicePixelRatio`, and `ResizeObserver` so popout windows work when the main window is minimized (`backgroundThrottling: false`).
- **On-demand rendering:** `autoStart: false` on Pixi `Application`; renders are scheduled on the owning window's `rAF` only when camera, scene, or size changes.
- **No cross-window canvas reuse:** When Dockview relocates a panel between the main window and a popout (`onDidLocationChange`), `MapView.tsx` destroys the old Pixi `Application` and creates a fresh `<canvas>` and `Application` in the new window.
- **Local entity coordinates:** Each entity's Pixi `Container` is positioned at the entity's own origin with geometry drawn relative to `(0, 0)` to preserve GPU precision.

## Key Entry Points

- `src/main/index.ts` — App startup, scheme registration, window creation, popout bounds clamping.
- `src/main/worldFs.ts` — Atomic writes, world create/open, backups, restore, asset hashing.
- `src/main/agent.ts` — Authenticated `127.0.0.1` MCP HTTP server.
- `src/main/packs.ts` — Async image-header indexing, cached library metadata, folder/tag search and result paging; thumbnails are queued and cached by IPC in userData.
- `src/main/dungeondraft.ts` — Verified PCK v1 table reader and streamed extraction; successful imports register the extracted image folder at 256 px/square.
- `src/renderer/assets/commands.ts` — Copy-on-use adapter shared by the UI and MCP. Resolves pack references before executing the pure world commands together as one undo step.
- `src/renderer/model/themes.ts` — Theme roles and built-in fallback resolution. Theme assignments live in world metadata.
- `src/renderer/render/textures.ts` — Lazy textures with per-view usage tracking; hidden/offscreen art unloads after its last view releases it. PNG rendering holds the same textures while it runs.
- `src/renderer/app/App.tsx` — Menu bar, Dockview host, layout save/restore, theme sync.
- `src/renderer/render/MapView.tsx` — PixiJS 8 canvas lifecycle, incremental entity sync, pan/zoom, scale calibration.

## Phase 4 Outputs and Transfer

- `PlayerControls.tsx` opens `player.html` with `window.open` and mounts into its document using the same stores. A player-owned offscreen canvas renders on state/size changes and supplies the visible image; canvases are created and destroyed in their owning document.
- `model/player.ts` supplies the player render filter. `geom/fog.ts` performs polygon reveal/hide operations and hidden-entity rejection; `render/drawFog.ts` draws the resulting cover for both views.
- `export/playerImage.ts` uses the same player filter with fog disabled. `export/imageSize.ts` controls grid scale and the 8192-pixel limit. `export/uvtt.ts` is pure, clips structural data to the export rectangle, cuts wall gaps at doors, and reports secret-door compatibility.
- `model/transfer.ts` validates world references and prepares independent map trees or linked copies. Placement is baked into local coordinates; reciprocal link transforms convert later entity syncs between coordinate systems.
- `model/sync.ts` compares per-entity edit/deletion revisions against link baselines. `map.syncLinked` applies the result as one undo step; unchanged repeated syncs produce no history entry.
- `main/transferFs.ts` owns world-folder checks, hash-verified art copying, backups, transactional world writes and rollback. It verifies the target before saving source-side move/link changes. Source map files remain available for undo; world metadata determines membership.
- `export/transferActions.ts` coordinates saved state and IPC for both UI and MCP. During transfer/sync, edits are held until the operation completes. Persistence waits for in-flight writes and only marks documents clean if their submitted versions are still current.

## Phase 5 Generators

- `gen/rng.ts` supplies mulberry32; generators use no ambient randomness. `gen/framework.ts` registers pure generators, gathers manual/inherited constraints, validates output, and replaces only untouched entities belonging to the chosen run. Generator records retain their footprint, seed, parameters, layer and theme.
- `gen/dungeon/layout.ts` partitions buildings, connects dungeon rooms with grid corridors, or carves a chamber with alcoves. Room adjacencies receive spanning-tree doors; polygon clipping keeps floors and exterior walls within the footprint, including holes. Manual walls constrain connectivity, and inherited/manual doors retain their exact openings.
- `gen/dungeon/dressing.ts` chooses furniture roles by room purpose, uses portable theme assets or built-ins, and keeps prop footprints away from walls, doorways, existing props and direct routes between room doors. Dressing-only runs retain layout entities exactly.
- `gen/dungeon/interior.ts` constructs a disposable, deterministic child-map preview from a settlement footprint and its doors. `map.generateInterior` invokes the same function, creates the place link and preserves notes in one undo step. The panel refuses to accept a preview after its source or settings change.
- `GeneratorPanel.tsx` calls registered commands for all world edits; its SVG preview stays outside the world/store and persistence. Selected-area dressing commands preserve manual props and out-of-area entities. `generator.accept` turns a completed run into manual content.

## Phase 6 Outdoor Locations

- `gen/glade/outdoor.ts` registers `glade` with the existing generator framework. A bounded routing grid respects polygon holes, manual areas, blocking paths/walls and prop footprints. Inherited land/biome backdrops remain usable ground. Seeded clearing placement and a spanning tree connect the numbered clearings; safe simplification and corner smoothing round the trails. Boundary entrances and manual trails/roads join the same network.
- Optional stream routing avoids clearings; a pond occupies unused ground. Themed bridge props cover wet stretches of generated and manual trails. Boundary/path-edge tree bands and lighter interior scattering avoid clearings, trails, water and deliberate edits. Output remains ordinary editable entities; no new save format or runtime dependency is needed.
- `GeneratorPanel.tsx` keeps woodland and interior settings separate, restores saved run parameters, and converts custom entrance coordinates between feet in the UI and metres in commands. Woodland has full reroll/accept controls; dungeon-specific dressing controls remain with dungeon runs.

## Phase 7 Terrain, Climate and Rivers (through P7.2)

- `gen/world/terrain.ts` creates roughly 8,000 seeded jittered Voronoi cells with warped layered simplex elevation and edge falloff. `boundaries.ts` cancels shared edges and traces coast/hole rings before clipping the resulting polygons. Manual land, water and biome areas constrain terrain; exact manual water cuts are preserved.
- `climate.ts` uses world-relative latitude, elevation and seeded moisture noise to select first-match custom biome rules. `world.setClimate` saves settings and the biome table in world metadata; older worlds use defaults. `context.ts` carries parent transforms into climate sampling.
- `rivers.ts` accumulates rainfall along strictly descending cell links and rounds bends inside convex cells, retaining shared-edge crossings. River geometry is clipped to the footprint, including holes. `world.ts` registers the combined generator; `WorldClimateEditor.tsx` edits settings through commands.
- Dungeon dressing caches wall segments and per-candidate wall distances within each run, avoiding repeated geometry work during sorting while preserving deterministic placement.
