# Dungeondraft pack format check (2026-11-13)

Inspected the public [Arkenforge Dark Fantasy demo](https://arkenforge.com/dark-fantasy-demo-pack/) before writing the reader. Its download is a ZIP containing a pack and a demo video; only the pack was used. The downloaded art is kept out of Git.

Observed pack: `Dark Fantasy Demo Pack.dungeondraft_pack`, 115,360,569 bytes, SHA-256 `31a548167fd4dd3073e5bce0581fba8d16898c20c5b3c959437cef073f3378b3`.

- `GDPC` magic, format version 1, Godot 3.4.2.
- Sixteen reserved uint32 values after the engine version; file count at offset 84: 481.
- Each directory record: uint32 UTF-8 path length, path bytes, uint64 absolute offset, uint64 length, sixteen checksum bytes. All integers little endian. Paths need not be padded.
- Table ends at 48,212. First payload is `res://packs/ZhoK35is.json` at 48,212, length 307. First texture is `res://packs/ZhoK35is/textures/objects/Altar.png` at 1,264,192, length 2,125,987.
- 479 PNGs and two JSON files, including prebuilt thumbnails. Atlas imports textures only when the pack has a `textures` directory, to avoid presenting its cover and thumbnail cache as props.
- Some checksum fields are zero (not provided); verify nonzero MD5 fields.
- The demo repeats 160 thumbnail paths. Exact duplicate paths follow Godot's last-entry-wins behavior; Windows case aliases are rejected rather than silently colliding during extraction.

The layout also matches [Godot 3.4's reader source](https://github.com/godotengine/godot/blob/3.4/core/io/file_access_pack.cpp). Atlas accepts this verified v1 layout and rejects other versions explicitly. No claim of support for encrypted or newer PCK formats.

REA verified the outer ZIP inventory (Evidence `ev_6002b2569060733c9b2d34b08ccaa26329d239a1d5524b29e93906ab08b74548`; no integrity contradictions). The pack header/table observations above came from a separate read-only byte inspection, not REA's ZIP inventory.
