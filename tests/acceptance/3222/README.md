# Acceptance tests for #3222: what a `deep_show` waits behind other sessions' calls

Written first, blind, from issue #3222 (its body; it has no comments), the design sections it links and those they
lean on, and base commit `f8c6cff82` (origin/main, "Merge pull request #3248 …"), by a job that never saw an
implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a
blind redraft of this job (design: Dogfooding).

The issue is a spike: it changes no code on main. Its work is kept in `docs/spikes/3222/`, as #2649's and #2175's
are, and these tests check what is kept there, recomputing every reading from the harness's own output instead of
taking the spike's word (invariant 1). They never rerun the 1, 4 and 16-session measurement. One file,
`ac2-held-busy.test.mjs`, runs the spike's harness, against a canvas core this suite holds busy, for criterion 2's
second sentence.

## What was read

- Issue #3222; #241 (its epic), #806 (its dependency: `deep_show` through the hub, closed), and #2686, #2658 and
  #1416, which it sits beside.
- `docs/technical-design.md`: The canvas core ("one revision in flight per document"); How we know version 0 works:
  Criteria to tests, Wrong programs ("A planted wrong program lives in test code, or behind a build feature …, and is
  never chosen by an environment variable"), the edit guard (a suite's own lane file), Dogfooding, Tests written
  first, Repo guards (tests wait for events, never for time; a timer that only bounds a wait carries `// deadline:`).
  `docs/canvas-primitives.md`: Writer layer, Render-back. `docs/parallel-proof.md` sections 6 and 7.
- At the base, for the surface and never for expected values: `packages/hub/src/canvas.ts` (`Canvas`: one promise
  chain, the world line sent again when its text changes, a reply matched by its place in `waiting`; `showCall`),
  `hub-canvas.ts` (`show`, `canvasWorld`, `recordRevision`, `showCli`), `show.ts`, `client.ts` and `server.ts` (the
  `cli` hello with the control token, `canvas.show`); `crates/deep-show/src/canvas_side.rs` (`serve`, `READS`, every
  kept call played again before each call), the `canvas` branch of `main.rs`, `hub.rs` (`settle`, the world's
  `fault`, `SETTLE_TIMEOUT`), `probe.rs` (`draws_3d`); `tests/acceptance/806/` (`helpers.ts`, `figure.ts`,
  `sessions.test.ts`), `26/helpers.ts` (`Conn`, `control`), `393/helpers.ts`; `tests/acceptance/2649/` and `2175/` with
  `docs/spikes/2649/` and `2175/`; `scripts/budget-window.mjs` (`criterionId`), `lanes.mjs`, `lanes-lists.mjs`
  (`lane.json`), `alone-lint.mjs`, `wait-ratchet.mjs`.
- Probes run once in a scratch folder and not kept: the base hub with the world file's fault (each held call answered
  1.5 s or more after the one before; the base plays every kept call again in the fault's world, so the four held
  calls here were answered 1.9, 4.9, 9.5 and 15.5 s after they were sent, and a call sent once the first was answered
  came back after the fourth); and `ac2-held-busy.test.mjs` run against a stand-in harness in a scratch copy of the
  tree (both tests passed, 16 s each). Neither is a reading of the spike.

## How to run

```sh
npm run build --workspaces              # once: the harness's hub is this checkout's build
cargo build --locked --bin deep-show    # once: the canvas core the hub runs
node --test tests/acceptance/3222/ac1-table.test.mjs tests/acceptance/3222/ac2-planted.test.mjs \
  tests/acceptance/3222/ac3-list.test.mjs tests/acceptance/3222/ac4-follow-up.test.mjs tests/acceptance/3222/validate.test.mjs
node --test tests/acceptance/3222/ac2-held-busy.test.mjs
```

Node 24.22 first on `PATH`, and `git` (criteria 1 to 3 read this checkout's history). The record checks take about a
second; each held-busy test starts one hub through the harness, holds its core about 15 s, and stops what it started by
PID. Lanes: the folder's own `lane.json` puts it in `scripts/lanes.mjs`'s `alone` list with the reason `timing`
(`ac2-held-busy.test.mjs` reads a wait under a hold of seconds, and starts a hub that runs `deep-show` from `target/`);
no edit to `scripts/lanes.mjs` is needed. No test is timed, by hand or live, and none uses the network.

`validate.test.mjs` is this suite's own check that its validators pass a well-formed spike (a synthetic one, in the
formats below; it doubles as their worked example) and fail each planted fault. It carries no criterion and passes on
the base.

## The surface under test

- The spike's folder, `docs/spikes/3222/`: `record.json`, the harness outputs it cites, `README.md`, and the harness,
  `harness.mjs`.
- This checkout's git history at the record's `main`, for the lines of code criterion 3's list cites (`git show`).
- The hub's socket as `deep show` reaches it (`canvas.show` on a `cli` connection holding `<home>/.deepbuild/control.token`),
  and the world file the hub reads (`DEEP_HUB_TEST_SHOW`, #806's seam) with its `fault`, which keeps a frame the canvas
  core renders from settling for `ms` after the call is admitted (`hub.rs`, `settle`): the core's one thread sleeps
  there, so a call that renders holds the core at least that long. Both are the base's; this suite adds no seam.

## Surface choices

Every name here that the issue or the design doesn't give is this suite's choice and a requirement on the implementer.

### The spike's folder

`docs/spikes/3222/`, as #2649's and #2175's spikes keep theirs: `harness.mjs`, `record.json`, `README.md`, and the
harness outputs the record cites, at paths relative to the folder (no absolute path, no `..`), each pinned by its
sha256. Anything else there (the heavy fixture, an analysis script) is the implementer's.

### The harness's output (`--out <file>`)

One JSON object per run:

```json
{ "date": "2026-11-23T10:00:00.000Z",
  "machine": { "model": "Mac15,12", "cpus": 8, "os": "Darwin 27.2.0" },
  "load": { "start": [7.1, 9.2, 11.3], "end": [8.4, 9.0, 11.1] },
  "calls": [ { "session": "s1", "kind": "revision", "doc": "01J…", "arrivedMs": 1763890000123.4, "startedMs": …, "repliedMs": …, "planted": true } ] }
```

- `date`: when the run was taken (ISO 8601). `machine`: `model`, `cpus` (a whole number), `os`. `load`: the 1, 5 and
  15-minute load averages at the run's start and at its end (`os.loadavg()`). These are "the machine and its load at
  the time".
- `calls`: one row per call the harness's sessions sent, and no other row (not the calls a test sends). `session`: the
  harness's name for the session; `kind`: `revision` (a whole revision), `patch` (a patch of one value), `check`,
  `render_back_2d` or `render_back_3d`, the issue's five, spelled so (another kind may be added under a name of its
  own); `doc`: the document it names; `planted: true` only on the planted slow call.
- The three times, in milliseconds since the Unix epoch (`Date.now()`'s clock; fractions allowed):
  `arrivedMs`, "its arrival at the hub", when the hub had the call (read from the session's connection, before the
  hub builds its world and joins it to the canvas line); `startedMs`, "its start in the core", when its turn on the
  canvas core began (the hub, after the answer to the call ahead of it, starts sending its world line or its call line
  to `deep-show canvas`); `repliedMs`, "its reply", when the hub read the core's answer to it. A call that takes more
  than one turn (a render-back of the current revision first asks for the revisions) starts at its first and is
  answered at its last. Wait is `startedMs - arrivedMs`, service `repliedMs - startedMs`, and each row must have
  `arrivedMs <= startedMs <= repliedMs`.

### `record.json`

```json
{ "main": "<40 hex digits>",
  "runs": { "1": Run, "4": Run, "16": Run },
  "planted": { "fixture": { "path": "<relative to the checkout>", "sha256": "…" },
               "slow": Ref, "without": Ref,
               "patches": [ { "session": "s1", "doc": "01J…", "slow": 1234.5, "without": 3.2 } ] },
  "list": [ { "kind": "patch",
              "reads":   [ { "thing": "document", "file": "packages/hub/src/canvas.ts", "line": 213, "text": "this.chain.then" } ],
              "writes":  [ { "thing": "evidence", "file": "…", "line": 1, "text": "…" } ],
              "follows": [ { "kind": "revision", "file": "…", "line": 1, "text": "…" } ] } ],
  "followUp": { "issue": 3300, "title": "…", "criteria": [ "…" ] }  // or, instead:  "stays": "<one paragraph>"
}
```

- `main`: the full hash of the main commit the readings ran on, which must be an ancestor of `HEAD`.
- `Ref` is `{ "command", "out", "sha256" }`: the command that took the run, its output's path in the spike folder and
  its sha256. `Run` is a `Ref` plus `kinds`: for each kind its calls made, `{ "calls": n, "wait": { "p50", "p95" },
  "service": { "p50", "p95" } }` in ms, at the median and the 95th percentile by nearest rank (the smallest sample with
  at least that share of the samples at or below it, as #2649's suite reads it), recomputed exactly from the output.
- Each run's command names `harness.mjs` and `--sessions <n>` (1, 4 or 16; 15 for the planted runs, whose commands
  also name `--patches`, and `--slow` for the slow call's run only).
- `planted.fixture`: the heavy fixture the slow call rendered back, by its path in this checkout and its sha256; it is a
  JSON document with `items`. This is how the suite knows which fixture the spike used: the issue names none.
- `planted.patches`: the 15 patches, each with its wait in the slow call's run (`slow`) and in the run with no slow
  call (`without`), beside each other.
- `list`: one row per kind of call. `thing` names what is read or written; the issue's four are spelled `document`
  (the document the call names), `shown` (the documents it shows), `world` (the world the hub sends) and `evidence`
  (the evidence store); anything else a kind reads or writes gets a name of its own. Every entry of `reads`, `writes`
  and `follows` cites a line of code: `file` under `packages/` or `crates/`, `line` (from 1), and `text`, at least 8
  characters that line holds at `main`. An empty `writes` or `follows` says none.
- `followUp` (the task filed: its issue number, title and its own criteria) or `stays` (one paragraph saying why the
  line stays as it is), not both; the spike's `README.md` names `#<followUp.issue>`, or holds the paragraph.

### The spike's `README.md`

The table to read: it names each of the five kinds and gives the 95th percentile. It also holds what the issue gets
(below, "What this suite could not encode").

### The harness's command

`node docs/spikes/3222/harness.mjs --sessions <n> [--patches] [--slow] [--gate] [--plant times-from-core-start] --home <dir> --out <file>`

- `--sessions <n>`: n scripted sessions, each on a document of its own, through the hub's canvas side. Without
  `--patches`, each makes the calls of the 1, 4 and 16-session runs (the five kinds); with it, each shows its
  document and then patches one value of it, once; `--slow` adds the planted slow call, a 3D render-back of the heavy
  fixture, marked `planted`.
- `--home <dir>`: the harness runs its hub under that home (`<dir>/.deepbuild`, its socket `hub.sock` and its control
  token `control.token` there), a hub of this checkout's build that serves the hub's own socket and protocol, with
  `DEEP_HUB_TEST_SHOW` as the harness's environment gives it (the harness writes nothing to that file and sets no other
  world file when it is given).
- `--gate`: once its hub serves and its sessions are ready, the harness prints `{"ready": true, "hub": <pid>}` as its
  first line on stdout (`hub`: the PID of the process serving the hub's socket), then reads one line from stdin; no
  session sends a canvas call before that line. It then runs its sessions' calls, writes `--out`, stops its hub and
  exits 0.
- `--plant times-from-core-start`: the planted twin (below). A flag, not an environment variable: the design's Wrong
  programs rule says a planted program is never chosen by one.

### The held-busy run (`held.mjs`)

The test makes a temporary home under `/tmp` (a socket path must fit in 104 bytes) and a world file holding
`{"fault": {"holds": "asset_decode", "ms": 1500}}`, and starts
`node docs/spikes/3222/harness.mjs --sessions 1 --patches --gate --home <home> --out <file>` with `HOME` and
`XDG_CONFIG_HOME` moved into that home and `DEEP_HUB_TEST_SHOW` naming the world file. At the ready line it connects
to `<home>/.deepbuild/hub.sock` as `deep show` does and sends four `canvas.show` calls at once, each a two-rect board
with `include: ["issues", "pixels"]` on a document of its own, so each is held at least 1.5 s in the core's one
thread. When the first is answered (so the other three joined the line long before), it rewrites the world file
with no fault, so only its own calls are held, and writes the go line. The harness's session then sends its calls
behind the three still in the line. Each held call must come back presented with its snapshot (else BLOCKED: it may
not have held the core).

What a right harness must read (`validate.mjs`, `heldBusyProblems`), for the first call of each of its sessions:

- it arrived no earlier than the go line;
- it started in the core no earlier than the held calls could all have ended: their send time plus 4 × 1.5 s, since
  each holds the core at least 1.5 s and none could start before it was sent;
- its wait is at least 1,000 ms. At the go line at least three holds, 4.5 s, are still ahead of it (13.6 s on the
  base, whose replay holds every kept rendering call again), so a call that reaches the hub within 3.5 s of the first
  held call's end waits more than that.

If all four held calls were answered less than 1,000 ms after the go line, the run says INCONCLUSIVE: nothing was held
for the harness, and this is not a pass.

## The wrong harness

`--plant times-from-core-start` selects the planted twin, which the implementer builds beside the harness: the same
harness, except that it times each call from its start in the core, so it never reads the arrival: each row's
`arrivedMs` is its `startedMs`, and every wait it reads is 0. Its run in `ac2-held-busy.test.mjs` (the second test)
must fail `heldBusyProblems` with a problem that names the call: `the harness read a wait of 0 ms for session
"<session>"'s <kind> call on doc <doc>, its first call, which reached the hub while the test held the canvas core busy
ahead of it; it waited at least 1000 ms`. The test passes only when that problem is there, naming that call. On the
base there is no harness, so both held-busy tests fail `BLOCKED`, and that BLOCKED is not counted as the twin's
failure.

## Criteria to tests

| Criterion | Test | What it asserts | On the base |
|---|---|---|---|
| AC1 `#3222.74eeafb1` The table is on this issue: for 1, 4 and 16 sessions, each kind of call's wait and its service time at the median and the 95th percentile, with the machine and its load at the time | `ac1-table.test.mjs` | `main` is an ancestor of `HEAD`; for each of 1, 4 and 16 sessions, a run whose command names `harness.mjs --sessions <n>` and whose kept output (pinned by sha256) has `date`, `machine` and `load`, exactly n sessions with no document shared between two, at least one call of each of the five kinds and no planted call; the record's `kinds` row for every kind in the output equals its count, and its wait and service at p50 and p95 recomputed by nearest rank; the spike's README names the five kinds and the 95th percentile | fails: no spike record |
| AC2 `#3222.a59f91a3` With the planted slow call in flight, the 15 patches' waits are recorded beside the same patches' waits with no slow call. A harness that times a call from its start in the core, and so reads no wait, fails against a core held busy by the test, naming the call | `ac2-planted.test.mjs` | both runs kept and pinned, their commands as above; the slow call's run has exactly one planted call, a `render_back_3d`, and 15 patches from 15 sessions on documents of their own, each reaching the hub between the slow call's arrival and its reply; the run without it has no planted call and the same 15 patches (session and document); `planted.patches` lists the 15 once each, its two waits equal to those recomputed from each run; the heavy fixture is in this checkout with its sha256 | fails: no spike record |
| | `ac2-held-busy.test.mjs`, first test | the spike's harness, against the core this suite holds busy, reads its first call's arrival after the go line, its start no earlier than the held calls could end, and a wait of at least 1,000 ms | fails BLOCKED: no `docs/spikes/3222/harness.mjs` |
| | `ac2-held-busy.test.mjs`, second test (the wrong program) | the planted twin (`--plant times-from-core-start`) fails the same check, naming its first call | fails BLOCKED: no harness (not counted as the twin's failure) |
| AC3 `#3222.ddd84c68` The list names, for each kind of call, what it reads and writes and which other kinds it must follow, each with the line of code that shows it | `ac3-list.test.mjs` | one row for each of the five kinds and every kind the table has; each row's `reads` (not empty: every call is played against the world the hub sends), `writes` and `follows` are lists; every entry cites a code line under `packages/` or `crates/` that holds its `text` at `main`, read with `git show`; every `follows` names a listed kind; a patch follows a revision (the issue: "A document's revisions and writer layers need theirs") | fails: no spike record |
| AC4 `#3222.40f85375` A follow-up is filed for what the table justifies, with its own criteria, or this issue says in one paragraph why the line stays as it is | `ac4-follow-up.test.mjs` | exactly one of `followUp` (an issue number other than 3222, a title, and its own criteria, the number named in the spike's README) and `stays` (one paragraph, no blank line, held in the spike's README) | fails: no spike record |

Each test's name and failure messages start with its criterion's number and ID, the first 8 hex digits of the
SHA-256 of the criterion's text as `scripts/budget-window.mjs`'s `criterionId` reads it; they came out as the brief
gave them. Criterion 2 has two halves, so two files.

## Ambiguities

- **"The table is on this issue"** and **"this issue says in one paragraph"**: a test can't read GitHub. The suite
  checks the table in `record.json` against the kept output and the spike's README, and the paragraph or the
  follow-up's number in the spike's README; that the same is on the issue is the reviewer's.
- **Arrival, start and reply** are read as the hub has the call, as its turn on the core begins, and as the hub reads
  the core's answer (Surface choices). "Its reply" is the core's answer, which ends the call's turn in the line, not
  the session's reply, which comes after the hub records the revision; the wait behind other calls and the service in
  the core are what the issue asks about. The implementer chooses where in the hub each is read and says so in the
  spike's README.
- **"Each on a document of its own"** is read as: no document used by two sessions. A session may use more than one
  (a 2D and a 3D render-back of one document is a choice the issue leaves open).
- **"The calls a real session makes"** names five kinds; the table must have each, and may have more.
- **"With the planted slow call in flight"** is read as: each of the 15 patches reached the hub between the slow
  call's arrival and its reply. "The same patches" as: the same sessions patching the same documents.
- **"Among 15 sessions"**: which session sends the slow call is left to the implementer.
- **The heavy fixture** has no path in the issue: the record names it by path and sha256, and the test checks it is
  there and is a document. That it is heavy and draws in 3D is the reviewer's (the planted row's kind is
  `render_back_3d`).
- **"Which other kinds it must follow"** is read per kind, a list of kinds that may include the kind itself. The one
  pair the suite requires is the issue's own: a patch follows a revision. Whether the order holds within a document or
  across documents is the spike's to say, in its README.
- **"The line of code that shows it"** is checked at the record's `main`, in this checkout's history, so the check
  stays true when later changes move the line; that the line shows what the row claims is the reviewer's.
- **The issue's cited lines** were read on main `2a5bd60fd`; at the base `canvas.ts:167`, `:171` and `:186` and
  `canvas_side.rs:44` hold what it says, and the `canvas` branch of `main.rs` is at line 2905, not 2959.
- **The wrong harness** is selected by a flag, not by the environment variable the brief offered, by the design's
  Wrong programs rule.

## What this suite could not encode

- That the table, and the paragraph or the follow-up's number, are on issue #3222, and that the follow-up is filed on
  GitHub with the criteria the record copies.
- That the readings were taken as the record says, on the machine and at the load it names: the times are readings
  on one machine at one time, and no test bounds them (the issue sets no budget on a wait). Only the held-busy test
  asserts a time, and only one the hold makes certain.
- That each patch changes one value, that the 1, 4 and 16-session runs made the calls a real session makes, and that
  the heavy fixture is heavy and 3D.
- That the list is right: the test checks each entry's line holds the text it names, not that the line shows the
  claim, and not "which pairs of calls could run side by side" (Scope, not a criterion).
- That the follow-up is what the table justifies.

## Gaps and deviations

- **The held-busy bound has one assumption.** The certain parts are that the harness's first call can't start before
  the held calls could all end, and can't arrive before the go line. That its wait is at least 1,000 ms holds when the
  call reaches the hub within 3.5 s of the first held call's end (13 s on the base, whose replays hold the core
  longer); the INCONCLUSIVE guard catches a hold that was over at the go line, not a harness so slow to send that the
  hold ran out after it. The twin can't hide behind this: its start is always after the hold.
- **Two runs of the harness** (right and twin), each starting a hub, about 16 s of hold each, plus the harness's start.
- **The base fails every criterion test on a missing record or harness**: the base is the wrong program for criteria
  1, 3 and 4 and the record half of 2; `validate.test.mjs` shows each check also fails a planted wrong record.
- **The harness is the implementer's**, so the held-busy tests were run here only against a stand-in in a scratch copy
  of the tree (Probes, above), never against the spike's harness.
