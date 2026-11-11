# Acceptance tests for #2028: unread marks in Needs you, a changed row's medium title from the record, never added to the one count

Written first and blind, at base commit `04f44a4ba` (which holds #1461 and #2026 merged), from issue #2028 (its Scope,
its "Reads under #1453, Nov 9" paragraph, both acceptance criteria and its Proof), the design and the base, before any
implementation. The implementing agent does not edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft
of this job (design: Dogfooding).

## What was read

- **The issue**: Scope (a changed row's title is medium until its page has been open a second while you're present, by
  #1461's one unread rule; marks come from the record, never add to the one count and never notify; with no state change
  nothing is marked), Reads under #1453 (unread is #1461's one rule with no 30-minute threshold; Decided for you is the
  Decided page), both criteria, Proof.
- **The issues it names, for their words**: #1461 (the one unread rule: "A row is unread from a change in its state until
  its page has been open in the front window for a second while you're present"; a row drawn in the list doesn't clear
  it; the row model carries it as `unread`; the owner's Nov 9 decision), #2026 (the one count on the menu bar, the
  list's Needs you heading and `deep inbox`), #328 (the parent) and its sibling #2020 (presence by #329's test: input in
  the last 2 minutes, the screen awake and unlocked).
- **The design**, `docs/technical-design.md`: First-party extensions that ship on by default, the view row ("One count
  of what needs you appears everywhere", "The count lives in the hub", "An item leaves Needs you only on your answer, a
  rule, its deadline, or when it's superseded or moot, never because you looked"); States people see (the words PASS,
  sent back, BLOCKED, working and their status-map entries; one row shape the hub builds, `row.set`, which the app and
  the replica fold); Decided.
- **The base**, for its surfaces only: `crates/deep-app/src/{unread,open,list,views,lib,plain}.rs` (the one rule, the
  weight, the count and its heading, the menu bar's line, plants); `crates/deep-replica/src/drive/{mod,frames}.rs` and
  `snapshot.rs` (the virtual clock, `feed`, `see` with run weights and `menu_bar.title`); `packages/hub/src/{rows,
  status,inbox,plant}.ts` (`settle`'s unread, `row.read`, `deep inbox`'s count, `activePlant`); the contracts of
  `row.set`, `session.activity` and `decision.applied`; the suites `16`, `26`, `1463`, `1461` and `2026`.

## How to run

With Node 24.22 first on `PATH`, cargo (1.99.1) on `PATH`, on macOS:

```sh
npm ci --ignore-scripts && npm run build --workspaces
# optional, to build ahead; #1461's helpers build what's missing themselves
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -p deep-hook --bin deep-hook
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -p deep-replica --bin deep-drive --features env-plants,deep-app/test-confirm
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -p deep-replica --bin deep-drive --features deep-app/test-confirm
npx vitest run --root tests/acceptance/2028 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/2028/tsconfig.json
```

- **Builds.** #1461's helpers build `deep-drive` with `deep-app/test-confirm` (as shipped) and with `env-plants` too (the
  planted build), each copied out of the target folder into `$TMPDIR/dd1461-bin-<uid>/`, and `deep-hook` into the
  checkout's target when it's missing. `CARGO_TARGET_DIR` is honored. The workspaces must be built: the hub, the CLI
  and the hub's `orderOf` (`packages/hub/dist/rows.js`) come from there.
- **Time.** Each file runs three hours of the replica's virtual clock in each of its replicas (three per file, run in
  step). Between your inputs the clock runs a frame each virtual second (Pinned 1): 10,800 frames a replica, under a
  minute to about 7 minutes at the 4 to 40 ms a frame the base's replica took on this machine (BASE-FAILURE.txt); where
  you act, a frame each 60th. The tests' own limits are 8 hours. Each file's runs are made once and shared by its tests,
  so `-t` on one test still runs every replica of its file.
- **Folders and processes.** Homes are under `/tmp` (#16's `tempDir`). Nothing touches the real `~/.deepbuild`,
  `~/.claude` or `~/Library/LaunchAgents`. Only what a test started is stopped, by PID. Clock times read in
  `Asia/Kolkata`, as #1463's helpers set for the suite and its children.
- **Lanes.** The replicas draw headless; the folder belongs on `scripts/lanes.mjs`'s one-at-a-time list in a macOS lane
  with #1461's replica files; the implementer makes that edit.
- Vitest writes `tests/acceptance/2028/node_modules/.vite/` under `--root`; delete it before committing.

## The surface (my choice where the issue names none)

**The virtual clock is the replica's** (#124's `deep-drive`, #1461's doors): a copy of a record a real hub made
(`launch.from: "record_copy"`), driven over its stdin. Its window is the front one on an awake, unlocked screen, its acts
are your input at its clock, and you're present within 2 minutes of one (#1461's Pinned 4, the app's
`unread::present`). Time passes only as its clock runs: a frame each 60th of a second where you act, a frame each
second between your inputs (Pinned 1). **14:00** is the moment of your last input before you leave and **17:00** is
three hours of that clock later: the record's clock reads whatever time of day the run starts at.

**A mark** is #1461's: an unread row's title drawn medium (weight 500 or more, `see`'s `snapshot.runs[].weight` inside
the row's `<row id>:title` slot), a read one regular. An asking row is medium too, so no row is judged while it needs
you. Titles are a word or two, so none is cut beside the widest state word and time: #1461's reader takes a title's
weight only from runs wholly inside its slot. After each press the pointer rests on the page's title, off the list, so
no row's tooltip (shown under a pointer resting 1.5 s on a row) is drawn over the list when it's read.

**Marks come from the record**: what the app draws is folded from `row.set`, the row the core writes with its `unread`.
AC1 feeds each change to the replica as the core writes it (#1461's `rowSet`); AC2 has the real hub mark rows for real
hooks, and feeds the replicas the hub's own events, read back from its log.

**The one count** (#2026): the menu bar's title (`see`'s `snapshot.menu_bar.title`); the list's, its Needs you heading
(`heading:needs-you`, its value and words) and the ask rows under it (`ask:<ULID>`); `deep inbox`'s, its last line, the
real CLI on the real hub. Each is read as a number by #2026's `numberIn`, and must be the record's open asks by #2026's
`openAsks` over the hub's log.

### Merged surfaces, used as they are

`deep hub run`; the record and asks core through #26's `seed` (#1461's `makeWorld`); #16's hook wire (`sendHook`,
`hookRequest`); `deep status --json` (its rows' `unread`) and `deep inbox`; `deep-drive --out <dir>` with `launch`
(`from: record_copy`, `size`), `see` (`snapshot` with `runs[].weight` and `menu_bar.title`; `rows`; `log_pos`), `act`
(`click`), `feed`, `wait_for {t}` and its replies' `t` (Pinned 1 adds `step_ms`); the replica's hub copy taking the
app's `row.read`; #1461's ids (`list`, `heading:needs-you`, `session:<id>`, `ask:<ULID>`, `<row id>:title`); the app's
one unread rule (`crates/deep-app/src/unread.rs`) and #1461's plant `unread-on-message`.

### Pinned here: the implementation must provide these

1. **A virtual clock that runs hours** (AC1, AC2: "On a virtual clock … absent until 17:00"). `deep-drive`'s `wait_for`
   with `t` takes `step_ms`: the clock runs to `t` in steps of that many ms of virtual time (the last one shorter), each
   step one frame as a frame runs now (timers due run, the views' clock moves, the app's tick runs, the window draws,
   notifications come due), and the reply carries `step_ms`. Without it, a frame each 60th of a second, as merged. Three
   hours a 60th at a time are 648,000 frames: at the base's 4 to 40 ms a frame on this loaded machine (BASE-FAILURE.txt),
   45 minutes to 7 hours a replica. A reply without `step_ms` stops the run `BLOCKED` after one second of the clock.
2. **Plants in the app, selected by `DEEP_HUB_PLANT`** and read through `deep_app::plain::planted` in builds with
   `env-plants` only (`deep-drive --features env-plants,deep-app/test-confirm`); everything else as shipped:
   - `marks-whole-day` (AC1): every row whose state changed in the last 24 hours reads marked, its title medium, whether
     or not its page has been open a second since: a mark from the whole day.
   - `menu-bar-adds-unread` (AC2): the menu bar's count adds the number of the list's unread rows to the open asks. The
     menu bar alone.
   - `list-adds-unread` (AC2): the list's Needs you count, its heading's value and words, adds the number of the list's
     unread rows to the open asks. The list alone.
3. **A plant in the CLI's side of `deep inbox`**, selected by `DEEP_HUB_PLANT` in the environment of the `deep inbox`
   process (never the hub's) and read through `activePlant()` in `packages/hub/src/plant.ts`, as `inbox-no-default` is:
   - `inbox-adds-unread` (AC2): the count `deep inbox` ends on adds the number of the list's unread rows (the rows
     `deep status --json` reads unread) to the open asks.
4. **Used as merged, not new**: #1461's `unread-on-message` (AC1, `crates/deep-app/src/list.rs`): an agent's message
   (`session.activity`) marks its session's row. It is the criterion's "mark from the agents' messages".

### The fixtures

- **AC1** (`helpers.ts` `MARKS_WORLD`): eight sessions in `shop`, `docs` and `search`, seeded a minute apart before the
  hub's backfill, so each starts read. At 13:59 `morning` reaches PASS; at 14:00 you open its page for a second, then
  open `pass`'s page and leave it open. With no input after that, until 17:00: `chatty`'s agent reports what it does
  (`session.activity`) twelve times; at 14:30 `pass` reaches PASS (its page open, you away); at 15:00 `sent` is sent
  back; at 15:30 `blocked` is BLOCKED; at 16:00 a saved decision answers `decided`'s ask (`decision.applied`, the ask's
  row leaving the list, the session's row moving to working); at 16:30 `resumed`, finished at 14:00, starts a new turn,
  still working at 17:00. `still` finished before 14:00 and never changes. At 17:00 you come back by opening `still`'s
  page; then you open each of the five's pages for a second.
- **AC2** (`helpers.ts` `COUNT_WORLD`): two asks open on two finished sessions in `shop` (a choice and a taste call);
  `w1` and `w2` at work in `docs`; `idle` finished in `search`. At 14:00 you open `idle`'s page. The two agents' processes
  start again and run three tool calls each, real hooks (SessionStart, then PreToolUse and PostToolUse) the hub writes
  with no change of state; their events are fed through the afternoon. At 17:00 you open `idle`'s page again. Then
  both turns stop (real Stop hooks): the hub marks `w1`'s and `w2`'s rows, and its events are fed. No ask opens or
  closes, so the one count is 2 throughout.

## Criterion to tests

IDs are `criterionId` in `scripts/proof-change.mjs`.

| Criterion | ID | Test | Wrong programs it fails on |
|---|---|---|---|
| AC1 on a virtual clock, exactly the five rows that changed while you were away are marked on return, and having one's page open a second clears its mark | `#2028.c2f64186` | `marks.test.ts`: the virtual-clock run; at 14:00 `morning` regular a second after its page opened; at 17:00 the five medium and `morning`, `chatty` and `still` regular; each of the five regular a second after its page opened | the base (no `step_ms`: BLOCKED); `marks-whole-day`, naming `morning`'s row; `unread-on-message`, naming `chatty`'s row; each held first to the shipped run passing |
| AC2 the one count in the menu bar, the list and `deep inbox` the same before and after rows are marked; an absence with no state change marks nothing | `#2028.cb5e7641` | `count.test.ts`: at 14:00, at 17:00 after the absence, and once the hub marked two rows, each surface reads the record's 2 open asks and Needs you lists exactly them; at 17:00 none of `w1`, `w2` and `idle` is drawn medium and `deep status --json` reads no row unread; once marked, `w1` and `w2` medium and unread | the base (no `step_ms`: BLOCKED); `menu-bar-adds-unread`, naming the menu bar; `list-adds-unread`, naming the list; `inbox-adds-unread`, naming `deep inbox`; each held first to the shipped run passing |

At the base every test stops `BLOCKED` on Pinned 1 (BASE-FAILURE.txt). The one rule, its weights and the one count are
#1461's and #2026's, merged, so once the clock steps the shipped runs are expected to pass and the plants' tests are the
ones that fail until their plants exist; `unread-on-message` is merged, so its test is expected to pass then. A smoke
run at the base with the absence cut to minutes and the clock a frame each 60th (BASE-FAILURE.txt) shows the flow and
the judges at work.

No test passes when its surface is missing: a missing build, binary, reply, row or slot stops it `BLOCKED: …` or fails
naming what's missing, and a plant the build ignores fails ("wasn't caught").

## Scope the criteria don't cover

No criterion names these, so nothing here tests them: "never notify" (no criterion judges notifications); "No line
sits above the first ask"; the Decided page and a receipt on its answered row while Undo is live (#1807); the menu
bar's menu under its count; a row half a second open, or open while you're away past 2 minutes, beyond what AC1's
`pass` covers (#1461's AC17); first sightings (#1461's AC12); how the hub decides a row's word.

## Disputes and assumptions a redraft may revisit

1. **14:00 and 17:00** are moments on the replica's virtual clock (your last input, then three hours later), not the
   time of day the record's clock reads; nothing in the one rule depends on the hour. A redraft that wants the hour read
   on the window would need a launch option that sets the replica's clock.
2. **"Still working"** is a session that changed into working while you were away (a finished session's new turn) and
   is still working at 17:00. A session working all along has no change in its state and, by the Scope, isn't marked;
   `chatty` is that case.
3. **"A decision applied for you"** marks the session's row (`session:<id>`), which moves from needs you to working; the
   ask's row leaves the list, as the core writes it. Decided for you is the Decided page (Reads under #1453), not read
   here.
4. **PASS, sent back and BLOCKED** reach the replica as the core's `row.set` with those words and their status-map
   entries (`pass`, `fail`, `blocked`), as #1461's suite feeds PASS. The base hub's state reading has six words and
   doesn't write these; which component does is not this issue's.
5. **"The agents' messages"** are `session.activity` events, the hook's reports of what the agent does, as #1461's AC5
   reads an agent's message; #1461's `unread-on-message` is the planted mark from them.
6. **"A mark from the whole day"** is pinned as every row whose state changed in the last 24 hours, read or not, so the
   run doesn't depend on the date or the hour it starts at. A plant keyed to the calendar day would be missed on a run
   that crosses midnight.
7. **Present at 14:00** is a press on a row then; **absent** is no input after it (#329's presence: input in the last 2
   minutes); **return** is a press on a row that didn't change, read before a second passes. Hover isn't input.
8. **"Having one's page open for a second clears its mark"** is checked on each of the five, 1.2 s of the clock after
   its page opened while you're present.
9. **AC2's marks** are the two the base hub writes for real hooks (a working session's turn stopping). Since no ask opens
   or closes, "the same before and after" is read as each surface saying the record's number at each moment. AC1's run
   isn't reused for AC2: its decision closes an ask, so the count there moves for a reason that isn't a mark.
10. **AC2's absence** is three hours, as AC1's, with the agents' tool calls as real hooks and no change of state; "marks
    nothing" is read both in the app (no row medium) and in the record (`deep status --json`, no row unread).
11. **"In the list"** is the list's Needs you heading and the ask rows under it (#2026's reading of Home's count). A
    plant may show either; the test accepts either, naming the list.
12. **One plant per surface** for AC2, each changing that surface alone, so each failure must name its own surface.
13. **The replicas run in step on one world** per file, one per program, rather than one world each; the CLI's plant is
    judged on the shipped app's readings and the app's plants on the shipped `deep inbox`.
14. **A frame each virtual second between inputs** (Pinned 1). While you're away nothing in the one rule needs finer
    time (presence lapses 2 minutes after your last input; a page is read after a second while you're present), and the
    changes reach the replica by `feed` at their own moments. Where you act (14:00, 17:00 and after) the clock runs a
    frame each 60th as merged. A redraft that holds the merged clock instead needs hours a replica, or a shorter
    absence for AC2 (past #328's old 30 minutes), which its words allow.

## Files

- `helpers.ts`: IDs and plants, the clock run in step, AC1's world and run (`marksRun`), AC2's world, run and judge
  (`countRun`, `countFailures`). Reuses `../16/helpers.ts`, `../26/helpers.ts`, `../1463/helpers.ts`,
  `../1461/helpers.ts` and `../2026/helpers.ts`.
- `marks.test.ts` (AC1), `count.test.ts` (AC2).
- `tsconfig.json`: as #1461's. `BASE-FAILURE.txt`: the run at the base.
