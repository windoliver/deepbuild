# Acceptance tests for #1925: a running job's row counts from its tool's own counters and keeps its count when the app closes

Written first, blind, at base commit `d51be2c3` (Merge pull request #2108), from issue #1925 (updatedAt
2026-11-10T09:29:04Z: its summary, Scope, one acceptance criterion and Proof), the design and the base, by a job that
never saw an implementation of #1925; none exists at the base. The implementing agent doesn't edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). There is no taste criterion, so
no `TASTE.json`.

## What was read

- Issue #1925 (its one checkbox gives the ID), and #1922 as its Depends on line names it (merged at this base).
- `docs/technical-design.md`: Building blocks (the Job row: `deep_job`, `deep.registerJob`, `deep.registerJobTool`, "Run in
  the canvas core or a frame, change a document, count as a verdict ..."); Blocks for plug-ins that do real work (Runner);
  States people see (the one row shape the hub builds and records as `row.set`, which the app, `deep status --json` and
  `deep_drive`'s `see` read; the states table); Dogfooding. `AGENTS.md`.
- `docs/canvas-primitives.md`, Asset job: "a running job shows progress only from its tool's own counters, never a guess
  from elapsed time"; the job key.
- At the base, for surfaces and conventions only: `packages/hub/src/jobs.ts` (deep_job's run, the cache by key, the
  receipt), `packages/hub/src/core.ts` (`deep_job` bound to no session, `rows.read`, `status.read`, `evidence.read`, the
  job outputs' `evidence.stored`), `packages/hub/src/rows.ts` (the row shape, `row.set`), `packages/hub/src/list.ts`
  (`deep status --json` reads `rows.read`), `packages/hub/src/mcp.ts` (`deep mcp` waits 55 s for the hub's answer, then
  says it "did not answer in time"), `packages/extension-host/src/{host,job-kinds}.ts` (`runTool`: `node <run.dir>/<entry>`
  through the supervisor, `{params, inputs}` on stdin, `{outputs}` on stdout, stderr unread; `JOB_MS` 120 s),
  `packages/contracts/extension-api.json` (registerJobTool's fields, none for counters), `packages/supervisor/src/
  {supervisor,seatbelt}.ts` (`process.starting {run, cwd}`, `process.ended`, `run.cleaned`; a tool may write nowhere),
  `packages/evidence/src/index.ts` (`openEvidenceStore`, `read(sha)`), `crates/deep-app/src/states.rs` (`TABLE`, `span`),
  `crates/deep-replica/src/drive/mod.rs` (`launch` from `record_copy`, `see`'s `rows` and `log_pos`, `close`),
  `crates/deep-replica/src/live.rs`; the suites `1922` (the template: layout, README, helpers, fixtures, BASE-FAILURE),
  `1463` (rows through `deep status --json` and `see`), `1460` and `1459` (the real app), `1546` (`deep-live --watch`).

## Criterion and files

One criterion, so one ID: `#1925.` and the first 8 hex digits of SHA-256 of the checkbox's text after `- [ ] `, trimmed,
white space collapsed (`scripts/proof-change.mjs`'s `criterionId`). Every `describe` title is the ID and the text.

| Part of the criterion | ID | File | Wrong program it fails on |
|---|---|---|---|
| "An encode job of 600 frames shows 300 of 600 when its tool has written 300, and its time left is within 10% of the time it then takes" | `#1925.c0a82b1d` | `count.test.ts` | the base (no job row); a row whose count isn't the tool's, a row with no time left, one more than 10% off, one trailing its tool by a batch (2 s) |
| "A planted tool that reports elapsed time over an expected duration shows 300 of 600 while 150 frames are written and fails, naming the job" | `#1925.c0a82b1d` | `planted.test.ts` | the base (no row shows 300 of 600, so the judge never fails that way); the planted tool `encode-guess@1.0.0` is the program the judge must fail |
| "Closing the app at frame 300 leaves the job running, and reopening shows its true count, never 0" | `#1925.c0a82b1d` | `reopen.test.ts` | the base (the app draws no job row); an app showing 0, or the count it had when it closed, after reopening; a job that stops at the close |

## Run them

macOS, Node 24 first on `PATH`:

```sh
npm ci                                                             # once
npm run build --workspaces                                         # the tests run packages/cli/dist/main.js
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -p deep-hook                      # the hub needs it
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -p deep-replica --bin deep-drive  # the app (reopen.test.ts)
NO_COLOR=1 node node_modules/vitest/vitest.mjs run tests/acceptance/1925/<file> --testTimeout=600000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/1925/tsconfig.json
```

- **One at a time:** each file starts its own hub, which runs the encoder through the supervisor for 80 s, and reads its
  timing to the batch (2 s), so the implementer adds `tests/acceptance/1925/` to `alone` in `scripts/lanes.mjs`, in a
  macOS lane (the replica draws on macOS only). Not done here: this job writes tests only. The supervisor's sandbox needs a
  shell that may start it (in Claude Code, the Bash tool with its sandbox off). About 90 s a file.
- **Needs:** `ps` (the cli role's peer check, read once), `target/debug/deep-hook`, `target/debug/deep-drive`. A missing
  build is `BLOCKED: …`, never a pass. `CARGO_TARGET_DIR` is honored.
- **Safety:** every folder is under `/tmp/dh1925-*`, removed after its file; every hub, `deep` command, `deep mcp` and
  `deep-drive` runs with `HOME` in its world's temp folder and without the caller's `DEEP_*`, `XDG_*`, `CLAUDE*`, `CODEX*`,
  `NODE_OPTIONS`; every process this suite starts is stopped by its PID; nothing is stopped by name or port. Nothing
  leaves 127.0.0.1. No model is called.
- **The proof** (the issue's Proof line) is written to `$TMPDIR/deep-1925-proof/`, rewritten each run: `count.json` (every
  read of the list, the row at 300 of 600 with its time left, the encoder's log), `reopen.json` (what the app drew at frame
  300 and after reopening, when it closed), `planted.json` (the planted tool's row and the judge's failure).

## The world (`helpers.ts`)

One world per test: a temp home; **a real hub** (`deep hub run`) with `DEEP_HUB_TEST_CONFIRM` (the OS confirming you,
stubbed, as #1922's suite does); **a project folder** holding the input `clip.txt` ("dawn"), the working folder of **a
`deep mcp`** spoken to as an agent's MCP client does; **the hub's socket as the cli role** (the control token and this
process as the peer) for `rows.read` and `events.read`; and, in `reopen.test.ts`, **the app**: the real `deep-drive`.
Plug-ins are installed with `deep install <folder>` as you (#1922's merged path; a refusal is `BLOCKED`).

**The test plug-ins** (each folder copied per use, its `*.fixture` files renamed, the encoder's two files laid in
`./encoder`, its manifest's digest set by the extension host's `packageDigest`):

| Plug-in | Fixture | Registers |
|---|---|---|
| `test/encode-kind@1.0.0` | `fixtures/kind` + `fixtures/tool/{encode,counter}.mjs` | the kind `test.encode` and its first tool `encode-a@1.0.0`, which reports the frames it has written |
| `test/encode-guess@1.0.0` (planted) | `fixtures/guess` + `fixtures/tool/encode.mjs`, `guess-counter.mjs` as `counter.mjs` | the tool `encode-guess@1.0.0`, which reports elapsed time over an expected duration |

**The kind `test.encode`**, an encode stand-in: params `{frames, batch, every_ms}` (integers, all required), one input
`clip` (text), two outputs: `video` (the frames, `<clip>#<n>` a line) and `log` (when each batch was written,
`<frames written> <ms since the epoch>` a line, the first its start at 0); the key `['tool', 'params', 'inputs']`; no
output check; a qualification of two quick clips (`fx-three`, `fx-five`, `every_ms: 0`) that name only `video`, since the
log holds times. Both tools pass it: they write the same frames.

**The encoder** (`fixtures/tool/encode.mjs`) writes `frames` frames, `batch` at a time, batch k due `k × every_ms` after
it starts, so its count holds still between batches; it reports its counter on stderr at its start and after each batch.
**The run every test makes:** `deep_job {op: run, kind: test.encode, tool, params: {"frames":600,"batch":15,
"every_ms":2000}, inputs: [{name: clip, path}]}`: 15 frames every 2 s, 7.5 a second, so 150 frames at 20 s, 300 at 40 s
and the last at 80 s, inside #1922's 120 s run limit. The time left at frame 300 is about 40 s, written in seconds.

## The surface under test (readings where the issue or design leaves a shape open)

The issue and design name: a running job's row; progress "only from its tool's own counters, such as frames written of
the total, ... never a guess from elapsed time"; "300 of 600"; the time left after 30 s "from the rate measured so far";
the app closing and opening again. Where they leave a name or shape open, this job took the smallest surface the design
and the base imply; each reading is listed here so the implementer builds to it.

1. **How a job tool reports its own counters.** As JSON lines on its stderr, one line per update:
   `{"progress": {"done": <whole number>, "total": <whole number>}}`; the newest line holds. Any other stderr text is the
   tool's own and ignored. No field of `deep.registerJobTool`'s descriptor declares counters (the merged contract has
   none, and its `additionalProperties` is false): a tool that writes such lines has counters. stdout keeps #1922's one
   `{outputs}` object, so nothing about a tool's outputs changes. (A provider's percent, `{"progress": {"percent": n}}`, is
   the issue's third example; no test reads it.)
2. **The job's row.** A running job has a row of its own in the one list the hub builds (States people see: one row shape,
   built in one place, recorded as `row.set`), whose `id` starts `job:`. A test reads the list through `rows.read` on the
   cli role, the hub's call `deep status --json` prints (`{log_pos, rows}`); the job's row is the row whose `id` starts
   `job:` (one job runs at a time in each world).
3. **What the row says.** Its text (its string fields but `id`, `address`, `session`, `project`, `agent`, `entry` and
   `waits_on`: so `title`, `word`, `why` and any text field added) holds its count as `<done> of <total>` from the newest
   counter, and after 30 s of the run its time left as `<span> left`, the span as the app writes one (`states::span`:
   `40 s`, `2 min`, `1 h`, `1 d`), such as `300 of 600 · 40 s left`. The word for the state isn't read.
4. **"Shows 300 of 600 when its tool has written 300".** The list is read every 200 ms (a read takes about 2 ms). The
   frames the tool had written at any moment are the encoder's own `log` output, read after the run. The first read whose
   row shows `300 of 600` must fall (its midpoint) while the encoder had written 300: within the 2 s from batch 20 to
   batch 21, so a row may trail its tool by less than one batch.
5. **"Its time left is within 10% of the time it then takes".** The first read at `300 of 600` whose row holds a time
   left, if it comes 30 s or more after the tool's run started: its time left, against the time from that read's midpoint
   to the moment the encoder wrote its last frame (its log's last line), within 10% of the latter.
6. **The app, closing it and reopening it.** The app is the real `deep-drive` (#124), the replica of the app's window,
   driven over its stdin. **Opening** it is a `deep-drive` process (started ahead, as the app's binary) and `launch
   {from: "record_copy"}`, which reads the hub's record as the app does when it opens; **reading** it is `see`; **closing**
   it is `close` and its process ended (stdin closed; by PID if it lingers); **reopening** is a new `deep-drive` process
   and `launch` again. The window draws the job's row as a node whose `id` is the row's id (as #1463 pinned for every
   row), and the node's text (its and its children's names and string values) holds `<done> of 600`, and at frame 300
   a time left as in 3. The app is opened when the job's row first shows `300 of 600` (or 41 s after the call, if none
   does) and closed straight after it is read; it is opened again 4 s after it closed.
7. **"Its true count".** A count the encoder had written at some moment from one batch (2 s) before the open's `launch`
   to the end of its `see`. "Never 0" also fails `0 of 600` outright, and a reopened app that draws no job row fails.
8. **"Leaves the job running".** After the close, the encoder writes on to its last frame (its log's 600 comes after the
   close, with fewer written at the close) and the job ends done, its outputs kept (deep_job's reply, or the rerun's hit).
9. **deep_job's reply isn't read for progress.** The run takes 80 s; at the base `deep mcp` waits 55 s for the hub and
   then answers "did not answer in time" while the hub runs the job on. So the run's end is read from the record: the
   `process.starting` whose `cwd` is the tool's `run.dir` (`…/encoder`), then its `process.ended` or `run.cleaned`. Its
   outputs come from deep_job's reply if it came back done, else from a rerun with the same arguments once the hub has
   stored them (two `evidence.stored` after the run's end), which must be a cache hit (#1922); the `log` output's bytes
   are read by hash through the evidence store's public entry (`openEvidenceStore({root, readOnly: true}).read`).
10. **"Fails, naming the job".** The judge (`judgeCount`, which `count.test.ts` runs on the right tool) fails the planted
    run with a failure that names the job by its row's id, its kind `test.encode` and its tool `encode-guess@1.0.0`, and
    says the row showed `300 of 600` while the encoder had written 150 frames of 600.

## Plants

| Plant | Criterion part | The wrong program | Read as failed when |
|---|---|---|---|
| `encode-guess@1.0.0` (plug-in `test/encode-guess`, `fixtures/tool/guess-counter.mjs.fixture`) | the planted tool | the same encoder, frames and pace as `encode-a@1.0.0`, but its counter is elapsed time over the 40 s it expects for 600 frames (15 a second, whole seconds): 300 of 600 at 20 s, with 150 written | `judgeCount` fails it: `the job's row job:… (test.encode on encode-guess@1.0.0) showed "300 of 600" at <t> s while its tool had written 150 frames of 600` |

It is a plug-in, not a hub plant: it qualifies (its frames are right), so the hub must show what it reports, and the
judge must catch it. No `DEEP_HUB_PLANT` is used. The base (no job row) is the wrong program for the other two parts; a
throwaway run of the judges on made-up runs, not kept, also failed a row that guesses from elapsed time on the right
tool, a row with no time left, a time left twice the true one, a row trailing its tool by 2.5 s, an app reopened at 0 or at
its count from the close, and an app with no job row, and passed a right one.

## How each part is read

- **`count.test.ts`**: one world with `test/encode-kind`; the run on `encode-a@1.0.0`, the list read every 200 ms until
  the tool's run ends; `judgeCount` must find nothing wrong: the list held the job's row; its first read at `300 of 600`
  fell while the encoder had written 300; and the first read at 300 of 600 with a time left said one within 10% of the
  time to the encoder's last frame.
- **`planted.test.ts`**: one world with `test/encode-kind` and `test/encode-guess`; the same run on `encode-guess@1.0.0`;
  `judgeCount`'s failures must include `showed "300 of 600" at <t> s while its tool had written 150 frames of 600`, and
  that failure must name the row's id, `test.encode` and `encode-guess@1.0.0`.
- **`reopen.test.ts`**: the run on `encode-a@1.0.0` with the app (reading 6); `judgeApp` must find nothing wrong: at frame
  300 the app drew the job's true count and a time left; after the close the encoder wrote on to 600 and the job ended
  done; reopened 4 s after the close, the app drew the job's true count, not 0.

## Known limits

- **The session closing** (Scope: "keeps running when the app or the session closes") isn't read: the criterion names
  the app. The agent's own `deep mcp` stays open; its deep_job call is answered "did not answer in time" at 55 s at the
  base, and that answer isn't judged.
- **The app is the replica**, the app's own views on GPUI's test platform reading a copy of the hub's record, not the real
  `deep-app` window (#1459's `RealApp` needs Accessibility and Screen Recording; #1546's `deep-live --watch` a shown
  window). Closing it can't reach the hub, so "leaves the job running" is read from the encoder's log and the job's end.
- **Timing.** The encoder's count holds for 2 s per batch; a row that trails its tool by 2 s or more fails reading 4. A
  machine so slow that the app reopens after the encoder's last frame makes `reopen.test.ts` `INCONCLUSIVE: …`, never a
  pass. The base runs ran at a load average near 300.
- **Not read** (Scope, no criterion): a job whose tool has no counter (elapsed time and the word running, never a bar);
  a provider's percent; that no time left shows before 30 s; the words saying the job keeps running when the app or the
  session closes; the row's word and status-map entry.
- The time left is read only at frame 300 (about 40 s, so written in seconds); a span written in whole minutes would be
  more than 10% off there.
