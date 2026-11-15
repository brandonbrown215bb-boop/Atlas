# Nimblehold Feature Port Plan (Items 1–4)

Practical plan for bringing the 4 high-value ideas identified in Nimblehold (`RpgMapMaker.dll` / `core.zip`) into Atlas without adding Godot-style bloat. Ordered by **dependency and payoff**: wall cutting first (zero schema changes), then prop metadata/lights, smarter room dressing (which needs prop facing), and generalized auto-bridging/stairs/docks on paths.

---

## Phase 1 — Split Rendered Walls at Doors (Item 3)

**Problem:** [exportUvtt](../src/renderer/export/uvtt.ts#L30-L46) already cuts door gaps out of walls for VTT line-of-sight export, but [drawEntity](../src/renderer/render/drawEntity.ts#L182-L231) draws walls as unbroken polylines underneath doors.

**Changes:**
1. Extract the collinear `[0, 1]` interval subtraction helper from [uvtt.ts](../src/renderer/export/uvtt.ts#L34-L42) into `src/renderer/geom/wallDoor.ts` (`splitWallByDoors(wall, doors, overlap = 0)`), adding an optional ~2–3 px overlap margin so textured wall ends meet door jambs cleanly without gaps.
2. Extend `buildEntityDisplay` options in [drawEntity.ts](../src/renderer/render/drawEntity.ts) with optional matching `doors` for wall entities and stroke/texture each surviving piece instead of the full segment.
3. Pass touching doors into `buildEntityDisplay` in [MapView.tsx](../src/renderer/render/MapView.tsx#L449-L455) (plus child-map rendering) and [renderPng.ts](../src/renderer/render/renderPng.ts#L79-L84), and invalidate/rebuild overlapping walls when a door entity is added, moved, or deleted.

**Skip:** `BuildingBooleanSplice`—[layout.ts](../src/renderer/gen/dungeon/layout.ts) already merges generated room cells via `polygon-clipping`.

---

## Phase 2 — Prop Facing Metadata & Attached Lights (Item 4)

**Problem:** Atlas has ~76k unpacked textures/props (`assets/`), but lacks which edge of a prop sprite is "front" (so auto-oriented furniture can face backwards) and can't auto-attach lights when stamping torches/campfires.

**Changes:**
1. Add optional metadata to `AssetIndexEntrySchema` in [schema.ts](../src/renderer/model/schema.ts#L318-L325):
   - `forwardDeg?: 0 | 90 | 180 | 270` (sprite forward orientation)
   - `light?: { offsetX: number; offsetY: number; radius: number; color: string }`
2. Expose quick controls in `InspectorPanel` / `AssetsPanel` to set `forwardDeg` or toggle an attached light on an asset entry in `assets/index.json` (plus optional filename heuristics on `usePackAsset` if desired).
3. In [assets/commands.ts](../src/renderer/assets/commands.ts#L26-L36), when `prop.stamp` resolves an asset whose `AssetsIndex` entry includes `light`, append a paired `entity.add` (`light`) command rotated/offset by the prop's pose in the same `executeBatch(..., label)` step (linked with `groupId`), so placing or undoing a brazier handles both in one action.

**Defer:**
- *Nimblehold `.obj.json` / `.feat.json` parsers:* Not needed; packs are standard image folders.
- *Multi-skin browser grouping (`_a`/`_b`, `_01`/`_02`):* Only add in `AssetsPanel` if browsing unpacked pack variants feels noisy.
- *Composite walls:* Can be added later as a lightweight vertex-post scatter helper (e.g., dropping corner tower/pillar props on `cityWall` / `wall` vertices) instead of a JSON recipe DSL.

---

## Phase 3 — Smarter Room Dressing (Item 2)

**Problem:** [dressing.ts](../src/renderer/gen/dungeon/dressing.ts#L10-L87) picks cleared grid points inside room polygons, sorts solely by distance to walls, rotates only to wall tangent (`atan2(b.y - a.y, b.x - a.x)`), and ignores props already placed manually in the room.

**Changes (depends on Phase 2 `forwardDeg` for accurate rotation):**
1. **Fix wall-facing direction & inset clearance:** Orient wall furniture inward toward the room center/normal (offset by the asset's `forwardDeg`), and widen doorway/route clearance arcs cleanly.
2. **Ordered cross-step placement (`nearRole` + `face`):**
   - Evolve `furniture[purpose]` entries in [dressing.ts](../src/renderer/gen/dungeon/dressing.ts#L10-L16) into ordered steps supporting optional `{ nearRole?: string; face?: 'target' | 'wallOut' | 'longestWall' }`.
   - Record placed `(x, y)` poses per role in each room so later steps (e.g., `chair`) pick points near `table`/`altar` (`~1–1.5 * grid`) and face inward (`atan2(target.y - p.y, target.x - p.x) - forwardRad`).
3. **Respect manual props (`SatisfiedByExisting`):**
   - [generator.dressArea](../src/renderer/model/commands.ts#L214-L216) already passes manual entities via `input.constraints`.
   - Before placing each role in a room, scan manual `prop` constraints inside `floor.rings` matching that role (by `name`/tags), subtract their count from `targetCount`, and register their existing positions as anchors for dependent steps (e.g., generated chairs arranging around a hand-placed table).

---

## Phase 4 — Auto-Transitioning Paths: Bridges, Docks, Stairs (Item 1)

**Problem:** [outdoor.ts](../src/renderer/gen/glade/outdoor.ts#L200-L231) only stamps `bridge` props on generated trails crossing its stream, while manual `road`/`trail` paths in [pathTool.ts](../src/renderer/tools/pathTool.ts) stay flat unbroken strokes across water and cliffs.

**Changes:**
1. Add `'dock'` and `'stairs'` to `THEME_ROLES` in [themes.ts](../src/renderer/model/themes.ts#L3) alongside `'bridge'`.
2. Add `src/renderer/geom/pathTransitions.ts` to walk polyline `PathEntity` segments (`~grid * 0.25` step) against map constraints:
   - `water` areas (`rings`) and `river` paths (`width / 2`) → spans crossing and exiting water classify as **`bridge`**; spans entering water and terminating inside classify as **`dock`**.
   - `cliff` paths and `plateau` area boundaries ([AreaEntitySchema.elevation](../src/renderer/model/schema.ts#L90)) → crossings with an elevation change classify as **`stairs`**.
3. Reuse the classifier in [outdoor.ts](../src/renderer/gen/glade/outdoor.ts#L201-L231) and wire an on-demand **"Auto-place bridges / docks / stairs"** command/action for any selected `road`/`trail` `PathEntity` (spawning themed props or textured sub-segments linked by `groupId`), leaving manual polyline drawing simple.

**Skip:** Godot `Curve2D` / `PreservingCurveSampler` cubic Bezier splitting—Atlas paths are pure polylines (`Point[]`).
