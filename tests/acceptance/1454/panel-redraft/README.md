# #1454's refused panel, redrafted blind

A fresh run of the blind job (design: Dogfooding) for the second half of AC3 `#1454.a94aca43`: "a panel that fails its kit doesn't
load, naming the kit". Written at base `c12a65bb` from issue #1454, the design, `docs/extension-guide.md`, the base's code, the gpui-kit source
at `1676826` and `tests/acceptance/1454/` as drafted in `0e41601b`. No implementation, diff or dispute was read. This folder is the whole
redraft; `helpers.ts` is imported from the folder above, not copied.

**Read this first: the window tests in `refused.test.ts` have not run.** The screen was locked. What ran with no window is `app/refused.rs`, 4 of 4, and the `deep install` test, which
fails at the base for the expected reason. `BASE-FAILURE.txt` has the output. Treat `neverDrawn` and the plant's test as drafted, not tried.

## What a refused panel may import

`panel@1` must refuse the panel and the app's runtime must still run it. Those two are decided by different code:

- **The kit reads a name.** `crates/deep-replica/src/kit.rs`, `imports`, takes every name in every `import { … }`, from any module, and checks it
  against `OVERLAYS`. That refusal comes before `watch` mounts anything, so the kit refuses a script that can't run at all, for the same reason.
- **The runtime links a module.** gpui-shell's `crates/shell/src/engine/quickjs/mod.rs`, `exports::GPUI_BASE`, is `gpui-base`'s closed list. It holds `Popover`, `HoverCard`,
  `Popup`, `Select` and `Combobox`, and no `Dialog`, `Sheet`, `Tooltip`, `DropdownMenu`, `Notification` or `Command`. `Dialog` is registered in the component catalog
  (`crates/shell/src/components/shell/window_effects/mod.rs`), which scripts import as `gpui-component` (`DEFAULT_COMPONENT_MODULE`), as `tests/acceptance/326/panels/fixtures/components/dialog` does.
- **`Dialog` has a shape.** `new Dialog(id, label, on_effect_error)`, three arguments, and exactly one `content(element)`, or it fails at materialize time.

So `import { Dialog, v_flex } from "gpui-base"`, the form the first draft uses, is refused by the kit and can't load, seen at the base: `SyntaxError: Could not find export 'Dialog' in module 'gpui-base'`.
`plant-panel-skips-kit` could draw nothing from it, and the plant's test would fail for the wrong reason (the first draft's own Dispute 3). `fixtures/refused` imports `Dialog` from
`gpui-component`, builds a real one, and draws `Refused overlay panel` in a plain `div`, in `#7c2d12` on `#fef3c7`, colors no shell uses and readable in either appearance.

## How to run

As `../README.md`, on macOS with the workspaces built and an official Node 24.22 first on `PATH`: fnm's 24.22.0 ran the sandboxed package here, and the first draft saw Homebrew's die there.

```sh
cargo test --locked -p deep-replica --test acceptance_1454_panel_redraft          # no window: runs on a locked screen
caffeinate -di npx vitest run --root tests/acceptance/1454 panel-redraft --no-file-parallelism
```

The vitest file needs Accessibility, Screen Recording and an unlocked screen. Check `CGSSessionScreenIsLocked` first. It writes `tests/acceptance/1454/node_modules/.vite/`; delete that before committing.

## Pinned here: the implementation must provide these

1. **`deep install` refuses.** `panel@1` runs at install (design: a view passes its kit at install). A panel failing it exits non-zero with `panel@1` in its output, stdout or stderr. `Installed … It is not loaded: …`, which `install.ts` already prints with exit 1, serves.
2. **`plant-panel-skips-kit`**, a Cargo feature of `deep-app` as in `../README.md`, Pinned 8: the app mounts every installed panel, kit failed or not. So the plant has to reach a refused package, wherever the implementation keeps it.
3. **One `[[test]]` entry in `crates/deep-replica/Cargo.toml`**, `harness = false`, as #326's redraft has. This job commits only this folder, so the implementer adds it:

   ```toml
   [[test]]
   name = "acceptance_1454_panel_redraft"
   path = "../../tests/acceptance/1454/panel-redraft/app/refused.rs"
   harness = false
   ```
4. **`deep-app --panel <dir>` stays**, as #1172's suite needs it. The merged surfaces `deep_replica::shell::open_with_card`, `deep_app::mount_panel` and `deep_replica::kit::panel` are used as they are.

## Criterion to tests

| Test | Proves | Wrong program it fails on |
|---|---|---|
| `refused.test.ts`: `deep install` … naming the kit | exit non-zero, `panel@1` named | the base, which installs it with exit 0 |
| `refused.test.ts`: doesn't load … alone or beside a panel that draws | its words are on no pixels for 15 s, with it alone in the sidebar, then beside `board`, whose words must show | `plant-panel-skips-kit`; a window that draws nothing installed (the control); a panel that mounts late |
| `refused.test.ts`: the refused panel is real | `deep-app --panel` draws its words on the plain app | a fixture that can't link: `main.rs` panics on the failed mount |
| `refused.test.ts`: wrong program | the plant's window draws the words, and the judge names them | a plant that doesn't mount it, or a fixture that draws nothing |
| `app/refused.rs`: kit and load | no window: the kit refuses for `Dialog`; the runtime mounts it and paints its background and words in the shell's sidebar slot | no words (`wrong_fixture_with_no_words_paints_no_ink`); `Dialog` from `gpui-base` (`wrong_fixture_dialog_from_gpui_base_is_refused_and_never_loads`) |

## Where this differs from the first draft

- **The fixture links**, as above, and `app/refused.rs` proves it with no window.
- **Absence is watched, not sampled.** The first draft's `settled` returns on the first clean frame, so a panel mounted a moment after `board` passes. `neverDrawn` keeps reading for 15 s.
- **The refused panel gets a window alone.** Beside `board`, a program that keeps one panel per slot could hide it under the plant and pass for the wrong reason. Alone, it has the sidebar to itself. The same home then gets `board`, for the control.
- **The colors are the fixture's own**, not `cx.theme().colors`, so it reads the same however a plant mounts it.

## Disputes and assumptions a later reader may revisit

1. **Where the kit is named.** `deep install`'s output, as the first draft read it: the design runs kits at install, and a window that names it would be a new surface. An implementation that installs the package and refuses it only in the app, naming the kit in the window, fails the first test.
2. **Only the `Dialog` fill.** The criterion names no fill. `panel@1`'s other refusals are #326's suite.
3. **Only `sidebar`.** The area `panel@1` lays out.
