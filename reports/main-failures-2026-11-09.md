# Failures on main, triaged (2026-11-09)

Every listed case still fails on main. Seven groups are bugs on main, three are stale tests or fixtures, two are this Mac, and one is an intermittent failure whose cause was not found. None is in `scripts/known-failures.json`.

Base: `7dd8cf19` (origin/main is `06fd33cd`, which adds two docs files only). Machine: Mac17,10, 18 cores, load 31 to 60 throughout, Node 24.22.2, Rust 1.99.1.

## Setup the commands below assume

```bash
npm ci --prefer-offline
```

```bash
npm run build --workspaces
```

```bash
export PATH=/opt/homebrew/opt/rustup/bin:$PATH
```

The last line matters on this Mac. `~/.cargo/bin` holds only `cargo-machete`; `cargo` comes from Homebrew's rustup, which is not on the PATH of an app session's shell. Without it every suite that builds deep-hook fails `BLOCKED: ... spawn cargo ENOENT`, and the hub refuses to start (`no deep-hook is built under .../target`). That is this machine, and it hides the real failures below.

`V` below stands for `node node_modules/vitest/vitest.mjs run --no-file-parallelism`.

## The table

| # | Group | Fails | Kind | Introduced by | Cause | Next step | Reproduce |
|---|---|---|---|---|---|---|---|
| 1 | `packages/checks-command/test/regressions.test.ts`, no `pnpm`, no `go` | 3 of 51 | Environment | none | `need('pnpm')` (two cases) and `need('go')` throw `BLOCKED: <program> isn't on PATH on this machine`. | Nothing on main. On this Mac, install pnpm and go if the cases should run. | `V packages/checks-command/test/regressions.test.ts` |
| 2 | Same file, pytest runs | 10 of 51 | Environment | none | `python3` here is Apple's `/usr/bin/python3` shim. Inside a run's sandbox it cannot open `/Library/Developer/CommandLineTools/usr/lib/libxcrun.dylib` ("file system sandbox blocked open()"), so Python never starts, the read tracer writes no trailer, and the run is `uncounted` with mask `evidence altered reads`. No pytest is installed either: the venv case says `No module named pytest`, and so does `python3 -m pytest` in a plain shell. | Nothing on main. On this Mac, a `python3` that is not the shim, with pytest. Follow-up below: these cases have no `need()` guard. | Same command. Cases at lines 182, 349, 398, 503, 652, 740, 773, 796, 804, 824. |
| 3 | Same file, Vitest and node:test runs | 5 of 51 | Bug on main (one lost pass, four changed outcomes) | `7bd378e7`, #33 "controls in every Vitest and node:test run", PR #1648, merged Nov 7 | The run's mask is `the report can't record a failure: its control deepbuild control <id> in <file> is missing from the report`. The control #33 appends to each test file is left out by the checkout's own filter, so the run is `uncounted` before the older rule (a test its file holds that never ran is a failure) is read. Four cases expect `failed` and still cannot pass: config `testNamePattern` (275), tag `only` with `allowOnly` (336), `mergeReports` (236), a package script's `--test-name-pattern` (529). One expects `passed` and no longer can: a file whose source says `test.only` (422). A filter the command itself names still passes. | #2081. Fix on main in `packages/checks-command/src/index.ts` (where `unheld(...)` is read before the left-out rule) or `src/controls.ts`, so a control the run's own focus or filter leaves out is not read as a report that cannot record a failure. If #1099 means `uncounted` for the four can't-pass cases, those four expectations need the owner's word; the `test.only` case is a regression either way. | Same command. The mask is not in the test's message; read `r.mask` from `runCommandCheck`. |
| 4 | `packages/contracts/test/events.test.ts` | 2 of 42 | Bug on main | `d0d685b8`, #1334 promoted builds, PR #1774, merged Nov 9 | The new `build.rolled_back@1` schema leaves `evidence` out of its envelope, gives `data.commit` no `maxLength`, and caps `data.restored` at 200 where every text field is held to 8192. | #2082. Fix on main in `packages/contracts/schemas/build.rolled_back@1.json`, then `npm run generate -w packages/contracts` for `digests.json`, `types.ts` and `crates/deep-contracts/src/generated.rs`. | `V packages/contracts/test/events.test.ts` |
| 5 | `tests/acceptance/45/hub.test.ts` AC2 | 1 of 3 | Bug on main | `a273cb8f`, #84, PR #1423, merged Nov 5 | `Core.handbacks()` appends a `handbacks_sent_back` row to `numbers.read` with `id`, `label`, `value`, `of` and `detail` only: no `source`, `age_ms`, `unit` or `basis`, which #45 requires of every row and which `deep numbers` prints. | #2083. Fix on main in `packages/hub/src/core.ts:5972`. | `V tests/acceptance/45/hub.test.ts` |
| 6 | `tests/acceptance/1015/claude.test.ts` and `focused.test.ts` | 1 of 2 in each | Bug on main | `ae2f913c`, #352 session map and notices, PR #1284, merged Nov 8 | A session that has another session with changes in the same repo gets its next tool call held for the core (`holdFor`, the `acking` branch). That path answers through `coreReply`, which writes only the core's context and drops the reply already settled, so #1015's rewrite into `deep lease -- ...` is lost and the command runs as typed. With eight sessions, seven ran as typed at once and one was rewritten. | #2084. Fix on main in `packages/hub/src/server.ts`: `coreReply` (line 1049) must carry `ruled`, as `gateReply` and `extensionReply` do. By reading, the same drop loses a long wait's lines and a scoped rule's notice on that call. | `V tests/acceptance/1015/claude.test.ts` and `V tests/acceptance/1015/focused.test.ts` |
| 7 | `tests/acceptance/304/defaults.test.ts` AC2 | 1 of 1 | Stale fixture | `a273cb8f`, #84, PR #1423 | #84's `push-needs-ask` holds every push no typed request names. The twin that `crates/deep-hook/default-rules.json` ships for `no-unreadable-push` is a plain push (`jj git push`; `git push origin main` when #84 merged), so with the hub up it is held, and with no authority deadline in the test's home the ask cannot be raised. It is the last of the 26 fail-closed entries, so no other entry is hidden behind it. | Fix on main in `crates/deep-hook/default-rules.json`, `proofs["no-unreadable-push"].twin`: a readable call that no default holds. If no such twin exists for `unread:push`, AC2 needs an approved redraft. | `V tests/acceptance/304/defaults.test.ts` |
| 8 | `tests/acceptance/304/modes.test.ts` AC7 | 2 of 2 | Stale test | `a273cb8f`, #84, PR #1423 | The test's own planted call is `gh pr merge 12` under a watch-mode entry. #84's `merge-needs-ask` now holds every merge no typed request names, so it is denied before the mode is read. The wrong-program case fails for the same reason, in watch mode instead of warn. | An approved redraft of AC7 with a planted call no shipped default holds. No change to the hub. | `V tests/acceptance/304/modes.test.ts` |
| 9 | `tests/acceptance/387/perturb.test.ts` and `tests/acceptance/855/hash.test.ts` | 5 of 7, 2 of 4 | Bug on main | `f8ecbb86`, #429 planted documents, PR #1242, merged Nov 4 | #387's surface says "Every fixture is presented by `deep_show` in the build that lists it" (`tests/acceptance/387/README.md`, Fixtures). #429 registered documents its check must refuse as module fixtures, and the `fixtures` call lists them without their sidecar. `effects/same-machine-check` is the first one reached; the effects module registers more planted documents after it. | #2085. Fix on main in `crates/deep-show/src/frames.rs:182` (`fixtures_reply`): leave out a fixture whose sidecar names `codes`, or register the planted documents where the call does not list them. | `V tests/acceptance/387/perturb.test.ts` and `V tests/acceptance/855/hash.test.ts` |
| 10 | `tests/acceptance/399/place-route.test.ts` | 2 of 3 | Bug on main | `12153b15`, #494 motion paths, PR #1681, merged Nov 8 | #494 made `graph@1` the graph module's kind. `deep-canvas-render` checks with the core's registry and lets through the module kinds it draws itself (`drawn_here`); `graph` was not added to that list, so `labels` and `geometry` refuse a graph with `module_missing`. | Fixed in the commit beside this report: one line in `crates/deep-marks-render/src/lib.rs` (`drawn_here` gains `"graph"`). The file passes 3 of 3 with it. | `V tests/acceptance/399/place-route.test.ts` |
| 11 | `tests/acceptance/854/idle.test.ts`, frames drawn | 1 of 4, intermittent | Not determined | Not determined | In one of five 60 s runs the still window drew 4 frames, all in the first 2.3 s after deep-show called it settled (frames 8, 10, 11, 12 at 910, 2160, 2269 and 2294 ms). A second pass of the same task drew 0 frames in all five runs, each window `shown` for the whole minute and `request_frames` 0. The audit's run saw the same 4 frames in one run. | An issue and a `known-failures.json` entry, as #1621 has for its load failures. See "Not determined". | `V tests/acceptance/854/idle.test.ts` (14 minutes; it opens windows), or `node benchmarks/canvas.mjs idle` for the raw runs |
| 12 | `tests/acceptance/854/idle.test.ts`, the judge's twin | 1 of 4 | Stale test | `9a4cb2e3`, #1555, PR #1709, merged Nov 8; then `0a95931d`, #1551, PR #1753 | The suite's synthetic reading (`synthetic('idle')` in its `helpers.ts`) has no load at each run's start and end, which #1555's judge needs to judge a budget, and no `window`, which #1551's judge needs for canvas-idle. The judge answers `INCONCLUSIVE` where the test expects `PASS`. | An approved redraft of the synthetic reading. No change to the judge. | `V tests/acceptance/854/idle.test.ts -t "the lane's judge fails a reading"` (under a second) |
| 13 | `cargo clippy --workspace --all-targets -- -D warnings` | 231 findings in 22 crates, 3 acceptance trees and 1 vendored crate | Bug on main | `3541e3f3`, #1732 arrange, PR #1762, merged Nov 9, for 123 of them; 42 other commits since Oct 20 for most of the rest | `OpError` gained `actual: Option<Value>` and is now at least 136 bytes, so `clippy::result_large_err` fires at every function and closure that returns it: 123 sites in 11 crates. The other 108 are small lints: 96 left by 42 feature commits, 9 in `tests/acceptance/327` that `known-failures.json` already lists, 3 in vendored code. The lines the audit named are among the 96. `-D warnings` stops at the first failing crate, so a run shows 31 errors in `deep-canvas` and nothing after. | #2086. Fix on main: box the field in `crates/deep-canvas/src/schedule/mod.rs:358` (`Option<Box<Value>>`, as `070a4787` boxed `SealError`), then clear the 96 or list them under `lint` in `known-failures.json` with an issue. | `cargo clippy --workspace --all-targets --locked -- -D warnings`; drop `-- -D warnings` to see all 231 |

## How each introducing commit was found

| # | Evidence |
|---|---|
| 3 | `git log -S"can't record a failure"` and the mask. Not confirmed by a run: the tree before #33 cannot run its checks on this Mac at all (its sandbox blocks Homebrew's `libuv.1.dylib`, so Node does not start), which later commits fixed. |
| 4 | `git log -S'build.rolled_back'`; the schema file is new in that commit. |
| 5, 7, 8 | Run in an exported tree: all three files pass at `5abb17bf` (the first parent of #84's merge) and fail the same way at `467a2259` (the merge). |
| 6 | `focused.test.ts` passes at `e10229c1` (the first parent of #352's merge) and fails at `ede4b367` (the merge). Mechanism: two sessions in two worktrees of one repo, the second's first call comes back with empty stdout and its second call is rewritten; with the `acking` branch of `holdFor` switched off in the built hub, both are rewritten. The built file was restored. |
| 9 | `git log -S'"same-machine-check"'`, and the fixture's own sidecar, which says it raises `not_exact`. Not confirmed by a run in the tree before #429: see "Not determined". |
| 10 | `git log -S'("graph", "graph")'`, and the one-line change makes the file pass. Not confirmed by a run in the tree before #494: see "Not determined". |
| 12 | The one case passes at `c88d9ae1^1` and fails at `c88d9ae1` (#1555's merge), naming the load; at `dcf204a3^1`, before #1551, it names the load and not yet the window. |
| 13 | `git blame` of every reported line. |

## Clippy, by commit

123 `clippy::result_large_err` on `OpError`: deep-canvas 32, deep-canvas-test-modules 30, deep-canvas-marks 21, deep-canvas-scene3d 13, deep-show 9, deep-canvas-motion 8, deep-canvas-graph 3, deep-canvas-vector 3, deep-canvas-cells 2, and one each in deep-canvas-record and deep-canvas-sheet. All from `3541e3f3`.

The lines the audit named (two files of deep-canvas-marks share a commit, so it is four files there, not three):

| Line | Lint | Commit |
|---|---|---|
| `crates/deep-canvas/src/registry/core_lists.rs:863` | `type_complexity` | `9e1814ba`, #443, PR #1308 |
| `crates/deep-canvas-effects/src/fusion.rs:323` | `unused_mut` | `bb8bece6`, #432, PR #1734 |
| `crates/deep-canvas-marks/src/animator.rs:717` | `unused_variables` (`plant`) | `63803147`, #496, PR #1643 |
| `crates/deep-canvas-marks/src/drawn.rs:914` | `needless_range_loop` | `e124c644`, #149, PR #1563 |
| `crates/deep-canvas-marks/src/function.rs:757`, `implicit.rs:217` | `neg_cmp_op_on_partial_ord`, `needless_range_loop` | `e1a73286`, #505, PR #1751 |

The other 102: 9 are the `tests/acceptance/327` lines `known-failures.json` already lists, 3 are in `vendor/quickjs-jit-runtime`, and 90 more sit beside the six above in the same 42 commits, dated Oct 20 to Nov 9. By crate, all 108: deep-scene3d-render 22, deep-canvas-scene3d 16, deep-gpu-layer 14, deep-show 12, `tests/acceptance/327` 9, deep-canvas-motion 6, deep-canvas-media 5, deep-canvas-marks 4, `tests/acceptance/1141` 4, the vendored crate 3, deep-marks-render 2, deep-text-render 2, and one each in nine more. By lint, the most common are `chunks_exact_to_as_chunks` (26), `type_complexity` (13), `needless_range_loop` (10) and `manual_is_multiple_of` (8).

## Not determined

- **Row 11, the 4 frames.** The frames fall right after the settle point, which deep-show takes after 50 ms with no display-link callback or 300 ms idle (`LINK_QUIET`, `LINK_GRACE` in `crates/deep-show/src/watch.rs`). That fits a settle taken too early on a machine at load 60, and it fits a window-server event from another session's window. Neither was shown. The run that failed kept no `window` or `wakes` reading for its third run, and the rerun did not fail.
- **Row 9 and row 10 before their commits.** The cold Rust build for the tree before #494 was stopped after 55 minutes, with the machine's load at 387 from other sessions; the one for #429 was never started. Both attributions rest on `git log -S` and the code.
- **Row 3 before #33.** Not runnable on this Mac, as said above.
- **Whether row 3's four can't-pass cases should read `failed` or `uncounted`.** #1099 says a missing control makes the run INVALID; the test says a left-out failing test is a failure. One of the two has to give.
- **Not triaged here:** `packages/cli/test/cli.test.ts` (`BLOCKED`, no older Node), `854/patch`, `854/scene-read`, `896/dirty`, `896/settled`, and the two load flakes the audit names.

## Follow-ups seen, not done

- The ten pytest cases of row 2 and the hub suites have no guard for a missing tool, so a missing `pytest` or `cargo` reads as a failed assertion and not `BLOCKED`.
- A run's sandbox does not let Apple's `/usr/bin/python3` shim start. A user whose only Python is the Command Line Tools one gets `uncounted` for every pytest check.
- A `known-failures.json` entry needs an open issue. The six unfixed bugs have one each, filed Nov 9: #2081 (row 3), #2082 (row 4), #2083 (row 5), #2084 (row 6), #2085 (row 9), #2086 (row 13). No entry was added to the list. Rows 7, 8, 11 and 12 (the stale fixture, the two stale tests and the intermittent idle run) have no issue.
- Workspace clippy has been red since at least Oct 20 and nothing lists it, so `node scripts/affected.mjs` reports new lint failures for any change that selects the lint lane.

## What changed with this report

One file: `crates/deep-marks-render/src/lib.rs`, `drawn_here` gains `"graph"` and its doc comment says so. `tests/acceptance/399/place-route.test.ts` ran once with it on main at `7dd8cf19` and passed 3 of 3; the line was then wrapped as `rustfmt` wants, with no rerun, and it was not run again on this branch. No test, golden, fixture or known-failure list was touched.
