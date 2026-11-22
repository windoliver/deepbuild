# Acceptance tests for #1847: a panel's imports are refused whatever way their name is spelled, not only as a plain string

Written first, blind, by a job that saw only the issue, the design and the base commit; no implementation of #1847
existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this
job (design: Dogfooding).

The issue has two checkbox criteria, AC1 and AC2 in the body's order. Each test's name carries its criterion's ID
(`#1847.` and the first 8 hex digits of SHA-256 of the criterion's text, white space collapsed, as
`scripts/proof-change.mjs` reads it):

| AC | ID | Tests in `imports.rs` |
|---|---|---|
| AC1 | `#1847.675d2963` | planted panels at pack check and at load; the owner comment's spelling (3 tests); the refusal property |
| AC2 | `#1847.fc64718b` | the plain panel at pack check and at load; every shipped panel; the pass property |

## What was read

- Issue #1847 as of 2026-11-21: its body (Scope, the two criteria, Proof, Depends on #1425) and the owner's comment
  from the 2026-11-09 audit (finding RUST-APP-15), which suggests one more spelling.
- `docs/technical-design.md`: Panel (via `node scripts/design-section.mjs --issue 1847`) and Dogfooding's "Who drafts
  it". `AGENTS.md`.
- At the base `58b4a8cb` (main), for surfaces and conventions only: `crates/deep-app/src/panel_module.rs` (`check`,
  `serve`), `crates/deep-app/src/lib.rs` (`mount_panel`, `admit`), `crates/deep-app/src/plain.rs` (`planted`),
  `crates/deep-app/panel-catalog.json`, the shipped panels in `crates/deep-app/panels`, `crates/deep-replica/src/kit.rs`
  (`kit::panel`), `crates/deep-replica/src/lib.rs` and `main.rs`, `crates/deep-panel-host` (`serve`), `Cargo.lock` (for
  a property-test crate), `scripts/proof-change.mjs` (criterion IDs), and `tests/acceptance/1425/` (README, `app/panels.rs`,
  `helpers.ts`, fixtures) and `tests/acceptance/1454/panel-redraft/app/refused.rs` for conventions.

## What the base does

`panel_module::check`, run by `panel@1` (`kit::panel`) and again by `admit` before every `mount_panel`, finds imports by
pairing quote characters: it records `"…"` and `'…'` strings, skips template literals, and has no notion of a regex
literal. So it reads an import only when its module is one plain string right after `from`, `import` or `import(` /
`require(`. A template literal, a computed name or a concatenation isn't seen at all, and a regex literal holding a quote
throws the pairing off for the rest of the file. The four planted panels pass the check, pass `panel@1` whole and load
in the panel host; the plain panel, the shipped panels and the generated plain panels pass. Of the 10 tests, the 6 AC1
tests fail there, each because the planted panel is admitted (each failure names the panel, or for the property the seed
and file); the 4 AC2 tests pass. In the owner-spelling test the import-alone control is refused at the base, so the
judge takes a refusal in the base's own form (`main.js:1 imports "gpui-kit", …`). `BASE-FAILURE.txt` has the run (the
`TU: error … renderD128` line is the GPU driver probe on this Linux box, not a test's).

## The surface under test

The issue names the pack check and "the same check at load", `crates/deep-app/src/panel_module.rs`'s `check`, and the
refusal's content (the file and the line), but no command or text. These are this job's choices, as small as the
criteria allow:

1. **The pack check** is `panel@1`'s install check, `deep_replica::kit::panel(dir) -> Verdict { pass, names }`; a
   refusal is `pass: false` with its text in `names` (as #1425's suite reads it).
2. **The load** is the panel host, `deep-panel-host serve --panel <dir>`, which loads through `deep_app::mount_panel`
   (the loader the app and the panel host share, and so `admit`'s check). It's started as the app starts it, with
   HOME and nothing else of the environment. Loaded is its `{"ready":true,…}` line and a `tree` for one
   `{"cmd":"invalidate"}`; refused is an exit before `ready`, its stderr the refusal. The host must be built first and
   no older than `crates/deep-app/src`, `crates/deep-app/panel-catalog.json` and `crates/deep-panel-host/src`, or the
   tests say BLOCKED.
3. **The check the issue names**, `deep_app::panel_module::check(dir) -> Result<(), String>`, is read directly by the
   property tests and the owner comment's exact line, and by AC2 beside the pack check.
4. **Naming the file and the line**: the refusal holds the file's name (`reach.js`, `gen.js`, `main.js`) as a word (a
   folder before it is fine: `src/gen.js`) and the line as `<file>:<n>` or `line <n>`, the number whole (`reach.js:4`,
   `reach.js:4:10` and `line 4` all name line 4). The line is the one holding the `import`/`require` keyword; every
   planted import here is on one line.
5. Fixtures are loaded and checked from a scratch copy (`$TMPDIR/deep-1847-<pid>/`), so neither `serve`'s
   `@deepbuild/panel.js` nor gpui-shell's typings land in the checkout.

### The fixtures

Each planted panel's `main.js` is clean (imports `View, div` from `@deepbuild/panel` and `./reach.js`); its `reach.js`
holds the planted import inside a function nothing calls while the panel loads, so a loader that doesn't read the
spelling loads the panel, and a refusal can only come from a check that reads the file, not from a failure as it runs.

| Fixture | `reach.js` line | Spelling |
|---|---|---|
| `dynamic-template` | 4 | ``return import(`gpui-kit`);`` |
| `dynamic-computed` | 6 | `return import(toolkit);`, `toolkit` being `"gpui-" + "kit"` (line 3) |
| `require-computed` | 5 | `return require(name);`, `name` being `["gpui", "kit"].join("-")` |
| `regex-quote` | 3 | `const quote = /"/; import { div as kitDiv } from "gpui-kit";` (owner's comment; top level) |
| `plain-imports` | n/a | AC2: `import … from "@deepbuild/panel"`, `import … from "./parts/label.js"`, `import './parts/side.js'`, `export … from "./parts/tint.js"`, `import("./parts/later.js")`; `parts/label.js` holds a regex literal with a quote, a division and a template literal |

`regex-quote` imports `div` rather than the comment's `Chart`, since `div` is a name gpui-kit exports (1425's fixture
imports it), so the base loads the panel instead of failing to link it. The comment's exact line is read by the check
directly (below).

## How each criterion is read

- **AC1, pack check**: `kit::panel` refuses each of the three planted panels naming `reach.js` and its line.
- **AC1, load**: the panel host refuses each, naming `reach.js` and its line.
- **AC1, the owner comment's spelling** (from the owner's audit comment, not a checkbox criterion): `regex-quote` is
  refused at pack check and at load naming `gpui-kit`, `reach.js` and line 3 ("as the same import alone is", and the
  design's "naming the module"); and the check refuses the comment's line exactly
  (`const q = /"/; import { Chart } from "gpui-kit";`) alone on line 1 and on line 2, and the import alone, each naming
  `gpui-kit`, `main.js` and the line.
- **AC1, property**: 300 generated panels (seeds 18475000…18475299), each a clean `main.js`, a stub `src/side.js` and a
  `src/gen.js` of 0 to 39 lines of plain code (below) with one planted line inserted at a random line, are each refused
  by the check naming `gen.js` and that line. The planted line cycles through: ``import(`gpui-kit`)``,
  ``import(`./${"side"}.js`)`` (a template literal with a substitution as a module name, which the Scope refuses
  whatever it names), a computed name, a concatenation (`import("gpui-" + "kit")`), ``require(`gpui-kit`)``,
  `require([…].join("-"))`, the owner's static import after `/"/`, and `import("gpui-kit")` (the plain string, refused
  since #1425, as a control).
- **AC1, "the merge base loads them and fails, naming the panel"**: read as the proof that these tests mean something:
  they run on the merge base, which loads the planted panels, and fail there naming each one (`BASE-FAILURE.txt`). No
  plant is needed for that: the base itself is the wrong program. (#1425's `panel-load-unchecked` plant doesn't fit:
  `plain::planted` reads `DEEP_HUB_PLANT` once per process since #1457, and the panel host is built without
  `env-plants`, so it reads no plant at all.)
- **AC2, pack check**: the check and `kit::panel` both pass `plain-imports`.
- **AC2, load**: the panel host loads `plain-imports`, and its tree for one invalidation equals
  `base-trees/plain-imports.txt` byte for byte ("loads unchanged"), captured by this suite at the base with
  `DEEP_1847_OUT`.
- **AC2, shipped panels** (unchanged behaviour): every panel folder under `crates/deep-app/panels` with a `main.js`
  passes the check and `kit::panel` and loads in the panel host, except `claude-code` and `codex`: they import
  `quotes`, which the module serves only in a `spike` build (#1454), so the base refuses them in this build too. Their
  trees are #1425's suite's to compare.
- **AC2, property**: 300 generated panels (seeds 18470000…18470299) of 1 to 40 lines of plain code pass the check. Each
  line is valid module code, names unique, drawn from: `import { View as View_i, div as div_i } from "@deepbuild/panel"`,
  `import * as Panel_i from '@deepbuild/panel'`, `import { side as side_i } from "./side.js"`, `import "./side.js"`,
  `export { side as side_out_i } from './side.js'`, `import("./side.js")` and `import('./side.js')` in an arrow,
  `require("./side.js")` in an arrow, a line comment and a block comment holding `"gpui-kit"`, ``import(`gpui-kit`)``,
  `import(name)` and `require(name)` as words, strings (double and single quoted, with escapes) holding the same, a
  template literal with a substitution holding them, nested template literals, regex literals `/"/`, `/'/g`, ``/`/``,
  `/[/"]/` and `/import\(/`, divisions `10 / 2 / 1` and `(8 / 4) / 2`, and blank lines.

## Run them

Linux or macOS, from the checkout, with the repo's toolchain:

```sh
cargo build --locked -p deep-panel-host
cargo test --locked -p deep-replica --test acceptance_1847 [-- <part of a name>]
```

The binary prints libtest's lines (`test <name> ... ok` or `FAILED`) and a `test result:` line, and exits
non-zero unless every chosen test passed. Nothing in it is macOS-only. Each host it starts is stopped by its PID. Nothing leaves the machine but
cargo's fetches; no model is called. `base-trees/plain-imports.txt` was captured at the base with
`DEEP_1847_OUT=<dir>` and read back equal by a second run; it is the merge base's and is never recaptured.

## Values the issue leaves open, and what these tests chose

1. **"Pack check"** is `panel@1`'s install check, `kit::panel` (as #1425 read it); **"at load"** is the panel host's
   load (`deep-panel-host serve`), which runs `mount_panel`, the app's loader too, and runs on Linux.
2. **"Naming the file and the line"** reads `<file>:<n>` or `line <n>`, with the file's name as a word; no wording is
   asserted beyond that. Only the owner's case (and the comment's line) must also name the module `gpui-kit`; the three
   criterion panels needn't name a module, since a computed name has none to name.
3. **"Its own relative files"** are files in the panel's folder named by `./…`; the AC2 panel's own files sit in a
   subfolder (`./parts/…`).
4. **"Loads unchanged"** is the same tree as the merge base's for one invalidation in the panel host.
5. **"A template literal used as a module name"** (Scope) is read in a dynamic import or a `require`, with or without a
   substitution; a template literal after `from` isn't JavaScript, so it isn't planted.
6. **A `require` with one plain string** (`require("./side.js")`) is in the plain set: the Scope refuses only a
   `require` whose argument is anything but one plain string literal.
7. **Comments, strings and template literals that hold the words `import(` or `require(`**, and regex literals and
   divisions, aren't imports, so a panel holding them passes when its real imports are plain.
8. **The property tests** use a seeded generator written here (xorshift64*) rather than a crate: the workspace's
   `proptest` is only a dependency of the vendored gpui, and adding it to deep-replica would change `Cargo.lock`. A
   counterexample prints its seed and the generated file.
9. **"The merge base loads them and fails, naming the panel"**: these tests' own failure on the base (above).
10. **"Every shipped panel"** leaves out the two spike-only panels (above).

## Known limits

- Every test runs on Linux (run here, arm64) and on macOS (not run by this job): `kit::panel` runs the panel headless
  in its slot on both, and the panel host takes gpui's headless context.
- The load is read through the panel host only, not a panel mounted in the app's own window (same `mount_panel`).
- `base-trees/plain-imports.txt` was captured on Linux arm64; the host's tree carries no layout, so it's expected to be
  the same on macOS, but that hasn't been run by this job.
- The Scope's other item, the PR recording on the shipped build whether a dynamic import of a toolkit module resolves
  today, is the PR's record, not a test here.
- The generated code is one construct per line; multi-line imports and imports split across comments aren't generated.
