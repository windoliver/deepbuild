# #326 AC7, the planted hosts: blind redraft

This redrafts two planted tests of `../planted.rs` for #326's AC7 (`#326.b3443ee3`), as the design's Dogfooding bullet sets out: `clip_only_host_fails_on_the_dialog` and `unclipped_layouts_paint_outside_their_slot`. The first drafts stay as they are; these sit beside them in `planted_redraft.rs`.

## What was read

- `AGENTS.md` (Proof), and in `docs/technical-design.md` the "Panel" subsection of "Panels and devices (trusted ring)" and the Dogfooding bullet.
- Issue #326 in full, as `gh issue view 326` showed it on November 8, 2026.
- At the base commit `9d31efdb`: `../README.md`, `../common.rs`, `../planted.rs`, the fixtures under `../fixtures/components/`, `crates/deep-app/src/lib.rs` (`init`, `new_runtime`, `components`, `mount_panel`), `crates/deep-replica/src/lib.rs` (`headless_context`) and `src/shell.rs` (`window_options`), and in gpui-kit at the pinned rev `1676826` the parts of gpui-shell the host calls (`components::{init, registry, new_isolated_runtime}`, `policy::set_default`, `ShellRuntime::{load_application, mount_application}`) and `gpui_kit::open_window`.

Nothing else: no other branch, worktree, commit or PR.

## How the criterion is read

AC7 ends: "a host that clips only ordinary paints fails on the dialog, naming it". That host is a wrong program the test builds, and the judge (`common.rs`'s `judge_cards`, unchanged) must fail it, with the dialog its first failure.

**Why the host doesn't use the app's loader.** The design's Panel section says a panel "imports only `@deepbuild/panel`", and that one importing a toolkit module "is refused at pack check and again at load, naming the module". The suite's fixtures import `gpui-kit`, `gpui-base` and `gpui-component`. The first drafts mount them with `deep_app::mount_panel` on `deep_app::new_runtime`, inside `deep_replica::headless_context` (which runs `deep_app::init`). Under the design that loader may refuse every fixture, and the planted test would then fail with "failed to load" rather than test the judge. A planted host isn't the app, so this one is built from gpui-kit and gpui-shell alone:

- its own `HeadlessAppContext` (gpui-kit's text system, assets and offscreen renderer), with `gpui_shell::components::init` and an empty `gpui_shell::policy::Policy` as the default. No `deep_app::init`, so no DeepBuild policy, module or loader;
- gpui-shell's catalog runtime, `gpui_shell::components::new_isolated_runtime()`: every component gpui-shell registers for scripts, and nothing of DeepBuild's;
- each fixture loaded by gpui-shell's own loader, `ShellRuntime::load_application(dir, "main.js")`, then `mount_application`. It resolves `gpui-kit`, `gpui-base` and `gpui-component` today, and the design restricts DeepBuild's loader, not gpui-shell's. A fixture that doesn't load fails the test;
- the window `gpui_kit::open_window` opens (1512 x 982 points, hidden, unfocused), rooted at gpui-base's `Root`, which hosts the catalog's overlays. Its content is the host: the panel in a 260 x 862-point slot at the left, then the question card painted after it at `common::CARD`.

**`clip_only_host_fails_on_the_dialog`.** The host clips the slot (`overflow_hidden`) and does nothing else. It "refuses" every component with `refused: <its word>`, so the naming half of the judge passes and only the card's pixels can fail it. The reference is the same host with no panel: the card alone at its rect. For each of the nine fixtures, in the issue's order, the test mounts it, opens it by the input `common::COMPONENTS` gives (click, right press, hover or nothing) and captures the window. Before it hands the run to the judge, it checks that the host really showed the fixture: the capture differs from the reference, and for a component opened by input, the capture after the input differs from the one before. The judge must fail, and its first line must start `dialog: the card's interior differs`. The two layouts (twice its slot, grows) are ordinary paints, so the clipping host must keep them out of the card's interior.

**`unclipped_layouts_paint_outside_their_slot`.** The same host with no clip. The command palette and both layouts, mounted, must change a pixel outside the slot and its 2-pixel margin, compared with that host's render with no panel. So the clip in the first test is what keeps them in, and the fixtures are real. The test also checks that its filter on `COMPONENTS` picks exactly those three.

## How to run

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:/opt/homebrew/opt/rustup/bin:$PATH"
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  cargo test --locked -p deep-replica --test acceptance_326_panels_planted_redraft
```

It's wired by one `[[test]]` entry, `acceptance_326_panels_planted_redraft`, with `harness = false`, since AppKit needs the main thread for offscreen Metal captures. A test name given after `--` filters the two. It uses `../common.rs` and `../fixtures/` unchanged, copies each fixture into `/tmp/da326p-<pid>-<n>`, and sets `GPUI_SHELL_HOME` to one of those for the run. It needs macOS; elsewhere it prints INCONCLUSIVE and exits 1.

## The base output

Planted tests test the tests, so both pass at the base, `9d31efdb`. The run, on macOS on November 8, 2026, with the build's warnings trimmed:

```
     Running ../../tests/acceptance/326/panels/redraft-ac7/planted_redraft.rs (target/debug/deps/acceptance_326_panels_planted_redraft-e5f503e03cf59b34)

running 2 tests
  planted clip-only host, dialog: card interior differs at (530, 10), magenta inside the card
  planted clip-only host, popover: card interior differs at (530, 98), magenta inside the card
  planted clip-only host, tooltip: card interior differs at (532, 377), magenta not inside the card
  planted clip-only host, context menu: card interior differs at (530, 148), magenta inside the card
  planted clip-only host, dropdown: card interior differs at (530, 590), magenta not inside the card
  planted clip-only host, notification: card interior differs at (2228, 10), magenta not inside the card
  planted clip-only host, command palette: card interior equal, magenta not inside the card
  planted clip-only host, a layout twice its slot: card interior equal, magenta not inside the card
  planted clip-only host, a panel that grows toward the card: card interior equal, magenta not inside the card
  judge: dialog: the card's interior differs from the card alone at device pixel (530, 10)
         popover: the card's interior differs from the card alone at device pixel (530, 98)
         tooltip: the card's interior differs from the card alone at device pixel (532, 377)
         context menu: the card's interior differs from the card alone at device pixel (530, 148)
         dropdown: the card's interior differs from the card alone at device pixel (530, 590)
         notification: the card's interior differs from the card alone at device pixel (2228, 10)
test clip_only_host_fails_on_the_dialog ... ok
  unclipped host, command palette: outside its slot at Some((522, 0))
  unclipped host, a layout twice its slot: outside its slot at Some((522, 0))
  unclipped host, a panel that grows toward the card: outside its slot at Some((522, 0))
test unclipped_layouts_paint_outside_their_slot ... ok

test result: ok. 2 passed; 0 failed
```

In this host the six overlay components reach the card and the clip keeps the command palette and both layouts out; with no clip, those three paint outside their slot.

## Assumptions a dispute may revisit

- **"Clips only ordinary paints"** is read as a slot that clips its children's layout and paint, while overlays the window's root hosts (dialog, notification) and deferred, anchored paints (popover, tooltip, menus) escape it. Which of the seven reach the card in this host is printed per component; the test requires only the dialog to fail first and the two layouts to stay clipped.
- **The refusal** is the host's own string naming every component, as in the first draft, so the judge can fail the host only on the pixels.
- **The fixtures' imports.** The fixtures import toolkit modules, which the design says DeepBuild's loader refuses. That is a question for `panels.rs` (a refusal at load would name the module, not the component); it doesn't touch these planted hosts, which never go through DeepBuild's loader.
