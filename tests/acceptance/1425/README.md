# Acceptance tests for #1425: panels import DeepBuild's own module, so a panel never names the toolkit under it

Written first, blind, by a job that saw only the issue, the design and the base commit; no implementation of #1425
existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this
job (design: Dogfooding).

The issue has eight checkbox criteria, AC1 to AC8 in the body's order. Each test's name carries its criterion's ID
(`#1425.` and the first 8 hex digits of SHA-256 of the criterion's text, white space collapsed, as
`scripts/proof-change.mjs` reads it):

| AC | ID | File |
|---|---|---|
| AC1 | `#1425.3d839088` | `imports.test.ts`; `app.test.ts` (slot views, from `app/panels.rs`) |
| AC2 | `#1425.782e7a69` | `app.test.ts` (from `app/panels.rs`) |
| AC3 | `#1425.229fbfbb` | `app.test.ts` (from `app/panels.rs`) |
| AC4 | `#1425.24afae64` | `lint.test.ts` |
| AC5 | `#1425.30ab78a9` | `budgets.test.ts` (load timings from `app/panels.rs`) |
| AC6 | `#1425.1d938ac0` | `lint.test.ts` |
| AC7 | `#1425.711d0cb9` | `app.test.ts` (from `app/panels.rs`) |
| AC8 | `#1425.859baf8e` | `lint.test.ts` |

## What was read

- Issue #1425 as of 2026-11-07: Scope, the eight criteria, Proof, Depends on (#338).
- `docs/technical-design.md`: Panel (under Panels and devices (trusted ring)), Extension API (TypeScript, in-process),
  Dogfooding, the DeepBuild app row (the 4 ms per-update budget for shipped panels), Decided: Where agent-built panels
  run, The app's toolkit. `AGENTS.md` (Proof).
- At the base `9d31efdb` (main), for surfaces and conventions only: the 12 panels in `crates/deep-app/panels`, the
  guide (`docs/extension-guide.md`, `docs/extension-guide/`), `crates/deep-app/src/lib.rs` (`mount_panel`,
  `mount_page`, `components`, `init`, the `deepbuild` module), `panel_tree.rs`, `panel_check.rs`,
  `crates/deep-panel-host`, `crates/deep-replica` (`kit::panel`, the `panel@1` install check; `shell`; `headless.rs`),
  `scripts/lanes.mjs`, `scripts/benchmark.mjs`, `benchmarks/budgets.json`, gpui-kit at the pinned `1676826`
  (gpui-shell's `typings.rs`, `component-inventory.json`, `DataTable`, `list`), and the suites `1325`, `338`, `326`,
  `995`, `1098`, `1408` and `246` for conventions.

## What the base does

Every panel imports `gpui-kit`, `gpui-base` and, for some, `gpui-component` and `deepbuild`; the sample does too, and
says "a gpui-shell script". There is no `@deepbuild/panel`, no catalog, no lint check for any of this, no budget task,
and the pack check and the loader take a panel that imports the toolkit. 16 of 18 tests fail; the 2 that pass are AC1's
tree halves, which hold the merge base to itself. `BASE-FAILURE.txt` has the run.

## The surface under test

The issue names the module, a checked-in catalog with a `not_offered` list, refusals at pack check and at load, the lint
lane and planted hosts, but no file, command or text. These are this job's choices, made as small as the criteria allow;
an implementation provides each exactly as written here.

### 1. The module, `@deepbuild/panel`

The one specifier a panel imports. gpui-shell resolves it under the panel runtime's empty policy (the issue's "gpui-shell
stays underneath and resolves it"). Read strictly: a panel imports **nothing else**, not `deepbuild` either, so what the
base's `deepbuild` module serves (`needs_you`, `quotes`, and in panel-check builds `rebuild_count`, `fold`) comes through
`@deepbuild/panel` too. Imports by a relative path (`./x.js`) are a panel's own files and allowed.

### 2. The catalog, `crates/deep-app/panel-catalog.json`

One JSON file, the single place the catalog lives (the guide documents it; the pack check, the loader and the lint
check read it):

```json
{
  "module": "@deepbuild/panel",
  "components": [
    { "name": "Button", "props": { "label": "string" }, "example": "Button.new(\"ok\").child(\"OK\")" }
  ],
  "not_offered": [
    { "name": "DataTable", "reason": "render_cell runs script per visible cell on every frame" }
  ]
}
```

- `module` is `"@deepbuild/panel"`.
- `components`: non-empty; each has a non-empty `name`, a `props` object (its props; `{}` when it takes none) and an
  `example`: one JavaScript expression that builds that component, using only catalog names, `View` and `div`. The
  render test drops it into `div().size_full().child(<example>)` inside `render(cx) { ... }` of a panel that imports
  `View`, `div`, the component and every other catalog name the example mentions, from `@deepbuild/panel`.
  Whether `View`, `div` and the flex helpers are listed is the implementation's; every listed name must render.
- `not_offered`: each entry has a `name` and a non-empty `reason`.
- Every component the pinned toolkit exports (below) is a `name` in `components` or in `not_offered`.

### 3. What the toolkit exports

The pinned gpui-shell's own inventory, `crates/shell/component-inventory.json` in the gpui-kit checkout Cargo.lock pins
(found through `cargo metadata`): every item whose `classification` isn't `infrastructure`, each name in its
`registration.exports` and in each `registration.related[].exports` (144 names at `1676826`: `Button`,
`DataTable`, `WebView`, `AccordionItem`, ...).

### 4. Refusals: the pack check and the load

- **The pack check** is `panel@1`'s install check, `deep_replica::kit::panel(dir) -> Verdict { pass, names }`; a
  refusal is `pass: false` with its text in `names`.
- **The load** is `deep_app::mount_panel(runtime, dir, window, cx)`, the loader the app and the panel host both use; a
  refusal is its `Err`, read as `format!("{err:#}")`.
- **A toolkit import** (AC2): the refusal holds `gpui-kit` as a whole word and the line, as `main.js:3` or `line 3`
  (the number not followed by a digit). The fixture `fixtures/imports-gpui-kit/main.js` imports `{ View, div }` from
  `"gpui-kit"` on line 3 and nothing else.
- **A name off the catalog** (AC3): the test takes the first catalog component (sorted, starting with a capital, at least
  four letters) whose middle letter changed to `q` (or `z` when it was `q`) is closer to it than to any other catalog
  name and is no catalog name itself, e.g. `Butqon` for `Button`, and writes a panel importing `View, div, <that name>`
  from `@deepbuild/panel` and calling `<name>.new()`. Both refusals must hold the off-catalog name and the closest
  catalog name, each as a whole word.
- **A list that runs script per frame** (AC7), at pack check: `fixtures/scripted-cells` (`DataTable.new(state, rows,
  render_cell)` with a `DataTableState`) must be refused naming `DataTable` as a whole word; `fixtures/scripted-rows`
  (gpui-kit's `list(id, count, key, render)`) must be refused naming `list` as code: `` `list` ``, `"list"`, `'list'`
  or `list(` at a word start. Both import only from `@deepbuild/panel`; refusing them as names off the catalog is fine
  if the text names the component.

### 5. Plants (`DEEP_HUB_PLANT`)

Read by the code that runs the check, when it runs (not cached at start-up), in the suite's Rust test binary, where
deep-app is built with its `env-plants` feature (deep-replica's dev-dependency turns it on), as #1408's plants are. A
build without `env-plants` never reads them.

| Plant | The wrong program | Read by |
|---|---|---|
| `panel-load-unchecked` | `mount_panel` skips the module check, so the `gpui-kit` fixture loads (gpui-shell resolves `gpui-kit`) | AC2's planted test: the load judge fails it, naming `imports-gpui-kit`; AC5 times the load path with and without it |
| `panel-per-frame-unchecked` | the pack check skips the per-frame check, so `kit::panel` **passes** both `scripted-*` fixtures (or at least refuses them without naming the component) | AC7's planted test: the judge fails it, naming the panel |

Each planted test first runs the real program, which must pass the same judge, so a plant means something; a plant
that changes nothing reads BLOCKED.

### 6. The lint check, `scripts/panel-catalog.mjs`

Run as `node scripts/panel-catalog.mjs` from the repo root, and listed in the `lint` lane of `scripts/lanes.mjs` as
`[process.execPath, 'scripts/panel-catalog.mjs']`. Exit 0 with no line starting `FAIL` when everything holds; else a
non-zero exit and one line starting `FAIL` per finding (the lane reads those, #246):

- **AC4**: every line holding `gpui-` in `docs/extension-guide.md` and in every file under `docs/extension-guide/`
  that the checkout holds (tracked, or untracked and not ignored: `git ls-files --cached --others --exclude-standard`),
  its FAIL line naming `<path>:<line>` (repo-relative path, 1-based line). The planted file is
  `docs/extension-guide/plugin/panel/planted-1425.js` with `gpui-` on line 2; it is removed after.
  gpui-shell writes `gpui-kit.d.ts` and `jsconfig.json` beside a panel it loads; the tests load the sample from a copy,
  but an implementation that loads it in place must keep those files ignored.
- **AC6**: every toolkit component (section 3) on neither list, its FAIL line naming it. `DEEP_PANEL_TOOLKIT_INVENTORY`,
  when set, is the path of the inventory to read instead of the pinned one, in the same format; the planted bump adds
  an item exporting `Planted1425Gauge`.
- **AC8**: every `not_offered` entry whose `reason` is missing or blank, its FAIL line naming the entry's `name`.
  `DEEP_PANEL_CATALOG`, when set, is the path of the catalog to read instead of `crates/deep-app/panel-catalog.json`;
  the plant drops the first entry's `reason` and blanks the second's (`"   "`).

### 7. The budget task, `panel-module-load`

A task in `benchmarks/budgets.json` with id `panel-module-load`, valid by `validateBudgets` against the merge base's
budgets, whose `initialReason` names `#1425`, and whose command runs from the repo root (exit 0). What it measures is
the implementation's; the perf lane compares it with the merge base.

### 8. The Rust half

`app/panels.rs`, wired by one `[[test]]` entry this suite adds to `crates/deep-replica/Cargo.toml`
(`acceptance_1425`, no harness: AppKit wants the main thread). It prints libtest's lines; `app.test.ts` and
`budgets.test.ts` run it through cargo and read each test back by name.

## How each criterion is read

- **AC1** (`imports.test.ts`, `app.test.ts`): the panels folder holds exactly the 12 base panels; every import in each
  panel's `main.js` and the files it imports relatively, and in the sample's, is `@deepbuild/panel` or relative, and
  each imports something from it. Each panel's tree from the panel host (`deep-panel-host serve --panel <dir>`, one
  `{"cmd":"invalidate"}`, the reply's `tree`), and the sample's (loaded from a copy), equals `base-trees/<name>.txt`
  byte for byte. The view each `338-*` panel registers in its slot (`canvas`, `needs-you`, `home`, `line`, `sidebar`,
  `tab`), drawn in the replica's shell in the center over the fixture record, equals `base-trees/<panel>.<slot>.txt`
  byte for byte.
- **AC2** (`app.test.ts`): the pack check and the load each refuse `imports-gpui-kit` as section 4 says. Planted: the
  real loader refuses it; under `panel-load-unchecked` it loads, and the load judge fails naming `imports-gpui-kit`.
- **AC3** (`app.test.ts`): the off-catalog panel is refused at pack check and at load as section 4 says. Every catalog
  component's example panel loads through `mount_panel` in a replica with `deep_app::chrome::force_dark(Some(false))`
  and again with `Some(true)`, builds with no error, and its tree has a node of that component's name (a line whose
  first word is the name).
- **AC4** (`lint.test.ts`): no line of the guide's files (section 6's set) holds `gpui-`. Planted: the lane runs the
  check, the check passes this checkout, and with `planted-1425.js` it fails with a FAIL line holding
  `docs/extension-guide/plugin/panel/planted-1425.js:2`.
- **AC5** (`budgets.test.ts`): the `panel-module-load` task (section 7). On a reference Mac: each of the 12 panels in the
  panel host, 5 runs, each the slowest `scriptNs` of 20 invalidations after 5 untimed ones, against 4 ms (the design's
  per-update budget for a panel in the app); and the load path, `mount_panel` timed in one process with the check and
  under `panel-load-unchecked` (the merge base's path), alternated, 5 runs each the difference of the medians of 15
  loads a side, against 1 ms. Both judged by `judgeLimit`. The work runs first, so a missing surface fails; off a
  reference Mac, on battery, Low Power Mode on, thermal state not nominal or the load average above the core count, the
  readings print and the test skips as INCONCLUSIVE. It never passes by skipping.
- **AC6** (`lint.test.ts`): every toolkit component (section 3) is on one of the catalog's lists. Planted: the check
  passes with `DEEP_PANEL_TOOLKIT_INVENTORY` naming an unchanged copy of the pinned inventory, and fails with a FAIL
  line naming `Planted1425Gauge` when the copy adds that component.
- **AC7** (`app.test.ts`): the pack check refuses both `scripted-*` fixtures naming the component. Planted: the real
  check refuses them; under `panel-per-frame-unchecked` the judge fails each, naming the panel.
- **AC8** (`lint.test.ts`): every `not_offered` entry has a name and a non-blank reason. Planted (with
  `DEEP_PANEL_CATALOG`): FAIL lines name both planted entries.

## Run them

macOS only (the replica draws through AppKit), with the repo's Node (`.node-version`, 24.22.0):

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:/opt/homebrew/opt/rustup/bin:$PATH"
npm ci                                                  # once
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1425 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1425/tsconfig.json
# the Rust half alone; DEEP_1425_OUT=<dir> also writes each slot view's tree to <dir>/trees/ and AC5's load.json
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo test --locked -p deep-replica --test acceptance_1425 [-- <part of a name>]
```

The tests build `deep-panel-host` and the Rust half with cargo (`--locked`) into the checkout's target folder. Every
process is stopped by its PID. Nothing leaves the machine but cargo's fetches; no model is called.

`base-trees/` was captured at the base: the panel host's trees with `node tests/acceptance/1425/capture-base-trees.ts`
(each panel loaded twice, the two trees equal), the slot views' with the Rust half's `DEEP_1425_OUT`, then a second run
read them back equal. They are the merge base's and are never recaptured.

## Values the issue leaves open, and what these tests chose

1. **"Import only `@deepbuild/panel`"** is strict: the base's `deepbuild` data module moves under it too.
2. **The catalog's path and shape** (section 2), with an `example` per component, since "renders" needs a way to build
   each one and only the catalog knows its props.
3. **"Every component the toolkit exports"** is the toolkit's own component inventory (section 3), the one list the
   toolkit publishes as data; gpui-base's other exports (`DockArea`, `v_flex`, `list`, ...) aren't required on either
   list, though they may be.
4. **"Pack check"** for a panel is `panel@1`'s install check, `deep_replica::kit::panel`; **"at load"** is
   `deep_app::mount_panel`.
5. **"Naming the line"** reads `main.js:3` or `line 3`; **"naming the closest catalog name"** is by edit distance, with
   the planted name built so the closest is unique.
6. **"A panel tree"** is the panel host's `tree` for one invalidation (the design's element tree a host sends), plus,
   for the 10 `338-*` panels whose own root draws a bare `div`, the view each registers in its slot.
7. **"Renders in light and dark"** is a load, a build with no error and a node of the component's name in its tree, with
   the replica's forced appearance; pixels aren't compared.
8. **"A planted host"** is the same check with one guard lifted by `DEEP_HUB_PLANT` (section 5), as #1408's plants are.
9. **AC5's budget** is the design's 4 ms per update; "no new time on the load path above 1 ms" is the module check's
   own cost, timed against the planted loader without it, beside the perf lane's merge-base task.
10. **"The lint lane"** is `scripts/panel-catalog.mjs` in the lane, read through its FAIL lines; the lane's other
   commands (clippy among them) aren't run here.

## Known limits

- `scripted-rows`'s refusal naming `list` is matched only as code, since `list` is an everyday word; a refusal that
  names it as plain prose fails.
- AC3's render check doesn't compare light with dark or read pixels; a component that draws nothing visible but holds
  its node passes.
- The import scan reads static, dynamic and `require` imports by pattern; an import built at run time from a string
  isn't seen (the load check would see it).
- The planted lint inputs come through two environment variables of the check's own (section 6); the check's reading
  of the pinned inventory itself is held by AC6's first test only.
- AC5 hasn't been run on a reference Mac by this job; here (Mac17,10) it reads INCONCLUSIVE once the surface exists.
- Scope items in no criterion aren't read: `panel_tree.rs`'s one function, the unchanged empty policy, JIT switch and
  heap limits, the guide documenting the catalog, and refusals of `gpui-base` and `gpui-shell` imports (AC2 names
  `gpui-kit` only).
