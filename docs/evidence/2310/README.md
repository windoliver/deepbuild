# #2310 evidence: joints of one tree as one articulation

Readings from this change's `deep-physics` (Rapier 0.36.1, macOS arm64, release build) on the blind suite's own
worlds and judges (`tests/acceptance/2310/helpers.ts`), at 120 Hz and 4 substeps. The blind suite reads 22 of 22 on
commit `14c8f36a3`; at the base, `85203f458`, all 22 failed at their own assertions
(`tests/acceptance/2310/BASE-FAILURE.txt`).

## Wrong programs, failing first

| Wrong program | World | Reading |
|---|---|---|
| the base | every world of the suite | refused: `unknown_field` at `joints/<ID>/articulated` |
| `--planted articulated_built_separate` | the chain hung with a 10 kg bob | `joint_02` opens 17.5217 mm at step 25; the bob is up to 85.27 mm off 1.05 m |
| `--planted articulated_built_separate` | the chain with a 100 kg bob, let go level | `joint_02` is the first to open, at step 4; `joint_07` opens 3,234.6 mm; the bob passes its lowest point at 3.5087 m/s |
| `--planted articulated_built_separate` | the 10 kg chain swung into the wall | `joint_02` opens 25.4021 mm |
| `--planted articulated_built_separate` | the kit | `articulated/loaded_chain` and `articulated/swing` read `fail`, each naming `joint_02` and its step |
| `--planted articulated_drops_limits` | the hinge limited to ±30° | its largest angle is 178.5025°, at step 116 |
| `--planted articulated_tree_counts_only` | the square | no issue: four hinges, four bodies |
| `--planted articulated_starts_at_zero` | the hinge written at 45° | `arm` is at (0, −1, 0) m from the hinge after step 1 |
| `--planted checkpoint_drops_joint_coordinates` | the 10 kg chain let go level, sought | a seek's states differ from the straight run's; the first failure names the step and the body |
| `--backend no_articulations` | the hand and the torso | `physics.backend_cap` at the articulated joints, naming the backend |

## This change

| World | Reading |
|---|---|
| the chain hung with a 10 kg bob, 4 s | widest opening 0.0000 mm; the bob's centre within 0.0001 mm of 1.05 m |
| the chain with a 100 kg bob, let go level | lowest point at step 73, 4.5385 m/s against √(2 × 9.81 × 1.05) = 4.539; widest opening 0.0034 mm (`joint_10`, step 447) |
| the 10 kg chain swung into the wall | `hit` between `bob` and `wall` at step 73; the bob at most 0.5458 mm past where it touches; widest opening 0.0035 mm |
| the kit's three on articulated joints | period 2.0107 s; largest hinge angle 30.0032°; motor 89.979°/s after 0.5 s |
| the same three on separate joints | 2.0109 s; 30.0000°; 89.995°/s |
| the square of four articulated hinges | `physics.articulation_tree` at `joints/corner_4/articulated`; with `corner_4` separate, no issue, and it steps |
| `load`, the `b` of two | `physics.articulation_tree` at `joints/hold_2/articulated` |
| `breaks_at` on an articulated joint | `out_of_range` at `joints/rod/breaks_at` |
| the hinge written at 45° | `arm` at (0.70711, −0.70711, 0) m from the hinge after step 1 and after step 120 |
| the same, written 2 mm off | `physics.articulation_gap` at `joints/hinge/frame_b/anchor`, actual 0.001999994507 m |
| the hand and the torso, articulated | no issue; `wrist` opens 0.0000 mm |
| the hand and the torso, separate | `physics.mass_ratio` at `joints/wrist`, ratio 200; `wrist` opens 15.4185 mm |

## The seek, the golden and the merge base

- The 10 kg chain let go level, sought from each of its checkpoints and played on: every state and step hash is the
  straight run's.
- Its golden, recorded here, replays PASS on this Mac, in wasm32 (`node scripts/physics-wasm32.mjs`) and on Linux
  x86_64 (the lane's linux/amd64 container, emulated), step for step, 481 step hashes; a replay shifted one ulp at
  step 240 differs first there on all three.
- Four worlds with no articulated joint (the chain, the hand and the torso, the limited hinge, the hinge motor, each
  on separate joints) have the merge base's step hashes, string for string.

## The kit

69 fixtures, all `pass`, on Rapier natively and in the wasm32 build, to the same readings: `articulated/loaded_chain`
1.0500000715 m, `articulated/swing` 4.5385336633 m/s, `articulated/pendulum_period` 2.0107241437 s,
`articulated/hinge_limit` 30.0031632124°, `articulated/hinge_motor` 89.9785614014°/s. On `no_articulations` the five
read `excluded_by_caps`, 36 pass and 34 are excluded, and the verdict is `pass`.

## What the suite doesn't hold, read here

- A slider and a fixed joint, articulated, whose second body is written turned off the joint's own freedom start and
  stay as written; on separate joints the same bodies are pulled square within the first second.
- `spring`, `active: false`, a `b` that isn't a dynamic body, a `rope` joint written articulated and an output's
  `joint_force` of an articulated joint are each refused, naming the field. In kinematic mode the field changes
  nothing.
- A velocity written on a body of an articulation is refused at check, and a launch and a poke at their step
  (`articulated::tests`, which fails with either refusal taken out); a grab moved the 10 kg bob 0.2844 m.

## Not run, or not judged

- `node scripts/proof.mjs guard before trace` and the mutation lane.
- `node scripts/affected.mjs`: its selection was listed, not run. Run instead, one file each, all passing: #1918
  `ac1`, #523 `ac1`, `ac3` and `ac7`, #191 `ac1` and `ac6`, #2243 `ac4`, #2241 `ac4`; and `cargo test` and
  `cargo clippy -D warnings` on the two crates this change touches.
- The canvas kit (`node scripts/canvas-kit.mjs`) and its ledger.
- The issue's 14.14 mm for the hand: this world reads 15.42 mm on separate joints, and no test depends on it.
