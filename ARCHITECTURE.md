# Architecture

## Process Boundaries

- **Main process (`src/main/`):**
  - Owns all filesystem access (`worldFs.ts`, `ipc.ts`), native dialogs, window lifecycle (`index.ts`, `windowBounds.ts`), custom protocols (`protocol.ts`, `pathSecurity.ts`), and the localhost MCP server (`agent.ts`).
  - `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` on all `BrowserWindow` instances.
  - `app://atlas/*` serves the built renderer bundle; `atlas-file://*` serves local assets only if `resolveAllowedPath` confirms the resolved realpath lies inside `userData` or the currently open world directory.
- **Preload (`src/preload/index.ts`):**
  - Exposes a narrow typed `window.atlasApi` bridge via `contextBridge`.
- **Renderer (`src/renderer/`):**
  - Single renderer process hosts the main window and any `window.open` popouts (`popout.html`), allowing all Dockview panels to share one Zustand store without cross-process state sync.

## Purity Boundary

- `src/renderer/model/` (and future `geom/`, `gen/`, `export/uvtt.ts`) must not import React, PixiJS, Electron, or touch the DOM.
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
- `src/renderer/app/App.tsx` — Menu bar, Dockview host, layout save/restore, theme sync.
- `src/renderer/render/MapView.tsx` — PixiJS 8 canvas lifecycle, incremental entity sync, pan/zoom, scale calibration.
