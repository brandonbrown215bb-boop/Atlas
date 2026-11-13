# Campaign atlas — discussion bundle

Start with **MAP_EDITOR_BRIEF.md**. It captures the intended editor, what has been decided, the examples discussed, and what remains open.

## Contents

- `MAP_EDITOR_BRIEF.md` — the working product brief.
- `TECH_STACK_AND_OPEN_QUESTIONS.md` — proposed stack, practical requirements, and the unanswered questions at the end of the discussion.
- `RESEARCH_LINKS.md` — projects and tools discussed as references.
- `research/REVERSE_ENGINEERING_REPORT.md` — a copy of the earlier report found in Documents/Map Tool. Its technical claims have not been reverified in this conversation.
- `reference-maps/` — the four supplied map images: the original procedural forest inspiration and the user's world, Khartoum city, and pyramid maps.
- `preview/atlas-editor.html` — a standalone version of the interface sketch. Open it in a modern browser to try selecting locations and switching among the existing maps.
- `preview/atlas-editor-fragment.html` — the original inline sketch source.

## What exists so far

This is a design and research bundle. The interface sketch uses existing map images and a few interactive selection controls. It does not implement map generation, drawing, continuous zoom, world saving, docking, or Foundry integration. The proposed technology stack has not been installed or committed to.

The interactive sketch was syntax-checked, but visual browser verification was blocked by the available computer-use tool. Its rendering in the remote chat app was uncertain. It is included as a starting point for discussing layout, not as a verified working editor.

The source maps are included unchanged. The original forest map was supplied as inspiration from someone else's post. The other three maps were described by the user as their own work in Inkarnate.

## Guiding idea

Build an offline Windows worldbuilding editor for personal use. Move naturally between scales, keep everything editable, and develop places further when the players become interested. Support TV display and optional Foundry handoff without requiring a game session to create a world.

Prefer simple solutions. Preserve deliberate edits. Make maps and suggestions useful at the table. Keep suggestions short, concrete, optional, and grounded in material the user likes.
