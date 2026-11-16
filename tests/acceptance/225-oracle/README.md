# Acceptance tests for #225, Oracle lane: the upstream tests, run against our vector fields

Written first, blind, from issue #225 (`gh issue view 225 --repo windoliver/deepbuild --comments`), its Oracle page
([`doneright/oracles/issues/225.md`](https://github.com/DeepBuildAI/deepbuild/blob/doneright/doneright/oracles/issues/225.md),
with `cases/225.json`, read from DeepBuildAI/deepbuild at ref `doneright`), the upstream files that page pins (read
from its `vendor/` folder), the #225 suite's surface (`tests/acceptance/225/README.md`, written in the same commit) and
base commit `0e5572731`, by a job that never saw an implementation of #225; none existed, and no other worktree,
branch, PR or session was read. #136's rule applies: a linked test counts only when run against our output, so every
ported assertion here is checked against what our binary answers. The implementing agent doesn't edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

Scope: criteria 1, 2, 3 and 7, each with an upstream row on the page. Criteria 4, 5, 6 and 8 have none (the page's "No
upstream test" table) and stay with `tests/acceptance/225/`. Every port also runs on a planted fault and must fail on
it: the #225 suite's `streams_euler` for criteria 1 and 3's dot, and for the others a fault planted in this lane's test
code (a fixture written the wrong way, or our output read against a wrong program's formula).

## Sources

Each upstream test is pinned by commit; no upstream code is copied, and each assertion is re-expressed in the test that
ports it, named after its upstream test. Nothing is copied, so no notice is carried.

| Criterion | Upstream, pinned | Tests | Ported as |
|---|---|---|---|
| 1, 3 | an upstream engine's fork, `cfd33af5aa` | `tests/unit/animation/test_motion.py` 207–229 (test_a_phase_flow_is_its_fields_flow) | `ac1-phase-flow.test.ts`: a follow_stream dot |
| 2 | an upstream engine, `a6d5cc02b4` | its vector field source, 84–125 and 559–575 (formula, no test) | `ac2-arrow-formula.test.ts` |
| 3 | the fork, `cfd33af5aa` | `tests/unit/mobjects/test_vector_field.py` 15–59 (test_flow_speed_only_converts_elapsed_time_once, test_flow_initial_phase_and_long_steps_compose) | `ac3-flow-trims.test.ts` |
| 7 | the fork, `cfd33af5aa` | `tests/unit/animation/test_motion.py` 207–229 (test_a_phase_flow_is_its_fields_flow) | `ac7-flow-field.test.ts`: a group's flow |

## Run

```sh
npm ci                      # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 scripts/lease npx vitest run --root tests/acceptance/225-oracle --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/225-oracle/tsconfig.json   # type-check
rm -rf tests/acceptance/225-oracle/node_modules/.vite
```

`helpers.ts` re-exports the #225 suite's helpers (`../225/helpers.ts`), so both lanes build and ask the same binary the
same way. Each file builds `cargo build --locked --bin deep-show --no-default-features --features full` once, in
`beforeAll`, and fails every test whose build failed. `scripts/lanes.mjs` needs `'tests/acceptance/225-oracle/'` in its
`alone` list; the #225 README gives the line, and the implementer makes that edit. Every `it` passes a 60-minute
timeout. Node built-ins and vitest only.

## The surface under test

The #225 suite's, with nothing added: `deep show` of a film holding `vector_field@1` items (`fn`, `arrows`, `streams`,
`flow`), `{"call": "vector_field"}` with its `arrows` and `trims`, `eval`'s `paths` reading a follow_stream dot's
`items/dot/at/pos`, deep-show's `path` of an item under a group's flowing warp, and the scenario plant `streams_euler`.

## Ports

- **test_a_phase_flow_is_its_fields_flow, for criteria 1 and 3** (`ac1-phase-flow.test.ts`): a dot rides, by
  follow_stream from (1, 0.5) with speed 2π, the field's stream of the turn (−y, x) and of the growth 0.5 p (streams
  step 0.05, time 6.3, pad 30); the film, 1 s at 10 and at 60 fps, is played every frame; at 1 s, field time f32(2π),
  the dot lies within 1e-4 of the exact flow (its start for the turn, e^π times it for the growth), upstream's
  tolerance. Planted fault: `streams_euler`, under which both fields' cases fail, naming the field `f`.
- **The arrow field formula, criterion 2** (`ac2-arrow-formula.test.ts`): on criterion 2's film, every one of the 25
  arrows is 0.45 × sigmoid(|F|) long within 1e-6, along F within 0.1° (but at the origin), and colored by |F| over
  [0, 2] onto the four roles by inverse interpolation: s = 3 × min(|F| ÷ 2, 1), roles i and i + 1 for i = min(⌊s⌋, 2),
  mix s − i within 1e-6. Planted fault: the film with F not halved must fail, naming an arrow.
- **test_flow_speed_only_converts_elapsed_time_once** (`ac3-flow-trims.test.ts`): a constant field (1, 0), one stream
  of time 1, `phase: zero`, `warm_up: false`, speeds 0.5, 1, 2, seeked at 0.125, 0.75 and 2.75 s: the window starts at
  fract(t × speed) within 1e-12, 0.3 long. Our window is [p, p + flash], the design's, where upstream writes
  [1.3 p − 0.3, 1.3 p]; both pin p. Planted fault: the same windows read against speed applied twice fail.
- **test_flow_initial_phase_and_long_steps_compose** (same file): with `phase` hashed and `warm_up` false and true, and
  with `phase: zero`, played every 0.25 s to 2.75 s against a fresh seek to 2.75 s: the windows are equal exactly, and
  start at 0.75 with phase zero. Planted fault: a play one step short (a seek to 2.5 s) gives other windows.
- **test_a_phase_flow_is_its_fields_flow, for criterion 7** (`ac7-flow-field.test.ts`): group `g` on the plane of
  origin (320, 240), unit 100, y up, its identity linear warp flowing along the turn and the growth field for time 2π;
  its child, a path from the plane's (1, 0.5); the film played every frame at 10 and 60 fps; at 1 s the path's first
  drawn point lies within 1e-4 in the plane (0.01 u) of the exact flow of (1, 0.5) at f32(2π). Planted fault: the same
  group without its flow fails, naming the mark.

## Readings

1. **Virtual time.** Upstream carries the point for virtual time 2π over a one-second play; ours sets follow_stream's
   speed to 2π (an f32, so field time is f32(2π) at 1 s) and judges against the exact flow at that time. For the warp,
   `flow.time` is 2π, the same f32.
2. **The growth field** leaves the start's box by far, so its streams take `pad: 30`.
3. **The trim window's form** is the design's [p, p + flash]; upstream's own form maps the same phase onto a window of
   another length, so only p and the window's length are compared.

## What the base already does, and where these fail

The base has no `vector_field@1` and no `vector_field` call, so every file fails at the scenario's `bad_input` or at
the film being presented (`BASE-FAILURE.txt`).
