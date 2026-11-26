# Acceptance tests for #3233: panel@1 holds what a person can read and reach

Written first, blind, by a job that saw only the issue, the design and the base commit `00239f65`; no implementation
of #3233 existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft
of this job (design: Dogfooding).

**Read this first: two of the four test files have not run as test files.** `kit.test.ts` and `guide.test.ts` ran
at the base. `panels.test.ts` and `budgets.test.ts` did not: the machine's throttle gave no test grant in two waits
of 60 minutes, and the base's build was gone from the checkout before a third could be asked. What stands in for them
is a reading: the built Rust half (`app/probe.rs`, which compiles at the base) and `deep-app panel-bench` were driven
directly at the base, every fixture loaded and drew there, and the judges were run on what they gave.
`BASE-FAILURE.txt` has both, each marked for what it is, and "What has run" at the end says what is still unchecked.

The issue has seven checkbox criteria, AC1 to AC7 in the body's order. Each test's name starts with its criterion's
ID (`#3233.` and the first 8 hex digits of SHA-256 of the criterion's text, white space collapsed, as
`scripts/proof-change.mjs` reads it):

| AC | ID | File |
|---|---|---|
| AC1 | `#3233.0404c3df` | `kit.test.ts` |
| AC2 | `#3233.c6c7b61c` | `panels.test.ts` (from `app/probe.rs`) |
| AC3 | `#3233.dd2321b3` | `panels.test.ts` (from `app/probe.rs`) |
| AC4 | `#3233.5531067a` | `panels.test.ts` (from `app/probe.rs`) |
| AC5 | `#3233.e6784a2a` | `panels.test.ts` (from `app/probe.rs`) |
| AC6 | `#3233.58c6f0e7` | `guide.test.ts` |
| AC7 | `#3233.640994cd` | `budgets.test.ts` |

## What was read

- Issue #3233 as saved on 2026-11-24: its opening, its four bullets, Scope, the seven criteria, Proof, Depends on.
  It has no comments. #6, #59, #1847, #1593 and #1651 were not in this job's inputs.
- `docs/technical-design.md`: Panel; Composition (Hub slots and its table); Rules every primitive follows; Socket
  roles and contract versions; Replica; Keymap, placement, window; Numbers version 0 has to hold (Every task carries
  its own budgets, The reference Macs); How we know version 0 works (Kit hygiene, Criteria to tests, Criteria in a
  checked shape, Wrong programs, Dogfooding, Built to be hard to get wrong). `docs/canvas-primitives.md`: Panel runtime
  and panel host; the look's ink floor. `docs/extension-guide.md`: A panel's module, `deep.registerView`, Slots.
  `docs/parallel-proof.md`, sections 5 to 7. `AGENTS.md`.
- At the base, for call shapes and conventions only: `packages/conformance/src` (`slots/panel.ts`, `slot-runner.ts`,
  `slot-types.ts`, `dispatch.ts`, `index.ts`), `crates/deep-app/src` (`panel_check.rs`, `panel_tree.rs`,
  `panel_keys.rs`, `panel_module.rs`, `lib.rs`, `installed.rs`, `chrome.rs`), `crates/deep-replica` (`src/kit.rs`,
  `src/shell.rs`, `src/lib.rs`, `src/main.rs`, `src/drive/mod.rs`, `Cargo.toml`), `crates/deep-panel-host`,
  `crates/deep-canvas-marks` (`src/look.rs`, `looks/clean.json`), `vendor/gpui-pre/src/elements/div.rs` (a focused
  element's Enter and Space), `packages/hub/src/panels.ts`, `packages/extension-host/src/host-types.ts`,
  `scripts/guide.mjs`, `scripts/benchmark.mjs`, `scripts/perf.mjs`, `scripts/lanes.mjs`, `benchmarks/budgets.json`,
  and the suites `1425`, `358`, `349`, `1454`, `1459`, `1492`, `981`, `992` and `2117`.
- Not read, because they are outside this job's inputs: the toolkit's own source (gpui-kit and gpui-shell are pinned
  git dependencies, not vendored). What the Rust half and the fixtures use of them is only what the base's own files
  already call.

## What the base does

`panel@1`'s kit is at revision 1 with five rules and five planted fills, and the guide's row lists those five. The
pack check and the loader take a panel whose press has no name, whose text is `#9a9a9a` on `#ffffff`, or whose press
no key reaches. `panel@1` says nothing of a panel it passes, no file records the revision a panel was installed
against, `deep-app panel-bench` reports no time for the rules, and `benchmarks/budgets.json` has no task for them.

Tab moves no focus in the replica's window at the base, so no key reaches a panel's press there; Enter and Space on
an element that already holds focus each run its press once (seen on a variant of a fixture).

At the base `kit.test.ts` fails 3 of 5 and `guide.test.ts` 1 of 2, each for the missing surface its criterion names;
the 3 that pass hold behaviour that must not change. By the judges on the built Rust half's report, `panels.test.ts`
would fail 11 of 14, the 3 that pass being the twins that load, and `budgets.test.ts` both of its 2; neither ran as
a test file. `BASE-FAILURE.txt` has each line.

## Run them

macOS only (the replica draws through AppKit), with the repo's Node (`.node-version`, 24.22.0), one file at a time:

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:/opt/homebrew/opt/rustup/bin:$PATH"
npm ci                                                  # once, from the checkout's root, as every line here
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/3233 --no-file-parallelism kit.test.ts
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/3233 --no-file-parallelism guide.test.ts
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/3233 --no-file-parallelism panels.test.ts
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/3233 --no-file-parallelism budgets.test.ts
node node_modules/typescript/bin/tsc -p tests/acceptance/3233/tsconfig.json
# the Rust half alone: what the real program gave, as one JSON object
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo test --locked -p deep-replica --test acceptance_3233 -- --out /tmp/3233.json [<a probe's name> ...]
```

| File | Needs built | Takes |
|---|---|---|
| `kit.test.ts` | nothing: it reads the conformance package's TypeScript | about 3 s (measured) |
| `guide.test.ts` | nothing: it reads the guide and runs `node scripts/guide.mjs --check` | about 2 s (measured) |
| `panels.test.ts` | the Rust half, which the file builds itself: `cargo test --locked -p deep-replica --test acceptance_3233` | the file not measured; its 12 probes took about 1 s in the built Rust half, run directly |
| `budgets.test.ts` | `deep-app` with `panel-check` and `deep-panel-host`, dev profile, which the file builds itself: `cargo build --locked -p deep-panel-host -p deep-app --features deep-app/panel-check`; its first test runs the task's own command | the file not measured; one `panel-bench` run of 164 updates took 4.6 s, and the file makes five |

- With `--root` the repo's own Vitest config isn't read. That config imports `scripts/lanes.mjs`, which needs the
  workspaces' `dist`; in a checkout where `npm run build --workspaces` hasn't run it doesn't load (seen at the base).
  No test here needs a `dist`.
- A run leaves Vitest's cache in `tests/acceptance/3233/node_modules/.vite`; delete it.
- `budgets.test.ts`'s build leaves `target/debug/deep-app` and `target/debug/deep-panel-host` built with deep-app's
  `panel-check`, as #358's build leaves the release ones. A suite that needs the plain app builds it itself, as
  #1454's does.
- Every panel is loaded from a copy under the system's temporary folder, which is removed after, so nothing is written
  beside a fixture. Every process is run to its end or stopped by its PID. Nothing leaves the machine but cargo's
  fetches; no model is called.
- `lane.json` runs the folder alone: `budgets.test.ts` reads times.

## The surface under test

The issue names the kit, three rules with their codes, the pack check, the load, a replica, a listing, the guide's row
and a budget, and no field, file or text. Below, **mine** marks each name this job chose, as small as the criteria
allow; an implementation provides each exactly as written. Everything else is the base's, used as it is.

### 1. The kit, through `@deepbuild/conformance`'s public entry

`slotKits()`, `cleanFills(kit)`, `runKit(kit, fill, { seed })` and `kitProblems(kit)`, the kit being the one whose
`slot` is `panel@1`. The tests read:

- `kit.revision` is `2`; `kit.rules` holds eight and `kit.planted` eight.
- Three rules are named "Names what it presses", "Reads on its fill" and "Reaches by key". A rule has that name when
  its `id` or its `rule` text says it, whatever the case and punctuation (**mine**): `names-what-it-presses` as an
  `id`, or a `rule` that begins "Names what it presses. Every element…", both do.
- For each of `no_name`, `low_contrast` and `pointer_only`, exactly one planted fill has it in `codes`, as its only
  code, and its `breaks` is the `id` of that code's rule. The fills' names are the implementation's: the tests find
  each by its code. What an element of a fill says of its text, colors, press and focus is the implementation's too.
- The five earlier planted fills keep their names and codes: `reaches-network` `panel_network`, `runs-a-program`
  `panel_program`, `moves-focus-unasked` `focus_unasked`, `draws-outside` `outside_panel`, `covers-the-card`
  `over_card`.
- **Hygiene names the rule (mine, from the criterion's last sentence).** When a kit passes a planted fill,
  `kitProblems` holds a problem whose `check`, `name` and `reason` together hold the `id` of the rule that fill breaks,
  whole (no letter, digit, `_` or `-` beside it), or the rule's name. At the base the problem reads `planted fill
  <name> passes every case of the fixed part; the kit admits it` and names no rule, so this is new.
  Example: `planted fill <name> passes every case of the fixed part; the kit admits it, and nothing holds rule
  names-what-it-presses`.

### 2. A refusal, at pack check and at load

- **The pack check** is `panel@1`'s install check, `deep_replica::kit::panel(dir) -> Verdict { pass, names }`, as
  #1425's suite reads it: a refusal is `pass: false` with its text in `names`.
- **The load** is `deep_app::mount_panel(runtime, dir, window, cx)` in a headless replica, then one frame, as #1425's
  suite reads it: a refusal is its `Err`, read as `format!("{err:#}")`, or a view that built nothing after that frame.
- **What a refusal names (mine).** One text, in any wording, that holds:
  - the code, whole: `no_name`, `low_contrast` or `pointer_only`, no letter, digit or `_` beside it;
  - **the node, by its id**, whole, as the script gave it: the string of `.id("refresh-control")`, or a `Button`'s
    own id, `Button.new("button")`. Case counts, so `Button` alone doesn't name the node `button`;
  - for `low_contrast` with both colors the panel's: each color as `#rrggbb`, its digits in either case, and the
    ratio as a number within 0.05 of what the test computes from the two colors (`2.8`, `2.81` and `2.814:1` all
    name 2.814; `4.5` alone doesn't);
  - for `low_contrast` with only `text_color` the panel's: the theme's word, `light`, in any case, and at least one
    of the look's fills the text fails on in that theme, by its role's word (`ground`, `raised`) or by its color
    (`#ffffff`, `#f5f5f6`).
  Examples: `panel@1 refused this panel: no_name: the div refresh-control takes a press and has no name`;
  `low_contrast: text #9a9a9a on #ffffff reads 2.81:1, under 4.5:1`; `low_contrast: text #cccccc on the look's raised
  (#f5f5f6) in light reads 1.47:1, under 4.5:1`; `pointer_only: the div refresh-control takes a press and can't take
  focus`.
- **The check reads the tree a script builds, not its source.** The fixtures are written so: `nameless-press` holds
  the word "Refresh" in a branch it never takes, `pointer-only` makes a focus handle it never gives the div, and the
  three color fixtures build each color when they run (`"#" + "9a".repeat(3)`). This is the design's rule (Checks read
  only the lowered form), not a new one.

### 3. A panel installed against revision 1: `panel-kit.json` (**mine**)

The pack check and the loader each take a folder and nothing else, and at the base both the hub and the app run a
panel from a working copy of its folder, never from the installed bytes. So the record of an earlier install is one
file in that copy, beside `main.js`:

```json
{ "slot": "panel@1", "revision": 1 }
```

- It is the installer's record of the kit revision the panel was installed against, in the base's own words for a
  fill (`slot`, `revision`). `deep_replica::kit::panel(dir)` and `deep_app::mount_panel(.., dir, ..)` read it.
- **With no such file a panel is held to the kit's current revision**, at pack check and at load. A new package and
  an update of an installed one are both that: a folder no record comes with.
- With `revision: 1`, the loader loads a panel that revision 2 would refuse, and the pack check passes it and says
  what it would fail (section 4).
- Who writes the file into the copy (the hub, the app), and that a package's own copy of it is never honoured, are
  the implementation's and are not tested here.

### 4. What `panel@1` says of an installed panel (**mine**)

`views.installed` lists each view with `kit`, what `panel@1` said of it, and the hub builds that from the one JSON
line `deep-replica --panel-kit <dir>` prints, `Verdict::to_json()`. For a panel whose record says revision 1 and that
holds a nameless press, that line has `"result": "pass"` and names the finding: somewhere in the line, `no_name` and
the node's id, each whole. The field is the implementation's; `names`, which a passing verdict leaves empty at the
base, serves. Example: `{"result":"pass","names":"held to revision 1; revision 2 would refuse it: no_name: the div
refresh-control takes a press and has no name"}`.

### 5. Reaching by key, in a replica

The panel is mounted through `mount_panel` in a headless replica's window (`deep_replica::headless_context`,
`gpui_kit::open_window` with the replica's `window_options`), and driven by key events alone, as the OS sends them
(`Window::dispatch_event` with a `KeyDownEvent`, then a `KeyUpEvent`): no pointer, and no call that sets focus.

- **Tab** is pressed until the Enter that follows it runs the panel's handler, at most 4 times (the replica's window
  may hold a stop of its own before the panel). Tab alone must run nothing.
- **Enter**, then **Space**, each one key down and one key up, each run the handler exactly once. The count is the
  number the fixture draws after `Refreshed `, read from the tree after each key.

### 6. The guide

`docs/extension-guide.md`'s Slots table, the row whose method is `deep.registerView` and whose interface is `panel@1`:
its "Planted wrong fills" cell lists eight names in backticks, each once: the five above and the kit's three, by the
names the kit gives them. `node scripts/guide.mjs --check` exits 0 with a line starting `PASS guide`.

### 7. The budget

- **`panel-rules-500` (mine)**: a task in `benchmarks/budgets.json` with that id, valid by `validateBudgets` against
  the merge base's budgets, whose `initialReason` names `#3233`, and whose command runs from the repo root (exit 0).
  What it measures is the implementation's; the perf lane compares it with the merge base.
- **`rulesNs` (mine)**: each run in `deep-app panel-bench`'s report (`{runs: [{warmup, scriptNs, ipcNs, totalNs}],
  ...}` at the base) gains `rulesNs`, one number a timed update: the nanoseconds the three rules took on that update's
  tree, in the app. Each is above zero: a time that wasn't taken is missing, never `0`. Example:
  `{"warmup":64,"scriptNs":[…],"ipcNs":[…],"totalNs":[…],"rulesNs":[41250,39875,…]}`.

## Planted things

The criteria name three. All three are test code in this folder, so none needs a feature, an environment variable or
a twin, and `twins.json` isn't needed. Each runs the same judge its real side passes.

| Planted thing | Where | What it does, and doesn't |
|---|---|---|
| A kit that passes one of the three plants (AC1) | `kit.test.ts`, `admitting` | The shipped kit, spread, with one change: its judge lets a finding that raises the plant's code through. Every other rule, fixture and planted fill is the shipped kit's. The test first holds the shipped kit to the same hygiene, which it must pass, and checks that the changed kit reads `PASS` on the plant; if it doesn't, the test reads BLOCKED |
| A host that runs the handler on both key down and key up (AC4) | `app/probe.rs`, `Mounted::press` with `planted` | The replica's key delivery with one change: an activation key's press completes on its key down and again on its key up, which reaches the window as two down-up pairs where the real delivery sends one. Tab is delivered as the real host delivers it. The real host must pass "exactly once" first; a planted host that also reads once is BLOCKED |
| A host that refuses a revision-1 panel at load (AC5) | `app/probe.rs`, the probe `installed-at-1-planted` | A host that drops `panel-kit.json` before it loads the panel, so the real loader holds it to the kit's current revision. The real loader must load the panel with its record first. A planted host that loads it too, or refuses it without `no_name`, is BLOCKED |

None of the three is built apart from the suite: each is built or run with it. At the base:

- The first fails before its plant, since the three planted fills don't exist (seen in a run).
- The second fails at its first step: the real host doesn't pass at the base, where Tab reaches nothing, so its
  plant shows nothing yet. The planted delivery itself was seen to do what it says, on a variant of `named-press`
  that takes focus itself: the real delivery read 1 after Enter and 2 after Space, the planted one 2 and 4.
- The third reads BLOCKED: the planted host loaded the panel too, since no load at the base holds a panel to
  revision 2 (seen in the Rust half's report).

## The fixtures

`fixtures/<name>/main.js`, each a panel on `@deepbuild/panel` that takes focus where it needs it, sets no color it
isn't about, and draws inside its panel, so one thing is wrong with each refused one.

| Fixture | What it is | Expected |
|---|---|---|
| `nameless-press` | a `div`, id `refresh-control`, that takes a press and focus and holds no text | refused, `no_name` |
| `named-press` | the same `div` holding "Refresh"; its press counts and the count is drawn | loads; driven by key |
| `pointer-only` | the same `div` holding "Refresh", with no focus | refused, `pointer_only` |
| `button-label` | `Button.new("button")` whose only child is the text "button", with focus | refused, `no_name` |
| `faint-text` | text `#9a9a9a` on a `bg` of `#ffffff` | refused, `low_contrast` |
| `clear-text` | the same with text `#595959` | loads |
| `text-color-only` | only `text_color`, `#cccccc`, and no `bg` anywhere | refused, `low_contrast` |

`app/probe.rs` copies a fixture's `main.js` to a temporary folder for each probe, with `panel-kit.json` where the
probe says the panel was installed against a revision: `installed-at-1` is `nameless-press` with the record
`{"slot":"panel@1","revision":1}`; `installed-at-1-planted` and `update-of-installed` are the same script with none.
The 500-node panel of AC7 is written by `helpers.ts` (`BENCH_PANEL`): a root with a `bg` of `#ffffff`, one bare `div`,
and 249 rows, each a `div` that takes a press and focus, holds its own text and sets its color to `#595959`.

## How each criterion is read, and what fails each test

- **AC1** (`kit.test.ts`).
  1. The kit's lists (section 1). Fails at the base: revision 1, five rules, no such plant.
  2. `runKit` on each of the three planted fills, both parts, seed 3233: the verdict is `FAIL`, and every case that
     doesn't pass is a `FAIL` whose codes are the fill's one code, whose message holds the fill's `message` and no
     other planted fill's. Fails at the base: the fills don't exist.
  3. The reference panel passes every case of both parts. Passes at the base and says so; it fails a kit whose new
     rules fail its own reference.
  4. The five earlier plants, by name and code, each fail as in 2. Passes at the base and says so; it fails a kit
     whose new rules reach an earlier plant first.
  5. Planted: the shipped kit passes its hygiene; a kit that passes one of the three plants fails it, naming the rule
     (section 1). Fails at the base: no plant to pass; then on a hygiene that names only the fill.
- **AC2** (`panels.test.ts`). `nameless-press` is refused at pack check, and again at load, each naming
  `refresh-control` and `no_name`: two tests, each failing at the base, which takes the panel. `named-press` passes
  the pack check and loads, drawing "Refresh": passes at the base and says so; it fails a rule that refuses every
  press. `button-label` is refused at both, naming `button` and `no_name`: fails at the base.
- **AC3** (`panels.test.ts`). `faint-text` is refused at both, naming `#9a9a9a`, `#ffffff` and the ratio the test
  computes (2.81), which the test first holds under 4.5 itself. `clear-text` loads, its ratio (7.00) first held at
  or over 4.5: passes at the base and says so. `text-color-only` is refused at both, naming `light` and one of the
  fills `#cccccc` fails on there; the test takes the shipped look's ground and raised in light and dark from
  `crates/deep-canvas-marks/looks/clean.json`, computes all four ratios, and takes the theme of the worst pair. Its
  load runs with the replica drawing dark, where `#cccccc` reads well, so a check of the appearance on screen alone
  fails it.
- **AC4** (`panels.test.ts`). `pointer-only` is refused at both, naming `pointer_only` and `refresh-control`: fails
  at the base. `named-press` loads: passes at the base and says so. The key drive (section 5) on `named-press`: Tab
  runs nothing, Enter runs the handler exactly once, Space exactly once. It fails at the base, where four Tabs reach
  nothing: `Enter ran the handler 0 times`. Planted: the real drive passes; the planted host's fails with `the planted host: Enter ran the handler 2
  times, not exactly once`, which is the count.
- **AC5** (`panels.test.ts`). `installed-at-1` loads, and what `panel@1` says of it passes it and names `no_name`
  and `refresh-control` (section 4): fails at the base on the second half. Planted: the real loader loads it; the
  planted host (no record) refuses it with `no_name`, and the judge fails it with `installed-at-1: the planted host
  refused at load a panel installed against revision 1`, which names the panel. `update-of-installed`, the same
  script with no record, is refused at pack check, naming `refresh-control` and `no_name`: fails at the base.
- **AC6** (`guide.test.ts`). The row lists the eight (section 6): fails at the base, which lists five. The drift
  check passes: passes at the base and says so; it fails a guide whose row was edited by hand, off the contract.
- **AC7** (`budgets.test.ts`). The task (section 7): fails at the base, which has none. The number: five runs, each
  one `deep-app panel-bench --runs 1 --updates 100` of a fresh host on the 500-node panel, whose tree the test counts
  at 500 nodes; a run's reading is its slowest `rulesNs`, in ms; the one-minute load is read at each run's start and
  end; `judgeLimit` (`scripts/benchmark.mjs`) judges the five against 1 ms. PASS passes and FAIL fails. Anything
  else fails as `INCONCLUSIVE:` with the five readings: off a reference Mac, on battery, with the thermal state not
  nominal or the load above the core count, a time decides nothing, and is never a pass. The work runs first, and
  each report's `rulesNs` is held by an assertion of its own, so the base fails there, on the missing `rulesNs`, not
  as INCONCLUSIVE.

A probe that didn't run is never a pass: no `[[test]]` entry, a Rust half that doesn't build, a probe that panicked,
a panel that drew no count, a build of `deep-app` that failed, a bench that wrote no report, each fails as
`BLOCKED:` naming it.

## Readings: where the issue and the design leave a choice

1. **"Pack check" and "at load"** are `deep_replica::kit::panel` and `deep_app::mount_panel` with one frame, as
   #1425's suite settled them for the same sentence of the design. `deep-app panel-check`, the app's check behind the
   `panel-check` feature that the issue's bullets cite, is not read (see What isn't asserted, 1).
2. **"Naming the node"** is its id, whole. A node with no name still has an id, the base's own key for an element
   (#358's `panel-keys`), and a path or an index would tie the test to one tree shape.
3. **"Naming both colors and the ratio"**: `#rrggbb` in either case, and a number within 0.05 of the computed ratio.
4. **"Naming the look's fill and the theme where it fails"**: the fill by its role's word or its color; the theme by
   its word. `#cccccc` fails on both of the look's light fills (1.47 on raised, 1.61 on ground) and on neither dark
   one, so either light fill passes, and "the worse pair decides" is read as the theme the refusal must name.
5. **"A `Button` whose only label is "button""**: its id and the text under it are both that word, so however
   "label" is read, the word is all there is.
6. **"Its own code and message and no other"** is held on every case of a run that doesn't pass, in both parts of
   the kit, with a seed the test writes (3233) so a failure replays.
7. **"A kit that passes one of the three plants"** keeps the plant and loosens the kit, where #349's `admittingKit`
   swaps the plant for the reference fill: the criterion's wrong program is the kit.
8. **"Naming the rule"** (hygiene): the rule's `id`, whole, or its name.
9. **"In a replica Tab reaches it"**: at most 4 Tabs, then Enter; the proof that Tab reached it is that Enter then
   runs its handler, since nothing else gave it focus. Space is driven too: the Scope says "Enter or Space".
10. **"A planted host"**, both times, is test code (design: Wrong programs, "a planted wrong program lives in test
    code, or behind a build feature"), since neither can exist before the work. The loader's and the replica's own
    code carry no plant for this suite.
11. **"Built against revision 1"** is `panel-kit.json` in the panel's working copy (section 3), and a folder with no
    record is held to the current revision. AC2 forces the second half: a bare planted panel is refused at load.
12. **"Its listing shows the finding"** is read at the listing's source, the line `panel@1` prints for the hub
    (section 4). No base suite reads `views.installed` without the real window, which needs a logged-in screen.
13. **"An update of that panel with the node unchanged"** is the same script given to the pack check as a new
    package, with no record.
14. **"The check of a 500-node update"** is the three rules' own time on one update's tree in the app, as
    `panel-bench` holds it: at the merge base the rules add nothing, so what they add is that time. A run's reading is
    its slowest update, as #1425's budget reads a panel's update. The build is the dev profile, which the preflight's
    budgets are read off. "In the local preflight" isn't something a test can see: it reads as this file run on a
    reference Mac.
15. **"The 1 ms is a target, to be measured"**: the test holds 1 ms as the limit, the issue's value. A measurement
    that moves it is a change to this test by an approved proposal, not the implementer's.
16. **"Eight planted fills"**: the five by the names the row has, the three by the names the kit gives.

## What isn't asserted

1. **`deep-app panel-check`'s report.** The Scope says the app's check reports the three "beside `outside_panel` and
   `over_card`", which are that report's `violations[].kind`. Every criterion names the pack check and the load, so
   the suite reads those two, and whether the report carries the three kinds is unheld here.
2. **An element that takes text** (an `Input`) having a name; a name from text deeper under the element, or from a
   label set apart from the text; a `text` node or a flex that takes a press.
3. **Fills further down**: text on a fill set by an ancestor other than its parent, a panel that sets only `bg`, a
   color at an alpha, and the look's hover and selected fills.
4. **The three codes on a node that breaks two rules at once**, and the order they are reported in.
5. **The listing past its source**: `views.installed`'s shape, the hub keeping the reading, the app showing it, and
   the installer writing `panel-kit.json` for panels installed before this issue.
6. **The shipped panels and the guide's sample** passing revision 2, and other suites' fixture panels.
7. **Generated cases** for the three rules (design: Universal rules are tested as properties): no criterion names
   a generator. The kit's seeded part is run from one written seed only.
8. **What a fill's element says** of its text, colors, press and focus at revision 2: the tests read codes,
   messages and names.
9. **The Scope's last line**: states told apart by color alone, text size inside a panel, and a panel's canvas are
   not in this task, and nothing here reads them either way.
10. **The perf lane's own comparison** with the merge base: the first budget test holds the task, not a lane run.
11. **A held key** (key repeat), a modified Enter, and focus leaving between a key's down and its up.

## What the implementer adds outside this folder

1. One `[[test]]` entry in `crates/deep-replica/Cargo.toml`, word for word:

   ```toml
   # Issue #3233: the pack check, the load and a panel driven by key, read for tests/acceptance/3233, written blind.
   # A probe that judges nothing: panels.test.ts runs it by name and judges what it wrote, so a workspace run leaves
   # it. No harness: AppKit wants the main thread.
   [[test]]
   name = "acceptance_3233"
   path = "../../tests/acceptance/3233/app/probe.rs"
   harness = false
   test = false
   ```

2. The task `panel-rules-500` in `benchmarks/budgets.json` (section 7), with whatever its command needs.

Nothing else: `lane.json` is in this folder, and the suite needs no feature, plant name or environment variable.

## What has run

- `tsc -p tests/acceptance/3233/tsconfig.json`: clean. `node --check` on each fixture: clean.
  `rustfmt --edition 2021 --check app/probe.rs`: clean. `app/probe.rs` compiles at the base (the caller's build).
- The judges (`judges.ts`) on planted inputs, as a plain node script outside this folder: 89 checks, each judge passing
  a good input and failing each wrong one with what its criterion names, the base's own answers among the wrong ones.
- `kit.test.ts` at the base: 3 fail, 2 pass. `guide.test.ts` at the base: 1 fails, 1 passes. Both ran directly,
  not through the throttle: they build nothing and take under a second.
- The planted kit's change, tried on each of the base's five plants: the shipped kit reads `FAIL`, the changed kit
  `PASS`, and the base's hygiene then names the fill and no rule.
- The built Rust half, run directly at the base, all 12 probes: every fixture passed the base's pack check, loaded
  and drew the tree its comment says (`BASE-FAILURE.txt` has each tree). The key drive read 0 after four Tabs.
- The same key drive on three variants of `named-press`, each put back after: a script may not take focus during
  render; given focus by its own task, Enter and Space each ran the press once, and the planted delivery twice; given
  `.tab_index(0)` and `.tab_stop(true)`, Tab still reached nothing.
- `deep-app panel-bench` with `deep-panel-host`, dev build, on the 500-node panel, through `helpers.ts`'s `bench`:
  the report's tree counts 500 nodes, and its run has `warmup`, `scriptNs`, `ipcNs` and `totalNs`.

Not run or not checked:

- `panels.test.ts` and `budgets.test.ts` as test files: their own cargo step, the reading of cargo's messages for
  the two binaries, and the `beforeAll` that holds the report. Two requests for a test grant each ended
  `INCONCLUSIVE no grant: no test grant came within 60 min`, and the base's `target/` was gone from the checkout
  before a third.
- That a test file's own build step compiles nothing on a fresh build.
- `node scripts/repo-rules.mjs` on this folder.
