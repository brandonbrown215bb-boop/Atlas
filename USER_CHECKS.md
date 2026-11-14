# User Checks

## Phase 7 — World and continent (complete through P7.4)

- On a world or region map with continent-scale bounds, draw/select a footprint area and choose **World / continent** in Generator. Try several seeds, sea levels and ruggedness values. Draw a manual water area through the centre, reroll, and check that its exact shape remains water; compare the result with `docs/bundle/reference-maps/02-world-map.jpg`. Check undo/redo and saving.
- Open **World climate and biome table**, change temperature/moisture biases and latitude, add a custom biome rule, apply settings, then reroll. Check the resulting colors and river density; draw a manual biome area and confirm it survives rerolls.
- Try world decoration density 0–3 with real `mountain`, `forest`, `hill` and `settlement` theme art. Judge the symbol size and clustered settlement spacing. Accept a suggestion with your own name, find it in Places, dismiss another, undo, and reroll; the accepted town must remain.
- Give two worlds different climates. In **World transfers**, place a generated region onto a parent map in the other world and enable **Re-climate on arrival**. Try copy, move and linked copy. The generated biomes should adapt while your manual areas, places/notes, rivers, coastline and developed locations stay intact. Try placement at different latitudes, rotation/scale and undo of a move. Re-climate changes biome fills; existing terrain symbols remain as placed.

## Phase 6 — Outdoor locations

- On a site map, select a footprint around 260 × 210 ft and choose **Outdoor woodland**. Generate six clearings with water on, then try several seeds and tree densities. Compare the connected numbered clearings, winding trails, tree bands, stream bridges and pond with `docs/bundle/reference-maps/01-procedural-forest-inspiration.jpg`. Judge the shape and spacing, then try your real `tree`/`bridge` theme art.
- Try Water off, stream only and pond only. Add custom entrance coordinates in feet, including entrances on a concave boundary. Draw a manual camp/water area, a trail and a few props first; generate around them. Move a generated tree or edit a clearing, reroll, and check that your edits stay put. Check undo/redo and Accept. If the footprint is too cramped or split by obstacles, the error should leave it unchanged.

## Phase 5 — Dungeon and interior generators

- Rebuild something like `docs/bundle/reference-maps/04-pyramid-interior.jpg`: draw its footprint on an interior map, choose Chamber and alcoves, try mirroring and a shrine purpose, then adjust the result by hand. Judge the room proportions, alcoves, door widths and furniture; the generator is a starting layout, not an image recreation.
- Try Building rooms and Dungeon and corridors with several seeds. Draw a manual wall with a door and reroll around it. Move a generated prop and edit a room, then reroll; those edits must stay put. Try dressing-only reroll, a selected room's purpose, and area Thin out/Add more/Reroll. Check your real theme art at a 5 ft grid.
- Select a settlement building, open Generator, choose purpose, Preview interior, reroll and cancel. Accept a preview and check that the interior has the building's dimensions, its entrance positions, and the place's notes. Undo once to remove the new map/link, then redo. Open an existing generated interior through its place and check it after restarting.

## P0.4 — Portable build
- Copy `dist/CampaignAtlas-Portable.exe` to a folder on the second Windows PC and confirm it starts cleanly (and note whether company policy allows running the unsigned portable build on the work laptop).

## P1.5 — Backdrop import
- Import `reference-maps/02-world-map.jpg` (world), `03-khartoum-city.jpg` (settlement), and `04-pyramid-interior.jpg` (interior), calibrate scale with "Set Real Size", and confirm they render and look right.

## Phase 2 — Manual editing
- Trace the Khartoum coastline, upper-district wall and three shops over `docs/bundle/reference-maps/03-khartoum-city.jpg`; make the shops places, find them by search, and open the pyramid as an interior of a place.
- Try **Measure** along a winding route. Set speed and departure time, finish the route, and check the distance and arrival readout. These are continuous-travel estimates; rests and terrain penalties are not included.

## Phase 3 — Asset packs

- In **Settings**, register your real Forgotten Adventures folder and import one of your Dungeondraft packs. In **Assets**, try folder browsing, name/tag search and scrolling through thumbnails.
- On a site/interior map with a 5 ft grid, stamp a few props. Confirm the defaults (200 px/square for loose folders, 256 for Dungeondraft) match your art. Adjust the pack scale before placing more if needed.
- Apply a texture to an area with a hole, a path and a wall. Check its appearance and scale; try hiding/showing the layer and opening a second map view/popout.
- Assign several assets to theme roles in Assets, undo/redo a change, save, then copy the world to your other PC without registering its packs. Check that placed art and theme assignments still appear. Automated tests cover this with a fresh app profile; your real art still needs a visual check.

## Phase 4 — Outputs

- Open the player window on your TV/second monitor. Try map selection, Send my view, labels/grid and fullscreen. Check that private layers, notes and secret-door markers never appear.
- Enable Fog, select the Fog tool, and paint Reveal/Hide with different brush sizes. Check the solid player cover and half-transparent GM cover, including holes and undo/redo.
- Export a whole map and a selected/custom rectangle at your chosen pixels per square. Check framing, portable pack art, and the cap warning on a large export. Exports deliberately omit the fog mask.
- Import a `.dd2vtt` with Universal Battlemap Importer in Foundry. Check image/grid alignment, wall gaps, doors and light color/range; report the Foundry version. Set the secret doors listed in the export report to secret in Foundry (basic UVTT does not carry a portable secret-door flag).
- In World transfers, copy a developed map tree to another world; try placement rotation/scale and Replace/Merge with a seam margin. Open the target and check coastline joins, places/interiors, notes and art. Interior dimensions must stay fixed. Fork into an empty folder and check the independent world identity.
- Create a Linked copy using a map whose id is not already in the target. Edit entities on each side, then Preview linked sync on the map you want to update. Check the Mine/Theirs conflict choices, newly used art, and undo. Sync each linked descendant map separately. On your other PC, locate the other world folder when asked.
