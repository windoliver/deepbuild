# deep-play

## What it is for

The played form (issue #172), as the app and the web player both make it, so the player evaluates and draws what the app does: a document's worlds baked on the pinned physics backend and its logic items stepped on its input track, written into the form its readers read; each logic program inlined; the core's column view; what a session's frame draws; a 3D frame's evaluated scene; and values read as the app's `eval` reads them. The app's `deep-show` and the web player's `deep-player` both call these.

## Where new code goes

- `src/worlds.rs`, `src/derive.rs`, `src/cast.rs`: the world bake, its input entries and `physics.cast@1`.
- `src/logic.rs`: the logic bake, programs and the column view.
- `src/form.rs`: a bundle's document as the player plays it.
- `src/drawing.rs`, `src/scene.rs`, `src/read.rs`: what a frame draws and holds.

## What it may import

The canvas crates and their modules, `deep-logic`, `deep-physics-rapier`, `deep-marks-raster` and `deep-text`, each through its crate root. Never `deep-show`, the hub, a file system or the record: a host hands it what it reads.

## Deviations

None.
