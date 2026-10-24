# A6 blind redraft: a plug-in fixture that tries to reach the GPU or the drawing surface

Test: `plugin-redraft.test.ts`, one `describe` ("#377.84a84b5e no plug-in or agent code path reaches the GPU or the
window's drawing surface, checked by a plug-in fixture that tries (redraft)") with the first draft's three `it`s, under
their IDs. Fixture: `fixtures/plugin/gpu-probe-redraft/`: a new `main.js`, and `documents.json` copied byte for byte
from `fixtures/plugin/gpu-probe/` (checked with `cmp`). The ID is the first draft's (`84a84b5e`).

The criterion: "No plug-in or agent code path reaches the GPU or the window's drawing surface, checked by a plug-in
fixture that tries".

No existing file was edited. `helpers.ts` is unchanged; the redraft reads the fixture folder by its own path, and the
issue fields (`code`, `ids`) beside `severity` in the test file.

## What I read

- The first draft's `README.md` (The plug-in fixture: the `plugin` call and its reply; Planted programs; the criterion's
  row; Readings: "Plug-in and agent code paths"), `helpers.ts`, `plugin.test.ts`, `fixtures/plugin/gpu-probe/` and
  `BASE-FAILURE.txt`; `tests/acceptance/387/A4-REDRAFT.md` for the record's form.
- `docs/technical-design.md`: the DeepBuild app row (80: "Extension panels are small JavaScript programs: gpui-shell,
  gpui-kit's embedded QuickJS engine, runs each one"), Canvas (516: panel scripts get the canvas "as one component,
  registered with the others"), the panel row (1963), the item shape (1107: "An unknown kind is skipped with a notice,
  and an unknown field is an error"), Documents that age well (850).
- `docs/canvas-primitives.md`: Kind and version (349), the panel's "It can never" (885: "Reach a GPU API"), the issue
  shape (8165: `{check, code, severity: error | warning | notice, ids, path, …}`).
- At the base: `crates/deep-app/src/lib.rs` (`deepbuild_module`: `needs_you`, `quotes`; `components()`: gpui-shell's
  catalog plus `canvas::register`), `crates/deep-app/src/canvas.rs` (`Canvas`, `CanvasScene`),
  `crates/deep-canvas/src/kinds.rs` (`parse_kind`, `lookup`), `crates/deep-canvas/src/document/check.rs` (the item
  kind check, 700–760; the envelope check, 272–315), `crates/deep-canvas/src/document/mod.rs` (`ENVELOPE_KEYS`),
  `crates/deep-canvas/src/registry/mod.rs` (`KNOWN_MODULES`, `missing_for_kind`, `Sealed::kinds`, `Registrar::kind`);
  for the follow-up dispute, `crates/deep-show/src/hub.rs` (the `show` check path), `crates/deep-show/src/main.rs`
  (`modules`, `seal`), `crates/deep-canvas-marks/src/modules.rs` (`marks2d`, `text`, `look`) and every `r.kind(` caller
  in `crates/`.
- gpui-shell at the rev the base pins (gpui-kit `1676826d9d49b90f4d7b6808b69924f58796f6f1`), from the cargo git
  checkout: `crates/shell/src/engine/quickjs/mod.rs`, `component_registry.rs`, `host.rs`, and a scan of every
  global it installs.

I never read an implementation.

## What the first draft asserted, and why it can't hold

### 1. The probe's word list reports gpui-shell's own runtime bridge

```js
const WORDS = /gpu|wgpu|metal|iosurface|surface|texture|drawable|framebuffer|swapchain/i;
look("global", Object.getOwnPropertyNames(globalThis));
```
```ts
expect(reached(t.text), 'what the plug-in\'s panel reached of the GPU or the drawing surface').toEqual([]);
```

"gpui" holds "gpu". gpui-shell installs two globals in every panel context, and every panel script's elements go
through them:

- `engine/quickjs/mod.rs:5690`, the prelude evaluated once per context: `globalThis.__gpui = (() => { …`. The built-in
  modules export what it holds (mod.rs:1225: "Every module re-exports values that were built at startup and stashed
  on `globalThis.__gpui`"; mod.rs:1246, each module's `evaluate` reads `ctx.globals().get("__gpui")`), so the probe's
  own `import { View, div } from "gpui-kit"` is `__gpui.View` and `__gpui.div`.
- `mod.rs:7832–7835`: `ctx.globals().set("__gpui_components", component_module.clone())`, the component registry's
  calls; `component_registry.rs:2496` and `2517` generate the `gpui-component` module's constructors as
  `globalThis.__gpui.__element(globalThis.__gpui_components[…](…))`.

A scan of every name gpui-shell sets on the global object outside `#[cfg(test)]` code (each `globals.set("…")`,
`.set("__…")` and `globalThis.X =` under `crates/shell/src`, 131 names) finds only these two matching the word list;
the third hit, `gpui` (`host.rs:1237`), is inside `mod tests` (host.rs:1192). The base's `deep-app` sets no global. So
any implementation that runs the fixture's panel in the app's panel runtime, as the README's `plugin` call requires
("gpui-shell with the app's registry and DeepBuild's `deepbuild` module"), draws `found:global:__gpui` and
`found:global:__gpui_components`, and the `toEqual([])` fails. They are the UI toolkit's element bridge, not a GPU or
drawing-surface handle.

The same scan of the modules finds no match: `exports::GPUI` and `exports::GPUI_BASE` (mod.rs:1116 on), `deepbuild`'s
`needs_you` and `quotes`, and the app registry's component names (gpui-shell's catalog, `Canvas`, `CanvasScene`).

Not run: no panel was run at the base, since building the workspace was off limits; this is from the sources.

### 2. The `gpu.surface@1` item is required refused

```ts
expect(got.outcome, `the ${d.name} document is refused`).toBe('refused');            // for surface-kind
expect(got.errors, `the ${d.name} refusal carries an error issue`).toBeGreaterThan(0);
```

The design gives an unknown kind a notice, not a refusal: "An unknown kind is skipped when drawing with the notice
`unknown_kind` and kept byte for byte through other writers' patches" (canvas-primitives.md:349; technical-design.md
1107 and 850 say the same). The base does exactly that: `gpu.surface@1` is in the kind grammar (`parse_kind`,
kinds.rs:401), no module's family is `gpu` (`KNOWN_MODULES`, registry/mod.rs:141–161, so not `module_missing`), and it
is not in the registry, so `lookup` answers `UnknownKind` (kinds.rs:432) and the check pushes a `Notice` with code
`unknown_kind`, `ids: [key]`, "the item is skipped" (check.rs:750–760), and no issue. A document whose only item is
skipped has no error, so a correct implementation presents it. The README's "the document check refuses unknown kinds
and fields" holds for fields, not kinds. What the criterion needs of this document is that the item never reaches the
GPU or the surface: never drawn.

### 3. Raw pixels and the WGSL param are required refused (follow-up dispute)

```ts
expect(got.outcome, `the ${d.name} document is refused`).toBe('refused');            // for raw-pixels and raw-shader
expect(got.errors, `the ${d.name} refusal carries an error issue`).toBeGreaterThan(0);
```

My first redraft kept these, reasoning that `pixels` and `wgsl` are params no kind defines, so `unknown_field` errors.
That holds only where `image@1` and `rect@1` are registered kinds, and at the base they are not, so their params are
never read:

- deep_show checks a writer's revision as `stamp(…)` then `check_in(&doc, &self.startup.sealed)`
  (`crates/deep-show/src/hub.rs:673–685`). `sealed` is `Registry::new(build_set())` with the modules of `modules()`:
  `deep_canvas_marks::modules::{text, look, marks2d}` and `deep_canvas_motion::module::module()`, plus test modules
  only under test features (`crates/deep-show/src/main.rs:692–707`, `seal` at 737–747).
- `check_in` is `check_by(doc, sealed, &sealed.kinds())` (check.rs:70–71). `Sealed::kinds()` is `kinds::registry()`
  plus the kinds the sealed modules register (`registry/mod.rs:703–711`). `kinds::registry()` is `build()`, whose
  entries are `test.slab`, `camera`, `test.rect` and `test.dot` (`kinds.rs:357–359`). `marks2d`, `text` and `look`
  register no kind (no `r.kind(…)` in `deep-canvas-marks`; `register_marks2d`, modules.rs:453, adds an array, the
  `frame` operator and a fixture); the only `r.kind` callers are `deep-canvas-test-modules`, deep-show's planted
  `test.accent`, and registry unit tests.
- So `rect@1` and `image@1` look up as `UnknownKind` (kinds.rs:432) and get the notice `unknown_kind` at
  `items/<key>/kind`, "the item is skipped", their params unread (check.rs:747–760). The coordinator's run of the five
  documents through that path: control presented (notice at `items/back/kind`), raw-pixels presented (`items/shot/kind`),
  surface-kind presented (`items/surface/kind`), surface-field refused (`unknown_field` error at `surface`), raw-shader
  presented (`items/back/kind`). This matches the code above; I did not run it, since building was off limits.

The design allows a build without these kinds: an unknown kind is skipped when drawing and kept (canvas-primitives.md
349), and #377 doesn't add 2D marks kinds. What the criterion needs of each try is the same as for the surface item:
the pixels, the shader and the surface never drawn. Whichever way a build ends up not drawing the try (refused, or
the item skipped as an unknown kind, or, in a build whose kind reads its params, the added field skipped as
`unknown_field`), nothing of it reaches the GPU or the surface.

## What the redraft asserts instead

| # | Assertion | Kept or new |
|---|---|---|
| 1 | The panel loaded as a plug-in panel | kept |
| 2 | The probe ran to its end (`probe:done`) | kept |
| 3 | It searched the globals (`global:checked`) | kept |
| 4 | It searched the members of `__gpui` and of `__gpui_components` (`bridge:__gpui:checked`, `bridge:__gpui_components:checked`) | new: the bridge is searched, not skipped |
| 5 | It searched the exports of `gpui-kit`, `gpui-base`, `gpui-component` and `deepbuild` | kept |
| 6 | `navigator.gpu` is absent | kept |
| 7 | It reached nothing: no `found:` line, where the global search leaves out exactly the names `__gpui` and `__gpui_components` and instead matches each of their own members by the same words, as `found:global:<bridge>.<member>` | replaces the first draft's `toEqual([])` over a search that counted the bridge itself |
| 8 | One device; the GPU layer drew at least one frame meanwhile | kept |
| 9 | One reply per document | kept |
| 10 | The fixture's documents are control, raw-pixels, surface-kind, raw-shader and surface-field | new (precondition of 12: each try is checked against its own item and field) |
| 11 | The plain document is presented | kept (at the base it is, with a notice for `rect@1`) |
| 12 | Each item-level try is never drawn: raw-pixels (item `shot`, field `pixels`), surface-kind (item `surface`) and raw-shader (item `back`, field `wgsl`) are each either refused with an error issue, or presented with an issue `unknown_kind` whose `ids` hold the item, or `unknown_field` whose `path` holds the field | replaces "refused with an error issue" for these three |
| 13 | The `surface` envelope field is refused with an error issue | kept |
| 14 | `--planted exposes_gpu_to_panels`: the probe draws `found:global:deepGpu` | kept |

The word list is the first draft's, unchanged. Only the two names gpui-shell itself installs at the base are named,
exactly, and not by pattern: a GPU or surface route under any other name, `gpuiDevice` or `__gpui2` included, is still
a `found:global:` line, and one hung on the bridge (say `__gpui.deepGpu` or `__gpui_components.Surface`) is a
`found:global:__gpui.…` line. 12 reads only the reply the README defines (`documents[i].outcome` and `issues`) and the
issue's own `code`, `ids` and `path` from the design's issue shape; no reply field was added. An issue must name the
try's own item or field: a presented document whose only notice is about something else fails.

Kept unchanged as holding at the base: 13. `surface` is not in `ENVELOPE_KEYS` (document/mod.rs:46), so the envelope
check pushes the error `unknown_field` (check.rs:306–312), and an unknown envelope field is an error by design
(canvas-primitives.md:349).

## Wrong programs it still fails

- The planted `exposes_gpu_to_panels` (14: `found:global:deepGpu`; 7 too, were it run there).
- Any panel global or module export named by a GPU or surface word: a WebGPU `navigator.gpu` (6), a `deepGpu`, a
  `metalLayer` or a `surfaceHandle` global (7), a `GpuSurface` export of `gpui-component` or `deepbuild` (7), or the
  same hung on gpui-shell's bridge (7, through 4's search).
- A document route for pixels or a surface: an `image@1` that reads and draws `pixels`, a `rect@1` that runs its
  `wgsl`, or a build that registers `gpu.surface@1` and draws it, each presenting the document with no `unknown_kind`
  for the item and no `unknown_field` for the field (12); a canvas that takes a `surface` envelope field (13).
- A run whose GPU layer drew nothing, or a second device (8).
- The base: no `deep-gpu` binary (every test fails at "the binary builds").

## Type check

`npx tsc -p tests/acceptance/377/tsconfig.json`: exit 0, no output.

## Run on the base

In the standalone export of `50c6de1` with the suite's files untracked and `node_modules` symlinked as a read-only
module cache (removed after): `NO_COLOR=1 npx vitest run --root tests/acceptance/377 --no-file-parallelism
plugin-redraft.test.ts`: 3 tests, 3 failed, 0 passed, each at the named assertion of the first draft's:

```
AssertionError: the binary builds: cargo build --locked --bin deep-gpu: expected 'cargo build --locked --bin deep-gpu f…' to be '' // Object.is equality
+ cargo build --locked --bin deep-gpu failed:
+ error: no bin target named `deep-gpu` in default-run packages
+ help: a target with a similar name exists: `deep-app`
 ❯ plugin-redraft.test.ts:69:32   (and :82:32, :106:32)
```
