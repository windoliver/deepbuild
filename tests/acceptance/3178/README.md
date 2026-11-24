# Acceptance suite for #3178: the #667, #27 and #111 suites pass, and a provisional ask still goes on at once

Written blind at base `37dd3c0c8` (origin/main, "Merge pull request #3072") from issue #3178's body, the design and the
base, by a fresh run of the blind acceptance-test job (AGENTS.md, Proof; design, Dogfooding). It never saw a fix, a
plan, another session or the issue's comments. It edits no file outside this folder.

## The criteria

- AC1 `#3178.1821b407`: "**The suites pass on main.** Given main with the fix, when the #667, #27 and #111 files named
  above run, then each named test passes, or is replaced by a blind redraft that passes and fails on the wrong program
  its criterion names."
- AC2 `#3178.ea90fb17`: "**A provisional ask still goes on at once.** Given a choice with a recommendation in a
  session no work run started, when `deep_ask` runs, then it returns `provisional` with the recommended option (#84),
  unless the fix changes #84's rule by an approved proposal."

Both IDs were recomputed from the body as `gh` serves it, with `criterionId` of `scripts/proof-change.mjs` (SHA-256 of
the trimmed text with white space collapsed): they match.

## What was read

- AGENTS.md; issue #3178's body (summary, What happens today with its table, Scope, criteria, Proof).
- `docs/technical-design.md`: An ask, and your answer getting back ("Work goes on while you decide": "A taste call or a
  choice between options proceeds on the recommended option at once, marked as undoable").
- At the base: `packages/hub/src/mcp-operations.ts` (the `provisional` branch of `deep_ask`),
  `packages/hub/src/starts.ts` (`inWorkRun`, #1332), `tests/acceptance/667/helpers.ts` and `fixtures/agent.mjs`,
  `tests/acceptance/84/reach/provisional.test.ts`, the folders of `tests/acceptance/{667,27,111}` (file lists, tag
  constants, `27/twins.json`), `scripts/proof-runs.mjs` (`twinsOf`, how a twin is laid over the change),
  `scripts/lanes.mjs` (`LANE_FILE`, the alone reasons), `scripts/alone-lint.mjs`, `vitest.config.ts`.

## How to run

Node 24.22 first on `PATH`, macOS, from the checkout's root, after `npm ci`, `npm run build --workspaces` and
`cargo build --locked -p deep-hook` (the tests run the built CLI and the hub it starts):

```sh
npx vitest run tests/acceptance/3178/provisional.test.ts --reporter=verbose   # AC2, about 1 s
npx vitest run tests/acceptance/3178/suites.test.ts --reporter=verbose        # AC1, the named files in a child Vitest each
npx tsc --noEmit -p tests/acceptance/3178                                       # type-check
```

`lane.json` runs this folder alone (`binary`): `suites.test.ts` starts child Vitests on the named files and their
redrafts; #27's `helpers.ts` setup builds deep-hook with cargo (`--features env-plants`), every file starts hubs that run
deep-hook from `target/`, and their stop holds, waits and deadlines are timed besides. Each child writes its JSON report
under a fresh `$TMPDIR/dh3178-*` folder, removed after. AC2 uses `../667/helpers.ts` as it is: a fresh `/tmp/dh667-*`
home, the OS confirmation stubbed (`DEEP_HUB_TEST_CONFIRM`), every process it started stopped by PID (`cleanup`).

## The surface, and what the implementation must provide

**AC1 (`suites.test.ts`).** The surface is the named test files themselves, run by Vitest as the issue's Proof says
("The named tests, run once on main and once on the fix"). One test per row of the issue's table:

| File | Tags (count) |
|---|---|
| `tests/acceptance/667/redraft-1463/raised.test.ts` | `#667.84442921`, `#667.b25a1d05` |
| `tests/acceptance/667/fold.test.ts` | `#667.b1086458` ×2 |
| `tests/acceptance/667/plants.test.ts` | `#667.ca2b4f95`, `#667.b1086458` |
| `tests/acceptance/27/repeat.test.ts` | `#27.6e863673` |
| `tests/acceptance/27/waits.test.ts` | `#27.e6116d56` ×2 |
| `tests/acceptance/27/desktop-redraft/desktop.test.ts` | `#27.f8331d25` |
| `tests/acceptance/111/revive.test.ts` | `#111.ddf55f68` |

Each row runs `node node_modules/vitest/vitest.mjs run <files> -t '<tags>' --reporter=json` from the root, with this
process's environment less `VITEST*`, `TINYPOOL*` and `DEEP_HUB_PLANT`: once on the named file, and once on each
**redraft folder** of the suite (a folder under `tests/acceptance/<suite>/` with a `redraft` segment in its path, or a
sibling folder `tests/acceptance/<suite>-…` whose name holds `redraft`; `twins/`, `fixtures/` and `node_modules/`
left out, the named file left out, and every file `byHand` in the checkout's `scripts/lanes.mjs` names left out), filtered to the tags and their aliases.
A test carries a tag when its full name holds the tag or, for #667, the same criterion's computed ID (Readings).

Each candidate, the named file or one redraft folder, is in one state per tag:

- **passed**: every test of it carrying the tag passed (for the named file, at least the table's count);
- **failed**: one of them failed at an assertion (or the named file has fewer than the table's count);
- **unrun**: none failed at an assertion, and some were skipped or failed BLOCKED or INCONCLUSIVE (the word in the
  failure's first line), or the file didn't load.

A tag **passes** when the named tests passed. Otherwise, when redraft folders carry the tag, they have replaced the
named test and decide together: the tag failed when one of them failed, else is unrun when one is unrun, else passed.
One passing redraft never hides another that fails (27/outcomes-redraft carries `#27.e6116d56` too, and passes on main
whatever 27/redraft-3178's check-run test does). With none, the named file's state
decides. A row **fails** (at this file's assertion) when one of its tags failed; a row with no tag failed and one unrun
is **skipped** with an `INCONCLUSIVE` note (invariant 2: unrun is neither PASS nor FAIL). The implementation must
provide: the named tests passing unchanged, or a redraft folder beside them whose tests carrying the tag all pass.

**AC2 (`provisional.test.ts`).** A real `deep hub run`; #667's agent stand-in whose SessionStart, prompt and first tool
call reach the hub through deep-hook (so no `deep work` run started the session); the agent's own `deep mcp`
`tools/call deep_ask` with `{kind: 'choice', question: 'Which store should the cache use?', options: [redis, sqlite],
recommended: 'sqlite'}`; `events.read` on the socket. The implementation must provide:

1. `deep_ask` returns within 15 s ("at once", with room for a loaded machine; the issue's example returns at once).
2. No error; its value has `status: 'provisional'` and `answer: 'sqlite'` (the recommended option, deliberately the
   second, so a hub that takes the first option or a default fails too), and `ask: 'ask:<26-letter ULID>'`.
3. The record holds that ask's `ask.created` with the question, `provisional: true` and `recommended: 'sqlite'`, and no
   closing event for it: the card stays yours.

## Wrong programs

- **AC1: five twins**, all under `#3178.1821b407` in `twins.json`, so each runs all seven rows. The merge base is no
  wrong program here: the lanes lay the change's test files over it, the change's redrafts among them, and those were
  written to pass on main (`667/`, `27/` and `111/redraft-3178/`); and #111's row passes or fails on main by timing.
  Each twin breaks the criterion of one or more rows, so the named file and every redraft of that criterion fail on
  it, each by its own wrong program (the redrafts' READMEs name the same ones):

  | Twin | File it replaces | Wrong program | Rows it must fail |
  |---|---|---|---|
  | `sends-shown-again` | `packages/hub/src/plant.ts` | the hub acts as that plant always: an answer is sent again on each later route | 667 raised (`#667.b25a1d05` / `#667.8700acae`) |
  | `skip-default-at-deadline` | `plant.ts` | never takes an ask's default at its deadline | 667 fold and plants (`#667.b1086458` / `#667.b9deefc5`, `#667.ca2b4f95` / `#667.47e397e9`), and 27 waits' default test |
  | `repeat-reaches-you` | `plant.ts` | a repeated question skips the resolvers and reaches you | 27 repeat (`#27.6e863673`) |
  | `wake-assumed` | `plant.ts` | the waiter's hand-off is recorded delivered | 27 desktop (`#27.f8331d25`), and 27 waits |
  | `no-rejected-directions` | `packages/hub/src/memory.ts` | `rejectedDirections` answers none: deep_propose of a rejected direction goes to your inbox and rules.json gets no `rejected-*` entry, so deep-hook lets a reviving tool call through | 111 revive (`#111.ddf55f68`), by a proposal or a tool call |

  A plant twin is the base's `plant.ts` with `plantOf` and `activePlant` answering the plant whatever
  `DEEP_HUB_PLANT` says, so a test that sets another plant gets this one too. Which twin fails which row is in
  BASE-RESULTS.txt.
- **AC2: the twin `never-provisional`** (`twins.json`: `#3178.ea90fb17` → `never-provisional`):
  `twins/never-provisional/packages/hub/src/starts.ts` is the base's `starts.ts` with `inWorkRun` answering true for
  every session, so every choice with a recommendation waits on you as a work run's does (#1332), breaking #84's rule.
  It replaces one file whole; laid over a fix that edits `starts.ts`, it also undoes that edit, which keeps it a wrong
  program for AC2.

## Criteria to tests

| Criterion | Test | Fails when |
|---|---|---|
| AC1 `#3178.1821b407` (the five twins above) | `suites.test.ts`, 7 tests, one per row | a tag no candidate passes, whose redraft folders (or, with none, the named file) failed at an assertion; a row whose tags none failed and one is unrun is skipped as INCONCLUSIVE |
| AC2 `#3178.ea90fb17` (twin `never-provisional`) | `provisional.test.ts`, 1 test | `deep_ask` still waits after 15 s, errs, returns another status or answer, names no ask, or the record's ask isn't provisional recommending sqlite, or is closed |

## Readings and assumptions

- "Each named test passes": all tests of the file carrying the tag, at least as many as the table says, read from
  Vitest's JSON report (`assertionResults[].fullName`, `status`). Tags are matched as literal substrings of the full
  name, as the lanes find them.
- "Replaced by a blind redraft": a folder with `redraft` in its path under the suite's folder, **base-held ones
  included** (`667/redraft-2047/`, `27/desktop-redraft-2/`, `111/redraft/`, ...): a redraft at the base that covers the
  criterion and passes meets "replaced by a blind redraft that passes", and refusing it would make later redraft jobs
  duplicate it (AGENTS.md: no duplicate test). A folder, not a file, is the unit: a redraft's `plants.test.ts`, which
  passes on its own wrong program, can't stand in for its `criteria.test.ts` failing. A redraft's own proof (that it
  fails on its criterion's wrong program) is its own lane's question; this file's twins are the wrong programs here.
- **Computed IDs count as the same criterion** for #667, whose earlier tags don't match `criterionId` of #667's body:
  `#667.84442921` = `#667.254d6157` (AC1), `#667.b25a1d05` = `#667.8700acae` (AC2), `#667.ca2b4f95` = `#667.47e397e9`
  (AC4), `#667.b1086458` = `#667.b9deefc5` (AC5), as `667/redraft-1463/README.md` and `667/redraft-2047/README.md` at
  the base map them. #27's and #111's tags are their computed IDs already.
- **Files the lanes run by hand don't stand in**, and don't vote: the lanes never run them, so neither their pass nor
  their failure is proof (`byHand` in the checkout's `scripts/lanes.mjs`, e.g. `27/desktop-redraft/`, and on the change
  `27-redraft-2073/`). The named files are run whatever `byHand` says: the issue names them.
- "BLOCKED" or "INCONCLUSIVE" in a failure's first line marks a test that didn't reach its verdict, including a
  `toThrow` check that got a BLOCKED in place of the planted failure (667/plants.test.ts on main).
- "At once": under 15 s, as #84's suite reads it (`tests/acceptance/84/reach/provisional.test.ts`).
- "A session no work run started": a session the hub knows from hooks only, as #667's stand-in makes it.
- AC2 imports `../667/helpers.ts` rather than copying it: it is the surface the disputed suites use, and AC2 uses only
  its hub, stand-in, `deep_ask` and `events.read` parts, none of which wait on a filed ask.
