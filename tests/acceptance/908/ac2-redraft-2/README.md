# #908 AC2, blind redraft 2: rebuilding the record gives the same moved deadline

Written blind from issue #908 (title, problem, Scope, AC1 to AC3 and Proof, as of November 2, 2026), `docs/technical-design.md` (An ask, and your answer getting back; Lifecycles and the Ask primitive; the `done.yaml` block and the paragraph after it; Timing relations, "Asks and batches"; One event log, with tables built from it; Decided, "Ask deadlines and defaults") and the base commit `a7e140b2`: its `packages/asks`, `packages/record`, `packages/contracts`, how `packages/hub/src/core.ts` opens and beats the asks core, and the suites `tests/acceptance/319/`, `822/` and `606/`. It covers AC2 only. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to another blind redraft.

## Run

```sh
PATH=~/.local/share/fnm/node-versions/v24.22.0/installation/bin:$PATH \
  node node_modules/vitest/vitest.mjs run tests/acceptance/908/ac2-redraft-2      # from the checkout's root
npx tsc -p tests/acceptance/908/ac2-redraft-2                                      # type-checks the suite
```

Node 24.22, nothing else: no network, no hub process, no git. Each world is a real record on SQLite and a home folder in its own temporary folder, on a virtual clock, removed afterwards. The suite takes about a second.

## The scenario

AC1's night, in UTC (batches fall at 00:00, 08:00 and 16:00 UTC):

1. Your settings: `batch: { every: 8h, cap: 20 }` written into `<home>/config.json`, then `draftAskSettings(home)` drafts every other value (deadlines, defaults, the minimum notice) and keeps that one.
2. 2026-10-20 23:00: two sessions each raise one ask over a `core` connection, with no deadline, so setup's drafts apply: a definition ask (4 h, deadline 03:00, AC1's ask) and an authority ask (1 day, deadline 2026-10-21 23:00). Both wait for the 00:00 batch; neither shows.
3. 23:30: the hub's last beat (`tick()`). The Mac sleeps.
4. 08:00: the Mac wakes. The hub's first beat sees the gap, tells the core `away(23:30, 08:00)`, then ticks it. Both asks show in Needs you.

Expected, under the reading below:

| Ask | Raised deadline | Away and unshown before it | Moved deadline | First shows | Defaults |
|---|---|---|---|---|---|
| definition (AC1's) | 2026-10-21 03:00 | 23:30 to 03:00, 3.5 h | 06:30 | 08:00 | 09:00, its default `drop` (the minimum notice, an hour after it shows: AC1) |
| authority | 2026-10-21 23:00 | 23:30 to 08:00, 8.5 h | 2026-10-22 07:30 | 08:00 | 2026-10-22 07:30, `hold` (no) |

## The surface

The tests reach the code only through:

- **`@deepbuild/asks`** (`packages/asks/src/index.ts`): `openAsks`, `draftAskSettings`, `askSources`, and `Asks`' `raise`, `tick`, `needsYou`, as at the base, plus one new method:

```ts
export interface Asks {
  // ...every method the base has, and:
  /**
   * The hub was away from `from` to `to` (ms since the epoch): the Mac asleep, or the hub down, as the hub measured it
   * (the gap between two beats, or from its last stop to its start). Each open ask that had not yet shown has its
   * deadline moved later by the part of that time it was waiting under its deadline, recorded on the ask as a
   * deadline move with the span. The hub calls it before the beat that follows the gap.
   */
  away(from: number, to: number): Promise<void>;
}
```

  The base hub ticks the core only when something is due, so the core can't see the Mac sleep by itself; the hub must say so. The suite reads `away` through a cast, so it compiles on the base, and records when it's missing so the failure says why.
- **`@deepbuild/record`** as at the base: `openRecord`, `append`, `read`, `table('asks')` (its `deadline` column), `rebuild()` and `close()`.
- **Events** the tests append as the hook would (`session.start@1`), and events they read: `ask.created`, and the closing kinds `ask.defaulted` and the rest, each by its `subject`.

**The deadline move is found by what it carries, not by a kind name.** It is an event that:

- the core appended (`writer: core`) after the ask's `ask.created`;
- is about the ask: its `subject` is the ask's handle `ask:<id>`, or its data holds that handle or the bare ID;
- is of no kind the base already appends for something else (`ask.created`, `ask.batched`, `ask.later`, `plan.proposed`, `answer.refused`, and the closing kinds);
- carries the span in its data, at any depth: its length in ms (the amount the deadline moved), or its two ends, the time away's start (23:30) and that start plus the length, or the time away as the hub told it (23:30 and 08:00).

The suite requires no event kind. A move kind named `ask.<something>` would have to be a step or an ask outcome to pass `tests/acceptance/606/outcomes.test.ts`, which this suite doesn't check.

## Choices that are mine

- **How much of the time away moves a deadline.** The part of the time away during which the ask was open, had not shown, and its deadline had not yet passed: from the later of the away's start and the ask's raising, to the earlier of the away's end and the deadline as it stood. Scope's first bullet read whole ("moves its deadline later by that span", the whole 8.5 h) would put AC1's ask at 11:30; it shows at 08:00, 3.5 h before that, so the minimum notice wouldn't apply and it would default at 11:30, not at the 09:00 AC1 states. Counting only the time its deadline was still running moves it 3.5 h, to 06:30, still before it shows, so the notice gives 09:00 and AC1 holds. Time away after a deadline passed is what the minimum notice covers. The authority ask's 8.5 h fall wholly before its deadline, so its move, to 2026-10-22 07:30, is the same under either reading and inside its bound (its 1-day wait counted again from 08:00 is 2026-10-22 08:00).
- **How the core learns the time away.** Through `away(from, to)`, called by the hub on the first beat after the gap, before it ticks the core. The scenario is the Mac asleep, not the hub down: the record stays open across the night and no `hub.stopped` is involved.
- **"The record rebuilt from the log"** is `RecordStore.rebuild()`: every table but `events` dropped and the log replayed into them. The first test reads the asks table's `deadline` before and after it.
- **What "the same moved deadline" covers.** The asks table's `deadline` column, and also the hub started again on the rebuilt record (record reopened, `openAsks`, at the same virtual time, so no time away passes): it takes each default when a twin hub that never stopped does. That second test also holds AC1's two times on the rebuilt record (not defaulted at 08:00:01, defaulted at 09:00), since the moved deadline and the showing it counts the notice from must both come from the log.
- **The deadline column reads the moved deadline, not the notice.** For AC1's ask the table reads 06:30; the 09:00 default is the notice's, which the tests check only by when the default lands. A program that also writes 09:00 into the column would fail the first test; nothing in the issue calls the notice a deadline move.
- **Defaults land on the beat.** "Defaults at 09:00" means the `ask.defaulted` is stamped 09:00 when the core ticks at 09:00, and nothing closes the ask at 08:59:59.999, as #319's suite reads deadlines.

## Criterion, tests, wrong programs, the base

ID: the first 8 hex digits of SHA-256 of the criterion's text, trimmed, whitespace collapsed, the leading `- [ ] ` dropped: `Rebuilding the record from the log gives the same moved deadline` gives `22f5f214`.

| ID | Criterion | Tests (`rebuild.test.ts`) | Wrong programs it fails on (sample fix with one part wrong, run outside this checkout; `BASE-FAILURE.txt`) | On the base |
|---|---|---|---|---|
| `#908.22f5f214` | Rebuilding the record from the log gives the same moved deadline | *rebuilding the record from the log gives each ask the same moved deadline, recorded on the ask with its span* | the move kept in the core's memory, never recorded (no move found); the projection ignores the move (the table reads 03:00); the whole time away moves it (the table reads 11:30) | FAIL: no deadline move recorded on AC1's ask (the core has no `away`) |
| `#908.22f5f214` | the same | *a hub started on the rebuilt record takes each default when the hub that moved the deadline would* | the move kept in memory (the authority ask defaults at its raised deadline after the restart); the whole time away moves it (AC1's ask defaults at 11:30, not 09:00); the first showing kept in memory, so the notice is lost on restart (AC1's ask defaults at once) | FAIL: AC1's ask defaults at 08:00, when the hub starts on the rebuilt record |

A sample fix (outside this checkout: `away` appending a `wait.extended` event, a name of the sample's own, with `{from, to, deadline}`; the asks projection setting `deadline` from it; the core counting the notice from the first `ask.batched`) passes both tests, and each mutant above fails at the assertion named.

## Files

- `helpers.ts`: the night's times and each ask's expected values, ULIDs, connections, the asks as raised, a world (virtual clock, record and home in a temporary folder, the asks core opened with `home`, what Needs you showed and when, the Mac's sleep, restart), the night itself, `movesOf` (the deadline move found by what it carries), `closings`, `noDefaultBeforeShown`.
- `rebuild.test.ts`: the two tests.
- `tsconfig.json`: type-checks the suite under the root's strict options.
- `BASE-FAILURE.txt`: the base run, an isolated base run, and the sample fix and mutants.
