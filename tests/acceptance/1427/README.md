# Acceptance tests for #1427: the motion check, every journey sampled on the virtual clock

Written first, blind, from issue #1427 (Scope, its seven acceptance criteria, Proof, Depends on), the design and the base commit
`6aa228ce` (origin/main), by a job that never saw an implementation; none existed. The implementing agent doesn't edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

What was read: `AGENTS.md`; `docs/technical-design.md` (Replica; How we know version 0 works; Dogfooding; The project page); the issue
and its epic #6 and sibling #124; at the base `crates/deep-replica` (`src/drive/mod.rs`, `check.rs`, `plant.rs`, `src/deep_drive.rs`,
`tests/drive.rs`, `Cargo.toml`), `crates/deep-app` (`views.rs`, `events.rs`), `packages/checks-journey/src/motion.ts` (the browser's
motion assertions, #37, which this issue does not touch), `benchmarks/replica.mjs`, `benchmarks/budgets.json`, `scripts/lanes.mjs`,
`scripts/benchmark.mjs`, the pinned gpui-shell's script API (`transition`, `spring`, `opacity`, `cx.timer`), and #124's suite
(`tests/acceptance/124/`: README, helpers, journey-helpers, the budgets live file) as the model for layout. #124's helpers are reused
by import (`../124/helpers.ts`): the `deep-drive` build, the process handling, `must`, `launch`.

## Run them

```sh
npm ci                                   # once
npx tsc -p tests/acceptance/1427/tsconfig.json
npx vitest run --root tests/acceptance/1427 --no-file-parallelism
# by hand only, on the reference Mac, never in CI:
DEEP_MOTION_BUDGETS=1 npx vitest run --root tests/acceptance/1427 ac8-budget.live.test.ts
```

macOS and cargo (the replica renders with GPUI's offscreen Metal renderer; off macOS every test fails `INCONCLUSIVE:` and never
passes). Every file builds `deep-drive` once with `cargo build --locked -p deep-replica --bin deep-drive --features env-plants`
(#124's helper). Temp folders are `/tmp/dd124-*`; every process is stopped by its PID. `ac7-shipped.test.ts` runs the lane's own
commands (up to 30 minutes) and the whole suite starts about 40 replicas, so it runs in the `alone` block.

## The surface, and why it is the smallest real one

The replica's own driver, `deep-drive`, which #124 built and which every journey on the replica already goes through: one process,
JSON lines in and out. The base has exactly one check on that path, `ui_check`, which takes no launched replica, can replay a journey
(`ui_check.journey`) in a replica of its own and answers `claim`, `findings`. The motion check is the same shape, so this job adds two
calls to the same binary and no new binary, no new package and no new `[[test]]`:

- **`motion`**: records a launched replica, as `record` records video. `{"call": "motion", "motion": {"action": "start" | "stop", "reader": <locator> | null}}`.
  While it runs the replica's clock steps by 1/120 s (the base steps 1/60 s) and takes one sample a step. `stop` answers `{ok, t, recording}`.
  `reader` is the locator of the line a person is reading (`{text: "Line B"}`), kept in the recording as that element's id.
- **`motion_check`**: reads a recording and answers the findings. It needs no launched replica. One of three inputs:
  `{recording}` (a recording given as data), `{journey: [calls]}` (a journey as #124's `ui_check.journey` takes it: a launch first, the
  calls after, no `replica` field; the check replays it in a replica of its own, recording from the launch, and closes it) or
  `{shipped: true}` (the three shipped journeys, below). `{allowances: [...]}` and `{reader: <locator>}` (journey only) go with any.

Why not the lower surfaces: the check's reading of a recording is pure, but the issue asks for the recording to come from a replica
journey and for the shipped journeys to be checked, so a unit surface alone would pass a check that never samples a replica; a
recording as data alone would pass a recorder that is wrong. So each criterion is judged where it is cheapest to plant a wrong
program, and the criteria that need a real recording are judged again on one: planted shapes on data (fast, exact thresholds), the
same plants on the lab panel's real recording, and the shipped journeys. Not the Playwright motion check (`packages/checks-journey`):
that is #37's, for web journeys, and has no virtual clock.

### The recording, `motion.recording@1`

```jsonc
{
  "format": "motion.recording@1",
  "window": [w, h],          // the window in device pixels at the launch's scale, as every bound is
  "step": 5880000,           // flicks a sample: 705,600,000 a second / 120
  "reduced_motion": false,   // the launch's
  "inputs": [{"t": flicks}], // when each act, press or type was delivered; any extra field (kind, point) is free
  "reader": "line-b" | null, // the id of the reader's line
  "declared": [{"element": id, "kind": "flight" | "spring"}],  // what the app declared: a transition is a flight
  "frames": [{"t": flicks, "elements": [{"id": str, "bounds": [x, y, w, h], "opacity": 0..1, "text": str}]}]
}
```

`t` is flicks since the replica's launch, as every reply's `t` is; frames are exactly `step` apart; an element absent from a frame is
not on screen at that step. `id` is the element's stable identity: from the record for a row (an ask's handle `ask:<id>`, a session's
ID), never a position, and for a panel's element the id the panel gave it (`div().id("jumper")`); a real replica may prefix a path,
so the real-replica tests look for the panel's id inside the recorded one. A `transition(...)` is a declared flight and a
`spring(...)` a declared spring; the test panel declares one of each.

### The reply

```jsonc
{ "ok": true, "t": ..., "claim": "PASS" | "FAIL" | "INVALID" | "INCONCLUSIVE" | "BLOCKED",
  "findings": [{"finding": <closed list>, "element": id, "t": flicks, "value": number}],
  "stale": [{"finding": ..., "element": ...}],          // allowances that matched nothing
  "pacing": "pacing not measured",
  "recording": {"sha256", "frames": n, "step", "inputs": [...], "reduced_motion", "elements": [sorted distinct ids]},  // journey and shipped modes
  "journeys": [{"name", "claim", "findings", "pacing", "recording": {...}}] }                 // shipped mode; findings above are then every journey's, each with its "journey"
```

What each finding's `t` and `value` are (the issue says only "names the element, the time and the measured value"; this job fixed them):

| finding | `t` | `value` |
|---|---|---|
| `pop_in` | the step the element is first above 50%: it was absent or at 0, and is now over 0.5 | its opacity then, 0 to 1 |
| `jump` | the step after the move | the move as a fraction of the window's width (or height, for a vertical move) |
| `overshoot` | the step it is furthest past its target; the target is where it comes to rest | the distance past the target over the length of the move, start to target |
| `flicker` | any step from the first to the last reversal | the reversals in the worst 200 ms |
| `no_settle` | a step at least 2 s after the last input at which it still moves | seconds since the last input at that step |
| `reader_moved` | the step the reader's line moved | pixels moved, in the recording's unit |
| `moved_under_reduced_motion` | any step in which it changes place | the steps in which it changed place |

An element "moves" when its bounds' origin changes; "still moving" at a step when the origin differs from the step before. The
thresholds are the issue's: over 50%, over 25% of the window (strictly: exactly 25% and exactly 50% give nothing), more than 12%,
more than two reversals in 200 ms, 2 s after the last input, more than one step.

### The shipped journeys

`{shipped: true}` runs three journeys on #338's fixture record (`docs/spikes/338/fixtures/needs-you.events.jsonl`), each a list of
`deep_drive` calls that launches a replica on one center and does something to it (at least one `act`): **`needs-you`** (the Needs you
page), **`session`** (a session page) and **`project`** (the project page; the app's own id for it is `home`). The implementer
chooses the calls and where they live. A journey is checked as any other, and reported under its name.

### The wrong program the shipped lane is planted with: `DEEP_DRIVE_PLANT=jumps-on-act`

An env-plants build only (#1408). After each `act` the replica draws its whole tree 30% of the window's width to the right for one
step, then back. Every shipped journey then has `jump` findings; none has one without it. The implementer adds the plant to
`drive/plant.rs`.

## Fixtures (`fixtures/panels/motion-lab/main.js`)

One panel, twelve buttons, a lane for each motion; every journey presses one button and waits to 6 s. The header comment of the file
lists them. Launched at 640 by 600 points, scale 2. Each plant has a twin that moves the same way and passes: `Fade in` (the pop-in
at 10% rising 10% a tick), `Fly` (the jump's distance under a declared transition), `Spring` (an under-damped spring that goes past
its target, declared), `Flicker 2` (two reversals), `Drift short` (moves 0.7 s) and `Insert below` (a line streams in under the
reader). The data fixtures in `helpers.ts` add the near-miss twins on each side of each number: 49% and exactly 50% opacity; 24% and
exactly 25% of the window, on both axes; 11.1% past a move against 15.3%; 125 ms between reversals; a drift that stops at 1.7 s; a drift
that moves 2.7 s after the first input but 1.75 s after the last; the same jump and slide with a flight declared; the same overshoot
with a spring declared.

## The criteria, and what fails each

| Criterion (issue) | File | A wrong program it fails |
|---|---|---|
| 1. Planted fixtures each give exactly one finding naming element, time, value; near-miss twins give nothing | `ac1-planted.test.ts` (data), `ac1-journeys.test.ts` (real replica) | a check with no threshold; a threshold in the wrong place (each twin sits 1 point on the other side: 49/50/55%, 24/25/26%, 11/15%, 2/3 reversals, 1.7/4 s); one finding per frame instead of one; one that ignores a declared flight or spring; one that measures from the first input, not the last; one that counts reversals outside a 200 ms window; a recording that is not the app's own (the journey tests read the lab's real frames) |
| 2. Insert above the reader gives `reader_moved`; below gives nothing | `ac2-reader.test.ts` | a check that flags every insert, or every line that moves (the below fixture moves Line C), or none |
| 3. Under reduced motion a change of place over more than one step gives `moved_under_reduced_motion` | `ac3-reduced.test.ts` | a check that ignores the flag; one that flags a one-step move, or any move with the flag off; one that counts a fade; a replica that doesn't pass the flag to the recording |
| 4. An allowance with no reason is INVALID; one that matches nothing fails as stale; a valid one suppresses its finding | `ac4-allowances.test.ts` | a reasonless, empty, blank or null reason that still suppresses or passes; an allowance that suppresses another element's or another finding's; stale ignored; a valid allowance that suppresses everything |
| 5. The same journey recorded twice gives byte-equal findings | `ac5-repeat.test.ts` | an order that follows a hash map, a clock or a PID (elements shuffled, two processes); a real recording that differs run to run |
| 6. A result never reads PASS for pacing: "pacing not measured" | `ac6-pacing.test.ts`, and `contract` on every reply | a result that leaves it off, in any of its five shapes (clean, failing, INVALID, cleared, real) |
| 7. It runs in a lane on the three shipped journeys | `ac7-shipped.test.ts` | a lane that prints names and no recording; a shipped check that samples nothing (the plant); one that reports one journey, or not by name; ids that are positions |
| 8. Under 2 s added to a 30-second journey | `ac8-budget.live.test.ts` (by hand) | a recorder that costs more than 2 s over 3,600 samples |
| Scope: a journey records each step's bounds, opacity and text, by stable identity | `scope-recording.test.ts` | a recording at the wrong step, with positional ids, without declared motion, or not the same bytes twice |

Each test fails on the base commit because the surface is missing: `deep-drive` answers `motion` and `motion_check` as `no call`
and the lane is not in `scripts/lanes.mjs` (BASE-FAILURE.txt).

## What the implementer adds

`scripts/lanes.mjs` (the implementer's edit; no file outside this folder was touched by this job):

- `alone`: `'tests/acceptance/1427/'` (the files build `deep-drive` and start replicas).
- `byHand`: `'tests/acceptance/1427/ac8-budget.live.test.ts'`; and `timed`: the same file (its verdict reads the machine's load).
- `checks`: a lane named `motion` (the test finds it with `/motion/i`) whose commands run the check on the three shipped journeys with
  `target/debug/deep-drive`, print one line a journey with its name, its findings and the first 12 or more hex digits of its recording's
  `sha256`, and print `pacing not measured`; exit 0 when no journey has a finding or an INVALID or stale allowance, non-zero otherwise.
  It is a local lane (no CI on push; AGENTS.md); it runs in the local preflight beside the other checks.

`.gitignore`: gpui-shell writes `gpui-kit.d.ts` and `jsconfig.json` into a panel's folder each time a replica loads it; add
`tests/acceptance/1427/fixtures/panels/*/gpui-kit.d.ts` and `.../jsconfig.json` beside #124's two lines. (This job deleted the ones its own
runs wrote.)

`crates/deep-replica/Cargo.toml`: nothing for the tests (they are vitest files, like #124's). The `deep-drive` binary already exists;
the implementer adds the two calls to `src/drive/` and the plant `jumps-on-act` to `plant.rs` (`Plant::parse`), and if the shipped
journeys are files, no `[[test]]`. If the implementer adds Rust unit tests of its own, `[[test]]` entries follow the existing pattern.

`benchmarks/budgets.json`: none required by the issue (its budget is the added 2 s on the reference Mac, which `ac8-budget.live.test.ts`
measures); a perf task for it is the implementer's to propose.

## Ambiguities in the issue this job resolved (each is a place the implementer may disagree; the dispute goes to a blind redraft)

1. **`reader_moved`'s definition and its criterion disagree.** The design says "text on screen moves with nothing above it changing";
   the criterion says an insert above the reader's line gives it and one below gives nothing. Judged by the criterion: the reader's line
   moving because something was inserted above it. Text below the reader moving (Line C pushed down by an insert below) is not it.
2. **Which line is the reader's** is not in the issue. The recording carries it (`reader`), given at `motion` start. A check that
   flags every line that moves also passes the tests above, except where an insert below moves Line C (the `below` fixture) .
3. **"12% past its target"**: the tests read it as the excess over the length of the move (step-response overshoot); the data
   fixtures are chosen so the window-relative reading (12% of the window) gives the same answer, except the lab's real one, which pins the
   move-relative value, 1.0.
4. **"A move over 25% of the window in one step"** is read per axis (horizontal against the width, vertical against the height), strictly over.
5. **"Appears above 50% opacity in one step"** includes an element present at opacity 0 that is above 50% a step later, not only one absent a step before.
6. **"Still moving 2 s after its last input"** counts the recording only; a recording that ends before the 2 s mark can't give `no_settle`, and
   every fixture here runs past it. What the check says about a recording too short to judge (INCONCLUSIVE, by the second invariant) is not tested.
7. **"until a live run has measured it"**: the tests hold only that every result from a virtual run says "pacing not measured". Nothing in the issue
   says how a live measurement reaches the check; it is out of this suite.
8. **Allowance vs INVALID order**: a reasonless allowance that also matches nothing is INVALID, not stale (tested); the issue says "an allowance with no
   reason is INVALID" without condition.
9. **What `value` and `t` are** is this job's (the table above): the issue says each finding names "the element, the time and the measured value".
10. **The names of the shipped journeys** (`needs-you`, `session`, `project`) and `project` for the app's `home` view.
11. **`moved_under_reduced_motion` for native transitions**: the lab's `Fly` twin assumes the replica's reduced-motion flag makes a declared
    transition one step; the test reads that from the real replica and fails with its frames if it doesn't.
