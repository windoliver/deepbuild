# Acceptance tests for #3232: the window says what changed

Written first and blind, at base commit `38706c819` (main, whose last merge is #3332), from issue #3232 (its opening
paragraphs, Scope, eleven acceptance criteria, `Runs on:` and Proof; it has no comments), the design and the base,
before any implementation. The implementing agent does not edit these files (AGENTS.md, Proof); a dispute goes to a
blind redraft of this job (design: Dogfooding).

**Run at the base.** Phase 2 ran on 2026-11-24 with the base built: twelve fixture probes, then each of the eight test
files once, on the files as they stand. All 20 tests fail there and none passes: 19 at their own judge, on the merge
base's missing announcements, and `live.test.ts` BLOCKED on the Accessibility permission (`BASE-FAILURE.txt`). The
probes found one fixture wrong, the hold's, and `hold.test.ts` was corrected (The fixtures; Readings 14). A dispute
over AC9's second test was judged true and that test redrafted, in `hub.test.ts` and `judges.ts` (Readings 16). What
was run says what each probe showed. No planted program can run at the base; each is the implementer's to add.

## What was read

- **The issue**, and for the words it cites only: #1453 (the epic), #1845, #994, #1101, #1651, #1459, #376, #2680.
- **The design**: the five sections the issue links (Rules every primitive follows, its Accessible rule; States people
  see; Question card; Replica; Keymap, placement, window, its Actions and Address), and in `docs/technical-design.md`
  Numbers version 0 has to hold (Every task carries its own budgets, The reference Macs), How we know version 0 works
  (Criteria to tests, Wrong programs), Dogfooding, Built to be hard to get wrong, Repo guards; `docs/parallel-proof.md`
  sections 7 (a suite's own lane file) and 12a (budget windows).
- **The base**, for its surfaces only: `crates/deep-replica/src/drive/{mod,see,frames,counts,locate,plant}.rs`,
  `snapshot.rs` and `live.rs`; `crates/deep-app/src/{notify,actions,record,states,plain,card,pictures,kinds}.rs`,
  `actions.json` and `copy/en.json`; `crates/deep-show/src/{access,live}.rs`; `vendor/accesskit_macos/src/{node,event}.rs`;
  `packages/hub/src/{rows,status}.ts`; `scripts/{lanes,lanes-lists,wait-ratchet,repo-rules,benchmark}.mjs`; and the
  suites `3234`, `3234-redraft-ac6`, `1101`, `1459`, `1461`, `1462`, `1454`, `2018`, `2021`, `2026`, `376`, `16`, `26`,
  `1463`, `3229`.

## How to run

With Node 24.22 and cargo first on `PATH`, on macOS, from the repo root:

```sh
npm ci --ignore-scripts && npm run build --workspaces
node node_modules/vitest/vitest.mjs run --root tests/acceptance/3232 window.test.ts  --no-file-parallelism --testTimeout=600000
node node_modules/vitest/vitest.mjs run --root tests/acceptance/3232 state.test.ts   --no-file-parallelism --testTimeout=600000
node node_modules/vitest/vitest.mjs run --root tests/acceptance/3232 card.test.ts    --no-file-parallelism --testTimeout=600000
node node_modules/vitest/vitest.mjs run --root tests/acceptance/3232 hold.test.ts    --no-file-parallelism --testTimeout=600000
node node_modules/vitest/vitest.mjs run --root tests/acceptance/3232 changes.test.ts --no-file-parallelism --testTimeout=600000
node node_modules/vitest/vitest.mjs run --root tests/acceptance/3232 hub.test.ts     --no-file-parallelism --testTimeout=600000
node node_modules/vitest/vitest.mjs run --root tests/acceptance/3232 live.test.ts    --no-file-parallelism --testTimeout=600000
node node_modules/vitest/vitest.mjs run --root tests/acceptance/3232 budgets.test.ts --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/3232/tsconfig.json
```

As the lanes run a suite that is alone, each goes through the machine's throttle (`node scripts/throttle.mjs test --wait
60 -- <command>`); `scripts/lease` in front of a command holds a slot of the calling session's, as #3234's README has it.

- **Builds.** Each is made in a grant of `scripts/throttle.mjs build --wait 240`, with `CARGO_INCREMENTAL=0` and
  `CARGO_PROFILE_DEV_DEBUG=0`, and used as it is while its copy is newer than every Rust source; `CARGO_TARGET_DIR` is
  honored.
  - `deep-drive` is #1101's `driveBin`: `cargo build --locked -q -p deep-replica --bin deep-drive --features
    deep-app/test-confirm`, copied to `$TMPDIR/da1101-bin-<uid>-<8 hex of the checkout's path>/deep-drive-confirm`, and for
    a plant `--features env-plants,deep-app/test-confirm`, copied to `deep-drive-confirm-plants` there; each is followed by
    the plain `cargo build --locked -q -p deep-replica --bin deep-drive`, so the target never holds a plant. Every file but
    `live.test.ts` needs the first; the wrong-program tests need the second.
  - `deep-hook` under `target/debug/`, where a hub looks for it: `cargo build --locked -q -p deep-hook --bin deep-hook`
    (#1101's world builds it when it is stale; #2018's world and `liveWorld` stop BLOCKED without it; #3234's redraft's
    world, which `card.test.ts` uses, builds it with a plain `cargo build` when it is missing).
  - `live.test.ts` alone: the real app, `cargo build --locked -q -p deep-app --bin deep-app`, copied to
    `$TMPDIR/da3232-bin-<uid>-<8 hex>/deep-app`, and `probe.swift` compiled with `swiftc -O` to `probe-<12 hex of the
    file>` there. Neither is made on a machine that isn't a reference Mac, or without the Accessibility permission.
  - `budgets.test.ts`, only when the idle window wakes and only on a fit reference Mac: the merge base's tree from `git
    archive 38706c819…` (no worktree added, no `.git` copied) into `$TMPDIR/dd3232-<uid>-<8 hex>/base-38706c8192f6/src`,
    built from that folder with `cargo build --locked -q -p deep-replica --bin deep-drive --features
    deep-app/test-confirm --target-dir <that base folder>/target`; the binary is used where cargo leaves it,
    `…/target/debug/deep-drive`.
- **Time.** At the base, on a reference Mac under a load of 40 to 110: `window` 33 s, `state` 45 s, `card` 6 s, `hold` 7 s,
  `changes` 13 s, `hub` 7 s, `budgets` 4 s, `live` under a second (BLOCKED). No planted run is made there. Each run
  starts a hub (and stops and starts it once for each change it makes: 6 times in the journey, 3 in `changes`, once in
  `state`), and one replica; `state` lets 60 s of the replica's clock pass in 240 frames, `hub` up to 91 s in some 370,
  `budgets` 60 s in 3,600. A wrong-program test makes its run twice, shipped then planted.
- **Folders and processes.** Every HOME is a temp folder (#16's `makeHome`). Nothing touches the real `~/.deepbuild`,
  `~/.claude` or `~/Library/LaunchAgents`. Only what a test started is stopped, by PID. No network, no model.
- **Windows.** Only `live.test.ts` opens a real window and brings it to the front; everything else is headless.
- **Lanes.** `lane.json` puts the folder in the alone block (`shared: the screen`). If `budgets.test.ts` or another file
  takes over two minutes, `scripts/lanes-lists.mjs`'s `slow` list is the implementer's edit.
- Vitest writes `tests/acceptance/3232/node_modules/.vite/` under `--root`; delete it before committing.

## Surfaces (the implementation must provide these; each name is this suite's choice)

The issue names the replica's snapshot, its announcements, the region's node and its rows, the screenshot, the
notifications and the tree read through AppKit, and leaves their shapes open. These are the least the criteria need;
the tests read exactly these.

1. **The announcements, as data.** `deep-drive`'s `see` answers them in its snapshot, **`snapshot.announcements`**: a
   list, in the order made, `[]` when nothing was said, each entry **`{"t": <flicks since launch, a whole number>,
   "text": "<its line>"}`**, as a document's `see` gives `{t, id, text}` (#376); other fields are not read. A snapshot
   without the list is missing evidence, never an empty list. `see` gives every entry made up to now in both frame modes
   (`launch.frames: "every"` and `"dirty"`). Once 3 s of the replica's clock have passed since the last change, every
   entry in the list stays as it is, its `t` and its `text`: a later entry is appended, never put in an earlier one's
   place. Example: `{"t": 2822400000, "text": "needs you … Which store keeps the cart totals? … ⌘J"}`.
2. **The region's node** is the one node of `snapshot.tree` whose **`id` is `live-region`**. Its children are its rows
   and nothing else: at most five, newest first. A row's **`name`** is its line, exactly an entry's `text`, and its
   **`value`** its time as the app writes a clock time, **`HH:MM`** in the machine's time zone (`14:02`), the minute of
   its entry's `t` on the views' clock. Neither the region nor a row is drawn: `deep-drive`'s `screenshot` with `target:
   "locator"` and `{"id": "live-region"}`, or a row's `{"role", "name"}`, answers the error code `locate.none`, its word
   for a node the window doesn't draw, and no string the frame draws (`snapshot.runs`) holds a row's line.
3. **The words.** Only the words the issue and the design give are read; the rest of a line is the copy table's.
   - A line about an ask starts with `needs you` (any case), holds the ask's question as the record has it and the count
     of asks that need you (a number, `1`, or its word, `one`), and ends with the key that opens its card.
   - A key is written as the app shows a key (`crates/deep-app/src/actions.rs`, `glyphs`): `cmd-j` is `⌘J`. The key that
     opens an ask's card is the key of an action of `crates/deep-app/src/actions.json` whose `verb` is `Open` and whose
     `target` is `app` or starts with `ask` (at the base, `Next ask`, `⌘J`); the key that undoes an answer is that of an
     action whose `verb` is `Undo` and whose `target` starts with `card` (`Undo answer`, `⌘Z`).
   - A state line holds the session's name (its row's `title`), `sent back` and the round as the design writes it, `1
     of 3`. A changed card's line holds `question` and `chang` (as in "changed"). A hold's line holds `10 s` and the undo
     key. The hub's line holds `hub` and `isn't answering`.
4. **The notifier in the replica.** `deep-drive`'s tick passes the notifier the session whose page is open in its window
   (#1845's rule; the replica's window is the front one on an awake, unlocked screen), so an ask from that session posts
   nothing. What it posts is read as at the base: `close`'s trace, `notifications`, each `{t, ask, session, text, sound}`.
5. **The live tree.** In the real `deep-app`, read through the Accessibility API: exactly one node of the window answers
   the attribute **`AXARIALive`** with **`polite`**; its `AXIdentifier` is `live-region`; its `AXValue` is the last line;
   its `AXChildren` are its rows, newest first, each labelled (`AXTitle`, else `AXDescription`) with its line. At the
   base the vendored adapter (`vendor/accesskit_macos`) answers no such attribute, so this is a carried patch with its
   row in `vendor/gpui-pre-apple/upstream/README.md`.

Used as the base has them: `deep-drive`'s `launch` (`from: "record_copy" | "fixture"`, `fixture`, `size`, `frames`,
`read_back`), `feed`, `open`, `hub`, `refresh`, `wait_for {t, step_ms}`, `see` (`rows`, `log_pos`), `screenshot`, `close`
(its trace and, in the dirty mode, `frames.list`), and `act` with `{kind: "click", source: "hid"}` on a card's option, as
#1101's `pressAllow` presses one; the nodes `question-card` (#1462) with its values `armed` and `answered`,
`card-option:<id>` (#3234) and `session-doing` (#2021); the window's own words that the hub isn't answering (#1461: a
string the frame draws, `snapshot.runs`, or a node's name or value, holds `isn't answering`), read outside the region's
node, whose rows are what was said and not what is so; `deep open <address>` reaching the running app (#1460);
`DEEP_APP_TEST_CONFIRM`.

## Plants

Each is an app plant, selected by **`DEEP_HUB_PLANT=<name>`** in the replica's environment alone, read through
`deep_app::plain::planted` in `deep-drive`'s `env-plants` build; no hub is given one, so none needs listing in
`packages/hub/src/plant.ts`. Each plant changes only what its row says. Each plant's test first holds the shipped run to
the same judge, so a program that already fails can't make its plant look caught, and a plant the build ignores fails
("wasn't caught").

| Plant | Criterion | The wrong program, exactly | Fails naming |
|---|---|---|---|
| `ask-line-starts-with-doing` | AC2 | A line about an ask starts with the doing words its session's row carried when the ask opened (`doing.words`; `Ran npm` here), then the shipped line. Still one entry, at the same time; the notifier unchanged | the line |
| `region-keeps-last-line` | AC3 | The region's node holds one row, its last line. `snapshot.announcements` and every line are as shipped | the four lines it lost |
| `announces-every-ask` | AC4 | Every ask that opens adds its entry, the shipped line for it with its question, whichever page is open and whether or not the notifier posts for it. The notifier unchanged | B's ask |
| `announces-doing-line` | AC5 | Each change of the doing line of the session on the open page adds one entry, at once, never folded with another: 30 changes, 30 entries | the count, 30 |
| `receipt-announces-each-second` | AC7 | The held receipt of the card in the window (the card answered by a press on it, counting its hold down) announces each value its countdown shows from 10 s to 1 s: the shipped entry at the hold's start and one more at each whole second from 1 s to 9 s into the hold, each at once, never folded. The entry when the step ran is as shipped | 10 entries |
| `announces-each-change` | AC8 | The 2 s rule is off: each change adds its own entry at once. Three asks add three, each the shipped line for its ask with its question | the three entries |

No `twins.json`: every criterion is new behaviour, the merge base announces nothing, and the wrong programs the criteria
name are these plants.

## The fixtures

Every world is a record a real hub made. A change a run makes is one a real hub recorded: the hub is stopped by its PID,
the change is appended through the record and asks core as the core appends it (#2018's `Seeder` over #26's `seed`, as
#1463's and #2018's worlds do), the hub starts on the same record and builds the rows it builds for anyone, and
everything it appended is fed to the running replica in log order, each event one frame of its clock (`helpers.ts`,
`changed` and `Stage.feedNew`). So the test never writes a `row.set` of its own, with one exception said below. The
replica is at the reference window, 1512 × 982 points, on a copy of the record (`launch.from: "record_copy"`).

- **The journey** (`window.test.ts`): two sessions of project `shop`, Cart totals (A) and Release notes (B), each with a
  prompt, one shell call and a stop with no claim, and no open ask. Before A's page opens, A's row is fed once reading
  `working` with `doing: {words: "Ran npm"}`, as the core writes a working session's row (`row.set@3`, placed by the
  hub's own `orderOf` through #1461's `rowSet`): the exception, there so that a planted line has doing words to start
  with. Then `open session/<A>`, and 3 s. Then a choice from A, "Which store keeps the cart totals?"; 3 s; a choice from
  B, "Which heading opens the release notes?"; 3 s; and four more choices from A, 3 s after each.
- **The send-back** (`state.test.ts`): Cart totals stopped with a claim, so it reads says done; its page open; then the
  core's `verdict.made` FAIL on that claim and its `claim.sent_back`, round 1.
- **The turn** (`state.test.ts`): Search box, seeded with its start and task; its agent's hooks go through the hub's hook
  entry, each the recorded payload #2021's suite uses for that event and tool (`payloadOf`, `written`): a session start,
  a prompt and one Read before its page opens, so it reads working; then fifteen Reads of fifteen files, a PreToolUse
  and a PostToolUse each, one event every 2 s of the replica's clock. The run is BLOCKED unless the page's line
  (`session-doing`) changed 30 times within 61 s and the session read working at both ends.
- **The card** (`card.test.ts`): #3234's redraft's world, one taste call pinned to `doc:<id>@1` whose document lists one
  400 × 300 picture; its card presented and armed; then that document's revision 2, `doc.patched@2` as the hub records an
  agent's revision (`fedRevision`), with the picture replaced by another hash. Then three `refresh` calls, 2.5 s of
  frames, and `open` of the same address.
- **The hold** (`hold.test.ts`): #1101's world and session, by import: a real hub on its test clock holds `git push
  origin main` with an authority ask. The replica is launched on a copy of the record taken then (`launch.from:
  "fixture"`), its clock run to the hub's, the ask's page open and its card armed. The approval is one yes given in two
  places. The hub gets #1101's `allowOnCard`, signed as the app signs it (the hub's clock is first stepped up to the
  replica's, so the hold never starts in the replica's past). The replica's clock is run to that `ask.answered`'s time,
  and there the yes is pressed on the card in the window, one hardware press on its allow option as #1101's `pressAllow`
  makes it: the card reads `answered` and its receipt counts the hold down. Then what the hub appended is fed: the hold's
  start. The replica's own copy of the hub records the card's answer too, so its record holds that `ask.answered`
  twice, the copy's and the hub's. Then 9.5 s of the replica's clock with nothing fed. Then the hub's clock is stepped
  to 10 s, the agent's next try is let through and the push runs for real to a bare repository; the replica's clock
  follows to 10.2 s and what the hub recorded is fed; 3 s. Phase 2 corrected this fixture: with the yes sent to the hub
  alone and fed, the base's page turns into the closed ask's statement and no receipt counts down in the window (What
  was run).
- **Three together** (`changes.test.ts`): one finished session, its page open; three choices from it, each its own stop,
  append and start of the hub, 300 ms of the replica's clock between them. BLOCKED unless all three landed inside 2 s.
- **The hub** (`hub.test.ts`): one finished session, its page open; `hub {state: "stopped"}`; 3 s; 60 s more at a frame
  each 250 ms, so each of the app's retries has its frame; `hub {state: "answering"}`; then a frame each 250 ms until the
  window itself stops saying the hub isn't answering, which is the app's next read of the hub (at the base 27.5 s
  later; no longer than 31 s, or the second test is BLOCKED); then 3 s (Readings 16).
- **The live run** (`live.test.ts`): `liveWorld`, #1101's world with its hub on the wall clock, so the real app and the
  hub read the same time; one session on the hook wire. The real `deep-app` in that HOME, set to the reference window;
  `deep open session/<id>`; the replica on a copy of the record with the same page open; the app brought to the front;
  then the hub holds the session's `git push origin main` and raises its ask, and what it appended is fed to the replica.
- **The idle window** (`budgets.test.ts`): 30 sessions, ten a project in `docs`, `shop` and `web`, each stopped with no
  claim three and a half hours ago, two seconds apart, and no open ask; `launch.frames: "dirty"`, `read_back: "off"`.

## Criterion to tests

IDs are `criterionId` in `scripts/proof-change.mjs`, computed from the issue's body. Each title starts `AC<n> #3232.<id>`.

| Criterion | ID | Test | Wrong programs it fails on |
|---|---|---|---|
| AC1 | `#3232.2159e687` | `window.test.ts`: with A's page open and nothing said yet, A's ask opens; once its events are fed, and at most one event more, the list holds its entry; 3 s later it holds exactly one, with the question and the count 1; the trace holds no notification for it | the merge base (no list), naming the ask; two lines for one ask; a late line; a notification posted |
| AC2 | `#3232.67b6e9ba` | `window.test.ts`: that entry starts with `needs you` and ends with `⌘J` | the merge base; `ask-line-starts-with-doing`, naming the line |
| AC3 | `#3232.98c95ce3` | `window.test.ts`: after B's ask and four more from A, the five entries made are the region's five rows, newest first, each with its line and its entry's clock time; the replica's screenshot of the region and of each row has no picture, and no drawn string holds a line; the window's screenshot is taken at 3024 × 1964 | the merge base (no region); `region-keeps-last-line`, naming the four lost |
| AC4 | `#3232.1291a87a` | `window.test.ts`: B's ask adds no entry and the trace holds its one notification | the merge base (no list); `announces-every-ask`, naming B's ask |
| AC5 | `#3232.2276c799` | `state.test.ts`: the send-back adds one entry with `Cart totals`, `sent back` and `1 of 3`; the turn's 30 changes of the doing line add none | the merge base; `announces-doing-line`, naming 30 |
| AC6 | `#3232.7554be7e` | `card.test.ts`: the moved revision adds one entry saying the question changed, and the card, armed before, stops reading armed and reads armed again within 3 s; the redraws and the second `open` add none | the merge base (no list), in both tests; a window that says it at every draw |
| AC7 | `#3232.c570463b` | `hold.test.ts`: the push approved on its card; one entry by 9.5 s into the hold, made within 2.5 s of its start, with `10 s` and `⌘Z`; exactly one more once the push ran | the merge base; `receipt-announces-each-second`, naming 10 entries |
| AC8 | `#3232.b7a0e74d` | `changes.test.ts`: three asks inside 2 s add one entry holding the count 3 | the merge base; `announces-each-change`, naming the three |
| AC9 | `#3232.a096a169` | `hub.test.ts`: one entry says the hub isn't answering; the 60 s add none; from then to 3 s after the window reads that the hub answers, exactly one more, which doesn't say it isn't answering | the merge base, in both tests; a line at each retry; no line, two lines or a late line at its return |
| AC10 | `#3232.a107747a` | `live.test.ts`: the real window's tree holds one node marked polite, `live-region`, its value the last line and its rows the replica's entries for the same ask | the merge base (no node marked); BLOCKED, naming where it stopped, off a reference Mac, without the permission, with the session locked or the window not in front |
| AC11 | `#3232.fec442e2` | `budgets.test.ts`: 60 idle seconds add no entry; no frame of them drew or told an entity, or no more than at the merge base | the merge base (no list); a window that speaks or wakes on a timer |

No test passes when its surface is missing: a snapshot without the list, a trace without notifications, a build, hub,
replica or window that isn't there stops it `BLOCKED: …` or fails naming what is missing; a reading the machine can't
decide is `INCONCLUSIVE: …`, a failure, never a pass. By a run at the merge base (`BASE-FAILURE.txt`): every test of
the replica fails there at its own judge, since the merge base's snapshot carries no announcements, `live.test.ts` is
BLOCKED where the window can't be read, and none passes.

## Readings, where the issue and the design leave a choice (a redraft may revisit them)

1. **Where the announcements are, and an entry.** `snapshot.announcements`, `{t, text}`: "the replica's snapshot carries
   the window's announcements as data, in order with their times, as a document's does". A document's entry also has
   the readout's `id`; no criterion needs one here.
2. **"Within one event of the ask"** is read once the events the hub appended for the ask are fed and, if the entry isn't
   there yet, after one more record event that says nothing itself (`session.activity` of the other session, as #2021's
   suite feeds one). #2021 reads the same words with no event more; this is the looser of the two.
3. **"The count in words"** is the count of asks that need you, as a number or its word, standing alone outside the
   question, the keys and the session's name. Each fixture has no ask open before, so the asks that opened and the asks
   open are the same number. The copy table's own count sentence is not required word for word.
4. **"Starts with needs you"** ignores case: the state's word is `needs you` and the list's heading `Needs you`, and
   either is heard the same.
5. **The key's form** is the app's shown form (`⌘J`), the one every surface draws, never the table's `cmd-j`. "Ends
   with" allows nothing after the key but white space.
6. **An ask from A and A's own row.** A real hub records an ask from A together with A's row turning needs you, so the
   run holds both changes at once, and the criterion's "exactly one entry" is held against that record.
7. **"Four more changes"** are four more asks from A, 3 s apart, so AC3 leans on nothing AC1 doesn't already hold.
8. **A row's time** is a clock time, `HH:MM`, the form the app writes one in a notification and on a decided ask; a time
   that ticks is what the issue keeps out of what is said.
9. **"The screenshot draws none of them"** is read from the replica's own screenshots: a screenshot of the region and of
   each row has no picture (`locate.none`, as #2021's `shot` reads a node the window doesn't draw), and the frame draws
   no string holding a line. Pixels are not compared: an ask's arrival changes the list beside the region for its own
   reasons, and no change the issue lists leaves the rest of the window still.
10. **"Round 1 of 3"** is read as `1 of 3`, the design's "shown with its round, such as 1 of 3".
11. **"A recorded turn"** is #2021's: the hook payloads its suite recorded, with this turn's session, files and calls.
    Its page is opened once the session reads working, so its word turning to working is no change on the open page.
12. **"A presented card whose pinned revision moves"** is a taste call pinned to a document revision whose document gets
    its next revision, `doc.patched`, the event #3234's redraft settled on. **"The card arms again"**: armed is the
    card's node and its accepting option both reading `armed`; it must stop reading armed after the move and read armed
    again within 3 s. **"Saying the question changed"** is the two words, `question` and a form of `changed`.
13. **"Redrawing the same card"** is every view rendered again (`refresh`), 2.5 s of frames and its page opened again.
14. **"Approving a fixture push"** is the yes pressed on the push's card in the window, the hub given the same yes and
    its record of it fed. At the base a hold counts down in the window only on a card answered there, or on a page
    opened after the hold began; a yes that reaches an open page from the record alone leaves no receipt on it (phase
    2's probe), and then no countdown runs for the criterion to speak of. **"At the hold's start"** is no later than 2.5
    s of the replica's clock after the press, which is made at the time of the hub's `ask.answered`. **"While the
    countdown runs"** is from then to 9.5 s into the hold, with nothing fed: a receipt that speaks each second has by
    then said ten values, 10 s to 1 s. **"When the push ran"** is 3 s after the hub's events for the push are fed.
15. **"Three changes"** are three asks from the session on the open page: the one kind of change whose line has a count.
16. **"One more comes when it answers"** is exactly one entry from the end of the 60 s to 3 s after the app reads that
    the hub answers; its words are not read, but it may not say the hub isn't answering. The app reads so at its watch's
    next read of the hub, and the test finds that read in the window itself: the first frame at which the window no
    longer says the hub isn't answering.
    **The dispute, and the ruling (phase 2).** The first draft read "when it answers" as the 3 s after the replica's `hub
    {state: "answering"}`. The claim against it: at the base the app learns that a stopped hub answers only at its own
    next read of it (`HubWatch::tick` in `crates/deep-app/src/record.rs`, which the app's loop and the replica's tick
    both drive), on #994's schedule, every 2 s and then every 30 s once the hub has been down a minute; after the
    fixture's 63 s that read is some 27 s away, so nothing that keeps the schedule can know inside 3 s. The claim is
    true, by reading and by a probe at the base: 3 s after `answering` the window still drew "The hub isn't answering
    since …", and it stopped 27.5 s after `answering`, 90.5 s after the stop. A shorter stop can't dodge it: "none
    repeats over the next 60 s" keeps the hub down past the minute before it returns. And the criterion asks for no
    new schedule: #994 states this one, and #3232's scope changes what the window says, not when the app reads the
    hub. So "when it answers" is when the app reads that it answers. The test waits for that read, for at most the
    schedule's 30 s and a second, then 3 s as before. The criterion is held as hard as it was: none over the 60 s;
    exactly one more, and not one that says it isn't answering, counted over the whole wait, so a line said again while
    the hub is still read as down, or two lines at its return, fail, and a line later than 3 s after the window's own
    read is none and fails. A window that never reads the hub again leaves the second test BLOCKED, naming it; the
    first test is judged without it.
17. **"Read through AppKit"** is the real app read from outside its process through the Accessibility API, as #1459's
    identifier test reads it. **"Marked as a polite live region"** is the attribute `AXARIALive` reading `polite`: the
    base's adapter only asks AppKit to announce such a node's value and marks nothing in the tree, so some mark has to
    be added, and this is the attribute an assistive client reads a region's politeness from. **"The first criterion's
    run, live"** is the same scenario on a hub that keeps answering: the ask is the one the hub raises for a held push,
    since stopping the hub to append one would itself be a change the window says. **"The same entries"** are the
    replica's entries for that ask and the live region's rows, newest first, line for line; times are not compared.
18. **"On the reference Mac"** (AC10): off one of the design's three the test is BLOCKED and builds nothing. Power, heat
    and load are not asked: reading a tree is no timing.
19. **"30 quiet sessions"** are 30 sessions with no event in the 60 s, the hub quiet, as #2680's idle minute has it; their
    state word is not judged (they read finished here). **"No wakeup"** is #3234's reading: a frame of the replica's
    clock that drew or told an entity. Their ages are in hours, so no time the window draws turns over in the minute.
    **"Compared with the merge base, on the reference Mac in the local preflight"**: none is a pass anywhere; a count above
    none is compared with the merge base's over the same record only on a fit reference Mac, and is INCONCLUSIVE elsewhere.

## Scope the criteria don't cover

No criterion names these, so nothing here tests them: the count of asks waiting as new beside a presented card; a
default applied to the ask on the open page; a hold withdrawn; whom a state line says the session waits for; a state
change of an ask on the open page; the window not being key; a line's words beyond those pinned, and that every one
comes through the copy table (`scripts/app-copy-lint.mjs` holds that); the region's own `value` in the replica, and its
role; a sixth line pushing the oldest row out; hover, unread marks and rows that move; speech, sounds and a plug-in's
panel; a real screen reader's run, which the design calls a smoke test.

## What the implementer adds outside this folder

Nothing this suite reads by path but the product itself: the six plants read through `deep_app::plain::planted`; the
copy keys; the carried patch for `AXARIALive` with its row in `vendor/gpui-pre-apple/upstream/README.md`. `lane.json`
lists the folder by itself. No `[[test]]` entry, no list of plants and no fixture file is needed.

## What was run

Phase 1, before the base was built:

- `node node_modules/typescript/bin/tsc -p tests/acceptance/3232/tsconfig.json`: exit 0.
- Each judge of `judges.ts` against planted inputs, as a plain node script: 93 checks, each good input passing and each
  wrong one failing with the words its criterion names (the merge base's missing list among them).
- `node scripts/wait-ratchet.mjs`: PASS; the three timers in `helpers.ts` only bound a wait and carry `// deadline:`.
- Not run: any test file, `deep-drive`, a hub, the real app, `swiftc`, `node scripts/repo-rules.mjs` (it starts cargo).

Phase 2, with the base built (2026-11-24):

- A first request for a test grant, at 02:49, got none in its 60 minutes (`INCONCLUSIVE no grant`), and nothing ran.
  The job was taken up again at 19:35. The checkout's `target/` had been removed in between, so `target/debug/deep-hook`
  was built again first (`cargo build --locked -q -p deep-hook --bin deep-hook`, 68 s). Every other binary was the copy
  built for phase 2, still newer than every Rust source, and no run compiled a workspace crate.
- Everything ran through `node scripts/throttle.mjs test --wait 600 -- sh <a script>`: one grant for a whole script, its
  steps one at a time. Three grants: at 19:39, nine probes and each of the eight files; at 19:49, two probes of the
  hold pressed on its card; and a last one, a probe of the redrafted hub fixture and each of the eight files again, on
  the files as they stand. `BASE-FAILURE.txt` holds the last run. In the first run the same 20 tests failed with the
  same lines.
- The probes (a scratch vitest file outside this folder, not kept), each on a real hub's world and the base's
  `deep-drive`, and what each showed:
  1. The journey. Both seeded sessions read `finished`. The fed `row.set@3` is taken, and A's page names its
     `session-doing` node `Ran npm · 2 s ago`. `feed` takes `session.activity`. An ask appended with the hub stopped is
     fed as `hub.stopped`, `ask.created`, `ask.batched`, `session.state` and two `row.set`s, 6 frames, and B's
     notification is posted once fed. A screenshot by `{id: "live-region"}`, or by a role and a name nothing has,
     answers `locate.none`. The window's screenshot is 3024 × 1964.
  2. The send-back. The claimed stop reads `says done`; after the FAIL and the send-back the row reads `sent back`,
     "its checks sent its claim back, round 1 of 3".
  3. The turn. The seeded session reads `queued`, and `working` once its first hooks are in. Each of the 30 tool
     events changes the `session-doing` line (`Reading src/part0.ts`, `Read src/part0.ts`, …), in 60 s of the replica's
     clock, and it reads `working` at the end.
  4. The card. It reads `armed` 0.5 s after its page opens. At the moved revision it reads `presented` with the new
     picture and `armed` again 0.5 s later: the base arms again already, so only the entry is new behaviour in AC6.
  5. The hold as first drafted. After the fed `ask.answered` and `approval.held`, the open page read `Answered "Push it"
     at … in the app. Allowed · not run yet. Nothing is left to answer.` from the feed to 9.5 s and after the push
     ran, with no `Starts in` and no Undo. No receipt counted down in the window, so the fixture was wrong.
  6. Three asks, each its own stop and start of the hub: 6, 5 and 5 frames, 0.87 s of the replica's clock in all.
  7. A hub on the wall clock (`liveWorld`) holds the push and raises its ask.
  8. The idle window. 30 sessions, all `finished`; none of the minute's 3,600 frames drew or told an entity, so the
     merge base wakes for nothing and the budgets test has nothing to compare there.
  9. The hub, for the dispute (Readings 16). The window first says the hub isn't answering 0.5 s after the stop
     (`sidebar-count`, `list-empty`, the menu bar's line and a drawn string). 3 s after `answering`, 63 s stopped, it
     still says so. Its last read saying so is 27.3 s after `answering`, its first without 27.5 s after, 90.5 s after
     the stop.
  10. The hold pressed on its card, everything the hub appended fed. The card reads `answered`, with `Starts in 10 s`
      and `card-undo`; `Starts in 9 s` at 1.2 s, `6 s` at 4.2 s, `2 s` at 8.2 s, `1 s` at 9.5 s, and `0 s` at 10.2 s
      until the run is fed; then the card leaves the page.
  11. The same without the hub's own `ask.answered` and the ask's `row.set`: the same readings. The fixture feeds
      everything, as every other run here does.
  12. The redrafted hub fixture, read with `judges.ts`'s `windowSaysDown`. PROBE12
- What phase 2 changed: `hold.test.ts` (the yes pressed on the card); `hub.test.ts` and `judges.ts` (AC9's second
  reading: `windowSaysDown`, `HubRun.knewAfter` and `unread`, `hubQuietThenBack`); this file; `BASE-FAILURE.txt`.
- After the changes: the type-check, exit 0; each judge against planted inputs again, 97 checks; `node
  scripts/wait-ratchet.mjs`, PASS.
- `live.test.ts` stopped at its second gate, BLOCKED on the Accessibility permission, before any build, app or window.
  `budgets.test.ts` fails at its judge before a wakeup is counted, so nothing was built or compared, and the merge
  base's own tree was never built.
- No run compiled a workspace crate. `tests/acceptance/3232/node_modules/.vite`, which the runs made, was removed.
- Not run: any planted program (none exists at the base: each wrong-program test fails where it first holds the
  shipped run to its judge); `live.test.ts` past its permission gate; the timed comparison of `budgets.test.ts`; `node
  scripts/repo-rules.mjs` (it starts cargo; the folder was searched for a home folder's path instead, and holds none).

## Files

- `judges.ts`: the IDs, the plants' names, the pinned words, the keys, and one judge a criterion. Node built-ins only.
- `helpers.ts`: the builds, the reference-Mac gate, the replica's client, a run (`Stage`, `changed`), a session's turn
  (`Turn`), the live world, the real app and its probe, the merge base's replica.
- `window.test.ts` (AC1 to AC4), `state.test.ts` (AC5), `card.test.ts` (AC6), `hold.test.ts` (AC7), `changes.test.ts`
  (AC8), `hub.test.ts` (AC9), `live.test.ts` and `probe.swift` (AC10), `budgets.test.ts` (AC11).
- `lane.json`, `tsconfig.json`. `BASE-FAILURE.txt`: what phase 2 could and couldn't run at the base.
