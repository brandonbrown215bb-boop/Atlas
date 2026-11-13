# Campaign map editor — working brief

This is for personal home games. The job is to make a world worth exploring and help run it when the players wander somewhere unexpected. This is still a design conversation, not an implementation plan.

## The core idea

A connected campaign atlas. Zoom continuously from the world into a region, settlement, or surrounding countryside. Smaller locations and details appear as they become useful at that zoom. Open buildings and dungeons as separate interior maps, with connected entrances and multiple floors where needed.

Start at whatever scale is useful. A dungeon can exist before its place in the world is decided. Regions and continents can later become pieces of a larger world or planet.

At every scale, allow a mix of:

- Seeded generation.
- Imported outlines and SVG shapes.
- Rough drawing that the tool tidies up.
- Precise drawing and point editing.

Generate within established shapes and around deliberate edits. Reroll selected parts without losing everything else.

## Desktop and workspace requirements

Confirmed by the user:

- Windows desktop app that works offline.
- World saves.
- Transfer map data between world saves when desired.
- Dockable panels, with real separate windows that can move to another monitor.
- Both independent map views and detached tools. One window can show a region while another shows a city or interior from the same world.
- Dark mode option.
- 2D maps initially, with the potential to add 3D later.

The future 3D possibility should not turn the initial project into a 3D editor. Keeping physical dimensions and meaningful elevation information is a proposed way to preserve useful data. Actual 3D assets and visualization would still be separate work.

Proposed stack, pending further discussion and a small working check:

- Electron for the desktop app and native windows.
- TypeScript and React for controls, notes, and other UI.
- PixiJS for 2D map rendering, initially using its WebGL renderer.
- Dockview for docked, floating, and popout panels. Actual cross-window behavior needs checking in the chosen desktop shell.
- Start with a portable world folder containing structured map/note data and copied assets. The exact save format is not decided.

Additional practical requirements proposed for discussion: autosave and recovery, undo/redo, portable saves that carry imported assets, copying locations with their interiors/notes/assets, remembered workspace layouts with recovery when monitors change, layers/groups with hide/lock controls, and a clean optional player-display window.

Open questions include copying versus moving versus linked reuse between worlds; the scope of a transfer; world forks for alternate versions; how optional suggestion generation behaves offline; and user-provided asset collections. These are not settled by choosing the desktop stack.

## World creation

The walkthrough starts with rerolling a continent until its overall shape feels right, then editing it. That might mean reshaping a particular coastline or carving a large hole through the middle.

Biomes should come early enough to help define the world structure. Desert, grassland, tundra, forests, and unusual fantasy environments should all be possible. Generated suggestions can respond to terrain and climate, while deliberate choices remain under the user's control.

The hole in the example map was an actual geographic feature. Its history came afterward. Making a striking place should not require explaining it first.

When moving a region or continent into another world, allow its geography to be preserved or adapted. The exact adaptation controls still need working out. Developed locations and deliberate choices should survive the move.

## Develop where play starts

Once the broad world works, zoom toward the party's starting area and choose a chunk to develop. That area can grow later. Places inside it can have different amounts of detail.

The example is Khartoum in the south of the supplied Inkarnate map, with a nearby pyramid and crater. The party started in the crater; Khartoum was the first city. The remembered spacing was roughly 27 miles between the three locations. The party had a large space-vehicle home base, so ordinary walking time did not determine travel difficulty.

The lesson from that campaign was that placement and journey lengths were too tidy. Locations repeatedly being about a day's travel apart removed choices about arrival after dark, stopping early, or waiting until morning. Deliberate symbolic arrangements are still allowed; ordinary generation should offer uneven spacing and interesting relationships.

A proposed travel preview would show distance, duration, and arrival time for a chosen route, departure time, and travel method. Its purpose is to help notice consequences, not to force every journey to be awkward.

## First city: Khartoum

The original city was built by roughly matching its coastline to the world map, adding a raised area with rock walls, enclosing an upper district with walls, and then adding roads, markets, and buildings. The supplied city image also establishes a lower waterfront and docks.

The intended rich/poor division felt heavy-handed. Shops had deliberate placements, but became difficult to keep distinct and find among the other places.

Proposed editor behavior from this example:

- Carry the established coastline and terrain into the city view. Refine them locally rather than requiring manual recreation from the world map.
- Draw or generate real elevated areas, cliffs, walls, gates, and connections between levels. Their positions guide subsequent development.
- Allow a clear walled upper district while letting surrounding areas have mixed uses and gradual differences in prosperity. Wealth, activity, building density, and access are separate choices.
- Establish major roads, gates, docks, markets, and other chosen landmarks, then generate streets and buildings around them. Regenerate a selected district while preserving deliberate placements.
- Give an important shop or other location a persistent identity attached to its building. Its name, purpose, notes, and interior stay connected when its appearance or position changes.
- Provide a searchable location list that can jump to and highlight a place. Offer optional labels and category highlights so shops do not all disappear into the same building artwork.
- Keep geographic placement flexible: a district may favor certain activities without requiring every shop of a kind to live in one designated zone.

These controls are proposals to refine during the walkthrough. No particular city-generation algorithm or district model has been selected.

## Opening an interior

Default to a simple floor plan when developing or opening a building interior. Dressing can be added afterward. The first view should make the layout easy to understand and use during play.

The proposed interaction is to select a city building, choose or supply its purpose, preview a layout using its footprint and access, then open or reroll it. Optional situation suggestions can inform further development without being required to generate the physical space.

## First dungeon: the pyramid

The user began with a general, intentionally symmetrical shape, then placed dressing and adjusted the layout as the encounter developed. The supplied map is a large open chamber with alcoves and a southern extension. A dungeon may be a single encounter space; it does not require a network of rooms and corridors.

Established elements from the actual session:

- Secret doors at the upper left and right, intended to open after a riddle was answered.
- A central column with hieroglyphs and markings that became a mimic.
- A serpent statue holding loot, with a second riddle. When the party ignored it, it became a bone naga and used lightning bolt to wake the mummies.

The editing workflow should allow repeated movement between layout, dressing, and encounter ideas. Adding props can lead to changing walls or enlarging a space. An already dressed area should remain editable without requiring a fresh generation pass.

Proposed controls to explore:

- Attach private notes to a particular door, statue, column, room, or group of objects.
- Keep an object's visible appearance and its secret significance together: what players see, what is really there, and what can change it.
- Associate one note or event with several objects, such as a riddle opening two doors.
- Offer simple manual reveal or state changes where useful. The extent of live session controls remains undecided; automatic combat or puzzle execution has not been requested.
- Preserve intentional symmetry and encounter features when generating or modifying surrounding detail.

## Dressing stays editable

Worlds, outdoor locations, buildings, and dungeons should generate appropriate dressing as well as layouts.

- Move, rotate, resize, replace, duplicate, and remove individual objects.
- Adjust a whole area, such as thinning trees or increasing rubble.
- Reroll dressing while keeping the geography or room layout.
- Preserve chosen details while changing surrounding material.
- Let purpose and character guide placement: an abandoned library, overgrown temple, or working farmhouse.

Objects should leave useful paths and entrances available. Deliberate exceptions should remain possible.

## Places can become important during play

A farmhouse can begin as scenery and become a developed location when the players investigate. It should offer something worth finding: a useful resource, person, relationship, opportunity, discovery, or complication. Every place does not need a sinister secret.

Develop as much as needed: a quick description, grounds, an interior, or a deeper connected site. Keep the existing location and footprint consistent. Preserve facts established during play while allowing unplayed details to change.

The actual earlier sandbox was largely improvised from maps prepared shortly before sessions. The tool should support that working style rather than demand a fully prepared countryside.

## Worldbuilding, TV display, and optional Foundry use

The editor must be useful for general worldbuilding with no session planned. The user also runs a home game using a TV and has used Foundry VTT. These are different ways to use the same maps. Creating or developing a place must not require choosing a play destination, preparing a session, or configuring VTT behavior.

For TV use, the proposed starting point is a clean player-facing map view or image, with control over labels, grid, and private information. The exact display and reveal controls remain undecided. A TV does not imply Foundry is running on it.

When Foundry is chosen, exporting, importing, and manually tracing walls should be substantially easier than the user's previous experience. Desired result: bring a prepared area or interior into Foundry with its image, grid scale/alignment, walls, doors, secret doors, and chosen lights already configured. Drawing a wall or marking a door in the editor should retain the information needed for that optional handoff. Player-facing artwork must not expose private annotations or secret-door markings.

For on-demand locations in a Foundry session, the time to get the location into Foundry matters as much as the time to generate it. A quick send/update action is the proposed experience; the actual integration has not been selected or implemented. Foundry preparation and export are optional actions on chosen maps or areas.

Research checked during this conversation:

- [Universal Battlemap Importer](https://github.com/moo-man/FVTT-DD-Import) provides an existing import route for Universal VTT files. The format can include a map image, grid resolution, wall geometry, door portals, and lights.
- [UVTT format documentation](https://arkenforge.com/universal-vtt-files/) describes a flat map image; individually movable prop images are not carried as separate objects by the basic format.
- [Foundry wall documentation](https://foundryvtt.com/article/walls/) supports independently configured movement/vision restrictions and secret doors. Export/import mapping of advanced behaviors must be verified for the selected route and Foundry version.

Separate movable props, linked notes, multiple-level connections, and safe updates to an existing played scene may need a richer Foundry-specific handoff. These are open integration questions, not capabilities supplied automatically by a basic UVTT export. Updating a scene should preserve session state unless the user deliberately chooses otherwise.

Proposed Foundry integration check, when that feature is built: create a small room with an ordinary door and a secret door, hand it to the user's Foundry version, and verify grid alignment, movement, and player vision without manual wall tracing. This validates the optional Foundry workflow; it does not define usability of the whole editor.

## Suggestions without a wall of bad prose

The user wants optional ideas, but has found random and AI-written descriptions weak. Writing a large bank of generator entries is also an unwanted creative burden.

Show a few short, concrete alternatives with:

- What the party notices.
- What is happening and who wants something.
- Something the players could discover or act on.
- Physical features needed to support the situation.

Keep, combine, replace, or dismiss suggestions. Let the selected idea guide development of the map. Treat suggestions as provisional until chosen or established through play.

The proposed approach is to draw on existing material the user likes, keep source/page references, and adapt it to established campaign details. AI may help within those limits; a request to invent elaborate descriptive prose should not be the main source of content. No source library or generation method has been selected yet.

## Still to settle

- How outdoor maps transition into encounter-level detail.
- City editing controls, connections across elevation changes, and how building footprints become interiors.
- Art style across scales and support for imported dressing assets.
- How SVG shapes are assigned meanings such as coastline, road, or room.
- What happens to connected geography when an established feature moves.
- Scale changes when combining maps, and how interior dimensions stay stable.
- Save format, backups, TV/player display, and the optional Foundry handoff, including updates and movable props.
- Which content sources and suggestion controls prove useful in practice.

These are open design topics, not an approved feature backlog.

## References already discussed

- Existing local research: [research/REVERSE_ENGINEERING_REPORT.md](research/REVERSE_ENGINEERING_REPORT.md). Covers Canvas of Kings, Dungeon Alchemist, and Fantasy Map Simulator. Its technical claims have not been reverified here.
- [Watabou: Perilous Shores](https://watabou.itch.io/perilous-shores) — regional maps and blueprint editing.
- [Watabou: One Page Dungeon](https://watabou.itch.io/one-page-dungeon) — dungeon generation, props, water, and notes.
- [Watabou: Cave/Glade Generator](https://watabou.itch.io/cave-generator) — organic outdoor and cave locations.
- [Watabou: Dwellings](https://watabou.itch.io/dwellings) — building interiors.
- [dungeon-cartographer](https://github.com/mcclowes/dungeon-cartographer) — layout-generation ideas.
- [brileta-sprites](https://github.com/mayz/brileta-sprites) — procedural vegetation and rocks.
- [Mapgen4](https://github.com/redblobgames/mapgen4) — terrain, rivers, and editable generation.

Current discussion: Windows/offline, 2D first, optional future 3D, world saves and transfers, dark mode, and docking with independent map/tool windows are confirmed. A desktop stack and practical save/workspace behavior are proposed but not implemented. The initial interface sketch only explores navigation and selection using supplied maps; continuous zoom, generation, and drawing are not implemented there.
