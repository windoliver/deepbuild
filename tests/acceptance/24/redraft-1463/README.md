# Blind redraft of #24.bbe12971's listing and timing: `deep inbox` lists each open ask once, with its kind, session and age, and 30 days of asks in under 300 ms

Written blind at base `32628dba` from issue #24, the design and the base, before and apart from any implementation. The
implementing agent does not edit these files (AGENTS.md, Proof); a dispute goes to another blind redraft (design: Dogfooding).

The criterion, `#24.bbe12971` (its ID checked: SHA-256 of the trimmed, whitespace-collapsed text starts `bbe12971`): "Budgets, on
the reference Mac in the local preflight, compared with the merge base: `deep inbox` lists 30 days of asks in under 300 ms". This
redraft covers two of the suite's tests of it: "deep inbox lists each open ask once, with its kind, session and age, and no closed
ask" (the caller placed that test in `../answer.test.ts`; at this base it is the first test of `../budgets.test.ts`), in
`listing.test.ts`; and "deep inbox lists 30 days of asks in under 300 ms", the third test of `../budgets.test.ts`, in `timing.test.ts`,
with each run's listing read in the design's layout as `listing.test.ts` reads it. The perf lane's task test stays in
`../budgets.test.ts`, as it is.

## What was read

- Issue #24: Scope ("`deep inbox` lists open asks with kind, session and age"), the five criteria, Proof.
- `docs/technical-design.md`: An ask, and your answer getting back (its kinds, outcomes and the ask's life); Where they reach you
  ("`deep status`, `deep inbox` and the channels' summaries carry the link beside each item"; `deep inbox answer <ask> <option>`); States
  people see (one row shape, `id`, `address`, `title`, `entry`, `word`, `why`, `waits_on`, `since`, `actions`; "`deep inbox` puts the
  question first and the handle last"; `--json` prints the rows; "What a person reads holds no fixture text, tagline or internal kind
  name"); the threat row Approvals that drift (what `deep inbox` prints keeps a call on one line); the CLI rows; the asks' settings
  drafted at setup.
- `AGENTS.md`; `scripts/proof-change.mjs` (`criterionId`); `tests/acceptance/1459/README.md` (this README's shape).
- The existing suite, as it is: `../README.md`, `../helpers.ts` (`seed`, `askData`, `startHub`, `deep`, `cleanup`, `CLI`), `../budgets.test.ts`,
  `../answer.test.ts`.
- At the base, for the surface only: `packages/cli/src/main.ts` (`deep inbox` goes to the hub package), `packages/hub/src/inbox.ts`
  (what `deep inbox` prints at this base), `packages/hub/src/promises.ts` (`elapsed`), `packages/asks/src/index.ts` (`AskKind`, the
  handle `ask:<id>` that `raise` returns).

## How to run

```sh
npm ci                                              # once, if node_modules is missing
npm run build --workspaces                          # the test runs the built CLI, packages/cli/dist/main.js, and the hub it starts
npx vitest run tests/acceptance/24/redraft-1463     # from the checkout's root
npx tsc -p tests/acceptance/24/redraft-1463         # type-check
```

Node 24.22 or newer. No network, no git, no tmux. It makes its folders under `/tmp/dh24-*` through `../helpers.ts`, runs every process
with `HOME` there, never touches the real `~/.deepbuild`, and stops only the processes it started, by PID. It was not run when written
(the Mac is shared and this worktree had no `node_modules`), so neither its passing side nor its failure on the base is verified.

`timing.test.ts` counts only on a reference Mac (Mac15,7 or Mac15,12, by `../helpers.ts`'s `environmentProblem`) on mains power, Low
Power Mode off and no thermal warning; anywhere else it is skipped as INCONCLUSIVE with the reason, never passed. On a reference Mac its
seeding of 3,000 asks takes most of its time (the suite's README puts it near 50 s).

## The surface

`deep inbox`, run by you (a child of the test process, under no agent) against a real hub (`deep hub run`) whose record was seeded
before it started, through the real record and asks core (`../helpers.ts`, `seed`). Only the command's stdout and exit code are read.
No hub or CLI module is imported.

### What the implementation must provide

1. `deep inbox`, run by you with the hub up, exits 0 and lists each open ask on exactly one line, the only line of its output that holds
   the ask's handle `ask:<ULID>`. A closed ask (here, one answered on the app's card) is on no line, neither by its handle nor by its
   ULID.
2. The ask's line starts with its question as raised, whole: only a glyph or spaces may come before it. The line ends with the handle;
   only a `deepbuild://ask/<ULID>` link to the same ask may follow it.
3. On that line, outside the question and the handle, are: the ask's kind by its word (`authority`, `taste`, `definition`, …) as a whole
   word, in any case; the ask's session ID as a whole token; and its age, how long since the ask was raised, as a whole number of the
   largest of days, hours and minutes that is at least 1, written `2d`, `2 d` or `2 days` (`h`, `hr`, `hours`; `m`, `min`, `minutes`
   likewise), with anything after it, such as `ago`.
4. With 30 days of asks in the record (the month below), `deep inbox` lists every open one as items 1 and 2 say, in under 300 ms from
   spawning the command to its exit, on a reference Mac, five runs after a warm-up, by the design's rule for timing results.

## The fixture

Seeded under the project `shop` with the clock moved for each ask (`../helpers.ts`, `seed`, `askData`):

| Ask | Kind | Session | Question | Raised | Expected age | Deadline |
|---|---|---|---|---|---|---|
| open | taste | `S1` | `Which way for the header?` | 2 days 3 hours ago | `2d` | in 1 day |
| open | authority | `S2` | `Push feature/login to origin?` | 3 hours 5 minutes ago | `3h` | in 20 hours |
| open | definition | `S3` | `Which way for offline mode?` | 5 minutes 5 seconds ago | `5m` | in 4 hours |
| closed | choice | `S3` | `Which way for the store?` | with the definition ask | none: answered `files` on the card | |

The ages differ in unit, the kinds and sessions differ, so a listing that prints one value for every ask, or swaps them, fails. The
expected age is computed at both the spawn and the exit of `deep inbox`, and either is accepted, so a minute that turns while the hub
starts can't fail it. No question holds a kind word, a session ID or a digit, so each is read only from the line's other fields.

`timing.test.ts` seeds its own month, a copy of `../budgets.test.ts`'s `seedMonth` (a test file can't be imported without running its
tests): 20 sessions a day for 30 days, `D<day>S<n>`, each raising one ask of each of five kinds (authority, taste, choice, definition,
exception), the most a session holds before its asks fold, so 3,000 asks on a clock moving through the month. The first 29 days' asks
take their defaults at their one-day deadlines; the last day's 100 stay open, with three-day deadlines. The copy also keeps each open
ask's question, `Push D29S<n> authority to origin?` or `Which way for D29S<n> <kind>?`, so each run's listing can be read in the
design's layout. A seeding that leaves other than 100 open asks throws `BLOCKED: …`.

## Criterion to tests

| Criterion part | Test (`listing.test.ts`, `timing.test.ts`) | Wrong programs it fails on | On the base (predicted, not run) |
|---|---|---|---|
| each open ask once, no closed ask | `#24.bbe12971 deep inbox lists each open ask once, on one line, and no closed ask` | a listing that misses an open ask, prints one twice, or lists the ask answered on the card | PASS |
| with its kind, session and age | `#24.bbe12971 each open ask's line shows its kind, its session and its age` | a line without the kind, the session or the age; an age as a clock time or a date, or in a smaller unit (`51h`); one ask's fields on another's line | PASS |
| the design's layout | `#24.bbe12971 each open ask's line puts its question first and its handle last` | the base's layout, which leads with the handle; a line that leads with the kind or the session | FAIL: the base's line starts `ask:<ULID>  <kind>  <session>  <age>` |
| 30 days of asks in under 300 ms | `timing.test.ts`: `#24.bbe12971 deep inbox lists 30 days of asks in under 300 ms` | a listing slower than 300 ms by more than the margin in all five runs (FAIL); one that misses an open ask of the month, or lists one off the design's layout, in any run | off a reference Mac: skipped INCONCLUSIVE; on one: FAIL, the base's layout (each line leads with the handle), whatever its time |

In `listing.test.ts` a missing prerequisite (no built CLI, a hub that doesn't start, a handle not `ask:<…>`) throws `BLOCKED: …` in
`beforeAll`, so every test fails, none passes. `timing.test.ts` throws `BLOCKED: …` for no built CLI, a hub that doesn't start, or a
month that leaves other than 100 asks open. Its timing is judged by `../helpers.ts`'s `judge`, imported as it is: PASS only when all five
runs are within 300 ms, FAIL when all five are over it by more than the margin (the larger of 5% and the runs' spread), INCONCLUSIVE
(skipped) otherwise.

## Scope not covered

- The perf lane's task `deep-inbox-30d` ("compared with the merge base"): `../budgets.test.ts`, unchanged.
- In the month, that the 2,900 defaulted asks aren't listed: `listing.test.ts` holds that a closed ask isn't, and a defaulted ask may
  show for its undo (`deep inbox undo`), so the timing test doesn't judge it.
- `deep inbox --json` and the row shape (`id`, `address`, `title`, `entry`, `word`, `why`, `waits_on`, `since`, `actions`): the design names
  them, but this criterion's part is the listing a person reads, and the row shape names no kind or session field to hold them to.
- The `deepbuild://ask/<id>` link beside each item: allowed after the handle, not required.
- Control characters shown as visible text, the "decided for you" lines and the offers `deep inbox` may print below the open asks.
- `deep inbox` with the hub down (the design reads the database read-only then).

## Assumptions a redraft may revisit

1. **The design's layout wins over the suite's.** `../README.md` has the handle, kind, session and age as the line's first four fields;
   the design, the newer word, has the question first and the handle last. So `../budgets.test.ts`'s listing test and this one can't both
   pass; this one holds the design's.
2. **One line per ask.** "Lists" and the design's rows read as one line each; an ask spread over a block of lines fails.
3. **The kind by its own word.** The issue asks for the kind; the design bars an "internal kind name" from what a person reads, which I
   read as event and schema names (such as `ask.created@1`), not the ask kinds the design itself calls an authority ask, a taste call or a
   definition. A listing that shows the kind only in other words (say "what done means") fails here.
4. **The session by its ID.** The fixture's session IDs are short (`S1`), so a listing that shortens long IDs still shows them whole.
5. **The age's unit.** The issue says "age" only; the largest whole unit is the suite's reading (`../README.md`, Commands), kept here, with
   the spellings above allowed.
6. **Every open ask is listed**, whether or not its batch has been shown in the app: the design's queued and shown are views of an open
   ask, and the issue says `deep inbox` lists open asks.
7. **The month is the suite's.** The design states no number of asks a day; `timing.test.ts` keeps `../budgets.test.ts`'s 3,000 asks
   with the last day's 100 open, so the redraft changes how the listing is read, not the load it is timed on.
