# Phase 4 verification

No remaining automated-verification blockers. Phase 4 / v1 is complete through P4.5; phase 5 has not been started.

- `npm run check`: passed, 34 files / 111 unit tests.
- `npm run build`: passed.
- `npm run e2e`: passed, all 18 Electron tests.
- Human TV/monitor, real-art, second-PC and Foundry checks remain in `USER_CHECKS.md`.

Electron cannot start inside this desktop app's filesystem sandbox (process exits before app startup). The same Electron suite runs successfully outside the sandbox. No app launch workaround or test timeout increase was added.

During P4.2, the new export test needed to wait for the renderer agent bridge before making MCP calls, and its status selector needed an accessible name to avoid Dockview's live status region. The saved image assertions then passed. The earlier P3.5 asset selector collision remains fixed.

The pre-existing uncommitted changes in `src/main/protocol.ts` and `e2e/backdrop-import.spec.ts` are preserved and remain outside the phase-4 commits.
