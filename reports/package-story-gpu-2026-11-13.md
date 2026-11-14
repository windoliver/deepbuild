# Package story and GPU hill-climb, 2026-11-13

Base: `c56fe5407` (main, 2026-11-14). Branch `audit/package-story-gpu-1113`. Beside this report, 8 files differ from main: 4 Rust files (+476 −166, of which about 170 lines are three tests) and 4 cards.

Two results. The places where the packages don't yet join into one path are listed with their evidence, and each now has an issue. The 3D renderer makes no buffer and no bind group per frame for water, motion blur or the velocity target, and a frame's uniforms go up in 8 to 20 queue writes where main makes 55 to 131. No pixel changes.

Not verified, first:

- **This is a connection audit, not a line read.** Every source file's imports were scanned by script, every card was read, and code was read where a card and the graph disagreed and along the 3D frame path. The line reads are the Nov 9 to 11 reports.
- **GPU time and device memory were not measured.** The machine's load average was 50 to 360 throughout. What is measured is counts on the noop lane, which load does not move, pixel hashes on Metal, and one CPU timing whose ratio held across loads.
- **`node scripts/affected.mjs` ends FAIL on this tree**, on failures that are main's (below). Its cargo block stops at a test of deep-app that does not compile on main (#2355), so the two changed crates were tested by hand.

## The story, as the code has it

**TypeScript: 36 workspace packages in 8 layers, no cycle.** No package declares a workspace dependency it doesn't import, and none imports one it doesn't declare (`tests/package-deps.test.mjs` passes).

| Layer | Packages |
|---|---|
| 0 | contracts, evidence, readings, pi, paseo |
| 1 | adapters, record |
| 2 | asks, conformance, leases, otlp, verdicts, wiki |
| 3 | archive, budget, checks-host, checks-numbers, checks-work, proof, routing-replay, supervisor, workspaces |
| 4 | buying, env-local, gate, resolver-decisions, runner |
| 5 | checks-command, checks-review, config-eval, extension-host, github, reading |
| 6 | checks-journey, hub |
| 7 | cli |

The record and the contracts are the floor. The hub is the one composition root: it imports 25 packages, and the CLI imports the hub. `packages/channels`, `packages/jobs` and `packages/sources` hold 11 DeepBuild packages with no `package.json`: each is installed alone and reaches the hub only through `ctx`.

**Rust: 47 crates in 13 layers.** `deep-canvas` links no workspace crate. The canvas module crates sit on it, `deep-gpu` under the render crates, then `deep-app`, `deep-replica` and the hosts. No crate declares a workspace dependency its source never names. Four roots hold 40 of them: `deep-show` (36 crates), `deep-gpu-layer` (33), `deep-app` (16) and `deep-hook` (2). The other seven are four small binaries (`deep-input`, `deep-motion`, `deep-text-render`, `deep-panel-host`) and three job tools built to WebAssembly (`deep-typeset`, `deep-lottie`, `deep-synth-job`).

**Where the two halves meet.**

- The hook: `deep-hook` reads its contracts through `deep-contracts`, generated from `packages/contracts/schemas`, and talks to the hub over its socket.
- The canvas: the hub starts `deep-show canvas` (`packages/hub/src/canvas.ts`), `deep-drive` (`drive.ts`), `deep-replica` (`panels.ts`), and `deep-gpu` and `deep-canvas-render` for the doctor (`canvas-doctor.ts`).
- The app: `crates/deep-app/src/hub.rs` speaks to the hub's socket, and both sides read `contracts/setup-steps.json` and `contracts/plain-words.json`.
- Jobs: `scripts/typeset-wasm.mjs`, `lottie-wasm.mjs` and `synth-wasm.mjs` build the three tools into `packages/jobs/*/tool`.

## Where the story breaks

Each is where a part exists and nothing on the shipped path reaches it. None is fixed here: each changes behavior, and each has an issue.

1. **No shipped path draws through the GPU layer's view.** `crates/deep-app/src/gpu_view.rs` (`watch`, `unwatch`, `paint`) has no caller in deep-app or deep-replica; its nine call sites are in deep-gpu-layer, the proof binary. The hub's canvas core is `deep-show canvas`, which its own header calls #393's stand-in, and it draws a 3D revision with `draw_offscreen` (`crates/deep-show/src/scene3d.rs:98`, `:149`), a snapshot texture and a read-back per frame. The app shows the pictures that process made. So the slot ring, the zero-copy handoff and the live view are proven but unreached. Filed as #2494.
2. **Every installed view mounts in the app's process.** `crates/deep-app/src/installed.rs:157` calls `mount_panel` for each view the hub lists. `deep-panel-host` is started only by the app's `panel-check` commands, a feature off in the shipping app. Owned by #358.
3. **The shipped module list lives in two hosts.** `crates/deep-gpu-layer/src/plugin.rs:41` holds ten modules and says it is the list deep-show's full build holds; deep-show's `modules` adds cells, vector, the building module, loop, input, logic, physics and the sandbox. Owned by #1895.
4. **Four packages have no caller outside their tests.** `buying`, `checks-host`, `checks-journey` and `proof`. The hub's kind table (`packages/hub/src/kinds.ts:64`) holds `command`, `review`, `numbers` and the four work kinds, so no gate run reaches kind `journey`, which the design lists among v0's first-party extensions. Seven gate entries (`lockDefinition`, `recomputeHash`, `checkSource`, `claimsFor`, `executeClaim`, `runHeavy`, `verdictMemory`) are named by no file under `packages/*/src`, `adapters` or `scripts` outside the gate package. Owned by #1982.
5. **Nothing starts the OTLP receiver.** No hub file imports `@deepbuild/otlp`; the CLI's doctor reads one item from it. Owned by #1852.
6. **A config eval's report and the learned layer don't meet.** `scripts/config-eval.mjs` is `runEval`'s only caller and keeps its report under `~/.deepbuild/evals/`. The learned layer's `replayCheck` (`packages/record/src/learned.ts`) reads a replay a change cites by its `ev:` handle, from the evidence store, and nothing puts a report there. Filed as #2495.

## Cards corrected

`scripts/repo-rules.mjs` checks that a card has its four headings, not that its import line is true. A script compared each card's "What it may import" with the manifest and the source.

- **Eleven crate cards missed workspace links.** PR #2458, a sibling audit of the same day, found and fixed the same eleven on main (`6b761f4d6`) while this was open, so they are not in this change. On this base the script lists no crate link missing from a card.
- **deep-panel-host** said the app starts it; it now says which commands do, and that the shipping app starts none (#358).
- **budget** said the hub hands the ledger to buying; the hub doesn't import buying.
- **config-eval** said the learned layer calls `runEval`; no package does.
- **jobs** left out `score`, its tool and `score/tool/synth.wasm`.

## GPU: what changed

All in `crates/deep-scene3d-render` unless named. wgpu-core 30.0.1 makes a staging buffer of its own for every `Queue::write_buffer` (`device/queue.rs:662`), so a frame's cost on the queue follows its writes more than its bytes.

- **A uniform's changed words go up in runs.** `Queue::write_changed` wrote each run of changed words alone: a camera's turn changes three words of each row of a matrix, so one 256-byte uniform took 17 writes. Changed words with at most a row (four words) of unchanged ones between them now go up in one write, the unchanged ones as the buffer holds them. `crates/deep-gpu/src/counted.rs`
- **Water binds what it made.** `Waterer::prepare` made a path buffer, and a uniform and a bind group per part, and the samples' bind group, every frame. The path and each part's uniform are now buffers written where they change, and the bind groups are kept while the targets they bind hold. A part that goes lets go of its buffer and its targets. `water.rs`
- **Motion blur and the velocity target bind what they made.** Each made a uniform and an instance buffer every frame; blur also made four bind groups and the target one. Both now keep a uniform and an instance buffer that grows only when a frame has more instances, written where they change, and blur keeps its bind groups while the velocity and linear targets hold. A frame without blur, or with nothing reading the target, lets go of them. `motion.rs`

`lib.rs` is 7 lines shorter than main's: the velocity pass now decides for itself when a frame has none.

## Measured

Counts on the noop lane: five frames after the first, 128 × 96, an orbiting camera, each prepared whole and its jobs recorded (`Renderer::prepare` then `Renderer::jobs`). Main is `c56fe5407`.

| Scene | Buffers and bind groups made a frame, main → change | Queue writes a frame | Bytes uploaded a frame |
|---|---|---|---|
| One box | 0, 0 → 0, 0 | 55 → 8 | 268 to 280 → 528 |
| Sun with cascades | 0, 0 → 0, 0 | 82 to 84 → 13 to 14 | 1,480 to 1,496 → 1,864 to 1,888 |
| Mirror and flare | 0, 0 → 0, 0 | 129 to 131 → 19 | 644 to 676 → 1,236 |
| Water | 2, 2 → 0, 0 | 128 to 130 → 20 | 1,176 to 1,208 → 1,348 |
| Motion blur | 2, 4 → 0, 0 | 55 → 9 to 12 | 924 to 936 → 800 to 860 |
| Velocity target | 2, 1 → 0, 0 | 55 → 9 to 12 | 924 to 936 → 800 to 860 |
| Glass | 0, 0 → 0, 0 | 65 to 66 → 10 | 436 to 452 → 732 |
| Subsurface | 0, 0 → 0, 0 | 66 to 67 → 11 | 724 to 740 → 1,020 |
| Ambient occlusion | 0, 0 → 0, 0 | 75 to 77 → 10 | 364 to 388 → 728 |
| A crowd of 400 | 0, 0 → 0, 0 | 78 to 79 → 12 | 372 to 392 → 724 to 728 |

**The cost: more bytes.** A run carries the unchanged words inside it. On `deep-gpu run --backend noop`'s `envelope_counts`, 1280 × 720, frames 1 to 119:

| Document | Bytes a frame, main | Change |
|---|---|---|
| #1903's `separate-items` | 320 to 364 | 648 to 656 |
| #1903's every-pass scene | 3,508 to 3,640 | 4,532 to 4,572 |
| 32 clouds | 296 to 1,860 | 604 to 2,140 |

`separate-items` stays under #1903's 1,024 bytes a frame, with 368 bytes of room where main has 660. A row is the gap chosen because a wider one buys little: on the one-box scene a gap of one word gives 14 writes and 432 bytes, a row 8 and 528, and joining everything 4 and 832 (read at `f6d811c79`).

**The gain, timed once.** The one-box frame's queue writes alone, on Metal in a release build at `f6d811c79`, median of nine runs of 2,000 frames: 4,873 µs for main's 55 writes against 1,130 µs for the change's 8, at a load average near 270. Two earlier runs at loads of 25 to 50 read 273 against 51 µs (release) and 737 against 144 µs (debug); their output was lost with a cleared temporary folder. The ratio, 4.3 to 5.4, is the reading; the times are not.

## Verification

On `c56fe5407` unless a row names another base.

| Check | Result |
|---|---|
| The three new tests on main's code (the first commit) | fail for the expected reason: `words 0 to 11 … left (3, 28) right (1, 48)`; `motion blur, frame 1: buffers and bind groups made left (2, 4) right (0, 0)`; water `left (2, 2) right (0, 0)` |
| `cargo test -p deep-gpu -p deep-scene3d-render` | deep-gpu 46 and 6 pass (1 ignored, as on main); deep-scene3d-render 27 pass, the three new ones unchanged since their failing run |
| `cargo clippy -p deep-gpu -p deep-scene3d-render --all-targets --no-deps -- -D warnings` | clean. With dependencies it stops in `deep-canvas-marks/src/copy.rs`, two lints from #538, main's |
| `rustfmt --check` | clean on `counted.rs`, `water.rs`, `motion.rs`. `lib.rs:6199` is #538's line, main's |
| Pixels, main's binary against the change's, on Metal (`deep-gpu run`, `view3d`) | 149 frames over seven calls, every pixel hash equal: #166's harbour with rain, 60 frames played and frame 44 by a seek; the same with a wake and foam; #419's slider under velocity blur, 25 frames and frame 12 by a seek; blur off |
| Acceptance on Metal: `166/seek`, `waves`, `tint`, `mirror`, `foam`, `rain`; `419/velocity-seek`, `camera-track`, `declared-moves`, `topology`, `walker`; `431/velocity`; `378/move`, `replay` | 14 files, 26 tests, all pass |
| `tests/acceptance/1903/counts.test.ts` (noop) | 5 of 6 pass. `#1903.6598323c` fails on main too (#2496) |
| `node scripts/repo-rules.mjs` | cards pass. 47 FAIL lines, the same 47 as main, none naming a file this change touches |
| `node --test tests/package-deps.test.mjs` | 2 pass |
| At `f6d811c79`: `cargo test` for deep-effects-render, deep-gpu-layer, deep-marks-render, deep-show, deep-text-render, deep-replica, deep-panel-host, on main's code and on the change | the same 27 tests fail on both. A 28th, `replica_launch_under_two_seconds`, failed once with the change at a load near 280 and passed 3 of 3 alone; deep-replica does not link the renderer |

`node scripts/affected.mjs`, once: `FAIL affected: 297 new, 45 already failing on main, 0 inconclusive or blocked, 0 listed skips, 19 passed, in 946 s at load 223`. No WIDE line. Of the 297 NEW FAIL lines, 295 are lint lanes (fmt 114, size 51, deps 46, code mappings 23, vendor 18, color literal 10, known-failures 8, slots 8, two slot kits 7, canvas-lint 4, clippy 2, and one each of secrets, drift, record reader and cargo test) and 2 are tests, `140/view/glyphs` and `381/depth`, which fail the same way on main's code (run at `f6d811c79`). Two lines name a file this change touches, both `lib.rs`: #538's fmt line, and its size, 9,598 lines against a ceiling of 9,169, where main's is 9,605.

**Main's own, found on the way.**

- `#1903.6598323c` allows a move 256 bytes more in its frame; main uploads 288, two 144-byte records, with or without this change. Moving `item-0000` 0.1 m uploads 144. That fits #450's tie ranks (`ties.rs:55`, ranked every frame since `df777f6dc`). Not bisected. Filed as #2496.
- deep-marks-render's `the_named_versions_are_the_locked_ones` reads the lockfile's first `vello_cpu`, 0.0.8, which `deep-typeset` pulls in, against 0.3.0. Filed as #2497.
- deep-app's `acceptance_995` does not compile. Already #2355.

## Not run

- The timed and slow lists, the preflight, and every 3D suite not named above: the rest of #166, #419, #431 and #378, and all of #380, #418, #422, #465, #1285, #2016 and #2189.
- The other render crates' and deep-app's cargo tests were not run again on `c56fe5407`.
- Builds and tests outside `affected.mjs` went through `scripts/lease`, which found no hub set up on this Mac and ran them unleased, at `nice` 5 to 19.

## Found and not applied

The Nov 11 list (`reports/gpu-hillclimb-2026-11-11.md`) still stands where this pass looked again.

- **Every effect pass makes two uniform buffers and a bind group per call** (`crates/deep-effects-render/src/runner.rs:273`). Not counted: no measured scene had an operator on. The fix touches every caller.
- **The print pass makes two buffers and a bind group per call** (`print.rs:368`).
- **A cascade's frame uniform is written whole, 352 bytes, each time its key changes** (`lib.rs:3764`): three writes and 1,056 bytes a frame under an orbiting camera.
- **Three small uniforms are written whether or not they changed**: subsurface's 160 bytes (`sss.rs:426`), each swaying solid's 160 (`sway.rs:174`), and the per-pixel lists' 16 (`oit.rs`). `mod.sway@1` also submits a command buffer of its own (`sway.rs:199`).
- **`draw_offscreen` makes a snapshot texture per call** (`lib.rs:9189`), and it is how deep-show draws every 3D frame: see break 1.
- **The live view still records none of the mirror's, flare's, water's or motion blur's passes**: `liveview.rs` never calls `Renderer::jobs`. It prepares them, so what this change saves in their prepare is saved there too.

## Requirement to change to proof

| Asked | Done | Proof, and its limit |
|---|---|---|
| Pull latest | A worktree of its own at `origin/main`, moved twice as main advanced, last to `c56fe5407`. The main checkout, with other sessions' uncommitted files, was not touched | The change re-applied and the checks above run again on the last base |
| Deep audit, package by package | Import and link graphs for all 36 packages, 11 plug-in folders and 47 crates; every card read | By script and by card. Not a line read |
| A coherent story, all packages connected | The story above, six breaks each with its evidence and an issue, 4 cards corrected | `repo-rules` cards pass; the card script lists no crate link missing. The breaks are not fixed |
| Hill-climb GPU usage | Three changes: write runs, water, velocity | Tests that fail on main's code; counts; 149 equal pixel hashes; acceptance on Metal. GPU time and memory not measured |

No export, flag, option or dependency was added. `Queue::write_changed` keeps its signature.
