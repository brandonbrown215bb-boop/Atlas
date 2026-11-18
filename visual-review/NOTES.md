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

## Round 10 (`round-10-adventure/`) — World maps that invite adventure
- **Goal**: world maps a party wants to explore: distinct names, crossable ranges, roads everywhere, dangerous sites in the wilds, and GM hooks that link them.
- **Changes** (`src/renderer/gen/world/`):
  - New `names.ts`: seeded, non-repeating syllable names for towns, sites, ranges, woods, passes and seas. The old fixed lists ("Alderford", "Ironspine Peaks", "THE AZURE DEEP", "Settlement 9") are gone. Names follow the world seed only, so a restyle keeps them.
  - Mountains need real highland (`height > .28`, or `> .22` with slope `> .022`; chance `.36 → .22`). Seed 42 dropped from 108 to 71 mountains, seed 7 from 77 to 34. Roads routed through high ground leave gaps that are labelled as passes, and watchtowers prefer those passes.
  - Roads form a spanning tree over every settlement on each landmass, plus 2 short loops. Routes touching the two cities are `road` tier. Travel stops and strongholds get spur tracks; ruins, lairs and shrines stay off-road.
  - Site count scales with settlements (12 by default, up from 5). Ruins and lairs are weighted toward places far from towns and roads. The danger band is measured from the nearest settlement, not the capital.
  - New `hooks.ts` (GM layer):
    - each site gets `stockingRole` and occupant/complication/reward `gmNotes`, scaled by danger;
    - clue chains (`clueNext`) lead outward;
    - each town gets a trait, a trouble and 2 directional rumours;
    - every ruin and lair has at least 2 leads.
  - Sea label is placed at the open-water cell farthest from any coast.
- **Verification**:
  - New decoration test covers seeded unique names, road connectivity per landmass, the mountain cap, hooks on every site, at least 2 leads per ruin and lair, and the remoteness ordering.
  - `npm run check` passes, apart from one existing dungeon layout test that times out under parallel load and passes on its own.
  - `npm run build` passes.
  - Seeds 42 and 7 were rendered via `rook-review.mjs` and checked by eye.

## Round 11 (`round-11-baseline/` → `round-11-regions/`) — Region maps built on their world
- **Goal**: a region (Create location → region, then populate) should read as a closer, denser look at *that* world. World towns are hubs, new roads join the world's roads, and the world's dungeons have approaches and leads.
- **Baseline** (`rook-review.mjs` now also develops a coastal and an inland region from each world):
  - Coastal regions came out empty (seed 7: 0 symbols). The inherited ocean's bounding box was treated as a keep-out box over the whole coast.
  - With the same seed, the region's namer replayed the world's names (two Fenmoors, two Blackgut Pits).
  - Inherited roads drew as 5 km-wide bands, and inherited town and peak icons at 2–4× native size.
  - Inland regions got a solid blanket of mountains and 113–213 river paths.
  - Town labels sat a world-scale gap away from their icons.
- **Changes**:
  - `decoration.ts`:
    - Water and labels no longer make keep-out boxes, and roads may route up to existing icons.
    - Existing towns become anchors: hubs for new villages and hamlets, plus a Place record with local rumours.
    - Existing roads seed the road tree, so new towns join the network.
    - Ruins, lairs and towers cluster on the approaches to inherited world sites, and those sites get ≥2 leads.
    - Names already on the map, including towns named only in road names, are reserved, and region names are salted.
    - Region town and site counts scale with land share.
    - In a region, only the top 30% of the land by height can form peaks.
    - Ranges and woods the world already named aren't renamed.
    - The two longest rivers are named, also on world maps, and the name is stored on the path.
    - Roads leaving the sheet get `to <Town>` labels.
  - `hooks.ts`: leads give walking time ("34 miles (a day on foot)"), and settlements rank City, Town, Village or Hamlet.
  - `clipInherit.ts`, region children only:
    - relief icons are scaled ×1.2 and POI icons ×1.4 of the zoom (was ×2.2);
    - world road widths are scaled to the zoom;
    - town and site labels are pulled in next to their icons.
  - `world.ts`: a populated region adds only streams 3× stronger than the world threshold, because the world's rivers are already inherited.
- **Verification**:
  - New tests:
    - region decoration with an L-shaped inherited sea whose box covers the sheet (fails on the old code);
    - anchor connectivity;
    - inherited-ruin leads;
    - exit labels;
    - region-scale inheritance in `clipInherit`.
  - `npm run check`: 236/237 pass. The failure is `outdoor.test.ts` timing out under parallel load; it passes on its own.
  - Seeds 42 and 7 rendered across all map types. No region repeats a name from its world.
- **Follow-up: name locks and POI adoption**:
  - `generator.run` and `generator.reroll` pass every name used anywhere in the world, except the run's own output, as `takenNames`. A region's names are therefore locked: sibling regions and the world never repeat them, even with the same seed. Before this, both seed-42 regions had the same 24 names.
  - Checked POI adoption: every world town and site inside a region rect is inherited exactly in place (0 m). Only their labels move, pulled in toward the shrunken icon.
  - What was missing was the world's Place records. A region now adopts them (notes, GM notes, stocking, leads, child-map link), pointing at its own copies. The generator no longer writes a second, contradicting Place for those towns, and routes their rumours to towns that show them.

## Round 12 (`round-12-baseline/` → `round-12/`) — Settlement maps worth exploring
- **Goal**: a settlement map a party wants to walk around in. It should have a real square, quarters with their own character, named inns with owners and secrets, and a way underground. Each scale should look different. A town developed from the world should be *that* town.
- **Baseline** (`rook-review.mjs` now renders city, town, village and hamlet, plus `08-settlement-from-region`, a one-mile settlement developed around the coastal region's first town):
  - Town and city were identical (2,287 buildings each).
  - "Village" was the worst case: an unwalled mile of city blocks, 6,453 buildings, 11–13 s.
  - Hamlet ignored roads and water and drew 8 overlapping labels in an empty mile.
  - Building names cycled through 17 roles, so a city had 135 Inns, 135 Taverns and 135 Temples.
  - Market Square was just the point where 8 avenues crossed, and the fallback code added a second monument.
  - Every block shared one profile.
  - Developed from the region, Fenmoor got 1,248 m-wide inherited roads, no streets inside its wall, a world-scale icon, and no link to its Place.
- **Changes**:
  - `city.ts`:
    - **Core and outskirts**:
      - Scale sets a core radius: hamlet 45 m, village 110 m, town 260 m, city ≥ 330 m.
      - The core centres where existing roads meet (inherited roads converge on their town).
      - Only towns and cities get walls.
      - The core edge and an outskirts edge split blocks. Houses ribbon along roads only out to 60/150/300/450 m.
      - Beyond that, countryside is parcelled into hedged fields, with farmsteads by the lanes.
      - A footprint too small for its core is filled as before.
    - **Square**: one square or green is cut out before streets, so avenues end at it and houses face it. It gets a Market Cross with stalls, or a well and an old oak. Its Place uses the market hooks.
    - **Wards** (town and city):
      - Market at the square; the rich away from the gates; crafts by the gates; docks by the water; the Shambles and Temple wards in what is left.
      - Each ward has a `DistrictProfile`, so lot size, setback and colour follow it.
      - Each ward has a seeded name label.
    - **Notables**:
      - Per-scale quotas: village 6, town 12, city 20.
      - Each sits where it belongs (inns by gates, guildhall on the square, mill by water, tannery at the edge, thieves' den in the Shambles) and has a seeded name.
      - Each gets a Place with owner, quirk, secret and job.
      - Ordinary lots are named by ward (Shop, Manor House, Workshop, Tenement…).
      - Sewers are towns and cities only.
    - **Adventure layer**:
      - The graveyard is a walled yard on a road just outside town. Its crypt has stairs down, a ruin hook and Headstones.
      - A city's first sewer grate is an Undercity entrance.
      - A village gets one outlying barrow, standing stones or ruined tower.
      - The trouble gets a GM-only "Where the trouble starts" building.
      - World rumours and local leads ("…, south-west of the square") are posted in the inns.
    - Core and square shapes have their own random stream, so footprints without a core lay out as before.
  - `names.ts`: `person`, `inn`, `temple`, `farm`, `graveyard` and `ward` makers. Picked templates now re-roll on a name clash instead of numbering.
  - `hooks.ts`: establishment tables (service, quirks, secrets, jobs), trouble clues, `localRumour`, and `parseSettlement`, which reads back a town's rank, trait and trouble.
  - Parent link:
    - `clipInherit.ts`: a settlement child adopts the town's Place and drops world icons and their labels. Inherited roads are capped at 9 m and rivers at 40 m, because roads copied from a world have lost their tier.
    - `framework.ts`: the city generator sees inherited settlement Places. Inherited land and biome fills draw beneath the generated fields.
    - `scale: 'auto'` (now the default, "Auto (from world)" in the panel) takes the town's rank. Roads named `A–B Road` get `to B` labels where they leave the sheet.
- **Verification**:
  - New tests:
    - building counts rise hamlet < village < town, and the village stays within core plus ribbon;
    - the town has one square with houses facing it, a crypt, ward labels, unique notable names, hooks on every establishment and a complete service audit, and is deterministic;
    - the parent link gives auto → village, keeps the adopted Place as the only town record, labels `to Pellbury` and `to Stanbury`, posts rumours in an inn and places the trouble;
    - the settlement inheritance test in `clipInherit`.
  - `npm run check`: 53/53 files, 242/242 tests.
  - `npm run build` passes.
  - Seeds 42 and 7 rendered for every scale and for the region-developed town; checked by eye.
  - City generation is 3–4 s, village under 1 s (was 11–13 s).
  - Remaining nit: inn labels next to the square can overlap the square's label.

## Round 13 (`round-13-baseline/` → `round-13/`) — Dungeon maps worth delving
- **Goal**: a dungeon a party wants to explore. It should be a compact complex with a front door and a sense of going deeper. It needs a name, a locked goal with its key somewhere else, varied rooms with real contents, and continuity with the world site it was developed from.
- **Baseline** (`04-site-dungeon`, 500 ft site, 10 rooms, seeds 42 and 7):
  - The dungeon sat on a green lawn: every `site` map got the grass backdrop.
  - The second "far entrance" corridor ran 600–900 ft along the sheet edge.
  - Rooms were evenly sized rectangles scattered over the whole sheet and joined by long empty corridors. Seed 7 also had a 1-cell rock sliver between two passages.
  - Purposes came from a shuffled bag that ignored position (a Vault by the door), and rooms were numbered in placement order.
  - Stocking was `(seed + n*5) % 6`, and all 10 Places shared the notes "Air feels damp…". There was no name and no goal.
  - There were no lights, locks, keys or traps, so the audit's lighting pillar failed.
  - A site developed from a world ruin ignored that ruin's Place.
- **Changes**:
  - `backdrop.ts`: a site holding a dungeon generator draws on dark rock.
  - `layout.ts`, dungeon mode:
    - **Growth**: rooms grow from a front room at the sheet edge. Each new room sits within 7 cells × scale of an earlier one, favouring the newest, so the complex reaches deeper. If growth stalls, the old free placement is the fallback.
    - **Rooms**: the last room is a 1.6× goal hall and a third of the rooms are small. Rooms come in rectangle, octagon, round and cross shapes.
    - **Entrances**: the front door is the edge nearest room 1. A back way is cut only from a room already near the edge and far from the front door.
    - One-cell slivers between passages are opened up.
  - New `story.ts`:
    - `planDungeon`:
      - reads the room graph, with corridors free and each room one step deeper;
      - numbers areas from the entrance outward;
      - picks a theme (tomb, den, fortress, temple) from the inherited Place, or from the seed;
      - assigns purposes by depth tier;
      - picks the largest deep room as the goal and locks its public doors;
      - hides the key in a dead-end room that can be reached without them;
      - puts stairs down in the deepest other room.
    - `stockDungeon`:
      - names the dungeon and gives it a title label and a Place (occupants, complication, reward), unless one is inherited;
      - stocks rooms Moldvay-style from a shuffled bag (entrance never a Trap, goal always the boss and treasure);
      - writes per-room sense, feature and GM lines;
      - adds the key's `clueNext`, three-clue notes on both sides of a secret door, lights in lived-in rooms, and GM-only trap plates inside the first door.
    - Caves get the name and Place only.
    - The alt portal is a ladder up or a chute, hatch or pit down. The random "Overlook Gallery" is gone.
  - `hooks.ts`: room senses, per-purpose features, monsters by theme and band, traps with tells, specials, empties, treasure and keys.
  - `names.ts`: no more "Thornthorn".
  - Parent link:
    - `clipInherit.ts`: site children drop world icons and adopt their Places, as settlements do.
    - `framework.ts`: the dungeon generator sees inherited Places. A crypt reads as a tomb, and ruins and lairs win over keeps and temples.
    - `commands.ts`: dungeon names are locked against the world.
  - `rook-review.mjs`: new `04-site-cave` and `09-dungeon-from-region` cases. The latter is a 500 ft site on the coastal region's first ruin or lair.
- **Verification**:
  - New `story.test.ts`:
    - seeds 42 and 7 pass all seven audit pillars;
    - corridors cover less floor than rooms and no corridor spans more than 60% of the sheet;
    - the goal's public doors are locked and the key room is reachable without them;
    - stocking mix, distinct notes, depth numbering, theme variety;
    - inherited-ruin adoption;
    - backdrop by generator.
  - A site case was added to `clipInherit.test.ts`.
  - Trap plates are excluded from the furniture doorway-clearance check in `dressing.test.ts`, because they sit in the walking line on purpose.
  - A dungeon developed on surface ground (a region's desert or forest) gets a bedrock fill under its rooms. An uninherited cave is a lair. Both were found in the first round-13 render.
  - `npm run check`: 54/54 files, 249/249 tests.
  - `npm run build` passes.
  - Seeds 42 and 7 rendered for `04|05|09`; checked by eye.
    - Tavern output matches the baseline counts, since building mode is unchanged.
    - `09` adopts the world ruin's name and occupants and writes no second Place.
  - Dungeon generation takes 0.6–0.7 s; caves about 4 s, as before.
  - Remaining nits:
    - stepped round rooms read as jagged at 5 ft;
    - the title can sit near the entrance corridor.
