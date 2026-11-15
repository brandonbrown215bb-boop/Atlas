# Checks completed by Rook — 2026-11-14

Completed 10 of the original 23 `USER_CHECKS.md` entries. Remaining portions of the other 13 are listed in [USER_CHECKS.md](../USER_CHECKS.md). Tests used temporary worlds and isolated app profiles; existing worlds and registered packs were not changed.

## Results

| Check | Result |
| --- | --- |
| `npm run check` | TypeScript and all 150 unit tests pass (45 files). |
| `npm run build` | Production build passes. |
| `npm run e2e` | All 24 Electron tests pass (46.2 seconds). |
| Visual inspection | Inspected all three backdrops, city tracing, reopened interior, texture popout, GM/player fog, woodland and continent screenshots. |

Electron runs outside the desktop filesystem sandbox because it cannot start inside it. No test timeouts were increased. The existing backdrop CORS fix was retained and its pixel regression check passes.

## Completed entries

| Original entry | Evidence |
| --- | --- |
| Phase 7: re-climate arriving regions | `reclimate.test.ts` checks copy/move/linked at identity and 90-degree rotation with 2x scale, preserving non-biome entities, coast holes, rivers, manual areas, notes and developed children. Separate checks cover arrival latitude, no-footprint children, linked sync and move undo. `world-reclimate.spec.ts` checks a saved UI move/undo and MCP copy between different climates. |
| Phase 6: woodland behavior | `outdoor.test.ts` checks multiple seeds, reachability, concave footprints/holes, custom entrances, water switches, manual constraints, edited-output preservation and failure without mutation. `outdoor.spec.ts` exercises entrance feet-to-metres conversion, generation, reroll, accept, undo and saved generator state. |
| Phase 5: generated interior workflow | `generators.spec.ts` now also checks preview cancel without world/history changes, inherited entrance coordinates, saved dimensions/notes and opening the same interior through Places after restarting. Acceptance, undo/redo and reroll preservation pass. Unit checks cover doorway clearance and stale previews. |
| P1.5: three reference backdrops | `backdrop-import.spec.ts` checks actual rendered pixels for world/city/pyramid, calibration using miles/metres/feet, dimension calculations, preserved aspect ratio, undo/redo and exact saved image entities after restart. Screenshots show all three images with correct proportions. |
| Phase 2: Khartoum tracing and places | `reference-workflow.spec.ts` uses pointer clicks to trace the reference shoreline, upper-district wall and three shop footprints. Creates/searches the three named places, edits notes, opens a shop interior, imports the pyramid and verifies the complete world and linked interior after restart. |
| Phase 2: measure a route | `measure.spec.ts` checks a finished multi-segment route, changed speed, next-day arrivals, invalid speed, unchanged world/history, popout/dock persistence, per-map routes and MCP results. |
| Phase 3: textured geometry and views | `assets.spec.ts` samples actual pixels on a textured floor with a hole, path, wall and prop. Checks layer hide/show in the main window and a popout, then docking back. Portable fixture art also appears in a player export and after reopening with a fresh profile without packs. This uses obvious green fixture art; real-art appearance remains a user check. |
| Phase 4: fog brush | New `fog-brush.spec.ts` draws a reveal stroke and a smaller hide hole with real pointer input, checks one undo step per stroke, undo/redo, opaque black player cover and half-opacity GM cover using pixels, then reveal-all. |
| Phase 4: PNG export regions and cap | `outputs.spec.ts` now exercises whole-map, selection and offset custom rectangles through the UI, comparing saved bytes to MCP exports. Verifies a real 8192 x 8 capped image and the cap warning. Existing checks prove private art is excluded and fog omitted. `assets.spec.ts` verifies portable pack art in the exported pixels. |
| Phase 4: copy/move/fork and placement | `transfers.spec.ts`, `transfer.test.ts` and `transferFs.test.ts` verify actual saved copies/moves/forks, fresh fork identity, tree references, notes, portable art, rotation/scale, replace/merge seams, fixed interior dimensions, undo, source backups and unchanged source on failed target write. |

## Bug fixed

**Open Interior could leave Places in front of the map.** The command loaded the interior but did not activate its Dockview tab. `PlacesPanel.tsx` now activates the target map panel after opening it. The new city-reference workflow exercises the previously failing arrangement, including opening an existing interior after restart.

## Screenshots

These are copies from the final passing run, kept outside the disposable test-results folder:

- Backdrops: [world](verification/2026-11-14/world-backdrop.png), [city](verification/2026-11-14/city-backdrop.png), [pyramid](verification/2026-11-14/pyramid-backdrop.png).
- Workflows: [city tracing](verification/2026-11-14/city-tracing.png), [reopened interior](verification/2026-11-14/reopened-interior.png), [textured popout](verification/2026-11-14/textured-popout.png).
- Fog: [GM](verification/2026-11-14/gm-fog.png), [player](verification/2026-11-14/player-fog.png).
- Generators: [woodland](verification/2026-11-14/outdoor-generator.png), [continent](verification/2026-11-14/continent-generator.png).

These checks establish functional behavior with reference images, fixture art and generated maps on this PC. They do not establish whether the layouts match your taste, your real packs have the desired scale, the TV/second PC behaves correctly, or your Foundry installation imports the files correctly. The portable EXE is not currently built in this checkout.
