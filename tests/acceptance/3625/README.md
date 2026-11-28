# Acceptance tests for #3625: gpui-fast's own matches and retained hitbox elements

These tests cover #3625's three criteria on the vendored `gpui-fast`, `gpui-fast-apple` and `gpui-fast-macos` 0.1.19 trees: the three crates check with default features and with `test-support`, `vendor-rebase.mjs check` passes on every touched `src/fast/` file, no carried `src/fast/` match hides a carried variant behind a catch-all arm, a planted `PrimitiveBatch` variant fails to compile in `gpui-fast-apple`'s `src/fast/frame.rs`, and `Window::hits_at` on a view replayed from retention names the same `Hitbox::element` as a refreshed frame.

They were written blind from issue #3625 (Scope, the three criteria and Proof), the issues it links (#3618, #3622, #1433, #1434, #124, #391, #390, #241, #3629), `node scripts/design-section.mjs --issue 3625` (the Decided row "The app's toolkit" with #3618's fast-backend paragraph, and canvas-primitives' GPU surface) and the base commit `0beb4a141`. From the base I read `AGENTS.md`, `GLOSSARY.md`, `scripts/vendor-rebase.mjs`, the carried-patch table in `vendor/gpui-pre-apple/upstream/README.md`, the three vendored trees (their `src/fast/` match sites, `Hitbox`, `Window::hits_at`, `Window::reuse_prepaint`, `splice.rs`'s `copy_prepaint_segment`, `layers/input.rs`'s hitbox copy and `retained.rs`'s retention switch), `scripts/lease`, `scripts/throttle.mjs`, `scripts/proof-change.mjs` (`criterionId`) and `tests/acceptance/3622/` (its ideas, not its files). No implementation of #3625 was read. Per AGENTS.md the implementing agent doesn't edit these files; a dispute goes to a blind redraft of this job.

## Criterion IDs

`#3625.` and the first 8 hex of SHA-256 of each criterion's trimmed, whitespace-collapsed text, as `scripts/proof-change.mjs`'s `criterionId` computes it.

| ID | Criterion | File |
|---|---|---|
| `#3625.a44f8c65` | AC1: `cargo check -p gpui-fast -p gpui-fast-apple -p gpui-fast-macos --all-targets` passes on the vendored 0.1.19 trees with both default and `test-support` features, and `vendor-rebase.mjs check` passes on every touched `src/fast/` file | `ac1-vendored-check.test.mjs` |
| `#3625.ef5828e4` | AC2: every carried `src/fast/` site matching a carried enum variant handles it explicitly (no catch-all `_` arm added); a planted `PrimitiveBatch` variant fails to compile in `src/fast/frame.rs` | `ac2-explicit-arms.test.mjs` |
| `#3625.406aa15e` | AC3: with view retention on, `Window::hits_at` on a replayed view returns the same `Hitbox::element` as on a refreshed frame; a planted replay that drops `Hitbox::element` fails, naming the hit | `ac3-retained-hits.test.mjs` with `retained_hits.rs` |

`twins.test.mjs` holds the planted wrong programs that prove the AC1 and AC2 judges fail when they should (`TWINS-RUN.txt`); AC3's plant is part of its criterion, so it runs in `ac3-retained-hits.test.mjs`.

## The surface (my choice where the issue names none)

- **The vendored trees reached by cargo.** The workspace still builds on `gpui-pre`, so each cargo run is in a scratch folder under the system temp folder: a copy of the three trees at `vendor/<crate>`, where the repo holds them (so a source's relative `include_bytes!` or `#[path]` reaches what it would reach in the repo), as members of a workspace of their own at the folder's root, with `[patch.crates-io]` pointing `gpui-fast`, `gpui-fast-apple` and `gpui-fast-macos` at the copies and `vendor/gpui-fast-macos/Cargo.lock` as its lock. `vendor/gpui-fast/Cargo.toml`'s own empty `[workspace]` table (#390's carried line) is taken out of the copy only, so the three can be members. No `.git` is copied.
- **Features.** Default is no `--features`; `test-support` is `--features gpui-fast/test-support,gpui-fast-apple/test-support,gpui-fast-macos/test-support`. On a Mac with no Metal shader compiler (`xcrun --find metal` fails) both add `gpui-fast-apple/runtime_shaders`, the base's way to compile every Rust file with the shaders left to run time.
- **Cargo** runs only through `scripts/lease` (a build grant of the machine's throttle table, waiting at most 30 minutes), with `CARGO_INCREMENTAL=0`, `CARGO_PROFILE_DEV_DEBUG=0`, `--message-format=json` (AC1's checks add `--keep-going`, so one crate's failure doesn't hide another's) and `CARGO_TARGET_DIR=<tmp>/da3625-target`, one folder the four files share so their dependencies build once; it is left in place after a run and may be deleted. A compile error is judged by its primary span, named as `vendor/<crate>/<file>:<line>`; a failed build with no compiler error (a build script, the network, no grant) is `INCONCLUSIVE`, never a pass.
- **`vendor-rebase.mjs check` on every touched `src/fast/` file.** `check` runs in a scratch copy holding `scripts/`, the three trees, the carried-patch README and `package.json`, with `DEEP_VENDOR_RELEASES` naming the pristine 0.1.19 `.crate`s fetched from `static.crates.io` that run. The judge reads only the `FAIL` lines that name a `vendor/gpui-fast{,-apple,-macos}/src/fast/` path, and a `BLOCKED` line for a gpui-fast tree is `INCONCLUSIVE`. Row-level lines about rows' tests (the copy has no `node_modules` and no other vendored trees) aren't read: they judge the table, not the `src/fast/` files.
- **A carried `src/fast/` site** is a `match` in a `.rs` file under `src/fast/` of one of the three trees whose arm patterns name `PrimitiveBatch::`, `Primitive::`, `PaintOperation::` (with the chrome operations `StartChrome` / `EndChrome`), `ColorSpace::` or `AtlasKey::`, in a file that differs from its 0.1.19 release. **A catch-all arm added** is an arm whose pattern is `_` or a bare lowercase binding, with or without a guard, on a line `git diff -U0` against the release counts as added (a file the release lacks is all added). Upstream's own catch-alls are left alone: the criterion forbids adding one.
- **The planted variant.** `Planted3625,` is added as the first variant of `pub enum PrimitiveBatch` in the copy's `gpui-fast/src/scene.rs`. `gpui-fast` must compile for `gpui-fast-apple` to be reached, so each `E0004` in `gpui-fast` naming the variant gets the arm rustc's own suggestion gives (at most six rounds); any other `gpui-fast` error fails the test. Then `cargo check -p gpui-fast-apple --lib` must report an error whose primary span is in `src/fast/frame.rs` and whose message names `Planted3625`. A `gpui-fast-apple` that stops at another error first (an unresolved import ends rustc before match checking) fails too: its `frame.rs` was never shown to reject the variant.
- **The retained-hits test** is `retained_hits.rs`, a Rust integration test on `gpui-fast`'s public test API. The node test copies `vendor/gpui-fast` to a scratch folder, adds the file as `tests/retained_hits.rs` with a `[[test]]` entry needing `test-support`, and runs `cargo test --features test-support --test retained_hits` with `GPUI_VIEW_RETENTION` unset. A window holds a label view and a target view (a 120 × 40 clickable div `target` holding a 20 × 20 div `inner` with a mouse-down listener). With `set_view_retention(true)` it draws, then refreshes, draws and reads `hits_at((10, 30))` in one window update (so no other frame comes between), asserting the target view rendered on that frame; then it changes the label and draws, and notifies the root and draws, each time asserting the target view was not rendered (its render count is unchanged, so it was replayed) and that each hit's `Hitbox::element` equals the refreshed frame's, hit by hit. A mismatch fails with `the hit at (10px, 30px) on a frame replayed from retention <cause>: hit <i> names the element `<replayed>` where a refreshed frame names `<refreshed>``.
- **The planted replay** rewrites, in the copy's `src/`, every `rendered_frame.hitboxes[..].iter().cloned()` (the base's `Window::reuse_prepaint` and `splice.rs`'s `copy_prepaint_segment`) to clone each hitbox with `element: Default::default()`. The test must then fail, its panic naming the hit at (10px, 30px) and the refreshed element (`…inner` or `…target`).

## How to run

From the repo root, on Node 24, with the network (pristine releases and crates) and cargo:

```sh
node --test tests/acceptance/3625/ac1-vendored-check.test.mjs   # AC1: two workspace checks of the three crates, then vendor-rebase check
node --test tests/acceptance/3625/ac2-explicit-arms.test.mjs    # AC2: the arm judge (seconds), then the planted-variant check of gpui-fast-apple
node --test tests/acceptance/3625/ac3-retained-hits.test.mjs    # AC3: cargo test of retained_hits.rs, kept then planted
node --test tests/acceptance/3625/twins.test.mjs                # the judges' wrong programs
```

Each cargo step waits for a build grant and takes minutes when cold; that is load, not failure.

## The wrong programs each test fails on

| Test | Fails on |
|---|---|
| AC1 compile | any compiler error in the three crates under either feature set; twin: `layers/input.rs`'s copy of a hitbox with its `element` field left out (the #124 struct-field site), which fails the `test-support` check naming `vendor/gpui-fast/src/fast/layers/input.rs` |
| AC1 check | a `FAIL` naming a touched `src/fast/` file; twin: a line added at line 4 of an untouched `src/fast/` file no row lists, which `check` names as `<path>:4: no row` |
| AC2 arms | a catch-all arm added to a carried match; twin: `frame.rs`'s `PrimitiveBatch::Chrome(_) =>` arm turned into `_ =>`, named at its line |
| AC2 planted variant | a `frame.rs` match over `PrimitiveBatch` that swallows a new variant, and a `gpui-fast-apple` that stops at other errors before `frame.rs` is checked. Since the base's `gpui-fast-apple` doesn't compile (below), this judge's twin is judged on cargo messages written to stand for each case: a build that succeeds with the variant, an `E0004` only outside `frame.rs`, and an unresolved import, with an `E0004` in `frame.rs` as the control |
| AC3 | a replay that drops `Hitbox::element` (the criterion's own plant); a fixture whose target view is rendered instead of replayed; hits that don't name the target and its inner box on the refreshed frame |

## What the base commit has

`BASE-RUN.txt` holds the run at `0beb4a141`, on this Mac with no Metal compiler (so `runtime_shaders`).

- **AC1 compile fails**, for reasons the base lacks: in `gpui-fast`, `src/fast/scene.rs:182` and `src/fast/tests/layers.rs:226,241` don't match `PaintOperation::StartChrome` / `EndChrome` (E0004, under `test-support`); `gpui-fast-apple`'s carried `src/metal_renderer/chrome_layers.rs:36` imports `objc2_metal` sampler types its manifest's features don't enable (E0432, under both); and `gpui-fast`'s and `gpui-fast-apple`'s own test targets don't build from the vendored trees (default features: `proptest`, `postage`, `futures_concurrency` missing without `test-support`; both: `include_bytes!` of `examples/` and `assets/fonts/` files the release doesn't ship, `util_macros`, and `gpui-fast-apple`'s `src/fast/layers/tests.rs` including a `gpui/src/fast/rounded_clip_fixtures.rs` that isn't there). `gpui-fast-macos` is never reached. **AC1 `vendor-rebase.mjs check` passes**: no `FAIL` names a `src/fast/` file.
- **AC2 arms pass** (24 carried sites, no catch-all added). **AC2 planted variant fails**: `gpui-fast` compiles once rustc's arm goes into `PrimitiveBatch::label`, but `gpui-fast-apple` stops at the E0432 above, so `frame.rs` is never shown to reject the variant.
- **AC3 passes on the base**: #3622's port already keeps `Hitbox::element` on a replay (the copies clone it, and `layers/input.rs` carries it by hand), so the base has this behavior; the criterion's plant fails it, naming the hit at (10px, 30px) and the refreshed element `…target.inner`.

`TWINS-RUN.txt` holds the twins, 4 of 4 failing their judge as they should.

## Assumptions a redraft may revisit

- **"Touched `src/fast/` file"** is a `src/fast/` file that differs from its 0.1.19 release; `check`'s row-level verdicts on tests it can't list are left to #3622's own suite.
- **Upstream's catch-alls stay.** Five `src/fast/` matches of 0.1.19 already end in `_` over `Primitive`, `PaintOperation` or `PrimitiveBatch` (for example `layers/overlay.rs`, `rounded_clip.rs`); the criterion's words are "no silent catch-all `_` arm added", so only added ones fail.
- **The planted variant is reached through `gpui-fast`.** Its own exhaustive matches (such as `PrimitiveBatch::label`) get rustc's suggested arm in the copy, since a variant `gpui-fast` itself can't compile would never reach `frame.rs`.
- **Replay covered** is the target view replayed after a sibling changed and after the view holding it rendered again; which of the base's two copy sites (`reuse_prepaint`, `copy_prepaint_segment`) each takes wasn't told apart, since the plant changes both. A scroll layer's own hitbox copy (`layers/input.rs`) is covered by AC1's `test-support` compile and its twin, not by a replay test.
