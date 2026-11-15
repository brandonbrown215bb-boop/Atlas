# Visual Iteration Notes — Painterly / Parchment Fantasy Style

## Benchmark (Popular Web Maps: Inkarnate Parchment & Watercolor Styles)
- **World / Continent Maps**: Warm aged-parchment or painterly watercolor ocean with shallow coastal glow/ripples; crisp dark sepia coastlines (no harsh black outlines around biome regions); muted earthy/olive/ochre biome washes; hierarchical mountain ranges with SE shadow faces and NW highlights; layered forest groves with under-shading; tapered painterly rivers with soft banks; subtle paper grain and sepia vignette.
- **Settlement / City Maps**: Warm parchment/meadow ground (never black void); organic street networks filling the district; varied terracotta/slate/thatch pitched roofs with ridge lines and SE drop shadows; green garden courtyards; stone city walls and gates.
- **Site — Woodland / Glade**: Rich mottled forest floor; layered painterly tree canopies with ground shadows; soft shoreline water & wooden bridges; warm serif clearing numbers with parchment halos.
- **Site — Dungeon**: Warm dark sepia-earth rock surround (not flat `#0d1117` void); cohesive connected chambers & corridors (not 400ft empty hallways); textured stone/flagstone floors; thick inked stone walls with drop shadows; clear wooden doors and readable props.
- **Building Interior**: Warm wood plank / flagstone floors with inner wall ambient shadows; thick timber/stone walls; grouped furniture with drop shadows and warm hearth/torchlight.

---

## Round 0 — Baseline (`round-0-baseline/`)
- **Global**: `#0d1117` dark void background; flat single-color polygons with harsh `1.5px` black strokes; zero procedural textures; zero drop shadows; tiny low-contrast props.
- **World (`01-world.png`)**: Jagged Voronoi biome borders with thick black outlines; flat dark `#1c3548` ocean; thin bright `#2b7de9` digital river lines; tiny sparse symbols; bright purple diamond settlement markers.
- **City (`02-settlement-city.png`)**: Depth-first `cuts >= 500` cap starved 3/4 of the city, leaving huge empty black void and dangling road skeletons; uniform tiny brown rectangles with no roof shading or shadows.
- **Woodland (`03-site-woodland.png`)**: `render_png` failed with `Cannot read properties of null (reading 'clear')` when rendering `Text` labels.
- **Dungeon (`04-site-dungeon.png`)**: Tiny 15–20ft rooms connected by 300–400ft empty corridors on a 500×500ft black void; microscopic props.
- **Interior (`05-interior-tavern.png`)**: Flat muddy `#4e483d` floor, flat gray lines for walls, flat orange bars for doors, disconnected floating furniture.

---

## Round 1 (`round-1/`)
- **Changes**:
  - Added procedural tileable canvas textures (`parchment`, `watercolor`, `stone`, `wood`, `grass`, `water`) in `src/renderer/render/proceduralTextures.ts`.
  - Replaced `#0d1117` void with map-kind-aware warm parchment/ocean/forest/earth backdrops and paper-grain + vignette overlays in `src/renderer/render/renderPng.ts`.
  - Removed harsh black outlines from `biome:*` regions, added coastal shallow-water glow on `land`, SE drop shadows + pitched roof ridge highlights on `building`, riverbanks + highlights on `river`, drop-shadowed stone/timber `wall`s and wooden `door`s, serif labels with parchment halos, and upgraded `tree`, `mountain`, `hill`, and `settlement` symbols in `src/renderer/render/drawEntity.ts`.
  - Fixed `city.ts` depth-first `cuts >= 500` starvation bug (switched to breadth-first queue) and added varied terracotta/slate/thatch roof palettes.
  - Increased world `mountain`/`hill`/`forest` symbol sizes in `src/renderer/gen/world/decoration.ts`.
- **Observations**: Huge leap on `01-world.png`, `02-settlement-city.png`, and `03-site-woodland.png`. Found 3 remaining issues: `city.ts` hit `buildingCount >= 3000` halfway through a 1-mile map; `glade` grazing stream crossing created an overly wide bridge; `render_png` threw `Cannot read properties of null (reading 'clear')` on subsequent calls after `Text`.

## Round 2 (`round-2/`)
- **Changes**:
  - Added smooth radial `vignette` canvas texture in `proceduralTextures.ts`.
  - Added automatic 12-sided medieval `cityWall` + 4 gates for standalone large cities (`area > 250_000`) and bumped `buildingCount` cap to `8000` in `city.ts`.
  - Split long grazing stream bridges in `outdoor.ts` so bridges stay properly proportioned.
  - Scaled `dungeon` room sizes (`w`, `h`) to footprint size and connected rooms in nearest-neighbor MST order in `src/renderer/gen/dungeon/layout.ts`.
  - Added 3 deterministic `tree` variants (oak, pine, sage) and fixed `hill` to remove the flat bottom baseline in `drawEntity.ts`.
- **Observations**: `02-settlement-city.png` now looks like a complete walled medieval city with ribbon suburbs! `04-site-dungeon.png` has well-proportioned chambers and logical corridors, and `05-interior-tavern.png` has warm wood planks. Remaining issues: `hill` still had a slight bottom curve artifact, walls showed 5ft segment tick marks, and `dungeon` surround showed oversized brick tiling.

## Round 3 (`round-3/`)
- **Changes**:
  - Switched `renderPng.ts` back to `preference: 'webgl'` with `app.stage.destroy({ children: true }); app.destroy(false);` — all 5 map types now render reliably in a single session.
  - Added stone bastion towers at `cityWall` vertices, multi-ring coastal wave-ripples on `land`, and pure bottomless curved ink arcs for `hill` in `drawEntity.ts`.
  - Lowered `mountain` threshold (`.28` -> `.20`) in `decoration.ts` so sweeping mountain ranges form.
  - Grouped `chair`s around placed `table`s facing the table in `src/renderer/gen/dungeon/dressing.ts`.
- **Observations**: `01-world.png` mountain ranges and hills look great; `02-settlement-city.png` bastion towers look crisp; `03-site-woodland.png` bridges and mixed trees read cleanly; `05-interior-tavern.png` dining sets are cohesive. Only remaining blemishes: 5ft wall segment tick marks and giant brick tiling in the dungeon surround.

## Round 4 (`round-4/`)
- **Changes**:
  - Merged touching collinear `wall` segments in `src/renderer/gen/dungeon/layout.ts` so walls render seamlessly with zero segment tick marks.
  - Switched `dungeon` surround backdrop texture in `renderPng.ts` from `stone` to subtle `parchment` grain.
- **Result**: All 5 map types (`01-world.png`, `02-settlement-city.png`, `03-site-woodland.png`, `04-site-dungeon.png`, `05-interior-tavern.png`) render cleanly with warm painterly/parchment styling and all 50 test files (201 tests), TypeScript checks, and production build pass.


## Round 5 (`round-5-placement/`) — Smarter Placement Pass 1
- **World (`src/renderer/gen/world/decoration.ts`)**: Added `propGap` clearance to `safe()`, boosted settlement weight near rivers, sorted land cells by elevation descending so mountain spines place first, and added 1–2 companion stamps to forest groves and mountain ranges.
- **City (`src/renderer/gen/city/city.ts`)**: Added park and orchard `tree` props inside `Garden courtyard` and `Market gardens` blocks.
- **Woodland (`src/renderer/gen/glade/outdoor.ts`)**: Replaced uniform interior tree scatter with organic sine/cosine grove density, added `Mossy boulder` (`rock`) props along stream banks and pond edges, and placed a `Waystone` (`altar`) landmark at the rim of clearing 1.
- **Dungeon & Interior (`src/renderer/gen/dungeon/dressing.ts`)**: Added per-role dimensions (`itemDimensions`), `fitsItem` clearance checks, room-area prop scaling, table spacing, and chair-to-table tucking.
- **Review Gaps Found**: Tavern still spawned too many tables leaving some chairless; storage barrels/crates scattered singly along walls; world hills were still isolated dots; woodland needed thicket saplings & a second clearing landmark; city needed orchard row alignment and a central plaza monument.

## Round 6 (`round-6/`) — Smarter Placement Pass 2 (Final)
- **Dungeon & Interior (`src/renderer/gen/dungeon/dressing.ts`)**:
  - Capped table count (max 4 per room) and scaled chair count with `roomTables.length * 3`, distributing chairs round-robin across tables so every table gets 2–4 tucked chairs facing it.
  - Clustered wall-hugging `barrel` and `crate` supplies around anchor points in corners/alcoves.
  - Arranged `shrine` chairs around the placed `altar` facing it.
- **City (`src/renderer/gen/city/city.ts`)**:
  - Aligned `Market gardens` orchard trees into neater rows (`0.18` jitter) and added a central `Town Square Monument` (`altar`) in the innermost courtyard/plaza near the city hub.
- **World (`src/renderer/gen/world/decoration.ts`)**:
  - Added companion hill stamps so hills form rolling ridges/foothills, and scaled the top 2 regional `settlement`s (`1.45x`) to establish a major/minor settlement hierarchy.
- **Woodland (`src/renderer/gen/glade/outdoor.ts`)**:
  - Added occasional forest rock outcrops away from water, companion saplings beside dense grove trees for natural thickets, and an `Outcrop boulder` + `Camp crate` landmark in clearing 2.
- **Verification**: `npm run check` passed (50/50 test files, 201/201 tests), `npm run build` succeeded, and all 5 `visual-review/round-6/*.png` screenshots were rendered and visually verified.


---

## Round 7 (`round-7/`) — Macro Cartography & Urban Landmarks
- **Benchmark**: Inkarnate / Wonderdraft (organic coastlines, mountain-to-sea rivers, hierarchical typography, compass rose & border framing) and Watabou MFCG (asymmetric walls, central plaza, keep & temple landmarks, varied outskirts).
- **Changes**:
  - Added 2-pass Taubin zero-shrinkage smoothing before Chaikin in `src/renderer/gen/world/boundaries.ts` so Voronoi grid sawtooths vanish without shrinking islands/biomes.
  - Filtered disconnected flat-plain river stubs in `src/renderer/gen/world/rivers.ts`.
  - Clustered hills around mountain foothills and added deterministic labels (`Ironspine Peaks`, `Whispering Weald`, `Elderwood`, `THE AZURE DEEP`, and top settlements) in `src/renderer/gen/world/decoration.ts`.
  - Replaced the regular 12-gon city wall with an organic 16-vertex multi-harmonic silhouette, added a central `Market Square` with monument & stalls, `High Keep` & `Grand Temple` landmarks, and varied agricultural field colors in `src/renderer/gen/city/city.ts`.
  - Added double-ink parchment border and compass rose on `world`, `region`, and `settlement` renders in `src/renderer/render/renderPng.ts`.
- **Observations**: World coastlines and biome borders became fluid and natural. Found 3 remaining issues: world settlement GM rings touched settlement labels; woodland trails were still 11ft-wide ribbons with multi-segment bridges; and tavern interiors cloned identical dining tables across all 5 rooms.

## Round 8 (`round-8/`) — Woodland, Dungeon Loops & Tavern Floorplan
- **Benchmark**: Dungeondraft / 2-Minute Tabletop (narrow winding footpaths, single clean bridges, undergrowth, tactical dungeon loops, distinct tavern rooms with hearth, bar counter, rugs, and pillars).
- **Changes**:
  - Narrowed woodland trails (`g * 2.2` -> `g * 1.15`), prevented multi-bridge chains on grazing stream crossings, enlarged the pond, and added `bush` undergrowth & clearing `campfire` + `light` in `src/renderer/gen/glade/outdoor.ts`.
  - Added up to 2 extra loop corridors in `dungeon` mode in `src/renderer/gen/dungeon/layout.ts` for tactical flanking routes.
  - Gave multi-room `tavern` buildings a real floorplan (largest room = `tavern` Taproom; remaining rooms = `storage`, `bedroom`, `guardroom`) and added `hearth`, `bar`, `rug`, and `pillar` furniture roles in `src/renderer/gen/dungeon/dressing.ts`.
  - Added procedural built-in art for `hearth`, `bar`, `rug`, `pillar`, `campfire`, and `bush` in `src/renderer/render/drawEntity.ts`.
- **Observations**: Huge leap across Woodland, Dungeon, and Tavern Interior! Caught 4 final polish items: hearth firelight halo was stretched by `entity.w / entity.h`, dungeons & interiors lacked room labels/numbers, bedroom chairs could spawn without a table, and world settlement labels still sat slightly close to GM rings.

## Round 9 (`round-9/`, `round-9-seed7/`) — Multi-Seed Polish & Readability
- **Changes**:
  - Increased world settlement label Y offset in `decoration.ts` so labels clear GM rings cleanly.
  - Fixed `hearth` firelight halo aspect ratio in `drawEntity.ts` so it renders as a soft circular glow.
  - Added room labels (`1`, `2`, `3`... in `dungeon` mode; `Taproom`, `Pantry`, `Guest Room`, `Shrine`, `Guardroom` in `building` mode) in `generateDungeon` (`src/renderer/gen/dungeon/layout.ts`).
  - Prevented orphan bedroom chairs without tables in `dressing.ts`, and spaced `Grand Temple` at least 100m from `Market Square` and `High Keep` in `city.ts` after checking `round-9-seed7/02-settlement-city.png`.
- **Verification**: `npm run check` (50/50 test files, 203/203 tests), `npm run build`, and MCP `render_png` across both seed `42` (`round-9/`) and seed `7` (`round-9-seed7/`) verified.
