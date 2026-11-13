# Campaign Atlas

Offline Windows desktop worldbuilding editor built with Electron, React, TypeScript, Dockview, and PixiJS.

## Current Status

- **Implemented (Phases 0–1):**
  - Electron + `electron-vite` + React 19 + strict TypeScript shell
  - Custom `app://` (production bundle) and `atlas-file://` (allowed-root-restricted asset loading) schemes
  - Dockview workspace with real popout windows, per-world layout persistence, off-screen display recovery, and light/dark theme syncing across all windows
  - Zod-validated world/map schemas, migrations, command registry, and 200-step Immer patch undo/redo
  - Portable world folder saves (`world.json`, `maps/<id>.json`, `assets/`, `backups/`), atomic writes, 2-second autosave, 10-minute/on-open backups (rotated to 20), and corrupt-file recovery
  - PixiJS 8 WebGL `MapView` with pan/zoom clamped by map kind, incremental entity redraws, and multi-view sync
  - Maps panel tree, map creation by kind, SHA-1 copy-on-import backdrop images, and scale calibration ("Set Real Size")
  - Localhost MCP agent server (`127.0.0.1` + bearer token) with `world_*`, `schema_get`, `command_list`, `command_run`, `undo`/`redo`, `map_list`/`map_get`, and `render_png`
  - Portable Windows build (`dist/CampaignAtlas-Portable.exe`)

- **Not Yet Implemented (Phases 2–8):**
  - Manual drawing/editing tools (select, area, path, vertex edit, wall, door, light, label, places, SVG import, measure)
  - Child map zoom-through and cross-world copy/move/sync
  - Asset pack indexing (Forgotten Adventures / `.dungeondraft_pack`) and theme editor
  - Player/TV window, reveal brush, player-safe PNG export, and Universal VTT (`.dd2vtt`) export
  - Procedural generators (dungeon/interior, outdoor glade, world/continent, city)

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

## Agent MCP Server

When enabled (on by default), the main process serves an MCP Streamable HTTP endpoint on `http://127.0.0.1:<port>/mcp` requiring `Authorization: Bearer <token>`. View the URL, token, toggle, and ready-to-copy client config in the **Settings** panel.
