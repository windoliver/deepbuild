# #1347's suite, blind redraft after #1812: the workspace and its tasks read through `--json`

Issue #1812's Scope says "A command a person runs prints a sentence, and JSON only with `--json`: `deep fix`, `deep
workspace`, `deep rules` and `deep numbers refresh`", and its design line (the deep CLI row) says "What a person runs
prints sentences, and JSON only with `--json`." The frozen suite `tests/acceptance/1347/` reads two of `deep
workspace`'s JSON lines in every test: the `{"id", "folder"}` that `deep workspace new <topic>` prints, in
`World.open`, and the `{"task": <n>}` that `deep workspace task` prints for each task, in `enter` (its README's surfaces
1 and 2, and its reading that `task` prints "one line of JSON, no question, like the other five"). Under #1812 both
print a sentence, so on a right implementation all five tests fail in `World.open` before any of #1347's criteria is
read. The criteria still hold. This redraft reads the same two objects through `--json`, the flag #1812 keeps for them
("No new command, and no new flag beyond `--json` where a sentence replaces JSON"), and changes nothing else.

Written blind at `c0a9de979` (main at `16dc5eab0` plus #1812's blind suite, its design line and the lint lane's entry;
no implementation of #1812), by a job that never saw the implementing work. The implementing agent doesn't edit this
folder (AGENTS.md, Proof).

## What was read

- Issue #1347 (`gh issue view 1347 --comments`): its body (Scope, the five criteria, Proof, Depends on) and its one
  comment, the owner's: built in PR #2448, all five criteria pass the frozen suite. The pull request wasn't opened.
- Issue #1812 (`gh issue view 1812 --comments`): its body (Scope, the eight criteria, Proof) and the owner's two
  comments of Nov 10.
- #1812's blind suite at the base, `tests/acceptance/1812/`: README.md (Surfaces pinned here, Not covered),
  `fix.test.ts` (where it puts `--json`), `undecided.test.ts` (the exit it holds `deep start approve` to) and
  `helpers.ts` (its `workspace` rows; its read of `deep hub run`'s first line). Tests, not an implementation.
- `docs/technical-design.md` at the base: the deep CLI row under One hub per user, a tiny hook client, and extensions
  in-process (with the design commit `014919052` that wrote its #1812 sentences); States people see; Dogfooding.
  `AGENTS.md` (Proof).
- The frozen suite: README.md, helpers.ts, forge.ts, the four test files, BASE-FAILURE.txt, tsconfig.json.
- For form: `tests/acceptance/19-redraft-2073/REDRAFT.md` and its BASE-RESULTS.txt;
  `tests/acceptance/556-redraft-ac5/README.md`.
- At the base, only for how the surfaces are driven: `packages/hub/src/workspace-command.ts` (the six forms and their
  parser), `packages/cli/src/main.ts` (how `workspace` is dispatched, its usage lines' `[--json]`, how `help` is read);
  `tests/acceptance/1332/helpers.ts` (`must`), `tests/acceptance/1332/fixtures/agent.mjs` (what the played agents
  parse), `tests/acceptance/29/h-d.ts` (`allEvents` reads the record over the socket); `scripts/lanes.mjs`;
  `scripts/proof-change.mjs` (the criterion IDs, recomputed from #1347's live body: all five match the frozen suite's);
  the base's own history of the workspace files, which holds #1347's merge (PR #2448).
- Never: an implementation of #1812, a branch or commit after the base, a pull request, another worktree or an
  uncommitted change.

## What #1812 changes, test by test

| Original (path › test) | Criterion | Why the old expectation no longer holds under #1812 | Replaced by |
|---|---|---|---|
| `1347/run.test.ts` › AC1 #1347.7361f8e4 A fixture workspace with 6 tasks and 7 blocked-by links runs to the end with no forge configured. A planted run that calls a forge fails, naming the call | `#1347.7361f8e4` | Both its worlds (the right run and the planted one) open with `deep workspace new "Client report"`, read for `{"id", "folder"}` (`World.open`'s `must`), and enter six tasks with `deep workspace task`, each read for `{"task": <n>}` (`enter`). Under #1812 both commands print a sentence (Scope, fifth item; the design line), so the test fails in `World.open` with nothing of AC1 read | `1347-redraft-1812/run.test.ts` › the same name with "(redraft 1812)". The file is the frozen one byte for byte; its helpers read `deep workspace new <topic> --json` and `deep workspace task … --json`: the same objects, read the same way |
| `1347/run.test.ts` › AC2 #1347.b6ca1fd3 No task starts before its blockers finish, and a killed session continues as a next attempt, as on a repo | `#1347.b6ca1fd3` | The same run as AC1 (one `scene()`), so the same two reads | The same, in the same file |
| `1347/verdict.test.ts` › AC3 #1347.8994a8fa A task's verdict names its commit and its state digests. When a source drifts, the verdict goes stale and only the checks reading it run again | `#1347.8994a8fa` | The same two reads ("Web fleet", two tasks). Its `deep workspace drift <id>` is read by its exit alone, which #1812 leaves at 0 ("0 done") | `1347-redraft-1812/verdict.test.ts` › the same name with "(redraft 1812)"; `drift` still runs without `--json` |
| `1347/back.test.ts` › AC4 #1347.841043a4 Going back one step restores the last version byte for byte | `#1347.841043a4` | The same two reads ("Trip plan", two tasks). Its `deep workspace revert <id>` is read by its exit alone | `1347-redraft-1812/back.test.ts` › the same name with "(redraft 1812)"; `revert` still runs without `--json` |
| `1347/move.test.ts` › AC5 #1347.8f5ee69e Moving the workspace to a fixture repo files each open task once, with its links | `#1347.8f5ee69e` | The same two reads ("Shop launch", four tasks). Its `deep workspace move <id> <checkout>` is read by its exit alone | `1347-redraft-1812/move.test.ts` › the same name with "(redraft 1812)"; `move` still runs without `--json` |

### Surfaces pinned here

The two of the frozen README's surfaces that move; the other eight stand as it states them.

| Frozen README surface | In the frozen suite | In this redraft |
|---|---|---|
| 1. `deep workspace new <topic>` (#67) | exits 0; stdout holds `{"id", "folder"}`, both strings | `deep workspace new <topic> --json`: the same exit and object, read the same way |
| 2. `deep workspace task <id> <title> --criterion <text> [--criterion <text>]... [--blocked-by <n>]...` | exits 0 and prints one line of JSON, `{"task": <n>}`: a number, `#<n>`, or an ID ending in `#<n>` | the same form with `--json` last: the same exit, object and reading |

All of the change is in `helpers.ts` (`diff -u ../1347/helpers.ts helpers.ts`): `'--json'` appended to those two calls,
with their comments and failure messages; `named` adds ` (redraft 1812)` to each test's name; `forge.ts` imported from
`../1347/`; and a header note. The four test files are the frozen ones byte for byte (`cmp` finds no difference). They
are copies only because each imports `./helpers.ts` and takes its name from `named`.

## Kept as they are, and why

No test is kept as it is: all five open their worlds through `World.open`. Inside them, every step but the two reads
is kept, with its assertion, wait and message:

- `deep work "<scope>" --repo <folder> --json` (surface 4), read for its ask and exit 0: already `--json`, and #1812
  doesn't name `deep work` (its exit: Reading 6).
- `deep inbox answer <ask> <option>`, read by exit 0: the world's confirmation stub answers `confirmed`, so "A
  confirmation you cancelled exits 3 in every command" doesn't reach it, and a done answer exits 0 by the table's "0
  done".
- `deep workspace revert`, `drift` and `move` (surfaces 5 to 7), read by exit 0 alone: #1812 keeps 0 for done. They run
  as a person runs them, with no `--json`, and their sentence isn't read.
- `deep hub run`'s first line, `{"ready": true, ...}`: the hub's start protocol, which #1812's own suite reads the same
  way.
- `deep mcp` and deep-hook's replies, which the played agents parse: the agents' protocol, not a person's command.
  #1812's suite leaves `mcp` out of its table by name.
- The record (`events.read` over the socket), the workspace's git, the forges' own records, the agents' logs and the
  plant `workspace-calls-forge` (surfaces 3 and 8 to 10): no CLI output.
- `forge.ts`, imported from `../1347/` unchanged; the worlds (`/tmp/dh1347-*`), waits and timeouts.

The rest of #1812's scope doesn't reach this suite: every hub here answers while its commands run (the one sentence),
every command fits one of its forms (usage and exit 2), no argument is `help`, `-h` or `--help`, and every exit read
is 0, for done.

## Readings where #1812 leaves room

1. **Where `--json` goes**: last, after the form's own arguments and flags; for `task`, after its last `--criterion` or
   `--blocked-by` pair. #1812 names the flag, not its place. Last is where `deep --help` puts `[--json]` on most forms
   that take one (`deep work "<scope>" [--repo <checkout>] [--json]`, `deep start … [--json]`, `deep rules … reach
   --repo <folder> --scope <glob> [--json]`), and where #1812's own suite puts it for `deep fix` (`deep fix ACME-43
   --json`, "the flag after the ID"). An implementation that takes `--json` only somewhere else fails here, naming the
   call.
2. **"The object it printed before"** is read exactly as the frozen suite read it, no stricter and no looser: `id` and
   `folder` strings; `task` a number, `#<n>` or an ID ending in `#<n>`; each from stdout whole as JSON, else its last
   line that parses as an object (`jsonOf`). The frozen suite never held these to the base's bytes, so neither does
   this redraft. (#1812's own suite does that for `deep fix`.)
3. **The sentence isn't read.** Its words are #1812's, and #1347's criteria don't need them. #1812's own suite lists
   "JSON only with `--json` for `deep workspace`" under Not covered, so no test anywhere holds `deep workspace`'s
   sentence. That gap belongs to #1812's proof. This redraft doesn't fill it, since a sentence check here would be a
   #1812 test inside #1347's suite.
4. **The forms whose output this suite never read stay without `--json`**: `revert`, `drift` and `move`, read by exit,
   and `diff`, never run. The flag would read nothing more. (At the base, `deep workspace revert <id> --json` would
   even take `--json` for the commit to go back to.)
5. **A failed read is a failure, not BLOCKED**, as in the frozen suite: `World.open`'s `must` throws an AssertionError
   naming the call and its output. In the frozen suite that read was #67's surface at its base; here it is the surface
   #1812 moved, so its failure is this redraft's own.
6. **Raising the run's approval is done, so `deep work` exits 0.** #1812's table gives 3 to "not decided", and the
   approval `deep work` raises stays undecided until it is answered. But the command did what it was asked, and #1812's
   own suite holds `deep start approve`, which raises the same kind of approval through #1330's `start.approve()`, to
   exit 0 (else BLOCKED). So the frozen suite's `asked.code` of 0 stands, unchanged.

## Wrong programs it fails

- The base, which prints the JSON with no flag and gives usage for `--json`: every test, at `World.open`
  (BASE-RESULTS.txt). With `new` put back in its base form, at each test's "each task enters the workspace with `deep
  workspace task`" (the scratch probe in BASE-RESULTS.txt).
- A #1812 that prints a sentence under `--json` too, or another object there (no `id` or `folder`, no `task`): every
  test, at the same two places.
- Every wrong program the frozen suite fails, at the same assertions: a run that calls the forge (the plant), a task
  started before its blockers, a lost next attempt, a verdict without its commit or digests, a drift that re-runs the
  wrong checks, a revert that isn't byte for byte, a move that files a task twice or drops a link.

Not told apart here: a `deep workspace` that still prints JSON without the flag and takes `--json` too (Reading 3).

## On the base

`BASE-RESULTS.txt`: at `c0a9de979`, run once: 4 files, 5 tests, 5 failed, 0 passed, in 3.1 s, none BLOCKED. Each world
started its hub, and each test failed at the first read #1812 moves: `deep workspace new <topic> --json` exits 2 with
`deep workspace`'s usage (`World.open`, helpers.ts:182), since the base's parser takes `new <topic>` with nothing after
it but `--folder <path>`. A scratch probe, not kept, put the base's `new <topic>` back for one run: then every world
opened, and each test failed at its own "each task enters the workspace with `deep workspace task`" (run.test.ts:51
and :76, verdict.test.ts:13, back.test.ts:21, move.test.ts:16), on `deep workspace task … --json`, exit 2 with the
usage. That is the second read #1812 moves, at the lines the frozen suite's BASE-FAILURE.txt names. helpers.ts was
restored byte for byte after it.

Not run: the passing side. No implementation of #1812 exists at this base. On a right one this redraft runs the frozen
suite's steps unchanged after the two reads. The owner's comment on #1347 says all five criteria passed the frozen
suite at PR #2448; this job didn't re-run that suite.

## Not covered

The frozen suite's Not covered, unchanged. From #1812: the sentence `deep workspace` prints without `--json` (Reading
3); `--json` on `revert`, `drift`, `move` and `diff`; and the rest of #1812's scope, which its own suite holds.

## Run it

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:/opt/homebrew/opt/rustup/bin:$PATH"
npm ci && npm run build --workspaces
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -p deep-hook   # the played agents' hooks
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1347-redraft-1812 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1347-redraft-1812/tsconfig.json
rm -rf tests/acceptance/1347-redraft-1812/node_modules   # Vitest's cache, left by --root
```

On a right implementation each file runs real gate checks and finishes real tasks, as the frozen suite's do: allow tens
of minutes per file under load. A missing CLI build or deep-hook, or a hub that won't start, reads BLOCKED.

## At merge

The frozen `tests/acceptance/1347/` stays as written. Swapping it for this folder is the owner's call; the tests carry
the same five tags. This commit adds the folder to `scripts/lanes.mjs`'s `alone` list beside the frozen one, since its
files start hubs, forges and played agents.

## Files

`REDRAFT.md`, `BASE-RESULTS.txt`, `tsconfig.json`, `helpers.ts` (the frozen one with the changes above), and
`run.test.ts`, `verdict.test.ts`, `back.test.ts` and `move.test.ts` (the frozen ones byte for byte). Imported unchanged:
`../1347/forge.ts`, and through the helpers `../1332/helpers.ts`, `../1332/forge.ts`, `../1332/fixtures/agent.mjs`,
`../29/h-d.ts` and `../67/hub.ts`.
