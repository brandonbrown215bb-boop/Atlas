# User Checks

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
