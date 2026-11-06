# Acceptance tests for #995: the canvas panel drops pictures no shown revision uses

Written first, blind, from issue #995 (its text as of November 4, 2026: the problem, Scope, the one acceptance criterion,
Proof and Depends on #806), from `docs/technical-design.md` (Panels and devices (trusted ring), which the issue links;
How we know version 0 works and Dogfooding), and from the base commit `e2e6e1cc` (`origin/main`): the panel itself,
`crates/deep-app/src/show.rs` (`CanvasPanel`, `present`, `picture()`, its `Render`), the app's headless context and the
headless canvas panel in `crates/deep-replica` (`src/lib.rs` `headless_context`, `src/canvas.rs`), the app's own
offscreen suite `crates/deep-app/screens.rs`, GPUI's headless context and atlas in `vendor/gpui-pre`
(`capture_screenshot`, `simulate_scale_factor_change`, `present_frame`, `Window::drop_image`), and the earlier blind
suites `tests/acceptance/1141` (a memory criterion in a test binary of its own) and `tests/acceptance/806` (the panel's
own suite; how a suite handles macOS-only drawing). Nothing of #995 is implemented at the base, and no implementation
of it was read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft
of this job.

## How to run

From the checkout, with cargo (set `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0` on a shared machine). The dev
profile is enough: what the panel holds per picture doesn't depend on the build.

```sh
cargo test --locked -p deep-app --test acceptance_995
# one verdict only (both come from the same run): any part of its name
cargo test --locked -p deep-app --test acceptance_995 -- keeps_memory
cargo test --locked -p deep-app --test acceptance_995 -- gpus_copies
```

- `crates/deep-app/Cargo.toml` wires it as `[[test]] acceptance_995` with `harness = false` (AppKit wants the main
  thread for the offscreen renderer, as `screens` and deep-replica's suites); it prints libtest's result lines and
  exits 1 when any verdict isn't PASS.
- It makes its evidence store under `$TMPDIR/da995-<pid>` and removes it; it starts no process and uses no network.
- It takes about a minute of CPU in the dev profile (1,000 PNGs written and decoded, 1,000 frames drawn).
- Results: a verdict passes only on PASS. A failure message starts `FAIL:` (the program is wrong), `INCONCLUSIVE:` (not
  judged here: the platform can't draw the window or read the process's memory, or the GPU half off macOS) or `BLOCKED:`
  (on macOS, a setup step that must work didn't).

## The surface

Only what the base has: `deep_app::show::{CanvasPanel, Presented}`, `CanvasPanel::new(evidence_dir)`,
`CanvasPanel::present(&mut self, Presented)` and its `Render`, and `Presented::from_json` over the shape the hub's
`canvas.drawn` gives (`doc`, `rev`, `rect`, `layers` with `layer`, `owner`, `band`, `outline`, `items`, `picture`). A
picture is a PNG in the evidence store at `<evidence>/<sha[..2]>/<sha[2..]>`, as `picture()` reads it. No new export
is needed. If the fix changes `present`'s signature (say, to hand it the window for `drop_image`), that's a change to
this surface and a dispute for the redraft, not an edit here.

## What it checks

| Criterion | Verdict | How |
|---|---|---|
| 1,000 revisions, each with a new 1 MB picture, into one panel: the app's memory within 20 MB of its level after the first 10, and only the shown pictures held; the base grows by about 1 GB and fails, naming the panel | `presenting_1000_revisions_with_new_1_mb_pictures_keeps_memory_within_20_mb_and_only_the_shown_pictures_held` | The app's `CanvasPanel` in a GPUI window on the headless renderer at scale 1, a test binary of its own so the process's memory is the panel's. A second document is presented once, in a rect of its own; then 1,000 revisions of one document in one rect, each with a new 512 × 512 RGBA picture (1,048,576 bytes decoded, a color of its own and its number in its first row), each presented, drawn and its frame presented (`present_frame`), as the app does. The process's memory is read after revision 10 and revision 1,000 (Linux: `VmRSS` + `VmSwap`, so paging on a busy machine can't hide growth; macOS: `phys_footprint`); growth past 20,000,000 bytes fails `FAIL: the canvas panel held <n> MB more after 1,000 revisions than after the first 10 …`. Only the shown pictures held: read back from the window after revision 1 and revision 1,000, the first rect's center must be the newest revision's color and the second rect's the other document's one picture (within 6 code values), or it fails `FAIL: after revision <n>, the canvas panel drew …`; so a panel that frees memory by dropping a picture a shown revision still uses, or that stops loading pictures, fails too. |
| Scope: the rest freed "from memory and the GPU" | `presenting_1000_revisions_frees_the_gpus_copies_of_pictures_no_shown_revision_uses` | The same run. On macOS the footprint counts the GPU's textures for the process (the GPU's memory is the Mac's), so growth past 20 MB fails `FAIL: counting the GPU's textures, the canvas panel held …`. Off macOS the GPU's memory needn't be the process's (a discrete GPU's isn't), so this verdict is `INCONCLUSIVE:` there, never a pass. |

Why every revision is drawn and presented, not just handed to `present`: a correct panel may free a dropped picture's
GPU copy only when it next draws (GPUI's `Window::drop_image` needs the window), so a run that never draws could fail a
right program. And why `present_frame`, not only `render_frame`: a frame that is drawn but never presented leaves the
headless renderer's pending uploads queued (`vendor/gpui-pre`'s test window draws to the renderer on present), which
holds a copy of each picture whatever the panel does.

## Platforms

- **macOS (the reference Macs):** both verdicts are judged.
- **Linux:** GPUI's headless renderer here is wgpu, so the window draws and reads back and the first verdict is judged
  (PASS or FAIL). Whether the GPU's textures count in the process's memory depends on the driver, so the second
  verdict is `INCONCLUSIVE:` off macOS. On the box this was written on (wgpu on Mesa's Vulkan) the base grew 1,034 MB,
  about one decoded picture per revision.
- Where the window can't draw or read back, both verdicts are `INCONCLUSIVE:` off macOS and `BLOCKED:` on macOS.

At the base on Linux, `cargo test -p deep-app` can't build any of the package's test targets, because the `deep-app`
binary calls the macOS-only `trusted::post_forged` (`crates/deep-app/src/main.rs:113`) outside a `cfg`. That is the
base's, not this suite's: `BASE-FAILURE.txt` was taken in a scratch copy of the base with only that call put under
`#[cfg(target_os = "macos")]`, and says so.

## Wrong programs

- The merge base: `BASE-FAILURE.txt`. The panel keeps every picture, so memory grows by about 1 MB per revision
  (1,034 MB over 990 revisions on Linux), and the first verdict fails naming the panel.
- A planted twin, used only to check that the suite can pass and not kept: in a scratch copy of the base, `present`
  keeps only the pictures a shown revision uses and hands the rest to `render`, which calls `window.drop_image` on
  each. On Linux the first verdict passed (memory flat after revision 10, both rects drawn right) and the second was
  INCONCLUSIVE, as above (growth 1.1 MB from revision 10 to 1,000). The same twin without the drawing step, or drawing
  without presenting frames, grew about 1 MB per revision, which is why the suite draws and presents every revision.
