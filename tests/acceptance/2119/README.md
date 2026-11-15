# #2119 acceptance tests: setup and doctor keep what a running session wrote, and name the home and program they really use

Written first and blind at base `2baafea73` ("Merge pull request #2514 …", origin/main), from issue #2119, the design
and the base, before any fix. The drafting job saw nothing of a fix: it read no other branch, no other worktree, no pull
request and not the live issue. Per AGENTS.md the implementing agent doesn't edit these tests. A dispute goes to a blind
redraft by this job (design: Dogfooding).

**Read:** the issue's text as this job was handed it, verbatim: its account of the four defects, Scope, the four
criteria, Proof and Depends on; the audit report it links was not read. AGENTS.md. In `docs/technical-design.md`: How it
installs, all of it, in particular Setup, Editing agent settings ("Just before each replace, it reads the file again";
"write atomically … through a temporary file beside that file"), The hub and Platforms; and the head of How we know
version 0 works. At the base: `packages/hub/src/setup.ts`, `agent-files.ts`, `codex-settings.ts`, `paths.ts`,
`service.ts` and `setup-steps.ts` whole, with `contracts/setup-steps.json`; `doctor.ts`'s items (`doctorItems`,
`serviceItem`, `hookItems`, `claudeItems`, `codexItems`, `doctorCommand`); `claude-settings.ts`'s `claudeSettings` and
`writeJson`; `hook-programs.ts`'s `unrunnable`; `hub-readings.ts`'s `health`; `stop-judging.ts`'s imports, options,
constructor and `projectTrusted`; `canvas-doctor.ts`'s items; the head of `packages/otlp/src/doctor.ts`;
`packages/record/src/trust.ts`'s `ProjectTrust`; `packages/cli/src/main.ts`'s doctor and setup commands and its
first-command gate; `tests/vitest-setup.ts` and `vitest.config.ts`; and, by search, every caller of `codexRelations`,
`modified`, `codexTrusted`, `projectTrusted`, `recordedHome`, `hookItems` and `doctorCommand`. The lanes:
`scripts/lanes.mjs` (test paths, the alone list), `proof-change.mjs` (`criterionId`, `spans`, the test paths),
`proof-runs.mjs` (`frames`, `asserted`, `atAssertion`), the heads of `proof-vitest-reporter.mjs` and `public-text.mjs`,
and `scripts/lease`. For their shape: `tests/acceptance/2203/` (README, helpers, test, the head of `BASE-FAILURE.txt`,
`tsconfig.json`, `twins.json`), `39/helpers.ts` (its homes and Codex files), and the heads of the READMEs of `322/`,
`1334/` and `2078/`. On the machine, read only: `/Users/Shared`'s mode, which lets any user make a folder there, and
that no `.git` is in it or above it.

**Run**, on macOS, from the checkout's root, so the root `vitest.config.ts` and its setup file apply as in the lanes:

```sh
npm ci                                  # once
npm run build --workspaces              # the tests run packages/cli/dist and packages/hub/dist
node node_modules/vitest/vitest.mjs run tests/acceptance/2119/ --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/2119/tsconfig.json
```

Four files, a test each, about two seconds in all here; each test allows 600 s for a loaded machine. No hub starts,
nothing waits for one, and no deep-hook is built, so cargo isn't needed. The unit lane's vitest run picks the files up
from `tests/**`, and nothing outside this folder was edited. The suite writes only in folders it made, never in the
checkout, so it runs in parallel with other files. It needs no network and no agent.

## Criterion to tests

IDs are `criterionId` in `scripts/proof-change.mjs`, computed from the criteria as this job was handed them. There are
no twins: all four criteria are fixes, and the merge base is the wrong program each test fails on.

| Criterion | ID | Test | What it asserts | On the base |
|---|---|---|---|---|
| Setup merges its entries into each agent file as it is at the write | `#2119.92207f0e` | `merge-at-write.test.ts` | `deep setup` in a home whose `~/.claude.json` the stand-in deep-hook's `--help` writes again with one key more, `projects`: when setup ends, the file holds that key as the session wrote it, and `mcpServers` holds `deepbuild` and `deep-actions` | Fails: the two servers are there and `projects` is gone |
| Setup's own record is written through a temporary file | `#2119.8f1b0393` | `record-write.test.ts` | the built `saveRecord` saves an earlier record; a save of the next one runs with every file write cut once its file is open; then `setupRecord` reads the earlier record | Fails: the cut opened `setup.json` itself, which reads as `{ files: {}, created: [] }` |
| The Codex health texts and the trust read name the Codex home setup wrote in | `#2119.6d54a255` | `codex-home.test.ts` | `deep setup` with `CODEX_HOME` set to `<tmp>/codex`; then, with no `CODEX_HOME`, `deep doctor --json` before and after the Stop entry's timeout is edited there, and the hub's relations, readings and trust read through its built modules: each of seven texts names that folder's hooks.json or config.toml, no Codex text names one elsewhere, and a project trusted in that folder's config.toml reads as trusted | Fails: all seven name `<home>/.codex/…`, the default home, and the project reads as untrusted |
| Doctor judges the program the login service runs, not the folder Node is installed in | `#2119.c097fc3c` | `service-program.test.ts` | a launchd definition whose arguments are `<tmp>/prefix/bin/node` (with `<tmp>/prefix/.git` a folder), `/Users/Shared/dh2119-*/cli/dist/main.js`, `hub`, `run`: `deep doctor --json`'s `hub.service` is `service_unpromoted` at level `warn` | Fails: level `fail`, "in a checkout, `<tmp>/prefix`", Node's folder |

On the base all four fail at their one `expect` (`BASE-FAILURE.txt`). Each failure message carries what the test read:
the file, the record, the texts with where each came from, or doctor's item, with the child's command and output.

## How the tests reach the code

- **`deep`** is the built CLI, `packages/cli/dist/main.js` of the checkout this folder is in, run as a child process
  under the Node that runs the tests: `deep setup` (AC1, AC3) and `deep doctor --json` (AC3, AC4). Its environment is
  built from nothing: `HOME`; `PATH` (`<bin>:/usr/bin:/bin`); `SHELL=/bin/sh`; `XDG_CONFIG_HOME` in the home;
  `DEEP_HUB_TEST_CONFIRM`, a file answering `cancelled`, so setup sets up no Secure Enclave key; `DEEP_HUB_LAUNCHER`;
  `DEEP_DOCTOR_CANVAS_FAULT=render_skipped`, the base's test setting that keeps doctor from rendering its canvas
  fixture; and, where a test gives them, `NODE_PATH` and `CODEX_HOME`. No variable of the runner's reaches it, so no
  doctor run has a `CODEX_HOME` and no run a `CLAUDE_CONFIG_DIR`.
- **The hub's built modules**, through two scripts in `fixtures/`, each run as a child process with `HOME` the test's
  home and `PATH=/usr/bin:/bin` alone, each printing one JSON line:
  - `cut-record.mjs` (AC2) loads `packages/hub/dist/agent-files.js` and calls `saveRecord` and `setupRecord`, the
    record's writer and reader, which no command calls alone. The cut: while it saves the next record, node:fs's
    `writeFileSync` opens the file it is given, with the flag and mode it is given, and throws before writing a byte,
    and `writeSync` throws. The stubs go in through node:fs's own exports with `syncBuiltinESMExports`, so they reach
    every module that imported them, whatever file it writes. A write in place leaves `setup.json` empty; a write
    through `writeThrough` leaves the temporary file beside it, and `setup.json` as it was.
  - `hub-reads.mjs` (AC3) loads `codex-settings.js`, `stop-judging.js` and `paths.js` and prints what the hub reads of
    Codex: `codexRelations(root)` and `modified(root)`, which the hub's health reports as Codex's relations and
    readings (`hub-readings.ts`, `health`), and `projectTrusted(project)` of a `StopJudging` given the root and a core
    trust that holds no decision (`trusted` answers false), the one caller of the Codex trust read. No hub is started.
- **Stand-ins**, each a short shell script the test writes, logging its arguments:
  - `launchctl` and `systemctl` in `<bin>`, first on PATH, each exiting 1;
  - the launcher `DEEP_HUB_LAUNCHER` names, exiting 1: setup's hub start hands it the definition and fails, so setup
    exits 3, after both of its writes, and nothing is loaded into the machine's service manager;
  - **deep-hook, as npm installs it.** `deepHook()` (paths.ts) takes this platform's package,
    `@deepbuild/deep-hook-<platform>-<arch>`, resolved from the checkout's package.json, before any build under
    `target/`. The checkout holds no such package, so Node's resolution falls back to the folders `NODE_PATH` names, and
    the test names one of its own, holding a package of that name with the stand-in in its `bin`. Setup asks it for
    `--help` (`builtHook`, to learn whether a build serves deep-actions), since the test home has no installed version
    (`<root>/versions/current/bin`). The stand-in exits 0 and prints a usage that names `mcp actions`, so setup takes it
    and builds nothing; in AC1 it first writes `~/.claude.json`. Setup writes its path into its entries; nothing runs
    them. Were the checkout ever to hold that package, setup would take it instead, and AC1 would read BLOCKED.
- **Where the folders are.** Each test makes `/private/tmp/dh2119-*` (made under `/tmp`, used by its real path) for
  its homes, stand-ins and files. AC4's CLI script is in `/Users/Shared/dh2119-*`, made with `mkdtemp` so only this
  user reads it, as #2203's suite does: outside every temp folder `deep doctor` lists, and in no git folder, each
  checked. It holds an empty `main.js` and nothing else. Every folder is removed when its file ends.
- **BLOCKED**, by a thrown error, never a pass or a skip: with no built CLI or hub; when a child doesn't run to its end
  (killed by its PID at 300 s) or the build can't load a module; when a fixture script gives no JSON answer; in AC1,
  when setup never ran the stand-in's `--help`; in AC2, when the earlier record doesn't read back, or the next save
  wrote no file to cut; in AC3, when setup didn't leave one Stop entry of DeepBuild's in `<tmp>/codex/hooks.json` and
  its MCP server in that folder's config.toml, or left a default home; in AC4, off macOS, where
  `/Users/Shared/dh2119-*` can't be made or is under a temp folder or in a git folder in this run, when Node's folder
  isn't the first folder above it that holds `.git`, and when doctor's `hub.service` read no definition.

## Where the issue leaves a choice, or differs from the base

1. **Line numbers.** The issue's are on the audit's branch. At the base, setup's two writes are in the
   `'hooks:claude-code'` step of `install` in setup.ts; the record's write is agent-files.ts's `saveRecord`;
   doctor.ts:308 is `hookItems`'s healthy `codex.hooks` text ("DeepBuild's entries are in … as setup wrote them");
   doctor.ts:209 is `serviceItem`'s `programs`; and core.ts:7513's caller of `codexTrusted` is `projectTrusted` in
   `stop-judging.ts`.
2. **AC1's stand-in.** "A stand-in deep-hook whose --help adds a key to ~/.claude.json" is read as a session's write:
   the stand-in writes the file again with bytes the test gave it, the file as it was with one key more, `projects`,
   holding a trust answer for one folder (the issue's first example, "a trust answer"). "Between the plan and the
   write" holds by the base's order: `builtHook`'s `--help` runs after the plan and before the steps. "Beside
   DeepBuild's two servers" is `mcpServers` holding `deepbuild` and `deep-actions`; their values and the rest of the
   file aren't asserted. Only `~/.claude.json` is tested, as the criterion names it, not Claude Code's settings.json,
   which the Scope reads again too. "When setup ends": setup exits 3 here, its hub start failing on the launcher
   stand-in after both writes; the exit code isn't asserted.
3. **AC2's cut.** "A write … cut after the file is opened (the write stubbed to throw)" is every file write of the save,
   whatever file it opens, as above: a program that writes through `writeThrough` meets the cut at its temporary file,
   not at `setup.json`. The save's throw isn't asserted, nor what a second setup would then record (the criterion's
   "Today"), nor the record's mode. The record is reached through its built module, not a command.
4. **AC3's texts.**
   - "Another folder" is `<tmp>/codex`, outside the home. The default home is `<home>/.codex`, which doesn't exist.
   - "Doctor" is `deep doctor --json`'s Codex items: `codex.hooks`, from `modified` and doctor's healthy text, and
     `timing.codex_*`, from `codexRelations`. "The hub's relations" are the relations and readings the hub's health
     reports, read through the same built functions it calls, not through a running hub.
   - "Each text names that folder's hooks.json or config.toml" is read two ways, both asserted: every Codex text of
     doctor's and of the hub's, evidence and fix, that names a hooks.json or config.toml names one in that folder; and
     each text the scene makes names its file there. With the Stop entry's timeout edited, to 60 s, those are the
     reading that the entry was modified and the broken slow-lane relation, each naming hooks.json, in doctor and in
     the hub. No text names config.toml after that edit alone, so the test also sets `tool_timeout_sec = 5` under
     `[mcp_servers.deep]` in that folder's config.toml, which breaks the deep_ask relation, whose text names
     config.toml (the Scope's ":360"). And it runs doctor once before the edit, when `codex.hooks` is healthy and says
     where the entries are (the issue's "doctor says the entries 'are in' that file"; the Scope's doctor.ts:308). A
     file named is an absolute path whose last part is `hooks.json` or `config.toml`; the rest of each text's wording
     is free, and a text may name both files.
   - "A project trusted in that folder's config.toml" is `[projects."<path>"]` with `trust_level = "trusted"`, as
     `codexTrusted` reads it, for a folder the test made. It "reads as trusted" when `projectTrusted` answers true.
     The test calls only `projectTrusted`, so how the Scope gives `codexTrusted` the root is free.
5. **AC4's arguments.** "A node under a folder that holds .git" is `<tmp>/prefix/bin/node`, a link to this Node, with
   `<tmp>/prefix/.git` a folder, as a package manager's prefix that is a checkout. "A CLI script in no git folder" is
   also outside every temp folder: doctor reads a program under a temp folder as `fail` too ("a temp folder"), so the
   criterion's `warn` needs a script that is neither. The definition is launchd's plist, written by the test in the
   shape service.ts writes it, so the test is macOS's; doctor reads only its arguments. Only the item's code and level
   are asserted.
6. **Not tested:** Linux, where the definition is a systemd unit; setup's paseo and pi steps; undo; the real
   deep-hook; a running hub.

## Machine safety

No child reaches the real home or the real service manager: each gets a `HOME` inside a folder this run made, checked
before it starts, a launcher stand-in that loads nothing, and `launchctl` and `systemctl` stand-ins first on PATH. The
stand-in deep-hook writes only the test's own file, named by its absolute path. No cargo, agent or network is reached:
PATH holds the stand-ins, `/usr/bin` and `/bin`. No stand-in starts a program, so no hub runs and nothing is stopped; a
child past 300 s is killed by its own PID. A run killed midway can leave `/private/tmp/dh2119-*` and
`/Users/Shared/dh2119-*` behind: they hold scripts, logs, setup's files in a test home and an empty file, no process and
no secret. The suite never removes one by name, since another session's run may own it.

## What the drafting job ran, and what it did not

With the checkout built (`npm ci --no-audit --no-fund`, 13 s; `scripts/lease nice -n 10 npm run build --workspaces`,
4 min 25 s, unleased, since no CLI was built yet to lease with), Node 24.22.2 and vitest 5.0.5 on macOS 27.2:

- **The typecheck,** `tsc -p tests/acceptance/2119/tsconfig.json`: exit 0.
- **The suite on the base,** each file alone while it was written, then whole: 4 tests, 4 fail at their `expect`. It
  ran whole twice, the second time after one last edit to `codex-home.test.ts` (a hooks.json that doesn't parse after
  setup reads BLOCKED; a comment's words), which moved its `expect` a line; the second run, 1.45 s, is the record
  (`BASE-FAILURE.txt`). Both runs failed the same four tests at the same `expect`s.
- **The lanes' rule for a failure at an assertion:** after each whole run, one more through
  `scripts/proof-vitest-reporter.mjs`, its report read with a throwaway copy of `frames`, `asserted` and `atAssertion`
  from `scripts/proof-runs.mjs`: each failure is at its assertion, its innermost frame in its own test file. `spans()`
  from `scripts/proof-change.mjs` reads one test a file, named with its tag, not skipped.
- **Right programs,** each laid as exact string edits in this job's own built `packages/hub/dist`, run, then lifted by
  putting back copies of the built files; none is kept here:
  - AC1: the `'hooks:claude-code'` step reads each file again, with `strictObject` (or the planted `lenient`), right
    before its write: passes.
  - AC2: `saveRecord` writes with `writeThrough`: passes; the cut fell on `.setup.json.deepbuild-<pid>.tmp`.
  - AC3: `modified`, `codexRelations` and doctor's healthy text name `join(recordedHome(root), …)`, and
    `codexTrusted(root, paths)` reads the recorded home's config.toml, given the root by `projectTrusted`: passes.
    Without doctor's change it fails on doctor's `codex.hooks` before the edit; with every text named right and the
    trust read as the base has it, it fails on the trust read alone.
  - AC4: the Scope's line, `const programs = all.length > 1 && /\/node$/.test(all[0]!) ? all.slice(1) : all;`: passes.
- **Studied names:** a throwaway copy of `scripts/public-text.mjs`'s word rule over every file here: no finding.
- **Left behind:** nothing. After each run no `/private/tmp/dh2119-*` or `/Users/Shared/dh2119-*` folder was left.

Did not run: `scripts/proof.mjs` or any lane of it; `scripts/affected.mjs`; the preflight; the suite on Linux, with a
real deep-hook or against a running hub.

## Files

- `merge-at-write.test.ts`, `record-write.test.ts`, `codex-home.test.ts`, `service-program.test.ts`: a test each, for
  the four criteria in order.
- `helpers.ts`: the folders, homes and stand-ins, `deep` as a child process, doctor's items and the fixture scripts'
  runner.
- `fixtures/cut-record.mjs`, `fixtures/hub-reads.mjs`: the hub's built modules, called in a child process.
- `tsconfig.json`: for the typecheck above.
- `BASE-FAILURE.txt`: the run at the base, the checkout's path cut out.
