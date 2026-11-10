# Acceptance tests for #1461: one list and one page, the window the app opens

Written first and blind, at base commit `d51be2c3`, from issue #1461 (updatedAt 2026-11-10T09:29:53Z: its problem, Scope,
29 acceptance criteria and Proof, with the owner's Nov 9 comments: a `sidebar` panel opens as a page and adds nothing to the
list; the one unread rule; `Tasks`, moved from `Sessions` by #1348), the design and the base, before any implementation. The
implementing agent does not edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding).

## What was read

- Issue #1461 and its comments; epic #1453 for rule 7 (one line at rest) and rule 14 (the lane); #328, #329, #2020 and #1462
  only for the words #1461 cites (presence: input in the last 2 minutes, the screen awake; the View menu).
- `docs/technical-design.md`: Keymap, placement, window (One list and one page, Address, Actions, Pages); Needs-you view;
  Replica; States people see (the row shape, the table); First-party extensions that ship on by default (the view row);
  Panels and devices (trusted ring); Dogfooding.
- At the base: `crates/deep-app/src/{views,card,question,answer,words,record,notify,open,commands,installed,plain,states}.rs`
  and `Cargo.toml`; `crates/deep-replica/src/drive/{mod,frames,locate,glyphs,plant}.rs`, `snapshot.rs`, `lib.rs`;
  `packages/hub/src/{rows,status,core}.ts`, `packages/record/src/projections.ts`, `packages/asks/src/index.ts`,
  `packages/extension-host/src/host.ts`, `packages/contracts/extension-api.json`; `scripts/proof-change.mjs` (criterion IDs),
  `scripts/benchmark.mjs`; the suites `1459`, `1460`, `1463`, `1458` (and its AC13 redraft), `1454`, `1172`, `1551`, `26`, `16`.

## How to run

With Node 24.22 first on `PATH`, cargo on `PATH`, Xcode's command line tools (`swiftc`), on macOS, in a logged-in,
unlocked session:

```sh
npm ci --ignore-scripts && npm run build --workspaces
caffeinate -di npx vitest run --root tests/acceptance/1461 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1461/tsconfig.json
```

- **Builds.** The helpers build each binary once a run with #1172's build environment (`CARGO_INCREMENTAL=0`,
  `CARGO_PROFILE_DEV_DEBUG=0`) and copy it out of the target folder into `$TMPDIR/dd1461-bin-<uid>`: `deep-drive` with
  `--features deep-app/test-confirm` (the plain replica) and with `--features env-plants,deep-app/test-confirm` (the planted
  one); `deep-app` plain, with `--features env-plants` (AC1's plant) and with `--features test-confirm` (AC28's recording);
  `deep-hook` when it's missing. `CARGO_TARGET_DIR` is honored. The hub's `orderOf` is read from `packages/hub/dist/rows.js`,
  so the workspaces must be built.
- **Permissions.** `shell.test.ts` (AC1, AC14) and `shown.test.ts` (AC28) read the real window from outside its process: the
  process running the tests needs Accessibility and Screen Recording. Without them those tests fail `BLOCKED: …`, never pass.
- **Folders and processes.** Homes and outputs are under `/tmp` (#16's `tempDir`). Nothing touches the real `~/.deepbuild`,
  `~/.claude` or `~/Library/LaunchAgents`. Only what a test started is stopped, by PID.
- **Timing.** AC9's 100 ms is judged only on a fit, quiet reference Mac (#1551's gate); elsewhere it reads INCONCLUSIVE.
- **Pictures.** AC28 writes to `$DA1461_SCREENS` (a temp folder without it). It reads INCONCLUSIVE until `TASTE.json`'s call is
  recorded on exactly that run's files.
- **`--root` cache.** Vitest writes `tests/acceptance/1461/node_modules/.vite/`; delete it before committing.
- **Lanes.** `scripts/lanes.mjs` needs `tests/acceptance/1461/` in a macOS, logged-in lane that runs it one file at a time, and
  AC28 by hand as #1458's AC13 is; the implementer makes that edit.

## The surface (my choice where the issue names none)

Every fixture is a record a real hub made (`helpers.ts` `makeWorld`): sessions, titles, states (`session.attention`, as the
core says a turn ended) and asks (through the asks core, a push's with its plan) are seeded with the hub stopped, through
#26's `seed`, each session's worktree a git folder named for its project; then `deep hub run` starts and builds the list's
rows (`row.set`) as its first backfill. The app is read as the real `deep-drive` (#124), launched with `launch.from:
"record_copy"` in the world's HOME, on its virtual clock, except where a criterion names the real app (AC1, AC14, AC28),
which is the real `deep-app` read from outside its process (#1459's probe for identifiers, #1454's driver, capture and
recorder). A change made elsewhere is fed to a running replica as the hub writes it: a state change is the row's `row.set`
(unread, as the core sets it on a change), a new ask its `ask.created` and its row, an answer from `deep` its `ask.answered`
(via the CLI) and the row leaving the list; each `row.set` is placed by the hub's own `orderOf`. AC19 reads #328's fixture,
the replica's own default record (#338's, with its held ask). No label, reply or log line credits a criterion.

### Pinned here: the implementation must provide these

1. **The window in the snapshot**, in the replica's `see` and, by #1459's rule, in the real tree's AXIdentifiers:
   - the list: one node `id: "list"`, named `Tasks`;
   - its headings: `id: "heading:needs-you"` first (named `Needs you`, valued the one count once it's read), then
     `heading:<project>` for each project, `<project>` being the rows' `project` value (the repo folder's name);
   - its rows: #1459's and #1463's ids, `ask:<ULID>` and `session:<id>`, and `quiet:<project>` for a project's folded quiet
     sessions. Each row's four slots are nodes with the slot's own bounds: `<row id>:mark`, `<row id>:title`, `<row id>:word`
     (the state word, or an ask's kind) and `<row id>:time`. A folded, later or held ask's row holds `folded`, `later` or
     `held` in its value and in its state-word slot;
   - the page: #1460's one node whose `id` is the address it shows. A project's address is `project/<project>`, as above. On
     every page: its title `id: "page-title"`, its reading lane `id: "lane"`, and, when it's empty, its empty line `id:
     "empty"`, named by the line and valued by its mark's status-map entry (`idle` is the calm one);
   - the box on every page, with #1998's ids: `box`, its text field `box-draft` (valued its words) and its send control
     `box-send`, whose name on an ask's page says what the press does (`Answer`, or `Say no` on an approval holding words);
   - the card `question-card`, valued `armed` once armed (#1459, #1460); the snapshot's `focus` the focused element's id.
2. **Runs carry their weight.** Each string in `see`'s `snapshot.runs` has `weight`, the font weight its glyphs were shaped at:
   400 regular, 500 medium. An unread row's title is medium, a read one's regular.
3. **Launch options** of `deep_drive`'s `launch`, beside the merged ones (`from`, `size`, `clock`, `panel`, `view`):
   - with no `center`, the replica opens where the app opens: the first open ask, else the project with the latest activity;
     `see`'s `address` names it;
   - `setup: "unfinished"`: the first-launch window, as on a machine whose setup hasn't finished (the default is finished);
   - `hub: "answering" | "stopped" | "slow"`: how the hub the app reads answers from launch; `slow`: the app's reads neither
     answer nor fail, so nothing is read yet;
   - `area: "sidebar" | "home" | "line"`, with `panel` and `view`: the panel placed as an installed view registered to that
     area with `deep.registerView` is placed in the app (installed.rs, `views::place`): `home` under a project's picture on
     its page, `line` on a session's page, `sidebar` a page opened from ⌘K and the View menu;
   - `replaces: "needs-you"`, with `panel`: the panel installed as the view replacing Needs you, which draws the list's first
     section under Needs you's heading.
4. **Calls** of `deep_drive`:
   - `{"call": "hub", "hub": {"state": "answering" | "stopped" | "slow"}}`: from that frame on, as the app's hub watch reads
     the hub at its tick;
   - `act {"kind": "click", "point": [x, y]}`: a press at that point in device pixels now, with no locator and no wait for
     stillness: what a person's press does where the pointer is;
   - `act {"kind": "menu", "path": ["View", "<item title>"]}` picks a menu bar item as a click on it would, and `see` answers
     `menus: [{title, items: [{title, enabled}]}]`, the app's menu bar (#1462's View menu, every page listed);
   - presence: the replica's window is the front window and its screen awake and unlocked; each `act` is your input at the
     replica's clock, and you're present within 2 minutes of one (#2020's presence).
5. **The replica stands in for the hub, and its trace keeps what the app sent.** `close`'s trace file holds `hub: [{t, method,
   params}]`: every call the app makes to the hub that writes (`ask.answer` with #327's params, `row.read`, the box's words).
   None reaches a hub, the one `record_copy` read included. The replica applies `ask.answer` to its own record as the hub does
   (`ask.answered`, then the ask's `row.set` with `listed: false`) and `row.read` as the row's `row.set` with `unread: false`.
   A press on the card in a replica counts once the OS confirms you through `test-confirm`'s file (`DEEP_APP_TEST_CONFIRM`).
6. **The hub learns a read: `row.read`.** A hub method the app calls on its app connection, `{"id": "<row id>"}`, that
   appends the row's `row.set` with `unread: false`, so `deep status --json` reads it read. A changed row nothing read stays
   unread.
7. **Recorded moves: `crates/deep-app/moves.json`.** A JSON array of `{"from": "<merge base's name>", "to": "<its name now>",
   "by": "#<issue>"}`. A name of the merge base's shell (`fixtures/base-names.json`) the tree no longer holds needs one, with
   its `to` in the tree.
8. **Plants: environment plants**, each selected by `DEEP_HUB_PLANT=<name>` and read through `plain::planted` in builds with
   `env-plants` only (`deep-drive --features env-plants,deep-app/test-confirm`; `deep-app --features env-plants` for AC1's),
   everything else as shipped:
   - `card-replica-only` (AC1): the question card drawn in a replica (a build with `fixtures`) and not in the real app.
   - `band-repeats-row` (AC2): a band along the window's foot, a node `id: "band"`, drawing the selected row's title and state
     word as strings, with no node of its own inside.
   - `list-closes-gap` (AC4, AC24): a row leaving its state leaves its slot at once, whatever the pointer and focus, and the
     rows after it move up.
   - `unread-on-message` (AC5): an agent's message (`session.activity`) marks its session's row unread in the app.
   - `row-24` (AC10): every list row is 24 tall.
   - `page-no-lane` (AC11): a session's page draws its content and its box the page's width, with no lane.
   - `down-at-first-miss` (AC15): the window says the hub isn't answering at the first read that gets no answer.
   - `card-field-and-box` (AC16): an ask's page draws a text field on the card as well as the box below.
   - `box-starts-work` (AC16): the box on an ask's page sends its words as it does elsewhere, as new work, instead of answering.
   - `read-needs-reopen` (AC17): a change to a row whose page is already open stays unread until its page is opened again.
   - `read-when-drawn` (AC17): a row drawn in the list for a second while you're present reads read.
   - `press-through-move` (AC18): a press on a row that moved in the last 300 ms goes to the row now under the pointer.
   - `wait-by-ink` (AC19): a folded, later or held ask's row carries the open ask's value and state word, set apart only by
     ink, indent or slant, as the base draws it.
   - `empties-alike` (AC20): not read yet is drawn as couldn't read, with the same line and mark.
   - `blank-first-page` (AC21): the page right after Set up draws the box and nothing above it.
   - `agent-as-row` (AC21): each agent waiting for a first session is a list row.
   - `box-on-first-launch` (AC22): the first-launch page draws the box beside Set up.
   - `words-read-yes` (AC23): words that start with "yes" on an approval answer with its allow option.
   - `list-drops-presses` (AC25): the list drops every press on a row.
   - `box-grows-past-10` (AC26): the box grows with its lines past 10.
   - `ask-words-alike` (AC27): every ask row's state word is `needs you`, whatever its kind.
   - `sidebar-panel-in-list` (AC29): a panel registered to `sidebar` adds a list section, a heading `heading:<view name>` with
     the panel under it, as the base placed it in the sidebar.
9. **The perf lane.** `benchmarks/budgets.json` has a task `app-select-700`, its `initialReason` naming `#1461`, valid against
   the merge base's budgets (`scripts/benchmark.mjs` `validateBudgets`), whose command exits 0.

### Merged surfaces, used as they are

`deep hub run` and `deep status --json` (#1463: rows with `unread`); the record and asks core through #26's `seed`; #16's
hooks, `openAs` and PID cleanup; #1463's `quiet` and `jsonRows`; `deep-drive --out <dir>` and its `launch` (`from:
record_copy | fixture | empty`, `size`, `clock`, `panel`, `view`), `see` (`snapshot` with `runs`, `focus`; `rows`; `address`),
`act` (`click`, `hover`, `type`, `press`, `set`), `open {address}`, `feed`, `wait_for` and `close`; `deep-replica --view-kit
needs-you@1` and #1459's replacement views; #1454's `App` (launch, press, capture, recorder) and probe; #1459's probe `tree`
with identifiers; deep-app's `test-confirm` and `DEEP_APP_APPEARANCE`; #1551's reference-Mac gate.

### The fixtures

`helpers.ts` `TEN` (AC1, AC2, AC14): ten sessions in shop, docs and search, two with an open ask each (a taste call, the
oldest, and a choice). Each file's own `SessionSpec` lists say the rest: a push approval with its plan (AC16, AC23, AC26), two
kinds of ask (AC27), 50 finished sessions with one ended failed (AC12), 700 working sessions in seven projects (AC9), a
project whose one session was archived (AC20), working sessions for the clock journey (AC17). `fixtures/panel`: the test panel
(`Test panel`, or `Test panel page` opened as a page). `fixtures/base-names.json`: the fixed names the merge base's shell draws,
each with its file and line at `d51be2c3`. #1459's `fixtures/views` (the replacement Needs you and its twin hiding the oldest
ask) and #338's record are used where they are.

## Criterion to tests

IDs are `criterionId` in `scripts/proof-change.mjs`.

| Criterion | ID | Tests | Wrong programs it fails on |
|---|---|---|---|
| AC1 | `#1461.0fe5469a` | `shell.test.ts`: the real app at 960×640 and 1512×982 holds both ask rows in the list, the card armed on the first ask and beside the list, each session's row under its project's heading, and every view the replica draws of the same record | the base (no `list`); `card-replica-only`, naming `question-card` |
| AC2 | `#1461.f6f74e03` | `shell.test.ts`: on that record, the replica's drawn strings hold "needs you" at most twice | the base (the sidebar's rows, Needs you's title and rows); `band-repeats-row`, naming `band` and the phrase |
| AC3 | `#1461.a76b84c6` | `opens.test.ts`: with no ask it opens on `project/docs`, the page reads "Nothing needs you", no count says more; with the hub stopped the list and the page say "The hub isn't answering" with a clock time, and no count reads 0 | the base (opens on Needs you; no `hub` door) |
| AC4 | `#1461.c3edd46c` | `moves.test.ts`: pressing the first ask's option opens the second ask, every other row in place, the answer in the trace | the base; `list-closes-gap`, naming the row that moved |
| AC5 | `#1461.2a4294f3` | `unread.test.ts`: a changed row medium, one with only an agent's message regular, the changed one regular a second after its page opened | the base (no `weight`); `unread-on-message`, naming the row |
| AC6 | `#1461.2829325f` | `tree.test.ts`: the list named `Tasks`, its first heading `Needs you`; the five named names; every base name in the tree or moved | the base (no `list`) |
| AC7 | `#1461.a07a4336` | `tree.test.ts`: the replacement view passes `needs-you@1` and, installed, draws the list's first section with a row per open ask | the base (no `replaces`); #1459's `hides-oldest`, the kit naming the oldest ask |
| AC8 | `#1461.f52d256a` | `tree.test.ts`: `deep.registerView`'s contract as at the merge base; the test panel on a project's page from `home` and on a session's page from `line` | the base (no `area`: the panel sits in the sidebar) |
| AC9 | `#1461.6d2351eb` | `budget.test.ts`: the perf lane's `app-select-700` is valid and runs; with 700 rows, presses on rows select within 100 ms at p95, no spinner, on a fit quiet reference Mac, else INCONCLUSIVE | the base (no task; no press at a point) |
| AC10 | `#1461.52fe1d2f` | `rows.test.ts`: every row 32 tall, 8 in from the list's edges, its slots in place; headings 32 with 8 above; no gap between rows | the base (no slots); `row-24`, naming the row |
| AC11 | `#1461.60e6f710` | `page.test.ts`: the session page's lane is `min(720, page − 48)` and centred, and every string under its title is in it | the base (no lane); `page-no-lane`, naming the page |
| AC12 | `#1461.3783feb3` | `unread.test.ts`: on the hub's backfill of 50 finished sessions, `deep status --json` and the app's weights read only the failed one unread | the base (no `weight`) |
| AC13 | `#1461.88d0792f` | `moves.test.ts`: an ask answered from the CLI keeps its row's slot 1.5 s and leaves by 2.5 s; a new ask's row is there a frame after it arrives | the base (the row leaves at once) |
| AC14 | `#1461.5656e667` | `shell.test.ts`: the real window's pixels at rest hold one stroke, at the list's edge | the base (the title bar's, the dock's and the band's lines) |
| AC15 | `#1461.59067fcc` | `page.test.ts`: no "isn't answering" over a 200 ms outage; within 2 s and for 400 ms over a 1 s one, frame by frame | the base (no `hub` door); `down-at-first-miss`, naming the frame |
| AC16 | `#1461.7b00f436` | `box.test.ts`: one text field on the ask's page; the words sent make one `ask.answer` with those words and no option, close the ask, and nothing else | the base; `card-field-and-box`, naming both fields; `box-starts-work`, naming the call |
| AC17 | `#1461.120f6702` | `unread.test.ts`: the clock journey's three cases by weight, with `row.read` sent for the two read and not the one drawn; and `deep status --json` unread after a change until `row.read` | the base (no `weight`, no `row.read`); `read-needs-reopen` and `read-when-drawn`, each naming the row |
| AC18 | `#1461.c16105e5` | `moves.test.ts`: a press 100 ms after a new ask shifted the third session row leaves the window where it was | the base (no press at a point); `press-through-move`, naming both rows |
| AC19 | `#1461.d5aa2f05` | `rows.test.ts`: on #328's record, the folded, later and held rows name their state in value and state word | the base (ink, indent, slant); `wait-by-ink`, naming the row |
| AC20 | `#1461.ca4ce66c` | `opens.test.ts`: the three pages' empty lines differ pairwise in words and mark, only the first `idle` | the base (no `empty`); `empties-alike`, naming the pair |
| AC21 | `#1461.140dcfed` | `opens.test.ts`: with no record the page holds the box, focused, and words above it; the list no row | the base; `blank-first-page`, naming the page; `agent-as-row`, naming the row |
| AC22 | `#1461.4d23f757` | `opens.test.ts`: the first-launch page's one control is the Set up button | the base (no `setup` launch option); `box-on-first-launch`, naming the box |
| AC23 | `#1461.731bc2c6` | `box.test.ts`: on the push's page the send reads `Say no`, the one `ask.answer` carries the words and no allow, the ask closes, nothing else is sent | the base; `words-read-yes`, naming the call |
| AC24 | `#1461.fc59e373` | `moves.test.ts`: nothing moves under a resting pointer; with focus in the list the answered row stays, drawn answered, and leaves 2 s after focus and pointer leave | the base; `list-closes-gap`, naming the row |
| AC25 | `#1461.97cc6522` | `moves.test.ts`: a press 400 ms after the move opens the row now under the pointer | the base (no press at a point); `list-drops-presses` |
| AC26 | `#1461.a732cea0` | `box.test.ts`: the box 2 lines tall with 1, a line taller per line, the same at 12 as at 10 with no more than 10 drawn and all 12 kept, the lane's width | the base (no lane, one-line field); `box-grows-past-10`, naming its height |
| AC27 | `#1461.a024b727` | `rows.test.ts`: the approval's and the choice's state-word slots differ | the base (both `needs you`); `ask-words-alike`, naming the pair |
| AC28 | `#1461.b6f49051` | `shown.test.ts`: 16 pictures from the real app and `answering.gif`, then `TASTE.json`: INCONCLUSIVE until a recorded call on exactly these files | none: a picture is never judged here |
| AC29 | `#1461.c706a4a7` | `tree.test.ts`: the sidebar panel leaves the list's rows and headings as without it, and opens as a `page/` address from ⌘K and from the View menu | the base (the panel sits in the sidebar; no menus); `sidebar-panel-in-list`, naming the panel |

One criterion-tagged test passes at the base on purpose: AC7's wrong-program test, since #1459's kit and its `hides-oldest`
view are merged and the kit already names the oldest ask; AC7's fill test is the one that fails there. AC17's `deep status
--json` half reads a changed row unread at the base and fails only on `row.read` (BASE-FAILURE.txt).

## Scope the criteria don't cover

No criterion names these, so nothing here tests them: the list's width, resize, double-click reset and hiding under 848; the
title bar's and scroll bars' behaviour past AC14's one line; the transient states other than the hub not answering (stopping,
reconnecting); the box's 12 inside, radius and fill; "Answers this ask only" and "Sends your words as the reason; this won't
run" above the send control; the order inside a state by when work last changed hands; the Decided page and #1808's cases;
the starters' words (#1109); the safety list; the menu bar's other menus.

## Disputes and assumptions a redraft may revisit

1. **Where the row's slots sit.** "The list inset is 8 and the row inset 8, so titles sit 16 from the edge. The mark slot is 16
   with 8 after it" is read as: the row 8 in from each edge of the list, its mark slot 8 into the row (16 from the list's edge),
   the title 8 after the mark slot (40 from the edge), the time ending 8 before the row's edge. A reading with the title at 16
   and the mark in the inset would fail AC10's mark and title checks.
2. **A project's address** is `project/<project>`, the rows' `project` value (#1460 says only `project/<id>`).
3. **Presence in a replica** is its own input: each `act` at its clock, its window the front one. The real app's presence (the
   OS's idle time, a locked screen) isn't driven here.
4. **AC17's "in deep status --json"** is proven in two halves: the replica's trace says which rows the app tells the hub it
   read (`row.read`), and a real hub reads a changed row unread until `row.read` comes. No real app sends it end to end, since
   only the replica has a virtual clock.
5. **AC16's "naming the session".** A replica starts no session; the failure names the call that would start one.
6. **AC23's "closes as no"** accepts an `ask.answer` with the approval's deny option or with no option, carrying the words; a
   redraft may require the deny option.
7. **AC9's paint** is measured in the replica on its real clock, the press at a point through the two frames drawn after it,
   by wall time; not in the real app, whose paint no outside reader times.
8. **AC14's line** is read from the real window's pixels as a stroke 1 or 2 pixels thick whose two sides agree, across 60% of
   the window. A boundary between two fills isn't a line. A redraft may read it from the scene instead.
9. **AC6's merge-base names** are read from the base's source (`fixtures/base-names.json`), not from a base run, since a cold
   build on this machine wasn't quick; a redraft may capture them from the base's replica.
10. **AC12's "first launch"** is the hub's first build of the list over a record that holds no rows yet (`rowsFirst`).
11. **AC20's "calm"** is the status-map entry `idle`; "differ in text and in mark" compares the empty line's words and value.
12. **AC19's words** are the inbox's own, `folded`, `later` and `held`, in the value and the state-word slot.
13. **AC2 counts drawn strings**, not accessible names: what one screen shows.
14. **The View menu door** (Pinned 4) is pinned here because #1462 isn't merged; if #1462 lands its own, a redraft uses it.
15. **Plants are environment plants** in one planted build of each binary, not one Cargo feature each, to keep the builds few.

## Files

- `helpers.ts`: IDs, builds, `makeWorld` and `TEN`, the replica driver and the doors, the events a change feeds, the window's
  readers (list, rows, slots, page, weight, zero counts, clock times), the real app's tree with identifiers. Reuses
  `../16/helpers.ts`, `../26/helpers.ts`, `../1463/helpers.ts`, `../1459/helpers.ts`, `../1454/helpers.ts`, `../1551/helpers.ts`.
- `shell.test.ts` (AC1, AC2, AC14), `opens.test.ts` (AC3, AC20, AC21, AC22), `moves.test.ts` (AC4, AC13, AC18, AC24, AC25),
  `unread.test.ts` (AC5, AC12, AC17), `box.test.ts` (AC16, AC23, AC26), `rows.test.ts` (AC10, AC19, AC27), `page.test.ts`
  (AC11, AC15), `tree.test.ts` (AC6, AC7, AC8, AC29), `budget.test.ts` (AC9), `shown.test.ts` (AC28).
- `fixtures/panel/main.js`, `fixtures/base-names.json`, `TASTE.json`, `tsconfig.json`, `BASE-FAILURE.txt`.
