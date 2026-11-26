# #3544 acceptance: a rebuild of the projections is a start the hub reports

Written blind, by a job that read only the issue, the design and the base commit `2edb19ff4` (origin/main when it
started). No implementation existed and none was seen. The implementing agent doesn't edit these files (AGENTS.md,
Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

## What was read

- Issue #3544 as handed to this job: its report, Runs on, Scope (every line), six checkbox criteria and Proof. The
  criteria's IDs are `criterionId`'s (`scripts/proof-change.mjs`), computed from the body. The issues it names (#1,
  #14, #1591, #2801, #3440, #2687, #2026) were read for the words it cites.
- The design: One event log, with tables built from it; One hub per user, a tiny hook client, and extensions
  in-process; Numbers version 0 has to hold (the Hot path row); Hook protocol (deep-hook and the hub); How we know
  version 0 works (Dogfooding, Criteria in a checked shape, Wrong programs). `AGENTS.md`, `CONTRIBUTING.md`.
- The base, for call shapes and conventions only: `packages/hub/src/` (`service.ts`: `startHub`, `coreAnswers`,
  `hubStatus`, `control`; `server.ts`: `runHub`, the hub's `open`, `hook`, `reply`, `rules`, the `hub.health` and
  `hub.stop` cases; `core-worker.ts`; `core.ts`: `init`, `openRecordAndAsks`, `hook`, `queue`; `hub-readings.ts`:
  `health`; `client.ts`; `list.ts`; `doctor.ts`; `hub-command.ts`; `paths.ts`: `rootOf`, `hubAddress`,
  `controlToken`, `dropTestSettings`; `plant.ts`; `log-reads.ts`: `subscribe`), `packages/record/src/` (`index.ts`:
  `RecordOptions`, `openRecord`, `rebuild`, `REPLAY_PAGE`, `prepare`; `projections.ts`: `TABLES`, `ensure`, `drop`,
  `apply`), `packages/cli/src/main.ts`, `crates/deep-hook/src/main.rs` (`forward`, `exchange`, `rules`, `guard`,
  `denials`), `benchmarks/record.mjs`, `benchmarks/budgets.json`, `scripts/benchmark.mjs` (`validateBudgets`),
  `scripts/wait-ratchet.mjs`, `scripts/repo-rules.mjs`, `scripts/twins-lint.mjs`, `scripts/alone-lint.mjs`,
  `scripts/lease`, `tests/vitest-setup.ts`, and the suites `2801`, `3440`, `16`, `316`, `909`, `1879`, `2026`,
  `1812` and `1832` for their conventions. Every helper is written here; none is imported from another suite.

## Run

Node 24.22.0, with the checkout built: `npm ci && npm run build --workspaces`, and
`cargo build --locked -p deep-hook`, without which the hub's core stops at its start.

```sh
node node_modules/vitest/vitest.mjs run --root tests/acceptance/3544 --no-file-parallelism
node node_modules/typescript/bin/tsc --noEmit -p tests/acceptance/3544/tsconfig.json   # type-check
rm -rf tests/acceptance/3544/node_modules                                              # vitest's cache
```

No run has timed the suite (How the tests were checked). By its holds, the five hub tests should take about two
minutes on a correct program: three of them wait out ten pages held a second each, and the record is built once, in
about the time of 47,500 appends. `budget.test.ts` takes the time of `record-replay-100k`. With no built CLI or no
deep-hook every hub test fails `BLOCKED: …` before it starts anything, never a pass. `lane.json` runs the folder
alone (`timing:`): the tests judge `deep hub start` and three commands against a 2 s wait on the real clock.

## The setup

- **The record.** `helpers.ts` builds it once per run (`plantedRecord`), through the record package's own
  `openRecord` and `append` (its public entry, as #3440's suite reaches it), with no hub running: 47,500
  `commit.made` events, as the core records a session's commits, appended in one run so their log positions are 1 to
  47,500. A count of events replayed is therefore also the log position the replay has reached. The kind is chosen
  so a page folds fast: no session's turn is walked and one row is written per event, which leaves most of each
  2 s wait to the planted fold's 1 s hold. Then, in the closed file, the planted difference: `ALTER TABLE commits
  RENAME COLUMN created TO made`, the table as a build that named that column otherwise would have left it. At its
  next open `ensure()` finds `commits` stale and the record replays the whole log: ten pages of `REPLAY_PAGE`
  (5,000) events, nine whole and one of 2,500. A record that doesn't come out so (47,500 events at 1 to 47,500, as
  many rows in `commits`) is `BLOCKED`.
- **A world per test** (`world`), in a temp folder of its own, `/tmp/dhr-<letters>`: `h`, the scratch `HOME`; `r`,
  a dev hub's root holding a copy of the record as `ledger.db`; `w`, a working folder outside any repo. The home's
  one address setting, `~/.deepbuild/config.json` (`hub.address`), names the root's socket, so `deep doctor`, `deep`
  and deep-hook reach the dev hub as they would a hub behind a forwarded socket, and `deep hub start` and `deep hub
  status` take `--root`. Every child gets this machine's environment with that `HOME`, no `DEEP_*`, `XDG_*` or agent
  variable but those the test sets, and `PATH` cut to Node's folder and the system's, so no agent's program is on
  it. The real `~/.deepbuild`, its hub and its login service are never touched.
- **Commands** run as `node packages/cli/dist/main.js <args>` (`deep`), each line kept with the time it came.
- **The socket** is read as the CLI reads it: the hub's hello, `{v: 1, hello: 'cli', token}` with the root's control
  token, then one call (`hub.health`, `hub.stop`, `stream.subscribe`).
- **Hooks** go as the design's hook protocol has them: a `hook.request` line on a connection of its own, its ID and
  `seq` minted by the test, the hub's acknowledgement read; and, for the one call a fail-closed entry matches,
  through the built deep-hook (`deep-hook claude-code PreToolUse`, the call's JSON on stdin), which reads the home's
  `rules.json`. The entry is the suite's own (`GUARD` in `helpers.ts`: `run:dhrfixture apply`, block,
  `fail_closed`), written to the home's and the root's `rules.json` before the hub starts.
- **Nothing waits for time to pass.** Each wait is for a line a process prints, a process's end, or an answer on the
  socket; every timer is the bound that turns a hang into a failure (`// deadline:`). The times the criteria
  themselves name (2 s, one wait) are read from when a line or an exit reached the test.
- **After each test** (`cleanup`): its commands are ended through their own handles; its hub is stopped on its
  token, as `deep hub stop --root` stops one, when its core answers, and otherwise (it still replays, or never will
  end) by the PID its own `hub.health` names; then its folder is removed. Nothing is stopped by name or port.

## Defined here

The issue leaves these unnamed. The tests read them exactly as written here, so the implementer builds exactly this.

### 1. The start's wait: `DEEP_HUB_TEST_START_WAIT_MS`

An environment variable `deep hub start` reads; only tests set it, as `DEEP_HUB_TEST_STOP_HOLD_MS` shortens a stop's
hold. Its value is a whole number of milliseconds above 0, and it takes the place of the start's wait, the 120,000 ms
of `CORE_WAIT_MS`: how long `deep hub start` goes on waiting for the core while nothing it reads moves. With a replay
under way that is how long the count of events replayed (`rebuilding.replayed`, below) may stand still; each time the
count moves, the wait starts again. Unset, the wait is the shipped one. The tests set `2000`, and only on
`deep hub start --root`.

### 2. The planted folds: `DEEP_HUB_TEST_FOLD`

An environment variable the hub (`deep hub run`) reads at its start; only tests set it. The hub `deep hub start --root`
starts inherits it from that command's environment, as it inherits every `DEEP_HUB_TEST_*` setting, and
`dropTestSettings` already drops it on your own record by its name. It changes one thing: the fold of a replay, the
rebuild `openRecord` runs when a projection is stale. An open that rebuilds nothing is not changed by it. A page is
what `rebuild()` reads of the log at a time, `REPLAY_PAGE` events, 5,000 as at the base; the tests' record is built
for that number. Two values:

- **`page-1s`**: each page of the replay is held 1,000 ms before the first of its events is applied. While a page is
  held, the events replayed so far are those of the pages before it: 0 during the first hold, 5,000 during the
  second, 45,000 during the tenth.
- **`page-3-never`**: the first and the second page are each held 1,000 ms and applied, as under `page-1s`; the third
  page never returns. None of its events is applied, the replay never ends and never commits, and the events
  replayed so far stay at two pages' events: 10,000 here.

Under either, the hub's socket goes on answering as section 3 says, hooks included. How the hub hands the fold to its
record (a value of `RecordOptions.plant`, say) is the implementer's: no test here opens a record with a fold itself.
Both are fixtures of a correct program, not wrong programs, so neither is a `DEEP_HUB_PLANT` value.

### 3. The hub's health while its record replays

`hub.health` (and `health`) on the socket, for the cli role, answers at once while the record replays: it does not
wait for the core. Before the record is opened, and on a start that replays nothing, it waits for the core as on the
base. While the record replays its result holds:

| Field | Value |
|---|---|
| `pid` | the hub's process ID, a whole number, as `hub.health` carries it once the hub is up |
| `start` | the hub's start ID, a string, as the hello carries it |
| `rebuilding` | an object with exactly these two fields, both whole numbers: `replayed`, the events replayed so far, and `events`, the events in the log |

`rebuilding` is there only while the record replays. Once the core has started, and on a start that replays nothing,
the result holds no `rebuilding` field at all (not `null`, not `false`). While it is there the result may hold other
fields, but no count of asks (section 6). With the tests' record `events` is 47,500, and `replayed` is a whole
number of pages, as section 2 gives it.

### 4. The reading a rebuild leaves

Once the core has started, `hub.health`'s result holds `rebuilds`: a list with one reading for each rebuild this
record has had, oldest first, `[]` for a record that has had none. A reading is kept with the record, so it is still
there, unchanged, after the hub stops and starts again. A test reads three fields of a reading, and a reading may hold
others:

| Field | Value |
|---|---|
| `table` | the name of the projection whose columns differed: `commits` here. The tests plant one table; what it reads when several differ is not held |
| `events` | the events the rebuild replayed, a whole number: 47,500 here |
| `ms` | the time the rebuild took, a whole number of milliseconds on the wall clock, from before its first page is held or read to its commit. Under `page-1s` over ten pages it is at least 10,000 |

### 5. What `deep hub start` prints

- **The rebuild sentence.** While it waits on a hub whose health holds `rebuilding`, `deep hub start` prints one
  line, on stdout or stderr, when it first reads that, and one more each time `replayed` has moved since the line
  before; while it waits it never prints two such lines for one count. A test reads such a line loosely, never
  whole. The line holds:
  `rebuild` in any letter case (rebuilding, Rebuilding); the events replayed so far; and after it the events in the
  log. Each count is written in digits, plain or with commas between thousands (`10000` or `10,000`). A test takes
  the numbers that stand alone in the line (not part of a path, a name, a version, a clock time or a date), and reads
  the first of them that is a count this record's replay can show (0, 5,000, … 45,000 or 47,500) as the events
  replayed; 47,500 must follow it. So write no other such number before the events replayed. "The hub is rebuilding
  its tables: 10,000 of 47,500 events replayed." reads so, and so do other wordings.
- **Exit 0** comes once the replay has ended and the core answers `hub.health`, as on the base: a `hub.health` read
  right after it holds no `rebuilding`.
- **Exit 3** comes only when `replayed` has not moved for the wait. The last line it prints before it exits, printed
  then and not when the count last moved, names the position the replay stopped at: it holds the events replayed at
  that moment (10,000 under `page-3-never`), in digits as above, standing alone. That line may itself be worded as a
  rebuild sentence; it is the one line that may repeat a count.

### 6. What `deep hub status`, `deep doctor` and `deep` print while the record replays

Each prints its report within 2,000 ms of its process's start, and then ends. Their exit codes are not held.

- **`deep hub status --root <root>`** prints the hub's health as one JSON line on stdout, as it does once the hub is
  up, so the line's `rebuilding` holds the two fields of section 3.
- **`deep doctor`** and **`deep`** with no arguments each print, among their lines, one line that reads as the
  rebuild sentence of section 5 reads: `rebuild` in any letter case, the events replayed, then the events in the log.
- **No count of asks.** None of the three prints, anywhere in its output: digits followed by `ask` or `asks`, with or
  without `open` between (`0 asks need you`, `3 open asks`); the words `Nothing needs you`; or, in JSON, a key that
  is `ask` or `asks`, alone or joined to other words by `_` (`asks`, `open_asks`), holding a number.

### 7. The budget's task

`record-replay-100k` in `benchmarks/budgets.json` gains `"#3544.37bd1895"` in its `criteria`, beside what it holds
by then, with `command` and `margin` unchanged. The scheduled budget window then measures it against the merge base,
20 samples a side, and its record proves the criterion (`scripts/budget-window.mjs`). No test here takes samples or
judges a time: agents never run the window.

Nothing else is new. The record's file (`<root>/ledger.db`), the hook protocol, deep-hook, `rules.json`,
`hub.stop`, `stream.subscribe` and `~/.deepbuild/config.json`'s `hub.address` are used as the base has them.

## Requirement, check, proof

All five hub tests are in `rebuild.test.ts`, one tagged test each, no subtests; the sixth is `budget.test.ts`.

| Criterion | Test | What it holds | On the base, as read from its code (not yet run) | Wrong program |
|---|---|---|---|---|
| `#3544.93bc058e` the record with one projection's columns planted to differ, the start's wait 2 s, a fold that holds each of ten pages 1 s: `deep hub start` prints the rebuild sentence with a count that rises, and exits 0 once the core answers | first | `deep hub start --root` with the wait `2000` and the fold `page-1s`, run to its end (150 s at most). It printed at least one rebuild sentence; it exited 0; each sentence names more events replayed than the one before (so none is printed twice for one count); at least 5 of the ten pages' counts were printed; and `hub.health` read right after the exit answers with `start`, `pid` and no `rebuilding` | Fails at the first assertion: the base reads neither setting, replays in seconds, prints `The hub is up.` and no rebuild sentence | `start-waits-once`: the merge base's one wait, under the test's 2 s. It exits 3 saying the core didn't start, and the exit assertion fails quoting that line. This holds the criterion's sentence about the merge base, which the real base can't show |
| `#3544.efcb2f1f` the same record, a fold that never returns from its third page: `deep hub start` exits 3 one wait after the count last moved, naming the position | second | The wait `2000` and the fold `page-3-never`, the command given 30 s. It printed the rebuild sentence; it exited before the deadline; it exited 3; `hub.health` then reads `rebuilding {replayed: 10000, events: 47500}`; it had printed the sentence for 10,000; its last line names 10,000; it exited at least 1,750 ms and under 4,000 ms after that sentence came; its last line came at least 1,750 ms after that sentence; and the record's file still holds `commits` with the planted column (Scope: the rebuild is not split into several commits) | Fails at the first assertion, as above | `start-waits-while-socket-answers`: never exits, and the deadline assertion fails naming the 30 s |
| `#3544.916857a5` during the replay `deep hub status`, `deep doctor` and `deep` each report rebuilding with the same two counts at one reading, within 2 s, and none prints a count of asks | third | The fold `page-3-never`; once `deep hub start` has printed the sentence for 10,000 (or ended), `hub.health` reads `rebuilding {replayed: 10000, events: 47500}`. Then the three commands run one after another, each to its end (30 s at most). `hub.health` reads the same after them (else `BLOCKED`). For each command: it reported rebuilding with exactly the health's two counts; the report came within 2,000 ms of its start; it ended; its whole output holds no count of asks. Each message starts with the command's name | Fails at the health assertion: the base's start ends with the core up and its health holds no `rebuilding` | `status-waits-for-core`: `deep hub status` waits 25 s and exits 3, the criterion's sentence about the merge base, which the real base can't show. `deep-prints-zero-asks`: `deep` prints `0 asks need you` |
| `#3544.7b62fddb` twenty hooks sent during the replay, one matching a fail-closed entry: nineteen are in the record once each after it, in the order sent, and the one is denied | fourth | With no hub running, deep-hook denies the entry's call with exit 2 and the entry's reason and next step (else `BLOCKED`). The fold `page-1s`, the shipped wait; once `deep hub start` prints a rebuild sentence, `hub.health` holds `rebuilding`. Twenty hooks of one session follow, one after another: nineteen `PreToolUse` request lines, each `echo dhr-hook-<n>` with its own ID, and as the eighth the entry's call through deep-hook. `hub.health` still holds `rebuilding` after the twentieth (else `BLOCKED`). All nineteen were acknowledged; the one was denied, exit 2 with the entry's reason and next step, as with the hub down; `deep hub start` exits 0. One more hook is sent and awaited on the hub's stream of the log. Then the record's file holds, for each of the nineteen in the order sent, one event with its ID and its command once under that ID; their log positions rise in that order, above 47,500 and below the last hook's | Fails at the health assertion, as the third | `drops-acknowledged-hooks`: the first hook's ID is in no event, and the message names it |
| `#3544.99834caf` after the replay the hub's health holds one reading with the table that was stale, the events replayed and the milliseconds taken, and a second open of the same record rebuilds nothing and adds no reading | fifth | The fold `page-1s`, the shipped wait. `deep hub start` exits 0 and `hub.health` holds no `rebuilding`; its `rebuilds` is a list of one; the reading's `table` is `commits` and its `events` 47,500; its `ms` is a whole number, at least 10,000 (ten pages held 1 s each) and at most the time `deep hub start` itself ran; the record's file holds `commits` with `created` again. The hub is stopped on its token, and `deep hub start` runs again with the same fold: it exits 0, prints no rebuild sentence, and `hub.health` holds no `rebuilding` and the same `rebuilds`, unchanged | Fails at the `rebuilds` assertion: the base's health has no such field | `rebuilds-on-every-open`: the second start prints the rebuild sentence |
| `#3544.37bd1895` budget: `record-replay-100k` within its margin of the merge base, 20 samples a side | `budget.test.ts` | `benchmarks/budgets.json` is valid against the merge base's (`validateBudgets`); the task keeps the merge base's `command` and `margin` and names the criterion in its `criteria`; its command runs and exits 0 | Fails at the criteria assertion: the task doesn't name it | the merge base |

`twins.json` names the twins and `twins/README.md` says what each breaks, the file its lines change and the
assertion it fails at. Their `lines.json` are the implementer's to add.

## Not named by the issue, so assumed

- **"The start's wait set to 2 s for the test"**: section 1. The wait is the stall wait the Scope describes, started
  again each time the count moves.
- **"A planted fold that holds each page of the replay for 1 s over ten pages"**: section 2's `page-1s`, on a record
  of 47,500 events, ten pages of the base's 5,000. The hold comes before a page's events are applied, so the count
  read during a hold is a whole number of pages. A change to the page size makes the record another number of pages:
  that is a dispute for a blind redraft, not an edit here.
- **"A planted fold that never returns from its third page"**: section 2's `page-3-never`. It also holds its first
  two pages 1 s each, which the issue doesn't say. Without that the count's last move would come within a fraction of
  a second of the start, and "one wait after the count last moved" could not be told from "one wait after the start".
- **"The rebuild sentence" and "a count that rises"**: section 5. "Rises" is read as each sentence naming more than
  the one before, with at least five of the ten pages' counts printed; a start may miss a count between two reads of
  the health.
- **"Naming the position"**: the events replayed when the count stopped, 10,000, in the last line the start prints.
  In this record that number is also the log position of the last event replayed, so either reading of "position"
  names it.
- **"One wait after the count last moved"**: from when the start's own sentence for the last count reached the test
  to when its exit did: at least 2,000 ms less 250 ms for what two processes' output can be off by, and under two
  waits.
- **"Fails the test's deadline"**: 30 s for the second test's start, which on a correct program ends in about 5 s.
- **"At one reading"**: the replay stands still under `page-3-never`, so the three commands and the health are read
  of one state; the health is read before and after them.
- **"Within 2 s"**: from the command's spawn to the moment the line that reports it reached the test, so Node's start
  is inside it. The command's exit may come later.
- **"A count of asks"**: section 6.
- **"Twenty hooks … the hub acknowledged"**: the nineteen are sent as the hook protocol's request lines, so the test
  holds each ID and reads each acknowledgement; through deep-hook neither can be seen. The one fail-closed call goes
  through deep-hook itself, so "denied as it does with the hub down" is what an agent would get: exit 2 with the
  entry's reason and next step, whether the hub's reply or deep-hook's own floor decided it.
- **"After it"**: after the replay's 47,500 events and before a hook sent once `deep hub start` exited 0, which is
  awaited on `stream.subscribe`.
- **"One reading"** and **"adds no reading"**: section 4. The reading is taken to outlast the hub's process, so a
  second open shows the same one; a reading kept only in memory would make "adds no reading" unobservable.
- **The budget**: carried as #3440's budget criterion was, by the task naming the criterion for the window.

## Not covered, and not run

- **Scope: "each within its own wait"** is held only as the criterion's 2 s. No test sets or reads a wait of
  `deep hub status`, `deep doctor` or `deep`.
- **Scope: "from the same reading"** is held as equal counts in the three outputs and the health. That each command
  takes them from `hub.health` rather than from a read of its own isn't visible from outside.
- **Scope: "Not in this task"**: a shorter rebuild and #1591's digest have no test, since nothing here could tell
  them from the work. That the rebuild stays one commit is held once, in the second test.
- **The design's Hot path row** (a rebuild never pushes a hook's reply past the hook overhead budget) is not timed
  here. The nineteen acknowledgements are awaited, not timed.
- **Proof: "the rebuild's time on #2687's month fixture as a reading"** is evidence the implementer takes; it is no
  criterion and no test asks for it.
- **The app** and `deep status`, `deep inbox` are not read: the criterion names three commands.
- **The installed hub** (`deep hub start` with no `--root`, the login service) is never started: every hub here is a
  dev hub in a temp folder. Linux wasn't run; nothing here is macOS-only.
- **Load.** Under `page-1s` a page's hold and its fold must together stay under the 2 s wait, and each of the three
  commands must start and report within 2 s. On a machine too busy for that a correct program fails the first or
  the third test; those are the criteria's own numbers, and the folder runs alone for that reason.
- **The twins** were not planted: none can exist before the work. Each is described from the base's code.
- **A stand-in for the work** was not written, so the tests were not seen to pass. What was run is under
  How the tests were checked.

## How the tests were checked

**The base run was not made: BLOCKED, never a pass.** When the suite was written the base build of this checkout
(`npm run build --workspaces`, then `cargo build --locked -p deep-hook`) was still waiting in the machine's build
line, so there was no built CLI, no `dist` for the record package and no deep-hook, and no test could start. There is
no `BASE-FAILURE.txt` yet; this job is resumed to make the run once the build is there, and adds it then. Until
that run, these are read from the base's code and not seen:

- that each of the five hub tests fails on the base at the assertion the table names;
- that the record builds as the setup says (47,500 `commit.made` events at log positions 1 to 47,500, the hub's core
  starting on it), and how long that takes;
- that deep-hook reads the suite's guard entry (`run:dhrfixture apply`) and denies its call with the hub down, the
  fourth test's `BLOCKED` check;
- that a hook's event keeps its command in `data.command`, which the fourth test reads beside its ID.

What was run, with no build needed: the type-check (`tsc --noEmit -p tests/acceptance/3544/tsconfig.json`, clean);
the wait ratchet (`node scripts/wait-ratchet.mjs`, no finding in this folder); the twins lint (none for this
folder); the public text lane's name check over every file here (nothing); and the loose readers of `helpers.ts`
(`countsOf`, `numbersIn`, `asksCounted`) against sample lines, in a scratch script outside the checkout. No stand-in
for the work was written, so no test was seen to pass, and no twin was planted.

## Files

- `rebuild.test.ts`: criteria one to five. `budget.test.ts`: the sixth.
- `helpers.ts`: the numbers, the record, a world, a command's lines, the socket, hooks, the stop.
- `twins.json`, `twins/README.md`: the planted wrong programs. `lane.json`, `tsconfig.json`. `BASE-FAILURE.txt`
  comes with the base run.

No fixture holds a secret or personal data; every path is a temp folder's, and a failure's message writes the scratch
home as `~` and this checkout as `<checkout>`.
