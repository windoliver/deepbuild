# Acceptance tests for #821: lane paths that match what their scripts read

These tests were drafted blind from issue #821 (its text as of October 30, 2026), `docs/technical-design.md` (How we know version 0 works: The verdict table, proved; Where each layer runs) and the base commit `ff81b0d2`, which has no fix. Per AGENTS.md, the implementing agent doesn't edit them. A dispute goes to a blind redraft by this job.

## Run

```sh
node --test 'tests/acceptance/821/*.test.mjs'
```

`node --test tests/acceptance/821/` doesn't work on Node 23: it treats the folder as one test file. You need git and Node only: no `node_modules`, no Lean, no network. The suite takes about 5 to 15 seconds. Each test builds its own scratch git repositories under the system temporary folder (realpathed) and removes them afterwards. Nothing is written into this checkout. On the base, 8 of the 13 tests fail, each for the expected reason. The other 5 are guards that pass on the base by design. `BASE-FAILURE.txt` shows the run.

## Surfaces

- **`scripts/lanes.mjs`'s exported `checks` and `runLanes`.** They run in a child `node --input-type=module -e` process whose cwd is a scratch repository, as `runLanes(lanes, { cwd: process.cwd() })`. The result is awaited, so `runLanes` may stay synchronous or become async. `DEEP_PREFLIGHT` is unset, which makes this the local preflight. Git in the child sees no user or system config, and can't climb above the scratch folder.
- **The real lanes**, looked up by name in `checks`: `config eval` and `verdict proofs`. Each is passed as `{ ...lane, commands: [[node, '-e', 'console.log("STUB RAN <name>")']] }`. Only `commands` is replaced. Every other field, `paths` included, is the lane's own, and that is what's under test. So no replay and no Lean build runs. Whether a real lane runs or skips must follow from its own fields other than `commands`.
- **Output lines.** A lane ran when runLanes printed `RUN <name>` (and the stub's line). It skipped when runLanes printed `SKIP <name>: …` and the stub didn't run. Exactly one of the two must print.
- **The scratch repository.** Its base commit holds one file of each kind the two scripts read, plus `docs/notes.md`, which neither reads. `refs/remotes/origin/main` points at that commit, and HEAD is on a branch `change`. A test's change is committed on `change`, or left uncommitted, or left untracked, as each test says.
- **A lane script's `inputs` export (AC3; see below).** The module is imported in a child process, and its exported `inputs` is called on each probe path.

## AC3: the surface chosen, and why

AC3 asks for two things. A lane's paths come from "the same predicate its script judges by". And "a planted lane whose paths miss a file its script reads fails, naming the lane and the file". Checking the second requires the script's predicate to be reachable apart from the lane's paths. Otherwise nothing could tell that a planted lane's paths miss a file. The tests read it from the script itself, as the narrowest contract the issue implies:

1. **A lane script exports its input predicate as `inputs`**, a function `(file: string) => boolean`. It takes a path relative to the repository root, `/`-separated, as `git diff --name-only` prints it, and returns `true` when the script reads that file as its input. `scripts/config-eval.mjs` and `scripts/verdict-proofs.mjs` must export it. Importing either module must not throw, and its `inputs` must agree with the probe table below. Importing must also not start the lane: make the command-line entry run only when the file is the process's main module. Today config-eval.mjs's `CONFIG` is that predicate for config eval. For verdict proofs it is the model, the engine, the toolchain pin and the lane's own script.
2. **A lane's script** is the first argument in its commands that matches `^scripts/[^/]+\.mjs$`, resolved against runLanes' `cwd`. For `config eval` that is `scripts/config-eval.mjs`. For `verdict proofs` it is `scripts/verdict-proofs.mjs`. vitest is never the script. The planted lane's only command is `['node', 'scripts/planted-reader.mjs']` (the tests turn `node` into `process.execPath`).
3. **A planted lane whose paths miss a file its script reads fails in runLanes, the local preflight.** The test plants the lane `{ name: 'planted reader', paths: ['AGENTS.md'], commands: [['node', 'scripts/planted-reader.mjs']], fix }`, whose script exports `inputs = (f) => f === 'AGENTS.md' || f === 'sub/AGENTS.md'`. The change adds an untracked `sub/AGENTS.md`. runLanes must then:
   - print a line that starts with `FAIL ` and contains both `planted reader` and `sub/AGENTS.md` (for example `FAIL planted reader: its paths miss sub/AGENTS.md, which scripts/planted-reader.mjs reads`, in the `<STATE> <lane>: <reason>` summary that runLanes already prints),
   - return 1,
   - and print no `PASS planted reader`.

   Whether it prints a `SKIP` or `RUN` line first is left open. A check run on the change's files is enough, and so is a stricter one, as long as the twins below hold.
4. **The twins, which must not fail.** First, the same script with `paths: ['AGENTS.md', 'sub/AGENTS.md']` and the same change: it prints `RUN planted reader`, runs the script, prints `PASS planted reader` and no `FAIL ` line, and returns 0. Second, that lane with a change to `docs/notes.md` only: it prints `SKIP planted reader: …` and no `FAIL ` line, and returns 0. The twins use array paths, so either a list of patterns or a predicate passes them.

I chose runLanes as the place where the planted lane fails because the issue says the lane fails, and in this repository a lane fails in runLanes' summary. The issue names `runLanes()` and `covers()` as the code at fault. The script's `inputs` export is the least it takes for anything to know what a script reads. The other options I weighed were a separate lint over `checks` and a `--inputs` mode on each script's command line. Each would add more surface for the same proof.

AC3's real-lane half runs on behavior, not on how `paths` is written. For each probe below, a scratch change touches that one file. Both real lanes then run through runLanes with stubbed commands, and their RUN or SKIP must match the table. The third test also lists every lane in `checks` that has `paths`. For each one it reads its script's `inputs`, and requires runLanes to RUN that lane on a probe exactly when `inputs` says the script reads it. So a lane added later is held to the same rule.

| Probe (the change touches only this file) | config eval | verdict proofs |
|---|---|---|
| `crates/deep-app/AGENTS.md` (new) | RUN | SKIP |
| `packages/cli/CLAUDE.md` (edited) | RUN | SKIP |
| `AGENTS.md`, `CLAUDE.md` | RUN | SKIP |
| `skills/x/SKILL.md`, `.claude/settings.json`, `.codex/config.toml` | RUN | SKIP |
| `lean-toolchain` | SKIP | RUN |
| `scripts/verdict-proofs.mjs` | SKIP | RUN |
| `packages/verdicts/src/x.ts`, `packages/verdicts/model/X.lean` | SKIP | RUN |
| `docs/notes.md` | SKIP | SKIP |

The SKIP cells are part of the contract: a lane that runs on every change would "never skip a file its script reads" and still break the local preflight's design. The table has no row for `scripts/config-eval.mjs` or `tests/acceptance/684/**`, because the issue doesn't say whether those are their lanes' inputs.

## Criteria and tests

| Acceptance criterion | Tests (file: name) | Base |
|---|---|---|
| AC1: a nested `AGENTS.md` or `CLAUDE.md`, added or edited, runs config eval; `docs/notes.md` still skips it | config-eval: *a committed new crates/deep-app/AGENTS.md runs the config eval lane*; *an uncommitted new crates/deep-app/AGENTS.md runs the config eval lane*; *an edit to a nested packages/cli/CLAUDE.md runs the config eval lane*; *a change to docs/notes.md alone still skips the config eval lane, and the root AGENTS.md still runs it* | first three fail (SKIP); the fourth is a guard and passes |
| AC2: `lean-toolchain` or `scripts/verdict-proofs.mjs` runs verdict proofs | verdict-proofs: *a Lean toolchain bump in lean-toolchain runs the verdict proofs lane*; *a change to scripts/verdict-proofs.mjs runs the verdict proofs lane*; *the engine and the model still run the verdict proofs lane, and docs/notes.md skips it* | first two fail (SKIP); the third is a guard and passes |
| AC3: paths from the script's predicate; a planted lane missing a file fails naming lane and file | predicate: *a planted lane whose paths miss a file its script reads fails, naming the lane and the file*; *on the probe set, config eval and verdict proofs run exactly for the files their scripts read*; *each lane script exports the inputs predicate it judges by, and every lane with paths agrees with it* | all three fail |
| AC4: a lane that can't work out the change's paths runs | unknown-change: *with no origin/main, both path-gated lanes run, even for a docs/notes.md change*; *with an origin/main that shares no history with HEAD, both path-gated lanes run*; *in a folder that is not a git repository, both path-gated lanes run* | all pass: today's behavior, kept as regression guards |

**Wrong programs.** For AC1 to AC3, the merge base is the wrong program, and it fails as `BASE-FAILURE.txt` shows. A lane that always runs fails the `docs/notes.md` guards and the probe table, because those SKIP cells are part of the contract. A runLanes that FAILs every lane with list paths fails the AC3 twins. AC4's tests fail on a runLanes that skips when the change can't be worked out.

## Not covered here

- The release preflight still runs every lane. No criterion asks for it, and the tests never set `DEEP_PREFLIGHT=release`.
- The issue's Proof asks for "a preflight test on a scratch repository". These tests are that test, placed under `tests/acceptance/821/` as AGENTS.md asks. They drive `runLanes`, not the whole `scripts/preflight`, which also warms builds and runs every other lane.
