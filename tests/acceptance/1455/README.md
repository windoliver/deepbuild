# Acceptance tests for #1455: what a person reads holds no fixture text, tagline or internal name

Written first and blind, at base commit `dd83ac2f` (origin/main), from issue #1455 (its Scope, seven acceptance
criteria and Proof), the epic #1453, its dependency #1454, #1348's word list, the design and the base, before any
implementation. The implementing agent does not edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft
of this job (design: Dogfooding). `TASTE.json` is the one file here a person's call changes.

**Read this first.** Every file ran at the base on this Mac, and `BASE-FAILURE.txt` says what each reached. The process
that ran them had Accessibility and Screen Recording (#1454's `probe access` read both), so AC7 did drive the real app:
it took seven of its eight pictures at the base and failed only on the missing `test-bound` seam. Without those two
permissions AC7 stops `BLOCKED` at #1454's probe before it builds anything. AC4's byte comparison read `INCONCLUSIVE` at
the base: the machine was under a load of about 150 to 240 and the free disk the doctor reports moved between every
pair of runs (README, Disputes 8).

## What was read

- **The issue**: its problem, Scope (fixture words leave shipped views, the chart drawn only with deadlines, a
  session's page title, the filler, the card's first line from #1348's list, labels before the fact, notifications-off
  outside the count, one count sentence, `SET_UP_LINE`'s one source, `deep doctor`'s `Fix:` and summary line, `deep
  --help`'s groups), the seven criteria and Proof ("The string dump before and after, each removal mapped to its
  reason, with each planted view failing"). Epic #1453 (its rules and pinned words), #1454 (the replica draws the real
  app's tree), #1348 and `contracts/plain-words.json`.
- **The design**, `docs/technical-design.md`: States people see ("What a person reads holds no fixture text, tagline
  or internal kind name"), How it installs (Set up's one line, `deep setup --undo`, `deep doctor`), the Replica, the
  quiet check, Wrong programs and Dogfooding.
- **The base**, for its surfaces only: `crates/deep-replica` (`deep-drive`'s calls, its text snapshot with drawn
  strings as `text_run` nodes and canvas items; `deep-replica --view session --bound`, `--first-screen` and its
  `menu-bar.txt`; the `env-plants` feature), `crates/deep-app` (`views.rs`'s session page, chart, bound panel, Home,
  welcome pane and `count_line`; `kinds.rs`; `question.rs`'s card rows; `setup.rs` and `deep-app --set-up`; `plain.rs`'s
  `planted`), `packages/hub/src/{doctor,setup,plant}.ts`, `packages/cli/src/main.ts`, `scripts/lanes.mjs` (the `plain
  words` lane), and the suites `1348`, `1454`, `1556`, `1002`, `629`, `26` and `19/doctor`.

## How to run

With Node 24.22 first on `PATH`, `cargo` on `PATH`, the workspaces built (`npm ci; npm run build --workspaces`), on
macOS, in a logged-in session:

```sh
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1455 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/1455/tsconfig.json
DA1455_OUT=<dir> ... shown                     # keeps the string dumps, strings.json and strings.<plant>.json
DA1455_SCREENS=<dir> ... pictures              # keeps AC7's pictures, for the taste call
```

- **Builds.** The helpers build `deep-drive` and `deep-replica` with `--features env-plants` and then plain, and the
  plain `deep-app`, each copied out of the target folder to `$TMPDIR/da1455-bin-<uid>/`, so the checkout's
  `target/debug` never holds a plant; and `deep-hook`, which a hub needs. A first build can take 40 minutes. AC4 builds the merge base's CLI in
  `$TMPDIR/da1455-base-<sha>/` (extracted with `git archive`; no worktree is added), and AC7 the merge base's app and
  replica there, with their own target folder `$TMPDIR/da1455-base-target`. Both are kept for later runs.
- **Permissions.** Only AC7 needs Accessibility and Screen Recording for the process running the tests; without them
  it fails `BLOCKED: …`, never passes.
- **Folders and processes.** Homes are under `/tmp/da1455-*` (and #26's and #19's own folders where their helpers make
  them). Nothing touches the real `~/.deepbuild`, `~/.claude` or `~/Library/LaunchAgents`; only what a test started is
  stopped, by PID.
- **Lanes.** The files build and draw, so the folder belongs on `scripts/lanes.mjs`'s one-at-a-time list (`alone`), in a
  macOS lane; the implementer makes that edit. This job edits nothing outside this folder.
- Vitest writes `tests/acceptance/1455/node_modules/.vite/` under `--root`; delete it before committing.

## The surface (my choice where the issue names none)

The tests read the app's own views, not a model of them. A view's strings are what `deep-drive` (#124) sees after
drawing it over a fixture record: every node's accessible name, every string drawn that no node already names (its
`text_run` nodes), and every canvas item's text. Since #1454 the replica draws the real app's tree, with the fixture
supplying the record and nothing else, so these are the strings the real app shows over that record. The judges are
this suite's own (`helpers.ts`), never the implementation's verdict.

### Merged surfaces, used as they are

`deep-drive --out <dir>` and its calls (`launch` with `from: fixture`, `fixture`, `center`; `see`; `act` click;
`wait_for` with `t`; `close` and its trace's `notifications`), `deep-replica --view session --bound <file>` (#629),
`deep-replica --first-screen` and `menu-bar.txt` (#1002), `deep-app --set-up` (#326), `deep --help`, `deep setup`,
`deep doctor [--json]`, `deep hub run`, the `env-plants` feature of `deep-replica` and `DEEP_HUB_PLANT` (#1408), the
record and asks core as #26's suite seeds them, #19's stand-in home, #1454's probe and `App`.

### Pinned here: the implementation must provide these

1. **Plants, selected by `DEEP_HUB_PLANT`, as the base selects them**: read by the app (`deep_app::plain::planted`'s way)
   only in a build with `env-plants`, which `deep-replica --features env-plants` turns on and a release build refuses,
   and, for the CLI's, by `packages/hub/src/plant.ts`'s `activePlant`. Each lives in the component that draws its
   surface, so a string shows only if that component drew it:
   - `card-shows-kind-name` (AC1): the question card's first line reads the ask's internal kind name, `stalled claim`
     for a stalled claim's ask (a choice with options `split`, `fund` and `accept`), as the base draws it.
   - `readout-counts-asks` (AC2): a session page's chart readout shows the session's open-ask count under its hours
     caption, as the base does.
   - `title-draws-id` (AC3): a session page's visible title draws the session's ID (whole, or its first 8 characters)
     where its title was.
   - `count-one-asks` (AC6): Home's count sentence for one open ask reads `1 asks need you`, as the base's does; the
     list and the menu bar stay right.
   - `doctor-healthy-fix` (AC4): `deep doctor` prints a `Fix:` line under the healthy item `hub.socket`.
2. **The chart's canvas items keep the base's IDs**: the chart is the canvas item `session-line`, its caption
   `session-caption` and its readout `session-readout`, each caption and readout a canvas text whose value has `text`.
   With no deadline none of them is drawn. A readout says hours when its caption or itself says `hour`, `h` or `N h`, and
   asks when either says `ask`; it is read as its first number.
3. **A session's page**: some node on the page (starting past the left tenth of the window) has an accessible name holding
   `Session`, for a titled session one holding its task's title too (`Session <title>`, the issue's Scope). Its visible
   title is the topmost string drawn inside that node (or the node's own name, when the replica found nothing else drawn
   in it). The page draws the record's first session when it opens on `deepbuild/session`, as at the base.
4. **The card**: a click on a Needs you row (a `button` whose name holds the question) shows the card in the window, as
   at the base; the card's first line is the topmost string the click added.
5. **The count sentence**, for one open ask: Home, as `deep-drive` draws `deepbuild/home` over the fixture with only its
   last ask (the page: nodes starting past the left tenth of the window), and the list (nodes starting in it) there and
   on `deep-replica --first-screen` for a home whose real hub holds one open ask and whose setup finished, and that
   first screen's `menu-bar.txt`, the menu bar's title, each hold `1 ask needs you`. The first screen opens on Needs you,
   which shows no count sentence, so Home is read where it is drawn.
6. **`deep doctor`'s lines**: each item's lines start at a line, at no indent, holding `<item>:` (or the item's name), as
   the base prints them; its evidence and `Fix:` lines are indented under it. The summary line is a line at no indent
   naming no item, the last line printed.
7. **`test-bound`, a Cargo feature of `deep-app`, in no shipped build** (AC7 only): built with it, the app reads
   `DEEP_APP_TEST_BOUND=<file>`, the same file `deep-replica --bound` takes, and draws those bound values in the bound
   panel on a session's page. At the base only the replica can draw a bound panel, and AC7 asks for one from the real
   app; this is the smallest seam, in the form of #1454's `test-confirm`. A merge base without it is pictured by its
   replica (`before-bound-panel.png`, recorded as `"beforeBoundPanel": "replica"` in `run.json`).

### The fixture

`fixtures/run.events.jsonl`, the record every view is drawn over, on the replica's clock (`NOW`, 1 800 000 000 000 ms):

- `Header layout` (`01PXHEAD000000000000000001`): a task with two open asks, a stalled claim's (split, fund or
  accept; deadline in 6 h) and a choice (deadline in 30 h). Two asks against 6 and 30 hours, so a readout that counts
  asks can't pass for one in hours.
- `Checkout page` (`01PXCHEK000000000000000002`): a task with no ask, so no deadline.
- An untitled session (`01PXQRST000000000000000003`): no task, so its page shows the fallback title.

`fixtures/vitest-header.json`: one failing Vitest assertion, `header height`, expected 32 and received 30, the run the
bound panel binds. The suite checks first that no fixture it draws from (these two and the base's
`docs/spikes/338/fixtures/needs-you.events.jsonl`, which `deep-replica --view session` draws) holds a forbidden phrase,
so a view that shows one shows the app's own words.

### The fixture run (AC1 to AC3)

`fixtureRun()` draws, with the plain build or a plant's: Needs you with the list, then its notifications after 3 s on
the replica's clock; each ask's card, one click on its row; each session's page (the record reordered so that session
is first); Home and the Agents page; the welcome pane, in a home with nothing set up; the bound panel; and `deep
--help`'s lines. Every string goes to `strings.json` (or `strings.<plant>.json`) in `$DA1455_OUT`, each with its view:
the Proof's dump, before and after.

## Criterion to tests

| Criterion | Test | Wrong programs it fails on |
|---|---|---|
| AC1 `#1455.a9f10334` | `shown.test.ts`, the clean run: no string in any view holds `Cart total`, `Repository skeleton`, `returned`, the base's tagline (`Where your agents show, not tell.`, or `show, not tell`), `stalled claim`, `batched authority` or `early question about done`, each as a whole phrase in any case; every card's first line is one of `contracts/plain-words.json`'s plain words and no kind name | the base (the card's `stalled claim` and `choice`, `returned` on the return line, the tagline, the bound panel's `Cart total`, `deep --help`'s last line); `card-shows-kind-name` |
| AC1, plant | `shown.test.ts`: the clean run passes the same judge, then `card-shows-kind-name` fails it with a line naming `stalled claim` and the card | a judge that misses it, or names it without the view |
| AC2 `#1455.a4bb90cd` | `shown.test.ts`: the pages of `Checkout page` and the untitled session draw none of the chart's items and no string saying `deadline`; `Header layout`'s draws the chart, its caption once among the strings drawn, and a readout in hours within 1 h of one of its deadlines (6 and 30) | the base (a chart on every page, the caption twice, a readout of 2 asks); `readout-counts-asks` |
| AC2, plant | `shown.test.ts`: the clean run passes, then `readout-counts-asks`'s readout equals the session's asks and a failure names both the caption's text and the readout's | |
| AC3 `#1455.3fc1eb9d` | `shown.test.ts`: on each session's page a node named with `Session` (and the task's title), whose visible title holds the task's title and no 8 characters of the session's ID | the base (no name holds `Session` on a titled page; `Session 01PXQRST` drawn on the untitled one); `title-draws-id` |
| AC3, plant | `shown.test.ts`: the clean run passes, then `title-draws-id` fails naming a session's ID and its raw ID | |
| AC4 `#1455.3231786f` | `doctor.test.ts`: in #19's healthy world, `deep doctor` prints no `Fix:` under an item whose `--json` level is `ok` (none at all when every item is ok) and exactly one summary line, last; `deep doctor --json` equals the merge base's CLI's byte for byte on the same home, once two runs of this checkout agree (else `INCONCLUSIVE`) | the base (a `Fix: Nothing to do.` under each healthy item, no summary line); `doctor-healthy-fix`; a change to `--json` |
| AC4, plant | `doctor.test.ts`: the clean doctor passes, then `doctor-healthy-fix` fails naming `hub.socket` | |
| AC5 `#1455.214950f1` | `setup.test.ts`: the one line `deep setup` prints (naming `deep setup --undo`) equals the one `deep-app --set-up` prints, holds `watch-only mode` and `deep setup --undo`, and the shipped source (`packages/`, `crates/`, `contracts/`, without tests, fixtures, build output or a Rust file's `#[cfg(test)]` part) holds each line's longest literal piece (no quote, backslash or path in it) once | the base: `deep setup` prints another line (`…added its hooks and status line forwarder to <path>… Its gates are watch-only until…`) than the app's `SET_UP_LINE`, which is defined in both `packages/hub/src/setup.ts` and `crates/deep-app/src/setup.rs` |
| AC5, plant | `setup.test.ts`: the clean tree passes, then the same files with a planted `crates/deep-app/src/set_up_copy.rs` holding the line fail naming that file | |
| AC6 `#1455.71693552` | `count.test.ts`: with one open ask, Home and the list as `deep-drive` draws Home, and the list and the menu bar's title on the first screen of a home whose hub holds one ask, each read `1 ask needs you`, and none says `1 asks` or `1 ask need you` | the base (Home's `1 asks need you`, the menu bar's `1`); `count-one-asks` |
| AC6, plant | `count.test.ts`: the clean run passes, then `count-one-asks` fails naming Home | |
| AC7 `#1455.89be1755` | `pictures.test.ts`: the merge base's app and this checkout's, each on a real hub in a temp home at the reference window, write `before-` and `after-` `first-screen`, `question-card` (once the card's options are on the tree), `session-page` and `bound-panel` `.png` and `run.json` (the base's commit, both apps' SHA-256, and where the before bound panel came from), each state on the window's tree before its picture; then `TASTE.json`: no call, an anonymous one or one on other files is `INCONCLUSIVE`, `looks_wrong` fails quoting its note, `looks_right` on exactly these files passes | no call recorded (`INCONCLUSIVE`); an app with no `test-bound` (the base: its after bound panel is missing, named) |

No test passes when its surface is missing: a missing build, plant, view, node or file stops the test `BLOCKED: …` or
fails naming what's missing. A plant's test holds the clean run to the same judge first, so a program that already
fails the criterion can't make its plant look caught, and a plant the build ignores fails ("wasn't caught").

The judges were run against throwaway twins in a scratch folder, never committed: a right twin of each criterion's
strings passed, and each wrong twin failed the judge the table names, with the message shown (AC1: the card's kind
name, `choice`, a first line off the list, `Cart total` in the bound panel, `returned`, the tagline, `Repository
skeleton.`, a kind name elsewhere; AC2: readout counting asks, a chart with no deadline, the caption twice, an asks
caption over hours, no caption; AC3: no `Session` name, the ID drawn by the fallback and by the plant, a title not the
task's, and an ID in the list that must not count; AC4: the base's output, the plant, two summary lines, the summary
first; AC5: two copies, none; AC6: `1 asks`, a bare number, `1 ask need you`). That shows the judges' logic, not any
implementation.

## The taste call (AC7)

`$DA1455_SCREENS` (a temp folder without it) gets the eight pictures, each 3024 × 1964 px from the real window, and
`run.json`. The criterion names no appearance, so the pictures are light. `TASTE.json` is #1454's shape, and its
`verdict` is `null` until a person calls it. Take the pictures once, call them, record them with each file's SHA-256,
and run again against the same folder: a kept folder holding exactly the files of a recorded call, with the same
`run.json`, stands without new pictures.

## Disputes and assumptions a redraft may revisit

1. **"The real app" for AC1 to AC3 is the replica's drawing of the app's views** (#1454's promise that the replica draws
   the real app's tree), read through `deep-drive`, so they run without OS permissions. A real-window dump would read
   the same through #1454's probe and Vision OCR, at the cost of Accessibility and Screen Recording.
2. **What the dump covers.** The views the app has over the fixture (Needs you, the list, each card, each session's
   page, Home, Agents, the welcome pane, the bound panel, notifications) and `deep --help`, which AC1 names through
   `Repository skeleton`. The menu bar is judged in AC6's world. A view the replica can't draw isn't in it.
3. **`returned`, `Cart total` and the kind names are judged in every string**, not only on the return line, the panel or
   the card: the fixtures hold none of them, so any one shown is the app's own words.
4. **The tagline** is the base's welcome-pane sentence; a reworded tagline would escape AC1's judge (the quiet check,
   #1464, owns sentences in the chrome).
5. **"A plain word, from #1348's list"** is read as one of the list's plain words (its values), compared in any case.
   Adding kind names to the list with their plain words satisfies it.
6. **A raw ID** is any 8 characters of the session's ID, the base's own short form (`Session 01MCBH57`), so an untitled
   session's visible fallback may not draw it; its accessible name may.
7. **A healthy fixture** is #19's world where everything is right; items this fixture can't make ok (the test prompt
   without `--prompt`, the app's notification setting with no app) may print a fix, and the test judges only items
   whose level is `ok`.
8. **"Byte-equal to the merge base's"** runs the merge base's CLI, built in its own tree, against the same home and hub,
   between two runs of this checkout's; when those two differ (the free disk and a free port are read live) it tries five
   times and then reads `INCONCLUSIVE`, never PASS. On a busy machine that is the likely outcome; run it on a quiet one.
   At the base itself the two are the same program.
9. **"From one definition"** is read in the source: the shipped files hold the line once. A line read at run time from
   one file both sides load passes.
10. **"Before"** is the merge base's app. A merge base with no bound-value seam has its bound panel pictured by its
    replica, the only place it drew one.
11. **Not covered by a criterion, so not tested:** the bound panel's title coming from what it binds, the chart's
    accessible name generated from its items, labels before the fact (`Saved for this repo`), a model field with no
    image, notifications-off as its own row, the untitled fallback having one form everywhere, and `deep --help`'s
    groups.

## Files

- `helpers.ts`: the builds, the `deep-drive` client, the fixture run, the string reader, every judge, the merge base.
- `shown.test.ts` (AC1, AC2, AC3), `count.test.ts` (AC6), `doctor.test.ts` (AC4), `setup.test.ts` (AC5),
  `pictures.test.ts` (AC7).
- `fixtures/run.events.jsonl`, `fixtures/vitest-header.json`: the record and the bound panel's run.
- `TASTE.json`: AC7's taste call, unrecorded. `tsconfig.json`: as #1348's. `BASE-FAILURE.txt`: the run at the base.
