# What the worldbuilding notebook adds to Atlas

Implementation follow-up, 2026-11-14: after the user approved the recommended first steps, Place preservation, scheduled travel and phase-8 city/district generation were implemented. See [usage](../README.md) and [verification](../BLOCKERS.md). Dungeon alternate routes and hydrology/climate changes remain separate follow-ups. The assessment below records the original pre-implementation findings.

Reviewed 2026-11-14 against all six notebook notes, the current source, and the existing brief/master plan. This is an assessment, not an expansion of the approved implementation plan. No application behavior was changed. Historical claims and external projects were not independently reverified; algorithm details below refer to the notebook's saved source extracts.

Atlas has completed phases 0–7. City generation is the remaining planned phase. The notebook sometimes describes completed generators as unbuilt and later mixes up phase numbers. Use the code and `docs/bundle/MASTER_PLAN.md` for project status.

The best additions are better city generation, travel with overnight stops, alternate dungeon routes, and drainage that distinguishes accidental pits from intentional basins. The culture and economic material is useful for deciding what belongs on a map. It does not justify building a civilization simulator.

## First: an existing Place preservation gap

The notebook's “promote scenery to a Place” idea is mostly supported already: select objects, create a named Place, add notes, search for it, and open an interior. A Place can already reference several objects through `entityIds`.

However, `place.create` does not make its linked generated objects manual. `runGenerator` deletes untouched output from that run and then prunes missing IDs out of Places. Consequently, creating a Place around generated furniture or scenery does not protect the selected objects against a subsequent reroll. The Place and its notes remain, but its attachment can disappear. This follows directly from the command paths; it was not reproduced in a running app during this review.

The existing settlement-suggestion acceptance and generated-building interior flows explicitly make their selected object manual. Ordinary Place creation should provide the same protection. The smallest fix is to preserve the linked generated objects when creating a Place, as part of the same undoable command. A regression check should cover create → reroll → attachment survives → undo.

Evidence: [Place creation](../src/renderer/model/commands.ts), [generator replacement and link pruning](../src/renderer/gen/framework.ts).

## Applicability by feature

| Notebook idea | What Atlas has now | What is worth carrying over |
|---|---|---|
| Start with a dungeon, town, or continent independently | Standalone maps, child maps, transfers and generators | Already fits. Do not require a complete world before generating a small location. |
| Manual work survives generation | Manual/inherited constraints, generated ownership, undo | Keep this rule throughout city generation and new passes. Fix the Place gap above. |
| Find important buildings and open interiors | Searchable Places, grouped objects, interior preview/accept | Mostly done. A selection shortcut would save clicks; a new Place system would add nothing. |
| Travel watches and camps | Route distance, speed, departure, continuous arrival calculation | High value: add a travel schedule and distinguish moving hours from elapsed calendar time. |
| Uneven destination spacing | Clustered, uneven settlement suggestions | Already present. Judge useful journey differences with the travel tool rather than forcing a spacing formula. |
| Streets, blocks and buildable lots | Manual roads/walls/districts/buildings; city generator absent | Directly applicable to phase 8. Use the subdivision and geometry safeguards below. |
| Wealth, activity, density and access vary independently | Generic district areas; no saved district profile | Add a small district profile for the city generator. Presets should be editable starting points. |
| Farms and suburbs outside the walls | No city/hinterland generator | Generate a local fringe: gate-road buildings, gardens, fields and some open land inside the wall. |
| Multiple dungeon routes and entrances | Connected layouts; tree-based generated room doors; inherited/manual entrances | Add deliberate useful alternate routes and entrance choices. Connectivity alone is insufficient. |
| Wider dungeon corridors | Corridors carved as single-cell routes | Offer a two-square default in dungeon mode; keep narrow passages available. |
| Door clearance and restrained furniture | Door buffers, inter-door clear routes, density and dressing-only rerolls | Already done. Improve placement only where visible results warrant it. |
| Corner-aware furniture placement | Wall-distance scoring and alignment | Small optional improvement for beds, chests and altars after layout quality. |
| One note/event attached to several secrets | Grouped Place notes exist; no explicit group reveal action | Reuse grouped notes. A manual group action is possible later; it needs clear secret-door behavior. |
| Rivers reach an outlet instead of getting stuck in noise pits | Strict downhill flow; local depressions retain water | Add explicit basin/outlet handling. The priority-flood approach is relevant, with caveats below. |
| Wind, rain shadows and mountain chains | Noise-based elevation/moisture; latitude/altitude temperature | Real improvements, but separate terrain/climate work, not a free extension of re-climate. |
| Better terrain art per biome | Theme roles for mountain/hill/forest; global density | Useful later: biome-specific art pools and vegetation-only rerolls. |
| Settlements respond to geography | Lowland/climate/coast weighting and seeded clusters | Add river access and crossings before demographic or trade simulation. |
| Roads, inland ports and navigable rivers | Rivers are rendered paths; no transport graph | Later. Reuse river geometry and require connected water routes; do not copy another engine's flux threshold. |
| Roadside ambushes, hedges, ditches and managed woods | Connected woodland clearings, trails, water and bridges | Good next outdoor variants using existing footprint/constraint machinery. |
| GM hexes and travel annotations | Square grid and transient route measurement | Optional display layer over metre coordinates. No need to convert the saved map to hex cells. |
| Horizon/landmark visibility | No visibility estimator; terrain height is normalized | Optional rough distance preview, clearly separate from terrain-aware line of sight. |
| Caves and vertical dungeon links | Chamber mode, portals and separate maps | Caves can be a distinct generator later. Use existing portals for stairs/shafts first. |
| Melan/topology diagram | No graph auditor | Useful after deliberate loop generation; start with a simple route graph before a sophisticated overlay. |
| Concrete site hooks, rumors and clue networks | Notes exist; suggestion generation explicitly deferred | Good content guidance. Keep source references and short physical requirements; no automatic plot engine. |
| Religion, resources, cultures and armies | No societal simulator | Use as map/content references. Skip automatic culture expansion, tech tiers, equipment stocks and military calculations. |

## What to take into phase 8

The current plan starts from roads, walls, water, cliffs, plateaus, landmark buildings and district areas that we draw. Keep that. Watabou's complete spiral/Voronoi town pipeline would be a different generator, not a prerequisite for filling our existing city outlines.

Use the transferable parts:

- Clean very short edges and reject tiny slivers before cutting blocks. Choose tolerances in Atlas's metres relative to street/lot size; Watabou's `8` units is not an eight-metre prescription.
- Split large blocks with some variation, then straighten cuts as lots get small. Houses need useful footprints rather than triangular scraps.
- Give every building street access, preserve room for courtyards, and consider shortest-edge-first perimeter slicing where it improves corners.
- Keep major streets connected through actual gates. Respect water, cliffs, chosen walls and fixed buildings. Elevated districts need explicit access points such as ramps, stairs or gates; an elevation number alone does not connect them.
- Keep density, wealth, activity and access separate. Density changes footprint sizes/gaps; wealth can change art and courtyard choices; activity can change frontage and dressing; access can be a simple open/restricted/gated choice. Four arbitrary numeric sliders are not mandatory.
- Keep some gardens and open blocks inside walls. Let roadside buildings and gardens spill outside gates when there is space. Constrain the fringe to the selected region rather than silently drawing beyond it.
- Offset plaza monuments to leave usable open space. Treat citadels differently from ordinary blocks; inward-facing main access is a useful default, not a restriction on deliberate designs.
- Reroll one district while preserving edited buildings, Places, child interiors and chosen landmarks.

Do not equate wealth with straight streets or poverty with bad geometry. The notebook suggests that mapping, but it would recreate the caricature the original brief wanted to avoid. Likewise, its warning against walled districts must not remove Khartoum's deliberately walled upper district.

A few nearby farms and gate suburbs solve the immediate empty-city problem. The four agricultural “rings” are guidance for land use, distorted by rivers, slopes and roads—not four concentric bands that every settlement must draw. Province-wide food accounting is unnecessary.

Relevant code: [schema](../src/renderer/model/schema.ts), [generator framework](../src/renderer/gen/framework.ts), [generator controls](../src/renderer/panels/GeneratorPanel.tsx). The current framework's map-kind guard also needs to admit settlement generation; adding only a new generator function would not expose a working flow.

## Small improvements to existing tools

### Travel that includes stopping

[measureRoute](../src/renderer/geom/measure.ts) calculates distance divided by speed and advances the clock continuously. An overnight rollover works, but camping/rest does not exist. That matches the existing implementation; the notebook proposes a richer calculation.

Keep the current continuous option. Add a daily travel window or explicit start/resume time with an editable hours-per-day allowance. Show moving time, nights stopped, and arrival. Merely dividing travel hours by eight does not give a reliable arrival clock, especially for late departures. A 36-mile walk at 3 mph is 12 moving hours; starting at 08:00 and walking 08:00–16:00 each day means arrival at noon the following day.

Then add optional four-hour ticks and camp markers along the measured polyline. A camp marker means the schedule's stop point; actual sunset would require separate daylight information. Transport presets and editable terrain modifiers can follow. A universal 50% off-road penalty is a preset, not a geographic law. Freight prices must not become movement speeds.

This can remain temporary view state like the current measurement. No saved journey system or calendar engine is needed.

### Dungeon routes and width

[layout.ts](../src/renderer/gen/dungeon/layout.ts) connects rooms with a spanning tree of door adjacencies and has no deliberate extra-door pass. Its dungeon corridors follow single-cell paths. Existing manual doors and incidental corridor geometry can provide other routes, so “every generated dungeon has exactly zero loops” would overstate the finding. The missing feature is intentional alternate routes.

After connection, choose a few valid extra connections that bypass a meaningful stretch of the existing route. Two neighboring doors into the same corridor do not necessarily create an interesting decision. Scale the target to the actual layout and available walls. Preserve the simple building and chamber modes; the pyramid does not need to become a maze.

Widen dungeon routes where the footprint and manual constraints allow. Do not silently erase manual walls to fit a second square. Checks should cover traversable width at turns, reachable entrances, useful alternate paths and unchanged deliberate geometry.

Furniture already has door and route clearance in [dressing.ts](../src/renderer/gen/dungeon/dressing.ts). Corner scoring is an incremental visual improvement, not a missing furnishing system. Generated structure and props currently share the chosen layer; independent clutter visibility would require an actual layer/control change.

### Rivers and climate

[rivers.ts](../src/renderer/gen/world/rivers.ts) only routes to strictly lower neighbors. That prevents uphill flow but allows rivers to stop in local pits. Its tests check descent, not eventual outlet reachability.

The notebook's ocean-first priority exploration is useful, but it is not a drop-in “30-line fix.” Choose how to distinguish an intended inland basin from accidental noise, handle maps with no ocean outlet, and decide whether drainage fills or carves the terrain. Preserve manual water and land. The saved Mapgen4 extract also adjusts elevations downstream; copying only its parent-pointer assignment would not preserve our current downhill invariant.

The useful requirement is that a drainage chain reaches an identified sea/lake/basin outlet, with no cycles or unexplained disappearing flow. Intentional closed basins are allowed. Several rendered river segments may join into one drainage chain; every individual segment need not touch the sea.

[climate.ts](../src/renderer/gen/world/climate.ts) uses latitude, altitude and noise. Moisture currently does not use ocean distance or prevailing wind. Windward rain and dry lee slopes would improve geography, but drawn mountain symbols do not currently alter the height field. [reclimate.ts](../src/renderer/gen/world/reclimate.ts) rebuilds a procedural sampling terrain and repaints eligible biome coverage while preserving saved geography. It does not recover every manually edited landform as a hydrological height field. Better terrain sampling must precede promises that painted mountains or the crater automatically change rainfall.

Weighted art pools can reuse existing theme roles. Scope new vegetation rerolls by generated ownership and biome/area; never infer ownership from asset identity, since manual props can use the same art. Likewise, future shipping overlays should follow the actual saved river path, rather than recreate Azgaar's sinusoidal meander formula.

## Content ideas that fit without new systems

N05 is most useful when it changes the physical map: a dockside departure shrine, a household altar, an open ore pit with spoil heaps, a charcoal-burning site, managed woodland, a fortified granary, or a watch post controlling a ford. These become ordinary Places and notes. Sacred sites can serve several overlapping local practices without needing a religion simulator.

N06's durable wilderness locations and linked clues also fit ordinary Places. A ferry, abandoned smelter or disputed pasture remains useful on a return visit. Keep transient events in GM notes. A few concrete connections between known locations are enough before considering a separate scenario graph.

If suggestion generation is revisited, the resource/person/opportunity/complication prompts are a useful way to avoid making every farmhouse secretly evil. They remain optional content work: the master plan explicitly defers generated suggestions. Do not add a large prose bank, an online dependency, or hidden economic simulation just to make a handful of useful places.

## Notebook claims to correct before implementation

1. **“9–11 loops per level” is not a general benchmark.** In saved source S32, line 119 is a linked comment describing two particular maps. The actual article recommends meaningful loops without that quota. N02/N04 turn an example into a requirement.
2. **The freight ratio is mislabeled.** The saved S06 says river carriage is roughly one-fifth of road and sea one-twentieth. Normalized as sea : river : road, that is **1 : 4 : 20**, not N01's 1 : 5 : 20. These are contextual freight-cost estimates, not walking/boat speed ratios.
3. **Foreign constants are not Atlas units.** Flux `100`, height `50/70`, junction distance `8`, icon density `250` and squared ward-size formulas belong to their original engines. Atlas has different elevation, flow, scale and generation limits.
4. **Grouped notes are not grouped secret revelation.** `Place.entityIds` exists. The player renderer excludes secret-door entities regardless of a Place's visibility. Revealing a puzzle's result would need an explicit undoable change to the relevant door state/representation, not simply toggling the Place's GM flag.
5. **Horizon distance is not terrain-aware visibility.** An Earth-like horizon estimate can combine observer and landmark heights, but ridges, canopy, weather and planetary size change the result. Atlas's normalized terrain heights are not feet above local ground. Do not label a rough ring “line of sight.”
6. **Source identifiers drift in the later notes.** Some references name S11/S12/S13 files that do not match the actual source inventory. Follow titles and inspect the source text before treating a citation as verified. Several historical absolutes and precise demographic ratios should remain illustrative assumptions, not engine constraints.
7. **The brief allows exceptions.** Unusual geography, symbolic spacing, a walled upper district and a single symmetrical chamber are intentional possibilities. Research should improve defaults while leaving those choices intact.

## Recommended order

1. Fix Place-linked generated scenery surviving rerolls. This protects work we already support.
2. Add travel schedules, then optional watch/camp marks. This directly addresses the original journey-spacing complaint.
3. Build phase 8 from the existing drawn-constraint plan, incorporating usable lot geometry, independent district choices and a modest city fringe.
4. Add deliberate dungeon alternate routes and configurable corridor width.
5. Improve basin/outlet handling, then wind/rain and terrain art if the generated continents warrant it.

Keep cave generation, horizon rings, topology diagrams, regional transport networks and source-backed content suggestions as separate optional work. Skip culture/tech/military/economic simulation unless we actually decide we want to play with that.

## Notebook files reviewed

- [N01 — Compendium](C:/Users/brand/Documents/OpenNotebook/notebooks/fantasy-worldbuilding/notes/N01-the-fantasy-worldbuilding-and-cartography-compen.md): broad geography, settlement and demographic context.
- [N02 — Atlas field guide](C:/Users/brand/Documents/OpenNotebook/notebooks/fantasy-worldbuilding/notes/N02-field-guide-for-campaign-atlas-phases-5-8-and-be.md): algorithms and immediate tool proposals.
- [N03 — Tradeoffs](C:/Users/brand/Documents/OpenNotebook/notebooks/fantasy-worldbuilding/notes/N03-worldbuilding-tensions-and-design-tradeoffs-matr.md): useful constraints against overbuilding and forced realism.
- [N04 — Tactical sites](C:/Users/brand/Documents/OpenNotebook/notebooks/fantasy-worldbuilding/notes/N04-dungeons-castles-tactical-sites-xandering-melan.md): dungeon topology, fortifications, caves and vertical connections.
- [N05 — Societies and resources](C:/Users/brand/Documents/OpenNotebook/notebooks/fantasy-worldbuilding/notes/N05-cultures-practical-polytheism-tech-tiers-mining.md): physical site/content ideas; mostly unnecessary simulation machinery.
- [N06 — Wilderness](C:/Users/brand/Documents/OpenNotebook/notebooks/fantasy-worldbuilding/notes/N06-wilderness-hexcrawls-horizon-visibility-navigabl.md): travel, landmarks, river connections and durable locations.

Saved source extracts S06, S17, S32 and S38 were also spot-checked where the synthesis needed qualification. Application findings are based on static source inspection; no application tests were run for this documentation-only review.
