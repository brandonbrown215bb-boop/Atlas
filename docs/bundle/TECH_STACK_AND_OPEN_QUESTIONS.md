# Desktop requirements and proposed stack

## Confirmed requirements

1. World saves.
2. Transfer map data between world saves when desired.
3. Dockable UI, including actual separate windows that can move to another monitor.
4. A dark mode option.
5. Windows desktop application that works offline.
6. Both independent map windows and detached tools. A region, city, notes, and location details can occupy different windows.
7. 2D maps initially, with the potential for 3D later.

Worldbuilding must work without a planned session. Home-game TV display and Foundry are optional ways to use the maps.

## Current recommendation

This is a proposal, not a selected or implemented stack.

| Piece | Purpose | Reference |
|---|---|---|
| Electron | Desktop application and separate windows | https://www.electronjs.org/docs/latest/api/browser-window |
| TypeScript + React | Controls, notes, location lists, and settings | https://react.dev/learn |
| PixiJS | 2D map rendering, initially using WebGL | https://pixijs.com/8.x/guides/components/renderers |
| Dockview | Docking, tabs, floating groups, and separate-window popouts | https://dockview.dev/docs/core/groups/popoutGroups/ |

Verify map rendering and real popout behavior in the desktop shell early. Docking a tool and opening a second independently navigable map are both required experiences.

For initial saves, the proposal is a portable world folder containing structured map/note data and copied assets, with a packaged export for transfer. The exact format and need for a database remain undecided.

For possible future 3D, preserve meaningful dimensions and elevation. Actual models and a 3D view would still be substantial separate work. No 3D editor or asset pipeline is part of the initial commitment.

## Additional practical requirements proposed

- Autosave and recoverable backups, including recovery from a bad generation pass.
- Undo/redo for edits made through any window belonging to the same world.
- Transfers that can include a place's interiors, notes, dressing, and required assets.
- Remembered panel/window layouts, with offscreen-window recovery when monitors change.
- Layers and groups, with hiding and locking.
- A clean optional player-display window for a TV.
- Searchable named places that remain attached to their map objects.
- Optional Foundry handoff that avoids manually retracing walls.

## Three unanswered questions from the discussion

1. **Independent copies or linked reuse?** When a city is copied into another world, should the two versions become independent? Independent copies are the suggested default. Linked copies would need rules for shared edits.
2. **User asset packs?** Should the first version import and organize downloaded collections of trees, buildings, furniture, textures, and other art? This affects the initial asset browser.
3. **How strict is offline support?** Must every feature, including AI suggestions, work offline? Or can optional suggestions use an online service while map creation and editing stay offline?

Other details still to settle: copy versus move; world forks; how much related data a transfer includes; handling conflicts with existing geography; exact saving and backup behavior; selected Foundry version and integration route; and the amount of player-display functionality.

## Useful small checks when implementation begins

- Save a small world, close it, reopen it, and confirm imported assets and edits remain intact.
- Open two independent map views and detached notes; edit through one window and confirm the others reflect the change.
- Close or disconnect a monitor and recover all windows.
- Copy a developed location into a second world with its needed assets and interior.
- When building Foundry integration, import a room with an ordinary and a secret door and verify alignment, movement, and vision without tracing walls manually.

These are checks of the required behavior, not a request to build the whole feature list at once.
