# Twins for the 491 tests named by criterion ID

#491 is implemented on main (PR 1314), so every test of the `-ids` files (`../REDRAFT-2047.md`) passes on the merge
base, and each needs a wrong program to fail on. Each twin is a full copy of one source file of `deep-canvas-motion`
as main holds it, with one planted fault that undoes what its criterion names. It is laid over the change, so the
change's other files stay. The `-ids` test it must fail is named beside it, and it fails there at an assertion.

| Criterion | Twin | Replaces | The planted fault | Fails |
|---|---|---|---|---|
| `#491.f573affb` | `grid-f32-always` | `crates/deep-canvas-motion/src/tempo.rs` | A constant section's beats are kept in f32 seconds on every run, not only the planted one | `beat-grid-ids` › every beat k = 0 … 100,000 |
| `#491.f573affb` | `plant-inert` | `crates/deep-canvas-motion/src/tempo.rs` | The plant `beat_grid_f32_seconds` is accepted but keeps the exact grid, so nothing differs | `beat-grid-ids` › a planted grid kept in f32 seconds fails the check |
| `#491.225d1288` | `chain-one-beat-short` | `crates/deep-canvas-motion/src/tempo.rs` | A section chains from its predecessor's start plus one beat less than its span, so the boundary misses its downbeat | `tempo-map-ids` › both tests |
| `#491.225d1288` | `beats-truncate` | `crates/deep-canvas-motion/src/tempo.rs` | Beat times round down to the flick, not to the nearest | `tempo-map-ids` › every beat … rounded to the nearest flick |
| `#491.87664ed5` | `ramp-held-constant` | `crates/deep-canvas-motion/src/tempo.rs` | A ramp's beats are placed at its starting BPM, as if it had no ramp | `tempo-ramp-ids` › both tests (the refusal then names the constant tempo's chained start, not 777,641,758) |
| `#491.87664ed5` | `chain-two-flicks-allowed` | `crates/deep-canvas-motion/src/tempo.rs` | An explicit segment time may sit 2 flicks off its chained start | `tempo-ramp-ids` › a segment … 2 flicks off … is refused |
| `#491.1fdc38d2` | `notice-dropped` | `crates/deep-canvas-motion/src/doc.rs` | The `literal_time_with_tempo_map` notice is built and dropped, never reported | `literal-time-ids` |
| `#491.f247d95a` | `filter-keeps-every-tag` | `crates/deep-canvas-motion/src/occurrence.rs` | The tag filter keeps every occurrence, so the snares count as kicks | `occurrence-lists-ids` › at t = 3 s … |
| `#491.f247d95a` | `last-field-reads-zero` | `crates/deep-canvas-motion/src/occurrence.rs` | `last(list).field` with no match reads 0 rather than taking the driver's fallback | `occurrence-lists-ids` › at t = 0.5 s … |
| `#491.f247d95a` | `next-on-input-allowed` | `crates/deep-canvas-motion/src/program/groups.rs` | `next` over a list the input track feeds is accepted | `occurrence-lists-ids` › next over a list that inputs feed is refused |
| `#491.9977dd4e` | `first-settles-coarse` | `crates/deep-canvas-motion/src/program.rs` | The `first` bisection stops at 1 ms windows, not single flicks | `first-marker-ids` › resolves to 7/3 s within one flick |
| `#491.9977dd4e` | `first-never-takes-before` | `crates/deep-canvas-motion/src/program.rs` | A `first` condition never true in its window resolves to `before` instead of being refused | `first-marker-ids` › a condition never true … is refused |
| `#491.9977dd4e` | `layout-snaps` | `crates/deep-canvas-motion/src/program.rs` | A key on a frame's layout snaps to the nearer layout instead of mixing the boxes | `layout-glide-ids` |

The twins are frozen copies of main at `ccafae68f`. If those files change on main later, a twin still carries its
fault, but the rest of its copy is the older code.
