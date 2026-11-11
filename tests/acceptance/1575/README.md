# Acceptance tests for #1575: the stream serves a slow reader

Written first, blind, from issue #1575 (its text as of November 10, 2026: Scope, the six acceptance criteria, Proof),
from `docs/technical-design.md` (Socket roles and contract versions: "Reads and writes a slow link can afford" and
"Your hub, wherever it runs"; Scale later; How we know version 0 works: Dogfooding, Criteria to tests, Wrong programs,
Criteria in a checked shape), from `AGENTS.md`, and from the base commit `f38d2b39` (origin/main): #34's suite
(`tests/acceptance/34/`: README, `helpers.ts`, `stream.test.ts`, `budgets.test.ts`), #16's helpers
(`tests/acceptance/16/helpers.ts`), the base hub's stream (`packages/hub/src/log-reads.ts`, `server.ts`, `wire.ts`,
`core.ts`'s `test.load`) and the app's subscribe (`crates/deep-app/src/record.rs`). Nothing of #1575 is implemented at
the base, and no implementation of it was read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a
dispute goes to a blind redraft of this job.

## How to run

With the repo's Node (`.node-version`, 24.22.0) first on `PATH`:

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # the tests run the built CLI, packages/cli/dist/main.js
cargo build --locked -q -p deep-hook     # once: the hub won't start in a checkout without target/*/deep-hook
npx vitest run --root tests/acceptance/1575 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1575/tsconfig.json   # type-checks the suite
```

- `--no-file-parallelism`: the files start real hubs, AC5 holds 32 MiB behind a paused reader and AC1 times a stream.
  Add `--reporter=verbose` to see AC1's reading where it is skipped as INCONCLUSIVE.
- Every test makes its folders under `/tmp/dh16-*` (#16's helpers), sets `HOME` to one of them for every hub it starts
  and never touches the real `~/.deepbuild`. Each stops only processes it started, by PID. Every hub has
  `DEEP_HUB_TEST_CONFIRM` set to #34's stand-in, which says no, so no test can raise an OS prompt.
- With `--root` here, Vitest writes its cache under `tests/acceptance/1575/node_modules/.vite/`; delete it before
  committing.

The tests import `packages/record/src/index.ts` (`openRecord`, to seed AC1's record before the hub starts, as #34's
budgets do) and reuse #34's and #16's helpers. They import nothing from the hub.

## The surface

The issue and the design name the socket's `stream.subscribe`, its reply and its frames, and the reads. Where they
leave a name or a shape open, this suite uses the smallest one that fits the base's wire. Each such name is in one
place in `helpers.ts` (the block "The surface #1575 leaves open"), so another choice is a one-line change there. The
implementer serves this:

```ts
// The base's, unchanged: one JSON object per line with "v": 1; the reply is {v, id, result | error}; a frame is
// {v, id, event}; a refusal is error@3 {code, retryable, remediation, path, actual, evidence}.

'stream.subscribe' { after: LogPos }                                   // no scope: the app's subscribe (AC6, AC1)
                   => { subscribed: true, after, start }               // exactly the base's reply and frames:
                                                                       // every event after `after`, however far
                                                                       // behind, no head, no caught-up frame

'stream.subscribe' { after: LogPos, scope: { kind: 'session', session: string } }   // one session
'stream.subscribe' { after: LogPos, scope: { kind: 'list' } }                       // the list's rows (not tested)
  // within the replay cap (128 events or 1 MiB behind):
                   => { subscribed: true, after, start, head: LogPos } // head: the log's end as the reply reflects it
  //   then one {v, id, event} per event of the scope with after < log_pos <= head       (replaying)
  //   then one {v, id, caught_up: head}                                                 (caught up)
  //   then one {v, id, event} per event of the scope appended after head, none skipped  (live)
  // past the cap:
                   => { subscribed: false, snapshot: true, after, start, head }
  //   no frame follows on that id. The reader reads a fresh snapshot (any read; each result carries the log_pos it
  //   reflects) and subscribes again after that log_pos.
```

- **Scope.** A session-scoped reader gets every event whose top-level `session` is that session's ID (the ID the
  hook payload's `session_id` carries, as `sessions.read` lists it), and no frame whose event carries another
  session's ID there. Events with no top-level `session` (the base's `row.set`, say) are not judged either way.
- **Which subscribe gets the new replies.** AC6 and Scope's last line ("the app's own subscribe behaves as on the
  merge base") hold the subscribe with no scope to the base's reply and frames, line for line, so the head, the
  caught-up frame and the replay cap are tested only on a subscribe that names a scope. AC1's cold reader, which
  must replay 100,000 events, is therefore the subscribe with no scope.
- **The report (AC5).** A reader that stops reading is cut off as on the base, with the `fell_behind` refusal on its
  subscription's id. Its `actual`, which on the base is the count of frames as text, is the JSON text
  `{"frames": <n>, "bytes": <n>}`: the frames and bytes the hub held for the reader when it cut it off. error@3 keeps
  its shape.
- **The byte cap's size.** The issue names no number for it. The suite needs it to be at most 16 MiB
  (`BYTE_CAP_AT_MOST`): AC5 appends 4,000 prompts of 8 KiB (the most of a prompt the base keeps in one event) through
  `test.load`'s backfill, 32 MiB or more in about 8,000 frames, under the base's frame cap of 10,000, so only a byte
  cap can hold the reader. A larger load would pass the frame cap, and the base would cut the reader off by frames.
- **Wrong programs' settings.** None. No plant is chosen by an environment variable; `DEEP_1575_RECORD_GOLDEN` is
  read by `app.test.ts` alone, to record the golden.

## Criteria to tests

Every test's name carries its criterion's ID (`#1575.<h8>`, as `scripts/proof-change.mjs` computes it).

| Criterion | ID | Test | On the base |
| --- | --- | --- | --- |
| AC1 a live reader stays within 50 ms beside a reader replaying 100,000 events from 0 | `#1575.1adcfe64` | `budgets.test.ts` › AC1 | FAIL on a reference Mac, naming the cold reader; INCONCLUSIVE elsewhere (Timing) |
| AC2 a reader scoped to one session gets no frame for another | `#1575.d79bb92a` | `stream.test.ts` › AC2, AC2 (wrong program) | fails: the base ignores the scope and sends the other session's frames |
| AC3 a reader 200 behind gets a snapshot reply and misses nothing after reading it | `#1575.1c19e28a` | `stream.test.ts` › AC3, AC3 (wrong program) | fails: the base replays, with no snapshot reply |
| AC4 replaying, then caught up, then live, with no gap | `#1575.ec9543ba` | `stream.test.ts` › AC4 | fails: no caught-up frame |
| AC5 a reader that stops reading is held at a byte cap, its report counting frames and bytes | `#1575.d0ddf63c` | `stream.test.ts` › AC5 | fails: handed every frame, 32 MiB or more, with no report |
| AC6 the app's stream on a fixture session is frame for frame the merge base's | `#1575.33d5b838` | `app.test.ts` › AC6 | passes: the golden is the base's |

Each test tells correct, wrong and missing apart: its judge (`helpers.ts`, Judges) returns one message when the hub
refuses the new param (missing), another when it serves it wrongly, and null only when the behavior is there.
`BASE-FAILURE.txt` holds the run on the base.

## Wrong programs

Each plant is test code: a socket in front of the real hub (`helpers.ts`, Planted wrong hubs), as #34's
`silentDropper` is. The reader connects to the plant's socket; the hub is the shipped one, unchanged.

| Criterion | Wrong program | How its test fails on it |
| --- | --- | --- |
| AC1 | the merge base itself | each live frame waits for the cold reader's whole replay, so the judge reports `FAIL AC1 live frame p95 (ms) beside the cold reader replaying 100000 events from 0 (the slowest live frame, … ms, was sent with the cold reader at … of 100000): …` |
| AC2 | `sendsAll`: takes the `scope` off every subscribe, so the hub sends all | AC2's judge returns `a reader scoped to session <A> got <n> frames for session <B>, the first at log_pos <p>`; the plant's test asserts that exact message, with B's ID, count and first position read through `events.read` |
| AC3 | `replays`: answers every subscribe as subscribed, reads every event after the reader's position through `events.read` and sends each as a frame | AC3's judge returns `a reader 200 events behind got no snapshot reply: the hub replayed 200 events`; the plant's test asserts that exact message |

The two plant tests assert that the criterion's test fails on the plant with the message the criterion names. They
pass on the base and on a correct hub alike, since each plant makes either hub wrong the same way; they are the proof
that AC2's and AC3's tests can fail, not tests of new behavior.

## Timing (AC1)

AC1's 50 ms is #34's live-stream budget and is counted as `tests/acceptance/34/budgets.test.ts` counts it: each sample
runs from a hook's request written to the live reader's frame read, a run's number is the p95 of its samples, and five
runs after a warm-up go to #16's `judge` (PASS when all are within 50, FAIL when all are over it by more than the
margin, INCONCLUSIVE otherwise). A run is 20 samples, each with a cold reader of its own: a second app connection
subscribes after 0 on the seeded record of 100,000 events, and once its first frames have come, with the last log_pos
it was sent still in the first half of the record, one hook is sent and timed; then that cold reader is closed. So
every sample was sent with 50,000 frames or more of a replay still to come. (Hooks sent one after another through a
single replay were tried first and dropped: on the base the first waits for the whole replay and the rest, sent while
the socket still drains, are fast and dilute the p95.) The cold reader only tracks the last log_pos of each chunk it
reads, so reading costs the test process next to nothing beside the reader it times. A cold reader that isn't
replaying when its hook is due makes the test BLOCKED, never passed.

The number counts only on a reference Mac (#34's `notReferenceMac`: Mac15,7 / Apple M3 Pro or Mac15,12 / Apple M3).
On any other machine the runs are still taken and printed, and the test is skipped as
`INCONCLUSIVE (reading only): …`, never passed and never failed. Power isn't gated on.

## The golden (AC6)

`fixtures/app-stream.golden.json` is what the base hub (`f38d2b39`) sent the app for one fixture session, recorded by
running that hub:

```sh
DEEP_1575_RECORD_GOLDEN=1 npx vitest run --root tests/acceptance/1575 --no-file-parallelism --testTimeout=600000 app.test.ts
```

A recording run writes the file and then fails, so it never passes. It was run three times on the base and wrote the
same bytes each time (sha256 `4f469f4b…`). The fixture: a fresh hub; the app's hello, `inbox.read` and
`stream.subscribe {after: <the read's log_pos>}`; then one Claude Code session with a fixed ID and transcript sending
SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop and SessionEnd, the log left to settle after each; then
a second app connection subscribing after 0. `live` and `replay` hold every line on each subscription's id, the reply
first. What differs from run to run is named instead: the subscription's id, temp folders, millisecond and nanosecond
times, the tool call's counter, and each ULID by the order it first appears in. The comparison is of whole lines, so
on the app's subscribe a new reply field, a caught-up frame or a missing frame all fail it.

## What could not run here

This job's machine is not a reference Mac (Mac17,10 / Apple M5 Max), so AC1 is INCONCLUSIVE there by #34's rule and
was not shown failing on the base. Its five readings on the base, 185 to 216 ms against 50, are in `BASE-FAILURE.txt`;
on a reference Mac the judge reports readings like those as FAIL. That run on a reference Mac is still owed.
