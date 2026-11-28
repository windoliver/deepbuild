# Blind redraft of #3625 AC1: the vendored 0.1.19 trees compile and `check` passes on their touched `src/fast/` files

Criterion `#3625.a44f8c65` (`#3625.` and the first 8 hex of SHA-256 of the criterion's trimmed, whitespace-collapsed text, as `scripts/proof-change.mjs`'s `criterionId` computes it):

> `cargo check -p gpui-fast -p gpui-fast-apple -p gpui-fast-macos --all-targets` passes on the vendored 0.1.19 trees with both default and `test-support` features enabled, and `node scripts/vendor-rebase.mjs check` passes on every touched `src/fast/` file

Written blind from issue #3625, the issues it links (#3618, #3622, #1433, #1434, #124, #391, #390, #241, #3629), `node scripts/design-section.mjs --issue 3625` and the base `0beb4a141` (the files read were `AGENTS.md`, `GLOSSARY.md`, `scripts/vendor-rebase.mjs`, the carried-patch table, the three vendored trees, `scripts/lease`, `scripts/proof-change.mjs` and #3622's suite for its conventions). No implementation of #3625 was read.

## The surface (my choices where the issue names none)

- **Where `cargo check` runs.** No workspace of ours builds on `gpui-fast` until #3630, and `vendor/gpui-fast-apple` and `vendor/gpui-fast-macos` depend on `gpui-fast` and `gpui-fast-apple` from crates.io. So the test copies the three vendored trees (without `target/` or `.git`) into a scratch workspace under the system temp folder, with the three as members, `[patch.crates-io]` pointing `gpui-fast` and `gpui-fast-apple` at the copies, `vendor/gpui-fast-macos/Cargo.lock` as its lock, and `gpui-fast`'s own empty `[workspace]` table dropped from its copy. It runs the criterion's command there, through `scripts/lease`, with `CARGO_INCREMENTAL=0`, `CARGO_PROFILE_DEV_DEBUG=0`, its own target folder and `--message-format=json`.
- **"Both default and `test-support` features enabled"** is read as one run with both sets on at once: the crates' default features, which are not turned off, plus `gpui-fast/test-support`, `gpui-fast-apple/test-support` and `gpui-fast-macos/test-support`. I first drafted two runs, one with defaults alone and one with defaults plus `test-support`. The pristine 0.1.19 releases showed that reading can't be met: their library tests use `test-support` items (`TestAppContext`, `proptest`, `postage`) and the releases declare no dev-dependencies, so `--all-targets` with defaults alone fails before any carried line. `--keep-going` is added so one failing crate doesn't hide another crate's errors. It doesn't change whether the run passes.
- **No Metal compiler.** When `xcrun --find metal` fails, as on a Mac with Command Line Tools only, both runs add `gpui-fast-apple/runtime_shaders`, the base's way to leave the shaders to run time while still compiling every Rust file.
- **What passing means for cargo.** The build finishes with success, no `compiler-message` at level `error` appears, and each of the three crates shows a library artifact and a library-test artifact (the latter is what `--all-targets` adds). An error is reported as `vendor/<crate>/<file>:<line>: error[<code>]: <message>`. A build that fails with no compiler error (no grant within `DEEP_LEASE_WAIT`, the network, a build script) is `INCONCLUSIVE`, which never passes.
- **"Every touched `src/fast/` file"** is every file under `src/fast/` of the three trees whose bytes differ from the pristine 0.1.19 release, or which the release lacks. The releases are fetched from `https://static.crates.io/crates/<crate>/<crate>-0.1.19.crate` into the test's own temp folder. This counts what #3622 already carried into `src/fast/` as well as what #3625 adds, so it is a superset of this task's own files. If no file is touched, the test fails: nothing was judged.
- **What passing means for `check`.** `node scripts/vendor-rebase.mjs check` runs on the real checkout, which may fill `~/.cache/deepbuild/vendor-releases` as the script itself does. For each touched file, the test fails on any `FAIL`, `BLOCKED`, `INVALID` or `INCONCLUSIVE` line that names the file, and on any `FAIL row <issue> <behavior>:` line for a row of the carried-patch table whose Files cell lists it. The test also fails if `check` printed `BLOCKED` for any of the three crates, or printed no `ROW` line for such a row, because then the file was never judged. `check`'s exit code alone isn't the verdict: lines about other trees and rows are outside this criterion. A row line ending `its suite gave no list` means `check` could not list that row's test. That happens when `node_modules/vitest` is missing or the suite doesn't load, so it is `INCONCLUSIVE` rather than a pass.

## What the criterion asks beyond `src/fast/` (for the owner)

The criterion's command fails on the pristine 0.1.19 releases themselves, before any carry. These are the errors from the same scratch workspace built from the static.crates.io releases, with defaults plus `test-support` (see `BASE-RUN.txt`):

- `gpui-fast/src/platform.rs` and `src/svg_renderer.rs` `include_bytes!` an example image and two fonts from outside the published package (`examples/image/…`, `../../../assets/fonts/…`).
- `gpui-fast/src/style.rs` imports `util_macros`, a dev-dependency the release doesn't declare.
- `gpui-fast-apple/src/fast/layers/tests.rs` includes `../../../../gpui/src/fast/rounded_clip_fixtures.rs`, a path in the upstream repo's layout.

On the vendored base, the run also fails outside `src/fast/` in #3622's own port. `gpui-fast-apple/src/metal_renderer/chrome_layers.rs:36` imports `objc2_metal::MTLSampler*`, and the manifest's `objc2-metal` features don't enable those items. Inside `src/fast/`, it fails on E0004 at `gpui-fast/src/fast/scene.rs:182` and `src/fast/tests/layers.rs:226,241` (`PaintOperation::StartChrome` / `EndChrome`). `gpui-fast-apple`'s and `gpui-fast-macos`'s own `src/fast/` sites aren't reached, because `gpui-fast-apple` stops at name resolution.

So a passing tree must also carry fixes for these test-only sites, each marked and listed in the carried-patch table, alongside #3625's match sites. The test doesn't exempt them, because the criterion's words don't.

## How to run

From the repo root, on Node 24, with cargo on PATH or at `/opt/homebrew/opt/rustup/bin`:

```sh
node --test tests/acceptance/3625-redraft-ac1/ac1.test.mjs     # the criterion; network, a build grant, minutes when cold
node --test tests/acceptance/3625-redraft-ac1/twins.test.mjs   # the judges against planted wrong programs; offline, passes at the base
```

For a real reading of `check`'s rows, Vitest must be able to list the rows' `.ts` tests. That needs `npm ci` and the workspace packages built (`npm run build --workspaces`), because `vitest.config.ts` resolves `@deepbuild/*` packages from their `dist/` folders. Every copy and build goes under the system temp folder and is removed when the process exits.

## Wrong programs it fails on

| Wrong program | Where shown |
|---|---|
| The base: the carry's new enum variants and `Hitbox` field unhandled in `src/fast/` | `BASE-RUN.txt` (real cargo run) |
| A non-exhaustive match on `PrimitiveBatch` in `gpui-fast-apple/src/fast/frame.rs` (E0004) | `twins.test.mjs` |
| A `Hitbox` built without `element` in `gpui-fast/src/fast/layers/input.rs` (E0063) | `twins.test.mjs` |
| A check with default features turned off, all features on, or a crate's `test-support` left out | `twins.test.mjs` |
| A check without `--all-targets` (no library tests), or one that leaves out `gpui-fast-macos` | `twins.test.mjs` |
| A failed build with no compiler error, or no build at all: `INCONCLUSIVE` | `twins.test.mjs` |
| An unmarked hunk, an over-budget hunk or file, a new file with no row, a row whose file holds none of its hunks, or a row with no removal condition, each on a touched `src/fast/` file | `twins.test.mjs` |
| `check` blocked on a tree, or dying before it judged a touched file's row, or no touched file at all | `twins.test.mjs` |
| A row's test that can't be listed: `INCONCLUSIVE`; failures on other trees and rows don't count | `twins.test.mjs` |

`TWINS-RUN.txt` holds the twins run.
