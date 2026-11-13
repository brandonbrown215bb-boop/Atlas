# References discussed

These were inspected as inspiration during the conversation. They have not been installed or run locally as part of this work. No particular project has been selected as the codebase for the editor.

## Procedural maps and editing

| Project | Useful reference |
|---|---|
| [Dungeon Mapper](https://github.com/evillollive/Dungeon-Mapper) | Browser map editing, seeded terrain, rivers, and manual refinement |
| [dungeon-cartographer](https://github.com/mcclowes/dungeon-cartographer) | Rooms/corridors, organic carving, mazes, and terrain generation |
| [brileta-sprites](https://github.com/mayz/brileta-sprites) | Procedural trees and boulders; its appearance would need adapting |
| [Mapgen4](https://github.com/redblobgames/mapgen4) | Terrain, rivers, biomes, painting, and explanations of generation techniques |
| [rot.js](https://github.com/ondras/rot.js) | Roguelike map generation, seeded randomness, pathfinding, and visibility |

Browser references:

- https://evillollive.github.io/Dungeon-Mapper/
- https://mayz.github.io/brileta-sprites/demo/
- https://www.redblobgames.com/maps/mapgen4/
- https://ondras.github.io/rot.js/manual/

## Watabou

These are design references. Editable dressing, useful floor plans, and generation within deliberate shapes are particularly relevant. The desired editor's full editing capabilities should not be assumed to exist in every referenced generator.

- [Creator page](https://watabou.itch.io/)
- [Perilous Shores](https://watabou.itch.io/perilous-shores)
- [One Page Dungeon](https://watabou.itch.io/one-page-dungeon)
- [Cave/Glade Generator](https://watabou.itch.io/cave-generator)
- [Dwellings](https://watabou.itch.io/dwellings)
- [Procgen Mansion](https://watabou.itch.io/procgen-mansion)
- [Public town generator source](https://github.com/watabou/TownGeneratorOS) — an older published version; it does not establish that all current generators have published source.

## Foundry

- [Universal Battlemap Importer](https://github.com/moo-man/FVTT-DD-Import)
- [Foundry module listing](https://foundryvtt.com/packages/dd-import/)
- [Universal VTT format documentation](https://arkenforge.com/universal-vtt-files/)
- [Foundry walls, doors, and secret doors](https://foundryvtt.com/article/walls/)
- [Foundry scene import/export](https://foundryvtt.com/article/scenes/)

Universal VTT is an existing handoff route for a flat map image and structural data. Movable individual props, linked notes, and safe scene updates need separate investigation. Compatibility must be checked against the Foundry version actually used.

## Earlier local research

The included `research/REVERSE_ENGINEERING_REPORT.md` was found at `C:\Users\brand\Documents\Map Tool\REVERSE_ENGINEERING_REPORT.md`. It discusses Canvas of Kings, Dungeon Alchemist, and Fantasy Map Simulator, followed by a much broader proposed combined editor. The current brief supersedes that report's scope as a statement of what the user wants.
