# Acceptance tests for #2485: effects.audit's readings: peak count, analytic bounds, overdraw and GPU time

Written first, from issue #2485 (its scope, its Fields `effects.audit {count_peak: u32, bounds: box (analytic), overdraw:
{max: f32 = 8}, gpu_ms: measured against declared}` and its two acceptance criteria), the design sections it names and
base commit `1b4929ae7` ("Merge pull request #3436 …"), by a job that never saw an implementation; none existed, and no
other worktree, branch or pull request was read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a
dispute goes to a blind redraft of this job (design: Dogfooding). Lean: one test per planted reading with its clean twin
(criterion 1), and one test per half of criterion 2.

## What was read

- The issue's text as handed to this job, and its criterion lines with `gh issue view 2485 --json body` (for the IDs).
- `docs/technical-design.md`: Dogfooding; Document check. AGENTS.md.
- `docs/canvas-primitives.md`: Check input: loop kinds (its Fields and Semantics: "Each code kind returns numbers, the
  pixels or item IDs that fail, and a fix as patch ops …"; "the effect counts run on evaluated data and hold on any
  machine; … effect timing read pixels on one machine and are INCONCLUSIVE elsewhere"; "It can never … compare GPU pixels
  across machines"); Particles `particles@1` and its sections (emit regions, occurrence bursts, bounce and kill); The
  cost model (per-item and per-pixel terms, "the overdraw"); Patch (its ops).
- At the base, read only for the surfaces these tests use: `crates/deep-canvas-effects/src/audit.rs` and `module.rs`
  (effects.audit registered with machines `same`, its report BLOCKED `not_run` naming the four unread readings);
  `particles/spec.rs`, `bursts.rs`, `rule.rs`, `bounds.rs` (the params a fixture writes; a burst's peak past the item's
  own `count` is refused at check); `crates/deep-show/src/main.rs` (`verdict` and its `against`, `environment`),
  `verdict.rs` (`judge`, a registered report's row, `fingerprint`), `pixels.rs` (`pixel_runs`, `read_against`, frames
  drawn at t = 0 by default); `crates/deep-show/Cargo.toml` (its features); `scripts/proof-change.mjs` (`criterionId`);
  and the suites `tests/acceptance/1940/` and `1938/` (layout, helpers, and how a same-machine row is read on another
  machine).

## What the base already does, which these tests don't credit

The effects module registers `effects.audit` (#1940), with machines `same`, and its report reads nothing: every
requirement naming it is BLOCKED with `{code: not_run, kind: effects.audit, unread: [count_peak, bounds, overdraw,
gpu_ms]}`, never PASS. deep-show already draws a 3D revision on Metal for a check that reads frames (#1938), names the
run's `fingerprint` on such a row, takes a scenario `environment` as the machine (#138), and reads `against`, another
run's verdict, making a same-machine row INCONCLUSIVE under another fingerprint (#1938). So every test here fails on the
base at its first verdict assertion (BASE-FAILURE.txt).

## Run them

```sh
npm ci                          # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/2485 --no-file-parallelism
npx tsc -p tests/acceptance/2485/tsconfig.json
```

The file builds `deep-show` once, in `beforeAll` (two hours allowed), with `cargo build --locked --bin deep-show
--no-default-features --features full`, honoring `CARGO_TARGET_DIR`, with `CARGO_INCREMENTAL=0` and
`CARGO_PROFILE_DEV_DEBUG=0` unless set and Homebrew's rustup put on PATH when present, and copies it into a temporary
folder, deleted after the file. Every test passes an explicit timeout of 20 minutes; each `deep-show run` is waited for
(15 minutes at most). Each test's evidence store is a temporary folder, deleted after it. No process is started but
`cargo` and the copied `deep-show`, none stopped by name or port, and nothing sleeps. `lane.json` asks the lanes to run
the folder alone (`binary:` it builds deep-show and draws on the GPU).

Off macOS every test fails with a message starting `INCONCLUSIVE:` (deep-show draws 3D only on Metal), as does a row
BLOCKED for want of a GPU (`gpu_unavailable`, `unsupported_platform`, `not_presented`) and every test when cargo can't
run. None passes or skips there. Each GPU run draws a handful of 320 × 240 frames.

## Test builds

None new: every test builds `full`. No Cargo feature and no planted program is asked for.

## The surfaces under test

All are the base's; this suite adds only the check input's fields the issue names.

- **`deep-show run`**: one scenario line in, one answer line `{ok: true, replies}` out, exit 0 (#393), with #96's
  stored documents (`docs[id] = {panel, document}`, revision 0), #403's `claims` and `{call: "verdict", claim}`, #138's
  `environment: {os, driver}` and #1938's `against`.
- **The check input**: `{kind: "effects.audit", count_peak: u32, bounds: [[x, y, z], [x, y, z]], overdraw: {max: f32},
  gpu_ms: ms}` (README: Readings), a requirement of a claim of alpha's whose one deliverable is the fixture.
- **The verdict's row**: `{id, result, issues, blocked?, fingerprint?, …}`. Each issue `{check, code, severity, ids,
  fix?, fix_ops?}` as the base writes it; errors and warnings count, notices don't; a sub-address `<id>#<part>` in `ids`
  reads as `<id>`. `fingerprint` is the base's (#1938): the environment the run drew under.
- **A fix as patch ops**: `fix_ops` when it is a list, else `fix` as a list or as `{ops}`; a sentence, an empty list
  or nothing is not patch ops. Each op is one of Patch's (`create`, `set`, `unset`, `delete`, `move`, `reorder`,
  `rows`, `break_out`); an op by `id` names an item the document holds; a `set` or `unset` writes under
  `items/<id>/`, a `set` carries `value`; and at least one op names the failing effect (by `id` or a path under
  `items/<effect>/`). Which ops (`set params/count`, a `kill` box, …) is the implementer's.

A planted effect is **caught** when its row is `FAIL` and an error or warning has `check: effects.audit`, a code (not
the base's `effects.audit_unread` or `not_run`), the effect's ID in `ids`, and a fix as patch ops. A clean twin
**passes** when its row is `PASS` with no error or warning.

## Fixtures (helpers.ts)

Each is a 2 s `scene` of 320 × 240 px through `cam`, a perspective camera at (0, 0, 6) looking at the origin, 40°;
`requires.modules: {scene3d, effects}`; one layer of alpha's. Its one effect is a `particles@1` at the origin: one
burst of all its `count` at 0 s, life 1 s, ballistic with no gravity or drag, in the `accent` role, seed 7. Frames are
read at t = 0 (the base's default), when every particle of the burst is live.

Each check input states every limit; the roomy ones are `count_peak: 4096`, `bounds: ±3 m`, `overdraw: {max: 8}`,
`gpu_ms: 100`, and each pair narrows one:

| Pair | Effect | Planted | Clean twin | Check input |
|---|---|---|---|---|
| peak count | `sparks`: 2 px dots, still, in a ball of 1.5 m | 2,000 live | 500 live | `count_peak: 1000` |
| bounds | `embers`: 64 2 px dots from a ball of 0.3 m, thrown up a cone | at 2 to 3 m/s: up to 3.3 m out within their 1 s | at 0.1 to 0.2 m/s: at most 0.5 m out | `bounds: [[-1, -1, -1], [1, 1, 1]]` |
| overdraw | `smoke`: 120 px puffs, still, born on one point | 64 stacked: 64 deep | 4 stacked: 4 deep | `overdraw: {max: 8}` |
| GPU time | `flare`: 256 2 px dots, still, in a ball of 1 m | declared `gpu_ms: 0.0001` (100 ns) | the same effect declared `gpu_ms: 100` | as named |

The dots are sparse (the 2,000 sparks cover about 8,000 px of a disc of about 38,000), so no fixture but the planted
smoke stacks anywhere near 8 deep, by either a mean or a per-pixel reading of overdraw, and no fixture leaves ±3 m.

## Criteria to tests

The ID is the first 8 hex digits of the SHA-256 of the criterion's text, trimmed and whitespace collapsed, the leading
`- [ ] ` dropped (`scripts/proof-change.mjs: criterionId`). Each test's name starts with it. All six are in
`effects-audit.test.ts`.

| ID | Criterion | Tests |
|---|---|---|
| `#2485.7e5188e4` | An effect over its peak count, one leaving its declared box, one over overdraw 8 and one over its declared GPU time each fail `effects.audit` with its code, the item's ID and a fix as patch ops, and each clean twin passes | 4, one per pair: the planted effect caught (FAIL; an effects.audit issue with a code naming its ID, with patch ops naming it) and its twin PASS with nothing raised, both in one run |
| `#2485.dac550b5` | The counts and bounds give the same results on every machine; overdraw and GPU time hold on one machine and report INCONCLUSIVE on another | 2. (1) The peak count and bounds pairs on machine A (planted caught, twins PASS), then on machine B against A's verdict: each planted row FAIL, each twin never FAIL, every row's errors exactly A's. (2) The overdraw and GPU time faults on A (caught, each with a `fingerprint`); on A again, a new process, against A's verdict: FAIL with A's codes and items and A's fingerprint; on B against A's verdict: INCONCLUSIVE, its own fingerprint not A's, naming A's too |

Wrong programs these catch: the base, which reads nothing (every test, at its first verdict assertion); a reading
whose failure names no item, carries no code, or gives its fix as text or as ops on another item; a reading that
flags its twin (a limit read wrong, a default overdraw other than 8, GPU time read against the wrong declaration); a
count or bounds read from pixels, or left INCONCLUSIVE or different on another machine (criterion 2, test 1); overdraw or
GPU time that hold on any machine, that change on a rerun on the same machine, or that carry no fingerprint (test 2).

## Readings where the issue and design leave a choice

- **Through `verdict`.** The loop's kinds run on request, and "fails", "passes" and "report INCONCLUSIVE" are verdicts,
  so each check is a claim's requirement judged by `verdict`, as #1938's and #1940's suites judge theirs. "A host path
  in deep-show that draws the effect and times its pass" is how the verdict gets its pixels and time.
- **What the effect is "over".** Every field of the Fields is read as the check input's, as `overdraw: {max: 8}` plainly
  is: `count_peak` the most particles the effect may have live at once, `bounds` the box it must stay in (two corners
  in metres, as `kill.box` writes a box, in the scene's space, which is the effect's own here), `gpu_ms` the GPU time
  declared for its pass, in ms. "Its peak count" can't be the item's own `count`: a burst past it is refused at check
  (`bursts::over_count`), so no document could plant that fault. particles@1 declares no box, so "its declared box" is
  the requirement's. "Measured against declared" is read the same way, the time the requirement declares; the issue's
  "the effect's declared cost" is then what the requirement states for that effect. Every test states all four limits,
  so no default but overdraw's 8 is relied on.
- **Codes.** The issue gives none, so a test asks for a non-empty code by `effects.audit` that isn't the base's
  unread one, and not distinct strings per reading; it asks for the effect's ID in `ids` and patch ops naming it.
- **One issue is enough.** A failing reading may raise more than one issue; one that names the kind, a code and the
  effect and carries patch ops catches it. The twin, which differs from its fault only by the fault, must raise
  nothing.
- **One row, four readings.** effects.audit gives one row per requirement. On machine B a fault in the count or the
  bounds still FAILs (it holds on any machine, and FAIL is worse than INCONCLUSIVE in the verdict's order), with A's
  errors exactly; a twin there is never FAIL and raises no error. Whether its row is then INCONCLUSIVE (its overdraw
  and GPU time unheld on B) isn't asserted. The overdraw and GPU time faults are INCONCLUSIVE on B, never PASS or FAIL.
- **Another machine** is a run whose `environment` differs, with A's verdict read there as `against`, as #1938's suite
  reads it: a same-machine result "carries the run's environment fingerprint" and never counts on another, so its row
  names both fingerprints. "Hold on one machine" is A's verdict read on A in a new process: the timed and pixel faults
  keep A's result, codes, items and fingerprint (their numbers come from pixels and a clock, so they aren't compared).
- **GPU time's fault** is a declaration far under any pass's time (100 ns), not a costlier effect: nothing in a
  document makes the shipped particles operator slower than itself, and an operator declared under its estimate is
  refused at check (`cost_understated`).

## What the implementer meets

- At the base, deep-show's `full` build doesn't know `particles@1`: each row's `blocked` also holds `{code:
  unknown_kind, kind: particles@1, ids: [<effect>]}` (BASE-FAILURE.txt). particles@1 draws today in `deep-gpu`, and its
  bake lives in `crates/deep-gpu-layer/src/particles.rs`; the issue moves the bake into the effects crate and asks for
  "a host path in deep-show that draws the effect and times its pass", so deep-show has to know and draw the kind for
  any of these rows to leave BLOCKED.
- effects.audit is registered with machines `same`, and the base's `read_against` turns a whole row INCONCLUSIVE under
  another fingerprint; criterion 2's first test needs a count or bounds failure to stay FAIL on machine B.

## Not tested

Not tested, because neither criterion asks: the bake moving from `crates/deep-gpu-layer` into the effects crate (a
structural change no surface shows beyond the readings working without a GPU crate), the fixes' amounts and applying
them, readings' numbers, and effects other than particles@1.
