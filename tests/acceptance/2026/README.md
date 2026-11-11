# Acceptance tests for #2026: Needs you's count, one inbox projection for the list, the menu bar and `deep inbox`

Written first and blind, at base commit `6e55e5841`, from issue #2026 (its Scope, its "Reads under #1453"
paragraph, the Needs-you view field and the five open acceptance criteria; the sixth, "1 ask needs you", is proven by
#1455 and isn't tested again here), the design and the base, before any implementation. The implementing agent does not
edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

## What was read

- **The issue**: Scope (one inbox projection in the hub with the asks core's close rule; no second close list in the app
  or the replica; the menu bar never counts sessions; a hub that can't be read never reads as 0, empty or the last value
  as current; counts in words), the shape (#1453, #1461), Reads under #1453 (Home reading a count is the list's Needs you
  heading; Home is the page shown when nothing needs you), the Needs-you view field, criteria 1 to 5, Proof.
- **The design**, `docs/technical-design.md`: One event log (`log_pos`, kept apart from the event's ID and `seq`); the hook
  protocol (the spool keeps each request byte for byte, a replayed event keeps its ID and `seq` and takes the next
  `log_pos`, "a permission request spooled while the hub was down still becomes an ask you see"); the App API (a consumer
  resumes after the last `log_pos` it holds; one record reader in the app); An ask, and your answer getting back (every
  ask ends, the closing kinds, the first close decides, no agent closes an ask); the view row (one count everywhere);
  States people see (the row shape, "with the hub down it says DeepBuild isn't reachable, never an old state as
  current"); Numbers ("The app: Inbox loaded in under 1 second, with 30 days of history", the reference Macs); the
  Needs-you view and the Replica; Decided (where a consumer resumes; the app's toolkit and the menu bar's count).
- **The base**, for its surfaces only: `packages/hub/src/{inbox,list,rows,status,spool,plant,server}.ts` and the parts of
  `core.ts` on `inbox.read`, permissions and the spool; `packages/asks/src/index.ts` (statuses, the fold, Later, held,
  the close fold); `packages/record/src/{index,projections}.ts`; `crates/deep-app/src/{record,hub,views,list,empties,
  notify,states,setup,lib}.rs`; `crates/deep-replica/src/{main,lib,live,snapshot}.rs` and `drive/mod.rs`;
  `crates/deep-hook/src/main.rs` (the spool); the contracts of the ask events; the suites `16`, `26`, `315`, `994`,
  `1455`, `1459`, `1461`, `1463`, `1546`, `1551` and `18/kit`.

## How to run

With Node 24.22 first on `PATH`, cargo (1.99.1) on `PATH`, on macOS, in a logged-in session whose display is unlocked:

```sh
npm ci --ignore-scripts && npm run build --workspaces
# optional, to build ahead under the machine's throttle; the helpers build what's missing themselves
node scripts/throttle.mjs build -- cargo build --locked -p deep-replica --features env-plants --bin deep-replica --bin deep-live
npx vitest run --root tests/acceptance/2026 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/2026/tsconfig.json
```

- **Builds.** The helpers build `deep-hook` into the checkout's target (the hub and #16's helpers look for it there), and
  `deep-replica` and `deep-live` with `--features env-plants` and then plain, each copied out of the target folder into
  `$TMPDIR/da2026-bin-<uid>/`, so a planted binary never stands in for the plain one. They use #1172's build environment
  (`CARGO_INCREMENTAL=0`, `CARGO_PROFILE_DEV_DEBUG=0`); `CARGO_TARGET_DIR` is honored. A cold build of the GPUI stack
  takes a long time on a loaded Mac; build first under `scripts/throttle.mjs build` as above.
- **Windows.** `replay.test.ts` (AC3) and `outage.test.ts` (AC5) open the real app window on this Mac's display through
  `deep-live --watch` (#1546), which needs no Accessibility permission but does need a shown window: on a locked display
  they stop `BLOCKED` at its ready line. The other files draw headless.
- **Folders and processes.** Homes are under `/tmp/da2026-*` (and #16's and #26's own folders where their helpers make
  them). Nothing touches the real `~/.deepbuild`, `~/.claude` or `~/Library/LaunchAgents`. Only what a test started is
  stopped, by PID. Every clock time is read in `Asia/Kolkata`, a half-hour zone, set for the suite and its children.
- **Timing.** AC1's second, AC3's 1 s and AC5's 2 s count only on a fit, quiet reference Mac (#1551's gate): a reading
  within its limit passes anywhere; one over it fails there and reads INCONCLUSIVE elsewhere, never PASS.
- **Lanes.** The files build, draw and time, so the folder belongs on `scripts/lanes.mjs`'s one-at-a-time list in a
  macOS, logged-in lane, with AC3's and AC5's files run where a window can show; the implementer makes that edit.
- Vitest writes `tests/acceptance/2026/node_modules/.vite/` under `--root`; delete it before committing.

## The surface (my choice where the issue names none)

Every record is made the way the hub makes one: seeded through the real record and asks core with the hub stopped
(#26's `seed`; `helpers.ts` `askAndClose`, `later`, `typed`, `closeKinds`), then served by a real hub (`deep hub run` in
a temp HOME). Each close is written as the core writes it: an answer and a Later through the asks core's own trusted
path, a supersede by a newer ask on the same key, a default undone through the core's undo, and the other closes as the
core's events; an agent's close is a hook's `ask.cancelled`. Three readers read it, each the real one:

- **`deep inbox`** (and `--json`, for its rows): its count is the last line it prints.
- **The app's first screen**, `deep-replica --first-screen` (#1002) in the HOME of a running hub: the app's own reader
  and views, drawn headless once, with the menu bar's title in the snapshot and `menu-bar.txt`. AC1, AC2 and AC4.
- **The real app window on the hub**, `deep-live --view needs-you --out <file> --watch` (#1546): the app's own record
  reader and tick on a real hub, one line per frame the window draws. AC3 and AC5, where the hub stops, starts and
  replays while the app is open.

Home's count is the list's Needs you heading (the issue's Reads under #1453), `heading:needs-you`, with the words inside
it; the rows Needs you lists are the list's ask rows, `ask:<ULID>` (#1461); AC5's Needs you is the list's section below
the heading, up to the next heading. **The record's open asks** are this suite's own reading of the hub's log
(`events.read`) by the design's close rule (helpers.ts `openAsks`): an ask is open from its `ask.created` until the first
`decision.applied` naming it, or `ask.answered`, `ask.defaulted`, `ask.escalated`, `ask.cancelled`, `ask.superseded` or
`ask.moot` about it, written by anyone but an agent (a hook or an MCP server); the core's `default.undone` opens a
defaulted ask again. Folded, later and held asks, and the exception that holds folded ones, are open asks.

### Merged surfaces, used as they are

`deep hub run`; the hook wire (#16's `sendHook`); `events.read`, `inbox.read` (its `log_pos`) and `stream.subscribe` as
the cli; `deep inbox [--json]`; deep-hook's spool at `~/.deepbuild/spool/spool.jsonl` and the hub's pass for a spool that
lands while it runs; the record and asks core through #26's `seed` and its heavy month (`seedMonth`); `deep-replica
--first-screen` and its line `deep-replica: first frame drawn`; `deep-live --view needs-you --out <file> --watch` and its
`{"ready": true, "at"}` and `{frame, at, log_pos, names}` lines; #1461's ids (`list`, `heading:needs-you` valued the
count once read, `heading:<project>`, `ask:<ULID>`); the snapshot's `menu_bar.title`; #1551's reference-Mac gate.

### Pinned here: the implementation must provide these

1. **`deep-live --watch` shows what the app shows** (AC3, AC5). Each frame line also carries `snapshot`: the window's
   snapshot in the replica's shape, as `deep-replica` writes `snapshots/<view>.json` (a `tree` of nodes with `role`,
   `name`, `value`, `id`, `bounds` and `children`, and `menu_bar.title`, the title the app's status item shows at that
   frame). And its tick runs as `deep-app`'s loop runs it: what the hub's watch reads (the hub not answering, and since
   when) reaches the views and the menu bar's title, so a stopped hub shows in its window as in the app's.
2. **A spooled permission request becomes an ask** (AC3). Once the hub replays a Claude Code `PermissionRequest`
   deep-hook spooled, the record holds an `ask.created` whose `session` is that request's session, and Needs you lists
   it as a row `ask:<ULID>` of that event's ID.
3. **The first screen is the record as read** (AC1, AC2, AC4). `deep-replica --first-screen`'s snapshot shows Needs you
   as read from the hub: the heading valued the number of open asks, a row for each that fits.
4. **Counts in words**, on the menu bar, Home's heading and `deep inbox`'s last line: `N asks need you`,
   `1 ask needs you` or `Nothing needs you` (the heading's value may be the bare number). With the hub not answering, a
   surface says `isn't answering` (or `not answering`) and `since HH:MM`, the 24-hour clock in your time zone, as the base's
   `The hub isn't answering since 14:02` does; Home's heading then carries no number as its value.
5. **Plants, selected by `DEEP_HUB_PLANT`** and read through `deep_app::plain::planted` in builds with `env-plants` only
   (`deep-replica --features env-plants` turns it on for `deep-replica` and `deep-live`; a release build refuses it). The
   hub is never given the variable. Each lives in the component that draws its surface:
   - `reader-keeps-place-by-id` (AC3): the app's one record reader keeps its place by the newest event ID it applied, not
     by `log_pos`: a frame whose event's ID sorts at or before that one is taken as already seen. It must never show the
     replayed ask, as the criterion says.
   - `home-skips-decision-close` (AC4): Home's count (the list's Needs you heading) leaves out a decision's close, so an
     ask `decision.applied` closed counts as open.
   - `menu-bar-counts-sessions` (AC4): the menu bar's count counts sessions, not asks.
   - `hub-down-nothing-needs-you` (AC5): with the hub not answering, the list's Needs you section shows
     `Nothing needs you` and no rows.
   - `hub-down-keeps-count` (AC5): with the hub not answering, the menu bar keeps the last count it showed, as if live.

### The fixtures

- **AC4** (`helpers.ts` `closeKinds`), in project `shop`: session `closes` raises a choice and closes it each way the
  issue names (applied by a decision saved from an answered ask, answered, defaulted, escalated, cancelled, superseded by
  a newer ask on the same key, moot), and one more a hook tries to cancel; the superseding ask and that one stay open.
  Session `folds` raises six, so the sixth folds into the exception the core raises. Session `later` has one ask put off
  with Later, and session `held` one ask held for a message you typed that its agent hasn't read. Eleven open asks in
  four sessions, so a count of sessions can't pass for one of asks, and a count that leaves out the decision's close
  reads twelve.
- **AC2**: five records from seeds 2026 to 2030 (`count.test.ts` `plan`). Each holds thirteen asks, one of each fate in
  an order of its seed's: three left open, answered, applied by a decision, defaulted, defaulted then undone, escalated,
  cancelled, superseded, moot, cancelled by a hook, put off with Later; dealt into sessions of one to four asks, about a
  third of them typed to first so their asks are held; every other record adds a session of six open asks, which folds.
- **AC1**: #26's heavy month: 30 days of 20 sessions, each with its start, five asks, a decision saved from the first and
  an open item; the asks past their deadlines take their defaults, so the last day's hundred stay open, and the hub
  defaults each as its deadline passes during the run (so the record is read on each side of every launch).
- **AC3**: two Claude Code sessions on the hook wire; A's permission request for `npm publish --tag next` goes through
  deep-hook with the hub stopped; B's 20 hooks are ten Bash calls, each a PreToolUse and a PostToolUse.
- **AC5**: one session with three open choices; while the hub is stopped the core cancels the first in the record.

## Criterion to tests

| Criterion | ID | Test | Wrong programs it fails on |
|---|---|---|---|
| AC1 Needs you loads in under a second with 30 days of history | `#2026.2baf6583` | `load.test.ts`: the first screen over the month, five launches after one untimed, each with Needs you read (the heading's count one the record held across that launch, its rows among its open asks); the slowest within 1000 ms from spawn to the first frame | a reader that reads the whole log before its first frame (the base's `fold_before`); one that draws before it has read ("reading", no rows) |
| AC2 Needs you never leaves out an open ask: its count always matches the record's open asks | `#2026.e51f5486` | `count.test.ts`: five generated records; on each, the menu bar, Home and `deep inbox` read the record's number of open asks, Needs you's rows and `deep inbox`'s are exactly them; the judge is held once to Needs you with the oldest open ask taken out, and must name it | a second close list that misses a kind, closes on an agent's close, or keeps a default undone closed; a Needs you that drops a folded, later or held ask |
| AC3 the spooled permission request shows in Needs you within 1 s of the replay, after 20 newer events | `#2026.8e76ad64` | `replay.test.ts`: the scenario on the real window; the app reconnects (a frame at the hub's new `log_pos`), receives B's 20 events (each newer by ID and `seq`, a frame at the 20th's `log_pos`), the spool lands and the stream shows its replay; the record holds A's ask, and a frame lists its row within 1000 ms of the replay | the base (the replay raises no ask); `reader-keeps-place-by-id`, which must fail with "Needs you never showed the ask `ask:<ULID>`" |
| AC4 one number on the menu bar, Home and in `deep inbox`, rows adding up to it | `#2026.44fb65f8` | `one-number.test.ts`: the fixture holds every close kind and eleven open asks; the three surfaces read 11, Needs you's rows are exactly those asks, as are `deep inbox`'s | `home-skips-decision-close`, naming Home; `menu-bar-counts-sessions`, naming the menu bar; each held first to a clean run that passes |
| AC5 within 2 s of a stop the three surfaces say it isn't answering and since when; on reconnect the record at the new `log_pos` | `#2026.3529e9fd` | `outage.test.ts`: three asks shown on the real window; the hub stopped by PID; the first frame on which the menu bar, Home and Needs you each say it isn't answering since a clock time within a minute of the stop, none saying nothing needs you or a live count, within 2000 ms; no frame of the outage saying nothing needs you; then the record moves to two asks, the hub starts, and a frame at its new `log_pos` reads 2 on each surface, lists exactly those rows and no longer says it isn't answering | the base (the menu bar's `The hub isn't answering` names no time; `--watch` carries no snapshot); `hub-down-nothing-needs-you`, naming Needs you; `hub-down-keeps-count`, naming the menu bar |

Two criterion-tagged tests pass at the base on purpose: AC2's, since the base's list, menu bar and `deep inbox` already
agree with the record on every generated record (it guards the change to one projection; its judge is held to a twin
that leaves an ask out), and AC4's fixture test, which the base also holds; AC4's plants are what fail there. See
BASE-FAILURE.txt.

No test passes when its surface is missing: a missing build, binary, line, snapshot or node stops it `BLOCKED: …` or fails
naming what's missing. A plant's test holds the clean run to the same judge first, so a program that already fails the
criterion can't make its plant look caught, and a plant the build ignores fails ("wasn't caught").

## Scope the criteria don't cover

No criterion names these, so nothing here tests them: the count's words beyond the number they say (criterion 6, #1455);
"Nothing needs you shows only once setup finished and the hub answers"; the ask the ID-keyed app misses reaching its
default unseen; how the hub's one projection is built and whether the app keeps any close list of its own (only what the
surfaces show is judged); `deep` and `deep status`; notifications; the Home page's own line; the Decided page; a hub
that refuses a read, as against one that's stopped.

## Disputes and assumptions a redraft may revisit

1. **Home** is the list's Needs you heading in AC4 and AC5, as Reads under #1453 says for a count; AC5's **Needs you** is
   the list's section below that heading (its line and rows). A reading where AC5's Home is the project page's
   "what needs you" line would read that page too.
2. **Every open ask is counted once and has its own row**: a folded ask and the exception that holds it, a later ask and
   a held ask each count one and are listed one each, so "the rows add up" is read as rows = the number. A reading where
   the exception's row stands for the asks it holds needs a redraft of AC2 and AC4's judge.
3. **The replay after 20 live events** is arranged by holding deep-hook's spool aside, byte for byte, while the hub starts,
   and putting it back after the 20 events, where the hub's pass for a spool that lands while it runs replays it (within
   2 s at the base). At a real start the hub replays its spool before it answers, so only a spool that lands late (a hook
   that missed its acknowledgement, a host link's) reaches the order the criterion names.
4. **B's 20 hooks go on the hook wire** (#16's `sendHook`, from a `sleep` standing in for the agent's process), not through
   deep-hook: on this loaded Mac a deep-hook often misses its 50 ms and spools late, which would put B's events in the
   spool too. A's request goes through deep-hook, which must spool it.
5. **The replay's moment** is when a cli subscriber on the hub's stream receives the replayed request's event (its ID);
   the ask shows when a frame's snapshot lists its row; the 1 s is from the one to the other, wall time.
6. **"Loads"** (AC1) is `deep-replica --first-screen`'s documented launch time, from its spawn to its first-frame line,
   counted only when its snapshot shows the record read; the debug build is timed, slower than what ships, so a pass is
   conservative. **30 days of history** is #26's heavy month (about 8,000 events: 3,000 asks, 600 decisions, 600 open
   items); a heavier month would change the reading.
7. **Timing** reads as #1551's gate does: within the limit passes anywhere; over it fails on a fit, quiet reference Mac
   and is INCONCLUSIVE elsewhere. An ask or a surface that never shows what it must fails whatever the load.
8. **"Since when"** is a clock time `HH:MM` within a minute of the stop, in the suite's zone; a relative age ("2 min
   ago") wouldn't pass and would need a redraft.
9. **"Keeps the old count as live"** is read as any count sentence or bare number on a surface while the hub is down,
   or the heading carrying a number as its value; and, once the hub is back, any surface not reading the new number.
10. **The new `log_pos`** comes from the record moving while the hub is down (the core cancels one of the three asks), so
    a view that keeps the old count shows 3 where the record holds 2.
11. **The record's open asks** are this suite's reading of the log by the design's close rule, not the hub's projection;
    a design change to that rule needs a redraft.
12. **AC2's property** runs five records, a few minutes each on a loaded Mac; more would be stronger and slower.

## Files

- `helpers.ts`: IDs and plants, builds, homes, the hub and its reads, the seeding of every close, the fixtures, the
  oracle, the snapshot readers and judges, the first screen, `deep-live --watch`, the hook wire, deep-hook and the spool.
  Reuses `../16/helpers.ts`, `../26/helpers.ts` and `../1551/helpers.ts`.
- `load.test.ts` (AC1), `count.test.ts` (AC2), `replay.test.ts` (AC3), `one-number.test.ts` (AC4), `outage.test.ts` (AC5).
- `tsconfig.json`: as #1461's. `BASE-FAILURE.txt`: the run at the base.
