# #2457: soft volumes built from mesh assets, as the canvas draws them

No criterion of #2457 asks for a picture. These are here so a person can see the change, and so the renderer's frames are held to the physics module's bake. `shoot.mjs` makes every file in this folder; run it from the repository root after `cargo build --locked --bin deep-gpu --bin deep-physics` (needs ffmpeg and macOS).

## The scene

Three mesh assets, each the source of a soft volume with `inflate: 1.2` and drawn back by its skin, each starting 0.5 m above the ground:

| Item | Asset | Drawn with |
|---|---|---|
| `cube` (red) | the acceptance suite's cube of 0.5 m: 24 file vertices, no face sharing one, 8 welded | the item's material |
| `tinted` (blue) | the same mesh, in a file that carries its own material | the file's material |
| `blob` (yellow) | a ball of 0.3 m radius: 42 vertices its 80 triangles share. No criterion and no test reaches it | the item's material |

A 1 kg ball is launched at `cube` at 5 m/s at 1.25 s. `deep-gpu`'s `view3d` bakes the world itself from the call's `assets` and draws 90 frames, 0 to 3 s at 30 fps.

## The files

- `stills.png`: the frames at 0 s, 0.37 s, 1.53 s and 2.97 s in one sheet; each is also `still-<time>.png`, the canvas's own 640 × 360 PNG, byte for byte.
- `settle.apng`: all 90 frames at 480 × 270.
- `check.json`: the readings below, and each file's SHA-256.

## What the script holds

For every frame, the pixels each asset covers (the renderer's object-ID target) are boxed, and the box is held to the box of where its particles, interpolated at the frame's time from `deep-physics`'s own bake of the same world, project through the scene's camera. The bound is 1.5 px.

| Item | Particles | Farthest from its particles, 90 frames | Held to the asset at rest instead | Volume over its rest volume, settled |
|---|---|---|---|---|
| `cube` | 8 | 0.83 px | 81.2 px | 1.1935 (judged: 1.176 to 1.224) |
| `tinted` | 8 | 0.87 px | 81.2 px | 1.1935 (judged: 1.176 to 1.224) |
| `blob` | 42 | 0.87 px | 111.7 px | 1.1976 (read, not judged) |

Read and not judged, since no criterion names them: the launched ball moves the cube's particles at most 9.18 mm apart or together, presses 10.06 mm past the plane of the face it hits and ends at 0.12 m/s; the blob, 0.6 m tall as built, is 0.400 m at its flattest on landing and 0.535 m at the end.

## What the frames show

Looked at by the agent that made the change, frame by frame around the landing and the hit; this is not a person's taste call.

- All three fall together, land at about 0.33 s and stay on the ground, each with its shadow under it.
- The blue cube, drawn with its file's own material, moves and swells exactly as the red one does.
- The blob flattens on landing and springs most of the way back.
- A cube of 8 particles can only swell and shear, so the ball's 9 mm dent can't be seen at this size; the hit shows as the ball stopping against the face.
