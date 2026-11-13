# Campaign Atlas — master implementation plan

Written for an implementing agent. Read sections 1–5 fully before writing any code. Then do the tasks in section 6 in order, one at a time.

Source material: `MAP_EDITOR_BRIEF.md` (what the user wants), `TECH_STACK_AND_OPEN_QUESTIONS.md`, `reference-maps/`. Where this plan and the brief disagree, this plan wins: it records decisions made after the brief.

---

## 1. Decisions already made (do not reopen)

| Topic | Decision |
|---|---|
| First usable version | Atlas + manual editing (phases 0–4). Generators come after. |
| Generators in this plan | Dungeon/building interior, outdoor location, world/continent, city. In that order (easiest and most testable first; city is the riskiest and goes last). |
| Art | Asset-pack driven. Packs: Forgotten Adventures folders, Dungeondraft `.dungeondraft_pack` files, any loose image folder. The app also ships built-in flat placeholder art so everything works with no pack loaded. |
| Suggestions / AI prose | Out of this plan. Notes and GM-only annotations are in. |
| Foundry | Export a Universal VTT (`.dd2vtt`) file. Foundry version is undecided, so the Foundry-side check is a user step, not an agent step. |
| Player/TV display | A clean second window: GM-only content hidden, label and grid toggles, camera driven from the GM window, plus a GM brush to hide and reveal areas by hand. |
| Machines | Built and used on two Windows PCs. Ship a portable build. Worlds are plain folders that can be copied between machines. |
| Between worlds | Copy (independent), move, or linked copy (stays in sync on request). Whole-world forks. Controls to adapt geography when a region lands in another world. See section 4.7. |
| Parent and child maps | When a parent map changes, developed child maps offer to pull in the change; edited parts are kept. |
| Units | All coordinates are metres (JS numbers). The UI displays feet and miles. Battle grid = 5 ft = 1.524 m. |
| Platform | Windows only. Offline. Unsigned. No auto-update. |
| Agent control | A coding agent can do everything the UI can. The running app serves an MCP server on localhost; its tools call the same commands the UI calls (section 4.6). |

## 2. Deferred (not built in this plan)

Do not build these. They are later work, not rejected ideas, so do not make choices that would rule them out; the brief's requirement to keep real dimensions and elevation for a future 3D view still holds.

- Decided with the user: suggestion generation.
- Asked, no preference given, so left as later work: updating an already-played Foundry scene, one-button send to a running Foundry, props as movable Foundry tiles, levels and notes carried into Foundry. All need a Foundry-side module.
- Asked and not chosen: object states (what players see versus what is really there, with a GM toggle); a Windows installer.
- From the brief: 3D view and assets; macOS/Linux.
- Never raised, assumed unwanted: code signing, auto-update, multi-user collaboration, a database.

---

## 3. Tech stack (reviewed; the bundle's proposal is kept, with additions)

| Piece | Choice | Why this and not the alternative |
|---|---|---|
| Shell | **Electron 45** | Dockview popouts need extra windows that share one JS heap with the main window (`window.open`, same origin). Electron gives that. Tauri/WebView2 would force every window into its own process and turn shared state and undo into an IPC sync problem. |
| Build | **electron-vite 6**, **electron-builder 26** (`portable` + `dir` targets) | Standard, least config. |
| UI | **React 19 + TypeScript (strict)** | As proposed. |
| Docking | **Dockview 8** (React binding) | Only maintained library with docking, floating groups and real popout windows that dock back. |
| Map rendering | **PixiJS 8, WebGL renderer** (`preference: 'webgl'`) | Asset-pack art means thousands of raster sprites; GPU batching is required. Konva/Canvas2D slow down at that count, SVG far sooner. Three.js adds nothing for 2D. Do not use WebGPU. |
| State | **Zustand 5 + Immer 11** (`produceWithPatches`) | One store shared by all windows. Immer patches give undo/redo and dirty tracking for free. |
| Validation | **Zod 4** | Schemas are the single source of types; every file read from disk is parsed through them. |
| Geometry | **polygon-clipping** (booleans), **d3-delaunay** (Voronoi), **simplex-noise** | Small, pure, no native code. |
| Tests | **Vitest** (unit), **Playwright** `_electron` (a few smoke tests) | The smoke tests exist so the agent can prove window behaviour instead of assuming it. |
| Saves | **JSON files in a world folder** | Portable, diffable, no native modules. No SQLite. |
| Agent interface | **@modelcontextprotocol/sdk** (Streamable HTTP transport, in the main process) | MCP is what coding agents connect to natively. HTTP rather than stdio because the agent drives the app the user already has open, and a Windows GUI executable's stdio is unreliable. A file-editing CLI was rejected: it would bypass undo, autosave and validation, and could not render an image for the agent to look at. |

Dependency rule: the packages above are the complete list. Do not add any other runtime dependency. If you believe one is needed, stop and write it in `BLOCKERS.md`.

Write these yourself, do not install packages for them: seeded RNG (mulberry32), camera pan/zoom, line simplification (Ramer–Douglas–Peucker), curve smoothing (Chaikin), UUIDs (`crypto.randomUUID()`), SVG path flattening (browser `SVGGeometryElement.getPointAtLength`), hashing (`node:crypto`), long lists (CSS `content-visibility: auto`).

### Facts that must shape the code

These are the known traps in this stack. Each one is a hard rule.

1. **Dockview refuses `file:` popout URLs.** The app must be served from a custom scheme. Register `app://` with `protocol.registerSchemesAsPrivileged` (standard, secure, supportFetchAPI) and `protocol.handle`. Load `app://atlas/index.html`; popouts use `app://atlas/popout.html` (a blank page). In dev, use the Vite dev server URL.
2. **Popout windows.** In the main process, `webContents.setWindowOpenHandler` must return `{action: 'allow'}` for `app://atlas/popout.html` and the player window URL, and `deny` for everything else. `window.close()` may not close the real window: handle Dockview's `onWillClosePopoutWindow` and ask the main process to close it.
3. **One renderer process, one store.** Popouts and the player window are opened with `window.open` from the main window so they share the store. Never create a second `BrowserWindow` that loads the app separately.
4. **Pixi is output only.** Do not use Pixi's event system (`eventMode` stays off). Listen to DOM pointer events on the canvas element, use `setPointerCapture`, and hit-test against the model in our own code.
5. **Never use globals for window things inside a map view.** Use `canvas.ownerDocument.defaultView` for `requestAnimationFrame`, `devicePixelRatio` and `ResizeObserver`. Do not use Pixi's `resizeTo` or its auto-started ticker (`autoStart: false`). Render on demand: when the view is dirty, schedule one `app.render()` on the owning window's rAF.
6. **Never move a canvas between windows.** A map view creates its Pixi `Application` when it mounts and destroys it when it unmounts. All view state that must survive (map id, camera) lives in the store, keyed by panel id.
7. **Keep numbers small on the GPU.** Each entity's display object is positioned at the entity's own origin; its geometry is drawn relative to that origin. Never bake absolute map coordinates into a `Graphics`. Each map kind has a maximum zoom (section 4.4).
8. **Disk access only in the main process.** `contextIsolation: true`, `nodeIntegration: false`. The preload script exposes a small typed API. Every path from the renderer is resolved and checked to be inside an allowed root (the open world folder, a registered pack folder, or app userData) before use.
9. **Textures are loaded lazily** through a second scheme, `atlas-file://`, served by the main process with the same allowed-root check. Never load a whole pack up front; Forgotten Adventures is tens of thousands of files.
10. Set `backgroundThrottling: false` on the main window so popouts keep rendering while it is minimised.
11. **The UI has no private powers.** A UI control may only change the world by calling a registered command (section 4.6). If a button needs a change no command covers, add the command first. This is what keeps the agent interface complete without extra work.
12. **The agent server is a trust boundary.** Bind to `127.0.0.1` only. Require a bearer token (random, generated on first run, stored in userData) on every request. Validate every tool input with the command's Zod schema. File paths in tool inputs go through the same allowed-root check as hard rule 8.

Not verified while writing this plan — check each against its documentation before coding it: Dockview popout behaviour inside Electron with a WebGL canvas (task P0.3 exists for this); the Dungeondraft pack file layout; the Forgotten Adventures pixels-per-square value; the exact Universal VTT field names.

---

## 4. Architecture

### 4.1 Repository

Create the repo at `C:\Users\jbrow263\Documents\campaign-atlas` on the work laptop (that `Documents` folder is not synced by OneDrive; the equivalent non-synced folder on the other PC). Do **not** create it inside any OneDrive folder (`node_modules` must not sync). `git init` before the first task; commit after every task.

```
src/main/        index.ts  protocol.ts  ipc.ts  worldFs.ts  packs.ts  agent.ts
src/preload/     index.ts            (typed API, nothing else)
src/renderer/
  index.html  popout.html  player.html  main.tsx
  model/     schema.ts  store.ts  commands.ts (registry)  history.ts  migrate.ts
  geom/      pure geometry helpers
  gen/       rng.ts  framework.ts  dungeon/  glade/  world/  city/
  export/    uvtt.ts  playerImage.ts
  render/    MapView.tsx  camera.ts  drawEntity.ts  textures.ts
  tools/     one file per tool
  panels/    Layers  Inspector  Places  Assets  Maps  Generator
  app/       App.tsx  dock.tsx  theme.css
e2e/         Playwright smoke tests
```

**Purity rule:** `model/`, `geom/`, `gen/` and `export/uvtt.ts` must not import React, Pixi, Electron or touch the DOM. They are plain functions over plain data so Vitest can test them. Unit tests sit beside the file as `*.test.ts`.

`npm run check` = `tsc --noEmit` + `vitest run`. `npm run e2e` = Playwright smoke tests.

### 4.2 World folder (the save format)

```
MyWorld/
  world.json            { formatVersion, id, name, maps: [{id, name, kind, parent?}], themes }
  maps/<mapId>.json     one map document
  assets/<sha1>.<ext>   every image the world uses, copied in on first use
  assets/index.json     sha1 -> { originalName, packName, pxPerSquare, width, height }
  backups/<timestamp>/  copies of world.json + maps/
```

- Writes are atomic: write `<name>.tmp`, then rename over the target.
- Autosave: 2 seconds after the last change, write only the dirty files.
- Backups: on open and every 10 minutes if something changed. Keep the newest 20.
- `formatVersion` starts at 1. `migrate.ts` holds an ordered list of upgrade functions; loading runs them, then parses with Zod. A file that fails to parse is never overwritten: show the error and offer the newest backup.
- Window/panel layout is **not** in the world folder. It is stored in app userData keyed by world id, because the two machines have different monitors. Registered pack folders and recent worlds are stored there too.

### 4.3 Map document

```ts
Map = {
  id, name,
  kind: 'world' | 'region' | 'settlement' | 'site' | 'interior',
  parent?: { mapId, x, y, rotation, footprintEntityId? },  // where this map sits in its parent, metres
  bounds: { x, y, w, h },
  grid: { size: number, visible: boolean },                 // metres; 1.524 for battle maps
  layers: [{ id, name, visible, locked, gmOnly }],          // draw order = array order
  entities: Record<id, Entity>,
  generators: Record<genId, { type, seed, params, regionEntityId }>,
  revision: number,                                         // +1 on every command that touches this map
  deleted: Record<id, number>,                              // entity id -> revision when deleted (needed for sync)
  link?: { worldId, mapId, syncedTheirRev, syncedMyRev },   // set on both sides of a linked copy
  fog: { enabled: boolean, revealed: Point[][][] },         // player-window reveal mask; never exported
}

EntityBase = { id, layerId, origin: 'manual' | 'generated' | 'inherited', genId?, gmOnly?, name?,
               rev: number,                                 // map.revision when last changed
               inheritedFrom?: { entityId, parentRev } }    // set when origin is 'inherited'

Entity =
  | image  { assetId, x, y, w, h, rotation }                         // backdrop, e.g. an Inkarnate export
  | area   { role, rings: Point[][], elevation?, fill? }             // rings[0] outer, rest holes
  | path   { role, points: Point[], width, closed }
  | wall   { points: Point[], blocksMove, blocksSight }
  | door   { a: Point, b: Point, kind: 'door' | 'secret', open }
  | prop   { assetId | builtin, x, y, rotation, scale, flipX }
  | light  { x, y, radius, color }
  | label  { text, x, y, size }
  | portal { x, y, targetMapId, targetPortalId? }                    // entrances, stairs between floors
  | place  { name, category, notes, gmNotes, entityIds: id[], childMapId? }
```

Roles are plain strings from fixed lists. `area`: land, water, biome:\<name\>, plateau, district, building, floor. `path`: road, river, cliff, cityWall, trail.

A **place** is the persistent identity the brief asks for. It points at one or more entities, so a shop keeps its name, notes and interior when its building is redrawn, and one note can cover two doors and a statue. `gmNotes` and anything with `gmOnly` never reach the player window or an export.

### 4.4 The three rules that make the brief work

**Rule A — deliberate edits survive.** Generators only ever create entities with `origin: 'generated'` and their `genId`. Any user edit to such an entity sets `origin: 'manual'`. A reroll deletes only entities that still have `origin: 'generated'` and that `genId`, then generates again with the remaining entities passed in as constraints. Nothing else in the app deletes user work.

**Rule B — zooming deeper means a child map.** Each map kind has a zoom range (world: down to about 50 m per pixel; region: 5 m; settlement: 0.25 m; site and interior: 0.01 m). To go deeper the user picks "Develop this area" on a rectangle, which creates a child map: parent geometry inside the rectangle is clipped (polygon-clipping) and copied in as `origin: 'inherited'`. Child maps whose rectangle is on screen and larger than 64 px are drawn inside the parent view. When a child covers most of the viewport and the user keeps zooming, the view switches to that child (same screen position, camera now in the child's coordinates); zooming out past its bounds switches back. That is the "continuous zoom". Interiors are never drawn inline: they open through a place's `childMapId` or a portal.

**Rule C — one command, one undo step.** Every change goes through `commands.ts`, which wraps `produceWithPatches`, pushes the inverse patches onto the history stack (cap 200), and marks the touched files dirty. A drag is one command, committed on pointer-up. Undo/redo is per world and works from any window.

### 4.5 Assets and themes

- A **pack** is a registered folder (or an unpacked `.dungeondraft_pack`). It is indexed in place: path, size, modified time, image dimensions, tags taken from folder and file names. The index is cached in userData. Files are not copied or hashed at registration.
- When an asset is first **used** in a world, it is hashed and copied into the world's `assets/`. Worlds therefore open on the other machine even if the pack is missing.
- Each pack has a `pxPerSquare` setting (default 200 for loose folders, 256 for Dungeondraft; user-editable). Prop size on the map = image pixels ÷ pxPerSquare × 1.524 m.
- A **theme** maps generator roles to assets: `{ tree: [assetId…], rock: […], table: […], bed: […], floorTexture: […], wallTexture: […], … }`. Generators ask the theme for a role and never name files. Every role has a built-in flat placeholder used when the theme has no entry. Themes are stored in `world.json`.

### 4.6 Commands and the agent interface

`commands.ts` holds a **command registry**. Each command is `{ name, description, input: ZodSchema, run(draft, input) }`. Examples: `entity.add`, `entity.update`, `entity.delete`, `layer.add`, `place.create`, `map.create`, `map.developArea`, `generator.run`, `generator.reroll`, `theme.setRole`. The UI and the agent both call `execute(name, input)`; rule C applies to both.

The main process runs an MCP server (hard rule 12) and forwards each call to the renderer, which owns the store. The tool list is small and fixed; new features appear through `command_list`, not new tools:

| Tool | Does |
|---|---|
| `world_open`, `world_create`, `world_status` | Open or create a world folder; report what is open and whether it is saved. |
| `schema_get` | The JSON Schema of the map document and entity types (generated from Zod). |
| `command_list` | Every registered command with its description and input JSON Schema. |
| `command_run` | Run a list of commands as **one** undo step. Returns created ids, or the validation error and no change. |
| `undo`, `redo` | Same history as the UI. |
| `map_list`, `map_get` | Map tree; one map's entities, with optional filters (type, layer, bounding box, origin) so large maps do not flood the agent. |
| `asset_search`, `theme_get` | Find pack assets by name/tag; read theme roles. |
| `render_png` | Render a map or rectangle to a PNG and return the image, GM or player view. This is how an agent sees its work. |
| `export_uvtt`, `export_player_image`, `world_copy_map` | The phase 4 outputs. |

Agent edits appear live in every open window and are undoable by the user with Ctrl+Z. The Settings panel shows the server URL and token, a copyable config snippet for a coding agent, and an on/off switch (on by default).

### 4.7 Moving things between worlds, and keeping copies in step

All of this is pure code in `model/transfer.ts` and `model/sync.ts`, with tests. Every operation backs up each world it writes to first.

- **Fork a world:** copy the whole folder, give it a new world id and name, record `forkedFrom`. Nothing else.
- **Copy:** a map with all descendant maps, places, notes and used assets goes into the target world with fresh ids. The two are unrelated afterwards.
- **Move:** a copy, then deletion from the source, done only after the target has been written and re-parsed successfully.
- **Linked copy:** like copy, but ids are kept and both maps get a `link` record pointing at each other. Refuse if those ids already exist in the target.
- **Sync a linked map** (a user action, run from either side; never automatic): compare each entity's `rev` with the revisions recorded at the last sync.
  - Changed only on the other side → take theirs. Changed only here → keep mine.
  - Changed on both sides, or changed on one and deleted on the other → a conflict. Keep mine by default and list each conflict for the user to choose "mine" or "theirs".
  - The whole sync is one undo step. Then update `syncedTheirRev` and `syncedMyRev` on this side.
  - The other world's folder path is machine-specific: look it up by world id in userData, and ask the user if it is not known.
- **Pull from parent** (inside one world): each inherited entity records which parent entity and revision it came from. When the parent's revision is newer, the child map shows a "parent changed" marker. "Pull from parent" re-clips the parent geometry and replaces entities that are still `origin: 'inherited'`; entities the user edited (now `manual`) are kept and listed so the user can see what no longer matches. One undo step.
- **Adapting geography on arrival:** when a map is copied, moved or linked onto a parent map in the target world, the placement dialog offers:
  - position, rotation and uniform scale of the incoming footprint (interior maps are never scaled; their dimensions stay fixed);
  - what happens underneath: *replace* (target geometry inside the footprint is cut away) or *merge* (incoming land is unioned with target land, and seam vertices within a chosen margin are smoothed);
  - *re-climate* (phase 7 onward): regenerate the incoming region's generated biomes from the target world's climate, keeping every manual area, place and developed location.

---

## 5. Working rules for the implementing agent

1. Do tasks in order. One task per commit. Do not start a task until the previous one's "Done when" is met.
2. Before each commit run `npm run check`. From phase 1 onward also run `npm run e2e`. Both must pass.
3. Do only what the task says. No refactors, no extra options, nothing from the deferred list in section 2.
4. Follow the hard rules in section 3 and rules A–C in section 4.4 exactly.
5. Every generator and every geometry helper gets a Vitest test. UI gets a Playwright smoke test only where a task says so.
6. Read the library's current documentation before using an API you have not used in this repo yet. Do not guess API names.
7. If a "Done when" check fails twice, or a task needs something this plan forbids, stop. Write what happened in `BLOCKERS.md` and end the session. Do not work around it.
8. Tasks marked **[USER CHECK]** end with something only a person can judge. Finish the task, list what the user should look at in `USER_CHECKS.md`, and continue.

---

## 6. Tasks

### Phase 0 — scaffold and prove the risky parts

**P0.1 Scaffold.** Create the repo with electron-vite (React + TypeScript template). Strict TypeScript. Add Vitest and Playwright. Add `check` and `e2e` scripts. Secure defaults from hard rule 8.
*Done when:* `npm run dev` opens a window; `npm run check` passes with one trivial test; a Playwright test launches the app and sees the window title.

**P0.2 Custom scheme.** Implement `app://` (hard rule 1) for production builds and `atlas-file://` with the allowed-root check (hard rules 8, 9).
*Done when:* a production build (`npm run build` then run the unpacked app) loads from `app://atlas/index.html`; a unit test proves a path outside the allowed roots is rejected, including `..` tricks.

**P0.3 Popout spike.** A Dockview layout with two panels. Each panel holds a throwaway map view: a Pixi canvas drawing a grid and 5,000 sprites, with wheel zoom and drag pan, built to hard rules 4–6. Add a "pop out" button and wire rule 2.
*Done when a Playwright test shows:* a panel pops out into a second window; its canvas has non-zero size and keeps rendering after the main window is minimised; it docks back and still renders; closing the popout window returns the panel to the main window.
*If this cannot be made to pass:* stop and write `BLOCKERS.md`. The fallback (plain non-dockable `window.open` map windows) is a user decision.

**P0.4 Portable build.** electron-builder `portable` and `dir` targets.
*Done when:* the portable `.exe` starts on this machine from a folder outside the repo. **[USER CHECK]** it starts on the second PC.

### Phase 1 — worlds, model, map view

**P1.1 Schema and store.** `schema.ts` (Zod, section 4.3), types inferred from it, `store.ts`, `commands.ts`, `history.ts` (rule C), `migrate.ts`.
*Done when:* tests cover add/update/delete entity, undo and redo restoring exact state, and a sample map round-tripping through parse.

**P1.2 World files.** Main-process `worldFs.ts`: create, open, atomic write, autosave of dirty files, backups, restore from backup (section 4.2). Preload API. Recent-worlds list.
*Done when:* tests cover atomic write, backup rotation to 20, and refusing to overwrite a file that failed to parse. A Playwright test creates a world, adds an entity, restarts the app, and finds the entity.

**P1.3 Shell.** Replace the spike UI with the real Dockview workspace: menu (New/Open world, Undo/Redo, View), panel registry, layout saved per world in userData and restored on open. If a restored window is off every current monitor, move it onto the primary monitor. Light/dark theme toggle using CSS variables and Dockview's matching theme; follow the OS setting by default.
*Done when:* layout with one popout survives a restart; the off-screen recovery function has a unit test; theme toggles in all windows.

**P1.4 Map view.** `MapView.tsx` + `camera.ts` + `drawEntity.ts`. Renders one map from the store: layers in order, each entity type from section 4.3 (placeholders are fine for prop and light), grid, selection outline. Wheel zooms at the cursor, middle-drag or space-drag pans, zoom clamped per map kind. Redraw only entities whose data changed. Two views of the same or different maps can be open at once.
*Done when:* camera maths has tests (screen↔map round trip, zoom keeps the cursor point fixed); a Playwright test opens two map panels and an edit made through the store appears in both.

**P1.5 Maps panel and backdrop import.** Tree of maps in the world. New map (choose kind). Import an image as an `image` entity (copied into `assets/` by hash). Set its real size by dragging a line across a known distance and typing the length.
*Done when:* the three images in `reference-maps/` (02, 03, 04) can be imported as world, settlement and interior maps and survive a restart. **[USER CHECK]** they look right.

**P1.6 Agent server.** The command registry's `command_list` output, the MCP server in `src/main/agent.ts`, and the tools in section 4.6 that phase 1 can support (`world_*`, `schema_get`, `command_list`, `command_run`, `undo`, `redo`, `map_list`, `map_get`, `render_png`). Settings panel entry. Later phases add the remaining tools when their feature lands (`asset_search` and `theme_get` in phase 3, exports in phase 4).
*Done when:* a Playwright test starts the app, connects with the MCP SDK client, creates a world, adds an area with `command_run`, reads it back with `map_get`, gets a non-empty PNG from `render_png`, and undoes it; requests without the token, and a `command_run` with invalid input, are rejected and change nothing.

### Phase 2 — manual editing

Each tool is one file in `tools/` with `onPointerDown/Move/Up`, `onKey`, and a draw-overlay function. All changes go through registered commands (hard rule 11). From here on, every task that adds a user-visible change adds its command to the registry, and every phase ends with one agent-server test that performs that phase's main action through `command_run` alone.

**P2.1 Select tool.** Click and box select, shift to add; move, rotate, scale with handles; delete; duplicate; arrow-key nudge. Respects layer lock and visibility. Hit-testing lives in `geom/` with tests.
**P2.2 Layers and Inspector panels.** Add, rename, reorder, hide, lock, mark GM-only. Inspector edits the selected entity's fields.
**P2.3 Area and path tools.** Click to place points; double-click to finish. Freehand mode: drag, then simplify and smooth (tests for both). Role chosen from a dropdown. Optional snap to grid.
**P2.4 Point edit tool.** Drag vertices; click a segment to insert a point; delete a point. Add/subtract mode for areas using polygon-clipping (this is how a hole is carved through a continent).
**P2.5 Wall, door, light, label tools.** Walls snap to grid corners by default. A door is placed on a wall segment and may be `secret`. Secret doors and GM-only items draw with a distinct GM marker.
**P2.6 Places.** Create a place from the selection; Places panel with search and category filter; choosing a result centres and highlights it in the active map view; notes and GM notes editor; optional category label overlay on the map.
**P2.7 Child maps and zoom-through.** "Develop this area" and "Open interior" (rule B), portals between maps, inline drawing of child maps, automatic view switching. Clip-and-inherit lives in `geom/` with tests.
**P2.7b Pull from parent.** The "parent changed" marker and the pull action from section 4.7.
*Done when:* tests prove unedited inherited entities are replaced, edited ones are untouched and reported, and one undo restores everything.
**P2.8 SVG import.** Parse with `DOMParser`, flatten paths, show a dialog assigning each shape a role, create `area`/`path` entities.
**P2.9 Measure tool.** Click along a route: shows distance in feet/miles. With a speed and departure time entered, shows duration and arrival time.

*Phase done when:* `npm run check` and `npm run e2e` pass, with one Playwright test that draws an area, edits a vertex, undoes, and redoes. **[USER CHECK]** trace the Khartoum coastline, upper-district wall and three shops over image 03; make the shops places; find them by search; open the pyramid as an interior of a place.

### Phase 3 — asset packs

**P3.1 Register loose folders.** Pick a folder; index it in a background pass with progress (section 4.5); cache the index.
**P3.2 Assets panel.** Folder tree, tag and name search, lazily loaded thumbnails (generated once, cached in userData). Must stay responsive with 50,000 entries.
**P3.3 Place and paint with assets.** Prop stamp tool using the selected asset (copy-on-use into the world). Texture fill for `area`; texture along `wall` and `path`. Textures load and unload with visibility (hard rule 9).
**P3.4 Dungeondraft packs.** Read the `.dungeondraft_pack` container (a Godot PCK archive: verify the header and file-table layout against a real pack before writing the reader), extract its images to userData, then register the result as a loose folder. A corrupt or unknown file shows an error and changes nothing.
**P3.5 Themes.** Theme editor: for each role, pick assets from the Assets panel. Built-in placeholder for every role.

*Phase done when:* reader and indexer have tests using small fixture files. **[USER CHECK]** register the real Forgotten Adventures folder and one Dungeondraft pack; confirm the default `pxPerSquare` makes props the right size on a 5 ft grid.

### Phase 4 — outputs (end of v1)

**P4.1 Player window.** Opened with `window.open` to `player.html`. Shows one chosen map with GM-only layers, GM-only entities, GM notes, secret-door markers and selection hidden. GM controls: which map, "send my view", label toggle, grid toggle, fullscreen on a chosen monitor.
*Done when:* a test asserts the player render list contains no GM-only entity for a fixture map.
**P4.1b Reveal brush.** A GM tool that paints "reveal" or "hide" with an adjustable brush, plus reveal-all and hide-all. Each stroke is unioned into or subtracted from `fog.revealed` with polygon-clipping (one command per stroke). With fog enabled, the player window draws solid cover outside the revealed area; the GM view shows the same cover half-transparent.
*Done when:* tests cover reveal then hide on a fixture map; the P4.1 test also asserts nothing outside the revealed area is in the player render list.
**P4.2 Player-safe image.** Render a map or selected rectangle offscreen with the same filter to PNG at a chosen pixels-per-square. Cap at 8192 px per side and say so when the cap applies.
**P4.3 Universal VTT export.** `export/uvtt.ts`: pure function from a map to the `.dd2vtt` JSON — image (from P4.2), grid resolution, walls as line-of-sight polylines in grid units, doors as portals, lights. Check field names against the format documentation linked in `RESEARCH_LINKS.md`. The basic format has no secret-door flag: export secret doors as closed portals carrying an extra `"secret": true` field, and list them in a short text report shown after export.
*Done when:* tests cover a fixture room with one door and one secret door. **[USER CHECK]** import into Foundry with the Universal Battlemap Importer; check grid alignment, walls and doors; report the Foundry version.
**P4.4 Fork, copy, move.** Section 4.7: fork a world; copy or move a map tree into another world, with the placement dialog's position/rotation/scale and replace-or-merge choices.
*Done when:* tests cover each operation on fixture worlds: the target parses with no dangling ids, a move leaves the source without the map and with a backup, a failed target write leaves the source untouched, and replace and merge each produce valid land polygons.
**P4.5 Linked copies and sync.** Section 4.7: linked copy, the sync action, and the conflict list with per-entity "mine"/"theirs".
*Done when:* tests cover every row of the sync rules (theirs-only, mine-only, both changed, changed-versus-deleted), that a second sync with no changes does nothing, and that one undo reverses a sync.

**v1 is complete here.** Stop and wait for the user before phase 5.

### Phase 5 — generator framework, then dungeon and interior

**P5.1 Framework.** `gen/framework.ts`:

```ts
type Generator<P> = (input: {
  seed: number; params: P; region: Point[][];     // polygon to fill
  constraints: Entity[];                          // manual + inherited entities inside the region
  theme: Theme; grid: number;
}) => Entity[];                                    // all origin: 'generated'
```

Pure and deterministic: same input, same output (test this for every generator). `rng.ts` is mulberry32. Generator panel: pick generator, edit params, Generate, Reroll (new seed), Reroll dressing only, Accept. Generate and reroll are single commands following rule A.

**P5.2 Layout.** Input: a footprint polygon and its doors. Modes: `building` (split the footprint into rooms recursively, connect with doors), `dungeon` (rooms joined by corridors on the 5 ft grid), `chamber` (one open space with alcoves). Option: mirror left/right. Output: floor areas, walls, doors. Existing manual walls and doors are kept and built around.
**P5.3 Dressing.** For each room, a purpose (given or chosen at random from a short list) selects theme roles and counts. Place props against walls or in the open as the role requires; never within one square of a door or on a straight line between doors. Area tools: thin out, add more, reroll dressing only.
**P5.4 Open-interior flow.** From a building footprint on a settlement map: choose purpose, preview, reroll, accept — creates the interior child map linked to the building's place.

*Done when:* tests prove determinism, that every room is reachable from an entrance, that props do not block doors, and that manual entities are unchanged after reroll. **[USER CHECK]** rebuild something like the pyramid chamber (image 04).

### Phase 6 — outdoor location

**P6.1** Region polygon → walkable clearings joined by winding corridors (the shape language of image 01), a tree band along the boundary and scattered inside, an optional stream crossing with a bridge where a trail meets it, an optional pond, trails between entrances, numbered labels on clearings. Params: clearing count, density, water on/off, entrances. Manual areas, paths and props are constraints.
*Done when:* determinism and "all clearings connected" tests pass. **[USER CHECK]** compare with image 01.

### Phase 7 — world and continent

**P7.1 Terrain.** About 8,000 jittered points → Voronoi cells (d3-delaunay). Elevation from layered simplex noise with domain warping and an edge falloff. Manual `land`/`water` areas override the cells they cover. Trace land/water cell boundaries into rings (do not union thousands of cells with polygon-clipping). Output: land areas with holes.
**P7.2 Climate and rivers.** Moisture and temperature per cell → biome areas (a table the user can extend with custom biome names). Rivers by downhill flow accumulation, smoothed. Manual biome areas override.
**P7.3 Decoration.** Scatter world-scale props (mountains, forests, hills) from theme roles by biome and elevation. Suggested settlement points with deliberately uneven spacing (no fixed-distance placement); the user accepts or dismisses each.

**P7.4 Re-climate on arrival.** Add the re-climate option to the placement dialog (section 4.7).
*Done when:* a test moves a fixture region between two worlds with different climates and shows generated biomes changed while manual areas and places did not.

*Done when:* determinism tests pass; a test proves a manual hole carved in the land survives reroll; rivers never run uphill. **[USER CHECK]** reroll a continent, carve a central hole like image 02, reroll around it.

### Phase 8 — city (highest risk; keep it simple)

**P8.1 Blocks.** Inputs are constraints the user drew: major roads, city walls and gates, water, cliffs, plateaus, landmark buildings, district areas with density and wealth values. City region minus buffered roads and obstacles = blocks. Large blocks are split by secondary streets (recursive split across the longest axis with jitter) until they are under the district's target size.
**P8.2 Lots and buildings.** Along each block edge, cut lots; place one building footprint per lot, inset from the street; leave courtyards in deep blocks. Size and spacing vary with density; wealth changes the theme roles used. Output buildings are `area` entities (role building) plus roof props where the theme has them.
**P8.3 District reroll and places.** Reroll one district only (rule A keeps landmarks and edited buildings). Any building can be made a place and opened as an interior (P5.4).

*Done when:* tests prove determinism, that no building overlaps a road, wall, water or manual building, and that every block touches a street. **[USER CHECK]** lay out Khartoum's coastline, cliff, upper wall, docks and main roads, then generate around them. If the result is not usable after this phase, stop: improving the algorithm is a user decision, not a task.

---

## 7. Open items for the user (none block phases 0–4)

- Foundry version, after which a native scene export with true secret doors could replace the P4.3 workaround.
- Whether company policy allows running the unsigned portable build on the work laptop (P0.4).
- Which pack assets fill each theme role (done by the user in P3.5).
- The Foundry items listed as later work in section 2.
