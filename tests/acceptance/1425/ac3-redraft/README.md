# #1425 AC3, blind redraft (`#1425.229fbfbb`)

> A panel using a component off the catalog is refused, naming the component and the closest catalog name. Every catalog name renders in a replica in light and dark

The design's Dogfooding bullet calls for a fresh run of the job that writes acceptance tests, so this is one, for this criterion alone. It sees the issue, the design and the base commit `9d31efdb`, and nothing else.

## What was read

- `AGENTS.md`, the Proof section.
- Issue #1425 in full.
- In `docs/technical-design.md`: "Extension API (TypeScript, in-process)", "Panel" under "Panels and devices (trusted ring)", and the Dogfooding bullet.
- At the base: `crates/deep-replica` (`lib.rs`, `kit.rs`'s `panel`, `shell.rs`, `Cargo.toml`), `crates/deep-app/src/lib.rs` (`mount_panel`, `new_runtime`, `components`) and `chrome.rs` (`force_dark`, `follow`), `crates/deep-app/tests/chrome.rs`, `crates/deep-app/panels/*`, and `tests/acceptance/326/panels` with its redraft, for how suites mount panels and read a script view.
- The pinned toolkit, gpui-kit `1676826`: `crates/shell/component-inventory.json`, `src/typings.rs`, `src/component_registry.rs`, `src/view.rs`, `src/materialize.rs`, `src/spec.rs` (`debug_tree`), the component constructors under `src/components/shell`, and `examples/js_story`, for how scripts actually build each component.

No implementation of #1425 was read: no other branch, worktree, commit or PR.

## The surface

- **The module.** A panel imports everything from `@deepbuild/panel`: `View`, `div` and the components.
- **The catalog.** `crates/deep-app/panel-catalog.json`. The test reads only `components`. That can be a list of entries that each have a `name`, such as `{"components": [{"name": "Button", "props": {…}}, …], "not_offered": […]}`, or an object keyed by name. Everything else in the file, `props` and `not_offered` included, is left to the work and the other criteria.
- **Pack check.** `deep_replica::kit::panel(dir) -> Verdict { pass, names }`, `panel@1`'s install check.
- **Load.** `deep_app::mount_panel(&deep_app::new_runtime()?, dir, window, cx)` in a window of `deep_replica::headless_context()`, opened with `deep_replica::shell::window_options()` at 480 × 360 points, in light or dark through `deep_app::chrome::force_dark(Some(dark))` and `deep_app::chrome::follow(window, cx)`, as `crates/deep-app/tests/chrome.rs` does. What the panel built comes from its `ScriptView`: `build_error()`, `snapshot().debug_tree()`, and the window's pixels from `capture_screenshot`.

## How the criterion is read

**What a catalog name is.** A catalog name is a name the toolkit's component registry already has, as `deep_app::components()` returns it: a constructor export such as `Button` or `InfoAlert`, or a state export such as `InputState`. The issue changes no toolkit ("gpui-shell stays underneath and resolves it"), so the catalog names what the toolkit registers. A name that is neither fails, naming it.

**How a name is built.** `component_js.rs` builds a panel the way an author would, from the toolkit's own description of each constructor (`ConstructorDescriptor::arguments`). It doesn't depend on a fixed list.
- A string gets a value suited to its argument name: an `id`, a relative `path` (`icons/check.svg`, the kit's icon, also copied into the panel for asset-root paths), a `url`, a keystroke or a small unified diff. Any other string gets a word.
- A number is 0 for an index and 1 otherwise. An enum gets its first value, a boolean `false`, an element `div().child("Sample")`, and an array one such value.
- A callback returns what its declared type says it returns: an element, a list, a word, `false`, 0 or nothing.
- Trailing optional arguments are left out.
- An argument that takes a value made by another constructor (`ArgumentSchema::Entity(kind)`, as `Carousel` takes a `CarouselState` and `Input` an `InputState`) gets that state. The state export of that kind makes it in the view's `init`, since gpui-shell refuses to make states during render, with its own arguments built the same way.
- A state export on the catalog is built inside the first component that takes it.
- The panel imports the component and every state export it needs from `@deepbuild/panel`. A catalog component a plug-in can't build through the module because a state it needs isn't exported doesn't render.

**Renders.** Each catalog name is drawn once in light and once in dark (`replica::renders`). Its panel renders when all of these hold:
- `mount_panel` loads it.
- The script builds, so `build_error()` is `None`.
- The script's debug tree has a node for the component. A line starts with its registered name, as gpui-shell writes registered components.
- The window differs, pixel for pixel, from a panel that draws gpui-shell's stand-in, `Failed to render <component>`, in the component's place. gpui-shell draws that stand-in when a component fails to materialize. The failure goes only to a log and never to `build_error()`, so the pixels are where it shows.

The panel is drawn as built. If that fails, it is drawn again with its `content` slot filled. gpui-shell lets a script fill that slot on any element, and some components, `SettingItem` for one, can't draw without it, which the registry doesn't say. Drawing nothing is not a failure: an empty container such as `Toolbar`, `Badge` or `Empty` draws nothing with no children. The test reports every name that fails, with its theme and the first attempt's reason.

**Refused.** The planted panel builds a catalog name exactly as the render test does, but calls a typo of it: the name with its last letter doubled, such as `Buttonn` for `Button`. The name is taken from `Button`, `Badge`, `Label`, `Kbd`, `Tag` or `Text` when the catalog has one, and otherwise from the catalog in order. The typo is off the catalog and nearer the name than any other catalog name, by more than one edit, so any reasonable sense of "closest" picks it. The same panel spelled correctly is the control. The control must pass pack check and load, which shows the refusal belongs to the typo and isn't a refusal of everything.
- **At pack check**, `kit::panel` must fail it, and `names` must name the typo and the catalog name.
- **At load**, `mount_panel` must return an error whose text (`{:#}`) names both.

"Names" means each appears as a whole word, with no letter, digit or `_` on either side. So `Buttonn` doesn't count as naming `Button`. QuickJS's own "could not find export" error names the typo but not the catalog name, so it doesn't pass. The line is not required here; AC2 asks for it for toolkit modules.

## How to run

```sh
cargo test --locked -p deep-replica --test acceptance_1425_ac3
```

It's wired by one `[[test]]` entry with `harness = false` in `crates/deep-replica/Cargo.toml`, because AppKit wants the main thread. It prints libtest's result lines. It needs macOS; elsewhere it prints INCONCLUSIVE and exits 1. Scratch panels go to `/tmp/da1425ac3-<pid>` and are removed afterwards.

## The base output

At `9d31efdb` both tests fail because the surface doesn't exist yet: there is no catalog at `crates/deep-app/panel-catalog.json` and no `@deepbuild/panel` module. `BASE-FAILURE.txt` has the run. It also has a second run of the same binary with a temporary four-name catalog, which wasn't committed. There, both fail on `cannot resolve module @deepbuild/panel`: the control panel is refused, so the refusal can't be the typo's, and every draw is refused at load.

## Files

- `ac3.rs`: the two tests and the catalog reader.
- `component_js.rs`: builds a panel script for any catalog name from the toolkit's registry.
- `replica.rs`: loads a panel through `mount_panel` in light or dark, reads it back, and judges whether it renders.

## Assumptions a dispute may revisit

- **Catalog names are the toolkit's own export names.** A catalog that renames a component, such as `Drawer` for `Sheet`, fails here, naming it.
- **The stand-in text is gpui-shell's at this pin.** A toolkit bump that rewords `Failed to render …` would weaken that one check until it is updated. The other checks still hold.
- **"Renders" is read from the script's tree and the window's pixels, not from a person's eye.** A component that draws the same pixels in a broken way would pass, as it would in any snapshot test.
- **The values are an author's plain ones.** A catalog component that renders only with particular arguments, not with these generic ones, would fail here. On the base, a probe that isn't committed ran this builder and this judge on all 160 constructor and state exports of `deep_app::components()`, in light and in dark, with the toolkit's module names (`gpui-kit`, `gpui-component`) in place of `@deepbuild/panel`. 316 of the 320 draws rendered. The four that failed are `HoverCard` and `NativeMenuTrigger`, in both themes, where gpui-shell drew its stand-in. `HoverCard` is an overlay that `panel@1` already refuses, and `NativeMenuTrigger` is a platform menu, so neither can be on a catalog that renders. Before the `content` retry, `Popover`, `Dialog`, `Sheet` and `SettingItem` drew the stand-in too, which shows the stand-in check catches a component that fails to materialize.
- **"In light and dark" means drawn under each theme.** It doesn't require the two draws to differ. The panel's ground follows the theme anyway, and an image may rightly look the same in both.
