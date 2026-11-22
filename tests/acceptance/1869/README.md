# Acceptance tests for #1869: a failed or stuck git read of what a claim changed never lets an edited check count as approved

Written first and blind, at base commit `2eaaeb0e6693410db653a43377ec32dde1cc63ab` (origin/main, "Merge pull request
#3081 …"), from issue #1869 (its account of the bug, Scope, both acceptance criteria and Proof), the design and the
base, before any implementation. The drafting job saw no fix, diff, other branch, other worktree or pull request. The
implementing agent does not edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding). There is no taste criterion, so no `TASTE.json`, and no planted twin: for a fix the merge base is the
wrong program (design: Wrong programs).

## What was read

- **The issue**: #1869, as `gh issue view 1869` gives it.
- **The design**, `docs/technical-design.md` (`node scripts/design-section.mjs --issue 1869`): How runs become one of
  five verdicts, Whose checks count; in How we know version 0 works, Criteria to tests and Wrong programs; Dogfooding.
- **The base code, to learn how to drive it**: `packages/hub/src/gate-runner.ts` (`changesOf`: `git diff --name-only
  --no-renames <base>`, `git ls-files --others --exclude-standard`, `git ls-files`, `git show <base>:package.json`, each
  failure read as an empty list, no deadline; `stop`, which awaits those reads before the claim is registered;
  `verdictOf`, whose reasons carry "<check> counts as the agent's own: …"), `packages/gate/src/own.ts` (`ownChanges`),
  `packages/gate/src/checkouts.ts` (the snapshot's own git: `runGit`, its `-c core.fsmonitor=false`, its environment
  with `GIT_NO_LAZY_FETCH=1`, its `ls-files` calls, all short-option forms with `-z`), and
  `packages/hub/src/core.ts` (`budget_ms: 10_000`, `hold_ms: STOP_HOLD_MS`).
- **Sibling suites, for their conventions and helpers**: tests/acceptance/2699 (README, bench, tsconfig), 2118 and 2647
  (`gate.ts`, the gate runner on a bench with #31's real base-commit service), 33 and 31 (the world and git helpers).

## The surface under test

**The hub's own `GateRunner`** (`packages/hub/src/gate-runner.ts`, through its public `stop` and `verdictOf`, and the
`invalid` callback it is given, where it hands a claim's verdict when it judges one without its checks), given what
`core.ts` gives it, on a bench (`gate.ts`) built as #2118's and #2647's are:

- **Real**: the gate runner and its `changesOf`; the base-commit service (`openCheckouts` through #31's `openWorld`), so
  the snapshot and the checkout are real git; the record; a real repo; the check's program, a node script run in the
  checkout the gate names.
- **Standing in**: the hub's run service at `start` and `ended` (as in #2118 and #2647), and git at the process
  boundary (below). No mock of anything DeepBuild owns.

## How git is stubbed

A `git` shell script in a temp folder is put first on `PATH` for the test's own process (the gate runner and the
base-commit service run in it), restored at close. It runs the real git (`command -v git`, resolved before) for every
call, except in the claim's worktree (`pwd -P` equals the repo's folder) while a mode is set:

- **`fail-diff`** (AC1): every `git diff` exits 128 with a `fatal:` line. On the base neither the snapshot nor the
  checkout makes a `git diff` (checkouts.ts's only one is the carry's, two commits, never reached by a first claim);
  were a snapshot to fail on it, the test reports BLOCKED.
- **`hang-ls-files`** (AC2): every `git ls-files` execs `sleep 600` (its PID is logged and the bench kills it by PID at
  close), **except the base-commit service's own**. Those are told apart by what the base's public behaviour shows of
  them: each carries a short-option cluster other than a lone `-z` (`-v`, `-o`, `-oi`, `-co`) **and** the environment
  `runGit` always sets (`GIT_NO_LAZY_FETCH=1`). The gate runner's reads of what a claim changed on the base
  (`ls-files`, `ls-files --others --exclude-standard`) have neither; a fix that adds `-z`, `-c core.fsmonitor=false`,
  `--cached` or a bigger buffer is still stubbed, and so is one that switches to short options without that
  environment, or the environment without short options. Only a read that copies both the service's shape and its
  environment would slip past; then the snapshot's reads would hang too and the test would say so (BLOCKED on a
  "snapshot over budget" verdict), never pass. The service's untracked count (`ls-files -o --exclude-standard -z`, run
  only past its budget, with its own timeout) would hang under the stub, harmlessly: it then reads "?".

The subcommand is the first argument that is not an option or the value of `-c`/`-C`/`--git-dir`/`--work-tree`.

## The scenario

The merge base (`main`) holds `src/price.cjs` and an **approved** definition check, `price-approved` (`approved:
sha256:<its test's bytes>`, `node test/price.check.cjs`, `on_base: passes`, `expected_ms: 1`, so it runs in the fast
lane with no merge-base run). Its run reads `src/price.cjs` and `test/price.check.cjs`. The session works on a branch
cut from `main` and **edits the approved check's test file** (one more comment line; the check still passes).

## Criteria to tests

| Criterion | ID | Test | What it asserts | On the base |
|---|---|---|---|---|
| AC1 | `#1869.2a6f926a` | `failed-diff.test.ts` | *Precondition, no stub*: the claim is not PASS and a reason names `price-approved` and `test/price.check.cjs` (it counts as the agent's own), else BLOCKED. *Then, a fresh bench with `fail-diff`*: the stub failed at least one `git diff` (else BLOCKED); the claim's verdict (`verdictOf`) is not PASS; one of its reasons names `price-approved` and the failed diff (`/\bgit diff\b\|\bdiff\b/i` and `/fail\|error\|could ?n[o']?t\|unread\|exit\|fatal/i`) | **fails**, naming the check: the claim reads PASS "as if it changed nothing" |
| AC2 | `#1869.c671af33` | `hung-ls-files.test.ts` | With a stop hold of 15 s and `hang-ls-files`, the stop is not awaited; from `stopAt` the verdict is read every 50 ms (`verdictOf` past pending, or what `invalid` was handed for the claim) until `stopAt + 15 s`. A verdict came (and before the hold ended), it is not PASS, and one of its reasons names `ls-files` and that it timed out (`/tim(e\|ed)[ -]?out\|deadline\|took longer\|too long\|past\|over ?ran\|hung\|stuck\|no answer\|never (returned\|ended\|answered)/i`) | **fails**: no verdict before the hold ends (the stop waits on the hung read; the claim is never registered) |

Each ID is `#1869.` and the first 8 hex digits of the SHA-256 of the criterion's text, trimmed, white space collapsed
(`scripts/proof-change.mjs`), checked against the issue's body.

## Where the issue leaves the interface open

- **Wording.** The tests assert only the check's name and that a reason names the read and its failure or timeout,
  with the tolerant patterns above; never the exact text, nor whether git's own stderr is quoted.
- **Where the verdict comes from (AC2).** A fix may judge the claim through `verdictOf` (the check counting as the
  agent's own) or hand it to `invalid` (a claim-level INCONCLUSIVE, say); both are what the hub shows, so either counts.
  A pending verdict is no verdict.
- **The deadline (AC2).** Scope says each read's deadline falls inside the stop hold; the runner is given its hold as
  `hold_ms`, so the test gives 15 s (core.ts's real hold is 60 s, its snapshot budget 10 s, kept here). A fix whose
  deadline is a constant longer than the hold it is given fails, as it should.
- **Whether the check still runs after a failed read (AC1).** Not asserted: only the verdict is.
- **The 64 MB versus 256 MB output cap and fsmonitor** (Scope) have no criterion and are not encoded.

## How to run

With Node 24.22 first on `PATH` and the workspaces built (`npm run build --workspaces`, for `@deepbuild/config-eval`,
which `vitest.config.ts` loads, and `packages/evidence/dist/patterns.json`):

```sh
npx vitest run tests/acceptance/1869 --reporter=verbose
node node_modules/typescript/bin/tsc -p tests/acceptance/1869/tsconfig.json
```

- No hub, no hook and no Rust build: the tests start only git, the stub's `sleep` and node.
- Every folder is #31's, under `/tmp/dh31-*`, removed after the file; `HOME` is a temp folder (#31's helpers).
- No network, no model. Fixtures use synthetic identities only (`T <t@example.test>`, #31's).

## Files

- `gate.ts`: the bench (the gate runner, the real base-commit service, the run service's stand-in, the git stub), the
  repo and the approved check.
- `failed-diff.test.ts`: AC1.
- `hung-ls-files.test.ts`: AC2.
- `tsconfig.json`: the root's strict options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run on the base commit.
