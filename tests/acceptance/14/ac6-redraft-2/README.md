# AC6 blind redraft 2: every projection rebuilds from the catalogue's events

Test: `ac6.test.ts`, one `describe` ("AC6 every projection rebuilds from the catalogue's events") with one `it`
("AC6 the record lists the issue's projections, each is a table, and after every catalogued kind's fixtures each
equals its rebuild"). It replaces the first redraft's log assertion only; every other check is the first
redraft's, unchanged (`../AC6-REDRAFT.md`, assertions 1, 2 and 4 to 8). The implementing agent doesn't edit these
files (AGENTS.md, Proof).

## Run

```sh
npx vitest run tests/acceptance/14/ac6-redraft-2/              # from the checkout's root, workspaces built
npx tsc -p tests/acceptance/14/ac6-redraft-2 --noEmit          # type-checks the test and ../helpers.ts
```

## What I read

- Issue #14 with its comments (`gh issue view 14 --comments`): Scope, AC6, Proof.
- Issue #570 (`gh issue view 570`): Scope and AC2, "A move no table row allows is refused and recorded, naming
  the object, its state and the event".
- `docs/technical-design.md`: "One event log, with tables built from it", "Lifecycles" ("A move no row allows is
  refused: the event stays in the log, its move never lands, and the record appends `move.refused`, naming the
  object, its state, the event and the table"), the Event primitive, and in "How we know version 0 works":
  Criteria to tests, Wrong programs, Dogfooding.
- `AGENTS.md`; in `tests/acceptance/14/`: `README.md`, `helpers.ts` (not edited), `AC6-REDRAFT.md` and
  `ac6-redraft.test.ts` (not edited).
- Public surfaces only: the exported types of `packages/record/src/index.ts` (`openRecord`, `append`, `read`,
  `table`, `rebuild`, `PROJECTIONS`, `Event`), `packages/contracts`' `catalogue()` and `fixtures()`, and the
  published schema `packages/contracts/schemas/move.refused@1.json`.

Nothing of the record's lifecycle or projection code, the lifecycle scripts, `tests/acceptance/570/`, or this
branch's history or diff.

## What changed from the first redraft, and why

The first redraft asserted the log is exactly the appended IDs, in `log_pos` order. Since #570 AC2 the record
keeps a refused move as an event: the core appends `move.refused@1` (writer `const: core`) naming the refused
event by `data.event_id`, and the refused event itself stays in the log. The published fixtures share one ask
(`ask:01K74G4B6D8F0H2K4M6P8R0T2V`), one claim and one lease key, so appending them all makes moves no table
allows (an ask answered again, a lease released before it is held), and the log then holds the record's own
refusals too. The exact equality failed on that, although every appended event was in the log once and in order.

The new check, `logProblem(logged, appended)`, must return `undefined`. It fails, naming the event, on the first of:

1. an appended ID not in the log;
2. a `log_pos` not strictly above the one before it;
3. an ID in the log twice;
4. appended events not in the order of their acknowledged `log_pos`, or one at another `log_pos` than its append
   acknowledged (new: the first redraft compared IDs only);
5. any event the test didn't append unless all of these hold: its `kind` is `move.refused`, its `writer` is
   `core`, its `data.event_id` is an appended event's ID, that event comes before it in the log, and its
   `data.event` is that event's kind (the schema: "The refused event's kind").

The assertion:

```ts
expect(logProblem(logged, appended), "the log holds every appended event once, in log_pos order, and beyond them only the core's move.refused").toBeUndefined();
```

A `move.refused` fixture the catalogue loop appends itself counts as appended, not as an extra.

## Wrong programs, planted in the test

Each is the real record seen through a `read()` that changes its pages (`plantedRead`), so `allEvents` and
`logProblem` run as they do on the real log. Each must fail, naming the event (by its ID), and the unchanged
`read()` must still pass.

| # | Wrong program | Outcome |
|---|---|---|
| 1 | acknowledges an append it doesn't keep: `read()` drops one appended event | fails: "appended `<schema>` fixture `<n>` (`<id>`, acknowledged at log_pos `<p>`) is not in the log" |
| 2 | keeps one append twice | fails: "`<kind>` `<id>` is in the log twice, at log_pos … and …" |
| 3 | keeps two appends in swapped order, each at the other's log_pos | fails: "appended … is in the log before appended …" |
| 4 | slips in a `move.refused` from writer `app` | fails: "the test never appended it, and it isn't the core's move.refused" |
| 5 | slips in a core event of another kind (`ask.answered`) | fails, as 4 |
| 6 | a core `move.refused` naming an event no one appended | fails: "names event …, which the test never appended" |
| 7 | a core `move.refused` placed before the event it names | fails: "which doesn't come before it in the log" |
| 8 | a core `move.refused` naming its event under another kind | fails: "names … as a … event, but it is …" |

The plants of 2 and 7 give their extra event a fractional `log_pos` (half a step from its neighbour) so that it
sits where the plant needs it without renumbering the log; the check doesn't depend on log positions being
integers.

## Readings where the issues leave a choice

- **Where the refusal goes.** The design says the record appends `move.refused`; it doesn't say right after the
  refused event. The test needs only that it comes after it, so a record that batches its refusals still passes.
- **How many refusals.** Neither issue says which fixture moves a table refuses, so the test doesn't require any
  refusal or count them; those are #570's tests. It only allows them.
- **Naming the event.** #570 AC2 asks the refusal to name the event; the schema names it by `event_id` and its
  kind in `event`. The test holds both. It doesn't check `object`, `state` or `table`: which object and state are
  #570's readings of its own tables.
- **A refusal twice.** One event refused twice for the same object would pass. An event may move more than one
  object, so two refusals naming one event can be right, and telling them apart needs the tables.
- **The rebuild.** The first redraft's last check stays: after `rebuild()` the log is the same `log_pos:id` list,
  so a rebuild that appends its refusals again fails there.

## Run on this branch

`npx vitest run tests/acceptance/14/ac6-redraft-2/`: 1 file, 1 test, passed. The real log held 285 events: the
263 appended and 22 core `move.refused` events, each naming an appended event before it (all ask, claim and lease moves). The first redraft,
`npx vitest run tests/acceptance/14/ac6-redraft.test.ts`, fails at its line 167 on those 22 events.
`npx tsc -p tests/acceptance/14/ac6-redraft-2 --noEmit`: no errors.
