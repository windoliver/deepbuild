# Acceptance tests for #226, Oracle lane (blind redraft): a point read through the axes' three scales, run against our output

Written first, blind, from four sources:

- issue #226;
- its Oracle page, `doneright/oracles/issues/226.md` on branch `doneright` of `DeepBuildAI/deepbuild`;
- the one upstream file that page pins, read from the vendor copy on that branch;
- the design at base commit `9b77cd2cd` (`docs/canvas-primitives.md`: Marks in 3D: axes `axes3d@1`; Marks in 3D;
  Modifier; Scale and encode `scale@1`, `axis@1`, `legend@1`; `docs/technical-design.md`: Dogfooding), and the base's
  code for its host surfaces only (`deep-show run`, its `deep_show` and `geometry` calls, `scale@1`'s fields,
  `mark.point@1`'s placement, the item's `modifiers` list).

The job never saw an implementation of #226; none existed at the base, and no other worktree, branch, pull request or
suite for #226 was read. #136's rule applies: a linked test counts only when run against our output, so each case here
builds our document and asserts on the positions `deep-show` answers. The implementing agent doesn't edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

The page links an upstream test to criterion 1 of 8. The other seven have none (the page's "No upstream test" table)
and stay with the #226 suite.

## Sources

| Criterion | Upstream, pinned | File | Use | Here |
|---|---|---|---|---|
| 1 | the upstream math library, `a6d5cc02b430fb57d22add51236b6406fbf19d91` | the 3D-axes origin-shift test and its log twin (lines 30 to 63 of the file the page pins) | port | `three-scales.test.ts` (2 tests) |

**The test, re-expressed.** No upstream code is copied or run. Upstream builds 3D axes whose ranges don't start at 0,
linear on all three axes and then log on all three, and asserts that a point placed through the axes at the corner of
the three domains' low ends lies where each single axis places its own coordinate: a point reads its numbers through
three scales, each on its own axis. Ours keeps that shape, with the criterion's numbers:

- the axes are `axes3d@1` with three `scale@1` items, lengths [8, 8, 8] m and `up: z`;
- each point is a `mark.point@1` parented to the axes, at its numbers, carrying `mod.axes@1`;
- beside upstream's corner, each test has one point per axis that moves off the corner along that axis alone, the
  criterion's point (or its log twin, which moves along all three), and the far corner. So each axis's own placement,
  the three together, and the axes' lengths are each read.

Turning math z into world +Y and math y into world −Z is ours (the page: "our convention, with no upstream test"); both
tests hold it. The vendor copy holds no license file. Nothing is copied, so no notice is carried.

## Run

```sh
npm ci && npm run build --workspaces   # once, in a fresh worktree
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  scripts/lease npx vitest run --root tests/acceptance/226-oracle-redraft --no-file-parallelism --testTimeout=600000
npx tsc -p tests/acceptance/226-oracle-redraft/tsconfig.json
rm -rf tests/acceptance/226-oracle-redraft/node_modules/.vite
```

The file builds `cargo build --locked --bin deep-show --no-default-features --features full` once and copies it out,
and every test passes a 60-minute timeout. **`scripts/lanes.mjs` needs `'tests/acceptance/226-oracle-redraft/'` in its
`alone` list**; the implementer makes that edit. `BASE-FAILURE.txt` says what each test meets at the base.

## Assumed surfaces

The issue names the axes, the scales, `mod.axes@1` and a world position, but no call that reads one. These tests use
the base's own surface plus one row, and the implementer provides exactly these or disputes them:

- **#393's `deep-show run`, unchanged.** One scenario line binds the agent session `sess-alpha`, one panel, and the
  document `01JB0226D00000000000000001` on it. The working agent's `deep_show` presents the whole document (agent form:
  no `layers`), with `include: ["issues"]`. Presented means outcome `presented`, no error issue, and no item skipped as
  `unknown_kind`.
- **#420's `geometry` call, with one new row.** `{"call": "geometry", "doc", "items": [ids]}` at t = 0 answers
  `{"items": [row]}`. For a `mark.point@1` item, the row is `{"id", "kind": "mark.point@1", "pos": [x, y, z]}`. `pos` is
  the point's world position at t in metres, after its modifiers (`mod.axes@1` included) and its parents' transforms:
  where the point draws. An `instance@1` row's elements already give `pos` in world metres; this is the same field for
  a point. A reply with a `code` is a refusal.
- **The document's fields**, as the design spells them:
  - `scale@1 {type: linear | log, domain: [min, max], range: x | y | z, nice: false}`: one scale per math axis, its
    range naming its axis. The issue's scope says a scale's `range` gains `z`.
  - `axes3d@1 {x, y, z: scale ID, lengths: [8, 8, 8], up: z}` at the world origin.
  - `mark.point@1 {size: 4, paint: {fill: {role: ink}}}` with `parent: axes`, `at.pos` its numbers, and
    `modifiers: [{kind: "mod.axes@1", params: {axes: "axes"}}]`, the item's modifier list as the base reads it.
  - `requires.modules: {scene3d: "^1", data: "^1"}`, since `axes3d@1` is the data module's.
- **`nice: false`** keeps each domain exactly as given. The criterion says "domains [−4, 4]"; a nice-rounded domain
  would be another domain.

## Criterion to test

Both tests carry criterion 1's ID, `#226.c218cc0a`: the issue's line, trimmed, white space collapsed, SHA-256, first 8
hex digits, as `scripts/proof-change.mjs` computes it.

| ID | Test | Upstream | Ours |
|---|---|---|---|
| `#226.c218cc0a` | `three-scales.test.ts`, linear | the 3D-axes origin-shift test: domains not starting at 0, the corner point lies where each axis places its coordinate | Domains [−4, 4], lengths [8, 8, 8] m, `up: z`. The criterion's point (2, 3, 1) must sit at world (2, 1, −3), and five more points at their places, each within 1e-6 m. |
| `#226.c218cc0a` | `three-scales.test.ts`, log twin | the same, with log scaling on all three axes | Log domains [1, 10^4], the same lengths and `up: z`. Each point must sit at its offset from the corner (1, 1, 1), 2 m a decade, within 1e-6 m. |

## Fixture and numbers

Linear, domains [−4, 4] on each axis. 8 m over 8 units is 1 m a unit. The criterion's (2, 3, 1) at world (2, 1, −3)
fixes where 0 sits: at the axes' origin. With `up: z`, math x is world +X, math z is world +Y and math y is world −Z.
So (x, y, z) sits at world (x, z, −y):

| Point | Numbers | World |
|---|---|---|
| `point` (the criterion's) | (2, 3, 1) | (2, 1, −3) |
| `corner` (upstream's) | (−4, −4, −4) | (−4, −4, 4) |
| `along_x` | (2, −4, −4) | (2, −4, 4) |
| `along_y` | (−4, 3, −4) | (−4, −4, −3) |
| `along_z` | (−4, −4, 1) | (−4, 1, 4) |
| `far` | (4, 4, 4) | (4, 4, −4) |

Log twin, domains [1, 10^4] on each axis. Four decades over 8 m is 2 m a decade. Offsets are measured from `corner`
(1, 1, 1):

| Point | Numbers | Offset from the corner |
|---|---|---|
| `along_x` | (1000, 1, 1) | (6, 0, 0) |
| `along_y` | (1, 100, 1) | (0, 0, −4) |
| `along_z` | (1, 1, 10) | (0, 2, 0) |
| `point` | (1000, 100, 10) | (6, 2, −4), the three above summed |
| `far` | (10^4, 10^4, 10^4) | (8, 8, −8), the axes' lengths |

Every expected value is a whole number of metres. Each axis moves its point by a different amount (3, 2 and 1
decades; 6, 7 and 5 units), so two axes swapped are caught.

## Wrong programs

| Wrong program | What catches it |
|---|---|
| a point left at its numbers: the axes' transform alone, no `mod.axes@1`, or `up: y` | linear: `point` at (2, 3, 1), not (2, 1, −3) |
| math y taken to world +Z (no flip) | linear: `point`, `corner` and `along_y`; log: `along_y` |
| math y and math z swapped | linear: `point`; log: `along_y` and `along_z` |
| a scale's range starting at the axes' origin ([0, 8] m) | linear: every point is 4 m off on each axis |
| log scales read as linear | log: `along_x` 0.8 m from the corner, not 6 m |
| a domain spread over another length than 8 m | linear `far` and log `far`, and the single-axis points |

The judge runs in the file on planted placements before the binary is asked (`judgeFailsItsPlants`):

- the right linear and log placements pass;
- a point left at its numbers fails, naming `point at (2, 3, 1)`;
- math y taken to world +Z fails at `along_y`;
- log scales read as linear fail at `along_x`.

## Readings where the port leaves a choice

- **Where a log domain sits.** The design gives lengths and `up` but not where a log domain's low end lies beside the
  axes' origin; a log scale has no 0. So the log twin compares offsets from its corner point, not world positions. The
  linear test pins the origin through the criterion's own numbers.
- **Upstream's per-axis placement** (each axis placing its own number) is read here as the points that move along one
  axis alone. Reading it as the axes' tick positions would tie the test to how many ticks the rule picks. Ticks are
  criterion 6's, in the #226 suite.
- **The tolerance**, 1e-6 m, is the criterion's, used for positions in the linear test and for offsets in the log twin.

## Not tested

The rest of the upstream file (its 2D axes tests). Criteria 2 to 8, which have no upstream test (the page's table).
Axes placed away from the world origin and moved: criterion 4's, in the #226 suite.

## What the implementer adds outside this folder

The `alone` line in `scripts/lanes.mjs`. Nothing else.
