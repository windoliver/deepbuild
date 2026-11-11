# Acceptance tests for #2021: what a working session is doing now, a mark that moves only on events, reduce motion and VoiceOver

Written first and blind, at base commit `35df4523f` (which holds #1461, #1462, #992, #2018, #2026 and #2028 merged), from
issue #2021 as it read at updatedAt 2026-11-11T16:45:22Z (its Scope, its "Reads under #1453, Nov 9" paragraph, all six
acceptance criteria and its Proof: "30 sessions across 3 repos at the reference window, each shown failing first"), the
design and the base, before any implementation. The implementing agent does not edit these files (AGENTS.md, Proof); a
dispute goes to a blind redraft of this job (design: Dogfooding). There is no taste criterion, so no `TASTE.json`.

## What was read

- **The issue**: Scope (the mark moves once per event and holds still when none comes; under reduce motion it holds
  still and the row says when its last event came; the list from the keyboard and VoiceOver; the line built only from the
  hook facts of the latest tool event, its verbs, objects and times, "Waiting for you to allow: run npm", values the hub
  scrubs stay scrubbed, never stuck or stalled, changing only on events; the row one line with fixed slots), Reads under
  #1453 (the row stays one line selected or not, the line at the top of the page and in the row's accessible name, no
  filter), the six criteria and the Proof.
- **The issues it names, for their words**: #1461 (the row's slots and ids, the page, the one window), #1462 (the list
  from the keyboard: F6, the arrows, Return, typing moves selection, no filter), #992 (a permission prompt reads needs
  you), #2018 (one reading of a session), #329 (the parent), #1453 and #578 for the reads they settle.
- **The design**, `docs/technical-design.md`: States people see (the words, the row shape `row.set` the app and the
  replica fold, "working" and "quiet"); What each agent gives us (Claude Code's PreToolUse, PermissionRequest,
  PostToolUse, PostToolUseFailure; `transcript_path`); Hooks are evidence, not a state machine (order by `seq`; "Unknown,
  not finished": when hooks go quiet the hub reads the transcript's tail); Privacy (the scrub, by pattern and by value,
  "its own tokens"); the view row of First-party extensions that ship on by default.
- **The base**, for its surfaces only: `crates/deep-app/src/{views,list,states,plain,lib}.rs` (the row's slots and
  accessible name, the page's `session-*` nodes, the list's keys, `plain::planted`, reduce motion read from the OS);
  `crates/deep-replica/src/drive/{mod,frames,motion}.rs` and `snapshot.rs` (`launch.reduced_motion`, `feed`, `wait_for`
  with `step_ms`, `screenshot` of a locator, `see`'s `focus`, `rows` and `address`); `packages/hub/src/{hookmap,status,
  core,server}.ts` (the hook map and its `ts` from `seq`, the state table, the quiet reading, `test.clock`, the held
  values); `adapters/claude-code.facts.json` and the corpus's 2.1.308 `tools` recording; the suites `16`, `1461`, `1462`,
  `1463`, `992`, `2018`, `2026` and `2028`.

## How to run

With Node 24.22 first on `PATH`, cargo (1.99.1) on `PATH`, on macOS:

```sh
npm ci --ignore-scripts && npm run build --workspaces
# optional, to build ahead; the helpers build what's missing themselves
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -p deep-hook --bin deep-hook
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -p deep-replica --bin deep-drive --features env-plants,deep-app/test-confirm
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -p deep-replica --bin deep-drive --features deep-app/test-confirm
npx vitest run --root tests/acceptance/2021 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/2021/tsconfig.json
```

- **Builds.** `helpers.ts` builds `deep-drive` with `env-plants,deep-app/test-confirm` (the planted build) and then with
  `deep-app/test-confirm` (as shipped, as #1461's), each copied out of the target folder into
  `$TMPDIR/dd2021-bin-<uid>-<8 hex of the checkout's path>`, so another worktree's build never stands in for this one and
  `target/debug` holds the plain build afterwards. #1461's `makeWorld` builds `deep-hook` when it's missing.
  `CARGO_TARGET_DIR` is honored. The workspaces must be built: the hub and the CLI come from there.
- **Headless.** Every test drives the real `deep-drive` on GPUI's test platform; nothing opens the real window, posts a
  key to it or needs Accessibility or Screen Recording, so a locked screen changes nothing.
- **Time.** Each run makes a world and a real hub (a few seconds), then plays its hooks, each waiting for its own event
  and 600 ms of a still log. `markRun` takes about 470 pictures in its 60 s window; `motionRun` starts twenty turns (80
  hooks) and takes about 330 pictures, twice; `lineRun` runs 40 s and 10 minutes with `step_ms`. At the base, at load
  averages of 10 to 15, the four files took about 6 s (keys), 40 s (mark), 170 s (motion) and 60 s (line); a plant's
  run adds its own. Each file's shipped run is made once and shared by its tests, so `-t` on a plant's test still makes
  the shipped run first. The tests' own limits are hours.
- **Folders and processes.** Homes are under `/tmp` (#16's `tempDir`). Nothing touches the real `~/.deepbuild`,
  `~/.claude` or `~/Library/LaunchAgents`. Each agent is a `/bin/sleep` this suite started; only what a test started is
  stopped, by PID.
- **Lanes.** The replica draws on macOS only and each file starts real hubs and replicas: the folder belongs on
  `scripts/lanes.mjs`'s one-at-a-time list in a macOS lane with #1461's and #2028's; the implementer makes that edit.
- Vitest writes `tests/acceptance/2021/node_modules/.vite/` under `--root`; delete it before committing.

## The surface (my choice where the issue names none)

**The app is the replica** (#124's `deep-drive`): a copy of a real hub's record (`launch.from: "record_copy"`) at the
reference window, 1512 × 982, on its virtual clock. Its acts are the person's input; what the hub appends reaches it by
`feed`, in the hub's log order, stamped at the replica's clock.

**The hooks are Claude Code's own.** Each session's agent is a real process (a `/bin/sleep`) whose hooks reach the real
hub's hook entry (#16's `sendHook`, with the agent's PID), each payload the first payload of that event (and tool) in the
corpus's recording of Claude Code 2.1.308 (`adapters/corpus/claude-code/2.1.308/tools`), with this session's fields and
this turn's prompt and call in place of the recording's. Before a hook, the session's transcript gets what Claude Code
writes there first, in the recording's shape: the prompt (with its prompt id) before UserPromptSubmit, the call before
PreToolUse, its result before PostToolUse or PostToolUseFailure, the agent's words when it says something. A hook's
`seq` is the replica's clock, and the hook's events are fed once the hub has appended the one stamped with it and its
log has been still 600 ms.

**Agents at work between hooks.** The hub reads a working session whose hooks went quiet for 30 s as unknown, and then
quiet, unless its transcript grew (design: Hooks are evidence, "Unknown, not finished"). An agent thinking writes its
thinking blocks there and sends no hook, so an agent `atWork` gets a thinking entry in its transcript every 5 s of the
wall clock and before each step of the hub's clock: AC2's twenty agents from the start of their run, and Deploy check's
through its ten minutes. A running call writes nothing, so Image build's 60 s call (AC1) and `npm test`'s 40 s (AC4) get
none.

**One clock.** The hub runs again on a stepped clock (`DEEP_HUB_TEST_CLOCK_STEPS=1`, `test.clock {advance_ms}`, #965 and
#992's), brought to the replica's clock before each hook and after each minute the replica's clock runs (each 20 s while
an agent thinks), so what the hub
stamps (a row's `since`, its own events) agrees with what the replica stamps. Where the wall clock ran past the virtual
one, the replica's clock first runs on to just past the hub's in one step, except inside AC1's and AC2's windows, whose
spacing is the criterion's; there the hub may run a little ahead.

**A mark moves** when its pixels change: the replica's screenshot of the node `<row id>:mark` (#1461's mark slot),
compared by SHA-256. It is pictured at irregular moments, 1 to 37 frames apart, so no animation's period hides it.

**Reduce motion** is the replica's merged `launch.reduced_motion: true` (#1427), which sets GPUI's reduce-motion flag as
the real app sets it from macOS's `accessibilityDisplayShouldReduceMotion`.

**What VoiceOver reads** is the window's tree as #1462's suite reads it: the snapshot's `focus` (the id of what has the
keyboard) and that node's accessible name. The real VoiceOver isn't driven.

### Merged surfaces, used as they are

`deep hub run` with `DEEP_HUB_TEST_CLOCK_STEPS=1`, `test.clock` and `events.read`; the hook wire (#16); the record core
through #26's `seed` (#1461's `makeWorld`); the corpus's recording (#47); the hub's control token, a value it holds and
scrubs (design: Privacy; #16's AC19); #16's `formsIn` (a value raw, URL-encoded and in base64 at each offset);
`deep-drive --out <dir>` with `launch` (`from: record_copy`, `size`, `reduced_motion`), `see` (`snapshot` with `focus`,
`rows`, `log_pos`, `address`), `act` (`click`, `hover`, `press`), `feed`, `wait_for` (`t`, and `step_ms`, #2028),
`screenshot` (`target: locator`); #1461's ids (`list`, `session:<id>`, `<row id>:mark`, `<row id>:time`, `page-title`,
`session/<id>` as the address); #1462's keys (F6 into the list, Up and Down over its rows and its headings
`project:<id>`, typing moves the keyboard, Return opens); the row's accessible name (`<mark> <title> · <state word>` at
the base); the app's span words (`40 s`, `2 min`) and `plain::planted`.

### Pinned here: the implementation must provide these

1. **The line on a session's page**: one node `session-doing` on a session's page (the address `session/<id>`), whose
   accessible name (or, with none, the strings drawn in it) is exactly the line: the step, `<Verb> <object>`, alone or
   followed by ` · <time>`. The strings held here are the issue's: `Edited cart/total.ts`, `Running npm`, `Running npm ·
   40 s`, `Couldn't run npm`, `Waiting for you to allow: run npm`, `Running curl`, `Ran curl` and `Ran curl · 10 min
   ago`, each with the ASCII apostrophe and the middle dot ` · ` as the issue writes them. A time is the app's span: `40
   s`, `2 min ago`, `10 min ago`.
2. **The line in the row's accessible name**: the name of the row's node `session:<id>` holds the line's step (and, at
   40 s, `Running npm · 40 s`), beside its title and its state word.
3. **Under reduce motion the row's time slot says when its last event came**: the node `<row id>:time` (its name, else
   its drawn strings), right after an event of its session, reads a different time than just before it, of at most 5 s
   (`now` is 0), and at the window's end that event's age within 2 s (or `now` while it is under a minute).
4. **A session with a tool call still running stays working** while that call sends nothing: 60 s after its PreToolUse
   (AC1), its row's word is `working` and its mark is the one it had 2 s after the call began. No hook comes and its
   transcript doesn't grow while a call runs.
5. **Plants in the app**, each selected by `DEEP_HUB_PLANT` in the replica's environment and read through
   `deep_app::plain::planted(<name>)` in builds with `env-plants` only (`deep-drive --features
   env-plants,deep-app/test-confirm`); the hub runs with no plant; everything else as shipped:
   - `mark-on-timer` (AC1): every working row's mark is animated by a timer, moving whether or not an event came.
   - `rows-take-no-focus` (AC3): no row of the list (session, ask or quiet row) can take the keyboard's focus; F6, the
     arrows and typing never put it on one.
   - `line-reads-message` (AC4): a working session's line, on its page and in its row's name, reads its agent's newest
     message, the `data.activity` of its newest `session.activity` event, in place of its hook facts once it has one.
   - `line-keeps-running` (AC4): a shell call's line keeps reading `Running <first word>` after the call failed.
   - `line-whole-command` (AC5): a shell call's line reads the whole command line the record holds in place of its
     first word: `Running curl -sS -H …`.
   - `line-stalls-on-timer` (AC5): two minutes after a session's last event its line and its row's state word read
     `stalled`.
   - `selected-second-line` (AC6): the selected row is two lines tall, its second line its session's line under its
     title.

### The fixture

`helpers.ts` `WORLD`, the Proof's 30 sessions in 3 repos, seeded through the record core before a real hub's backfill
(#1461's `makeWorld`): `shop` (Cart totals, Product grid, Image build, Checkout page, Billing page, Login flow, Wish list,
Gift cards, Coupons, Order history) and `docs` (Deploy check, Release notes, API guide, Docs refresh, Install guide,
Changelog, Style guide, Questions page, Tutorial, Glossary), each `queued` as seeded and `working` once its agent's turn
begins (`Sim.begin`: SessionStart, its prompt, a Read begun and ended); `web`'s ten finished. The list draws its
projects in their names' order (`crates/deep-app/src/list.rs`), so docs and shop come first and all twenty at work are
drawn at the reference window; of the 30 rows, 25 fit there at the base.

- **AC1** (`markRun`): Image build's and Product grid's turns begin; 3 s later Image build runs `npm run build:images`
  and sends nothing more; Product grid's Reads send a PreToolUse or a PostToolUse every 2 s, 29 events from 2 s to 58 s.
  Product grid's mark is pictured a frame before each of its events and 1, 3, 7, 15, 31, 63 and 100 frames after; Image
  build's at the same moments, from 2 s after its call began to 60 s.
- **AC2** (`motionRun`, reduce motion on, then off, each its own world): the twenty turns begin; 3 s later a 10 s window
  in which session k's Read sends its PreToolUse at 0.3 + 0.45k s. All twenty marks are pictured at eleven moments, each
  session's just before its event and 1, 3, 7 and 15 frames after, and its time slot read just before and just after.
- **AC3** (`keysRun`): F6 (up to three times) gives the list the keyboard, Up takes it to the top, Down to the first
  session row; Down walks on in drawn order, past the projects' headings, until all 30 session rows have had it, each
  read when it does; `s h o p` is typed; Return.
- **AC4 to AC6** (`lineRun`; the shipped run plays every part, a plant's run only the parts its judge reads): `turn`:
  Cart totals takes the prompt "The cart total rounds wrong; fix it and run the tests" and starts an Edit of
  `cart/total.ts`; 3 s later the list is read, the row is pressed (selecting it and opening its page) and read again; the
  Edit ends; the agent says "Almost done, fixing tests" (fed as `session.activity`, written to the transcript); `npm
  test` runs, read right away and four times from 40.0 to 40.9 s, then fails (PostToolUseFailure), read right away and a
  second later; `npm test -- cart` begins and its PermissionRequest comes, read right away and a second later.
  `scrub`: Deploy check's turn begins, its row is pressed, it runs `curl -sS -H "Authorization: Bearer <the hub's control
  token>" http://127.0.0.1:8080/health`, read right away and 2 s on, which ends well, read right away. `silence`: no
  event for ten minutes while Deploy check's agent thinks, read at each minute and at 10 min 5 s.
- AC2's twenty agents are at work from the start of the run; its window is read only if all twenty read working at its
  start and at its end (else `BLOCKED`: the fixture didn't hold).
- In AC1's and AC2's windows the clock runs to each moment in a frame or two (`step_ms`), so the wall clock, which the
  hub's runs on, stays near the virtual one.

## Criterion to tests

IDs are `criterionId` in `scripts/proof-change.mjs`.

| Criterion | ID | Test | Wrong programs it fails on |
|---|---|---|---|
| AC1 a still working mark through 60 s of a silent call; one moving at each event 2 s apart; a timer's mark fails | `#2021.cf07389f` | `mark.test.ts`: Image build's mark the same in every picture from 2 s to 60 s, and its word working at 60 s; Product grid's different within 100 frames of each of its 29 events | the base (BASE-FAILURE.txt); `mark-on-timer`, naming Image build; held first to the shipped run passing |
| AC2 reduce motion on: no mark moves for 10 s while each row's last-event time updates; off: marks move only on events | `#2021.4ccecc58` | `motion.test.ts`: on, every mark the same through the window and each row's time slot changing at its event to at most 5 s and reading its age at the end; off, each mark the same before its event and from 2 s after it, and different within 15 frames of it | the base (BASE-FAILURE.txt) |
| AC3 the arrows walk 30 rows in drawn order, VoiceOver reading name and state word; "shop"; Enter; rows that can't take focus fail, naming the first row | `#2021.6db64bd1` | `keys.test.ts`: the walk, each session row drawn in the list's view with its title and state word in its accessible name; "shop" puts the keyboard on shop and every row stays listed; Return opens what has the keyboard | the base (BASE-FAILURE.txt); `rows-take-no-focus`, naming the first row; held first to the shipped run passing |
| AC4 a recorded turn's "Edited cart/total.ts", "Running npm · 40 s", "Couldn't run npm" and "Waiting for you to allow: run npm" with needs you; plants fail, naming the session | `#2021.71cb584f` | `line.test.ts`: each reading on Cart totals' page (`session-doing`) and in its row's name, within one event of its hook; needs you at the prompt; the agent's words in no reading | the base (no `session-doing`); `line-reads-message` and `line-keeps-running`, naming Cart totals; held first to the shipped run passing |
| AC5 a scrubbed command's first word only and the value in no snapshot; "10 min ago" and no stuck, stalled or idle; plants fail, naming the session | `#2021.9b270501` | `line.test.ts`: `Running curl` and at most a time on Deploy check's page, none of the command's other words in its name; no form of the token in its row, line or `rows` entry in any reading; at each minute no stuck, stalled or idle on the row or the line; `Ran curl · 10 min ago` at 10 min 5 s | the base (no `session-doing`); `line-whole-command` and `line-stalls-on-timer`, naming Deploy check; held first to the shipped run passing |
| AC6 selecting a working row changes no row's height or place; a second line on the selected row fails, naming it | `#2021.a6469f5a` | `line.test.ts`: every row drawn before the press on Cart totals has the same bounds after it, none added or removed, the page Cart totals' | `selected-second-line`, naming the selected row; held first to the shipped run passing |

A plant's test first holds the shipped run to the same judge: if the shipped run fails it, the plant's test fails saying
so, so a plant never looks caught on a program that already fails. No test passes when its surface is missing: a missing
build, reply, node or reading stops it `BLOCKED: …` or fails naming what's missing, and a plant the build ignores fails
("wasn't caught").

At the base (BASE-FAILURE.txt) twelve of the thirteen tests fail: AC1's mark never moves and Image build reads quiet
34 s into its call; AC2's time slots don't move at an event and no mark moves at one; AC3's walk stops at row 25 of 30,
the list not scrolling to the focused row; AC4's and AC5's line isn't there; each plant's test fails on its shipped run
or, for AC6, on the plant not being caught. AC6's shipped-app test passes on purpose: the base's row is already one
line, selected or not, and its planted second line is what the test fails on.

## Scope the criteria don't cover

No criterion names these, so nothing here tests them: the present-tense and past verbs no criterion quotes (Editing,
Reading, Read, Searching, Searched, Fetching, Fetched) and a fetch's host; "Edited cart/total.ts · 2 min ago"; a lead's
row and its children's counts; the state word as one target with the row; Note and pause from the box; "project" for
"repo"; one flag in the right slot; controls on hover and selection; what the row says it waits on; the real VoiceOver
and the real window.

## Disputes and assumptions a redraft may revisit

1. **"On its selected row"** (AC4) is read as the selected row's page, its `session-doing` line, and its row's accessible
   name: the row stays one line, selected or not (Reads under #1453; AC6), so nothing is read off the row's drawn
   strings.
2. **"Within one event of its hook"** is read right after the events the hub appended for that hook are fed, before any
   later hook's, each fed event one frame of the replica's clock.
3. **"Running npm · 40 s"** is read four times, from 40.0 to 40.9 s after the call's events were fed: it passes if one
   reading is exactly that and the name holds it at one, so neither rounding nor a hub stamp a moment late decides it.
4. **"A recorded Claude Code turn"**: no recording edits `cart/total.ts`, so each hook is the corpus's recorded 2.1.308
   payload of that event and tool with this turn's values (session, folder, prompt, call) in its place, and the
   transcript grows as Claude Code writes it. A redraft with a recording of this very turn would replay it.
5. **"The agent's last message"** is its newest `session.activity` event (as #1461's and #2028's suites feed an agent's
   message), fed to the replica alone, and the same words in its transcript. Claude Code's hooks carry no mid-turn
   message, so the hub gets none from them.
6. **A value on the hub's scrub list** is the hub's own control token (Privacy: "its own tokens"; #16's AC19), in the
   command's header. "No snapshot of the row" is the row's node, its slots and the strings drawn in it, its `rows` entry
   and its page's line, in every reading of the run.
7. **"Its first word only"** is `Running curl` and nothing more than a time on the page, and none of the command's other
   words in the row's name.
8. **"With no event for 10 minutes"** follows the curl's PostToolUse, so the last step is `Ran curl`, read at 10 min 5 s
   as exactly `Ran curl · 10 min ago`. The agent is thinking through the silence (its transcript grows, no hook comes),
   so the hub keeps the session working as the design has it; with the transcript still, the base hub would read it
   `quiet` and move its row to the list's end, out of the reference window. `quiet` isn't one of the issue's three
   words, so the row may read it; the mark's status entry (`idle` for quiet) is a code, not a word on the row.
9. **"A still working mark"** (AC1) is read as the session's word staying `working` and its mark's pixels staying the
   same through 60 s of a call that sends nothing (Pinned 4). The base hub reads a working session unknown, then quiet,
   once its hooks have been quiet 30 s and its transcript hasn't grown since it last read it, and a running call writes
   nothing there; the call's own entry, written before its PreToolUse, carries it a little past 30 s on the hub's clock
   (at the base Image build's row read quiet from about 34 s of the replica's clock). Inside AC1's window the hub's clock
   may run ahead of the replica's by the wall time the run takes beyond the virtual.
10. **Agents at work write thinking entries** (The surface): AC2 needs twenty sessions working through a run whose setup
    takes minutes of wall time, and the hub's clock runs on the wall clock. A redraft may start the turns differently;
    without a growing transcript the base hub reads them quiet before the window.
11. **"Moves"** is a change in the mark's pixels; "moves at each" is a change within 100 frames of each event (AC1), 15
    frames in AC2's tighter window, against the picture a frame before it, so a short pulse and a step both count.
12. **"With it off, marks move only on events"** (AC2) is read as each mark the same before its own event and from 2 s
    after it, and different within 15 frames of it (AC1's "moves at each" in the same window).
13. **"Each row's last-event time"** (AC2) is the row's time slot (Pinned 3); the issue names "when its last event came"
    on the row and the row has one time slot.
14. **"Typing 'shop' leaves shop's sessions"** is read as the keyboard landing on shop's heading or one of shop's
    sessions with every row still listed: the list has no filter (#1462).
15. **The walk** (AC3) passes the projects' headings, which #1462 lets the keyboard rest on, and holds each of the 30
    session rows to be drawn inside the list's view when it has the keyboard: at the base only 25 of the 30 fit in the
    reference window, so the list must bring the focused row into view.
16. **Plants all live in the app**, though the line may be built in the hub: one world and one hub per run, and a hub
    with an unknown plant name refuses to start.
17. **Each run has its own world and hub**, so the hub's clock follows one replica's.
18. **The real VoiceOver and the real app aren't driven**: the replica's tree is what an assistive client reads (#1462's
    reading), and the screen may be locked during runs.

## Files

- `helpers.ts`: IDs and plants, the builds, the replica driver, the world, Claude Code's payloads and transcript entries,
  the run (`Sim`: hooks, the one clock, feeding), the window's readers, the four runs and the judges. Reuses
  `../16/helpers.ts`, `../1463/helpers.ts` and `../1461/helpers.ts`.
- `mark.test.ts` (AC1), `motion.test.ts` (AC2), `keys.test.ts` (AC3), `line.test.ts` (AC4, AC5, AC6).
- `tsconfig.json`: as #2028's. `BASE-FAILURE.txt`: the run at the base.
