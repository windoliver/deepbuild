# Redrafted acceptance tests for #1426: AC2 and two Scope lines

This folder is the blind redraft of two of #1426's tests: AC2, "Each row's test fails with that row's change reverted, for the sRGB layer tag, the exact gradient mode, the BGRA surface and the surface reports" (`#1426.eb2029f7`), and the Scope test that the first draft tags under AC1 (`#1426.4ef6dcfa`), for two Scope lines: the README records zed's refusal, and the design's line on patches is corrected. It adds files and edits none. Per AGENTS.md the implementing agent doesn't edit them.

## What this job read

- Issue #1426's text in full, as `gh issue view 1426 -R windoliver/deepbuild` gave it on November 7, 2026: Scope, the ten criteria, Proof, Depends on.
- At the base commit `c12a65bb`: `AGENTS.md`; the Dogfooding bullet of `docs/technical-design.md` and its "The app's toolkit" Decided row; a search of `docs/canvas-primitives.md` for the GPUI patch; `vendor/` (each crate's `Cargo.toml` and `build.rs`, `vendor/gpui-pre-apple/upstream/README.md`, and the carried code in `metal_renderer.rs`, `shaders.metal` and both `color.rs`); `.cargo/config.toml`, the workspace `Cargo.toml`, `Cargo.lock` and `rust-toolchain.toml`; the manifests of the four crates that depend on `gpui-pre-apple` (`deep-app`, `deep-gpu-layer`, `deep-marks-render`, `deep-show`); `scripts/lanes.mjs` (`named`, `testGlobs`, `reporting`, `reportResults`, `cargoResults`), `scripts/proof-change.mjs` (the tag and `criterionId`), `scripts/proof-reporter.mjs`, `scripts/proof-vitest-reporter.mjs` and `scripts/lease`; the conventions of `tests/acceptance/882`; the heads and helpers of `tests/acceptance/140/gpu/color.live.test.ts`, `391/gradient.test.ts` and `377/helpers.ts`.
- The pinned releases: `gpui-pre` 0.3.9 and `gpui-pre-apple` 0.3.9 from static.crates.io, diffed against `vendor/`; and, from cargo's own cache, gpui-kit's workspace manifest at the pinned rev `1676826` and the 0.3.9 manifests of `gpui-pre-macos` and `gpui-pre-platform`, to see which features the workspace really turns on.
- From the first draft, only `../README.md`, `../common.mjs` and `../tree-judge.mjs`. This folder keeps their surface: the table's heading and columns, a Test cell as `` `<repo path> › <test name>` ``, a test run by its extension, the tags.

**What reached me that I shouldn't use, and didn't.** This worktree started at `9f2f5507`, not the base. Before I checked out `c12a65bb` (detached), one `git diff --stat c12a65bb HEAD | tail -3` printed a stat line showing a later commit adding 21 lines to `vendor/gpui-pre/src/window.rs`. No test here reads `window.rs` (it holds #390's mask sprite, not one of AC2's four behaviors). The first draft's README, which I was allowed to read, describes its four reverts in one line, and my reverts land on the same four places; I chose each from the base's code (below). This job's brief asked me to work out what the build needs from the manifests rather than a crate's defaults. Nothing describing #1426's implementation, or why a test was disputed, reached me.

## The surface

- **The table.** `vendor/gpui-pre-apple/upstream/README.md`, under the heading `## Carried patches`, holds one Markdown table with the columns `Behavior | Issue | Files | Test | Budget` (the first draft's). Files are repo paths in backticks. A Test cell is `` `<repo path> › <test name>` ``, the repo's way of naming a test (`named` in `scripts/lanes.mjs`).
- **The four rows.** A row is one of AC2's behaviors when its Behavior cell matches:

  | Behavior | Its row's Behavior cell matches |
  |---|---|
  | the sRGB layer tag | `/sRGB/i` and `/layer\|tag/i` (so an exact-gradient row that mentions the sRGB curve isn't taken) |
  | the exact gradient mode | `/exact gradient\|OklabExact/i` |
  | the BGRA surface | `/BGRA/i` |
  | the surface reports | `/surface/i` and `/report/i` |

  When several rows match one behavior, the ones matching no other behavior stand for it; one row for the BGRA surface and its reports stands for both and is judged under both reverts.
- **Running a row's test**, in the copy's root: `.test.mjs` under `node --test --test-name-pattern=<its last name part>`, `.test.ts` under the tree's own vitest with `-t <its last name part>`, `.rs` under `cargo test --locked -p <the crate whose Cargo.toml holds the file> -- <name>`. Results come from the repo's own reporters and readers (`reporting`, `reportResults`, `cargoResults` in `scripts/lanes.mjs`). The named test is the result whose full name is the cell's name, ends with it, or is a suite holding it; for Rust, whose path is the name or ends with `::<name>`.

## How each criterion is read

### AC2 (`reverts.test.mjs`, `reverts-judge.mjs`)

"Each row's test fails with that row's change reverted" is read as: the row's test passes on the tree as it stands and fails once that behavior alone is reverted, both runs on a private copy, never the checkout.

1. With no table, a missing row, a row with no test or with a test file that isn't there: FAIL, naming it. This reads only the checkout, on any machine.
2. Each behavior's revert is an edit of the `.rs` or `.metal` files its row lists. If it matches nothing there: INCONCLUSIVE, naming the row, the files and the edit, since the code may have moved past the edit's pattern; a redraft updates the pattern.
3. Off macOS: INCONCLUSIVE. The four behaviors are `gpui-pre-apple`'s Metal renderer, which builds for macOS and iOS only.
4. The copy: the working tree as it stands (uncommitted work included) under `/tmp/da1426r-copy-*/tree`, without `.git` and `target/`, each `node_modules` linked to the checkout's, and a fresh git repository holding the tree as one commit. Cargo builds in the copy's own `target/`, so no sibling build can swap a binary. The copy is removed at the end; nothing is written to the checkout.
5. Each row's test runs as the tree stands, once per test. It must pass. A failure, a build failure, or a name that runs no test: FAIL, naming the row and the test, with the output's tail.
6. Then, per row and behavior, the revert is written into the copy, the test runs, and the files are put back. It must fail. A pass: FAIL ("still passes with ... reverted"). A failure in a build (`error[E…]`, `could not compile`): INCONCLUSIVE, since a revert that doesn't build proves nothing about the behavior. A test that no longer runs: INCONCLUSIVE.
7. A run that is skipped, fails with a message starting `INCONCLUSIVE`, `BLOCKED` or `INVALID`, times out (6 hours a run), or whose output shows the machine lacks something (no `metal` compiler, no network for cargo, no cargo, a missing node module or built package): INCONCLUSIVE, naming it. Nothing unrun passes.

The reverts, each checked on the base by `wrong.test.mjs` to touch only its behavior's lines, and together checked to build: on a copy of the base with all four applied, `cargo test --locked -p gpui-pre-apple --lib` builds and its 15 tests pass, `render_core_video_surface` among them, which compiles the reverted shader library at run time.

| Behavior | Revert | Why this edit |
|---|---|---|
| the sRGB layer tag | each `.setColorspace(<arg>)` in the row's `.rs` files becomes `.setColorspace(None)` | The tag is the call's argument. `None` is the nil colorspace GPUI alone leaves the layer with, as #140's own color test reads it ("GPUI alone leaves the window's CAMetalLayer untagged") and as the base's planted twin sets it. Dropping the call instead would leave the layer to whatever AppKit gives it, which the patch's comment says is sRGB on macOS 26, so the revert would change nothing a test could see. |
| the exact gradient mode | in the row's `.metal` files, each `color_space == 2` becomes `== 1002` and each `case 2:` inside a `switch` on `color_space` becomes `case 1002:`; each `color_space == 1` becomes `(… == 1 \|\| … == 2)` and each `case 1:` there `case 1: case 2:` | The exact branches become unreachable and the exact mode draws as Oklab, the nearest mode the release has. Without the fold, color space 2 would reach no branch and draw an unset color, which any gradient test fails, so the run would prove nothing about exactness. The Rust variant `ColorSpace::OklabExact` stays, since `deep-marks-render` names it and removing it wouldn't build. The background tag's own `case 2` (the pattern fill) is left alone. |
| the BGRA surface | each `if <condition naming kCVPixelFormatType_32BGRA> {` in the row's `.rs` files becomes `if false && (<condition>) {`; a match arm `kCVPixelFormatType_32BGRA =>` gets `if false` | A BGRA surface falls through to the release's 4:2:0 path, whose `assert_eq!` on the pixel format stands again. |
| the surface reports | each `<…>.sampled_surfaces.push(<…>)` in the row's `.rs` files becomes `()` | No frame records a sampled buffer, so no `Encoded` report goes out and no `Completed` one follows: the release reports nothing. |

### The Scope lines (`scope.test.mjs`, `scope-judge.mjs`), under AC1's tag

- **The refusal.** One paragraph of the README (blank-line separated) holds the link `https://github.com/zed-industries/zed/pull/66114`, the date (`October 28, 2026`, `Oct 28, 2026`, `28 October 2026` or `2026-10-28`) and a word saying zed refused it: refused, declined, rejected, unmerged, not merged, without merging, won't merge. "Closed" alone isn't one, since a merged pull request is closed too. And no sentence about the pull request calls it open now: `is`, `remains`, `stays` or `still` followed by `open` or `ready for review`. A history in the past tense ("was open") passes.
- **The design's line.** `docs/technical-design.md` has exactly one row starting `| The app's toolkit |`. It doesn't call a patch the only, sole or single one, and it names the vendored GPUI patches: it says `gpui-pre`, as `vendor/gpui-pre` or `gpui-pre-apple`. At the base the row says neither.

## How to run

From the repo root, on Node 24, after `npm ci` and `npm run build --workspaces`:

```sh
node --test tests/acceptance/1426/redraft/scope.test.mjs    # the two Scope lines; fast
node --test tests/acceptance/1426/redraft/reverts.test.mjs  # AC2; heavy, see below
node --test tests/acceptance/1426/redraft/wrong.test.mjs    # the judges against wrong programs; passes at the base
```

The `.mjs` files sit outside the unit lane's patterns (`tests/*.test.mjs` only), as #882's do; the proof lanes run them as tagged tests.

### What the AC2 test needs

Worked out from the base's manifests, lockfile and build scripts, and checked on this Mac:

- **macOS with a Metal device.** `gpui-pre-apple` is `#![cfg(any(target_os = "macos", target_os = "ios"))]`.
- **cargo** on PATH (`rust-toolchain.toml` pins 1.99.1, through rustup), with the crates `Cargo.lock` names in cargo's cache or the network to fetch them (`--locked`). In a sandbox without network a cold fetch reads INCONCLUSIVE.
- **No Metal shader compiler, and so no full Xcode.** `gpui-pre-apple`'s `build.rs` runs `xcrun -sdk macosx metal` only without its `runtime_shaders` feature, and no build in this workspace leaves that feature off: gpui-kit's workspace manifest at the pinned rev declares `gpui_platform = { package = "gpui-pre-platform", features = ["font-kit", "x11", "wayland", "runtime_shaders"] }`, `gpui-pre-platform` 0.3.9 forwards it as `runtime_shaders = ["gpui_macos/runtime_shaders"]`, and `gpui-pre-macos` 0.3.9 as `runtime_shaders = ["gpui_apple/runtime_shaders"]`. Every workspace crate that depends on `gpui-pre-apple` reaches gpui-kit too (through `deep-app`), and `cargo test -p gpui-pre-apple`, a path dependency outside the workspace's members, resolves with the workspace's features. With the feature on, `build.rs` stitches `shaders.metal` into `OUT_DIR` and the library compiles at run time through Metal.framework. Checked here, with Command Line Tools only (`xcrun --find metal` fails): `cargo test --locked -p gpui-pre-apple --lib` builds with the features `default, font-kit, runtime_shaders, test-support` and passes 15 of 15. Should a future build compile shaders ahead of time, its `unable to find utility "metal"` reads INCONCLUSIVE, naming full Xcode.
- **node_modules and the built workspaces** for a `.test.ts` row test (the tree's vitest) and for whatever a row's test imports.
- **What each row's test needs itself.** The judge passes this environment through. For instance #140's color check (`tests/acceptance/140/gpu/color.live.test.ts`) opens a window and runs only with `DEEP_140_LIVE=1` on a Mac with a screen; otherwise that test, and so AC2, reads INCONCLUSIVE.
- **Time and disk.** A copy of the tree (about 185 MB without `target/` and `node_modules`) plus its own cold `target/`: each row's test builds what it builds from cold, and each revert rebuilds what depends on the edited vendored crate. With the four rows naming `gpui-pre-apple`'s own unit tests, a planted run on this Mac took 45 s; tests that build `deep-app` or `deep-gpu-layer` take far longer when cold.

## Criteria, tests and wrong programs

| ID | Criterion | Test | Wrong programs it fails on (`wrong.test.mjs`) |
|---|---|---|---|
| `#1426.eb2029f7` | AC2: Each row's test fails with that row's change reverted, for the sRGB layer tag, the exact gradient mode, the BGRA surface and the surface reports | `reverts.test.mjs` | On planted trees holding the base's carried files: a row test that reads nothing, one that fails as the tree stands, a test name that runs nothing, a row with no test, a test file that's gone, no table (the base's README), no row for one behavior: each FAIL, naming it. A row whose files hold none of its behavior, a row test that says INCONCLUSIVE, one that is skipped, a revert under which the build fails, a machine lacking what the runs need: each INCONCLUSIVE, never a pass. Controls: four rows whose tests fail under their reverts pass, the tree judged is left byte for byte as it was, and one row for the BGRA surface and its reports passes when its test fails under both. The reverts match the base's carried code and change only their lines, and match nothing in a file without the behavior. The runner reads a real vitest test and a real cargo test: pass, fail, INCONCLUSIVE, a name that runs nothing, a crate that doesn't build |
| `#1426.4ef6dcfa` | AC1's tag, for the Scope lines: the README records the refusal with its date and link; the design's line on patches is corrected | `scope.test.mjs` | From `git show c12a65bb:<path>`: the base README; a refusal added beside the open sentence; the open sentence gone with no refusal; the link and date with "closed" alone; the wrong date; the date and word apart from the link; "still open" in other words. The base design row; "the only patch" dropped with nothing named; the GPUI patches named with "the only patch" kept; "the sole patch"; no toolkit row. Controls: the refusal in place of the open paragraph, and in other words with a Markdown link and an ISO date; a corrected design row |

## What the base commit has

At `c12a65bb` each tagged test fails for a missing surface (`BASE-FAILURE.txt`): AC2 finds no carried-patch table; the refusal test finds no paragraph with the link and the date, and "The pull request is open and ready for review"; the design test finds "the only patch, rquickjs to that same commit" and no `gpui-pre`. `wrong.test.mjs` passes, 33 of 33, in about ten seconds.

## Assumptions a redraft may revisit

- **The reverts are edits of the carried code's text.** If the implementer reshapes that code past their patterns (a named constant for color space 2, the BGRA check moved into a `match` on a variable, the push renamed), AC2 reads INCONCLUSIVE naming the row and the edit, and a redraft updates the pattern. They never pass a row they can't apply.
- **A revert is behavioral, not a restore of the release's bytes.** Restoring a row's hunks would remove items other code names (`ColorSpace::OklabExact`, `gpu_surfaces`), and a test failing on a build proves nothing. Each revert keeps the tree building and is checked to.
- **The sRGB revert is `None`, not a dropped call**, for the reason in the table above.
- **The Behavior patterns** are mine, kept loose. A row named so that none matches (say "Colorspace on the window layer") fails AC2 as a missing row.
- **The copy's git holds one commit.** A row test that reads the repository's history (a merge base, `origin/main`) can't see it in the copy and would fail as the tree stands. None of the tests a row would plausibly name (#140's color check, #391's gradient, #377's handoff, `gpui-pre-apple`'s unit tests) reads history.
- **"Names the vendored GPUI patches"** is read as naming `gpui-pre` in the toolkit row; a row that points only to "the patches in `vendor/`" fails.
- **"No longer calls the pull request open"** is read on present-tense status sentences about the pull request; one saying "the pull request is open" in other words than those listed would pass.
