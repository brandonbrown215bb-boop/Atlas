# Workflow repair implementation

User authorized the complete plan on 2026-11-14. Work is in the existing dirty tree; do not reset unrelated changes or modify the real saved world at `C:/Users/brand/Pictures/world test`. No packages installed. No subagents requested.

Implemented so far:

- Unified editor navigation (`model/navigation.ts`), including stale Dockview activation protection. Fit Map/Selection, broad zoom limits, scale bar, dimension displays, optional zoom-through with hysteresis, correctly sized map defaults and editable Develop Area dimensions.
- Draft keyboard/toolbar history priority through `model/drawingHistory.ts`; existing draft point Undo/Redo retained.
- Version 2 schema/migration: groups, boundary snapshots, water/symbol classifications, terrain models, river junctions. Legacy geometry retained; Repair Existing World UI applies extent/boundary repairs explicitly.
- Shared geography resolver fixes ocean-under-land, implicit ocean, lake masks, child/city semantics and biome clipping. Child terrain data preserved, world icons hidden at town/site/interior scales, masks clip child rendering.
- Group selection/Edit Parts, atomic group transforms/reroll ownership, intentional edits retained, Return to generated action.
- Biome brush/picker, direct River button, cartographic widths, physical units, shared river junction commands and propagation.
- Plate-based terrain and priority-flood drainage, corrected climate bounds/clamping, populate-existing-geography mode, persisted models. Worker-based generation with stale-world rejection; MCP uses worker too.
- Local automatic trace worker + review dialog: water sampling, sensitivity, correction brushes, correction history, river addition/removal, transactional acceptance. Read-only MCP `trace_backdrop` adapter added (latest edits not yet rebuilt).
- Ten-foot configurable dungeon corridors with clearance routing, corridor contact openings, varied random purposes, differentiated code-drawn props/terrain glyphs, bounded symbol selection highlights.

Validation so far:

- Typecheck passing after latest changes.
- Initial full 26-test Electron run: 20 passed, 6 failures; async tests and root extent fixtures corrected.
- Second affected 8-test Electron run: city, outdoor, exports, reference workflow, world generator and NEW connected empty-world→town→interior→unrelated map→restart all pass. Two failures remained: new interior defaulted to format 1, causing migration differences on restart (fixed by MapDoc default version 2, needs rebuild/retest); trace→populate remained busy longer than the test's 5-second assertion.
- Added `model/workflowRepair.test.ts` (8 tests) and `import/trace.test.ts` (2 tests). All targeted tests passed except an exact float equality, corrected to tolerance. Full unit run then had 169/170 passing, with an existing outdoor test exceeding 5 seconds under build/test contention. Vitest now capped at four workers rather than launching 48 simultaneously; rerun without concurrent build.
- No test timeouts increased. Production build, all 48 unit test files (178 tests), and all 28 Playwright Electron E2E tests pass.

Completed verification and visual QA before delivery:

1. Rebuilt and reran `e2e/workflow-repair.spec.ts` and `e2e/generators.spec.ts`: both workflow-repair walkthroughs (`11.2s` and `5.7s`) and `generators.spec.ts` (`3.2s`) pass well within standard timeouts.
2. Visually inspected all 5 generated screenshots in `test-results` (`world-cartography.png`, `town-cartography.png`, `trace-review.png`, `populated-trace.png`, `traced-town-interior.png`). Fixed automatic trace colour/speckle filtering, excluded synthetic `usage: 'boundary'` footprints from `populate` land constraints, scaled physical river widths to realistic metres with bounded cartographic strokes, suppressed per-member yellow outlines during whole-group selection, fixed HUD contrast in light mode, and docked auxiliary panels to the inspector group so `Maps` stays visible.
3. Verified recursive, rotation-safe group transforms (`group.applyTransform`), child-anchor scaling with preserved interior dimensions, and `map.pullFromParent` revision tracking for building interiors.
4. Verified legacy terrain upgrade preview (`WorldUpgradePreview.tsx`), `Repair Existing World…` (`map.repair`), city obstacle diagnostics (`map.cityDiagnostics`), physical child clipping, post-wall dungeon connectivity validation, and contradicted manual river error reporting in `populate` mode.
5. Ran full `npm run check` (48 files / 178 tests), `npm run build`, and `npx playwright test` (28 Electron E2E tests).

Current new interfaces: `map.setExtent`, `map.setGeographyOptions`, `group.applyTransform`, `entity.returnToGenerated`, `map.paintBiome`, `map.applyTrace`, `map.repair`, `world.applyGenerated`, `river.add`, `map.cityDiagnostics`, and read-only `trace_backdrop`. `generator.run` accepts an omitted footprint for world generation plus `useBoundaryAsExtent`.
