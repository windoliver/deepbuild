# Acceptance tests for #532: checkpoints in a ring, bakes and goldens, logic.determinism, logic.budget and data assets

Written first, from issue #532 (its Scope, Fields, six acceptance criteria and Proof line: "The flock's full-state
hashes, probes and seeks, its golden on two machines, and the planted restores that only the full-state hash
catches"), its Oracle page (`doneright/oracles/issues/532.md` in DeepBuildAI/deepbuild, branch `doneright`: no
upstream test for any criterion), the design sections it names and the base commit, by a job that never saw an
implementation; none existed, and no other branch or worktree was read. The base is this worktree's HEAD, `a3efe5c8`,
which holds `42319109` ("Merge pull request #1745 … issue-531") and one later merge (#1479's taste call, which touches
nothing here). The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of
this job (design: Dogfooding).

## What was read

- The issue, live with `gh issue view 532 --repo windoliver/deepbuild`, and its Oracle page.
- `docs/canvas-primitives.md`: Logic beside physics; Logic `logic@1` (`assets`, `assets_at`, the copy before the start
  function, the refusal at check, the bake key covering assets); Logic: sandbox; Logic: checkpoints and bake; Logic:
  readings; Logic: work across steps; Input track (the stamp and its one-step lead while silent, forks); Carried state
  (a seek across frames on the render worker, the stale view, a newer seek cancelling an older one's steps); Render
  worker (`eval_ns`, worker ≤ 4 ms CPU, UI thread ≤ 2 ms); Budget classes (figure: 4 ms of frame CPU); Phase; Golden
  (physics); Check input: `physics.determinism`; Check input: logic kinds; Net: rollback.
- `docs/technical-design.md`: The logic module (Logic; Sandbox and budgets; Logic bake and checks; Saves); Dogfooding.
  AGENTS.md.
- At the base: `crates/deep-logic` (#531: `deep-logic`'s calls `about`, `check`, `bake` with restores, probes and
  peeks, `web_plan`, `web_runner`, `open`, `step`; `web/logic.mjs`), and the suite `tests/acceptance/531/` (the pattern
  this one follows: its README, helpers.ts, programs.ts and assembler; copied and cut down, nothing imported).

What the base already does, which these tests don't credit: checkpoints every `checkpoint.every` steps with their
deep hashes, restores into a fresh instance, continuation probes, fuel per step, logic.budget's worst step and lines
in a bake's `budgets`, the web runner. It has none of this suite's calls (`determinism`, `budget`, `golden`,
`golden_verify`, `view`, `frame`), no bake `keys` or `seeks`, refuses an item's `assets` field ("assets isn't built
yet"), takes one `--planted` name only, and none of this suite's planted names.

## Run them

```sh
npm ci                          # once, if node_modules is missing
docker pull --platform linux/amd64 rust:1.99.1-slim-bookworm   # once: the Linux x86_64 host (rust-toolchain.toml's channel)
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/532 --testTimeout=600000 --no-file-parallelism
npx tsc -p tests/acceptance/532/tsconfig.json
rm -rf tests/acceptance/532/node_modules/.vite
```

What a run builds (honoring `CARGO_TARGET_DIR`, with `CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` unless set;
helpers.ts puts Homebrew's rustup on PATH when present):

- **The assembler** `tests/acceptance/532/wat/` (crate `acceptance-532-wat`, #531's cut down to assembling and
  validating; `wat =1.263.0`, `wasmparser =0.263.0`; outside the workspace, its own `Cargo.lock`) into
  `target/acceptance-532-wat/`. It turns the programs in `programs.ts` into bytes.
- **`deep-logic`** for this Mac: `cargo build --locked --bin deep-logic` in the checkout.
- **`deep-logic` for Linux x86_64** (criterion 2 only): the same command in `docker run --platform linux/amd64` with
  `rust:<channel>-slim-bookworm`, the checkout mounted read-only, caches under `target/acceptance-532-linux/`. Nothing
  is pulled.
- **Headless Chrome** (criterion 2 only) at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` (or
  `CHROME_BIN`), as #531's suite runs it: a page on `127.0.0.1` imports the web runner's source and runs `web_plan`'s
  request through its `bake`; Chrome gets a temporary profile and is stopped by its PID (its own process group).

Every test passes an explicit timeout (90 minutes: the Linux build runs under emulation; it overrides
`--testTimeout`). Temporary folders (binaries,
Chrome profiles, assembler output) are deleted. Node built-ins and vitest only. **`scripts/lanes.mjs` needs
`'tests/acceptance/532/'` in its `alone` list**: the files build cargo binaries, start Docker and Chrome, and criteria
5 and 6 read CPU times per frame and per step. This README is the instruction; the implementer makes that edit.

Gates: a missing host is `BLOCKED:` (a failed test, never a pass): no Docker or no linux/amd64 image names the `docker
pull` command; no Chrome names `CHROME_BIN`; an assembler that doesn't build names cargo's error. No test skips as
`INCONCLUSIVE`: the timing readings (criteria 5 and 6) are CPU times the logic module takes on its own threads (below),
which machine load doesn't stretch, and a measured violation fails.

`BASE-FAILURE.txt` is the run at the base (its first lines give the counts and why). Each test calls first what the
base lacks, so at the base it fails before its slow legs (the flock's big bake, Docker, Chrome) run. Criterion 1's bake
(1,200 steps, 20 restores, 1,020 straight probes, 1,000 seeks) is the suite's heaviest call: each `deep-logic` process
may take up to 60 minutes before it counts as timed out.

The harness was checked against real components before that run, at the base: every program assembles and the base
`deep-logic` admits and runs them (the flock 600 steps without a trap at 17,226 fuel a step; `hungry` 720,012 fuel at step 7 and 9 at the others; `secret` shows 0 until a Reveal and then 1; `idle`
1 fuel a step); the base's web runner in headless Chrome gives the flock's 600 step hashes and checkpoints exactly as
the base on this Mac does; `docker run --platform linux/amd64 rust:1.99.1-slim-bookworm uname -m` answers `x86_64`.
Not checked: the flock on a Linux x86_64 build (no build was made at the base), and `atlas` with an asset (the base
refuses assets).

## The surface under test

The issue names checkpoints, bakes with keys, goldens, two check kinds with their fields, data assets, a seek scheduled
across frames and planted twins, but no command line. As in #531's suite, the surface is `deep-logic`: **every call,
field and planted name below that the issue or the design doesn't give is this job's invention**, the smallest surface
the criteria need, extending #531's JSON-lines protocol (its README: deep-logic); the implementer builds exactly these,
or a dispute goes to a blind redraft. Calls and fields of #531's protocol not named here stay as that README defines
them. "In the app" is the logic module's own code through `deep-logic`; "the web player" is its web runner.

### `deep-logic`: what this suite adds

- **`--planted`** may be given more than once (`deep-logic --planted a --planted b`): each named twin applies. An
  unknown name still writes one `{"ok": false, "code": "bad_input"}` line and exits 2.
- **Piece** gains `"class"` (a budget class name; these tests use `"figure"`, 4 ms of frame CPU at 60 Hz), and a logic
  item's params gain `assets: [asset ID]` (Data assets, below), each asset's bytes in the piece's `assets` by sha256 as a
  program's are.

| Call | Reply |
|---|---|
| `{"call": "bake", …}` (#531's, plus `"seeks"?: [Seek]`) | #531's `Bake`, plus `"keys": {<logic ID>: 64 hex}` and `"seeks": [SeekResult]` (in the order asked) |
| `{"call": "determinism", …the fields of bake but restores, probes and seeks, "at_times": [s], "compare"?: "same_machine"}` | `{"ok": true, "kind": "logic.determinism", "verdict": "PASS" \| "FAIL" \| "BLOCKED", "failures": [DetFailure]}` |
| `{"call": "budget", …the fields of bake but restores, probes and seeks, "fuel_share"?: 0.5, "on"?: ["app"]}` | `{"ok": true, "kind": "logic.budget", "verdict": "PASS" \| "FAIL" \| "BLOCKED", "failures": [BudgetFailure], "report": BudgetReport}` |
| `{"call": "golden", …the fields of bake but restores, probes and seeks}` | `{"ok": true, "golden": Golden}`: a golden of this bake recorded on this host |
| `{"call": "golden_verify", …the same fields, "golden": Golden}` | `{"ok": true, "verdict": "PASS" \| "FAIL", "machines": "same" \| "different", "first_step": k \| null}` |
| `{"call": "view", "piece", "track"?: [Entry], "span": s}` | `{"ok": true, "session": string, "items": {<logic ID>: Checked}}` (or the check's refusal): a live view of the piece with no bake |
| `{"call": "frame", "session", "seek"?: s, "set"?: {"control", "value"}}` | `Frame`: one live frame |

```text
Seek       = {"to": s (a step), "probe"?: {"entries": [Entry], "steps": m}}
SeekResult = {"to": s, "from": c, "hashes": {<logic ID>: [16 hex]}, "checkpoint": {"step", "deep_hash": {<logic ID>: 16 hex}},
              "probe": {"hashes": {<logic ID>: [16 hex]}, "deep_hash": {<logic ID>: 16 hex}} | null}
DetFailure = {"item", "run": "twice" | "seek" | "probe" | "golden", "from": c | null, "at": s | null, "checkpoint": step | null,
              "step": k | null, "field": "deep_hash" | "step_hash" | "array", "array": "<logic ID>.<name>" | null, "control": control ID | null}
BudgetFailure = {"rule": "fuel_share" | "ceiling" | "frame" | "fixed_cost", "item"?: logic ID, "step"?: k, "host"?: "app" | "web",
              "items"?: n, "per_item_ns"?: number}
BudgetReport = {"items": {<logic ID>: {"step": the busiest step, "fuel": its fuel, "share": fuel ÷ the item's fuel budget}},
              "fixed": {<host>: {"at": {"1": ns, "100": ns, "1000": ns}, "per_item_ns": ns}}}
Golden     = {"bake_key": {<logic ID>: 64 hex}, "runtime_digest", "machine": {"os", "arch", "cpu"}, "step_hashes": {<logic ID>: [16 hex]},
              "checkpoint_hashes": {<logic ID>: [Checkpoint]}, "record_on", "verify_on": [target]}
Frame      = {"ok": true, "frame": n, "t": flick, "want": steps, "at": steps, "stale": bool, "steps": n, "eval_ns": ns, "ui_ns": ns,
              "deep_hash": {<logic ID>: 16 hex}, "stamped": Entry | null, "fork_at": flick | null}
```

What each field means:

- **Bake keys.** `keys` holds each item's bake key (Logic: checkpoints and bake): sha256 of the rewritten program, the
  logic item, its reads' content keys, the input track, recorded readings, the seed, the logic module's version and the
  engine's version, and the hashes of the data assets it names. The same inputs give the same key on every host (the
  key holds no target triple: Golden).
- **Seeks.** A seek to step s restores the item's checkpoint nearest at or before s (`from`) into a fresh instance,
  steps to s, then plays on through the first checkpoint after s (step > s). `hashes` are the step hashes of steps s to
  that checkpoint's step − 1; `checkpoint` is that checkpoint, with each item's full-state hash there. With a `probe`,
  the state at s is also fed the probe's entries (replacing the track's entries at or after s, as #531's probes do) and
  run m steps: `probe.hashes` are those steps' hashes and `probe.deep_hash` the state's full-state hash after them.
- **logic.determinism** (Check input: logic kinds). Sampled times are seconds; time t is step ⌊t × step_rate⌋ (1.5 s is
  step 90). Runs: `twice`, the bake from step 0 a second time; `seek`, for each sampled step s and each checkpoint c
  before it, a run that restores c (the seek) and plays on at least through the first checkpoint after s, comparing
  every checkpoint after c by full-state hash and every step from c by step hash and arrays; `probe`, at each sampled
  step s, from the straight state and from each seek's state there, one probe per control the item reads (a seeded
  entry of that control at step s, then 60 steps), comparing arrays at each step and the full-state hash after.
  Each run that disagrees gives one failure: `from` the checkpoint it restored (null for `twice` and the straight probe
  state), `at` the sampled step, `checkpoint` the first checkpoint after `from` whose full-state hash differs (null when
  none does), `step` the first step whose step hash or arrays differ (null when none does), `field` the first kind of
  difference in the order deep_hash, step_hash, array, `array` the first array that differs (a probe names it when one
  does), and `control` the probe's control. A run's own restored state at c is the checkpoint it loaded and isn't
  compared again. PASS only with no failure; `compare` other than `same_machine` isn't used here.
- **logic.budget** (Check input: logic kinds). It bakes the piece and reads its fuel per step, memory and stack, and
  its hosts' fixed costs. `fuel_share`: a failure `{rule: "fuel_share", item, step}` for each item whose busiest step
  used more than `fuel_share` of its fuel budget, naming that step. `fixed_cost`: the report's `fixed` gives each host
  in `on` its fixed cost of a step apart from fuel (entering the program, filling its read region, copying its writes
  out), measured by the logic module with an empty step at 1, 100 and 1,000 items (`at`, each the measured CPU time of
  one step of that many items) and `per_item_ns`, the cost of one item's step from them; the piece's summed fixed cost
  on a host is its item count × `per_item_ns`, and when that passes the class's frame CPU (figure: 4,000,000 ns) the
  check fails with `{rule: "fixed_cost", host, items: the item count, per_item_ns}`. The step ceiling and frame-time
  rules (Logic: work across steps) give `ceiling` and `frame` failures, which these tests don't provoke. `share` in the
  report is the busiest step's fuel ÷ the item's fuel budget.
- **Goldens.** `golden` records the bake's golden (Golden, as a physics golden; Logic: checkpoints and bake):
  `bake_key` the items' bake keys, `machine` this host's `os` and `arch` as `about` names them, `step_hashes` every
  step's hash per item, `checkpoint_hashes` every checkpoint's full-state hash. `golden_verify` replays the same bake on
  this host and passes only when the bake keys match and every step hash and checkpoint hash equals the golden's;
  `first_step` is the first step whose hash differs (null on a pass); `machines` is `"different"` when this host's CPU
  architecture differs from the recording machine's, else `"same"`.
- **Views and frames** (Carried state, Render worker, Input track). `view` opens a live view of the piece at time 0 on
  its input track, with no bake (only the start function and `init` have run), for a span of `span` seconds, in the
  piece's budget class. Each `frame` call runs one live frame and answers when it ends: the UI thread latches the
  frame's input (`seek` moves the paused playhead to that time; `set` is a change of that control at the playhead, which
  the input module stamps at the first step at or after the playhead plus the input lead (one step while silent), or
  the first step not yet run, whichever is later, and which forks the track when later entries exist: those are dropped
  and `fork_at` records the stamp's flick); the render worker's simulate phase runs the steps the frame needs within the
  class's worker CPU; the UI thread composes what the view shows. A newer seek cancels the steps an older one still
  needed and keeps every checkpoint taken. Fields: `frame` the frame's number from 1 in its session; `t` the playhead;
  `want` the steps the frame at t needs, ⌊t ÷ step⌋ + 1 (the 2 s frame needs steps 0 to 120: 121); `at` the steps the
  shown state has run (the last stepped state: the state after step `at` − 1); `stale` true while `at` ≠ `want`;
  `steps` the steps this frame's simulate phase ran; `eval_ns` that phase's CPU time on the render worker's thread this
  frame; `ui_ns` the UI thread's CPU time this frame; `deep_hash` each item's full-state hash of the shown state;
  `stamped` the entry a `set` put on the track (null otherwise); `fork_at` the track's fork flick, once it forked.

### Data assets

A logic item's `assets` names data assets by sha256, in order; its program exports the immutable i32 global `assets_at`
(Logic `logic@1`). Before the start function runs, the logic module copies each asset into memory from `assets_at`,
in order, each as a little-endian u32 of its length followed by its bytes, packed with nothing between. A set whose
copies would pass the end of memory, or overlap the read or write region or an active data segment, is refused at
check: `{"ok": false, "code": "logic_refused", "item": logic ID, "refusals": [{"rule", "what", "asset": asset ID}]}`,
one refusal naming each asset that passes the end or overlaps (the first asset of the set that fits isn't named). The
copies are memory from then on: checkpoints and full-state hashes hold them, a restore copies nothing, and the bake key
covers the assets' hashes.

### Planted twins of `deep-logic` (`--planted <name>`)

Each is one criterion's wrong program, reachable only through this argument, and changes nothing else:

| Name | Criterion | The wrong program |
|---|---|---|
| `checkpoint_drops_globals` | 1 | a checkpoint holds the program's memory but not its globals; a restore leaves the fresh instance's globals at their initial values (the full-state hash a checkpoint reports while playing is unchanged) |
| `restore_keeps_regions_only` | 3 | a restore loads the checkpoint's globals and the bytes of the item's read and write regions and leaves the rest of memory zero (so `secret`'s private flag is zeroed) |
| `check_compares_step_hashes` | 3 | logic.determinism compares only the step hashes of its runs from step 0 and from each checkpoint: no full-state hash, no array, no continuation probe |
| `restore_copies_assets` | 4 | after a restore loads a checkpoint, the logic module copies the item's assets into memory from `assets_at` again |
| `simulate_runs_all_steps` | 5 | the simulate phase runs every step a frame needs in that frame, whatever its CPU time |
| `budget_sums_fuel_only` | 6 | logic.budget's verdict sums only fuel: it never fails on the fixed cost of a step (its report is unchanged) |

Criterion 3's last clause runs two twins in one process: `--planted restore_keeps_regions_only --planted
check_compares_step_hashes`.

## Programs

`programs.ts` holds the logic programs as WebAssembly text; each comment says what it does and the item it's built for.
Those that read or write region entries are built against the item's layout as `check` reports it, read first with
`layout_probe`. `flock` (100 boids: the wind's last entry into the mutable global `$wind`, a xorshift64 jitter on the
mutable global `$rng` seeded by `init`, positions and velocities in memory, positions copied into the write region),
`hungry` (90,000 iterations of an eight-instruction loop at step 7), `secret` (a private flag at byte 8192), `atlas`
(FNV-1a of its first asset in the start function and at step 0, then one byte of the asset's copy changed each step;
four pages of memory, `assets_at` 65,536 unless a test moves it), `idle` (an empty step). `flock.ts` builds the flock's
piece and its seeded wind tracks.

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s: the first 8 hex digits of the SHA-256 of each criterion's text, trimmed, white
space collapsed. Each test's name starts with its criterion's ID. Hosts: this Mac (macOS arm64) for every test; criterion
2's second test also needs Docker with the linux/amd64 image, its third headless Chrome.

| ID | File (tests) | What it asserts, and the wrong program each fails on |
|---|---|---|
| 1 `#532.9d44e928` | `ac01-flock-determinism.test.ts` (2) | 1,200 steps on a seeded wind track, baked in two processes: every step hash, position, checkpoint, restore, probe and seek equal; each checkpoint below the last restored and run 120 steps gives playing's full-state hashes, step hashes, positions and continuation probe (a wind entry at c + 3, 60 steps); 1,000 seeks to seeded steps in a seeded order give playing's step hashes up to the first checkpoint after the seek, that checkpoint's full-state hash and a 5-step probe; logic.determinism at 2.5, 7.25 and 12.75 s passes with no failure. `checkpoint_drops_globals`: playing is unchanged, every seek fails on the full-state hash of the first checkpoint after it, and logic.determinism fails, each full-state failure naming the first checkpoint after its seek and the first step whose step hash differs (as the planted bake's restore from that checkpoint shows it). Fails: a checkpoint or restore without globals or memory, a seek from the wrong checkpoint, a check that names no checkpoint or step |
| 2 `#532.635473e1` | `ac02-budget-golden.test.ts` (3) | `hungry` (step 7 > 500,000 of 1,000,000 fuel in the bake, the rest under) fails logic.budget with one fuel_share failure naming step 7; the flock passes with no failure. The flock's golden of 600 steps recorded on this Mac holds its step hashes and names its arch; on Linux x86_64 (`about` arch `x86_64`) the bake gives the golden's bake key, step hashes and checkpoint hashes step for step, `golden_verify` passes with `machines` `different`, and a copy of the golden with step 37's hash changed fails at step 37; Chrome's bake of `web_plan`'s request gives the golden's step hashes and checkpoint hashes step for step. Fails: a budget with no share rule or one naming another step, a golden whose verdict doesn't read it, a host or engine whose hashes or key differ |
| 3 `#532.09272844` | `ac03-private-flag.test.ts` (3) | `secret`, A at step 30 of 240, no Reveal: `shown` stays 0 and logic.determinism at 1.5 s passes. `restore_keeps_regions_only`: restores from 0, 60, 120 and 180 keep every step hash and array of playing, the restore from 60 differs at checkpoint 120 by full-state hash; logic.determinism fails with exactly one seek failure, from 60 at checkpoint 120 on the full-state hash, a failing Reveal probe naming `flag.shown`, and no failing A probe. With `check_compares_step_hashes` as well, logic.determinism passes with no failure. Fails: a check that compares step hashes alone, a probe that names no array, a deep hash that misses memory |
| 4 `#532.fb0103f2` | `ac04-assets.test.ts` (4) | `atlas` with a 64 KiB seeded asset: every step shows the start function's and step 0's FNV-1a of the asset (the test's own) and its length 65,536; restores from each checkpoint give the straight run's full-state hashes, step hashes and arrays; logic.determinism passes. Check admits the asset at 65,536 and refuses (`logic_refused`, item `atlas`) two assets from 131,072 (the second passes the end of 262,144 bytes), naming only the second, and one asset at 4,000 (over the write region at 4,096), naming it. The same piece twice gives one bake key and another asset another. `restore_copies_assets`: the restore from 60 differs at checkpoint 120, and logic.determinism fails with exactly one seek failure, from 60 at checkpoint 120 on the full-state hash. Fails: assets copied after the start function or not at all, a refusal that names no asset, a key without the assets' hashes, a restore that copies them again |
| 5 `#532.67c825d1` | `ac05-seek-frames.test.ts` (3) | a view of the flock with a 60 s span (wind entries at steps 30, 300, 1,200, 2,400): a seek to 2 s lands at 121 steps; a wind change there is stamped at step 121 and forks the track there; a seek to 50 s then runs exactly 2,880 steps before its frame lands at 3,001; every frame's `eval_ns` ≤ 4 ms and `ui_ns` < 2 ms; each frame before it lands is stale and shows its last stepped state; the landed state's full-state hash equals a straight bake of the forked track after step 3,000. A second session: once a frame shows more than 601 steps and is stale, a seek to 10 s lands at 601 after at most 60 steps. `simulate_runs_all_steps`: one frame runs 2,880 steps past 4 ms, and the criterion fails naming that frame. Fails: a catch-up in one frame, steps on the UI thread, a view that shows nothing stale, a seek that ignores checkpoints taken while catching up |
| 6 `#532.de739d63` | `ac06-fixed-cost.test.ts` (2) | logic.budget on [app] of 1,000 `idle` items in a figure-class piece, then 2,000, 4,000, … (to at most 128,000) until N × the report's `per_item_ns` passes 4,000,000 ns: at each N every item's busiest share is 0, the report has `at` for 1, 100 and 1,000 items and a positive `per_item_ns`; below 4 ms no fixed_cost failure; at the last N the verdict is FAIL with a fixed_cost failure naming N and that `per_item_ns`. `budget_sums_fuel_only` reaches an N past 4 ms and passes it, and the criterion fails at that N. Fails: a budget that counts only fuel, a report without the fixed cost |

Test count: 2 + 3 + 3 + 4 + 3 + 2 = 17.

## Readings where the issue leaves a choice

- **The surface.** `deep-logic` again, because the criteria need Linux x86_64, the web runner, planted twins and a
  live view a test drives frame by frame; deep-show's documents and check runner aren't driven. The check kinds are
  calls of the logic module (the core's check registry, #403, isn't asked by any criterion).
- **"Identical … run twice, replayed from each checkpoint, and at 1,000 seeks in random order against playing"**:
  two bakes in two processes; restores from every checkpoint below the last; 1,000 seeks to seeded steps in seeded
  order, each compared at the first checkpoint after it, by its step hashes up to there and a short probe.
- **"The first checkpoint after the seek"**: the first checkpoint whose step is greater than the step the seek
  restored (for logic.determinism's runs, which restore a checkpoint) or reached (for a bake's seeks). The tests'
  sampled times sit between checkpoints, so both readings name the same checkpoint.
- **"Naming that checkpoint and the first step that differs"**: logic.determinism's failure names them; the expected
  step is the first one whose step hash differs in the planted bake's own restore from the same checkpoint.
- **"The continuation probe that presses Reveal"**: logic.determinism's probe for the control `reveal`; `secret`
  treats any entry of a control in a step as a press, so a seeded value presses it.
- **"Matches on Linux x86_64 and in the web player step for step"**: on Linux, `golden_verify` and the bake's step and
  checkpoint hashes; in the web player, the web runner's bake of the app's request against the golden (the browser
  verifies no golden itself).
- **"A wind-slider change there that forks the track … needs 2,880 steps"**: the change is made at the landed 2 s
  frame and stamped by the Input track rule at step 121, so the 50 s frame needs steps 121 to 3,000: 2,880.
- **"The UI thread" and "the render worker's 4 ms of CPU"**: CPU times of the logic module's own threads, as each
  frame reports them (`ui_ns`, `eval_ns`); "under 2 ms" is `ui_ns` < 2,000,000 and "passes 4 ms" `eval_ns` >
  4,000,000.
- **"Lands within one checkpoint spacing of steps"**: the steps the frames run from the 10 s seek until its frame
  lands are at most `checkpoint.every` (60).
- **"Every step's fuel share is 0"**: each item's busiest step's `share` in the report is 0 (so every step's is). The
  base's rewrite charges an empty step 1 fuel unit (0.0001% of its budget); how the module reaches a share of 0 (no
  charge for an empty body, or a share stated at a precision where that is 0) is the implementer's.
- **"On the reference Mac"**: this Mac, as the app's host `app`; "their summed fixed cost" is the item count × the
  report's `per_item_ns`.
- **"Fails, naming …"** for a twin: either the check's own failure names it (criteria 1, 3, 4), or the test's judgement
  of the twin's output fails and its message names the frame or the item count (criteria 5, 6).

## Not tested, because no criterion reaches it here

The checkpoint ring's byte budget and its spacing doubling; whole checkpoints every eighth with written pages between
(no surface shows a checkpoint's bytes); baked playback that never runs the program; the bake's changed array ranges;
`logic.layout` and saves; `compare: cross_machine` and `web` as logic.determinism inputs; logic.budget's `web` host,
memory, stack, step ceiling and frame rules; `logic.trap` (#531's suite covers it); an asset over the read region or a
data segment; readings and `net.draws`.
