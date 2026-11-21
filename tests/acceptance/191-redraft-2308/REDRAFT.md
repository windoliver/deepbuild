# Blind redraft of #191's first criterion's test under #2308

#2308's Scope says: "The behavior kit (#191) gains small twins of its rest, bounce and slide fixtures, the edge and the dominoes below, at `step_rate: 480`, `contact_hz: 240` and `length_unit: 0.01`". #191's first criterion, `#191.8c7c5edf`, says "Rapier 0.36.1 passes every fixture on macOS arm64 and in the physics crate's wasm32 build, each within its tolerance, and the kit's report lists each fixture's measured value beside its answer". Its test, `tests/acceptance/191/ac1-reference-kit.test.ts`, also fails any fixture of the kit whose world isn't at g = 9.81 m/s², 120 Hz and 4 substeps, on both targets. Once #2308's five join the kit that test fails on each of them, though the criterion's own words still hold. This folder redrafts the test, from the two issues, the design and the base `85203f458`.

It was written blind, by a job that never saw an implementation of #2308 or a diff of one. The original is not edited or deleted; a person approves the swap. Run with:

```
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/191-redraft-2308 --no-file-parallelism --testTimeout=3600000 --reporter=verbose ac1-reference-kit.test.ts
```

It imports `tests/acceptance/191/helpers.ts` unchanged. From `tests/acceptance/2308/helpers.ts` it imports only the five fixtures as that suite holds them: `edge`, `stack`, `bounce`, `slide` and `dominoes` for each one's name and world, and `HELD` for its answer and tolerance. The issue names no fixture, so that suite is the one place the names are held, and reading them there keeps the two suites on one surface. It adds no `helpers.ts`. `criteria.ts` holds the criterion's ID, as `tests/acceptance/2009-redraft-2241/criteria.ts` does. Type-check: `node node_modules/typescript/bin/tsc -p tests/acceptance/191-redraft-2308/tsconfig.json`.

## What was read

- The job's brief; #191 as saved for it (its body and its one comment) and its body alone; #2308 as saved for it (its body and its one comment, the note about #2317) and its body alone.
- The base `85203f458b85c999ac03a884c837398e56aeac8d`: `tests/acceptance/191/` (the frozen test, `helpers.ts`, `tsconfig.json`, the README's surface, fixture names, Criteria to tests, Wrong programs and readings; `ac2`, `ac3`, `ac4` and the head of `ac8`, and the other files searched for a rate or a count of fixtures); `tests/acceptance/2009-redraft-2241/` (all five files, for the form); `scripts/proof-change.mjs` (`criterionId`); `scripts/proof-runs.mjs` (what counts as failing at an assertion); `scripts/lanes.mjs` (the physics folders' lines and `byHand`); `scripts/physics-wasm32.mjs`; `scripts/lease`; `docs/canvas-primitives.md`, World and backend `physics.world@1` and Physics: behavior kit; `docs/technical-design.md`, The physics module and Dogfooding; `crates/deep-canvas-physics/src/kit/fixtures.rs` and the head of `kit.rs`, for which fixtures the base's kit holds and in what world; AGENTS.md, CONTRIBUTING.md, the root `tsconfig.json` and `rust-toolchain.toml`.
- `tests/acceptance/2308/README.md` and `helpers.ts`, untracked beside the base: #2308's own blind suite. It is tests, not an implementation. The first of its gaps names this conflict.
- Nothing else: no other checkout, worktree or git ref, no implementation of #2308, no pull request, no web. The pinned backend's source wasn't needed.

## What the redraft replaces

One expectation, which both of the frozen file's tests reach through its judge `reportFailures`.

| Original (path › test) | The expectation | Why it no longer holds under #2308 | Replaced by |
|---|---|---|---|
| `191/ac1-reference-kit.test.ts` › #191.8c7c5edf macOS arm64: the reference backend passes every fixture within the issue's tolerance, listing each measured value beside its answer | For every fixture in `behavior_fixtures`: `step_rate` 120, `substeps` 4 and gravity 9.81 (each also when unwritten), else "fixture …'s world isn't at g = 9.81 m/s², 120 Hz and 4 substeps". It reads #191's Scope, "Fixtures at g = 9.81 m/s², 120 Hz and 4 substeps: …", as a rule over the whole kit | #2308's Scope puts five fixtures in the same kit "at `step_rate: 480`, `contact_hz: 240` and `length_unit: 0.01`", and its first criterion names "a new fixture at `step_rate: 480`, 4 substeps, `contact_hz: 240` and `length_unit: 0.01`". A kit that holds them as #2308 says fails the frozen rule five times on each target. The criterion's text names no rate | `ac1-reference-kit.test.ts` › #191.8c7c5edf macOS arm64: the reference backend passes every fixture within its issue's tolerance, #2308's five in #2308's world where the kit holds them, listing each measured value beside its answer (redraft 2308). The rule splits by name: `small_edge`, `small_stack`, `small_bounce`, `small_slide` and `small_dominoes` are held to 480 Hz, 4 substeps, gravity 9.81, `solver.contact_hz` 240 and `solver.length_unit` 0.01; every other fixture is held to 120 Hz, 4 substeps and gravity 9.81 by the frozen line, unchanged |
| `191/ac1-reference-kit.test.ts` › #191.8c7c5edf wasm32: the physics crate built for wasm32-unknown-unknown passes every fixture within the issue's tolerance | The same rule, on the wasm32 build's `behavior_fixtures` | The same: the kit's data is the interface's on every target | `ac1-reference-kit.test.ts` › #191.8c7c5edf wasm32: the physics crate built for wasm32-unknown-unknown passes every fixture within its issue's tolerance, #2308's five in #2308's world where the kit holds them (redraft 2308). The same judge |

What the redraft adds, so that it is no looser than the criterion. The frozen test holds each fixture #191 lists to its issue's answer and tolerance, to `pass` and to a measured value within that tolerance (`passFailures`). #2308's five are fixtures of the kit too. So where the report lists one, `smallFailures` holds it the same way to #2308's words: `pass`, a measured value beside its answer, the answer and tolerance `tests/acceptance/2308/` holds it to, and the measured value within that tolerance on #2308's side.

| Fixture | Answer | Tolerance | Judged | #2308's words |
|---|---|---|---|---|
| `small_edge` | 0.016 m | `{"m": 0}` | at most | "has dropped 0.5 mm before its centre is 1.6 sides past the edge" |
| `small_stack` | 0 m | `{"m": 0.0002}` | both ways | "the top one's centre within 2% of a side of 4.5 sides up" |
| `small_bounce` | 0.025 m | `{"relative": 0.03}` | both ways | "first bounces to 0.025 m within 3%" |
| `small_slide` | 0.05 m, or its closed form 0.04995 m | `{"relative": 0.03}` | both ways | "slides from 0.700 m/s to rest in 0.05 m within 3%" |
| `small_dominoes` | 0 m | `{"m": 0.000375}` | at most | "no two neighbours are more than 0.05 of a thickness inside each other" |

The other changes: `AC` comes from `./criteria.ts` and the helpers from `../191/helpers.ts`; the header comment, the judge's comment and the `describe` and test names say what is redrafted; each test prints which of the five the kit's data holds; the first test runs the planted mismatches under Wrong programs after the frozen one. Every other line is the original's (`diff` the two files).

## Kept as they are

- The rest of `reportFailures`: the report names `rapier3d` and its target, is admitted, and its verdict is `pass`; each fixture #191 lists is there and passes `passFailures`; each sensor cell's rows, and `excluded_by_caps` for the character cells exactly while Rapier's caps lack `character_controller`; every result has a fixture in the interface's data with the same answer and tolerance; no result fails; none is `excluded_by_caps` while the caps hold every cap it names, and none passes while they lack one; every fixture in the data has a result. These hold #2308's five as they hold any fixture.
- The 120 Hz rule for every fixture but the five: the frozen line, with its message. #2308 says "Unwritten, a world runs as it does today", and moves none of #191's fixtures.
- `freeFallAgrees` and the frozen planted mismatch (free fall's result with its measured value 2% off a 1% answer), line for line.
- The macOS arm64 gate, both targets, the calls (`behavior_fixtures`, `backend`, `behavior_kit`, `bake`), `prebuild(['shipped'])` and `TIMEOUT` (60 minutes) on each test. No test times anything.
- The rest of #191's suite is not redrafted: the job names only the first criterion's test. Read from their code, not run: no other file of `tests/acceptance/191/` holds a fixture's world to a rate or counts the kit's fixtures.
- That the kit holds the five, each once, with its world field for field, its steps and a measure equal to that suite's own reading of the bake: `tests/acceptance/2308/`'s to hold, not this folder's. Here a fixture of the five that the kit doesn't hold is not asked for.

## Readings

- **Which fixtures #2308 lets off 120 Hz.** The five its Scope lists: the rest twin (the stack), the bounce, the slide, the edge and the dominoes, under the names #2308's suite gives them. A fixture under any other name stays at 120 Hz, so the let-off can't be taken by another fixture. #2308's third criterion's two scenes, the 1 m ball and the cube that sleeps, are "in the same world", but the Scope doesn't list them and #2308's suite reads them as bakes. A sixth fixture at 480 Hz fails here, as under the frozen rule.
- **Their world.** The Scope's three settings; the first criterion's "4 substeps" (the other criteria say "in the same world"); and #191's g = 9.81 m/s², which #2308's numbers are worked with (0.886 m/s, 0.025 m, 0.05 m). `contact_hz` and `length_unit` are read under `solver`, 30 Hz and 1 m when unwritten. #2308 calls the name `length_unit` drafted; it is read as #2308's suite reads it.
- **"Passes every fixture … each within its tolerance"** covers the five once the kit holds them, on wasm32 as on macOS arm64. #2308's suite leaves the five on wasm32 unasserted, since no criterion of #2308 names a target. #191's criterion names both.
- **On Rapier the five pass.** They are never `excluded_by_caps` there: #2308's opening says the pinned backend scales its lengths by `length_unit`.
- **Answers, tolerances and sides** are #2308's as its suite holds them (`HELD`); the table above gives the words. `small_slide`'s answer may be the print or the closed form, as there.
- **Present or not.** The five are held where the kit lists them and not required. At the base the kit holds none.

## Wrong programs

The redrafted judge still fails on each of these. All run in the first test, after the real report has passed, as the frozen mismatch does.

- The frozen test's own planted mismatch, unchanged: `passFailures` on free fall's result with its measured value 2% off its 1% answer.
- **A kit that runs one of #191's fixtures at 480 Hz.** The kit's own data with `free_fall`'s world moved into #2308's world (480 Hz, contacts at 240 Hz, a solver length of 0.01 m): caught, naming `free_fall` and 120 Hz. Only the five are let off.
- **A kit whose small fixture isn't #2308's.** The real report and data with the five beside them, each as #2308's suite holds it and reading `pass` at the reading #2308's opening gives the world that holds (1.35 sides, 0.92% of a side low, 0.4% high, 0.4% short, 0.01 of a thickness). Nothing is wrong with that kit, so the judge isn't one that fails whatever it is given. Then, for each of the five in turn, the same kit is caught, in a failure naming the fixture, when it:
  - passes the reading #2308 gives a world that doesn't hold: `small_edge` at 2.09 sides ("a planted wrapper that ignores `length_unit` has not dropped until 2.09 sides past"), `small_stack` half a side low ("more than half a side low"), `small_bounce` 16.1% low (the opening's reading at the defaults), `small_dominoes` 0.2 of a thickness inside ("more than 0.2 of a thickness"), and `small_slide` 4% long of its 3% answer, since #2308 gives the slide no wrong reading;
  - lists no measured value beside the answer;
  - reads `excluded_by_caps` on Rapier;
  - passes that wrong reading within a tolerance of its own, `{"m": 1}`, in the data and the row alike;
  - holds the world left at 120 Hz, at 8 substeps, with no `contact_hz`, or with no `length_unit`.

Without a plant it fails, as the original does, on a kit where any fixture fails, is missing from the report, or disagrees with the interface's data. So it fails on #2308's own planted wrappers (`wrapper_ignores_length_unit`, `wrapper_ignores_contact_hz`) wherever their kit rows read `fail`. Those names are `tests/acceptance/2308/`'s to run, and no test here runs them.

The frozen judge on the right kit above: lifted from the frozen file's text and given the same five, it returns one failure for each small fixture's world, five in all, and this folder's judge returns none (`BASE-RESULTS.txt`). No test of the frozen file was run.

## Criterion ID

Both tests' names start with `#191.8c7c5edf`, from `criteria.ts`. It is the first criterion's ID as #191's body reads today, the same as the frozen suite's, computed the way `scripts/proof-change.mjs`'s `criterionId` does: the first 8 hex digits of the SHA-256 of the criterion's text, trimmed, white space collapsed.

```
$ node -e 'const h=(t)=>"#191."+require("crypto").createHash("sha256").update(t.trim().replace(/\s+/g," ")).digest("hex").slice(0,8);const t=[...require("fs").readFileSync(process.argv[1],"utf8").split(/^###\s+Acceptance criteria\s*$/m)[1].split(/^#{1,6}\s/m)[0].matchAll(/^\s*- \[[ xX]\] (.+)$/gm)][0][1];console.log(h(t))' issue-191-body.md
#191.8c7c5edf
```

#2308 strikes no word of the criterion, so no other ID is proposed.

## What the owner decides

1. **The swap.** Whether, once #2308 lands, `tests/acceptance/191-redraft-2308/ac1-reference-kit.test.ts` runs in place of `tests/acceptance/191/ac1-reference-kit.test.ts`. Until then the original is the test that counts. #2308's Scope's fifth line can't land under the original.
2. **The heading the frozen rule read.** #191's Scope ("Fixtures at g = 9.81 m/s², 120 Hz and 4 substeps: …"), its Fields and the design's Physics: behavior kit ("Fixtures, with g = 9.81 m/s² at 120 Hz and 4 substeps:") can't be read as a rule over the whole kit once #2308 lands. The redraft reads them as the heading of the fixtures listed under them and holds every fixture but #2308's five to it. The design at the base has no line for the five under that heading and no `solver.length_unit` among the world's fields; those are #2308's to add.
3. **The five on wasm32.** #191's criterion says "every fixture … in the physics crate's wasm32 build", so the redraft requires the five to pass there once the kit holds them. Neither #2308 nor its suite says so. If the five should run natively only, that is a change to #191's criterion, which this folder can't make.
4. **Five, by these names.** The names are `tests/acceptance/2308/`'s choice and the count is the Scope's list. If the owner renames one, or wants the third criterion's ball or sleeping cube in the kit too, the let-off here follows by one line each.

Noted apart, not #2308's: the design's Physics: behavior kit lists, under the same heading, an orbit "at 1 substep". The base's kit holds no such fixture. When one lands, the frozen rule and the half of it kept here both fail on it.

Not this criterion's: #191's eighth holds the whole kit to 60 s per backend and target on the reference Mac. The five add 0.25 s to 4 s of world time each, at 480 Hz. Nothing here measures it.

## Lanes

This folder builds `deep-physics` and its wasm32 library, as #2309's files do, so it runs alone. This job may not edit the script. The implementer adds:

```
alone.push('tests/acceptance/191-redraft-2308/');
```

On the owner's word for the swap, the frozen file goes to `byHand`, as #177's third criterion's did: `byHand.push('tests/acceptance/191/ac1-reference-kit.test.ts');`. At this base `scripts/lanes.mjs` has no line for `tests/acceptance/191/`.

## Runs

At the base `85203f458`, on macOS arm64 with Node 24.22.0, vitest 5.0.5 and cargo 1.99.1 (`BASE-RESULTS.txt`): the type-check exits 0 and 2 of 2 tests pass. They pass there because the base's kit holds none of #2308's five and every fixture it holds is at 120 Hz, so the redraft reads only what the base and a program that meets #2308 have in common. It is not the test that fails first for #2308; `tests/acceptance/2308/` is.

Not run: the redraft on a program that meets #2308, which this job never sees; the original file and the rest of `tests/acceptance/191/`; `tests/acceptance/2308/`.
