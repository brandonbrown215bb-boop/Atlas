# Phase 5 verification

No remaining automated-verification blockers. Phase 5 is complete through P5.4; phase 6 has not been started.

- `npm run check`: passed, 38 files / 126 unit tests.
- `npm run build`: passed.
- `npm run e2e`: passed, all 19 Electron tests.
- Phase 5 checks cover deterministic layouts/dressing, room reachability, door/route clearance, manual edits surviving reroll, dressing-only and scoped actions, preview/accept/undo, MCP generation and persisted generator records. The interior preview was inspected visually.
- Human pyramid/real-art, TV/monitor, second-PC and Foundry checks remain in `USER_CHECKS.md`.

Electron cannot start inside this desktop app's filesystem sandbox (process exits before app startup). The same Electron suite runs successfully outside the sandbox. No app launch workaround or test timeout increase was added.

During P4.2, the new export test needed to wait for the renderer agent bridge before making MCP calls, and its status selector needed an accessible name to avoid Dockview's live status region. The saved image assertions then passed. The earlier P3.5 asset selector collision remains fixed.

The pre-existing uncommitted changes in `src/main/protocol.ts` and `e2e/backdrop-import.spec.ts` are preserved and remain outside the phase-5 commits.
