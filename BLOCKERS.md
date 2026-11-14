# Phase 6 verification

No remaining automated-verification blockers. Phase 6 is complete through P6.1; phase 7 has not been started.

- `npm run check`: passed, 39 files / 132 unit tests.
- `npm run build`: passed.
- `npm run e2e`: passed, all 20 Electron tests.
- Phase 6 checks cover deterministic output, flood-fill reachability of every clearing and entrance across water, bridge coverage and bridge length on a long manual trail, holes/concave footprints, manual area/prop/trail constraints, inherited land, water switches, themed art, reroll preservation, settings restoration, MCP commands, accept/undo and persisted generator records. The rendered woodland was inspected visually.
- Human forest/pyramid comparisons, real-art, TV/monitor, second-PC and Foundry checks remain in `USER_CHECKS.md`.

Electron cannot start inside this desktop app's filesystem sandbox (process exits before app startup). The same Electron suite runs successfully outside the sandbox. No app launch workaround or test timeout increase was added.

During P4.2, the new export test needed to wait for the renderer agent bridge before making MCP calls, and its status selector needed an accessible name to avoid Dockview's live status region. The saved image assertions then passed. The earlier P3.5 asset selector collision remains fixed.

The pre-existing uncommitted changes in `src/main/protocol.ts` and `e2e/backdrop-import.spec.ts` are preserved and remain outside the phase-6 commit.
