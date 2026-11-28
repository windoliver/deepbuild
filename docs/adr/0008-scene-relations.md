# 0008: The scene.relations check kind

Status: accepted (#3225). The issue's Scope gives the check's input, its result and its two codes, and the design states the measure under Kind: arrange@1 and a check's row under Check input. The suite's README, `tests/acceptance/3225/README.md`, gives the row's fields and the three planted checks. The decisions below are the ones written nowhere else.

## What an item is read as

- **The poses are the frame's, read with what contributes to them.** `crates/deep-show/src/geometry/relations.rs`, `scene_relations_runs`. Each deliverable's current revision is loaded with its worlds' outputs into a session of its own and evaluated at the check's time, and an item's pose is its `core.transform` with every contribution folded in. So an arrangement's solve, a `rest_on`, a channel and a world's output all reach the check the same way, and the check never asks which one placed the item.
- **A parent carries its child in 3D.** `crates/deep-canvas-motion/src/relations.rs`, `Scene::world`. An item's pose is composed under each parent item's, nearest first, as a frame draws them. A parent that is no item is an assembly, whose motion the item's own transform already holds, so it adds nothing.
- **The ground is the top of a body at height 0, with no side faces.** `crates/deep-canvas-motion/src/relations.rs`, `GROUND` and `FAR`. `on ground` reads how far an item's bottom is from y = 0, and `near` and `apart` read the gap to that plane. `next_to`, `against` and `facing` the ground read `unknown`, since a plane has no side.
- **A collection is the box around its items, and may stand as `b`.** `crates/deep-canvas-motion/src/relations.rs`, `Scene::body`. The Scope writes `b: ID | ground`, and criteria 1 and 3 read `inside room`, so a collection's ID is taken as an ID there, as `arrange@1` takes it. The box has side faces.
- **An item tipped past 1° is the box around its turned corners.** `crates/deep-canvas-motion/src/relations.rs`, `stand`. The box is taken in the frame of the item's turn about the up axis, so `on`, `inside`, `near` and `apart` still read a number from it. It has no side faces, so the three relations that need them read `unknown`. Within 1° the item is the body the solve reads.

## What a row says

- **A counted relation is decided by its count alone.** `crates/deep-canvas-motion/src/relations.rs`, `read`. A member that doesn't hold raises no `scene.relation_missed` when the relation states a `count`; only a count outside its range raises `scene.relation_count`. Each member's result carries the count, and so does every result of a collection read without one.
- **An unknown reading stops its relation's count.** `crates/deep-canvas-motion/src/relations.rs`, `read`. When any member reads `unknown` the relation writes no count and raises no count issue, and the requirement reads INCONCLUSIVE.
- **An input the check can't read is INVALID.** `crates/deep-canvas-motion/src/relations.rs`, `stated` and `read`. A relation outside the seven, `near` or `apart` with no `d`, a count that is neither a whole number nor a pair, and a list of none or of more than 64 are refused `bad_input`; a name the document lacks is refused `ref_unresolved`. Each names its path under `expect`, and the row holds it under `blocked` with no result.
- **`timing.check_ms` is the reading's own time.** `crates/deep-show/src/geometry/relations.rs`, `scene_relations_runs`. It runs from the evaluated poses to the results, as `geometry.shape`'s runs from the placed and fetched meshes. Evaluating the frame and looking each item's transform up in the session are not in it.

## Where else the check runs

- **The registry's run reads each item where the document writes it.** `crates/deep-canvas-motion/src/relations.rs`, `issues`. The kit runs a check kind on a fixture's lowered document with no session, so there the pose is the written `at`. A requirement's row always reads the evaluated poses.
- **A catalog row may name the checks that raise its code.** `crates/deep-show/src/kit/catalog.rs`, `core_fixtures`. A row of `kit/catalog.json` with `checks` runs those in place of `document.validate`, which is how a code that only a module's check kind raises gets the planted fixture the kit's catalog part asks of every code.
