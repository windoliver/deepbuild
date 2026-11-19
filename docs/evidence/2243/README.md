# #2243 evidence: character bodies that meet

Readings from this change's `deep-physics` (Rapier 0.36.1, macOS arm64, release build) on the blind suite's own world
(`tests/acceptance/2243/helpers.ts`): `guard` at x = −2 m (priority 0) and `hero` at x = +2 m (priority 1), each a
capsule of radius 0.3 m with offset 0.01 m on a flat floor, at 120 Hz for 3 s. The blind suite reads 8 of 8 on this
change; at the base it read 7 failing at their assertions and 1 passing (criterion 2's first test: the base already
keeps a standing character still, and its wrong program is the planted one).

## Wrong programs, failing first

| Wrong program | Run | Reading |
|---|---|---|
| the base, `9d0256132` | head-on | 0.6001 m on step 102, then 0.6001 m and 0.6334 m by turns; neither ever rests |
| `--planted characters_against_last_step` | head-on | first step under 0.609 m: step 102, at 0.6001 m (`head-on-steps-characters_against_last_step.csv`) |
| `--backend stale_character_poses` | the kit's `character/head_on` | `fail`: "step 102 ends with the axes of guard and hero 0.6000 m apart, under the 0.609 m they keep at the end of every step" |
| `--planted approach_moves_standing` | `guard` walks into `hero` | `hero` ends 2.6100 m from where it was built |
| `--planted approach_moves_standing` | `hero` walks into `guard` | `guard` ends 2.5933 m from where it was built |
| the order alone, with no other rule (probed while building) | head-on | the pair is carried 4.30 m in 3 s: the engine's controller moves a character with a kinematic body it touches, at that body's velocity |
| the order and no carry, with the slide kept (probed while building) | head-on | they rest 0.6101 m apart until step 237, then slide round each other and walk on |

## This change: the two walkers head-on

`head-on-steps.csv` holds every step: each body's x, the distance between the axes, the pair's occurrences and the
step hash.

- The least distance at the end of any step is 0.610100 m, first on step 102; no step ends under 0.609 m.
- At rest: 0.610100 m at 1 s and at 3 s. From 1 s to 3 s `guard` and `hero` each move 0 m.
- Occurrences of the pair: `contact_begin` at step 102 (`hero`'s controller first touches `guard`) and at step 103
  (`guard`'s first touches `hero`); they meet at 0.8475 s, step 101.7. No `contact_end` while they press.

## One walks into the other, which wants no move

| Walker | Axes at 3 s | Least distance | The standing one, from where it was built | Occurrences |
|---|---|---|---|---|
| `guard` into `hero` | 0.610101 m | 0.610101 m, step 204 | 0 m at every step | `contact_begin` at step 204 |
| `hero` into `guard` | 0.610101 m | 0.610101 m, step 204 | 0 m at every step | `contact_begin` at step 204 |

Only the walker writes: the standing one's controller makes no move, so it touches nothing, as #182 reads a touch.

## The seek and the swapped order

- Sought to 0.5 s (the checkpoint at step 60) and played on: 301 step hashes, each the straight run's; after step 360
  both read `7e3d4fc11ef93cdb`.
- As written, a second process gives the same 361 hashes. With the priorities swapped, a second process gives the same
  361 hashes (after step 360: `63f0d6d241ecb2e8`).
- The point midway between them at 3 s: x = 0.00502 m as written and −0.00502 m swapped. It moves 0.01004 m; two
  steps' walk is 0.03333 m.

## The kit

`character/head_on` and `character/into_standing` (answer 0.61 m within 1 mm) read 0.610100 m and 0.610101 m on Rapier,
natively and in the wasm32 build, where all 60 fixtures pass. On `no_character_controller` both read
`excluded_by_caps`, 36 pass, 25 are excluded and the verdict is `pass`.

## What stayed as it was

- The 58 fixture worlds the base's kit holds and #182's level of 16 character bodies among 499 pillars (600 steps),
  baked on the base's build and on this one: every step hash the same in all 59. In the level no two characters come
  closer than 1.9959 m.
- #182's course (1,200 steps, one character): the same 1,201 step hashes as the base.
- A jump while pressed against another: `hero`, stopped 0.6101 m from `guard` and still walking into it, jumps 1 m at
  step 300, peaks 1.0185 m up at step 355 (#182's discrete answer), lands at step 409 and has moved 0 m along x.
- Cost, a reading and no budget result (a shared Mac, not at rest): #182's 16 bodies add a median 0.133 to 0.136 ms a
  step here against 0.110 to 0.131 ms at the base, of the 1 ms #182 allows.

## The proof lanes

`node scripts/proof.mjs guard before trace`, on the change as two commits (the change, then the `alone` line in
`scripts/lanes.mjs` on its own):

```text
PASS before: … 8 tests, 7 "failed on the merge base at its assertion", 1 "failed on approach_moves_standing at its assertion"
PASS trace: Closes #2243: each of its 4 criteria has a tagged test that ran, passed and failed on a wrong program
FAIL guard: scripts/lanes.mjs: the proof lanes' own code changed
```

The guard line waits on the owner's signed tag for the `scripts/lanes.mjs` commit, as every suite that joins the
`alone` list does. `twins/approach_moves_standing/` under the suite is the wrong program the before lane lays over
the change for criterion 2's first test: the shipped `main.rs` that plants `approach_moves_standing` when no program
is named.

## Not run, or not judged

- Linux x86_64: #182's course golden is not replayed there. The lane's image has no C++ compiler for scene3d's
  `meshopt`, at the base as here, and the full image's compiler crashes under emulation on this Mac.
- #182's budget (`ac11-budgets`) is judged only on a reference Mac at rest.
- The mutation lane: `cargo-mutants` is not installed on this machine.
