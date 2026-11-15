# Acceptance test for #995, the blind redraft: the canvas panel drops pictures no shown revision uses

A blind redraft of this issue's acceptance test (AGENTS.md, Proof; `docs/technical-design.md`, Dogfooding: "A disputed
test goes to a fresh run of that job"). It was written from the issue, the design and the base commit only, by a job
that read neither the test it redrafts (`tests/acceptance/995/app/panel.rs`), nor `tests/acceptance/995/BASE-FAILURE.txt`,
nor their history, nor any other issue, pull request or comment. `crates/deep-app/Cargo.toml`'s `[[test]]
acceptance_995` entry runs this file in the first draft's place; the first draft's files are left as they were.

What was read:

- Issue #995's text: the problem, Scope, the one acceptance criterion, Proof and Depends on #806.
- `AGENTS.md`, and in `docs/technical-design.md` the head of Panels and devices (trusted ring), which the issue links
  (it says nothing of the canvas panel's pictures), How we know version 0 works and Dogfooding (Tests written first).
- The base commit `e0c90a5a5` (`origin/main`): `crates/deep-app/src/show.rs` (`CanvasPanel`, `Presented`, `present`,
  `follow`, `picture`, its `Render`), `crates/deep-app/Cargo.toml`, `crates/deep-app/screens.rs` and
  `crates/deep-replica/src/{lib,canvas}.rs` (the headless context; how the headless panel hands a revision over and
  draws), `vendor/gpui-pre` (`HeadlessAppContext`: `present_frame`, `capture_screenshot`, `run_until_parked`;
  `Window::drop_image`; the test window's `draw`), gpui-kit's `open_window`, and `current_headless_renderer`.
- For conventions only: `tests/acceptance/995/README.md` (the first draft's surface and verdict words),
  `tests/acceptance/1141/app/memory.rs` (a memory criterion in a binary of its own), `tests/acceptance/2117/app/panel.rs`
  (a `harness = false` binary's result lines), `tests/acceptance/1485/README.md`.

The base is not the issue's merge base any more: `show.rs` at `e0c90a5a5` already says it drops the pictures no shown
revision uses (its header names #995), and since #1485 `present` takes the panel's context and decodes in the
background. So on this base the test is expected to pass, and the issue's wrong program is planted (Wrong programs).

## How to run

From the checkout (set `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0` on a shared machine). The dev profile is enough:
what the panel holds per picture doesn't depend on the build.

```sh
cargo test --locked -p deep-app --test acceptance_995
# some verdicts only (all come from the same one run): any part of a name
cargo test --locked -p deep-app --test acceptance_995 -- within_20_mb
cargo test --locked -p deep-app --test acceptance_995 -- holds_only freed_from_the_gpu
```

- No libtest harness (AppKit needs the main thread for the offscreen renderer); it prints libtest's result lines and
  the two memory levels, and exits 1 when any verdict isn't PASS.
- It keeps its evidence store under the temp directory (`da995-redraft-<pid>`), never more than three pictures at
  once, and removes it; it starts no process and uses no network.
- About a minute and a half in the dev profile on the box it was written on (1,001 PNGs of 1 MB written, hashed,
  decoded and drawn).
- A verdict passes only on PASS. A failure message starts `FAIL:` (the program is wrong), `INCONCLUSIVE:` (not judged
  on this platform) or `BLOCKED:` (a setup step that must work didn't). A panic anywhere in the run fails every verdict.

## The surface

Only what the base has: `deep_app::show::{CanvasPanel, Presented}`: `CanvasPanel::new(evidence_dir)`,
`CanvasPanel::present(&mut self, Presented, &mut Context<Self>)`, its `Render`, and `Presented::from_json` over the
shape the hub's `canvas.drawn` gives (`doc`, `rev`, `rect`, `layers` with `layer`, `owner`, `band`, `outline`, `items`,
`picture`). A picture is a PNG in the evidence store at `<evidence>/<sha[..2]>/<sha[2..]>`, named by its SHA-256. The
panel is a GPUI view in a window opened with `gpui_kit::open_window`, as the app and `deep-replica-canvas` open theirs,
on `HeadlessAppContext` with the platform's headless renderer. No new export is needed.

## What it does

One run gives all three verdicts. The window is 1024 × 640 points; one document's panel is the rect `[0, 0, 512,
512]`, another's `[512, 0, 512, 512]`.

1. The other document is presented once: one revision, one picture, shown for the whole run.
2. 1,000 revisions of the redrawn document, each with a new picture: 512 × 512 RGBA (1,048,576 bytes decoded), noise
   around a 128 × 128 middle of the picture's own color, so its PNG is 1 MB too (the test is `BLOCKED` if one is
   under 1,000,000 bytes). Each is handed over as the app's `follow` does (`present`, then `refresh_windows`), its
   decoding runs (`run_until_parked`), and one frame is drawn and presented (`present_frame`), as a display's frame
   does in the app. Once a revision is replaced its picture's file leaves the store.
3. The process's memory is read after revision 10 and after revision 1,000. The window is read back
   (`capture_screenshot`) just before the first reading and just after the second, so nothing a read-back keeps counts
   as growth.
4. Revision 1,001 names revision 1,000's picture again, and revision 1,002 names revision 999's picture, whose file is
   gone; the window is read back after each.

Why every revision is drawn and presented, not only handed to `present`: a panel can free the GPU's copy of a picture
only with the window in hand (`Window::drop_image`), which a view has when it draws, and GPUI's headless window hands a
frame to the renderer when it is presented. A run that never drew would judge a right program by pictures it had no
chance to free.

Why the replaced pictures leave the store: a picture the panel draws after that is one it holds, which is what the
criterion's "only the shown pictures held" is about, and the run keeps 3 MB on disk, not 1 GB. A right panel reads a
picture when a revision naming it is presented and never needs the file of a picture no shown revision uses.

## What it checks

| Criterion | Verdict | How |
|---|---|---|
| Presenting 1,000 revisions, each with a new 1 MB picture, into one panel leaves the app's memory within 20 MB of its level after the first 10; the merge base grows by about 1 GB and fails, naming the panel | `presenting_1000_revisions_each_with_a_new_1_mb_picture_leaves_memory_within_20_mb_of_its_level_after_the_first_10` | The process's memory after revision 1,000 less its memory after revision 10 (Linux: `VmRSS` + `VmSwap` of `/proc/self/status`, so paging on a busy machine can't hide growth; macOS: the physical footprint, `proc_pid_rusage`'s `ri_phys_footprint`). More than 20,000,000 bytes fails `FAIL: the canvas panel held <n> MB more after 1000 revisions than after the first 10 …`. Flat memory is no proof from a panel that drew nothing, so it also fails if the middle of the panel isn't revision 10's color after revision 10 or revision 1,000's after revision 1,000 (within 6 code values a channel): `FAIL: after revision <n>, the canvas panel drew …`. |
| … and only the shown pictures held (Scope: after each presented revision the panel keeps only the pictures a shown revision uses) | `after_1000_revisions_the_panel_holds_only_the_pictures_a_shown_revision_uses` | Read off the window. The shown pictures are held: after revision 1,000 the redrawn panel's middle is revision 1,000's color and the other panel's is the other document's picture, and both still are after revision 1,001, which names the picture revision 1,000 already shows; otherwise `FAIL: … it freed a picture a shown revision uses`. No other is held: revision 1,002 names revision 999's picture, which revision 1,000 replaced and whose file is gone, so the panel must not draw revision 999's color, or it fails `FAIL: the canvas panel still held revision 999's picture after revision 1000 replaced it …`. What a right panel draws for a picture it can't load isn't judged. `BLOCKED:` if the window's ground is one of the pictures' colors, or the file is still in the store. |
| Scope: frees the rest "from memory and the GPU" | `the_pictures_no_shown_revision_uses_are_freed_from_the_gpu` | The same two readings. On macOS the footprint counts the textures the GPU holds for the process, so growth past 20 MB fails `FAIL: counting the GPU's textures, the canvas panel held …`. Off macOS the GPU's memory needn't be the process's, so this verdict is `INCONCLUSIVE:` there, with the readings, never a pass. |

## Platforms

- **macOS (the reference Macs):** all three verdicts are judged; a window that can't open or be read back, or a
  footprint that can't be read, is `BLOCKED:`. This redraft was written and run on Linux only: its macOS memory reading
  (`proc_pid_rusage`, declared in the file) was not compiled or run by this job, and the Mac run is still owed.
- **Linux:** GPUI's headless renderer is wgpu. The first two verdicts are judged (PASS or FAIL); the third is
  `INCONCLUSIVE:`, so a Linux run exits 1 even on a right program. Where no window opens or reads back, all three are
  `INCONCLUSIVE:`.
- **Elsewhere:** no memory reading, so all three are `INCONCLUSIVE:`.

Conditions of the Linux runs below: a shared, loaded arm64 box (memory readings are evidence, timings aren't), a
scratch worktree of the base with three changes that only let `deep-app` build on Linux and are no part of the base:
`gpui-pre-wgpu` patched to a scratch copy with one extra match arm (`.cargo/config.toml`, and `Cargo.lock` after it,
so the runs were without `--locked`), and one macOS-only call in `crates/deep-app/src/main.rs` put under `cfg`.

On the base (`e0c90a5a5`) there: 203.6 MB after revision 10, 210.4 MB after revision 1,000, 6.7 MB more; the first two
verdicts `ok`, the third `INCONCLUSIVE:` (the full output closes `WRONG-PROGRAM.txt`). The one earlier run of the
base, before the other document's picture got a color that isn't black's, read 7.8 MB more and gave the same verdicts.

## Wrong programs

Each was planted in `crates/deep-app/src/show.rs` in the scratch worktree, run and reverted (`git diff` of the file
empty after); `WRONG-PROGRAM.txt` has each one's diff and whole output.

- **The issue's, the merge base's: the panel keeps every picture it was ever shown** (`show` never lets one go).
  Memory grew 1,047.0 MB over revisions 11 to 1,000, about 1.06 MB a revision, and the first verdict failed naming the
  canvas panel; the second failed too: revision 1,002 drew revision 999's color from a picture the store no longer had.
- **The opposite, run as a twin: the panel keeps only the newest shown revision's pictures**, so it frees the other
  document's. Memory stayed flat (7.9 MB more) and the first verdict passed, as it should on memory alone; the second
  failed: the other document's panel drew the ground, not its picture.
- **A twin that loads no picture** (`picture` decodes nothing). Memory stayed flat (7.4 MB more), and the first two
  verdicts failed: the panels drew the ground at revision 10 and at revision 1,000. Its message's "it freed a picture"
  guesses at the cause; what it read is the ground where a shown picture belongs.
- Not run here: a panel that frees its own copy and never the GPU's. Only macOS judges that, by the third verdict.
