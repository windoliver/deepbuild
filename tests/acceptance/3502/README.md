# Acceptance tests for #3502: the GPUI pin moves to a current release

A blind job wrote these tests before any work on #3502 existed. The implementing agent doesn't edit them (AGENTS.md,
Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

## What was read

- **The issue**, #3502, as saved on November 26, 2026 (open, no comments): its opening paragraph and five findings,
  `Runs on:`, the Scope's six lines, the nine criteria and Proof. The issues it names, each with its comments: #241
  (its epic), #1426, #3441, #1609, #1433 and #711 (beside it), and #1551, #1550 and #1652 (cited by its text and
  criteria).
- **The design.** `docs/technical-design.md`: Decided (The app's toolkit, The canvas's GPU layer, The reference
  window, Where agents drive the app); Numbers version 0 has to hold (Every task carries its own budgets, The reference
  Macs); How we know version 0 works (the quiet check, Criteria to tests, Closed issues stay proven, Criteria in a
  checked shape, Wrong programs, The edit guard); Dogfooding; Built to be hard to get wrong (Tests written first, Repo
  guards); Replica. `docs/canvas-primitives.md`: GPU surface; Frame clock and scheduler. `docs/parallel-proof.md`:
  sections 5 to 7 and 12a. `AGENTS.md` and `CONTRIBUTING.md`.
- **The base commit** `2edb19ff4` (origin/main; its last merge is #3561), for names, shapes and conventions:
  `vendor/gpui-pre-apple/upstream/README.md`, `scripts/vendor-rebase.mjs`, `.cargo/config.toml`, `Cargo.lock`, the
  crates' manifests, `vendor/gpui-pre/src/window.rs` and `platform.rs` (the request-frame closure and the caps),
  `vendor/gpui-pre-macos/src/system_notifications.rs`, `crates/deep-app/src/main.rs` (the notifier's withdrawals),
  `crates/deep-show/src/watch.rs` and `idle.rs` (`deep-show live`), `crates/deep-replica` (`deep-drive`, `launch`,
  `screenshot`), `crates/deep-canvas-marks/looks/clean.json`, `benchmarks/budgets.json`, `scripts/benchmark.mjs`
  (`judgeLimit`, `fingerprint`, `validateBudgets`), `scripts/lanes-lists.mjs`, `scripts/proof-change.mjs`,
  `scripts/wait-ratchet.mjs`, and the suites `1426`, `1551`, `1550`, `140/view`, `124`, `1458`, `3440` and `3467` for
  their surfaces and conventions.
- **The registry's releases** of `gpui-pre`, `gpui-pre-apple` and `gpui-pre-macos`, 0.3.9 to 0.3.14, as
  `scripts/vendor-rebase.mjs` caches them, and a note of which gpui-kit commit asks for which release.

Nothing of #3502 exists at the base: the trees are 0.3.9, the table has no retired rows, the trial's record is
November 6's, `deep-show live` has no `withdrawals` wake, no `drawable_wait_ns` and no `window.focused`, no task names
the budget criterion and `docs/evidence/3502/` isn't there. `BASE-FAILURE.txt` holds what was run at the base, each
test's result there, and what the base's built `deep-show` and `deep-drive` answered to this suite's scenarios.

## How to run

Node 24, `npm ci` done, cargo and rustc on `PATH`; from the repo root, one file at a time. Every file is a
`node --test` file, as #1426's are.

| File | Criteria | Needs | Takes |
|---|---|---|---|
| `node --test tests/acceptance/3502/pin.test.mjs` | AC1 | the packages built (`npm run build --workspaces`), since the lint lists each row's suite; each pinned release, from the network once | a minute |
| `node --test tests/acceptance/3502/build.test.mjs` | AC1 | cargo, a Mac with the Metal compiler | the workspace's build: minutes warm, over an hour cold |
| `node --test tests/acceptance/3502/rows.test.mjs` | AC1, AC2 | what each row's suite needs: a Mac with a display, its screen on and unlocked, cargo, the packages built; by a person | hours |
| `node --test tests/acceptance/3502/rows-planted.test.mjs` | AC1, AC2 | git | seconds |
| `node --test tests/acceptance/3502/pictures.test.mjs` | AC3 | macOS; `deep-drive` (built here, or `DEEP_BIN_DIR`); `DEEP_3502_BASE_DRIVE` | two minutes |
| `node --test tests/acceptance/3502/still.test.mjs` | AC4 | a Mac with a display, the window left uncovered; `deep-show` (built here, or `DEEP_BIN_DIR`) | under three minutes: two still minutes |
| `node --test tests/acceptance/3502/cap.test.mjs` | AC5 | rustc; the pinned `gpui-pre` release in the cache | seconds |
| `node --test tests/acceptance/3502/withdrawals.test.mjs` | AC6 | a Mac with a display; clang; `deep-show` debug (and release, on a reference Mac); `DEEP_3502_BASE_SHOW` | a minute, and two more for the merge base |
| `node --test tests/acceptance/3502/animation.test.mjs` | AC7 | a reference Mac at rest, its screen on, the window left in front; a release `deep-show`, built here | two minutes after the build |
| `node --test tests/acceptance/3502/budgets.test.mjs` | AC8 | git | a second |
| `node --test tests/acceptance/3502/trial.test.mjs` | AC9 | nothing | a second |

- **Binaries.** A file that drives a debug binary reads it from `DEEP_BIN_DIR` when a proof run sets it, and otherwise
  builds it itself with `cargo build --locked --bin deep-show` (or `--bin deep-drive`), `CARGO_INCREMENTAL` and
  `CARGO_PROFILE_DEV_DEBUG` at 0 unless the environment sets them, and runs `target/debug/<name>`. The two files that
  judge a time build `cargo build --locked --release --bin deep-show` and run `target/release/deep-show`.
  `build.test.mjs` runs `cargo build --workspace --locked`.
- **Two small builds of the suite's own**, each in a temporary folder: `cap.test.mjs` builds one Rust file with
  `rustc`, and `withdrawals.test.mjs` builds `planted-center.m` with `clang`.
- **Folders and processes.** Every temporary folder is `deep-3502-*` under the OS's temporary folder and is removed
  when the file's process ends. Every process is run to its end by `spawnSync`, whose own timeout stops only that
  child. No test waits on a time: each reads an answer, a file or an exit.
- **Lanes.** `lane.json` keeps the folder alone: its files show the app's window. The lines the implementer adds to
  `scripts/lanes-lists.mjs` are under "What the implementer adds outside this folder".

## BLOCKED and INCONCLUSIVE, never PASS

A test that can't run or can't decide fails with the design's word as its message's first word.

- `BLOCKED`: a binary that isn't built or doesn't build; no pinned release on this machine; `DEEP_3502_BASE_DRIVE` or
  `DEEP_3502_BASE_SHOW` unset; a platform other than macOS for the replica; the planted center not built, not loaded
  or never reached; the cap's rule in a shape this suite can't read; the merge base unreadable by git.
- `INCONCLUSIVE`: no window can be shown here (`no_display`); the window was hidden, covered or on a sleeping display;
  for a time, a machine that isn't a reference Mac on mains power with Low Power Mode off, a nominal thermal state and
  a one-minute load at or below its cores (`judgeLimit`'s rule), or a window that wasn't focused; five runs that
  neither all pass nor all fail.
- A count is judged on any Mac that shows the window: AC4's callbacks, and which thread made AC6's calls.

## The surface under test

Names marked **new** are this suite's choice where the issue and the design name none; the implementation provides
each exactly as written. Everything else is the base's, used as the base's suites use it.

### Every row's test (AC1, AC2)

Nothing new in the tree. `rows.mjs` runs the test a row's cell names as `scripts/vendor-rebase.mjs` runs one row's
test: a `.test.mjs` file under `node --test --test-name-pattern`, a `.rs` file under `cargo test -- --exact` in its
crate, anything else under `vitest run -t` with the JSON reporter (which needs the packages built, as the lint's
own listing does). Each file is run once for every test the run needs
from it. It prints `ROW <issue> <behavior>: PASS`, or `FAIL`, `BLOCKED` or `INCONCLUSIVE` with why, one line a row.

### One release (AC1)

Read from the tree, nothing new:

- `vendor/gpui-pre/Cargo.toml`, `vendor/gpui-pre-apple/Cargo.toml` and `vendor/gpui-pre-macos/Cargo.toml`: the
  `version` under `[package]`, as `scripts/vendor-rebase.mjs` reads a pin. The three are equal and 0.3.13 or later.
- `Cargo.lock`: one package named `gpui-pre`, one `gpui-pre-apple` and one `gpui-pre-macos`, each at that version with
  no `source` (resolved from its path); one `gpui-kit` and one `gpui-shell`, each from
  `git+https://github.com/longbridge/gpui-kit?rev=<commit>#<commit>`.
- The workspace's `Cargo.toml` and each `crates/*/Cargo.toml`: every line that asks for one of the three names that
  release (`gpui-pre-macos = "=<release>"`); every `git = "…gpui-kit"` is `https://github.com/longbridge/gpui-kit` at
  one `rev`, the one `.cargo/config.toml`'s `rquickjs` patch names and `Cargo.lock` holds; none holds a `[patch]` table.
- `.cargo/config.toml`: `gpui-pre = { path = "vendor/gpui-pre" }` and the same for the other two.
- `node scripts/vendor-rebase.mjs check` exits 0, prints no `FAIL` and no `BLOCKED` line, and prints
  `ROW <issue> <behavior>: …` for every row. `cargo build --workspace --locked` exits 0.

### The table's file: `vendor/gpui-pre-apple/upstream/README.md` (AC1, AC2, AC9)

- `## Carried patches`: the base's table, `Behavior | Issue | Files | Test | Budget | Removal`, read as the script
  reads it. A Test cell is `` `<path> › <name>` ``; a `${…}` in a name stands for the file's constant there.
- **New: `## Retired rows`.** One table, one row for each row this change removes:

  ```
  ## Retired rows

  | Behavior | Issue | Test | Upstream change |
  |---|---|---|---|
  | Line breaks by the Unicode rules | #1550 | `tests/acceptance/1550/redraft/wrap.test.ts › <the removed row's Test cell, as it was>` | zed-industries/zed#12345: breaks lines by ICU's segmenter, from 0.3.11 |
  ```

  `Issue` and `Test` are the removed row's cells as the merge base wrote them. `Upstream change` names the change that
  met its removal condition as `owner/repo#n`, `owner/repo@<commit>` or a link to the pull request or commit; words
  around it are free. `Behavior` says what was carried. The section may be absent while no row is removed. (The
  number in the example is made up.)
- **The Rebase trial**, `## Rebase trial`: #1426's shape, written again for this move:

  ```
  ## Rebase trial

  Tried: gpui-pre 0.3.9 -> 0.3.14, gpui-pre-apple 0.3.9 -> 0.3.14, gpui-pre-macos 0.3.9 -> 0.3.14, gpui-kit 0.8.0 -> 0.11.0
  Outcome: pin moved

  | Suite | Result |
  |---|---|
  | #377 | pass |
  | #1551 | pass |
  ```

  `Tried:` names, for each of the three trees and for gpui-kit, `<from> -> <to>` (or `→`), `<to>` what the tree holds
  (gpui-kit's as `Cargo.lock` names it). `Outcome:` is `pin moved` or `pin left`. A suite's result is `pass` or
  `fail: <what failed>`. The table lists #1426's five (`#377`, `#390`, `#391`, `#140`, `#358`) and the issue of every
  carried row that names a file under `vendor/gpui-pre`, `vendor/gpui-pre-apple` or `vendor/gpui-pre-macos`. (The
  versions in the example are examples: the tests read the tree.)

### The pictures: `deep-drive` (AC3)

The base's, as #124 and #1458 drive it: `deep-drive --out <dir>`, JSON lines in and out, `{"ready": true}` first.

- `{"call": "launch", "launch": {"from": "fixture", "fixture": "<path>", "center": "<page>", "theme": "light" |
  "dark", "size"?: [w, h]}}`, the record `docs/spikes/338/fixtures/needs-you.events.jsonl` of this checkout for both
  sides. The shipped pages are the centers its refusal of an unknown one lists (`… is one of [...]`); at the base
  `deepbuild/needs-you`, `deepbuild/home`, `deepbuild/session`, `deepbuild/welcome` and `deepbuild/agents`. The
  first-launch page, the center whose name ends `welcome`, is launched with `"setup": "unfinished"` as well: without
  it the replica draws the page behind it, and the picture would be Needs you's again. Every replica of a run gets
  the same empty home folder, so a page that reads its home draws the same for both sides.
- `{"call": "screenshot", "screenshot": {"target": "window"}}` answers `{"ok": true, "path": "<png>", …}`.
- **New: `docs/evidence/3502/pictures.json`**, only when a picture differs:

  ```json
  {"differing": [{"page": "deepbuild/needs-you", "window": "opening", "theme": "dark",
                  "cause": "the release rounds a glyph's origin to the device pixel"}]}
  ```

  `window` is `opening` or `reference`; `cause` is a sentence of three words or more.

### `deep-show live` (AC4, AC6, AC7)

The base's scenario and `live` object (#140's view README and #1551's), with three additions.

- AC4 uses #1551's surface as it is: `live: {"watch_from": "settled", "watch_ms": 60000}`, the answer's
  `request_frames` and `window.state`, and the scenario's `planted: "link_never_stops"`.
- **The withdrawals (AC6). New: the wake `withdrawals`**, beside #1551's four kinds:

  ```json
  "live": {"wake": [{"after_ms": 1000, "by": "withdrawals", "count": 20}]}
  ```

  `count` is required for this kind, a whole number above 0. At `after_ms` after the window settled the app
  withdraws `count` notifications in a row, in one turn of its UI thread, each by GPUI's
  `App::dismiss_system_notification` with a tag of its own, the call `crates/deep-app/src/main.rs` makes when an
  ask closes. Just before the first of them it tells a thread other than the main thread to post one input event into
  AppKit's event queue for the window (`NSApplication.postEvent:atStart:`, the event #1551's `input` posts); that
  thread posts it at once, whatever the main thread is doing. The answer's entry is an input's:

  ```json
  {"after_ms": 1000, "by": "withdrawals", "requested_ns": 71264869112083, "request_frames_before": 0,
   "frame_seq": 12, "presented_ns": 71264880412000, "refresh_ns": 8333333}
  ```

  `requested_ns` is the host's monotonic clock, in ns, when that thread posted the event: the input's arrival at the
  app. `frame_seq` and `presented_ns` are the first frame latched after the window's input callback received that
  event and its presented time, as #1551's `input` reports them; both `null` only when the run ends with none
  presented. The run doesn't end before that frame is presented, or 500 ms after the callback ran with none. The
  other fields are #1551's.
- **The animation (AC7). New: `drawable_wait_ns`**, in each entry of the answer's `frames`: how long that frame
  waited for its drawable, in ns: from the moment its draw asked for the drawable to the moment it had it, and 0 for
  a frame that was handed its drawable before its draw began.
- **New: `window.focused`** (AC7, the animation), beside #1551's `state` and `shown_ms`, in a run with `watch_ms`:
  `true` only when the window was the key window of the active app from its first presented frame to the watch's
  end.
- **New: `window` in a run watched from `first_frame`** (AC7): `state`, `shown_ms` and `focused` over that same
  span. The base answers `window` only for a run that settles, so its film run has none.

### The merge base (AC3, AC6)

Two variables, each carrying only a path. Without one, its test is BLOCKED.

- **New: `DEEP_3502_BASE_DRIVE`**, a variable that carries only a path: the `deep-drive` built at the merge base, as
  it is there, for example `git worktree add /tmp/base-3502 "$(git merge-base HEAD origin/main)"`, then
  `cargo build --locked --bin deep-drive` in it and `DEEP_3502_BASE_DRIVE=/tmp/base-3502/target/debug/deep-drive`.
- **New: `DEEP_3502_BASE_SHOW`**, a variable that carries only a path: a `deep-show` built from the merge base with
  the `withdrawals` wake added and nothing that changes how GPUI reaches the notification center, as #1551's
  `DEEP_1551_BASE_BIN` was built. `planted-center.m` needs nothing from it.

### The planted Notification Center (AC6): test code

`planted-center.m`, built by `show.mjs` with clang into a library and put into a `deep-show` run by the loader
(`DYLD_INSERT_LIBRARIES`), which a hardened release never honours. In that process
`+[UNUserNotificationCenter currentNotificationCenter]` answers the planted center, a subclass of
`UNUserNotificationCenter`, and the main bundle answers an identifier, since GPUI asks for the center only from an
app bundle. Every call of the center that asks the notification service (`requestAuthorization…`,
`setNotificationCategories:`, `addNotificationRequest:…`, the two `remove…WithIdentifiers:`, the `removeAll…` and the
`get…` calls) takes 2 s to return on the thread that made it; reading the center and its `delegate` takes none. It
logs each call's start and end with its selector and whether the caller was the main thread. Nothing in the tree or
in a build is planted, so the same center stands under both commits.

### The cap (AC5)

Nothing new in a binary. The test reads `vendor/gpui-pre/src/window.rs` and `src/platform.rs` as text:

- from 0.3.11, the issue's `FramePacer`: `const FRAME_INTERVAL_TOLERANCE`, `struct FramePacer` and `impl FramePacer`
  with `fn should_defer(&mut self, now: Instant, minimum_interval: Option<Duration>) -> bool`, each taken whole, and
  the intervals `WindowOptions`' default gives `thermal_frame_interval` and `inactive_frame_interval`;
- at 0.3.9, the closure's test `now.duration_since(last_frame) < min_interval` and its thermal interval.

It builds them with `rustc` into a program that hands the rule each tick's time, as the closure hands it
`Instant::now()`, and counts the ticks it doesn't defer.

- **New: `docs/evidence/3502/cap-counts.json`**, the counts as they go on #3441:

  ```json
  {"release": "0.3.14", "lists": [
    {"cap": "thermal", "hz": 60, "ticks": 600, "jitter_us": 0, "seed": null, "presented": 600},
    {"cap": "inactive", "hz": 120, "ticks": 600, "jitter_us": 200, "seed": 3, "presented": 150}]}
  ```

  One entry for each of the 27 lists `cap.mjs` plays (`LISTS`): each cap at 60 and 120 Hz over 600 ticks, exact and
  with seeds 1 to 5, and the three longer exact runs of #3441's comment. The test prints every count it plays.

### The records (AC5, AC7, AC8)

What a criterion says is recorded is a file under `docs/evidence/3502/`: `cap-counts.json` (above, The cap),
`pictures.json` (above, The pictures) and:

- **New: `docs/evidence/3502/frames.json`**:

  ```json
  {"readings": [
    {"side": "head", "commit": "<40 hex>", "machine": "Mac17,10", "display_hz": 120,
     "runs": [{"refreshes": 300, "worst_wait_ms": 0.41}, "… five runs"]},
    {"side": "merge-base", "commit": "<40 hex>", "machine": "Mac17,10", "display_hz": 120,
     "runs": [{"refreshes": 600, "worst_wait_ms": 33.2}, "… five runs"]}]}
  ```

  `refreshes` is how many of the display's refreshes a run's 300 frames spanned, and `worst_wait_ms` the longest
  `drawable_wait_ns` among them, as `animation.test.mjs` prints both. The 300 frames are the first presented once the
  film's first pass, 4 s, is over. `machine` is a reference Mac's model. A `head` reading has a `merge-base` reading
  of another commit on the same machine beside it. (The numbers are made up.) The merge base's reading is the
  implementer's to take, the same way: a release `deep-show` built from the merge base with `drawable_wait_ns`,
  `window.focused` and the watched run's `window` added and nothing else, on the scenario `animation.test.mjs` sends
  (`fixtures/film.json`, `live: {"watch_from": "first_frame", "watch_ms": 19000}`), five runs after a warm-up one.
  No test takes it: the test holds the record's shape, never that its numbers are true.
- `benchmarks/budgets.json`: `terminal-60hz`, `canvas-idle`, `app-select-700` and `deep-list-700` each hold
  `"#3502.160644ed"` in `criteria`, with `command`, `margin`, `limits` and `targets` as the merge base has them.

## The criteria and their tests

IDs are the first 8 hex digits of the SHA-256 of each criterion's text, trimmed, white space collapsed
(`scripts/proof-change.mjs`, `criterionId`).

| ID | Criterion | Tests | What fails them |
|---|---|---|---|
| `#3502.46a47d8c` (AC1) | The three trees are one release at or past 0.3.13, the workspace builds, and `check` passes with every remaining row's test passing. A row whose test can't run reads BLOCKED, naming it, never PASS | `pin.test.mjs`: the pin and what agrees with it; `check` on the new pin. `build.test.mjs`: `cargo build --workspace --locked` on the new pin. `rows.test.mjs`: every row's test, one `ROW …: <verdict>` line a row, only PASS passing. `rows-planted.test.mjs`: a planted table whose rows' tests pass, fail, are skipped, say BLOCKED or INCONCLUSIVE, or aren't there | The merge base: each of the four fails on "vendor/gpui-pre is 0.3.9, before 0.3.13", before a build or a row's test starts. The planted rows: each reads its own word, and only the three whose tests pass read PASS |
| `#3502.e03d1e0d` (AC2) | Each removed row names the upstream change that meets its removal condition, and that row's test still passes without our change. A planted removal of a row whose condition the release doesn't meet fails that row's test, naming it | `rows-planted.test.mjs`: the table against the merge base's; the planted removal. `rows.test.mjs`: each removed row's test, on this tree | The planted tree (below): the check fails with `FAIL row #11 The greeting names who it greets: its test … fails`. A removed row with no retired row, or one naming no upstream change, fails by name. The merge base removes nothing, so both real-tree tests pass there |
| `#3502.83b16d90` (AC3) | The replica's pictures of every shipped page at the head and at the merge base are equal, in light and dark at both reference windows, or each differing picture is listed with its cause | `pictures.test.mjs`: every page × two windows × two themes from both builds, compared pixel for pixel, against the list; and the comparison's own proof | A planted change of one pixel in a real picture: listed as `<page> reference light`, failing while unlisted. An equal picture on the list fails. Without the merge base's build: BLOCKED |
| `#3502.e758e239` (AC4) | A shown window holding a still document for 60 s runs 0 request-frame callbacks on the new pin, as #1551 reads it. A planted link that never pauses fails, naming the count | `still.test.mjs` | The planted `link_never_stops`: the same check fails, its message holding the count. The merge base: "vendor/gpui-pre is 0.3.9", since 0 callbacks on the old pin is #1551's reading |
| `#3502.0a92cc25` (AC5) | #3441's tick lists are played through the new pin's cap with no patch of ours for it, and the counts are recorded. Under the thermal cap, 600 ticks exactly 1/60 s apart present more than 300 frames; the merge base presents 300 and fails, naming the count | `cap.test.mjs` | The merge base: "presented 300 frames, not more than 300". A carried change on a line of the cap's rule fails naming the line. A count the record doesn't hold, or holds otherwise, fails naming the list |
| `#3502.350a78c3` (AC6) | With a planted Notification Center whose calls take 2 s to return, 20 withdrawals in a row leave an input's frame on screen within 2 frames (drafted). The merge base waits on its UI thread and fails, naming the call | `withdrawals.test.mjs`: no call of the center on the UI thread (any Mac); the input's frame within 2 frames (a reference Mac, release); the merge base | The merge base, through `DEEP_3502_BASE_SHOW`: "the UI thread made 40 of the planted center's calls … removePendingNotificationRequestsWithIdentifiers: × 20, …", and the input's frame past 2 frames. The plain merge base refuses the wake (`{"ok": false, "code": "bad_input"}`) |
| `#3502.f53607ef` (AC7) | On each reference Mac, a 300-frame animation in the app's focused window presents at the display's rate, and no frame waits more than 4 ms for its drawable (drafted), read from the present times the carried hook reports. The merge base's reading is recorded beside it. Off a reference Mac this reads INCONCLUSIVE | `animation.test.mjs`: five runs judged by `judgeLimit`; the record | A build whose frames wait a refresh for their drawable spans 600 refreshes and fails both limits. The merge base: no reading recorded; and its `frames` hold no `drawable_wait_ns` |
| `#3502.160644ed` (AC8) | Budgets, on the reference Mac in the local preflight, compared with the merge base: the four tasks read within their margins | `budgets.test.mjs` | The merge base: no task names the criterion. A moved command, margin, limit or target fails naming the task |
| `#3502.16dea0e8` (AC9) | The Rebase trial names the versions moved to, the result of each suite it lists, and the outcome. A trial with a suite unrun leaves this open | `trial.test.mjs`: the real record against the tree; made-up records | The merge base's record (0.3.11 tried, every suite `not run`). Made-up records: a suite `not run` or empty, a carried row's suite unlisted, a version the tree doesn't hold, no outcome, `pin left` on a moved tree |

### The planted removal (AC2)

A real removal of a carried change needs a copy of the tree rebuilt for it, and an edit that still compiles has to
be written against renderer code this change ports. So the plant is a small tree built in a temporary folder, as the
plants of #1426 are: a stub crate `vendor/stub` with two carried changes, a greeting and a farewell, each with its
row and its row's test (`tests/carried.test.mjs`), on a stub release that gives the farewell and not the greeting.
Removing the farewell's row passes. Removing the greeting's row, with our change, fails the greeting's test, and the
check names the row. The check is the one `rows.test.mjs` runs on the real tree: `judgeRetired`, `runCells`,
`judgeRows`.

## Readings, where the issue and the design leave a choice

1. **"One release"** is the three manifests' versions, and for the build `Cargo.lock`'s three packages from their
   paths, every manifest line that asks for one of the three, one gpui-kit commit everywhere it is written, and no
   `[patch]` outside `.cargo/config.toml` (the Scope's first line). **"The commit that asks for it"** isn't read from
   gpui-kit: each of its commits asks for exactly one release, so a lock that resolves the one vendored `gpui-pre`
   and builds `--locked` holds the commit that asks for it. No test names a release past the criterion's 0.3.13, or a
   commit.
2. **Every row's test** is the one test its cell names. One process runs each named file once, with every test the
   remaining and the removed rows need from it, under the runner `vendor-rebase.mjs` uses for that kind of file, and
   prints a line a row. **"Can't run"** is BLOCKED: no file, no test by that name, a skipped test, a runner with no
   report, or a failure that itself says BLOCKED (a missing binary, a failed build). A test that ran and said
   INCONCLUSIVE (no display, a loaded machine, off a reference Mac) keeps that word. Neither passes. `check` itself
   runs no row's test, as at the base.
3. **A removed row** is a merge-base row with no row left of its issue holding its Test cell or its Behavior cell. A
   kept row keeps one of the two as written. A row whose removal condition is "the pin moves to gpui-pre X or later"
   must be gone once the pin is X or later: that one condition is the table's own arithmetic. Which other conditions
   a release meets is the implementer's to find.
4. **"Without our change"** rests on the lint: a removed row's files hold no hunk of ours without a row, or `check`
   fails.
5. **The pages** are `deep-drive`'s `launch.center` list, read from the head's build (#1458's and #1592's reading).
   One page needs a word more than its center: first launch shows only while setup is unfinished (#1461's
   `launch.setup`), so that center's launch says so. At the base Needs you and Home draw the same picture over this
   record; each is still taken and compared. **"Both reference windows"** are the quiet check's two: the opening
   window, read from the clean look (`window_width` × `window_height`), and the reference window, which a launch
   with no `size` opens. **Light and dark** are `launch.theme`'s two values. **Equal** is pixel for pixel. **A
   cause** is a sentence; whether it is true isn't tested.
6. **"As #1551 reads it"**: #1551's surface and planted name, on a debug build, since a count is judged on any Mac.
   This criterion differs from #1551's first in two ways: it has no merge-base clause and no "at least 3,000", so the
   plant must only fail the check with its count in the message; and it says "on the new pin", so a tree on the old
   pin fails.
7. **"Played through the pin's cap"**: the window's closure reads the clock itself, so exact ticks can't be given to
   a window. The rule the closure calls is taken from the vendored source as text and compiled, never rewritten. A
   tick is at k ÷ hz seconds to the nearest ns. **"No patch of ours for it"**: every line of the two files that holds
   a word of the rule equals the pinned release's, in order, and carries no mark. A later release that renames the
   rule reads BLOCKED here, naming it; that goes to a redraft. A later patch of #3441's own will fail this test, and
   is #3441's to bring with an approved change.
8. **The jittered lists** use this suite's own seeded generator (`ticksOf`), seeds 1 to 5, since #3441 names none.
   Only the criterion's one bound is asserted; every other count is printed and held equal to the record.
9. **"The counts are recorded on #3441"** and **"recorded beside it"**: a test can't reach GitHub, so each has a file
   under `docs/evidence/3502/`, and the test holds the file to what it plays or to its shape. Posting them on #3441
   is the implementer's.
10. **The planted center** replaces the Mac's Notification Center in the process, under GPUI. **"20 withdrawals in a
    row"** are 20 `dismiss_system_notification` calls in one turn of the UI thread. **"An input's frame within 2
    frames"** is measured from the event's post into the app's queue, by a thread the withdrawals can't hold, to the
    presented time of the first frame latched after the app read it, over the display's refresh period. #1551
    measures an input from the app's callback, which a blocked UI thread would hide. **"Naming the call"**: the
    failure names the center's calls the UI thread made.
11. **"A 300-frame animation"** is 300 frames of a looping film: the first 300 presented once its first pass is
    over, 4 s by the film's own `transport.span`. The first pass is the window's launch, and the criterion is about
    an animation under way: at the base, in a debug build on a loaded machine, the film's frames came unevenly for
    its first seconds. **"Presents at the display's rate"**: those 300 frames span 300 of the display's refreshes.
    **"Waits for its drawable"** is no present time, so a frame reports it (`drawable_wait_ns`); the present times
    and labels are the carried hook's. Both limits are judged as the design judges a timing: five runs after a
    warm-up, `judgeLimit`. **"On each reference Mac"**: a run on any one counts, as a budget does.
12. **AC8** is the budget window's to measure (parallel-proof 12a, the reading rule): the test holds that the four
    tasks name the criterion and are the merge base's tasks. Outside a window a time is a reading.
13. **AC9 adds** to #1426's judge: `gpui-pre-macos` among the versions; each `to` against the tree; no suite `not
    run`; and the suite of every row the moved trees still carry, since a suite the record doesn't list is unrun as
    far as the record says.

## Not asserted, because no criterion says so

- The Scope's "the change says how it is split", "carried hunks reshaped at 0.3.9 can land first", and what is not
  in this task (#711, #1433).
- Which release past 0.3.13, which gpui-kit commit, and which rows a release retires beyond the pin's own arithmetic.
- That an upstream change named in a retired row is the right one, or that a picture's cause is true.
- #3441's own criteria: its counts other than the one bound, the 120 Hz and inactive bounds, forced renders.
- A snapshot's text: AC3 compares pictures only. Journeys and steps are #1652's.
- AC4's other #1551 criteria (requests and inputs from idle), and `canvas-idle`'s reading.
- The four budgets' times: the window measures them.
- That each suite's `pass` in the trial is true: `rows.test.mjs` runs each row's test, and #1426's record test the
  five suites.
- The planted center says nothing of the real service's speed, and AC6 reads `deep-show`, the app's window, not the
  bundled app's notifier.

## What the implementer adds outside this folder

- `vendor/gpui-pre-apple/upstream/README.md`: `## Retired rows` and the rewritten `## Rebase trial`, as above.
- `crates/deep-show`: the `withdrawals` wake, `drawable_wait_ns` and `window.focused`, as above.
- `benchmarks/budgets.json`: `"#3502.160644ed"` in the four tasks' `criteria`.
- `docs/evidence/3502/`: `cap-counts.json`, `frames.json`, and `pictures.json` if a picture differs.
- `scripts/lanes-lists.mjs`, two lines:

  ```js
  // #3502: these two judge a time on a reference Mac (judgeLimit).
  timed.push('tests/acceptance/3502/animation.test.mjs', 'tests/acceptance/3502/withdrawals.test.mjs');
  // #3502: every carried row's test and the whole workspace's build take hours, and two files read the merge base's
  // own build, named by DEEP_3502_BASE_DRIVE and DEEP_3502_BASE_SHOW.
  byHand.push('tests/acceptance/3502/rows.test.mjs', 'tests/acceptance/3502/build.test.mjs', 'tests/acceptance/3502/pictures.test.mjs', 'tests/acceptance/3502/withdrawals.test.mjs');
  ```

No test file here imports another suite's file. `fixtures/film.json` is #140's moving film
(`tests/acceptance/140/view/fixtures/parity/gpu/live-headless/film.json`), copied byte for byte.
