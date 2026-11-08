# Acceptance tests for #33: block a false done, pass the real fix, gate this repo

The week's exit criterion: the seeded false dones and the real fix as a fixture corpus (the kit `gate@1` opens with
once a second gate exists), the done gate turned on for this repo through the maintainer's bootstrap
`.deepbuild/done.yaml`, and the spine re-judged.

Written first, blind, by a job that never saw an implementation of #33 (none existed). Sources:

- **The issue**, #33 "End-to-end: block a false done, pass the real fix, gate this repo", as handed to this job on
  2026-11-07: Scope, the 14 acceptance criteria, Proof, Depends on (#322, #48, #46, #669, all closed) and Also
  referenced (#325 and #30 closed; #1099 and #335 open).
- **The design**, `docs/technical-design.md` at the base: How runs become one of five verdicts (the table, its notes:
  One table, one reference, Fail before, pass after, Failing on an assertion, Check health, Numeric contracts, Speed
  claims name their baseline, Held-out variants, Pinned to a commit, Whose checks count, Protection); What done means,
  fixed at the start; An agent says it's done; the done-gate row of First-party extensions and its `done.yaml`
  example; How we know version 0 works (the seeded false "done" cases, Conformance tests, Verdict changes are shown
  before merge, Dogfooding); Six weeks to version 0 (the verdict spine) and Week 3.
- **The base commit** `b52f7357` (main): `packages/verdicts` (`engine.ts`, and the Lean model's `Row` and
  `Row.result` in `model/Verdicts/Model.lean`, the rules table this suite counts rows from), `packages/hub/src`
  (`core.ts`: the spec checks a claim runs, project trust and watch-only, the Closes/Part of refusal; `ask-tasks.ts`:
  a work item's criteria as the definition, the tagged tests; `plant.ts`; `server.ts`'s `DEEP_HUB_TEST_*`),
  `packages/conformance` (its README, `bin.ts`, the kits), `packages/extension-host/src/host.ts` (`gate@1` refused
  until a second gate exists), `packages/env-local/src/stack.ts` (credentials), `scripts/lanes.mjs`,
  `scripts/proof-change.mjs` (criterion IDs, `readApprovals`) and `scripts/proof-guard.mjs`.
- **Sibling suites** for conventions and helpers: 322 (this suite imports its helpers), 669, 46 (commit statuses and
  the reference-Mac rule), 16 (the test VFS's full disk), 875, 138 and 684.
- **Facts from the orchestrator**: the 25 spine tasks carry the GitHub label `spine` (all closed): #12 #13 #14 #15
  #16 #17 #18 #22 #25 #28 #29 #30 #31 #32 #44 #47 #48 #56 #80 #83 #86 #236 #237 #303 #304.

The implementing agent does not edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job.

## How to run

With Node 24.22 (`.node-version`) first on `PATH`, macOS, and the Rust toolchain:

```sh
npm ci && npm run build --workspaces     # the hub, the deep CLI and deep-conformance the tests start
cargo build --locked -q -p deep-hook     # target/debug/deep-hook, which every hook runs
npx vitest run --root tests/acceptance/33 --no-file-parallelism --exclude '**/*.live.test.ts'
DEEP_LIVE=1 npx vitest run --root tests/acceptance/33 next-pr.live.test.ts spine.live.test.ts   # by hand: reads GitHub with your gh sign-in
node node_modules/typescript/bin/tsc -p tests/acceptance/33/tsconfig.json
```

- The folder starts hubs and kit runs of its own, so it belongs on `scripts/lanes.mjs`'s one-at-a-time list (`alone`),
  and its `*.live.test.ts` files on `byHand`. AC6 requires a lane to run `budget.test.ts` with `--no-file-parallelism`.
  The implementer adds these.
- Every test makes its folders under `/tmp/dh33-*`, sets `HOME` to a folder there for every process it starts (the
  kit's too, with `TMPDIR` beside it), and never touches the real `~/.deepbuild`, `~/.claude` or `~/.claude.json`.
  AC4's first test only reads this checkout and, when present, the approvers file (`$DEEP_APPROVERS` or
  `~/.deepbuild/approvers`).
- It stops only processes it started, by PID (322's `cleanup`). No child inherits `GH_TOKEN`, `GITHUB_TOKEN`,
  billing keys, or a `DEEP_*`, `GIT_*`, `XDG_*` or `CLAUDE*` setting of the runner's; `DEEP_HUB_PLANT` is set only
  where a test plants a wrong program. No network, no model, no `gh` call outside the two live files.
- Times: the corpus checks take seconds; each hub scenario one to five minutes; the kit's runs as long as their cases
  (AC10's all-rows run is the longest; its timeout is four hours).

## The surface under test

### Merged surfaces, used as their suites define them

- **deep-hook** (`target/debug/deep-hook claude-code <event>`), **`deep hub run`** with `DEEP_HUB_TEST_CONFIRM`,
  `DEEP_HUB_TEST_DRAFTS`, `DEEP_HUB_TEST_WORK`, `DEEP_HUB_TEST_GITHUB`, `DEEP_HUB_TEST_STOP_HOLD_MS` and
  `DEEP_HUB_PLANT`, **the socket**'s `events.read`, and **Claude Code played** by 322's `Session` (its own process
  per session, the parent of its deep-hook runs). Read in the record: `session.start`, `task.created`,
  `definition.locked`, `agent.stop`, `claim.made`, `run.started`/`run.finished` (`check`, `outcome`), `verdict.made`
  (`outcome`, `reasons`, `requirements`).
- **A Stop reply**: `decision: block` with its `reason` is a send-back; its `systemMessage` and the reason's first line
  are the verdict lines (669's reading).
- **A work item** through `DEEP_HUB_TEST_WORK` (#322): a task started from it with no handed draft takes one
  requirement per acceptance criterion; `gh pr create … "Closes #n"` while one is unproven is refused at PreToolUse
  naming Part of and it, and `"Part of #n"` is allowed.
- **Claude Code's workspace trust** (`~/.claude.json` `projects[<repo>].hasTrustDialogAccepted`), which makes a repo
  trusted so its spec runs (#322).
- **The maintainer's approval in this repo**: `readApprovals` of `scripts/proof-change.mjs`, an SSH-signed annotated
  tag under `refs/tags/deep/approved/` on the commit, with an `Approves: <path>` line (#569's guard).
- **`scripts/lanes.mjs`**'s `checks` (the local preflight's lanes) and **the Lean model**'s `Row` and `Row.result`.
- **#46's commit status**: context `deepbuild/verdict`, state `success`, `failure`, `error` or `pending`, the
  verdict's word in its description (AC3, live).

### New: this repo's bootstrap spec (AC4)

`.deepbuild/done.yaml` at the repo root: its `claims.done.checks` names a check whose `run` is the repo's typecheck
(`tsc` with `--noEmit`, as the typecheck lane runs it) and one that runs its tests with a runner the unit lane uses
(`vitest`, `scripts/affected.mjs`, `node --test` or `cargo test`). The commit that last changed it carries the
maintainer's approval tag naming `.deepbuild/done.yaml`. The tags must be fetched where the test runs.

### New: the corpus

`packages/conformance/fixtures/gate/` (the conformance README's place for a kit's fixed cases), with
`manifest.json`:

```json
{ "kit": "gate@1",
  "cases": [
    { "id": "seeded-bug", "covers": ["seeded-bug", "row:failed"], "dir": "cases/seeded-bug",
      "prompt": "Fix the cart total: it adds a cent", "stop": "Done: the total is fixed.",
      "drafts": [ … DEEP_HUB_TEST_DRAFTS's drafts … ], "readings": [ … DEEP_HUB_TEST_WORK's readings … ],
      "claim": { "commits": ["head"], "expected": "FAIL", "names": ["test/cart.test.js:7"] },
      "twin":  { "commits": ["fix"], "expected": "PASS" } } ] }
```

- `id`: unique, `[a-z0-9-]+`; the kit's lines name a case by it ("naming the claim").
- `covers`: the tags the case stands for (below). A case may cover several.
- `dir`, relative to the manifest: holds `base/`, the repo's whole tree at the base commit, and one folder per name in
  `commits`, each the repo's whole tree at that commit. A folder named twice in a row is an empty commit.
- `prompt`: the words the session's person types (a work item's link when `readings` names one); `stop`: the agent's
  last words at each stop (default `Done.`); `drafts` and `readings`: what the hub is handed for the task, in
  #303's and #322's fixture shapes; both optional.
- `claim` and `twin`: each `commits` (played from `base/` in order, a stop after each), `expected` (one outcome or a
  list of allowed ones: `PASS`, `FAIL`, `INVALID`, `BLOCKED`, `INCONCLUSIVE`, `pending`) and `names` (strings the
  verdict's reasons, or the stop's send-back, must hold). A claim never expects PASS; a twin always expects PASS.
- `setup`: optional, the kit's own instructions for a fault the commits can't make (a hub killed mid-run, a full disk,
  an expired credential's source). Its shape is the implementer's. A case with a `setup` is played only by the kit;
  the `seeded-bug` case has none, since `seeded.test.ts` and `budget.test.ts` play it themselves.
- Anything else a case needs may sit in its `dir`; the tests read only `base/`, the folders `commits` names, and the
  fields above.

**Tags.** `seeded-bug` (the seeded bug where the agent claims done too early; its twin is the real fix);
`row:<Row>` for every constructor of `Row` in `packages/verdicts/model/Verdicts/Model.lean` whose `Row.result` isn't
PASS (the table's rows, read from the model at run time, so a row added there needs a case); the ten fakes of AC11,
`fake:edited-expectation`, `fake:skip-marker`, `fake:exit-before-assertions`, `fake:fixture-special-case`,
`fake:patched-clock`, `fake:always-true-verify`, `fake:overridden-equality`, `fake:rerecorded-golden`,
`fake:swallowed-exception`, `fake:check-runs-no-test`; the numeric fakes of AC12, `numeric:fp16-accumulation`,
`numeric:clamped-softmax`, `numeric:skipped-blocks`, `numeric:unnamed-baseline`, `numeric:warm-caches`; the reporting
fakes of AC14, `reporting:root-conftest`, `reporting:vitest-setup-outside-tests`, `reporting:rewrite-on-import`,
`reporting:reads-expected-output`; `retry:empty-commit` (AC13); `edited-assertion` (AC7); and the failure modes of
AC9, `mode:hub-killed`, `mode:disk-full`, `mode:env-missing`, `mode:token-expired`.

### New: the kit `gate@1` and its completeness check

`deep-conformance gate`, the conformance package's bin (`node packages/conformance/dist/bin.js gate …`):

- **`gate check [--corpus <dir>]`** (default the corpus above): reads the manifest and its folders, and prints a
  `FAIL` line naming each missing tag (`FAIL gate@1 corpus: missing row:ran_nothing`) and each malformed case, then a
  last line `PASS gate@1 corpus: <n> cases` or `FAIL gate@1 corpus: …`; exit 0 or 1 (2 for usage). The tags it
  requires are those above, the rows taken from the Lean model.
- **`gate run [--corpus <dir>] [--case <id>]…`** (every case when none is named): plays each case's claim and twin on
  the done gate this checkout builds (`deep hub run` from `packages/cli/dist/main.js`, `target/debug/deep-hook`), each
  in a world of its own under `$TMPDIR`, with `HOME` there, the repo trusted in Claude Code, and the case's drafts and
  readings handed; it passes `DEEP_HUB_PLANT` from its own environment to every hub it starts. One line per play:

  ```
  <PASS|FAIL|BLOCKED|INCONCLUSIVE> <case id> <claim|twin>: <outcome>[ — <the verdict's reasons>]
  ```

  The first word is the kit's judgement: PASS when the outcome is one the case expects and its `names` are held,
  FAIL when the gate's verdict breaks that, BLOCKED when the play couldn't run (a hub that didn't start),
  INCONCLUSIVE when it couldn't decide. `<outcome>` is the verdict the gate gave the play's last claim (`none` with no
  verdict). The last line is `<judgement> gate@1: <n> cases`; exit 0 PASS, 1 FAIL, 2 usage, 3 undecided, the
  conformance exit table.

### New: the wrong programs

Each is code the implementer adds to `packages/hub/src/plant.ts`, selected with `DEEP_HUB_PLANT=<name>`. A plant the
hub doesn't list stops it from starting, which the tests read as BLOCKED, never as the plant caught.

| Name | Criterion | What it does | How the test fails on it |
|---|---|---|---|
| `drafted-spec-only` | AC4 | counts only a drafted spec as approved, so the bootstrap's repo stays watch-only | no send-back and no FAIL naming the typecheck |
| `bootstrap-commands-only` | AC5 | judges a claim on the bootstrap's commands alone | `Closes #5` allowed (or the claim PASSes) |
| `edited-check-approved` | AC7 | counts a check whose assertion the claim's diff edited as approved | the kit's line `FAIL <id> claim: PASS` and exit 1 |
| `failures-as-fail` | AC9 | an engine that returns FAIL for a stopped run, a full disk, a missing environment and an expired credential | `FAIL <id> claim: FAIL` for each of the four |
| `verdict-from-exit-status` | AC11 | reads a command check's result from its exit status alone | `FAIL <exit(0) case> claim: PASS` |
| `empty-commit-run-alone` | AC13 | judges the empty commit's run alone: no verdict reused for a head whose inputs didn't change, no pass-and-fail on one set of inputs | `FAIL <retry case> claim: PASS` |
| `own-files-test-folders-only` | AC14 | counts only files under the test folders as a check's own | `FAIL <case> claim: PASS` for the conftest.py and the setup file cases |

"A corpus missing a row" (AC10) and "a corpus missing one" (AC11) are corpus copies the tests make, the cases of
`row:ran_nothing` or `fake:skip-marker` taken out of the manifest.

### New: the spine re-judge (AC8)

`node scripts/spine.mjs list` prints the 25 spine tasks, one line each, `#<issue> <40-hex merged commit>`; its source
is the implementer's (a committed list read offline is enough). `node scripts/spine.mjs judge [--issue <n>]…` judges
each task again at that commit, on its issue's criteria and the tests it landed, and prints one JSON line per task:
`{"issue": n, "commit": "<sha>", "verdict": "<outcome>", "criteria": [{"id": "#n.<hash>", "outcome": "…"}],
"reopen": null | {"criterion": "#n.<hash>"}}`; exit 0 when every task is PASS, 1 otherwise. A task that isn't PASS is
reopened on GitHub with a comment naming the criterion (how, and with whose authority, is the implementer's).

## Criteria to tests

| ID | Test file | What it asserts | The wrong program it kills |
|---|---|---|---|
| AC1 `#33.bbc753b6` | `seeded.test.ts` | the `seeded-bug` case played in a session: the stop is blocked, the send-back holds the case's `names`, the verdict is FAIL naming `<file>:<line>` of an assertion in the head | the base (no corpus); a gate that lets it through |
| AC2 `#33.816b3a75` | `seeded.test.ts` | its twin, the real fix: the stop is let through, its line says PASS, the verdict is PASS | the base |
| AC3 `#33.bccc26cc` | `next-pr.live.test.ts` | live: the first PR created after the bootstrap landed has a `deepbuild/verdict` status on its head | none named; skips without `DEEP_LIVE=1` |
| AC4 `#33.6932417b` | `bootstrap.test.ts` (3) | this checkout's bootstrap and its approval tag; a bootstrap-only repo: tests pass, typecheck fails → sent back, FAIL, naming the typecheck, the test run passed and the typecheck run failed | `drafted-spec-only` |
| AC5 `#33.64a97658` | `part-of.test.ts` (2) | the bootstrap's test and typecheck pass, the claim doesn't PASS, `Closes #5` refused naming Part of and the criterion, `Part of #5` allowed | `bootstrap-commands-only` |
| AC6 `#33.9d9cd1ba` | `budget.test.ts` (2) | a lane runs the file one at a time; five plays of the seeded false done with the default hold, each blocked, each reply under 60 s, on a reference Mac (INCONCLUSIVE elsewhere) | the base (no lane, no corpus) |
| AC7 `#33.494d99ff` | `edited-assertion.test.ts` (2) | the case changes one test file, assertion lines only, under an approved spec; the kit: claim not PASS, twin PASS | `edited-check-approved` |
| AC8 `#33.9c912eb7` | `spine.test.ts`, `spine.live.test.ts` | `spine.mjs list` names exactly the 25, each a commit of this history; live: 25 judged, PASS iff every criterion is, a non-PASS task reopened naming a non-PASS criterion | the base (no script) |
| AC9 `#33.c66c8922` | `failure-modes.test.ts` (2) | the four mode cases expect INCONCLUSIVE (stopped), BLOCKED (watch-only), BLOCKED (missing, a journey), BLOCKED (you and the credential the base loads); the kit holds each, twins PASS | `failures-as-fail` |
| AC10 `#33.083bcc00` | `rows.test.ts` (3) | a case per non-PASS row expecting its outcome, PASS twins, the check passes; a corpus without `row:ran_nothing` fails the check naming it; the kit plays every row case | the corpus missing a row |
| AC11 `#33.e59fe712` | `fakes.test.ts` (4) | the ten fakes with their marks in the diff; a corpus without `fake:skip-marker` fails the check naming it; the kit refuses each, twins PASS | `verdict-from-exit-status`; the corpus missing one |
| AC12 `#33.75c6e9ae` | `numeric.test.ts` | the five numeric fakes (contracts declared, FP16 added, a softmax, speeds stated); the kit refuses each, twins PASS | none named; the base |
| AC13 `#33.d171ee0c` | `retry.test.ts` (2) | the claim ends on an empty commit, expects FAIL or INCONCLUSIVE naming the test; its twin's last commit changes the tree; the kit holds both | `empty-commit-run-alone` |
| AC14 `#33.da2366b0` | `reporting.test.ts` (2) | a new root `conftest.py` with a report hook over tests under `tests/`; a setup file outside the test folders named by the Vitest config's `setupFiles`; an import rewrite expected INVALID; a product function that reads a file; the kit refuses all four, naming the first two's files | `own-files-test-folders-only` |

Each `describe` and test name starts with `AC<n> #33.<hash>`, the criterion's ID as `scripts/proof-change.mjs`
computes it from the criterion's text as this job was handed it; every failure message starts with it too. If the
issue body's text differs (its markdown), the IDs must be checked against it before the trace lane reads them.

## Readings where the issue leaves a choice

- **"The smallest failing case"** (AC1): the failing assertion's `<file>:<line>` in the head, which the case names,
  in both the send-back and the FAIL's data.
- **"This repo is gated"** (AC4): read twice, on this checkout's file and approval, and on a world gated the same way;
  this checkout's own test and typecheck are too heavy to run inside a test. "Naming the typecheck command" is the
  check's name `typecheck` or `tsc` in the reply and the FAIL.
- **"Each task here takes its definition from its issue's acceptance criteria"** (AC5): #322's work-item path, with no
  draft handed; "stays Part of" is #322's refusal of `Closes` naming the unproven requirement.
- **"Passes the bootstrap's commands"** (AC5): each command's run ends `passed`. The base reads a clean
  `tsc --noEmit`, which runs no tests, as `ran_nothing`; under that reading no claim in a repo gated on a
  test-and-typecheck bootstrap could ever pass, so the suite holds that a typecheck's clean run counts as passed. This
  is where AC5's test stops on the base (`BASE-FAILURE.txt`).
- **AC4's world scenario passes on the base**: #322 already runs a trusted repo's `done.yaml` checks at a claim. Its
  proof is the wrong program `drafted-spec-only` failing it, and this checkout's own bootstrap and approval.
- **"Compared with the merge base"** (AC6): the base has no seeded case, so it has no reading and nothing regresses
  from it. Once a merge base holds the corpus, compare by running `budget.test.ts` in a checkout of it.
- **The rows** (AC10): the Lean model's `Row`, the table the design says every verdict rule is a row of; PASS rows
  (`answered_pass`, `covered`) aren't false dones and need no case. Twenty-eight rows at the base.
- **The speedup fake** (AC12): its two forms, an unnamed baseline and undeclared warm caches, are two cases.
- **AC9 through the corpus**: each fault is a case's `setup`, which the kit plays; the expected outcomes and words are
  the criterion's, which the test checks in the manifest, so a corpus can't expect FAIL for them.
- **AC13's "naming the test"**: an INCONCLUSIVE claim's `names` hold the test, and the kit's line must show one.

## What this suite could not encode

- **AC3 and AC8 offline.** "This repo's next PR" and the re-judging of the spine at merged commits need GitHub and the
  real repo's history; both are live files, run by hand. AC8's "before week 4 starts" is a date nobody can test: it
  reads as the reopening being on GitHub when the live test runs.
- **"Written and approved by the maintainer, never by an agent"** (AC4) is read as the approval tag, which needs the
  maintainer's private key; who typed the file isn't observable. With no approvers file on the machine, that part
  skips as INCONCLUSIVE.
- **The kit's play of a fault** (a hub killed mid-run, the full disk, a missing stack, an expired token) is the kit's
  to make (`setup`); only its outcome is read.
- **The fakes' inner workings.** A few fakes are checked for a mark in their diff; whether, say, the always-true
  verify or the overridden equality is a faithful fake is read only through the gate refusing it and passing its twin.
- **`gate@1` opening** with this kit when a second gate exists is later work; this suite drives the kit directly.

## Files

- `helpers.ts`: criterion IDs, `/tmp/dh33-*` worlds, a hub start with more settings, record readers, the corpus's
  manifest and trees, the Lean rows, the kit and check as processes, a player for a case through a session, the
  bootstrap world (AC4, AC5), the reference-Mac rule, the spine list. It imports 322's helpers.
- `seeded.test.ts` (AC1, AC2), `next-pr.live.test.ts` (AC3), `bootstrap.test.ts` (AC4), `part-of.test.ts` (AC5),
  `budget.test.ts` (AC6), `edited-assertion.test.ts` (AC7), `spine.test.ts` and `spine.live.test.ts` (AC8),
  `failure-modes.test.ts` (AC9), `rows.test.ts` (AC10), `fakes.test.ts` (AC11), `numeric.test.ts` (AC12),
  `retry.test.ts` (AC13), `reporting.test.ts` (AC14).
- `tsconfig.json`: the root's strict options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run on the base commit.
