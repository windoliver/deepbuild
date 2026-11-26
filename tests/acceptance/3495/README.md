# Acceptance tests for #3495: a state reads as a plain sentence, then its word

Written first and blind, at base commit `f08a77068` (main at `5a81b58de` merged with the branch that holds the design
text #3472 decided), from issue #3495 as saved on 2026-11-25 (its opening, three bullets, Scope, `Runs on:` line, seven
acceptance criteria and Proof; it has no comments), the design and the base, before any implementation. The
implementing agent does not edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding). Criterion 7 is a taste call: `TASTE.json` is the one file a person fills in.

## What was read

- Issue #3495, and the issues it names, for its edge: #3472 (where it was decided), #1324 (its epic), #3496, #3497,
  #3498, #3499 and #3418 (beside it), #1348 and #1463 (which it depends on).
- `docs/technical-design.md`: States people see with its table, What a person reads on a plain surface with its five
  decisions and its table, the project page line under Later, as extensions, Replica, the row shape under One hub per
  user, Criteria to tests, Wrong programs, Dogfooding, Tests written first, Built to be hard to get wrong.
  `docs/parallel-proof.md`: Binaries for tests, A suite's own lane file. `AGENTS.md`.
- At the base, for call shapes and conventions only: `packages/hub/src/{list,rows,status,plant,sections}.ts`,
  `packages/record/src/projections.ts` (how a session's status moves), `contracts/plain-words.json`,
  `crates/deep-app/src/{states,plain,rows,list,views,chrome}.rs`, `crates/deep-app/src/views/layout.rs`,
  `crates/deep-app/copy/en.json`, `crates/deep-canvas-marks/looks/clean.json` (the shell's sizes),
  `crates/deep-replica/src/drive/{mod,see,frames,glyphs}.rs` and `plain_words.rs`, `scripts/lanes.mjs` (the lint lane),
  `scripts/slots-check.mjs`, `scripts/app-copy-lint.mjs`, `scripts/wait-ratchet.mjs`, `scripts/proof-change.mjs`
  (criterion IDs), and the suites `1463`, `2018`, `2019`, `1808`, `3282`, `1461`, `1458`, `1348`, `1925`, `2403`,
  `3472`, `16` and `26`.

## How to run

With Node 24.22 and cargo first on `PATH`, the workspaces built (`npm ci --ignore-scripts; npm run build --workspaces`)
and `deep-hook` built (`cargo build --locked -p deep-hook`), from the checkout's root:

```sh
NO_COLOR=1 node node_modules/vitest/vitest.mjs run tests/acceptance/3495/check.test.ts --no-file-parallelism --testTimeout=600000
NO_COLOR=1 node node_modules/vitest/vitest.mjs run tests/acceptance/3495/rows.test.ts --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc --noEmit -p tests/acceptance/3495
```

- **`check.test.ts`** (AC5) runs on any machine and starts nothing: it reads the table, imports `scripts/lanes.mjs`
  and runs the check 21 times. Seconds. It needs the workspaces built only because the root vitest config and
  `scripts/lanes.mjs` load them.
- **`rows.test.ts`** (AC1, AC2, AC3, AC4, AC6, AC7) needs the built CLI and `deep-hook`. Its tests of `deep`, `deep
  status` and `--json` run on any machine. Its tests of the list and the pages need macOS, where the replica draws;
  elsewhere they read `BLOCKED`, never a pass. It makes one world and starts up to three replicas. At the base, where
  only the shipped replica starts, it took 10 seconds with the binaries built.
- **Builds.** #2018's `driveBinaries`, with `CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0`: `cargo build --locked
  -q -p deep-replica --bin deep-drive --features env-plants`, then `cargo build --locked -q -p deep-replica --bin
  deep-drive -p deep-hook --bin deep-hook`, each copied out of the target folder into
  `$TMPDIR/dd2018-bin-<uid>-<8 hex of the checkout's path>/`, so `target/debug` holds the plain build afterwards.
  `CARGO_TARGET_DIR` is honored. A build that fails is `BLOCKED`.
- **Folders and processes.** Homes and outputs are under `/tmp` (#16's `tempDir`). Nothing touches the real
  `~/.deepbuild` or `~/Library/LaunchAgents`. Only what a test started is stopped, by PID. No network, no model.
- **Shown to you.** AC7 writes `shown.txt` to `$DS3495_SHOWN` (a temp folder without it) and prints the text and its
  SHA-256. It reads INCONCLUSIVE until `TASTE.json` records a call on exactly that text.
- **Waits.** No test waits on the wall clock. Each read of the window follows half a second of the replica's own
  virtual clock.
- **Lanes.** `lane.json` puts the folder in the alone block. Run with `--root tests/acceptance/3495`, vitest writes
  `tests/acceptance/3495/node_modules/.vite/`; delete it before committing.

## The surface (my choice where the issue names none)

The readers are the real ones: `deep`, `deep status` and `deep status --json` from the built CLI against a real hub in
a temp HOME; the app's list, the project's page and a session's page as the real `deep-drive` reads them, launched with
`launch.from: "record_copy"` in the same HOME, so it draws a copy of that hub's record; and the lint lane's check, run
as the lane runs it. No reply, label or log line credits a criterion.

### Pinned here: the implementation must provide these

1. **The table**, `contracts/plain-states.json`, beside `contracts/plain-words.json`: one object `states` with exactly
   the fifteen words of States people see as its keys. A word's value is its sentence, the design's word for word, or
   `null` where the word reads as it is.

   ```json
   {
     "states": {
       "queued": null,
       "working": null,
       "says done": null,
       "PASS": "done, and the checks agree",
       "sent back": "not done yet: a check didn't get what it expected, and the agent is fixing it",
       "BLOCKED": "couldn't be checked: something a check needs is missing",
       "INVALID": "can't be counted: the proof offered doesn't hold",
       "INCONCLUSIVE": "couldn't tell: a check didn't finish, or an answer is missing",
       "needs you": null,
       "stale": "checked, and changed since",
       "quiet": null,
       "stuck": null,
       "flagged": null,
       "finished": null,
       "running": null
     }
   }
   ```

2. **The check**, `node scripts/plain-states-check.mjs [--table <file>]`, run from the checkout's root.
   - The lint lane of `scripts/lanes.mjs` (`checks`, the lane named `lint`) holds the command
     `[process.execPath, 'scripts/plain-states-check.mjs']`.
   - With no argument it reads `contracts/plain-states.json`. With `--table <file>` it reads that file in its place, a
     table of the same shape. Either way it reads the design and the list of plain words from the checkout.
   - It passes with exit 0, a line that starts `PASS plain states`, and no line that starts `FAIL`. Example:
     `PASS plain states: 15 rows, 6 sentences`.
   - It fails with exit 1 and one line a finding, each starting `FAIL plain states`. A table with no row for a word of
     States people see names that word in such a line: `FAIL plain states: no row for INVALID`. A sentence that holds a
     word its state's row says never to call it, or a word `contracts/plain-words.json` lists, names that word in such
     a line, outside the sentence it quotes: `FAIL plain states: PASS reads "passed, and the checks agree", which holds
     "passed", a word its row says never to call it`.
3. **What `deep` prints with no arguments.** A session's line holds its title, then its agent, as at the base. For a
   session in one of the six states, what follows them starts with the sentence, ` · `, then the word, and the row's
   own sentence (its `why` in `deep status --json`) comes later on the line:
   `  Publish check  <agent>  couldn't be checked: something a check needs is missing · BLOCKED · waits for you: a run of publish-check.sh, 2h`.
   For a session in any other state, what follows the title and the agent starts with the word, as at the base.
4. **The list's row.** A session's row is the node `session:<session ID>` (merged). Its accessible name holds its
   title, and after the title, past ` · `, the sentence, ` · `, then the word:
   `<glyph> Publish check · couldn't be checked: something a check needs is missing · BLOCKED · waits for you: a run of publish-check.sh`.
   For any other state the word comes first after the title, as at the base. The row keeps its slots, each a node with
   its own bounds (merged ids): `<row>:mark`, `<row>:word`, whose name and whose drawn strings are the state word,
   `<row>:time`, whose name and whose drawn strings are its time, and `<row>:flag` where it has one. The sentence is
   drawn in the row outside those four slots and ends before the word slot's left edge. Where it doesn't fit it is
   drawn as a start of the sentence and an ellipsis (`…` or `...`), or whole and clipped at its end (the replica's
   `cut`).
5. **The list at its narrowest width** is reached with `deep_drive`'s `resize` (merged) to a window as wide as
   `shell.list_min` and `shell.page_min` of `crates/deep-canvas-marks/looks/clean.json` together, 208 and 640 at the
   base: the app then holds the list (the node `list`) at `list_min` points, within 2.
6. **Five plants**, each selected by `DEEP_HUB_PLANT`, everything else as shipped. A plant that changes nothing reads
   `BLOCKED`.
   - Read by `deep`'s own process (`activePlant()`), as #1463's are; the hub runs without them:
     - `print-word-alone`: `deep` with no arguments prints each session's line with its word and no sentence before
       it, as the merge base prints it.
     - `working-has-sentence`: `deep` with no arguments prints a working session's line with a sentence before its
       word, any words then ` · working`, as a table that held a sentence for working would. Every other line as
       shipped.
     - `word-holds-sentence`: `deep status --json` gives the row of each session whose state is BLOCKED a `word` that
       holds the table's sentence for BLOCKED, alone or before the word. Every other row and field as shipped.
   - Read by the app through `crate::plain::planted(…)` in the replica built with `--features env-plants` only, as
     #1808's and #3282's row plants are:
     - `view-own-sentence`: the list's row of each session whose state is BLOCKED reads, in its accessible name where
       the table's sentence goes, a sentence the view wrote itself: any words but the table's, such as `its checks
       couldn't run`, then ` · BLOCKED`. Every other row, and `see`'s `rows`, as shipped.
     - `row-cuts-word`: a session's row whose sentence doesn't fit whole makes room for it by cutting its state word:
       its `<row>:word` slot draws a start of the word and an ellipsis, or the word clipped, in place of the whole
       word. Its accessible name and every other row as shipped.
7. **Detail views.** `deep status` prints each session's line with its word first after its title and its agent, and
   none of the six sentences anywhere. `deep status --json` holds, for each session and each open ask, one row whose
   `word` and `entry` are the base's. A session's page, the node whose id is `session/<session ID>` (merged), holds a
   string that reads its title, ` · `, then its word, as the base's does, and none of the six sentences in any name,
   string value or drawn string.
8. **The taste call**, `TASTE.json`: `issue` 3495, `criterion` `#3495.f4a87a07`, `verdict` `reads_right` or
   `reads_wrong`, `who`, `when`, and `files` with `shown.txt` and the SHA-256 the run printed for it.

### Merged surfaces, used as they are

`deep hub run` with `DEEP_HUB_TEST_CONFIRM`; `DEEP_HUB_PLANT`; the record and asks core through #26's `seed`; `deep`,
`deep status` and `deep status --json` (`{log_pos, rows}`, #1463); `deep-drive --out <dir>` with `launch` (`from:
record_copy`), `see` (`snapshot` with each node's `id`, `name`, `value` and `bounds`, `runs` with `text`, `bounds` and
`cut`; `rows`; `address`), `open`, `feed`, `resize`, `wait_for` and its `env-plants` feature; the list `list`; a row's
slots; the folded row `quiet:<project>` with its `:title` slot; a running job's row by its id; a page as the node whose
id is its address (`project/<project>`, `session/<session ID>`).

### The fixture

`helpers.ts`, `makeWorld`: two git folders, `shop` and `docs`, under one temp folder; fourteen sessions seeded with the
hub stopped through #2018's seeder, each event in its kind's published shape and each time counted back from when the
fixture is made; then a real hub. Every test but AC6's own first holds the fixture to its states in `deep status
--json`, and reads `BLOCKED`, naming the session, when one doesn't read its state.

| Key | Project | Title | State | What the record holds |
|---|---|---|---|---|
| `pass` | shop | Cart totals | PASS | a stop that claims done, and PASS |
| `sentback` | shop | Tax | sent back | a claim three and a half hours old, FAIL, sent back in round 1 |
| `blocked` | shop | Publish check | BLOCKED | a claim, BLOCKED, and its open item, `a run of publish-check.sh` |
| `invalid` | shop | Search index | INVALID | a claim, and INVALID naming what it leaves open |
| `inconclusive` | shop | Login page | INCONCLUSIVE | a claim, and INCONCLUSIVE naming what it leaves open |
| `stale` | shop | Release notes | stale | a claim, PASS, and the verdict gone stale |
| `needs` | docs | API guide | needs you | the open ask *Which accent colour for the headings?* |
| `stuck` | docs | Sign-up form | stuck | a turn the core says ended stuck (`session.attention`) |
| `flagged` | docs | Image upload | flagged | a turn the core says ended failed (`session.attention`) |
| `saysdone` | docs | Checkout page | says done | a stop that claims done, with no verdict |
| `working` | docs | Search box | working | a tool call started two and a half minutes ago and not ended |
| `queued` | docs | Price list | queued | a start and a task, and no prompt |
| `finished` | docs | Footer links | finished | a stop with no claim |
| `quiet` | docs | none | quiet | a start three days ago and nothing since |

The fifteenth state, running, is a job's. A job's row leaves the list when its hub stops, so no record holds one: its
row is fed to the replica as the hub writes one (`row.set`, the job `encode`, with no counter, so it reads its word).

## Criterion to tests

IDs are `criterionId` in `scripts/proof-change.mjs`, checked against the issue's body.

| Criterion | ID | Tests | Wrong programs it fails on |
|---|---|---|---|
| AC1 | `#3495.ce97e581` | `rows.test.ts`: `deep` exits 0, and each of the six rows' lines reads its sentence, ` · `, its word, then the row's own sentence; the output holds the issue's line | the base, naming each row and its state as its word alone; `print-word-alone`, one finding a row, each naming the row and its state |
| AC2 | `#3495.7db893a8` | `rows.test.ts`: the six rows in the list read the same sentence and word as `deep` prints; with the project's page open the six read so beside it, and the page's own region holds none of the six words without its sentence | the base, naming each row; `view-own-sentence`, one finding, naming the list's row and BLOCKED as a sentence of its own |
| AC3 | `#3495.0c4822f4` | `rows.test.ts`: `deep` prints the seven such rows it gives a line of their own with the word first; the list's nine rows, the folded quiet row and a fed running job among them, read the word first | `working-has-sentence`, one finding, naming the working row and its state |
| AC4 | `#3495.a6932d9f` | `rows.test.ts`: at the list's narrowest width the sent back row draws its word and its time whole in their slots, a start of its sentence cut from its end before the word, and its name holds the sentence | the base (no sentence drawn or named); `row-cuts-word`, every finding starting with the row, one saying its word isn't whole |
| AC5 | `#3495.7faace76` | `check.test.ts`: the table holds the fifteen rows with the design's six sentences; the lint lane runs the check; it passes the shipped table | the base (no table, no check); a table with no row for INVALID, naming INVALID; "passed" for PASS, naming passed; "verdict" in each of the fifteen states in turn, naming verdict |
| AC6 | `#3495.66e86bd1` | `rows.test.ts`: `deep status --json` holds each row's base word and entry; `deep status` reads each word first and holds no sentence; each of the six sessions' pages reads title, ` · `, word and holds no sentence | `word-holds-sentence`, naming the BLOCKED row and no other |
| AC7 | `#3495.f4a87a07` | `rows.test.ts`: writes the six rows on the three surfaces, before and after, then reads `TASTE.json` | INCONCLUSIVE with no call, a call that names no one or no time, or one on other rows; `reads_wrong` fails |

Each planted test first holds the shipped program to the same judge, so at the base it fails there, by the criterion's
own finding. Tests that pass at the base on purpose, since their criterion keeps a behaviour: AC3's two shipped tests
and AC6's two shipped tests. Their wrong programs are the plants `working-has-sentence` and `word-holds-sentence`, whose
tests read `BLOCKED` at the base, where no such plant exists.

What each test accepts as naming:

- **The row and its state** (AC1): the row's id and its title, as `row session:<id> ("<title>")`, then the state word.
- **The view and the state** (AC2): `the list's row`, the row, then `BLOCKED`, in a finding that says the row reads a
  sentence of its own and quotes it. A row that reads the word alone is another finding and doesn't count.
- **The state** (AC3): the working row, then `working`, in a finding that quotes what stands before the word.
- **The row** (AC4, AC6): the finding starts `row session:<id> ("<title>")`.
- **The state** (AC5): a `FAIL plain states` line that holds `INVALID` as a whole word.
- **The word** (AC5): a `FAIL plain states` line that holds `passed`, or `verdict`, as a whole word once the planted
  sentence is taken out of the line, so a line that only quotes the sentence names nothing.

## What the base does

Both files ran once at the base `f08a77068`, unchanged, on 2026-11-26, and one probe of the suite's own world and
readers ran after them. `BASE-FAILURE.txt` holds each test's result, trimmed to its failing assertion, and what the base
shows of the fixture. `check.test.ts`: 4 failed of 4. `rows.test.ts`: 10 failed and 4 passed of 14, in 10 seconds.

- **The fixture reaches its states.** Each of the fourteen sessions reads its word in `deep status --json` with that
  word's entry, and no test read `BLOCKED` on the fixture. No row carries a flag: none shows in what `deep` printed,
  and the probe's world, the same fixture, has none in `--json`.
- **No table and no check.** `contracts/` holds the list of plain words alone, and `scripts/` has no
  `plain-states-check.mjs`. AC5's first test fails on the missing table, its three planted ones on the missing check.
- **`deep` prints the word alone.** A session's line is its title, its agent, then its word and its why joined by
  ` · `, as in `  Publish check  <agent>  BLOCKED · waits for you: a run of publish-check.sh, 2h`. AC1's test fails,
  naming each of the six rows and its state as its word alone. Its planted test fails on the same six findings: the
  base is the program that prints the word alone, so the shipped print doesn't pass the judge.
- **The list's row has no sentence.** Its name is the glyph, the title, ` · `, the word, and for BLOCKED, INVALID and
  INCONCLUSIVE the why after it: `✗ Tax · sent back`, `■ Publish check · BLOCKED · waits for you: a run of
  publish-check.sh`. AC2's test of the list fails, naming each of the six rows. Its planted test fails on the same
  findings, before the planted build starts.
- **The project's page shows no session's state.** `project/shop` holds the nodes `home-title` ("shop"),
  `home-needs-you` ("1 ask needs you") and the box, and the window draws nothing outside the list and the page. AC2's
  test of the page fails on the six rows beside it, and no finding names the page's own region.
- **The other nine read the word first.** AC3's two shipped tests pass: `deep`'s seven lines, and the list's nine
  rows, `○ 1 quiet session · quiet` and the fed job's `↻ encode · running 12 s` among them. Its planted test reads
  `BLOCKED`: `DEEP_HUB_PLANT=working-has-sentence` changes nothing there.
- **At the list's narrowest width** a window 848 points wide holds the node `list` at 207 points. The sent back row
  draws `Tax`, then `sent back` whole in its word slot and `3 h` whole in its time slot, and 30 points lie between the
  end of the title's text and the word slot. AC4's test fails on two findings, both the criterion's: the row draws no
  start of its sentence, and its name doesn't hold the sentence. No finding is on the word or the time. Its planted
  test fails on the same two, before the planted build starts.
- **The detail views read the word alone.** AC6's two shipped tests pass: `deep status --json` holds each row's word
  and entry, `deep status` prints each word first, and a session's page holds `✓ Cart totals · PASS` in its nodes
  `line-status` and `return-card` and `PASS: its claim passed its checks` in `session-why`. Its planted test reads
  `BLOCKED`: `DEEP_HUB_PLANT=word-holds-sentence` changes nothing there.
- **No call is recorded**, so AC7 reads INCONCLUSIVE. It wrote `shown.txt`, in which each row's before and after are the
  same line.
- **Not run at the base:** the two planted replica readers, the env-plants build with `view-own-sentence` and with
  `row-cuts-word`. Each starts only once the shipped window passes its judge, and a probe that would have started them
  got no grant from the machine's throttle within an hour.

## Readings where the issue and the design leave a choice

1. **The project's page.** At the base the project's page (`project/<project>`) draws its title, one line with the count
   of asks, the views placed on it and the box. It shows no session's state. #1343 builds its picture and its line and
   is not this task, and a row, strip or banner on the page is a new surface the issue doesn't name, so no test here
   needs one. The page is read as the plain words lane reads a page: the window with the project's address open, which
   is the page's own region and the list's rows beside it. The test opens `project/shop`, holds each of the six rows
   beside it to the sentence and word `deep` prints, and holds the page's own region to one rule: a string that reads
   one of the six words among other words has the table's sentence, then ` · `, before the word. A string that is the
   word alone is a slot of its own and isn't judged. So a page that later gains a line for a session is held, and a
   page that shows none passes.
2. **A sentence of its own, and its view.** The planted view is the list's row, the one view that shows a session's
   state at the base. It counts as a sentence of its own when the text between the row's title and its word is not
   empty and is not the table's sentence. The finding names the view as `the list's row` and the state by its word.
3. **Sentence, then word.** The issue's line, "couldn't be checked: something a check needs is missing · BLOCKED", is
   taken as the form on each plain surface: the sentence, ` · `, the word. In `deep`'s line and in a row's accessible
   name that string stands first after the title (and the agent). A row that draws the two in slots of their own still
   reads them so in its name.
4. **The row's own sentence as before** (AC1) is the row's `why` in `deep status --json`, anywhere after the word on
   its line, so a flag between them passes. In the list it isn't held: at the base only three of the six rows' names
   hold it.
5. **Which rows the other nine have** (AC3). `deep` folds quiet sessions into one count line and shows a running job
   only while its tool runs, so its print is held for seven states. The list is held for all nine: quiet as the folded
   row `quiet:docs`, running as a job's row fed to the replica.
6. **The list's narrowest width** (AC4) is `list_min`, reached by a window `list_min + page_min` wide. The sent back
   session's title is three letters and its claim three and a half hours old, so at the base its word and its time are
   whole at that width and the room between the title and the word is what the sentence gets: 30 points there, from
   the end of `Tax` to the word slot's left edge. "Cut from its end" is a start of the sentence of at least one
   character, short of the whole, that ends in an ellipsis or at its clip. An ellipsis alone is no start. The replica
   reads a clipped string only from four drawn glyphs on, so in that room the start is one that ends in an ellipsis. A
   sentence drawn whole, cut from its start, absent, or drawn over the word fails. A longer title, where the title or
   the time would have to give, is left to the implementation: at the base the four longer-titled rows of the fixture
   draw no time at that width, and they aren't judged there.
7. **The table's shape and the check's command** (AC5) are pinned above, the least a planted table needs: a file a
   test can write, and a flag to hand it to the real check, as `scripts/slots-check.mjs` takes `--table`. `null` says a
   word reads as it is; a missing key is a missing row.
8. **As on the merge base** (AC6) is derived from the base's own table and print: the fixture's word for each session
   with that word's status-map entry in the design's table, which the base's `rows.ts` holds too; the base's line
   (`list.ts`: the title, the agent, then the word); and the base's page (`views.rs`: the title, ` · `, the word). The
   run at the base agrees: both shipped tests pass there.
9. **Before and after** (AC7). After is what the run read. Before is derived: the same row with the sentence and its
   ` · ` taken out, which is how the merge base reads it. The text holds no id; the agent's name and the time at the
   end of `deep`'s line are placeholders, so one record gives one text and a call stays bound to it. A text surface
   needs no picture. Showing the rows in the pull request is the implementing agent's; no test can see it.
10. **The plants.** All five are test-build plants in the base's form, since each is a program that prints or draws.
    The three planted tables are files a test writes.

## What isn't asserted, because no criterion says so

- Notifications and end notices, which the Scope names as plain surfaces, and the card.
- Another language: the sentence from that language's table, and the five verdict words as written there.
- That the hub, `deep` and the app read the one table: only what each surface reads is held.
- That nothing reads a state from a sentence, and that a row's value in the tree is unchanged.
- `deep doctor` and the verdict line in the chat, which the Scope names as detail; the menu bar; `--why`.
- `deep`'s print for a quiet session and for a running job (reading 5), and with the hub stopped.
- The sentence's room at any width but the narrowest, and a row that also carries a flag.
- The check's rules beyond the three plants: other words never to call a state, other listed words, and whether a
  sentence equals the design's. The first test holds the shipped table to the design's sentences itself.
- What #3496, #3497, #3498 and #3418 hold: `deep`'s headings, the lane's reach, the words of a row's own sentence, and
  which meaning finished and stuck keep.

## What the implementer adds outside this folder

`contracts/plain-states.json`; `scripts/plain-states-check.mjs` and its command in the lint lane of `scripts/lanes.mjs`;
the five plant names where each is read (`packages/hub/src/plant.ts`'s `Plant` for the three `deep` reads). No lane
list needs this folder: `lane.json` puts it in the alone block. A person fills in `TASTE.json`.

## Files

- `judges.ts`: the criteria's IDs, the design's fifteen words with their entries and sentences, and every judge. It
  imports nothing.
- `helpers.ts`: the plants' names, the fixture and `makeWorld`, the readers of `deep`'s print and of the window. Reuses
  `../2018/helpers.ts` (seeder, record, rows, CLI, replica, builds), `../16/helpers.ts` (hub, ULIDs) and
  `../26/helpers.ts` (seeding), as #2019's suite does.
- `rows.test.ts` (AC1, AC2, AC3, AC4, AC6, AC7), `check.test.ts` (AC5).
- `TASTE.json`, `lane.json`, `tsconfig.json`.
- `BASE-FAILURE.txt`: the run of both files at the base, and what the base shows of the fixture.
