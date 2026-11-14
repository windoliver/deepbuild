# Acceptance tests for #222, Oracle lane: the upstream projects' timing tests, run against our cue lists

Written first, blind, from issue #222 (`gh issue view 222 --repo windoliver/deepbuild`), its Oracle page
(`doneright/oracles/issues/222.md` on branch `doneright` of the Oracle repository), the upstream files that page pins
(read from its `vendor/` folder at that ref), the #222 suite's surface (`tests/acceptance/222/README.md`, written in
the same commit) and base commit `f6d811c7`, by a job that never saw an implementation of #222; none existed, and no
other worktree, branch, PR or session was read. #136's rule applies: a linked test counts only when run against our
output, so every ported assertion here is checked against what `deep-show run` answers. The implementing agent doesn't
edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

Scope: the timing scenarios the page cites for criteria 1, 2 and 3 (play-and-wait time, succession, staggered windows
of span (n − 1) × lag + 1, from-values taken when a cue begins). Criteria 4 to 8 have no upstream test (the page's "No
upstream test" table) and stay with `tests/acceptance/222/`. The page's graphical tests, which compare every frame of a
verb with control frames another renderer drew, need frames rendered outside the repo: that case reads `BLOCKED:` with
one unblock line, never a pass.

## Sources

The page's rows, each pinned by commit; no upstream code is copied, and each assertion is re-expressed in the test that
ports it, named after its upstream test.

| Criterion | Upstream, pinned | Tests | Ported as |
|---|---|---|---|
| 1 | an upstream animation library, `a6d5cc02b4` | `tests/module/scene/test_scene.py` 53–62 (test_scene_time); `tests/module/animation/test_composition.py` 20–92 (test_succession_timing, test_succession_in_succession_timing) | `timing.test.ts` |
| 1, 3 | a fork of it, `cfd33af5aa` | `tests/unit/animation/test_timeline.py` 92–119 (TestGetSubAlpha), 416–447 (TestLayout) | `stagger.test.ts`; `timing.test.ts` (exact durations) |
| 2 | the fork, `cfd33af5aa` | `tests/unit/animation/test_transform.py` 90–106 (test_keys_are_applied_as_the_animation_begins_to_a_copy); `tests/unit/animation/test_motion.py` 169–180 | `from-values.test.ts` (the first; the second not ported) |
| 3 | the library, `a6d5cc02b4` | `test_composition.py` 124–133 (test_animationgroup_with_wait) | `stagger.test.ts` |
| 3 | the library, `a6d5cc02b4` | `tests/test_graphical_units/test_creation.py`, `test_indication.py`, `test_specialized.py`, `test_movements.py` and their `control_data` | `stagger.test.ts`: BLOCKED |

## Run

```sh
npm ci                      # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/222-oracle --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/222-oracle/tsconfig.json   # type-check (exits 0)
rm -rf tests/acceptance/222-oracle/node_modules/.vite
```

Each file builds `cargo build --locked --bin deep-show --no-default-features --features full` once, in `beforeAll`,
honoring `CARGO_TARGET_DIR`, and fails every test whose build failed. `scripts/lanes.mjs` needs
`'tests/acceptance/222-oracle/'` in its `alone` list (the #222 suite's README gives the line). Every `it` passes a
60-minute timeout. Node built-ins and vitest only.

## The surface under test

Exactly the #222 suite's: `deep show` of a film whose `cues@1` item `list` plays the cues, with the first-party verbs
offered (`deepbuild/verbs`, `packs/verbs-1.0.0/`); the reply's `expansions` entry for `list` and its markers
`cues.<id>` (`t`, `span`), read as each cue's window [t, t + span] in exact flicks; `eval {doc, t, paths}` for a
square's `items/<id>/at/pos`. Cues set `ease: "smoothstep"` where a value is compared, since the design states its
formula (3x² − 2x³). Films run at 24 fps (`transport.frame_rate: "24/1"`) so `8f` is exactly 1/3 s.

## Ports

- **test_scene_time**: a wait of 2 s, a 0.5 s fade_in, a 5 s fade_in: windows (0, 2), (2, 2.5), (2.5, 7.5) s.
- **test_succession_timing**: fade_in 1 s, fade_out 4 s: (0, 1), (1, 5); the second starts at 20% of 5 s.
- **test_succession_in_succession_timing**: 4 s, (1 s, 4 s), 1 s, written in line (cue lists don't nest): (0, 4),
  (4, 5), (5, 9), (9, 10), the 40%, 50% and 90% marks of 10 s.
- **TestLayout.test_nested_successions_keep_exact_durations**: waits of 2.5 s, 8f (1/3 s) and 0.25 s end at exactly
  their sum in flicks. The upstream's example durations (1e-8 s) aren't whole flicks, which our time grammar refuses, so
  1/3 s stands in for the value that doesn't round evenly.
- **TestGetSubAlpha**: one cue over n squares (n = 1, 2, 5, 12) at each upstream lag (0, 0.05, 0.1, 0.2, 1/3, 0.5,
  0.9, 1), `span: 1s`, setting x from 0 to 1. Window ends exact: the cue's marker spans (n − 1) × lag + 1 s within one
  flick; every part reads exactly 0 at 0 s and exactly 1 at the cue's end. In order and in its window (n ≤ 6): at 20
  times, part i reads at least part i + 1, within [0, 1], and equals smoothstep(clip(t − i × lag, 0, 1)) within 1e-6
  (the upstream's 1e-12 widened by each window start's whole-flick rounding). The upstream's rate function there is its
  ease_out_back; ours is smoothstep, the window being what is ported.
- **test_animationgroup_with_wait**: a group with lag ratio 1 is a succession: a 1 s wait then a 1 s fade_in, (0, 1)
  and (1, 2).
- **test_keys_are_applied_as_the_animation_begins_to_a_copy**: a cue after another moves from where the first left its
  target: x 3 at 1 s, 4 at 1.5 s, 5 at 2 s within 1e-9 (a shift of 2 that is half done halfway).

## Not ported

- test_motion.py's moving target: it moves its target with an updater, code run each frame, which a cue list can never
  run.
- TestLayout.test_a_group_lasts_until_its_last_part_ends with unequal part durations: a cue's targets share one span,
  so only the equal case applies, which TestGetSubAlpha's window ends already hold.
- The graphical tests: BLOCKED (`stagger.test.ts`), unblocked by rendering the pinned graphical tests once outside the
  repo and storing their frames as goldens beside the 40-cue explainer's (the issue's Proof line).

## At the base

Not run: at `f6d811c7` there is no `cues@1` kind and no `packs/verbs-1.0.0/`; `BASE-FAILURE.txt` says where each test
fails. The type-check exits 0.
