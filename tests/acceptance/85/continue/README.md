# Acceptance tests for #85, criterion 14 and the resume-skip line, on the asks core

Written first, blind, from issue #85 (its text as of November 1, 2026: the Scope lines added since the suite in `tests/acceptance/85/` was written, among them "Continues are counted per session since its last turn that ended normally …", "While a session's newest stop carries a cause whose task is open … no turn DeepBuild causes starts there …" and "A resume on a shared task skips a session you paused or stopped, one whose attempt was replaced, and one whose task closed, and records why", and criteria 13 to 15), `docs/technical-design.md` as of the base (Tasks close themselves; One event log; Every stop is judged; Turns DeepBuild causes; Starting a session from the app, the resume's block of calls marked outcome unknown) and the base commit `c69c9acf`, read only to learn the surfaces: `tests/acceptance/85/README.md`'s surface (`openAsks`, `tick`, `inbox`, `needsYou`, `session.continued@1`, `sessions.cause`), the record's `agent.stop@4`, `session.end@1`, `session.start@4`, `task.created@1`, `task.closed@1` and `session.reading@1`, and how `tests/acceptance/85/*.test.ts` drive the core. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft by this job. Criteria 13 and 15 need the real hub and are in `tests/acceptance/85/hub/` (`cutoff.test.ts`, `held.test.ts`; its README).

## Run

```sh
npm ci                                                        # once, if node_modules is missing
npm run build --workspaces                                    # the asks core resolves @deepbuild/record and the adapters through dist/
node node_modules/vitest/vitest.mjs run tests/acceptance/85/continue --no-file-parallelism          # about 1 s
node node_modules/typescript/bin/tsc -p tests/acceptance/85/continue/tsconfig.json                 # type-check, with the parent suite's helpers
```

Node 24.22 or newer. The tests need no network, no hub socket, no git and no agent: every world is a real record on SQLite and a home folder in its own temporary folder, with a virtual clock, removed afterwards (`tests/acceptance/85/helpers.ts`'s `openWorld`); every window is the clock moved, never a wait.

On the base, all 3 tests fail, each at an assertion (`BASE-FAILURE.txt`): the stop after a normal turn end gets no continue (the base counts since the last prompt you typed), and the resume reaches every one of the five sessions, the stopped, replaced and closed ones included. `tsc` reports no error against the base: these tests add nothing to the surface.

## The surface

Nothing is added to `tests/acceptance/85/README.md`'s surface. The tests reach the core only through `openAsks` (`tick`, `inbox`, `needsYou`), `@deepbuild/record` (`append`, `read`, `table('sessions')`) and the record's events, in shapes the base already has:

- **`agent.stop@4`** as the hook records it (`World.stop`): a transient stop is `timed_out` or `rate_limited` with `owner: service`, `outcome: failed` (`STOPS.dropped`, `STOPS.overloaded`); **a turn that ended normally** is a Stop hook's stop, `outcome: finished`, no block (the closed set's `unknown`), the turn did work (`FINISHED`, agent.stop@4 fixture 01). A sign-in stop is `STOPS.signIn()`.
- **`session.continued@1`**, read back: the one event a continue or a resume is.
- **`sessions.cause`**: the row's cause after each stop.
- **The record's facts about a session the resume reads**: `session.end@1` (writer hook: you stopped it), `session.start@4` with `parent: <session>` (its attempt was replaced in its process, as the design's session tree keeps it), `task.created@1` and `task.closed@1` on `session:<id>#<message>` (the task its prompt opened, closed by a verdict).
- **`session.reading@1`** on a session (writer core, `data.reading` naming the task), the one surface the base has for "records why": a reading the hub takes of a session, which changes nothing about how it's judged.

## Readings where the issue leaves a choice

- **"A turn that ended normally"** is an `agent.stop` with `outcome: finished`: Claude Code's Stop hook. A `StopFailure` is `outcome: failed`. Which cause a finished stop carries isn't the point; the test uses the closed set's `unknown` with `did_work`, as a plain Stop maps.
- **"Counted per session since its last turn that ended normally"** replaces the parent suite's reading of "once" ("one per turn you started", reset by a prompt you typed) with the issue's own words. The scenario types nothing, so a rule that resets only on a typed prompt fails at the stop after the normal end; a rule keyed per stop fails at the second stop. Criterion 2's scenario (`tests/acceptance/85/transient.test.ts`), where you type between drops, still holds: a prompt you typed starts a turn, and the stop that ends it normally resets the count; the issue's "a second transient stop right after a continue gets none" is the same reading.
- **"A resume on a shared task skips …"**: skipping is no `session.continued` for that session when the task's check passes, while the sessions still blocked resume; "records why" is a `session.reading` on the skipped session naming the task. The reading's words aren't held to a sentence, only to the task's handle.
- **"You paused or stopped"**: stopped is `session.end`, the hook's record of Claude Code's SessionEnd. **Paused has no event in the record at the base** (no kind names a pause; the hub's pause is a deny of the session's next tool calls, which the record doesn't show), so it isn't driven; a surface for it is the implementing agent's to add, and this test doesn't hold it.
- **"Whose attempt was replaced"**: a newer `session.start@4` naming the session as `parent`, the way the record keeps a session replaced in its own process (the base's `ask.moot@2` also knows `attempt_replaced`).
- **"Whose task closed"**: the task its prompt opened (`task.created@1`, `task_ref: session:<id>#1`) is `task.closed@1` by a verdict before the shared task's check passes: the session has nothing left to resume into. The shared unblock task itself closing is what resumes the others, so it can't be the task meant here.
- **No one-per-cause sharing is re-proved here**: criterion 1's `theOneTask` holds it before the skips, as the parent suite does.

## Criteria, tests and wrong programs

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed (`scripts/proof-change.mjs`). A "plant" is a wrong program planted around the real core, run by `plants.test.ts`, which first runs the same scenario on the real program (it must pass) and then on the plant (it must fail with the named message).

| # | ID | Criterion (short) | Tests | Wrong programs it fails on | On the base |
|---|---|---|---|---|---|
| 14 | `#85.281df797` | two transient stops in a row: the first continues, the second doesn't; a normal turn end resets the count | `counted`: one; `plants`: one | plant: a rule keyed per stop (`tests/acceptance/85/plants.ts`'s `continuesTwice`, the real core with the once guard dropped; fails naming the second stop); a rule that resets only on a prompt you typed (the base; fails at the stop after the normal end) | FAIL: `after a turn that ended normally, the next transient stop (…) gets one again: expected [ '…' ] to deeply equal [ '…', …(1) ]` |
| Scope | — | a resume on a shared task skips a stopped session, a replaced attempt and one whose task closed, and records why | `resume-skip`: one | the base (resumes all five) | FAIL: `expected [ 'S1', 'S2', 'S3', 'S4', 'S5' ] to deeply equal [ 'S1', 'S5' ]` |

## Files

- `scenarios.ts`: `FINISHED` (a turn that ended normally), `countedSinceNormalEnd` (criterion 14) and `resumeSkips` (the Scope line), on `tests/acceptance/85/helpers.ts`'s world.
- `counted.test.ts` (14), `resume-skip.test.ts` (Scope), `plants.test.ts` (14's plant).
- `tsconfig.json`: type-checks the folder with the parent suite's helpers under the root's strict options.
- `BASE-FAILURE.txt`: the base run, trimmed to each failure's reason.
