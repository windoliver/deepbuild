# Acceptance tests for #1686: the agents' facts are read through `@deepbuild/adapters` alone

Written blind from issue #1686 as the brief handed it (its account, Scope, three acceptance criteria and Proof), the
design and base commit `d303e2b64` ("Merge pull request #3643 …"), by a job that saw no implementation diff, plan,
other branch, worktree, pull request or stash, nor the live issue, and used no network. The implementing agent doesn't
edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). Lean: three
test files, six tests, one shared runner (`run.ts`), no fixture, no mock, no twin.

| AC | ID | File (tests) |
|---|---|---|
| AC1 A test lists every line in a package's `src` outside adapters and the CLI that names the `adapters/` folder by path; fails on the merge base naming the twelve, passes after | `#1686.b9fba25b` | `facts-entry.test.ts` (1): `tests/facts-entry.test.mjs` under `node --test` |
| AC2 `readFacts('loops.facts.json')` equals the file on disk, and `readFacts('../package.json')` is refused | `#1686.0140ed0a` | `facts-entry.test.ts` (2): `readFacts` from `@deepbuild/adapters`, called here |
| AC3 The unit tests of otlp, runner, adapters and the hub's mods pass unchanged, and `node scripts/affected.mjs` shows no new failure | `#1686.1341dfbb` | `unit-tests.test.ts` (3): otlp, adapters, the hub's mods; `runner-unit-tests.test.ts` (1): runner. The `affected.mjs` half is by hand |

The IDs are `scripts/proof-change.mjs`'s `criterionId` (sha256 of the text after `- [ ] `, trimmed, whitespace
collapsed, first 8 hex) over the criteria as the brief gave them, computed here; they match the three the brief
expected. Each test's name starts with its ID.

## What was read

- The issue file; `AGENTS.md`; `docs/technical-design.md`, Who drafts it (How we know version 0 works).
- At the base: `tests/facts-entry.test.mjs`, `tests/adapters.test.mjs`, `packages/adapters/` (`package.json`,
  `README.md`, `src/facts.ts`'s `readFacts`), the test folders of otlp, runner and the hub (`mods.test.ts`,
  `mods-start.test.ts`, `hub.ts`'s `withHub`), `vitest.config.ts`, `tests/vitest-setup.ts`, `scripts/lanes.mjs`
  (`testGlobs`), `scripts/proof-change.mjs` (`criterionId`), `scripts/proof-runs.mjs` (`atAssertion`, `runVitest`,
  `twinsOf`, `TIMEOUT`). Suites `2492/` (shape, running other test files in a child) and `2218/README.md`.

## What each test does

Every judgement is a vitest `expect` in a file here, so a wrong program makes an assertion under the test paths fail,
as `atAssertion` reads it. Sources are the live checkout's: the child runs start in the repo's root, and vitest
resolves `@deepbuild/adapters` to `packages/adapters/src`.

- **`#1686.b9fba25b`** runs `tests/facts-entry.test.mjs`, unchanged, with `node --test` (as the unit lane does) and
  expects that it ran a test and that every test in it passed. A package source outside adapters and the CLI that
  names `adapters/` by path makes that file fail, listing the line, and the `expect` here fails with its output.
- **`#1686.0140ed0a`** imports `readFacts` from `@deepbuild/adapters`, expects `readFacts('loops.facts.json')` to
  deep-equal the parsed `adapters/loops.facts.json` of the checkout, calls `readFacts('../package.json')` in a
  try/catch and expects `refused` to be `true`. No refusal wording is asserted.
- **`#1686.1341dfbb`**, four tests, one per named package: `packages/otlp/test/` and `packages/runner/test/` whole and
  `packages/hub/test/mods.test.ts` through the repo's vitest (root config, JSON report), `tests/adapters.test.mjs`
  through `node --test`. Each expects at least one test ran and none failed, skipped or was left todo; a file that
  failed outside its tests counts as a failed test. A run that wrote no report throws `BLOCKED:`, never passes.

## Readings where the issue leaves a choice

- **"A test lists …"** is `tests/facts-entry.test.mjs`, the file the issue's Proof names; the whole file is judged,
  not one test of it by name.
- **"fails on the merge base naming the twelve"** is not asserted: this base names none (below), and the twelve lines
  exist in no checkout a test here can run. It is for the before lane with a twin.
- **"equals the file on disk"**: deep equality with `JSON.parse` of `adapters/loops.facts.json` in the repo.
- **"the unit tests of adapters"**: `tests/adapters.test.mjs`. `packages/adapters` has no test folder; this is the
  unit test of the repo's `adapters/` folder the package owns. `tests/facts-entry.test.mjs` is AC1's.
- **"the hub's mods"**: `packages/hub/test/mods.test.ts`, which tests `packages/hub/src/mods.ts`, one of the issue's
  twelve places. `packages/hub/test/mods-start.test.ts` is left out: it starts a hub, which needs a built deep-hook,
  and this job was told to run no Rust build. Run alone on this base it failed with "the hub wasn't ready within
  10 s" behind "no deep-hook is built under `<repo>`/target; run cargo build -p deep-hook first": not run, not judged.
- **"unchanged"** is a property of the diff (no edit under `packages/{otlp,runner,hub}/test` or to
  `tests/adapters.test.mjs`), left to review.

## Base results

`BASE-FAILURE.txt` is the run at the base, whole, home written `~` and the checkout `<repo>`: **all six tests pass and
tsc is clean.** The base already holds `4b4e5fd88` ("Test: agents' facts are read through @deepbuild/adapters alone
(#1686)"), `tests/facts-entry.test.mjs` and `readFacts`; no package source outside adapters and the CLI names the
folder by path. So the merge base is the wrong program for none of them, and every tagged test needs a planted twin
for the before lane (not written here): for AC1 and AC3 a package source that reads facts by a path into `adapters/`
or reads another file; for AC2 a `readFacts` that returns other content or doesn't refuse.

| Test | Base |
|---|---|
| `#1686.b9fba25b` tests/facts-entry.test.mjs … passes on this checkout | pass |
| `#1686.0140ed0a` readFacts('loops.facts.json') equals the file on disk, and readFacts('../package.json') is refused | pass |
| `#1686.1341dfbb` the unit tests of otlp pass | pass |
| `#1686.1341dfbb` the unit tests of adapters pass | pass |
| `#1686.1341dfbb` the unit tests of the hub's mods pass | pass |
| `#1686.1341dfbb` the unit tests of runner pass | pass |

One throwaway trial, reverted, not kept: with a line `new URL('../../../adapters/loops.facts.json', import.meta.url)`
added to `packages/otlp/src/index.ts` and `readFacts`'s refusal switched off, `#1686.b9fba25b` failed at its second
`expect` (the child's output naming `packages/otlp/src/index.ts:252`) and `#1686.0140ed0a` at
`readFacts refused ../package.json: expected false to be true`.

## Checked by hand

- **`node scripts/affected.mjs` shows no new failure** (AC3's second half): a whole-repo run of hours, not an
  acceptance test. Run on the change and read by hand.
- **"Unchanged"** and **"fails on the merge base naming the twelve"**, as above.
- Scope lines no criterion states are not tested: runner and otlp declaring `@deepbuild/adapters`, no import cycle.

## Run them

With Node 24.22 (`.node-version`):

```sh
npm ci
npm run build --workspaces
./node_modules/.bin/vitest run --reporter=verbose tests/acceptance/1686
./node_modules/.bin/tsc --noEmit -p tests/acceptance/1686/tsconfig.json
```

About 40 s at a 1-minute load of 30 to 40, nearly all of it runner's unit tests. No network, model call or Rust build.
