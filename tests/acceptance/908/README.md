# Acceptance tests for #908: ask deadlines count only time the ask could be seen, with a minimum notice once it shows

Written first, blind, from issue #908 (its title, the problem paragraph, Scope, the three acceptance criteria and
Proof, as of November 1, 2026), `docs/technical-design.md` (An ask, and your answer getting back; Lifecycles; the rule
that a state that comes from time comes from an event; the `done.yaml` block and the paragraph after it; Timing
relations, "Asks and batches"; Decided, "Ask deadlines and defaults") and the base commit `a7e140b2` (`origin/main`,
with #318's asks core and #319's timing, and no implementation of #908). Code read at the base: the public entries of
`@deepbuild/asks` and `@deepbuild/record`, the record's asks projection, the `hub.stopped@1` schema, and how
`packages/hub/src/core.ts` drives the asks core (`openAsks` at start, the 1 s job, `hub.stopped` on a stop and on a
crash found at start). `tests/acceptance/319/` and `822/` were read for the form. The implementing agent doesn't edit
these files (AGENTS.md, Proof); a dispute goes to a blind redraft by this job.

## Run

```sh
npm ci                                   # once, if node_modules is missing
npm run build -w @deepbuild/contracts -w @deepbuild/evidence -w @deepbuild/record   # the record resolves these through dist/
npm run build -w @deepbuild/config-eval  # the root vitest.config.ts loads scripts/lanes.mjs, which imports it
npx vitest run tests/acceptance/908      # from the checkout's root; add --silent=false to see the timelines of passing tests
npx tsc -p tests/acceptance/908          # type-check the tests
```

Node 24.22 or newer, nothing else: no network, no hub process, no git. Each world is a real record on SQLite and a
home folder in its own temporary folder, with a virtual clock, removed afterwards. About 4 s in all.

Each test prints the issue's Proof for its world as it ends, one line per ask: raised, first shown, the deadline the
record holds, and the outcome with its time.

On the base, 5 of the 6 tests fail; the AC3 test passes, since the base moves no deadline at all (see the table).
`tsc` reports no errors on the base: the tests need no new export. `BASE-FAILURE.txt` holds the base run, a sample
fix kept outside this checkout that passes all 6, and five mutants of it with the tests each fails.

## The surface

The tests reach the code only through what the base already exports:

- **`@deepbuild/asks`** (`packages/asks/src/index.ts`): `draftAskSettings(home)`, `openAsks({ record, now, deliver,
  home })`, then `raise`, `tick`, `answer` on the card's connection; `askSources` and `duration`;
- **`@deepbuild/record`** (`packages/record/src/index.ts`): `openRecord`, `append`, `read`, `table('asks')`,
  `rebuild()`, `close()`;
- **events** the tests append as the hook and the hub do: `session.start@1`, and `hub.stopped@1` (`reason:
  'requested'`, writer core) when the hub stops; and events they read: `ask.created`, `ask.batched` (an ask's showing),
  the closing kinds (`ask.defaulted`, `ask.answered`, …), and the deadline move below.

What #908 adds is behaviour, one setting and one record kind. Stated as TypeScript:

```ts
// packages/asks: no new export, option or method.

// 1. Setup drafts the minimum notice per kind, beside deadline and default, into <home>/config.json:
//    { "asks": { "notice": { "taste": "1h", "authority": "1h", "unblock": "1h",
//                             "exception": "1h", "choice": "1h", "definition": "1h" }, … } }
//    Read like the other asks values: yours, overridden key by key by a repo's .deepbuild/done.yaml `asks:` block.

// 2. The core records each move of an ask's deadline as an event about the ask (a new schema in
//    packages/contracts/schemas; its kind name is the implementer's, e.g. ask.moved@1):
interface DeadlineMoved {
  subject: `ask:${string}`;  // the ask
  writer: 'core';
  data: { span: number;      // how much later the deadline moved, in ms
          [more: string]: unknown };
}

// 3. The record's asks projection (packages/record) sets the ask's `deadline` column from those events, from the
//    log alone, so record.rebuild() gives the same deadline. The tests read an ask's deadline from that column.
```

The tests find a deadline move as any event about the ask, written by the core, whose `data.span` is a number. For
the afternoon fixtures they count exactly one such event per ask, so a minimum-notice move, if it is recorded the same
way, must not be written for an ask that showed with more than its notice left (none of the afternoon asks does).

### The hub, asleep and down, on the virtual clock

- **Awake**: the hub's 1 s job calls `asks.tick()` once a second of virtual time (`World.awake`). Every second the
  hub is up and the Mac awake gets a tick.
- **Asleep**: the hub process stays up and its record open, but nothing runs: no tick, no append, while the clock
  jumps (23:30 to 08:00). The first tick after the Mac wakes runs at the wake time (`World.asleep`). That is what
  the base hub does: its `setInterval` timers don't fire while the Mac sleeps. So the core sees sleep only as a gap
  between two ticks; the tests allow the span it records to be the gap or the gap less one beat.
- **Down**: the hub stops as `deep hub stop` stops it: it appends `hub.stopped` (reason `requested`, at the stop
  time) and closes the record. Nothing runs while it's down. At the start time a new record handle and a new asks
  core open on the same file (`openAsks` ticks once as it opens), as the base hub's start does (`World.down`). With
  `rebuild`, `record.rebuild()` runs on the reopened record before the core opens.

### The minimum notice

The tests expect it drafted by `draftAskSettings(home)` under `asks.notice.<kind>` in `<home>/config.json`, 1 h
for every kind (`asleep.test.ts`, the setting test, read through `duration`). Every world runs on what setup drafts,
so AC1's 09:00 comes from that drafted value. Overriding it in a repo's `done.yaml` isn't tested (see Open points).

## Criteria to tests

| Criterion | Test (file › name) | Wrong programs it fails on | On the base |
|---|---|---|---|
| AC1 23:00 raise, 4 h, asleep 23:30–08:00: shows 08:00, not defaulted 08:00:01, defaults 09:00 unless answered | `asleep.test.ts` › AC1 an ask raised at 23:00 … unless answered | the base, which defaults on the next tick (fails at 08:00:01, naming the ask); mutants no-notice (the same), full-span and twice (no default at 09:00) | FAIL at 08:00:01, naming the ask |
| AC1, Scope: the notice drafted at setup, 1 h by default | `asleep.test.ts` › AC1 the minimum notice is drafted at setup … | the base (no notice drafted) | FAIL |
| AC2 the rebuilt record gives the same moved deadline (the night) | `ac2-redraft-2/rebuild.test.ts` (`#908.22f5f214`), the blind redraft that replaced this row's first draft and the Mac-asleep afternoon test: the first draft's sleep was a gap between ticks, which the core can't tell from #319's quiet hub, and it held the notice's 09:00 in the deadline column, which the redraft refuses (`ac2-redraft-2/README.md`) | see the redraft's table | FAIL (the redraft's `BASE-FAILURE.txt`) |
| AC2, Scope: down or asleep while unshown moves the deadline by the span, recorded with the span; the rebuilt record gives the same | `rebuild.test.ts` › AC2 the hub down from 16:01 to 00:30 …; asleep in `ac2-redraft-2/` | the base and mutant in-memory (no move recorded); move-shown (moved again after it showed); twice (twice the span) | FAIL: no move recorded |
| AC3 an ask shown before the hub went down keeps its deadline; every ask in the fixture ends | `down.test.ts` › AC3 an ask that showed before the hub went down … | mutants move-shown (19:59 became 23:57), twice (a deadline past its kind's wait counted again from its first showing) | PASS (the base moves nothing) |

## Choices that are this job's, not the issue's

- **Asleep and down are told apart by `hub.stopped`.** A stop appends it; sleep appends nothing and only leaves a
  gap between ticks. A crash (whose `hub.stopped` is appended at the next start, with the start's time) isn't
  tested: the down span after a crash would need the last time the hub ran, which the base record doesn't hold.
- **The tick runs every second while the hub is up.** The base hub calls `asks.tick()` only when its query finds an
  open ask past its deadline (or an unblock, or a new stop or verdict); with that gate, a tick gap is not sleep. So the
  hub has to tick every second, or tell the core about a gap some other way that ends in the same recorded move;
  these tests, which drive the core, don't run the hub.
- **"Shows" is the core's `ask.batched` naming the ask**, the base's record of a showing, in a batch or at once.
- **The ask's deadline is the record's.** "Recorded on the ask … so a rebuilt record gives the same deadline": the
  tests read the asks table's `deadline` column, before and after `record.rebuild()`, and also open a new core on
  the rebuilt record and check it defaults at that deadline, not before. For the night ask the record must hold
  09:00 once it shows, the time it defaults: the deadline the hub's 1 s query, the inbox and a notification read
  ("its notification names a default time in the past" is the problem the issue states). So the minimum notice is
  recorded on the ask too, by whatever event sets the column.
- **The span tolerance**: the hub may have gone at any moment between its last beat and the next, so a recorded span
  of the gap or the gap less one second (1 s) both pass.
- **Kinds and times**: AC1's "4 h deadline" is a definition ask, the kind setup drafts 4 h for; the twin answered at
  08:30 shows "unless answered". The afternoon fixtures use a definition ask (shown in the 16:00 batch) and a choice
  ask (2 days, so it waits for the 00:00 batch). All times are UTC; the drafted batches (every 8 h) fall at 00:00,
  08:00 and 16:00, so the night's ask, due at 03:00, waits for the 00:00 batch and is unshown when the Mac sleeps.
- **"Every ask ends"** is read as: each ask in the fixture closes once, no sooner than it showed, and its recorded
  deadline is no later than its kind's wait counted again from its first showing. A close may come later than that
  bound when the hub is down at the time (ask a defaults as the hub starts at 00:30).

## Open points

1. **AC1's 09:00 and Scope's first bullet read two ways.** The night ask is unshown and open the whole time the Mac
   sleeps, 23:30 to 08:00 (8 h 30 min). If that whole span moves its deadline, 03:00 becomes 11:30 (within the
   12:00 bound, the 4 h wait from 08:00), it shows at 08:00 with 3 h 30 min left, the notice doesn't apply, and it
   defaults at 11:30, not at 09:00 as AC1 says. AC1's 09:00 follows only if the span counts the time asleep before the
   deadline as it stood (23:30 to 03:00, giving 06:30, still before 08:00, so the notice gives 09:00), or if sleep
   moves nothing. The tests hold AC1's 09:00 as written. They leave the reading open where the two agree: in the
   afternoon fixtures the hub is back before the ask's deadline, so both readings give the same move. The sample fix
   takes the first of the two readings that keep 09:00; its full-span mutant shows the other fails AC1. The owner
   should confirm which reading is meant; if it is the whole span, AC1's expected time is 11:30 and this suite needs
   a redraft.
2. **The notice in a repo's `done.yaml`** (`asks: notice: { definition: 2h }`) isn't tested; no criterion names it.
3. **The hub process** isn't run. The hub-side change (a tick every second, or another way to hand the core a gap) is
   outside what these tests see.
4. **A crash's downtime** isn't tested (above).

## Files

- `helpers.ts`: the clock and its times (`at`, `clock`), ULIDs, connections, asks as `ask.created@1` data with no
  deadline, the drafted waits and notice, the world (awake, asleep, down, rebuild, the record's deadline, showings,
  closings) and the per-ask timeline.
- `scenarios.ts`: the night (AC1, AC2) and the afternoon (AC2, AC3) fixtures and their times.
- `asleep.test.ts` (AC1), `rebuild.test.ts` (AC2), `down.test.ts` (AC3).
- `tsconfig.json`: type-checks the suite under the root's strict options with `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the base run, the sample fix's run and the mutants'.
