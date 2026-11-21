# Acceptance tests for #280: net.budget names the largest window each host fits, and net.feel measures stalls, rollback depth and how far other players jump

Written first, blind, from issue #280 (live: its Scope, its Fields, its nine acceptance criteria, its Proof line and its
Oracle line), the design sections it links and those they lean on, and the base commit `e575a47af` (main, "Merge pull
request #2953"), by a job that never saw an implementation. No other worktree, branch, pull request, stash or plan was
read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job
(design: Dogfooding).

Lean: one file per criterion, each test's name carrying its criterion's ID, and exactly the plants and planted twins
the criteria name. The Oracle line says no upstream test checks these criteria, so there is no Oracle lane.

## What was read

- The issue (`gh issue view 280 --repo windoliver/deepbuild`); for scope only, its parent #179, the epic #219, its
  dependencies #551, #172, #411 and #412, and #140 (the network seam, whose resend criterion 9 leans on).
- `node scripts/design-section.mjs --issue 280`: `docs/canvas-primitives.md` Check input: net kinds, Net: lockstep, Net:
  rollback, Frame budget; `docs/technical-design.md` Lockstep. Beside them: Check input (a document's own `checks`),
  Input track entries (a world's `launch`), and `docs/parallel-proof.md` §12a (budget windows, "in the local
  preflight").
- The suites `551/` (README, `helpers.ts`, `fixtures.ts`, `BASE-FAILURE.txt`, which this suite imports), `550/`
  (README, `helpers.ts`: deep_kinds, a claim's verdict, the merge base built apart), `549/` (`helpers.ts`: builds,
  `deep-show run`, a copy's report, Chrome's path), `548/` (a budgets.json task naming a criterion), `1958/` (a working
  agent's patch through `deep_show`, a stored document), `405/` (a document's own `checks`).
- At the base, only for surfaces: `crates/deep-net/` (`window.rs`: net.rollback's schedules and net.budget's runs,
  `worst`, `busiest` and its `windows` for app, web BLOCKED; `play.rs`: the test relay, `relay.deliver`, `drop`;
  `copy.rs` and `copy/rollback.rs`: waits, `rolled_back`, the resend from the lowest step its peers confirmed;
  `kind.rs` and `checks.rs`: net@1, the check kinds' runs), `crates/deep-show/src/net.rs` (`match`'s members),
  `crates/deep-play/src/net.rs` (deep_run's net kinds, `on`), `crates/deep-show/src/kinds.rs` (net@1's `check_kinds`),
  `crates/deep-show/gallery/net-rally.json`, `crates/deep-canvas-physics/src/doc.rs` (a body's `velocity`, `damping`),
  `crates/deep-logic/src/piece.rs` (fuel and memory defaults), `scripts/benchmark.mjs` (`validateBudgets`),
  `scripts/proof-change.mjs` (`criterionId`), `scripts/lanes.mjs`.

Code was read only to learn the surfaces. Every expected value comes from the issue, the design and `fixtures.ts`.

## What the base already does, and these tests don't credit

From the base's code, this job's runs there (`BASE-FAILURE.txt`) and scratch runs of the base's `deep-show` (not saved
as tests):

- **The eight-seat fixture is valid**: `deep show` presents it with no issue, and Node's own WebAssembly validates its
  program (34 pages; a step writes 33 of them: page 0 and the 32 grid pages).
- **#551's net.budget already reports `windows` for app**: on the eight-seat fixture at window 8 with `on: [app, web]`
  (and the scenario's `chrome`, which the base ignores), it read FAIL on this loaded machine, `windows: {app: 2}`, the
  web BLOCKED with its ask, in 826 s at a load of about 120 to 230. There is no `windows.web`, no `lockstep` and no
  failure `host`, and no window rule: criteria 1's and 2's first tests fail at the web's missing window, criterion 2's
  second at the missing `lockstep`, criterion 1's planted test at its planted name.
- **net.rollback with players 8 passes** on the eight-seat fixture, with its 9 schedules (criterion 7's second test ran
  it at the base for 38 minutes and failed only on net.feel after it, so no test credits it alone).
- **net.feel isn't there**: `match` with `check: "net.feel"` answers `{"code": "bad_input", "path": "check"}`; a claim's
  net.feel requirement reads BLOCKED, `{code: "module_missing", kind: "net.feel"}`; deep_kinds lists net@1's
  `check_kinds` as `["net.rollback", "net.desync", "net.budget"]` in `full`, and net@1 unavailable with
  `module_missing` and the same three names in `core`. The six planted names are refused (`{"ok": false, "code":
  "bad_input"}`). #551's test relay has its latency, `drop`, `back` and `deliver`, none of net.feel's profile.
- **A document's own `checks` may hold a net.feel**: the stored fixture with one loads and `read` shows it as given.
  The agent's `deep_show` of it with net.feel's bounds or profile changed is refused, but only with `not_your_layer`
  for each item, control and world; no issue names net.feel's field. A `set` patch op takes an item's `id` and reaches
  no envelope field (`ops/0/id` "required, and absent"), so the test writes the agent's change as its whole document.
- **`benchmarks/budgets.json`** holds no task naming `#280.60cc3f22`; the lane accepts it against the merge base's.

Every test fails at the base and none is a guard; `BASE-FAILURE.txt` is the run.

## Run them

Put Node 24 and the pinned Rust toolchain first on PATH. In a fresh worktree run `npm ci` and `npm run build
--workspaces` once (the lease runs through `packages/cli/dist`). Then run one file at a time, each under the machine's
lease:

```sh
export PATH="$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH"
npm ci && npm run build --workspaces      # once, in a fresh worktree
for f in ac1-windows ac2-web-window ac3-stall ac4-depth ac5-correction ac6-bounds ac7-tools ac8-budgets ac9-loss; do
  CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 NO_COLOR=1 sh scripts/lease \
    node node_modules/vitest/vitest.mjs run --root tests/acceptance/280 $f.test.ts --testTimeout=600000 --hookTimeout=180000
done
node node_modules/typescript/bin/tsc -p tests/acceptance/280/tsconfig.json   # type check
rm -rf tests/acceptance/280/node_modules                                      # vitest's cache after a --root run
```

Every `it` and every build hook passes its own timeout (#549's `TIMEOUT`, 5,400,000 ms), which `--testTimeout` doesn't
shorten. What each file builds, in `beforeAll` (#549's `useBuilds`: `cargo build --locked --bin deep-show
--no-default-features --features <set>`, the binary copied out of the target, so the files run one at a time), and
starts:

| File | Builds | Starts |
|---|---|---|
| `ac1-windows.test.ts` | `deep-show` (`full`) | `match` with net.budget six times on app and web (headless Chrome, through net.budget itself), then three times on app |
| `ac2-web-window.test.ts` | `deep-show` (`full`) | `match` with net.budget three times (headless Chrome twice), then once on #551's burning piece |
| `ac3-stall.test.ts` | `deep-show` (`full`) | `match` with net.feel, 3,600 steps of eight copies, three times |
| `ac4-depth.test.ts` | `deep-show` (`full`) | `match` with net.feel, 1,200 steps of eight copies, twice |
| `ac5-correction.test.ts` | `deep-show` (`full`) | `match` with net.feel, 3,600 steps of eight copies, twice |
| `ac6-bounds.test.ts` | `deep-show` (`full`) | `match` with net.feel six times; one run of a stored document and two of the agent's patches |
| `ac7-tools.test.ts` | `deep-show` (`full`, `core`) | `deep_kinds` pages in both builds; `match` with net.rollback (eight copies, nine schedules); a verdict |
| `ac8-budgets.test.ts` | `deep-show` (`full`), and on a reference Mac at rest the merge base's `deep-show` (`full`) | net.feel's 3,600-step run and net.budget's report, each timed; ten `deep show`s at 60 s, five on each build |
| `ac9-loss.test.ts` | `deep-show` (`full`) | `match` with net.feel, 3,600 steps of eight copies, four times |

- **Processes and hosts.** Every `deep-show` is stopped by its PID after its test (#549's helpers); net.budget's own
  headless Chrome is the implementation's to start and stop; temporary folders are deleted. `https://relay.test/280`
  is declared only by pieces that never join: `match` plays every copy in one process with no network.
- **The merge base** (criterion 8): #550's `baseBuild`: `git merge-base HEAD origin/main`, or HEAD's first parent
  where HEAD is the merge base, exported whole with `git archive` into `target/acceptance-550-base/<sha>/` (git-ignored)
  and built there with its own target folder. git runs with every `GIT_*` variable dropped; nothing but the archive's
  files is copied, never `.git`.
- **Imports.** Node built-ins, vitest, `../549/helpers.ts`, `../550/helpers.ts`, `../551/helpers.ts` and
  `../551/fixtures.ts` (read only), and `scripts/benchmark.mjs` (criterion 8's guard).

**Gates.** None is ever a pass. `BLOCKED:` when cargo can't run, or Chrome isn't at #549's path (`CHROME_BIN`) for
net.budget's web part. `INCONCLUSIVE:` for a timing reading (criteria 1, 2 and 8) off a reference Mac, at a 1-minute
load at or above the core count, or where net.budget's five runs don't decide; where a host reports window 16, so one
more can't be declared (criteria 1 and 2); and where the app's report doesn't allow the web's window + 1 (criterion 2's
app half). With the load at or under the cores, a live phase that didn't finish is a plain failure (#549's `gaveUp`).

## The lanes line

`scripts/lanes.mjs`, beside #551's:

```js
// #280's files each build deep-show (ac7 in two feature sets; ac8 also the merge base) and play matches of eight copies
// in process; ac1 and ac2 run net.budget's web part in headless Chrome, and ac8 times net.feel and net.budget itself.
alone.push('tests/acceptance/280/');
timed.push('tests/acceptance/280/ac8-budgets.test.ts');
```

Criteria 1 and 2 read times through net.budget's own runs and so aren't `timed`; criterion 8 times runs on its own
clock, so its file is. No file is by hand.

## Criteria to tests

IDs are `#280.` and the first 8 hex digits of the SHA-256 of each criterion's text, trimmed, white space collapsed
(`criterionId` in `scripts/proof-change.mjs`), computed from the live issue. Each test's name starts `AC<n> #280.<h8>`;
each file quotes its criterion in full and names the wrong programs it fails.

| AC | ID | File (tests) | Surface | What it asserts | Plants and twins |
|---|---|---|---|---|---|
| 1 | `#280.5334836f` | `ac1-windows.test.ts` (2) | `match`, `check: "net.budget"`, `on`, `chrome` | The eight-seat fixture's report gives `windows.app` and `windows.web`, each 0 to 16; each, declared and measured on its host, passes (app: as net.budget's five runs give it); one more fails, a failure naming the host and the costliest module of the report's worst frame. The planted report's `windows.app` is larger than the honest report's; declared, it fails net.budget, a failure naming host app | `net_budget_window_without_checkpoints` |
| 2 | `#280.c693445e` | `ac2-web-window.test.ts` (2) | `match`, `check: "net.budget"`, `on`, `chrome` | The web's window + 1 with `on: [app, web]`: FAIL, a failure `{host: "web", declared, reported}` with that run's web window; where the app's report allows it, with `on: [app]`: PASS. #551's 2.4 ms piece: `windows.app` 0 and `lockstep` naming app | #551's burning piece |
| 3 | `#280.f6f631ae` | `ac3-stall.test.ts` (3) | `match`, `check: "net.feel"`, `feel` | 40 ms, 10 ms jitter, no spikes: every copy's `stall_ms_per_min` 0. No jitter, spikes on player 1 at 5, 15, …, 55 s: copies 2 to 8 read 740 within 100 (one step length a spike). The planted meter: copies 2 to 8 read 1,740 within 100, and the judge fails naming a copy | `net_feel_stall_whole_delay` |
| 4 | `#280.3cddbab4` | `ac4-depth.test.ts` (2) | `match`, `check: "net.feel"`, a copy's `rolled_back` | 80 ms, no jitter, every player's entry changing every step, 1,200 steps: every copy's `depth.p50` and `depth.p99` within one of 3, every rollback's `from − to + 1` within one of 3, at least 600 rollbacks a copy. The planted meter: every copy reads depth 0, and the judge fails naming a copy | `net_feel_depth_from_arrival` |
| 5 | `#280.b13fcc01` | `ac5-correction.test.ts` (2) | `match`, `check: "net.feel"`, `relay.late`, `rolled_back` | Movers at 10 m/s, player 2 reversing each second, its messages reaching copy 1 five steps late: copy 1's `correction.p99` 1.667 m within 1 cm; copy 1 rolled back exactly 60 times. The planted meter: copy 1's p99 1.5 m and p50 0.167 m, each within 1 cm, and the judge fails naming `items/mover_2` | `net_feel_correction_frame_to_frame` |
| 6 | `#280.456285f7` | `ac6-bounds.test.ts` (3) | `match`, `check: "net.feel"`; a stored document's `checks`, the agent's `deep_show`, `read` | Spikes: bound 500 FAIL with a failure `{copy (not 1), reading (stall), value (740 within 100)}`; bound 1,000 PASS with no failure. The working agent's `deep_show` of the document with `checks/0/bounds/stall`, then `checks/0/profile/spikes/hold`, changed: each refused, an error issue whose path names the field and that says it's net.feel's; the stored net.feel unchanged. Two runs of a seeded profile: byte-equal readings; the planted meter's two runs differ, the judge naming a copy's stall | `net_feel_wall_clock` |
| 7 | `#280.9c96115f` | `ac7-tools.test.ts` (2) | `deep_kinds`, `match` with net.rollback, a claim's verdict | `full`: net@1's `check_kinds` list `{kind: "net.feel", fields}` with `players`, `steps` (default 3,600), `profile`, `seed`, `items`, `bounds`; `core`: net.feel listed, unavailable with `module_missing`. net.rollback, eight copies: PASS, 8 schedules up to 8 and one exactly 8, some copy rolling back. net.feel as a requirement: the row PASS, `results` holding eight copies' readings | none (the base) |
| 8 | `#280.60cc3f22` | `ac8-budgets.test.ts` (2) | `benchmarks/budgets.json`, `validateBudgets`; `match`; `deep show` at 60 s in this build and the merge base's | Tasks naming `#280.60cc3f22`: node benchmarks, net.feel's run and net.budget's report with no limit, a piece without the net module; the lane accepts the file against the merge base's. On a reference Mac at rest: the readings in minutes; the piece without the net module, five runs a build: not all over the merge base's slowest by more than the margin (FAIL), all within it (PASS) | none (the base) |
| 9 | `#280.4335448f` | `ac9-loss.test.ts` (2) | `match`, `check: "net.feel"`, the relay's `dropped`, a copy's `record` | Lossy: the relay dropped some; every copy ran 3,600 steps with no end, confirmed as far as and holds by hash the lossless run's track; stall at least the lossless one's; a second lossy run's readings byte-equal. The planted resend: net.feel FAIL, a failure `{copy, step}`, that copy ended at its timeout having waited, the run returned | `net_resends_from_newest` |

Test count: 2 + 2 + 3 + 2 + 2 + 3 + 2 + 2 + 2 = 20.

## The surface under test

The issue names a report field, a check kind with its fields and readings, deep_kinds, deep_run, net.rollback with
players 8 and planted meters, but no call. As #549's to #551's suites do, everything in the app is driven through
`deep-show run` (#393: one JSON scenario on stdin, one answer line `{"ok": true, "replies": [...]}`), every match in
process through `match`. **Every call, member, field and name below is marked as the issue's or the design's own, an
earlier suite's, or this job's choice. The implementer builds exactly these, or a dispute goes to a blind redraft.**

### The scenario

#550's world (`helpers.ts`'s `scenario`: one agent's session `sess-280`, the process table with your shell's peer pid
3002, the documents on panels `main`, `side-1`, …, #383's clock), with:

| Key | What | Whose |
|---|---|---|
| `planted` | a planted name (Planted twins, below) | #549's key |
| `claims` | #403's claims: the agent's claim, its locked definition's requirements `{id, check}` | #403's |
| `docs.<id>.document` | a document the store holds and the hub opens at revision 0 | #1958's |
| **`chrome`** | the path of Google Chrome: net.budget's web part, with web in `on`, plays the piece in the web player in headless Chrome there (Check input: net kinds: "its web part runs in the web player in headless Chrome on the reference Mac"); without it the web part stays BLOCKED as #551 left it, so #551's criterion 9 still reads BLOCKED | this job's |

### `match` with net.budget

#551's call and members (`doc`, `steps`, `plays`, `check: "net.budget"`, `on`), with net.budget's report as #551's
(`verdict`, `failures`, `runs`, `frame_ms`, `worst: {modules, module}`, `busiest`, `blocked`) and:

| Field | What | Whose |
|---|---|---|
| `windows` | `{host → window}`: for each host in `on`, the largest window, 0 to 16, whose worst frame fits the class's frame CPU there | the Fields line's |
| **`lockstep`** | the hosts in `on` whose window is 0, where only lockstep fits | this job's |
| a failure's **`host`** | the host whose reading or rule failed: `app` or `web` | this job's |
| a failure's **`module`** | the canvas module that costs most | #551's |
| a failure's **`declared`**, **`reported`** | where the net item declares a window past the report's for a host in `on` (a piece declares at most the smallest window the report gives for the hosts it plays on): the declared window and that host's reported one, in this run | this job's |

With `on: ["web"]` alone the report is the web's: its verdict, `windows.web`, and failures naming host web. The test
holds the app's verdict to #551's five-run rule over `runs` (the app's), the web's to the check's verdict.

### `match` with net.feel

| Member | What | Whose |
|---|---|---|
| `check` | `"net.feel"`: plays net.feel's run and adds its report as `check` | the check kind the issue's; the value #549's member |
| **`feel`** | net.feel's check input but `steps`: `{players?, profile: {latency: [ms], jitter: ms, spikes?: {every: s, hold: ms, player?, first?}, loss?: {rate, seed}}, seed, items: [item path], bounds: {stall, depth_p99, correction_p99}}`; `steps` is `match`'s own | the fields the issue's; the member this job's |
| `plays` | each player's entries, as #549's | #549's |
| `relay.seed` | #549's | #549's |
| **`relay.late`** | `[{player, to, steps}]`: each of `player`'s messages, for match step k, reaches copy `to` once that copy has run step k + `steps`, and not before. A frame of that player's to that copy reaches it carrying only its messages that are due by then (a frame's messages run from its `first`, so the due ones are a prefix), the rest following in later frames as the repeat rule sends them; everything else keeps the profile's timing. (#551's `relay.deliver` holds whole frames, so a message repeated in a later frame reaches the copy earlier than its own `at`; criterion 5 needs every message exactly 5 steps late.) | this job's |

- **No spikes, no loss**: the profile leaves `spikes`, `loss` out. **No jitter**: `jitter: 0`.
- **An item path** is `items/<id>`, as `items/mover_2`.
- **net.feel's report** (`check`): `{kind: "net.feel", verdict, failures, readings}`. **`readings`**: one per copy,
  `{copy, stall_ms_per_min, depth: {p50, p99}, correction: {p50, p99}}` (the Fields line's readings, `copy` this job's:
  the copy's player). A copy with no rollback reads 0 depth and 0 correction. **A failure** names `copy`, `reading`
  (as `stall_ms_per_min`, `depth.p99`, `correction.p99`) and `value` (this job's field names for the issue's "the copy,
  the reading and the value"); criterion 9's failure at the deadline names `copy` and `step`.
- **The reply's `copies`** are net.feel's run's copies, each #551's copy report (`player`, `ran`, `end`, `waits`,
  `rolled_back`, `record` with `track` and `confirmed`), and `relay` is #549's relay report (`frames`, `dropped`).

### deep_kinds

#412's `deep_kinds` (`op: "list"`, `registry: "kind@1"`). net@1's entry keeps #550's `check_kinds` and lists net.feel
there as an object **`{kind: "net.feel", fields: [{name, default?}]}`** (this job's; #550's suite reads an object's
`kind`), its fields the Fields line's, `steps` defaulting to 3,600. In a build without the net module, net.feel is
still listed: either its own object carries `available: false` and `code: "module_missing"`, or, carrying neither, the
net@1 entry it's listed under does (#550's).

### deep_run

A claim's verdict (`{call: "verdict", claim}`), as #550's and #1939's suites read deep_run's checks: the requirement
`{kind: "net.feel", steps, …feel}` on the eight-seat fixture shown by the agent; its row's `result` and `results`, one
of which holds net.feel's `readings` (#551's net kinds put their report in `results`).

### The working agent's patch (criterion 6)

The eight-seat fixture stored (`docs.<id>.document`, revision 0) with one net.feel among its envelope's **`checks`**
(the document's own check inputs, as #405's suite reads them), its profile and bounds yours. The agent's patch is its
`deep_show` (from `sess-280`) of that document with one of net.feel's fields changed: `bounds.stall` to 100,000, then
`profile.spikes.hold` to 0 (at the base no patch op reaches a document's `checks`: `set` takes an item's `id`, so the
agent's write of the whole document is how its patch reaches them). Each is **refused**: `outcome: "refused"`, with an
error issue whose `path` (or `field`) names the field (`checks/0/bounds/stall`, `checks/0/profile/spikes/hold`) and
whose text says it's net.feel's; `read` then shows the stored net.feel as before. (The design: "Its profile, items and
bounds come from the brief or definition, never from the working agent".) The stored document's items, controls and
world are the store's, so the agent's write also draws `not_your_layer` for each of them, at the base as after; the test
reads only that, beside those, one issue names net.feel's field (a scratch run at the base found the same refusal with
the items moved into the agent's own layer: its controls and world still aren't the agent's).

### Planted twins

Each is one criterion's wrong program, reachable only through the scenario's `planted`, and changes nothing else.

| Name | Criterion | The wrong program |
|---|---|---|
| `net_budget_window_without_checkpoints` | 1 | net.budget's `windows` computed from one match step's cost without its checkpoints |
| `net_feel_stall_whole_delay` | 3 | net.feel's stall meter counts each stall as the held message's whole delay (hold plus latency) |
| `net_feel_depth_from_arrival` | 4 | net.feel's depth meter counts each rollback's depth from the step the late message arrived on |
| `net_feel_correction_frame_to_frame` | 5 | net.feel's correction meter measures a named item's frame-to-frame move instead of its jump across the rollback |
| `net_feel_wall_clock` | 6 | net.feel times its stalls on the wall clock instead of the test relay's virtual clock |
| `net_resends_from_newest` | 9 | a copy's resend repeats its messages from its newest step instead of the lowest step its peers haven't confirmed |

The plant named by a criterion that isn't a program: criterion 2's burning piece (#551's).

## Fixtures

All made at test time in `fixtures.ts`; no personal data; CC0. **The eight-seat fixture is defined here, in
`fixtures.ts`**; the gallery's own eight-seat piece the Scope asks for beside `net-rally.json` is the implementer's, and
no test reads it.

- **The eight-seat fixture** (`eightDoc`): a 3D scene of 640 × 360 in the showpiece class (4 ms of frame CPU), seed
  280, span 70 s; a camera, a floor and eight mover marks drawn where the world puts them; the sliders `move1` …
  `move8` (−1 to 1 by 1), one a seat; the world `arena`, the logic item `field` and the net item `match` (8 players, 60
  Hz, delay 2, window 8, a hash every 60 steps, a timeout of 5 s).
- **`arena`** (physics.world@1, 120 Hz, 1 substep, no gravity, no damping): `mover_1` … `mover_8`, 0.5 m spheres free
  along x only, each in its own lane 3 m apart, so none touches another. Seat n's `move<n>` entry launches its mover at
  10 m/s × the entry's value along x (`launch {linear}`), so its velocity is its last entry's. Its outputs put each
  mover's pose at `items/mover_<n>/at`. **The moving form** (criterion 5) starts every mover at 10 m/s.
- **`field`** (`fieldProgram`): WebAssembly written as bytes, 34 pages, no import, its starting values an active data
  segment. Each step it folds every move entry into its tally; moves each of its 100 projectiles in 8 sub-steps,
  testing each sub-step's move against each of 64 boxes (a slab test); and stamps its 128 × 128 grid (cells of 128 B,
  2 MiB) 3 times, each stamp a pass over every cell, so all 32 grid pages are written every step (a rollback ring's
  checkpoint of it copies 2 MiB). It writes `hits` and `tally`, and spends about 3 million fuel a step (its `budget.fuel`
  is the logic budget's most, 10 million). Node's WebAssembly validates it and steps it in about 0.14 ms on this
  machine (a scratch run).
- **The piece without the net module** (criterion 8): the same, with no net item and no `net` in `requires.modules`.
- **Entries**: `seededMoves` (each player moves its own mover every 20 to 79 steps, by a fixed seed), `everyStep`
  (criterion 4: each player's entry flips its mover every step), `reversals` (criterion 5: player 2 at steps 30, 90, …,
  3,570, −1 then 1, …, no one else).
- **Profiles and bounds** (`QUIET`, `SPIKED`, `FIXED_80`, `ON_TIME`, `LOSSLESS`, `LOSSY`, `SEEDED`; `OPEN` bounds that
  hold nothing to anything: a minute of stall, depth 16, 1 km) and the criteria's numbers (`SPIKED_STALL` 740,
  `WHOLE_DELAY_STALL` 1,740, `DEPTH` 3, `CORRECTION` 1.667, `FRAME_TO_FRAME_P99` 1.5 and `_P50` 0.167).

## Readings where the issue and the design leave a choice

- **"Within one step length per spike"** (criteria 3, 6): 6 × 16.67 ms = 100 ms around 740 (and around 1,740 for the
  planted meter). **"Every other copy"**: copies 2 to 8, which wait on player 1's held messages; copy 1 isn't read.
- **"Fails, naming the copy / the item / the reading"** for a planted meter (criteria 3, 4, 5, 6): the criterion's own
  judge, the function that passes the honest run, fails on the planted run with a failure naming a copy (3, 4), the item
  `items/mover_2` (5), or a copy's stall reading (6), as #551's planted twins are judged.
- **"Each rollback's depth"** (criterion 4): both net.feel's depth readings (p50, p99) and every rollback in each copy's
  `rolled_back`, `from − to + 1` as #551 defines a depth. 1,200 steps: every message brings an entry.
- **"The test relay delivering each of player 2's messages to copy 1 once copy 1 has run 5 steps past that message's
  step"** (criterion 5): `relay.late: [{player: 2, to: 1, steps: 5}]`.
  **"60 rollbacks, one per reversal"**: copy 1's `rolled_back` holds exactly 60, so a message that brings nothing new
  rolls nothing back. **"Reverses on its player's input"**: the moving form's mover takes its player's value, which the
  script alternates.
- **"Two runs from one seed"** (criteria 6, 9): two `deep-show run`s, each a fresh process. Criterion 6's runs use a
  profile with seeded jitter and seeded spikes, so the seed decides them.
- **"A net.feel whose profile or bounds a working agent's patch changed"** (criterion 6): net.feel as one of the
  document's own `checks`, and the agent's patch to it (The working agent's patch, above).
- **"Ends with every copy's input track equal by hash to the lossless run's"** (criterion 9): each copy's record, its
  merged track's lines hashed, with all 3,600 steps run and the same `confirmed`. **"The run fails at its deadline …
  never hanging"**: net.feel's FAIL with `{copy, step}`, the named copy's match ended `timeout` after a wait, and the
  `deep-show run` returned.
- **"Declaring one more fails it"** (criterion 1): net.budget's verdict FAIL, by its frame time or by its window rule,
  with a failure naming the host and the costliest module. **"Passes net.budget there"**: on that host alone.
- **"A report of 0 names lockstep"** (criterion 2): `lockstep` lists the host. The piece is #551's burning piece at
  about 2.4 ms a step, whose live step and one step again can't fit 4 ms.
- **"Recorded as readings in minutes … compared with the merge base"** (criterion 8): the budget window's (§12a), so
  tasks of `benchmarks/budgets.json` name the criterion; net.feel's and net.budget's carry no limit (a reading). A task
  that measures **a piece without the net module** says so in its id or `initialReason` ("without the net module").
  The test also takes the readings here and compares the piece without the net module, shown at 60 s, with the merge
  base's build.

## Not tested, because no criterion reaches it here

The docs' paragraph on how an action game chooses (Scope: docs; the Proof line's "the window and lockstep choices the
docs describe" is a docs review, not a test); the gallery's eight-seat piece (above); net.budget's report on the
paddle piece (the Proof line names it; no criterion does); net.feel's `players` other than the net item's; `spikes`
without `player` and `first` beyond criterion 6's repeat; correction for more than one item. They are follow-ups for
the implementer's own tests.

## What the implementer adds outside this folder

- The lanes lines above (this job wrote them).
- In the net module, deep-play and `deep-show`: net.budget's `windows` for web through headless Chrome (`chrome`), its
  `lockstep`, its failures' `host`, `declared` and `reported`, and its window rule; the net.feel check kind (`match`'s
  `check: "net.feel"` and `feel`; deep_run; deep_kinds' listing); the test relay's latency, jitter, spikes and loss on
  its virtual clock, with the resend; the refusal of an agent's patch to net.feel's profile, items or bounds; the six
  planted names; `benchmarks/budgets.json` tasks naming `#280.60cc3f22`.
