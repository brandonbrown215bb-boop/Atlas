# Resolved — P3.5 test selector collision

There are no remaining automated-verification blockers for phase 3. P3.5 passes typechecking, 83 unit tests, the production build, and all 14 Electron tests.

The expanded `e2e/assets.spec.ts` test, **MCP stamps portable props and textures with one undo step; UI can stamp the selected asset**, previously timed out at 30 seconds on two consecutive runs after adding theme checks. The initial reports did not identify the stalled action.

On follow-up investigation, a Playwright API trace showed that `getByRole('button', {name:'Tree.png'})` matched **Remove Tree.png from role** before the asynchronously loaded thumbnail appeared. The test removed the theme assignment instead of selecting the image, then waited for **Stamp on map**, which was absent because no asset had been selected. This was a test bug, not evidence of slow or broken Electron behavior.

Adding `exact:true` to the asset button selector fixes the collision. The isolated test passes in about three seconds, including rendering, undo/redo, UI stamping and theme edits, plus reopening with an unregistered-pack profile. The later full suite also passes. No timeout was increased and no assertion was removed.

Latest verification:

- `npm run check`: passed, 25 files / 83 unit tests.
- `npm run build`: passed.
- `npm run e2e`: all 14 passed.
- P3.4 real-pack verification passed separately: public Arkenforge demo, 481 directory entries, texture extraction/indexing, no skipped images. Provenance and observed layout are in `docs/bundle/research/DUNGEONDRAFT_PACK.md`.

Human real-pack/scale/second-PC checks remain in `USER_CHECKS.md`. The next planned implementation slice is P4.1.

Commits completed this session:

- `e11a9a9` — P3.1 folder registration and cached indexing.
- `5e29872` — P3.2 asset browser and thumbnails.
- `7c5ec9d` — P3.3 prop stamping, textures and copy-on-use.
- `3e30da7` — P3.4 verified Dungeondraft imports.

The existing uncommitted changes to `e2e/backdrop-import.spec.ts` and `src/main/protocol.ts` were preserved. The pre-existing image-load logging change in `src/renderer/render/textures.ts` was retained in the P3.3 commit alongside that file's texture lifecycle changes.
