# #67's suite, blind redraft after #1812: each `deep workspace` object is read with `--json`

#1812's Scope says "A command a person runs prints a sentence, and JSON only with `--json`: `deep fix`, `deep
workspace`, `deep rules` and `deep numbers refresh`", and its design line, in the deep CLI row, says "What a person runs
prints sentences, and JSON only with `--json`". So under #1812 each `deep workspace` form prints a sentence, and its one
line of JSON, the object it printed before, only with `--json`. The frozen suite `tests/acceptance/67/` reads every
`deep workspace` answer through one helper, `workspace()` in `67/hub.ts`, which requires the plain command's stdout to
be one line of JSON ("must print one line of JSON"). A correct #1812 implementation fails that helper at the first
`deep workspace` call each test makes or builds on, and none of #67's assertions after that call runs. #1812's Scope
also says "An exit or a line an acceptance suite pins moves only through that suite's blind redraft", and this is that
redraft.

It changes one thing. `./hub.ts` imports `67/hub.ts` as it is and replaces `workspace()` and `newWorkspace()` with
copies that add `--json` as the form's last argument. Every test file that reaches them is copied here unchanged but
for a three-line header and "(redraft 1812)" at the end of each test's name. No assertion is changed, added or dropped.
The folder joins `scripts/lanes.mjs`'s `alone` list, as `tests/acceptance/67/` is on it.

## What was read

- Issue #67 (closed): its Scope, eleven criteria, Proof, Depends on, and its one comment (built in PR #1357; AC1 to
  AC9 and AC11 passed the blind suite, AC10 read INCONCLUSIVE by load).
- Issue #1812 (open): its body (Scope, the eight criteria, Proof, Depends on) and the owner's two comments, the
  tracker review of Nov 9 and the audit numbers of Nov 10. Neither comment names `deep workspace`'s output.
- #1812's blind suite at the base, `tests/acceptance/1812/`: README.md (its Surfaces pinned here, the seventh above all,
  `deep fix` and `deep fix <id> --json`; its Not covered), `fix.test.ts`, how `helpers.ts` starts `deep hub run`, and its
  `BASE-FAILURE.txt` rows for `deep workspace` with the hub down. These are tests, not an implementation.
- `docs/technical-design.md` at the base: the deep CLI row under "One hub per user, a tiny hook client, and extensions
  in-process", with #1812's design line; States people see; Dogfooding. `AGENTS.md`.
- The frozen suite: README.md, `hub.ts`, `host.ts`, all ten test files, `tsconfig.json`, `BASE-FAILURE.txt`.
- For form: `tests/acceptance/19-redraft-2073/` (REDRAFT.md, BASE-RESULTS.txt) and `556-redraft-ac5/README.md`.
- The base's source, only for how the surface is driven: `packages/hub/src/workspace-command.ts` (its parser takes
  exact argument counts and prints `JSON.stringify(reply.result)` and a newline), `packages/cli/src/main.ts` (dispatch,
  the help words, the usage lines), `scripts/lanes.mjs`. `reports/uiux-agentic-audit-2026-11-10.md`, which the owner's
  second comment cites, says nothing of `deep workspace`.

Never read: any implementation of #1812, any branch, pull request or other worktree, any commit after the base
`c0a9de979`, and any uncommitted change but this job's.

## What #1812 changes, test by test

Why each old expectation no longer holds:

- **(a)** The test calls `deep workspace` itself, through `newWorkspace()` or `workspace()`, and reads the object from
  the plain command's stdout. Under #1812 that stdout is a sentence and the object comes only with `--json` (the Scope's
  fifth item; the design line), so the test fails at that call, "must print one line of JSON", and holds nothing of
  #67's after it.
- **(b)** The test reads the one scenario its file's `beforeAll` builds through those calls. Under #1812 the set-up
  fails at its first `deep workspace new`, and the test never runs.

What replaces it, in every row: the same test in `67-redraft-1812/`, its name ending "(redraft 1812)", the same steps
and assertions, each `deep workspace` object read with `--json` as the last argument (`./hub.ts`).

| Original (path › test) | Criterion | Why | Its `deep workspace` calls |
|---|---|---|---|
| `67/diff.test.ts` › a setting and a file changed after the lock are named, and those changed between the workspace's making and the lock are not | AC3 `#67.798381ee` | (a) | `new Web host`; `diff` three times |
| `67/drift.test.ts` › with nothing changed a read of the hosts marks nothing and runs nothing | AC6 `#67.4a8b02f5` | (b) | reads the first `drift`'s object |
| `67/drift.test.ts` › web-1's drift marks the verdict that read it stale, and not the verdict that read only web-2 | AC6 `#67.4a8b02f5` | (b) | reads the second `drift`'s `drifted` and `stale` |
| `67/drift.test.ts` › only the check whose input changed runs again; the claim's other check keeps its result | AC6 `#67.4a8b02f5` | (b) | reads the second `drift`'s `reran` |
| `67/drift.test.ts` › the key holds one digest for each touch its checks read, a SHA-256 | AC7 `#67.bb36d821` | (b) | the scenario's `new Web fleet` |
| `67/drift.test.ts` › two verdicts on one commit whose host readings differ have different keys, differing only in state_digests | AC7 `#67.bb36d821` | (b) | the scenario's `new` and second `drift` |
| `67/drift.test.ts` › the first is never reused for the second: when the new reading fails the check, the claim's verdict is FAIL on the same commit | AC7 `#67.bb36d821` | (b) | reads the third `drift`'s `reran` |
| `67/drift.test.ts` › a key of only the commit, document revisions, check digests, environment and tools gives both one key and fails this test | AC7 `#67.bb36d821` | (a), (b) | `new Web fleet` and `drift` on the planted hub |
| `67/drift.test.ts` › the fixture setting changes through the shipped host source, and the verdict pinned to its reading goes stale, naming what it read | AC11 `#67.b3d12369` | (b) | the scenario's second `drift` |
| `67/landing.test.ts` › a workspace is made under ~/.deepbuild/workspaces/ with no question and no git identity; another in a folder you pick; each is a project of its own, recorded by the core | none, a Scope line | (a) | `new Household budget`; `new Household budget --folder <picked>` |
| `67/landing.test.ts` › a work item named outside any repo opens its task in a new workspace; moved to a folder you pick it keeps its id, files and history, and a session there is in the same project | none, a Scope line | (a) | `move <id> <folder>` (the hub made this workspace for the task) |
| `67/loop.test.ts` › what done means: the task opens in the workspace's project and its definition locks with its check | AC1 `#67.04ad1434` | (b) | the scenario's `new Weekly report` |
| `67/loop.test.ts` › checks: the stop short of the definition is sent back naming R1 and its check, and the stop that meets it passes | AC1 `#67.04ad1434` | (b) | the scenario's `new` |
| `67/loop.test.ts` › asks: a call that needs you waits in the workspace's project on your answer, and runs once you say yes | AC1 `#67.04ad1434` | (b) | the scenario's `new` |
| `67/loop.test.ts` › a receipt: changes.read for the claim shows the PASS, the check it ran and the file the task wrote | AC1 `#67.04ad1434` | (b) | the scenario's `new` |
| `67/loop.test.ts` › the workspace holds its history, the ledger's change shows as a state-source diff, and reverting the report's commit undoes it | AC1 `#67.04ad1434`, in its describe (the Proof) | (a), (b) | `diff`; `revert <id> <commit>` |
| `67/revert.test.ts` › a commit that rewrote a definition, took a script's mode, deleted a note and added a script is undone byte for byte; a later commit stays | AC2 `#67.a680fef7` | (a) | `new Server upkeep`; `revert <id> <commit>` |
| `67/targets.test.ts` › a script two requirements target is renamed: the claim follows it, and one proposal names both paths, leaving the definition as it was | none, a Scope line | (a) | `new Report script` |

The redraft's surface, as `67/README.md` gives it, with the flag (the frozen suite's objects, unchanged):

```text
deep workspace new <topic> [--folder <path>] --json   {"id":"<project id>","folder":"<real path>","name":"<topic>"}
deep workspace move <id> <folder> --json              {"id":"<same id>","folder":"<real path>","name":"<topic>"}
deep workspace revert <id> <commit> --json            {"commit":"<the new head>"}
deep workspace diff <id> --json                       {"diffs":[{"touch":"web-1","item":"port","was":80,"now":8080}]}
deep workspace drift <id> --json                      {"drifted":["web-1"],"stale":["verdict:…"],"reran":["<check>"]}
```

Without `--json` each prints a sentence (#1812), which no test here reads.

## Kept as they are

- `67/budgets.test.ts` › AC10 `#67.458f2e6a` deep workspace new answers within 1 s on each of five runs. It runs the
  plain `deep workspace new <topic>`, as you would meet it, and holds only its exit, 0, and its time; it never reads
  stdout. Under #1812 the plain form still exits 0, the exit table's "0 done": #1812 changes what it prints, not
  whether it ran. Redrafting it to `--json` would time a form a person doesn't type.
- `67/outside.test.ts` › AC8 `#67.5080f53e`: no `deep workspace` call. It reads `workspace.created` from the record.
- `67/packs.test.ts` › AC9 `#67.7e6414d6`, both tests: the extension host in this process, no CLI.
- `67/sources.test.ts` › AC4 `#67.b151d718`, AC5 `#67.550dd2c3` (four tests), AC7's schema half `#67.bb36d821`, AC11
  `#67.b3d12369` (two tests): in this process, no CLI.
- `67/host.ts` and `67/fixtures/`: unchanged; the redraft reaches `fixtures/agent.mjs` through `67/hub.ts`.

The rest of `67/hub.ts` reaches three more `deep` commands, and #1812 changes nothing any test reads of them:

- `startHub` reads `deep hub run`'s first stdout line, `{"ready":true,...}`. `deep hub run` is not among the four
  commands that move to sentences; it is the hub, and #1812's own suite leaves it out by name and reads the same line
  in its helpers.
- `answer` runs `deep inbox answer <ask> approve` with the OS confirmation stub answering `confirmed`, and `loop.test.ts`
  holds only its exit, 0. #1812's AC6 makes a cancelled confirmation exit 3; a confirmed answer is done, 0.
- `control()` talks to the hub's socket directly (`events.read`, `changes.read`), not through the CLI.

## Readings where #1812 leaves room

1. **Where `--json` goes.** #1812 gives `deep workspace` the flag without placing it. The redraft puts it last, after
   the form's own arguments, `--folder <path>` included. #1812's suite pins `deep fix ACME-43 --json` ("the flag after
   the ID"), and every usage line at the base that takes `[--json]` (`deep status`, `inbox`, `land`, `work`, `env`,
   `rules`, `start` and the rest) has it after the command's positional arguments, most of them last. `revert <id>
   [<commit>]` takes an optional commit; these tests always pass one, so whether `revert <id> --json` reads the flag as
   a commit is not exercised.
2. **"The object it printed before"** is read as the frozen suite read the plain line: trimmed stdout parsed as JSON
   must be one object, and each test holds the fields it held before (`id` and `folder` of `new` and `move`, `commit`,
   `diffs`, and `drifted`, `stale` and `reran`). It isn't held byte for byte. #1812 holds only `deep fix --json` byte
   for byte (its AC7), and #67's suite never held more than the fields.
3. **The sentence isn't read.** #1812 gives `deep workspace`'s sentence no words, no criterion of #1812 names it, and
   #1812's own suite lists "JSON only with `--json` for `deep workspace`" under Not covered. #67's criteria are about
   what a workspace does, not what the command says. So no test here reads the plain form's stdout, and a program that
   still printed JSON without `--json` would pass this redraft; that line is #1812's to hold, not #67's.
4. **The plain form keeps one hold.** AC10's test, kept, still runs `deep workspace new` with no flag and holds its
   exit 0 and its time.
5. **Tests that never call `deep workspace` in their own lines are redrafted all the same.** Every test of
   `drift.test.ts` and `loop.test.ts` reads one scenario that its file's `beforeAll` builds through `newWorkspace()`
   and `workspace()`. Each file is copied whole, unchanged but for its names, so the scenario stays one.
6. **#1812's other scope items touch nothing these tests use.** No argument here is `help`, `-h` or `--help`; every
   `deep workspace` call is held to exit 0, which #1812's table keeps for done; and no test runs a `deep` command with
   its hub stopped (the AC7 plant test's planted hub is up), so the one sentence for a hub that isn't answering is
   never reached.
7. **One copy of `67/hub.ts`.** `./hub.ts` re-exports `67/hub.ts` and declares only the two functions it replaces; a
   module's own export of a name hides that name from its `export *`. So the processes and folders a test makes stay
   in that module's lists, and its `cleanup()` stops and removes them as in the frozen suite. The base run confirms
   the replacement is the one called: every command it names ends in `--json`.

## Wrong programs they still fail

- Each wrong program `67/README.md` names under Wrong programs, through the same assertions.
- A `deep workspace` that doesn't take `--json`, as at the base: the first call of each test, "must exit 0", exit 2 and
  the form's usage (BASE-RESULTS.txt).
- One whose `--json` output holds the sentence too, or other than one JSON object: "must print one line of JSON".
- One whose `--json` object lacks a field the tests read, or holds another value: the assertion on that field, as in
  the frozen suite.
- Not failed, by design (Readings 3): one that prints JSON with no flag as well.

## On the base

`BASE-RESULTS.txt` holds the one run at `c0a9de979` on November 18, 2026: 4.1 s, 6 files failed, and of 18 tests 5
failed and 13 were skipped. None ended BLOCKED or INCONCLUSIVE.

- Every failure is at the first `deep workspace` call its test makes or builds on: the form with `--json` must exit 0,
  and the base's parser, which takes exact argument counts, prints the usage and exits 2. That is the line #1812
  moves. Nothing failed before it: each hub started, and `landing.test.ts`'s second test got through its session, the
  workspace the hub made for the work item, both assertions on it and a commit in it before `move` failed.
- `diff`, `revert`, `targets` and both `landing` tests: FAIL at `deep workspace new <topic> --json`, or `deep workspace
  move <id> <folder> --json` for the second `landing` test.
- `drift.test.ts` (8) and `loop.test.ts` (5): skipped. Each file's `beforeAll` failed at `deep workspace new <topic>
  --json`, and its tests read that one scenario, as the frozen files did at their own base.
- The type check is clean, and it reads `67/hub.ts`, `./hub.ts` and the six test files.

Not run: any implementation of #1812; none exists here. So the redraft's passing side, each object read with `--json`,
is unverified. What follows each first call is the frozen suite's code, unchanged but for the test names.

## Run it

macOS, with the repo's Node:

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:/opt/homebrew/opt/rustup/bin:$PATH"
npm ci                                    # once
npm run build --workspaces                # the hub and the deep CLI the tests start
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -p deep-hook   # target/debug/deep-hook, which every hook runs
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/67-redraft-1812 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/67-redraft-1812/tsconfig.json
```

As in the frozen suite: no network, no model, no paid call; `HOME` is a temp folder for every process, folders are
under `/tmp/dh67-*`, and every process is stopped by its PID. A run with `--root` leaves Vitest's cache in this
folder's `node_modules/.vite`; delete it.

## At merge

The frozen `tests/acceptance/67/` stays as written. Its six files redrafted here (`diff`, `drift`, `landing`, `loop`,
`revert`, `targets`) then run by hand only, on the owner's call to swap; `budgets`, `outside`, `packs` and `sources`
keep running from `67/`. The redraft's tests carry the same criterion tags. This folder imports `67/hub.ts`, and
through it `67/fixtures/agent.mjs`, so those stay. It is on `scripts/lanes.mjs`'s `alone` list beside
`tests/acceptance/67/`, added in this commit; the `byHand` entries for the six originals are the implementer's, at the
swap.

## Files

- `hub.ts`: `67/hub.ts`, but for `workspace()` and `newWorkspace()` with `--json`.
- `diff`, `drift`, `landing`, `loop`, `revert` and `targets` `.test.ts`: the frozen files, renamed tests and a header.
- `tsconfig.json`: the frozen suite's.
- `BASE-RESULTS.txt`: the run at the base.
