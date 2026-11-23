# Acceptance tests for #2693: the scheduler's checkpoints in a ring with a byte budget

Written first, from issue #2693 (its Scope, its five acceptance criteria and its Proof line: "The checkpoints'
bytes after an hour and the seek hashes, on the merge base and on the change, and the two planted rings
failing"), the design sections it names and the base commit, by a job that never saw an implementation; none
existed, and no other branch, worktree, PR or notes folder was read. The base is this checkout's HEAD,
`4aa543da7` (origin/main, "Merge pull request #3201 …"). The implementing agent doesn't edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

## What was read

- The issue (`gh issue view 2693`), AGENTS.md, `docs/technical-design.md` (Dogfooding, Tests written first).
- `docs/canvas-primitives.md`: Checkpoint ring (`every`, `budget: bytes = 16 MiB`, "when the ring passes its
  budget, the spacing doubles. A seek restores the nearest checkpoint at or before t and steps forward";
  "It can never: Exceed its byte budget"); Frame clock and scheduler; The cost model; Carried state
  ("declared with a key and a byte budget"; "Seeking restores the nearest checkpoint … and steps forward, so
  seeking equals playing"; "a restore is O(steps since the checkpoint)"; "It can never: Exceed its budget");
  Logic: checkpoints and bake ("the first once the start function and `init` have run"; "when the ring
  passes its budget, the spacing doubles"); Determinism (full-state hashes, seeking means a jump from a later
  time); Transport; Input track (`checkpoint_every: s = 0.5`).
- For surfaces and style: `tests/acceptance/488/` (vitest driving binaries built per feature set, `planted`
  wrong programs, failures as sentences naming a flick) and `tests/acceptance/532/` (a suite-owned Rust crate
  built outside the workspace, under `target/`).
- At the base, to learn the surfaces: `crates/deep-canvas/src/schedule/steps.rs` (`Steps::checkpoint_through`
  keeps a copy of every stepping array at every multiple of `CHECKPOINT_EVERY`, cleared only by a seek with
  no checkpoint; `restore_point`), `src/time.rs` (`CHECKPOINT_EVERY` = 0.5 s), `src/schedule/mod.rs`
  (`Planted`, `Options`, `Scheduler`, `Session::{new, load, frame, nodes, report, frozen}`, `StepLog`,
  `default_view`), `src/registry/mod.rs` (`Registrar::{kind, array, carried, operator}`, `.steps`, `Registry`,
  `BuildSet::Core`); `crates/deep-canvas-test-modules/src/time.rs` (`test.tick`, how a stepping test module
  registers); `crates/deep-show` (`eval`'s `steps` and `carried`, its counting allocator) — not used, below.

What the base does, which these tests measure rather than credit: every checkpoint is kept for as long as
the session plays (an hour at 60 Hz with 64 KiB of stepping arrays holds 477,632,012 bytes on the live heap
on this Mac), every seek restores the last checkpoint at or before its time and steps at most 30 steps, and
seeks equal playing. There is no budget, no spacing that doubles, no reading of the ring, and no planted ring.

## Run them

```sh
npm ci && npm run build --workspaces       # once, if node_modules is missing
npx vitest run --root tests/acceptance/2693 --no-file-parallelism
npx tsc -p tests/acceptance/2693/tsconfig.json
rm -rf tests/acceptance/2693/node_modules/.vite
```

Each file first builds **the probe** (below) in **release**, once per feature set it uses: its crate is laid
out under `target/acceptance-2693-probe/crate/` (a `Cargo.toml` from `helpers.ts`, `probe/main.rs`, and the
workspace's `Cargo.lock`, so it pins what the workspace pins), built with `cargo build --release --offline
--target-dir target/acceptance-2693-probe/target [--features ring]`, and the binary is copied to a temporary
folder. Nothing is written into this folder. The probe depends only on `crates/deep-canvas` (libm, serde_json,
sha2, blake3, unicode-normalization), so a cold build takes about two and a half minutes. Release is needed:
an hour of play is 216,001 frames, about 100 s on a loaded Mac; a run with seeks and a straight play takes
about twice that. `scripts/lanes.mjs` needs `'tests/acceptance/2693/'` in its `alone` list (the files build
cargo binaries and count a process's heap); this README is the instruction, and the implementer makes that
edit. Node built-ins and vitest only.

## The probe

`probe/main.rs` is this suite's own program. It seals `BuildSet::Core` with two test canvas modules it
registers through deep-canvas's public `Registrar`, so the base needs no new module to run it and the proof
plays the real scheduler:

| Module | Registration |
|---|---|
| `test.ring` 1.0.0 | kind `test.ring@1` (no params, draws nothing); arrays `test.ring.count` (i64) and `test.ring.cells` (8,192 f64, **65,536 bytes**), document-scoped, class `time`, phase `simulate`; carried state `r.carried("checkpoint", "test.ring.state", 16 << 20)`, **16 MiB**; one operator `step` in simulate, `.steps(11_760_000)` (60 Hz), writing its count one up and every cell changed (cell i after step k is k × 8,192 + i), noting its count with `note_step` |
| `test.tight` 1.0.0 | the same over `test.tight.*`, with `r.carried("checkpoint", "test.tight.state", 16 << 10)`: a **16 KiB** budget, a quarter of one checkpoint |

It reads one JSON request on stdin, `{module: "ring" | "tight", play_to: flicks, seeks?: [flick], play_side?:
bool, planted?: name}`, and answers one JSON line:

- **Play**: one `Scheduler` and `Session`; the document `{"items": {"s": {"kind": "test.<module>@1"}}}`
  loaded; a frame at 0, then a frame at every 11,760,000 flicks up to `play_to` (the live path, every
  frame). `played.steps` counts the steps the frames ran (from `session.report.steps`), `played.last.last_count`
  is the last count noted.
- **Heap**: a global allocator counts live bytes (each allocation adds its size, each free subtracts it).
  `heap.held_since_start` is the live heap after the play less the live heap after the frame at 0, so it
  counts everything the session holds beyond its start: every checkpoint but the start's (which shares the
  start's arrays), and anything else that grows. This is criterion 1's "counted by the test".
- **Seeks**: in the same session after the play, a frame at each time of `seeks`, in the order given. For
  each: `steps`, the steps that frame ran of the module; `hash`, the **full-state hash**: SHA-256 of every
  carried-state row's hash (`Session::carried`, which hashes the stepping arrays as the last step left them)
  and every node's `result`; and the ring's reading after it.
- **Play side** (`play_side: true`): a fresh scheduler and session played straight from 0 through every
  frame and every sought time in ascending order, never sought, giving each sought time's full-state hash.
- `planted`: built with the feature `ring`, sets the planted ring on the scheduler's `Options`; otherwise the
  probe answers `{"refused": …}`.

## What the change adds (the surface the implementation must provide)

The probe's feature `ring` uses exactly these, in `deep_canvas::schedule`; at the base it doesn't compile,
and every test that needs it fails at the assertion "the probe builds with its feature `ring`", with cargo's
error naming what's missing.

### The reading: `Session::checkpoint_ring`

```rust
impl Session {
    pub fn checkpoint_ring(&self, s: &Scheduler<'_>) -> serde_json::Value;
}
```

answering the scheduler's checkpoint ring as this session holds it after its last frame:

```json
{"budget": bytes, "spacing": flicks, "bytes": bytes, "over_budget": bool,
 "held": [{"t": flick, "bytes": bytes}, … ascending]}
```

- `budget`: the byte budget the session's stepping modules declare for their `checkpoint` carried state
  (`test.ring`'s 16 MiB, `test.tight`'s 16 KiB; 16 MiB unless a module declares its own).
- `spacing`: the ring's current spacing, 0.5 s (352,800,000 flicks) doubled a whole number of times.
- `held`: each checkpoint the ring holds, by its flick, with its bytes (at least its stepping arrays'
  65,536); `bytes` is their sum.
- `over_budget`: true when one checkpoint alone is larger than the budget, so the ring holds only the
  start's checkpoint and the newest; false otherwise. This is criterion 4's "says so as a reading".

### The planted rings

Two new fields of `deep_canvas::schedule::Planted` (beside `checkpoint_nearest`), reachable only through
this proof surface:

- `ring_drops_start: bool` — the ring keeps every checkpoint the real ring keeps except the start's (it lets
  go of the checkpoint at 0 as if it were every second one); a seek before its earliest held checkpoint
  restores that one and shows its state unchanged. Its reading is the real ring's, less the start.
- `ring_newest_only: bool` — the ring holds only its newest checkpoint (it never passes its budget, so its
  spacing stays 0.5 s); a seek before it has no checkpoint at or before its time and steps from wherever the
  scheduler then can (the start, as the base does without checkpoints).

No `deep-show` call, Cargo feature or test module is needed.

## Criteria to tests

IDs as given for the issue's criteria. Each test's name starts with its criterion's ID; every case is its own
top-level `it()`; every check is on values (bytes, hashes, step counts, times), never on a throw.

| ID | Criterion | Test, and what fails it |
|---|---|---|
| `#2693.08c5bf8c` | One hour of play of a stepping document whose arrays total 64 KB holds at most 16 MiB of checkpoints, counted by the test; on the merge base it holds 7,200, over 400 MB, and fails naming the bytes | `ring-bytes.test.ts`, plain probe, `test.ring`, play 0 → 1 h: 216,001 steps ran; `heap.held_since_start` ≤ 16,777,216. **Base: fails at that assertion**, naming 477,632,012 bytes (455.51 MiB, about 7,288 checkpoints' worth; the scheduler holds 7,201, 0 through 1 h) |
| `#2693.5e136ab2` | After that hour, a seek to each of 100 seeded times gives the full-state hash playing gives; a planted ring that lets go of the start checkpoint fails on a seek into the first spacing, naming the time | `seek-hash.test.ts`: (1) plain probe, the hour, then 100 seeded seeks (seed 2693, descending, each a jump back; ten in (0, 0.5 s), ninety in [0.5 s, 1 h), any flick) against a straight play: every hash equal. **Base passes it** (it keeps every checkpoint); the planted `ring_drops_start` fails it on the seeks into the first spacing. (2) `ring` probe, `ring_drops_start`: some seek fails, the first failure (in time order) is before 0.5 s and its sentence names the flick, and no seek at or past the reading's spacing fails. **Base: fails** at "the probe builds with its feature `ring`" |
| `#2693.769d2c70` | A seek steps forward at most one spacing's steps, counted; the spacing after an hour is in the reading; a planted ring keeping only the newest checkpoint fails, naming the steps | `seek-steps.test.ts`: (1) `ring` probe, the hour and the 100 seeks: the reading's spacing is 0.5 s × 2^k, its budget 16 MiB, its bytes ≤ 16 MiB, not over budget, the start held, no two held checkpoints more than a spacing apart, the newest within a spacing of the hour, and every seek's steps ≤ ⌊spacing ÷ 11,760,000⌋. (2) `ring_newest_only`, the hour and the five latest seeded times: the ring holds one checkpoint, each seek earlier than its newest steps more than a spacing's steps, the first among them, and each failure names its steps. **Base: both fail** at "the probe builds with its feature `ring`" (the reading is missing). Other wrong programs (1) fails: a ring that lets go without doubling the spacing (two held checkpoints more than a spacing apart), and a seek that restores an earlier checkpoint than the last at or before its time (more steps than a spacing) |
| `#2693.302a0e55` | A document whose one checkpoint is larger than the budget keeps the start's and its newest, says so as a reading, never refused, never silently unbounded | `over-budget.test.ts`, `test.tight` (16 KiB budget, 64 KiB checkpoints), a minute: (1) plain probe: no load issue, no frozen frame, 3,601 steps, `heap.held_since_start` ≤ 262,144 (four checkpoints). **Base: fails at that assertion**, naming about 7.9 MB (121 checkpoints held). (2) `ring` probe with seeks at 59.9 s, 30 s and 0.2 s (off-step) and a straight play: budget 16 KiB, `over_budget: true`, two held, at 0 and within a spacing of the minute, each ≥ 65,536 bytes, bytes their sum, every seek's hash equal to playing. **Base: fails** at the build |
| `#2693.821f46f4` | `tests/acceptance/488/` and `tests/acceptance/532/` pass unchanged | **No tagged test; proven by hand**, by the procedure under "Criterion 5 by hand", and again at release, where preflight's `tests` lane runs both folders in its `alone` block. It stays open in the trace lane, so a PR proves it with the hand run's saved output and says `Part of #2693` unless the maintainer accepts that record. In the lanes, criteria 2–4 cover what the change could break in 488: seeks equal playing through the ring (2), a seek steps at most a spacing (3), and a document whose one checkpoint is over its budget (as 488's `test.tick` boards are, at 64 bytes) is never refused (4). Wrong programs the hand run catches: a ring that changes what 488's seeks restore, a budget that refuses 488's `test.tick` boards, an edit to either folder |

## Readings where the issue and design leave a choice

- **"Counted by the test"** is the probe's own allocator: live heap bytes, not the ring's word for its bytes
  (AGENTS.md: an agent's word is never evidence). It overcounts (anything else the session keeps), never
  under. The base's 7,201 checkpoints are 7,200 beyond the start's; the issue's "7,200 of them" is that.
- **"Arrays total 64 KB"** is 65,536 bytes of f64 cells plus an 8-byte count, every value changed each step,
  so each checkpoint pins its own copy, as the issue says each map pins that instant's values.
- **One hour of play** is a frame at every 1/60 s from 0 to 3,600 s inclusive in one session; the frame rate
  doesn't change which checkpoints are taken (they are at multiples of the spacing), only what play costs.
- **The full-state hash** is the session's: every carried-state row and every node's result, so a restore
  that leaves any stepping array wrong changes it. The play side never seeks.
- **"A seek"** is a jump back: the 100 seeks run in descending time after the hour, so each one is a jump
  from a later time, as Determinism defines seeking, and none is a forward play.
- **"The first spacing"** is (0, 0.5 s) in the seeded set: before any checkpoint but the start's whatever the
  spacing has doubled to; the plant's failures are bounded by the reading's spacing.
- **"Steps from it for every earlier seek"**: a ring that holds only its newest checkpoint has none at or
  before an earlier time, so the test asserts those seeks step more than a spacing, wherever they step from.
  Five seeks, since each costs most of an hour's steps.
- **"Says so as a reading"** is `over_budget` in the ring's reading; **"never refused"** is no load issue and
  no frozen frame, every step run; **"never silently unbounded"** is the heap, counted, within four
  checkpoints after a minute.
- **488 and 532 "pass unchanged"** is each folder identical to the merge base, and each suite run with its
  README's own command, exiting 0 with no failed and no skipped test. It is run by hand (Criterion 5 by hand, below).

## The base run

`BASE-FAILURE.txt` is the base's run of criteria 1–4 (`ring-bytes`, `seek-hash`, `seek-steps`,
`over-budget`), paths redacted to `<repo>`. Criterion 5 has no tagged test and was not run at the base:
both suites landed on main and pass there by their own proof, and its diff check holds trivially at the base.

## Criterion 5 by hand

On the change, from the repository root, with Docker running and 532's image pulled (532's README, Run them);
save the output of each command with the PR's evidence, paths redacted:

```sh
base=$(git merge-base HEAD origin/main)
git diff --name-status "$base" -- tests/acceptance/488 tests/acceptance/532        # prints nothing
git ls-files --others --exclude-standard -- tests/acceptance/488 tests/acceptance/532  # prints nothing
NO_COLOR=1 npx vitest run --root tests/acceptance/488 --no-file-parallelism
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/532 --testTimeout=600000 --no-file-parallelism
rm -rf tests/acceptance/488/node_modules/.vite tests/acceptance/532/node_modules/.vite
```

It passes when the two listings are empty and each vitest run exits 0 and its summary shows no failed and no
skipped test file or test. A `BLOCKED:` failure (532 with no Docker or no Chrome) leaves criterion 5
`BLOCKED`, never passed: rerun on a host that has them. On this Mac 488 took about 25 minutes and 532 about 70.

## Redraft (criterion 5)

The first draft's `unchanged.test.ts` tagged three tests with `#2693.821f46f4`: a diff against the merge
base, and a run of each suite. A blind redraft removed it, for three measured facts: the before and trace
lanes (`scripts/proof-runs.mjs`) run every tagged vitest file of the issue in one process capped at 20
minutes and read every file of a stopped run as BLOCKED, and 488 (about 25 minutes) and 532 (about 70) alone
pass that cap, so the file made criteria 1–4 BLOCKED too; 532's Linux test needs Docker, so it is BLOCKED on
a host without it whatever the change does; and the diff test passes on the merge base while no planted wrong
program may replace files under the test paths, so the before lane could never see it fail. No test that runs
within the cap proves that the two suites pass, and a narrower tagged stand-in would let the trace lane read
the criterion as proven when it isn't. So the criterion has no tagged test: what is proven by a lane is
criteria 2–4's mechanism in this suite, and preflight's run of both suites at release; what is proven by hand
is the procedure above; what stays open in the trace lane is criterion 5 itself. Criteria 1–4's files, the
helpers, the probe and `lane.json` are unchanged (`lane.json`'s `why` still names `unchanged.test.ts`; its
`alone: true` stands for the probe builds).
