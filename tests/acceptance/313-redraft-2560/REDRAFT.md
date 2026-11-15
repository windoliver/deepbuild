# #313 blind redraft after #2560: the lint case and the AC15 mutation-kind case carry timeouts that fit their work

Two tests of `tests/acceptance/313/` set no timeout of their own, so vitest's default 5 s judges them. The work each
does has grown since #313: the AC15 mutation-kind case walks every mutation of every published schema's 1,000 draws,
and the lint case runs the whole conformance lint. On the Linux dev machine they took 13.3 s and 6.6 s and timed out
(#2560). This redraft keeps each test's scenario, assertions and messages word for word, and gives each a timeout of
its own: 600_000 ms, the budget the neighbouring AC15 test already carries. On this base the AC15 redraft passes
(45.1 s on a loaded Mac). The lint redraft fails on the lint's own FAIL lines, not on time (35.2 s). BASE-FAILURE.txt
has both runs.

This is the first of the three choices #2560 lists under Decision for the owner: "A blind redraft of the two tests
with a timeout that fits the work (as the neighbouring AC15 test has), approved as a change to a test that covers a
criterion." It is the implementing session's recommendation. #2560 records no choice, and the owner has not made one
here. It becomes the owner's decision only when they sign the retirement of the two originals. Until then the
originals stand, unchanged, beside these.

## What this job read

- `AGENTS.md`, whole.
- Issue #2560 (open), read live with `gh issue view 2560 --json title,body,updatedAt,comments`, `updatedAt`
  2026-11-15T07:50:56Z: its text, the measured table, Decision for the owner, its two criteria, Proof and Depends on.
  It has no comments.
- Issue #313 (closed), read live, `updatedAt` 2026-10-21T08:23:29Z. Only AC15 and the criteria that name the local
  preflight were read, found by a search for AC15's opening words and for "preflight": AC4, AC12, AC13 and AC16, and
  one line of its Scope that names the local preflight (an enum with no closure fails it). The criteria were numbered
  by counting the checkboxes, as 313's README does.
- The design, `docs/technical-design.md`, How we know version 0 works, found by grep: the Conformance tests bullet,
  Wrong programs, Dogfooding, and the summary lines Tests written first and Wrong programs.
- The frozen `tests/acceptance/313/`: README.md, tsconfig.json, `generator.test.ts` and `packaging.test.ts` whole, and
  of `helpers.ts` its list of top-level declarations and the lines that define what the two files import (1-31: the
  imports, `REPO`, `isObject`, `fixturePath`; 210-222: `node`, `buildWorkspaces`; 264-270: `lenientValidate`).
- `tests/acceptance/313-redraft-2551/`, for form: REDRAFT.md, tsconfig.json, the head of BASE-FAILURE.txt and
  `fakes.test.ts`.
- Base `0e5572731` (origin/main), run as BASE-FAILURE.txt shows.
- Midway, a message from the coordinator with base facts about this Mac's load, from a run of the frozen originals on
  the base (not from any work, and not this job's run). At load 250 to 700 the neighbouring AC15 test timed out at its
  own 600_000, drawing every schema's 1,000 cases took about 600 s, the packaging file's build `beforeAll` timed out at
  600_000 so its 10 tests skipped, and `cargo` is not on PATH here. It asked that timeouts be chosen by the work, not by
  this load. It changed one thing here: the lint's wrong programs moved out from under the build's `beforeAll` before
  that file's only run (below). This job's own run drew every schema in about 62 s at load 242 to 294.

This job never opened a source under `packages/*/src`, the body of `scripts/conformance-lint.mjs` or any other
script, another worktree, a branch, a pull request or a diff. The tests drive only the surfaces the frozen tests and
313's README state: `draw`, `listSchemas`, `RECORDED_SEED`, the `Mutation` shape, and the lint's output lines and exit
codes. Two scratch scripts outside the repo filled in this file: one ran the AC15 wrong programs' pick of a schema
through the built public entries (`packages/contracts/dist/index.js`, `packages/conformance/dist/index.js`) to name
it, and one printed vitest's own `expect` messages for the matchers the wrong programs check.

Three things to know about those inputs:

- **This job read the dispute.** Dogfooding gives a redraft "the same inputs and the criterion, never the work, the
  diff or the dispute". #2560 is the dispute. This job read it because its instructions named it and the redraft's
  second criterion lives there. It saw the dispute's measured times and its three choices, never an implementation.
- **The design search printed more than the list.** The grep printed whole lines of neighbouring bullets too (Criteria
  to tests both ways, Criteria in a checked shape, The edit guard, Kits with planted wrong fills, Where each layer
  runs), and seven lines elsewhere in the design that link the section. One sentence of The edit guard bears on this
  redraft and is quoted below. Nothing else here comes from them.
- **Neither test was redrafted before.** `313-redraft-2551` redrafted AC12 in `fakes.test.ts`. Dogfooding allows one
  redraft per test.

## What #2560 changes

| Original (path › describe › it) | Criterion | Why the old one fails | Replaced by |
|---|---|---|---|
| `tests/acceptance/313/generator.test.ts` › AC15 a generator draws valid instances and four mutations for every schema, at 1,000 cases from the recorded seed › AC15 each mutation names its kind, its code (required, enum, range, unlisted_field) and a JSON Pointer; every kind the schema affords is drawn | #313 AC15 | It sets no timeout, so the default 5 s judges it. Its work is a walk over every mutation of every published schema's 1,000 draws (305 schemas at this base), three expectations each, and it grows with the schemas. #2560 measured 13.3 s (8.6 to 14.4 s over four runs) on Linux: `Error: Test timed out in 5000ms.` at `generator.test.ts:81:3`. No assertion of it failed | `tests/acceptance/313-redraft-2560/generator.test.ts` › the same describe › AC15 each mutation names its kind, its code (required, enum, range, unlisted_field) and a JSON Pointer; every kind the schema affords is drawn (redraft 2560) |
| `tests/acceptance/313/packaging.test.ts` › the local preflight runs the conformance lint: enum closures, code mappings, rule fakes and planted codes › the conformance lint passes on the checkout, printing one PASS line per check and no FAIL, INVALID or BLOCKED | #313's wiring row in the suite's README ("the local preflight runs the conformance lint"), which AC4, AC12, AC13 and AC16 rest on, with AC7's code mappings as the README reads them | It sets no timeout, so the default 5 s judges it. Its work is one run of the whole conformance lint, which has grown since #313 (16 PASS lines at #2560's count; 40 lines here, 14 PASS and 26 FAIL). #2560 measured 6.6 s on Linux, the lint alone 7.0 s: `Error: Test timed out in 5000ms.` at `packaging.test.ts:98:3`, on a throwaway merge where the lint exits 0, so no assertion of it failed | `tests/acceptance/313-redraft-2560/packaging.test.ts` › the same describe › the conformance lint passes on the checkout, printing one PASS line per check and no FAIL, INVALID or BLOCKED (redraft 2560) |

Each `describe` title is the original's word for word, and each `it` title is the original's with ` (redraft 2560)` at
the end. Three things differ from the originals, and only these:

- **The timeout.** Each redrafted test carries `600_000` as its own. That is the budget suite 313 already gives the
  heavy steps around these two: the neighbouring AC15 test, which draws every schema's 1,000 cases and runs each
  through the TypeScript validator (more work than this walk), the Rust consumer test, and the workspace build before
  the packaging file. #2560 measured 13.3 s and 6.6 s on 20 cores at load 19 to 26. On the shared Mac here (18 cores,
  load 242 to 312) they took 45.1 s and 35.2 s (BASE-FAILURE.txt). Either would fail the old 5 s, and both sit well
  inside 600 s. The budget is the suite's, not one fitted to either machine's reading: a timeout cut to one machine's
  load would judge the next machine's load, which is what #2560 is about.
- **The setup the original got from the rest of its file**, made here the same way. The AC15 case read draws the
  file's earlier test had drawn and memoized. Here a `beforeAll` in the same `describe` draws every published schema at
  `RECORDED_SEED`, 1,000 cases, through the original's own memo (`drawnFor`, `drawnAll`, copied word for word with
  `CASES`, `CODE_OF`, `KINDS` and `affords`), with the neighbouring test's `600_000`. The lint case ran after the
  file's `beforeAll` built the workspaces, since the lint reads the built packages. Here the same
  `beforeAll(() => { buildWorkspaces(); }, 600_000)` with 313's `buildWorkspaces` sits inside the redrafted test's
  `describe` rather than at file level, so the wrong programs, which need no build, neither wait on it nor skip with
  it. They have a `describe` of their own. The AC15 wrong
  programs stay in their redrafted test's `describe`, since they plant their faults in its memoized draws. If that
  `beforeAll` overran its budget, vitest would skip them with the redrafted test: a skip, never a pass. Nothing else of
  either file is copied: the other tests, `holdConsumer`, the Rust build and the lanes import have no caller here.
- **The assertions sit in one local function each**, so a wrong-program test can hand the same assertion a wrong
  input. `expectMutationsNamed(schemas, draws)` is the original body with `listSchemas()` and `drawnAll` taken as
  arguments, and the test calls it with `listSchemas()` and `drawnAll`. `expectLintPasses(lint)` is the original body
  with `join(REPO, LINT)` taken as an argument, and the test calls it with `join(REPO, LINT)`. On those inputs each
  does what the original's body does.

**The edit guard.** The design's edit guard says, in part: "A tolerance in such a test or its fixtures only tightens,
… a change that raises a bound … is refused even as an approved proposal. The looser bound lands only as a new test
case beside the old, carrying the same criterion tag, with the old and new bounds and runs of both on the same inputs
in its proposal, and the old case goes only by its own approved removal." Neither original declares a timeout and
neither criterion names a time, so whether vitest's default counts as a tolerance there is not this job's to rule. If
it does, this redraft has the shape that sentence asks for: new tests beside the old, with the originals going only by
their own approved removal. The old bound's runs are #2560's (Linux, 5 s), and the new bound's are BASE-FAILURE.txt's
(this Mac). They are not on the same machine: this job did not run the originals, since its instructions keep it to
its own two files. Suite 313 predates `#<issue>.<h8>` tags, and this job did not compute one.

## Wrong programs it fails

#2560's second criterion: "A lint that fails still fails the packaging test, and a mutation with the wrong code still
fails AC15". Each wrong program is handed to the redrafted test's own assertion function by a test headed
`(wrong program)`, which expects the assertion to throw what it should. All are made in memory or in a temp folder; no
repo file is written. Each test checks the message for its custom part and its matcher clause, and all seven tests
pass on the base (BASE-FAILURE.txt). The full messages below are vitest 5.0.5's wording, printed by its `expect`
outside the run; a passing run prints no message.

AC15's are copies of one schema's real draws with one fault planted (`planted()`, a `structuredClone` of the memoized
draws). The schema is the first published one that affords an off-list mutation and draws one: on this base,
`action.reported@1`, which affords all four kinds. The code, kind and path faults sit on the schema's last mutation,
or its last of a kind, so the walk passes every other mutation before it reaches them.

| Planted draws | The assertion throws |
|---|---|
| The last off-list mutation (at `/data/verified`) carries another kind's code, `unlisted_field` | `action.reported@1: enum_off_list raises enum: expected 'unlisted_field' to be 'enum'` |
| The same mutation carries a code none of the four has, `type` | `action.reported@1: enum_off_list raises enum: expected 'type' to be 'enum'` |
| The last mutation (an unknown field at `/data/planted_unknown`) has the kind `type_changed`, not one of the four | `action.reported@1: kind type_changed: expected [ 'required_removed', …(3) ] to include 'type_changed'` |
| The last mutation's path is `#/data/planted_unknown`, its pointer as a URI fragment, which is no JSON Pointer | `action.reported@1: #/data/planted_unknown is a JSON Pointer: expected false to be true` |
| Every off-list mutation is taken out of every draw, though the schema affords it | `action.reported@1 affords enum_off_list, so the draws include it: expected false to be true` |

The lint's are planted scripts in a temp folder (`os.tmpdir()`, removed after the file), run through 313's `node()`
as the real lint is. Each prints lines in the lint's form, `<VERDICT> <check>: <message>`, and exits as given.

| Planted lint | The assertion throws |
|---|---|
| Prints `PASS kits: no problem` and `FAIL codes: exit 4 unmapped`, exits 1 | the lint's output, then `: expected 1 to be +0` |
| Prints the PASS line and `FAIL codes: exit 4 unmapped`, exits 0 | `expected [ 'FAIL codes: exit 4 unmapped' ] to deeply equal []` |
| Prints the PASS line and `INVALID kits: no case`, exits 0 | `expected [ 'INVALID kits: no case' ] to deeply equal []` |
| Prints the PASS line and `BLOCKED env: ps timed out`, exits 0 | `expected [ 'BLOCKED env: ps timed out' ] to deeply equal []` |
| Prints `conformance lint: nothing checked` and no PASS line, exits 0 | `expected 0 to be greater than 0` |

The base's own lint is a real wrong program for the lint case too. It exits 1 with 26 FAIL lines, and the redrafted
test fails at its exit-code expectation with the lint's output as the message (On the base, below). The base is no
wrong program for the AC15 case: its draws pass.

## Kept as they are

Every other test of both files, every file of `tests/acceptance/313/` (`helpers.ts` and the README among them) and
`313-redraft-2551`. None is copied here. In particular:

- The neighbouring AC15 tests: the seed, the 1,000 draws through the TypeScript validator, the four mutations being
  what they say, the Rust consumer, and the lenient consumer as a wrong program. #2560 names none of them: with #2536,
  #2522 and #2551 in, it reports these two as the only tests of the suite still failing on the Linux machine. The
  coordinator's run on this Mac saw the validator test time out at its own 600_000 at load 250 to 700. That is this
  Mac's load, and no test of it is redrafted here.
- The lint lane's commands test, and AC7's and AC8's command-line tests in `packaging.test.ts`. #2560 names none of
  them.

## On the base

- `generator.test.ts`: 5 of 5 pass, exit 0, 120 s wall at load 242 to 294. The draws' `beforeAll` took about 62 s,
  the redrafted walk 45.1 s, the wrong programs 65 to 296 ms each.
- `packaging.test.ts`: 3 of 4 pass, exit 1, 241 s wall at load 252 to 312. The build's `beforeAll`, incremental after
  the setup's full build, took about 187 s. The redrafted lint test fails in 35.2 s at its exit-code expectation. The
  lint exits 1 printing 14 PASS and 26 FAIL lines: 23 code mappings (#2536), and 3 from the environment kit, whose
  fills read BLOCKED because lsof failed. The three wrong programs pass.
- Type-check: `tsc -p tests/acceptance/313-redraft-2560/tsconfig.json` exits 0 with no output.

Dogfooding says that when the new draft also fails on the work, the test stands and no one is asked. On this base the
AC15 redraft passes. The lint redraft fails, but on the lint's FAIL lines, which #2560's Depends on says the original
meets first too until #2536 and #2522 land, and not on time. Neither redraft fails on a time limit here. How that bears
on retiring the originals is the owner's call, with both drafts and these outputs; this job does not make it. #2560's
first criterion (both files pass on `main` on both machines, or the Linux run is recorded as not judged) is not proven
here. This is one Mac, not claimed to be the reference Mac, and the lint case cannot pass until the lint does.

## Run

From the repo root, after `npm ci` and `npm run build --workspaces`:

```sh
npx vitest run tests/acceptance/313-redraft-2560/generator.test.ts
npx vitest run tests/acceptance/313-redraft-2560/packaging.test.ts
node node_modules/typescript/bin/tsc -p tests/acceptance/313-redraft-2560/tsconfig.json
```

Run them without `--testTimeout`, so the tests' own timeouts judge them. With the root config, vitest writes no cache
into this folder. There are 9 tests in 2 files: 2 redrafted tests and 7 wrong-program tests (4 for AC15, 3 for the
lint), which hand the assertions 10 planted inputs.
