# Campaign Atlas

Offline Windows desktop worldbuilding editor built with Electron, React, TypeScript, Dockview, and PixiJS.

## Current Status

- **Implemented (Phases 0–6):**
  - Electron + `electron-vite` + React 19 + strict TypeScript shell
  - Custom `app://` (production bundle) and `atlas-file://` (allowed-root-restricted asset loading) schemes
  - Dockview workspace with real popout windows, per-world layout persistence, off-screen display recovery, and light/dark theme syncing across all windows
  - Zod-validated world/map schemas, migrations, command registry, and 200-step Immer patch undo/redo
  - Portable world folder saves (`world.json`, `maps/<id>.json`, `assets/`, `backups/`), atomic writes, 2-second autosave, 10-minute/on-open backups (rotated to 20), and corrupt-file recovery
  - PixiJS 8 WebGL `MapView` with pan/zoom clamped by map kind, incremental entity redraws, and multi-view sync
  - Maps panel tree, map creation by kind, SHA-1 copy-on-import backdrop images, and scale calibration ("Set Real Size")
  - Localhost MCP agent server (`127.0.0.1` + bearer token) with `world_*`, `schema_get`, `command_list`, `command_run`, `undo`/`redo`, `map_list`/`map_get`, and `render_png`
  - Portable Windows build (`dist/CampaignAtlas-Portable.exe`)
  - Manual selection and transforms, layers and inspector, area/path drawing, vertex editing and area add/subtract, walls, doors, lights and labels
  - Places with search, category filters and notes; child maps, interiors, portals, continuous zoom-through and pull-from-parent updates
  - SVG import with outline preview, per-shape area/path roles, real width in feet, editable-layer selection, compound-path holes and one-step undo (`map.importSvg` accepts flattened geometry through MCP)
  - Temporary route measurement in feet/miles, speed in mph, travel duration and arrival time with day rollover; routes survive docking/popouts and never change saves or undo history (`map.measureRoute` through MCP)
  - Cached background indexing of loose image folders, folder/name/tag browsing with paged results and lazy cached thumbnails; editable pixels-per-square scale
  - Portable prop stamping, flat built-in props, repeating area fills and textures along paths/walls; used art is copied into the world, textures load/unload with visibility across views
  - Dungeondraft Godot PCK v1 imports, verified against a real public pack, with path/bounds/checksum validation
  - MCP asset search plus copy-on-use `prop.stamp` and `entity.setTexture` commands
  - World theme editor in Assets, portable role assignments, built-in fallbacks and MCP `theme_get` / `theme.setRole`

  - Shared-state player/TV window with independent map selection, Send my view, labels/grid toggles and monitor fullscreen; private content and secret-door markers are excluded
  - Undoable reveal/hide brush with adjustable radius, reveal-all/hide-all and matching GM/player fog cover
  - Player-safe PNG and Universal VTT exports for the whole map, selection rectangle or custom rectangle, with grid scale and an 8192-pixel cap; UVTT includes walls, doors, lights and a secret-door report
  - Whole-world forks, portable map-tree copies/moves, placement transforms and replace/merge land; target verification and backups protect source maps
  - Linked copies, manual sync with per-entity Mine/Theirs conflicts, one-step undo, new asset copying and machine-local world-folder lookup

  - Seeded building, dungeon/corridor and chamber/alcove generators; connected rooms, inherited entrances, manual-wall constraints, left/right mirroring and one-step undo
  - Room-purpose dressing using theme art or built-in props, door and route clearance, dressing-only rerolls, and selected-area thin/add/reroll controls
  - Settlement building interiors with disposable previews, reroll/cancel, and one-command acceptance into a child map linked to the building's place
  - Outdoor woodland generator with numbered connected clearings, winding entrance trails, boundary trees and scattered trees, optional stream/pond, and themed bridges; manual areas, paths and props survive rerolls

- **Completed through P7.3 decoration and settlement suggestions.** World/region area footprints can generate seeded continents with traced coasts, holes, manual land/water overrides, custom biome tables and downhill rivers. World climate settings persist and manual biomes survive rerolls. All automated checks pass; see `BLOCKERS.md`. Mountains, forests and hills use theme art; settlement suggestions can be accepted as permanent places or dismissed. Re-climate transfers remain unfinished. Human visual comparisons, real-art, Foundry, TV and second-PC checks remain in `USER_CHECKS.md`.

## Development

```bash
npm install
npm run dev       # Start Electron + Vite dev server
npm run check     # TypeScript check (node + web) + Vitest unit tests
npm run build     # Production build into out/
npm run e2e       # Playwright Electron E2E tests (runs against out/)
npm run dist      # Build Windows portable (.exe) and dir targets into dist/
```

## World Folder Format

```text
MyWorld/
  world.json            World metadata, map index, and themes
  maps/<mapId>.json     Individual map documents
  assets/<sha1>.<ext>   Imported images copied by content hash
  assets/index.json     Asset metadata (original name, dimensions, pxPerSquare)
  backups/<timestamp>/  Automatic snapshots of world.json and maps/
```

Window/panel layouts and the recent-worlds list are stored in Electron `userData` rather than inside the world folder so worlds stay portable across machines with different monitors.

## Asset Packs

In **Settings**, choose **Register folder** for loose PNG/JPEG/WebP/BMP art, or **Import Dungeondraft pack** for a `.dungeondraft_pack` file. Unzip downloaded packs first. Registration indexes files in place; **Reindex** picks up later changes. Loose folders default to 200 pixels per square, Dungeondraft to 256. Change this in Settings before placing art if your pack uses another scale.

Open **Assets**, browse folders or search names/tags, and select an image. **Stamp on map** places it on clicks using the current scale, rotation and flip. Select areas, paths or walls and choose **Texture selection** to apply repeating art. All map edits undo normally. **Built-in flat props** work without a pack.

The **World theme** editor in Assets assigns the selected art to a named theme and role. Multiple assets can fill a role; removing the last assignment restores its flat placeholder. Assignments copy art into the world immediately. The source pack is not needed on another machine. Choose the theme in Generator to use its furniture roles.

## Dungeon and Interior Generators

Open **Generator**. On a site or interior map, select an area footprint, choose Building rooms, Dungeon and corridors, or Chamber and alcoves, then set the seed, room count, purpose, density and optional left/right mirror. **Generate** creates editable floors, walls, doors and furniture. Footprints must be connected and large enough for nine grid squares; a solid manual wall needs a door before generation can connect across it.

**Reroll** changes untouched generated content. Moving or editing an entity makes it manual, so it survives subsequent rerolls. **Reroll dressing only** keeps the layout. Select a floor to assign that room a purpose, or select an area and use **Thin out**, **Add more** or **Reroll area dressing**. Furniture stays clear of doors and straight routes between a room's doors. **Accept** keeps the run as manual content and finishes it; undo restores the run.

On a settlement map, select a building footprint and choose **Preview interior**. Choose its purpose and layout, reroll until satisfied, then **Accept interior**. Previewing and cancelling do not change the world. Acceptance creates and opens an interior at the building's real size and links it to the existing place, keeping its notes, or creates a place if needed. Buildings with an interior offer **Open existing interior**. The accepted interior remains editable and rerollable.

MCP uses the same `generator.run`, `generator.reroll`, `generator.dressArea`, `generator.accept` and `map.generateInterior` commands through `command_run`. Every action is one undo step.

Agent commands accept `packAssetId` from `asset_search` for `prop.stamp` and `entity.setTexture`, and `packAssetIds` for `theme.setRole`. These copy the art before applying the commands as one undo step. Existing world art can be referenced with `assetId` (or `assetIds` for themes).

## Outdoor Locations

On a **site** map, draw/select an area and choose **Outdoor woodland** in Generator. Set the clearing count, tree density and seed. Water can include a stream crossing, a pond, or both. **Generate**, **Reroll** and **Accept** use the same undoable commands as interiors. Trees and bridges use the theme's `tree` and `bridge` roles, with built-in art when those roles are empty.

Trails connect the numbered clearings and entrances; bridges cover stream crossings, including crossings of manual trails/roads. Entrances default to the north and south boundary. **Add entrance** supplies custom coordinates in feet; the generator snaps them to the footprint boundary. Existing runs restore those settings. MCP uses `generator.run` with `type: 'glade'` and `params: { clearings, density, water, stream, pond, entrances }`; its entrance points use metres.

Manual areas and props reserve space, hand-drawn trails/roads connect to the new network, and developed sites can use inherited land/biome ground. The generator rejects disconnected or cramped footprints and blocked entrances without changing the map; reduce the count, disable a water feature, or choose a larger connected footprint when prompted. The limit is 20,000 grid squares. Outdoor rerolls replace the layout and trees together.

## SVG Import

In **Maps**, choose **Import SVG**, set the drawing’s real width in feet, and assign each shape an area or path role (or skip it). The import starts at the map’s top-left corner and preserves the SVG proportions. Curves become editable points; holes, separate outlines and group transforms are preserved. The whole import undoes in one step.

This imports plain vector geometry, including paths and basic shapes. Text, embedded images, reusable `use` elements, stylesheets, clipping and masks are not reproduced; the dialog reports skipped content. Convert these to plain paths in your SVG editor first when needed.

## Agent MCP Server

When enabled (on by default), the main process serves an MCP Streamable HTTP endpoint on `http://127.0.0.1:<port>/mcp` requiring `Authorization: Bearer <token>`. View the URL, token, toggle, and ready-to-copy client config in the **Settings** panel.

## Measure a Route

Choose **Measure**, then click along a route. The readout previews the next segment under the cursor. Press **Enter**, double-click, or choose **Finish** to hold the result. **Backspace** removes the last point; **Esc** or **Clear** clears the route. Click after finishing to start another route.

Distance displays feet below one mile and miles above it. Enter speed in miles per hour and a departure time for travel duration and arrival, including any days crossed. Estimates assume continuous travel at that speed; arrival rounds to the nearest minute. Measurements are temporary and stay out of world files, exports and undo history.

## Player Display and Exports

Open **Player window**, choose its map, and use **Send my view** to copy the current GM camera. Navigating to another map in the editor keeps the player display on the chosen map. Choose a monitor and **Apply display** for fullscreen, or choose **Windowed** to leave fullscreen. Player labels and grid have separate toggles.

Fog controls act on the map being edited. Enable fog, select the **Fog** tool, and drag to Reveal or Hide using the brush radius in metres. Each stroke is one undo step. The GM sees half-transparent cover; players see solid cover.

Open **Export** for a player-safe PNG or `.dd2vtt`. Choose the whole map, selection bounds or a custom rectangle, and pixels per grid square. Large exports are proportionally reduced to 8192 pixels per side and report the cap. Exports omit fog and private content. The VTT report identifies secret doors to set up as secret after import into Foundry.

## World Transfers and Linked Sync

Open **World transfers** to fork into an empty folder, or copy/move the active map and its descendants into an existing world. Placement can position, rotate and scale geography under a target parent, replacing area and line geometry underneath or merging land with a seam margin. Interior dimensions stay fixed. Used art travels with the maps. A move verifies the written target before updating the source. Undo restores the source side; the target copy remains independent.

**Linked copy** keeps map/entity ids, so those map ids must be absent from the target. Each map can link to one counterpart. On either side, **Preview linked sync** lists incoming changes and conflicts; select Mine or Theirs per entity and apply. Sync pulls entity changes into the open map; sync linked descendants individually. A second unchanged sync adds no undo step. World-folder locations stay in this computer's recent-world list, and the app asks for the linked folder if it cannot locate it.

MCP exposes `export_player_image`, `export_uvtt`, `world_fork`, `world_copy_map` (copy/move/linked) and `world_sync_map` (preview by default). The normal command registry also includes `fog.paint` and `map.syncLinked`.
