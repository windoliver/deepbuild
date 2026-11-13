# Acceptance tests for #538: live game state in text and cells: the logic grid, keyed copy with plural forms, flip by array, and the agent tools

Written first, from issue #538 (its Scope, its Fields, nine acceptance criteria, its Proof line and its Oracle line), the
parent #186 for what the sibling parts own, the design sections the issue links and those they lean on, and the base
commit `53c0e72a3` (origin/main), by a job that never saw an implementation; none existed, and no other worktree, branch
or pull request was read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind
redraft of this job (design: Dogfooding). Lean: one file per criterion, one test per criterion and one per planted twin
the criterion names, each test carrying its criterion's ID. The Oracle line's lane is `tests/acceptance/538-oracle/`.

## What was read

- The issue (`gh issue view 538`) and its parent #186 (#535 logic columns, #536 hex grids and #537 instancers and
  overlays are the siblings; #960's icons and bars aren't this issue's). The Scope's `deep_kinds` listing is in no
  criterion and isn't tested here.
- `docs/canvas-primitives.md`: Array and table, and Array and table: column view; Text `text@1` and Text `text@1`: keyed
  copy (and its entries, for what keyed copy is not); Frame and group `frame@1`, `group@1`, and Frame and group: flip;
  Mark set and columns `marks@1`; Mark set: atlas tiles; Mark set: logic columns; Cell grid `cells@1` and Cell grid
  `cells@1`: logic grid; Logic `logic@1`.
- `docs/technical-design.md`: The canvas core (canvas modules, the module table's text, marks2d, data, cells, logic rows,
  `module_missing`, build sets, the seal); Document; 2D marks and paint; Mark set, scale and encode; Cell grid; The logic
  module; Dogfooding.
- The Oracle page `doneright/oracles/issues/538.md` and the vendor copy of the one upstream file it pins (README of the
  oracle lane).
- At the base, only for surfaces and conventions: `AGENTS.md`; `scripts/proof-change.mjs` (`criterionId`),
  `scripts/lanes.mjs` (`alone`, `timed`), `scripts/benchmark.mjs` (`judgeLimit`, `fingerprint`, `validateBudgets`),
  `benchmarks/budgets.json` (`canvas-ground`); `crates/deep-show` (`main.rs`'s calls, its cargo features and
  `test-leave-out-logic`, `physics.rs`'s planted motion module, `hub.rs`'s `deep_show`, `check` and `verdict`,
  `frames.rs`' `eval`, `frames`, `remaps`, `registry` and the cell grids it draws, `time.rs`' `determinism`,
  `terminal.rs`' `grid_blocks`, `logic.rs`, `query.rs`); `crates/deep-canvas-cells/src/module.rs` (`cells@1`, its
  params, the `cells.grid` operator, which reads `t`); `crates/deep-canvas-motion/src/held.rs` and `eval.rs` (the flip
  at the base); `crates/deep-canvas-marks/src/scene.rs` (`copy: key`, #407's localized copy, `numerals`) and `data.rs`
  (a mark set's text rows); `crates/deep-logic/src/module.rs`; the suites `535/` and `537/` (conventions, documents,
  programs, the taste call, the budget), `1967/` (the `cells` block), `1918/` (a planted module the seal refuses),
  `305/` and `403/` (`module_missing`, BLOCKED), `2017/` (a budgets.json task and a bench mode), `1965-oracle/` (a
  pinned vendor file).

Code was read only to learn the surfaces. Every expected value comes from the issue, the design and this suite's own
programs and fixtures.

## What the base already does, and these tests don't credit

`deep-show run` presents documents, evaluates their frames (`eval`, `frames`), plays and seeks them (`determinism`, whose
sides carry each cell grid's cells, #1967) and draws #407's localized copy (`copy: key` into `data.copy[locale]`) in the
view's locale, so a frame drawn in `view: {locale: "fr"}` hashes as the same string written out (probed before the run,
not committed). Mark-set columns read logic arrays through the column view (#535), and in the build without logic a mark
set that reads one is refused with `module_missing`, its check BLOCKED. A cell grid draws a `frame` or plays a recording.
Nothing reads a cell grid's `grid`, a text's `{copy: <table>[<path>]}`, a text column's `{copy, key}` or a flip's
`array`; a flip's keys aren't applied in the frame `eval` draws (both children of a keyed flip draw); a `cells@1` with
no `play` is refused at check (`unknown_asset` at `params/play/asset`); and in the build without logic a document whose
flip reads a logic array is presented and its check answers PASS.

## Run them

```sh
npm ci && npm run build --workspaces   # once, in a fresh worktree
PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 NO_COLOR=1 \
  npx vitest run tests/acceptance/538/<file> --testTimeout=600000
npx tsc --noEmit -p tests/acceptance/538
```

Each file builds what it drives once, in `beforeAll`, honoring `CARGO_TARGET_DIR`, and copies it to a temporary folder:
`cargo build --locked --bin deep-show` (the default `full` set; `ac7` builds `--features test-leave-out-logic` and
`--features test-leave-out-logic,test-data-reads-logic-array` instead), `ac8` also `cargo build --locked --bin
deep-gpu`, and, on a reference Mac at rest only, both with `--release`. Every file assembles its programs with #544's
assembler (`tests/acceptance/544/wat`, read only), built into `target/acceptance-538-wat/`. Every test passes its own
timeout (an hour; the budget four). Folders are temporary and deleted; only `ac9-taste.test.ts` writes outside them, its
pictures to `docs/evidence/538/`. Node built-ins, vitest, `../467/helpers.ts`'s PNG reader and writer, `../537/helpers.ts`'s
`view3d` helpers (`ac8` only) and `scripts/benchmark.mjs`'s `judgeLimit`, `fingerprint` and `validateBudgets` (imported,
never copied); no process is started but `cargo`, the assembler, `deep-show` and `deep-gpu` (and what `fingerprint`
reads), each waited for, none stopped by name or port.

**The lanes lines.** The implementer adds these to `scripts/lanes.mjs` (this README is the instruction):

```js
// #538's files build deep-show (ac8 also deep-gpu) and #544's assembler, run logic programs and draw; ac8-budgets
// judges the task's budgets on the reference Mac.
alone.push('tests/acceptance/538/', 'tests/acceptance/538-oracle/');
timed.push('tests/acceptance/538/ac8-budgets.test.ts');
```

Gates: a machine with no GPU for `determinism`'s pixel hash fails `BLOCKED:` (`ac1`); off macOS, a `view3d` reading
fails `INCONCLUSIVE:` (`ac8`); an assembler that doesn't build fails `BLOCKED:`; none is a pass. `ac8-budgets.test.ts`
times only where the perf lane's rule can judge (a reference Mac, mains power, Low Power Mode off, thermal state
nominal, the load under the cores at each run's start and end), else INCONCLUSIVE before anything is timed, never a pass;
its counters and surfaces are read everywhere. Criterion 9 is `INCONCLUSIVE:` until its taste call is recorded. No other
reading depends on load, timing or a device.

## The surface under test

The issue names fields, issues, plural forms, locales, a hash, steps, budgets and planted programs, but no call. As in
#535's, #1967's and #537's suites, everything goes through calls the base already has, extended by the fields below:

- **`deep-show run`** (one JSON scenario per stdin line, one answer `{"ok": true, "replies": […]}`, one reply per call),
  the one binary that holds the logic module's runner, the column view, the text, marks2d, data and cells modules and
  the canonical render. Every frame read here is the one the hub's own session draws (`eval`, `frames`) or plays and
  seeks (`determinism`), the scheduler's frame. At the base a flip's keys are applied only where
  `deep_canvas_motion::eval::items` evaluates a document's items (deep-gpu's 2D layers, scene3d's frames, render-back's
  `Renderer::prepare`), not in that frame, so a flip by array must hold there.
- **`deep-gpu run`'s `view3d`** (#378, #537) for criterion 8's two GPU uploads alone.

**Every field, reply field, payload field, plant name and feature name below that the issue or the design doesn't give
is this job's choice, the smallest the criteria need; the implementer builds exactly these, or a dispute goes to a blind
redraft.** Times are flicks (integers; 11,760,000 a 60 Hz step), and "step k" is the frame at k × 11,760,000, which reads
the arrays as step k left them.

### Documents

Each is a #391 film envelope as #535's suite writes one: `{format: 1, id, profile: "film", title, description, size,
seed: 538, camera: "cam", transport: {span: "4s", frame_rate: [60, 1]}, items, assets}` (`heap` over `"0.5s"`), the camera
a 2D orthographic `camera@1` over the page, each program in the evidence store and listed in `assets` as `{sha256,
license}`, a copy document with `locale: "en"` and `data.copy`, a document with a cell grid with `requires: {modules:
{cells: "^1"}}` (the base refuses a `cells@1` its document doesn't require). The issue's fields, as the tests write them:

| Field | As written | Source |
|---|---|---|
| A logic item | `{kind: "logic@1", params: {program: <sha256>, step_rate: 60, writes: {<name>: {type, count}}}}` | #535's form |
| The logic grid | on `cells@1` `board`: `params.grid: {array: "rules.cells", size: [40, 12], glyphs: [".", "#", "@", "é"], roles: ["ink", "accent"]}`, beside `size: {cols: 40, rows: 12, cell: [8, 16]}`, `font: {family: "mono", size: 13, fallback: [], ligatures: false}` and `palette: {fg: "ink", bg: "ground", ansi: [16 terminal roles], truecolor: true}`; no `frame`, `patch` or `play` | the issue's Fields |
| The grid's background | its `palette.bg` (here the ground): what a value past a list draws its blank cell in | Cell grid: "the grid's own background" |
| Keyed copy | on `text@1` `caption`: `params.text: {copy: "loot[rules.item]", args: [{path: "rules.count", widest: "999"}]}`, `size: 13`, `numerals: "tabular"` (written on the references too, so the numerals never depend on how copy counts as bound) | the issue's Fields |
| A copy table | `data.copy[locale][table]: {"<key>": string \| {one, other, …}}`, no `missing` written (its default, `""`) | the issue's Fields |
| The fit check's item | `offer`: `params.box: {w: 200, h: 20}`, `max_lines: 1`, `text: {copy: "items[rules.item]", args: [{path: "rules.count", widest: "999"}]}`; the bare argument `args: ["rules.count"]` | criterion 4 |
| A text column | on `marks@1` `labels` (`mark: "text"`): `columns.kind: {array: "units.kind", as: "i32"}`, `columns.text: {copy: "kinds", key: "kind", args: []}`, `x` and `y` f32 data columns, `encode: {x: {column: "x"}, y: {column: "y"}, text: {column: "text"}}`; no `n` | the issue's Fields; Mark set: logic columns |
| Flip by array | on `group@1` `dialogue`: `params.flip: {array: "story.line[0]", map: {"0": "l0", …, "39": "l39"}}`, the children `l0` … `l39` with `parent: "dialogue"` | the issue's Fields (`<logic>.<name>[index]`) |

### `deep-show run`: the calls, and what this suite adds

| Call | What the tests send | What they read | New or existing |
|---|---|---|---|
| `deep_show` | `{session, doc, document, include: ["issues"] (+ "pixels", "timing"), check?: true}` | `outcome`, `issues`, `result` (with `check`) | existing (#393, #305) |
| `deep_show`'s **`timing.copy_fit_ms`** | `include: ["issues", "timing"]` | the CPU time in ms the text module's fit check over every key of every copy table in every locale the document carries took at this check, measured in-process by a monotonic clock | new field of the existing `timing` block |
| `eval` | `{doc, t, pixels, view?: {locale}}` | `outcome`, `snapshots[0].sha256`, `steps`, **`issues`** | existing (#387); `issues` extended |
| `eval`'s `issues` | | the issues the frame at t raises, in the check's issue form with their own fields at the top level, as the base flattens #535's: **`grid.out_of_range {array, cell: [x, y], value, step}`**, **`copy.missing {table, key, array, step}`**, **`flip.unmapped {value, array, step}`** (`array` the logic array's path, `step` the logic step, `key` and `value` numbers); a field may instead sit under `actual` | extends `eval` |
| `frames` | `{doc, count, step: "1f", from?, pixels, timings?: true}` | `frames[].pixel_hash`, `frames[].ran`, `frames[].remaps` (#535) | existing (#387, #535) |
| `frames`' **`timings`** | `timings: true` | each frame gains **`compares: [{logic, step, bytes, ms}]`**, one entry per logic step whose arrays the frame applies first (a frame played one step after the last applies one), `bytes` the bytes of the arrays that step wrote, `ms` the CPU time the logic module took comparing them with their values after the step before and finding the changed ranges, where that step ran (a bake at check or the frame); and each **`remaps`** entry gains **`ms`**, the CPU time the data module took remapping those rows. Without `timings` nothing changes | new |
| `determinism` | `{doc, display_hz: 60, at_times, compare: "same_machine"}` | each side's `cells.<grid>` (#1967): `{cols, rows, text, cursor, cells: [{g, fg, bg, attrs, link}]}`, every cell as drawn; a logic grid is one more cells@1 there | existing (#488, #1967) |
| `revisions` | `{doc}` | `revisions[]` (`rev`, `hash`, `state`) | existing |
| `registry` | `{}` | `modules` | existing |
| scenario `planted` | one of the five names below | | existing form, new names |
| `deep-show` build | `--features test-leave-out-logic`, and with `test-data-reads-logic-array` | the seal's refusal line (#200): `{ok: false, code: "seal_refused", reason, modules, operators, arrays, what}`, exit 2 | existing (#403); one new feature |

### `deep-gpu run`'s `view3d`: what this suite adds

| Field | Meaning |
|---|---|
| **`upload_ms: {<item>: ms}`** on every frame with `timings: true` | for each instancer fed by logic and each plate with overlays, the CPU time in ms from the start of writing this frame's changed slot records (or overlay cells) to the return of the queue's write of them; 0 for an item the frame uploads nothing for |
| `element_uploads` (#537) | read for `swarm`: the 1,000 slots each step moves |

### Plants

Each is one criterion's wrong program and changes nothing else. The five behaviors are values of the scenario's
`planted`, reachable only there (any other value stays `bad_input`); the data module is a cargo feature, since the seal
refuses it before any scenario. `twins.json` maps each criterion's ID to its plant.

| Name | Where | Criterion | The wrong program |
|---|---|---|---|
| `grid_wraps_index` | `planted` | 1 | the logic grid's unpacking takes each glyph and role index modulo its list's length, so 7 draws glyph 3 ('é') in ink on ink, instead of a blank cell |
| `plural_en_rule_for_fr` | `planted` | 2 | the text module picks a plural entry's form in French by English's cardinal rule (one only for 1), so 0 shows `other` |
| `copy_keeps_first_position` | `planted` | 3 | the text module's lookup keeps, per table, each key's position in the order its first revision stored the table, and after a later revision reads the entry at that position |
| `labels_keep_first_locale` | `planted` | 5 | the text module keeps each mark-set row's string from the first locale it shaped it in, so after the view's locale changes every row still shows its en name |
| `flip_holds_last_child` | `planted` | 6 | on a value its map lacks, a flip by array keeps showing the child it showed last (raising `flip.unmapped` as shipped) |
| `test-data-reads-logic-array` | cargo feature of `deep-show`, built with `test-leave-out-logic` | 7 | the shipped data module with one more operator whose read set names a logic array by its array name (`logic.…`), not through the column view; the seal refuses it, naming the data module and that array |

## Programs

`programs.ts` holds the logic programs as WebAssembly text, assembled by #544's assembler. Each exports `memory`,
`init`, `step`, `reads_at` (0) and `writes_at` (4096), lays its write region out as the logic module does (arrays in
declaration order on 8-byte boundaries, a bool or an i32 4 bytes, a vec3 24), and writes every element at every step.

- `grid` (`rules`): `cells` i32 × 480, index 40 y + x: walls `0x10001` ('#' in ink on accent) round the edge, floor
  `0x1000` ('.' in accent on ink) inside, `0x1002` at (5, 3), `0x1003` ('é') at (20, 6), and 7 at (12, 7) from step 30.
- `loot` (`rules`): `item`, `count` i32 × 1: item 17, but 99 at steps 30 to 39; count 12, but 1 at steps 10 to 19 and 0 at
  20 to 29. `shop`: item 1 and count 5 at every step.
- `units`: `kind` i32 × 30: row i kind i mod 10; row 17 kind 42 from step 30.
- `story`: `line` i32 × 1: 12 before step 20, 37 at 20 to 59, 52 at 60 to 89, 5 from 90.
- The budgets': `heap` (`a` i32 × 262,144, 1 MiB; step k changes element k); `layer` (`map`: `cells` i32 × 9,216 on 96 ×
  96, step k changes cell k); `crowd` (100,000 slots: `live` bool, `gen` i32, `pos` vec3; step k moves the 1,000 slots of
  block k); `fogger` (`fog` i32 × 65,536 on 256 × 256, every cell changes every step).

## Fixtures

`fixtures.ts`. A text's references are the same item showing its string and no logic, so "shows S" is a pixel hash, not
a picture judged. A reference's string is #407's localized copy (`copy: "shown"` into `data.copy.en.shown`), which the
base shows as text: a count written out as a literal `text` is refused by the honest-numbers check (`number_unsourced`).
For the same reason no fixture string writes a digit out but through a placeholder.

- **The grid** (`gridDoc`, 336 × 232 u): `board` at (8, 8), and `key` at (8, 208), a 3 × 1 grid of literal cells (`frame`)
  whose palette's ANSI 0 is ink and 1 accent: '@' in 1 on 0, '#' in 0 on 1, and a blank in the defaults (fg ink, bg
  ground). The roles' colors are read from what the cells module draws for `key`, never written here. At the base a
  cells@1 without `play` is refused at check, `unknown_asset` at `params/play/asset` (the kind probes `play.asset`
  whether or not the grid plays a recording); a logic grid has no `play` either, so the implementer's fix covers both,
  and `key` must be presented beside `board`.
- **The caption** (`copyDoc`, 320 × 40 u): `caption` at (8, 12), 13 u, over `loot`. Criterion 2's table is key 17 in en and
  fr as the criterion writes it; criterion 3's is en alone, keys 4 ('You found a rusty key'), 17 and 9 ('You found a silver
  ring'), written into the scenario's line in the order given (a JSON object in JavaScript always lists integer keys
  ascending, so the helpers splice the table's text in).
- **The offer** (`offerDoc`, 240 × 40 u): `items` en `{1: "Coins: {0}", 23: "Gems: {0}"}`, de `{1: "Münzen: {0}", 23: <a
  sentence of about 90 characters>}`, its control the same with de 23 `"Edelsteine: {0}"`.
- **The labels** (`labelsDoc`, 600 × 400 u): 30 rows at (10 + 200 ⌊i ÷ 10⌋, 20 + 40 (i mod 10)), each alone in its
  200 × 40 band; `kinds` en Archer, Knight, Wizard, Healer, Thief, Scout, Guard, Smith, Miner, Baker and fr Arbalétrier,
  Chevalier, Sorcier, Guérisseur, Voleur, Éclaireur, Garde, Forgeron, Mineur, Boulanger (every fr name another string).
- **The dialogue** (`dialogueDoc`, 360 × 40 u): 40 text children at the same place, each a speaker and a phrase (`l37`
  "Esme: Follow the river." among them, five speakers by eight phrases); the reference the group with `l37` alone.
- **The budgets** (`heapDoc`, `layerDoc` on an atlas of eight solid 4 × 4 px cells, `fitDoc`: `goods` of 5,000 keys in en,
  fr and de, `stillDoc`: a text, 30 labels from data columns and a group of two rects, and the bare document, one rect),
  and in `ac8-budgets.test.ts` the 3D scenes in #537's session form: `swarm` (100,000 slots of a 0.6 m box from `crowd`,
  640 × 400 px, 420 m across) and `field` (a 256 × 256 m terrain plate at 1 m spacing with one overlay `{grid:
  "fogger.fog", size: [256, 256], roles: ["fog", "dim", "none"], opacity: 1}`), each over 0.5 s.

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s `criterionId`. Each test's name starts with `AC<n> #538.<id>`; each file quotes its
criterion in full. Test count: 2 + 2 + 2 + 1 + 2 + 2 + 2 + 1 + 1 = 15.

| ID | File (tests) | What it asserts, and the wrong programs it fails |
|---|---|---|
| AC1 `#538.798488ed` | `ac1-logic-grid.test.ts` (2) | `determinism` at step 30, both sides: every one of the 480 cells of `board` is its value's glyph in its two roles (the roles' colors `key`'s), 0x1002 '@' in accent on ink, and 7 at (12, 7) a blank cell (no grapheme or a space) in the ground. `eval` at step 29 raises no `grid.out_of_range`; at step 30 one `{array: rules.cells, cell: [12, 7], value: 7, step: 30}`. The glyph list with U+E000 is refused at check with an error naming it; 479 values are refused with an error naming 479 and 480. `grid_wraps_index`: cell (12, 7) draws 'é' and the judge fails naming `cell (12, 7)`. Fails: a role or glyph unpacked from other bits, a wrapped or clamped index, a blank cell in another background, an issue missing or misnamed, a check that takes the private-use glyph or the short array |
| AC2 `#538.04486d9f` | `ac2-plural-copy.test.ts` (2) | `eval` at steps 5, 15 and 25 in en and fr: the caption's pixel hash is that of the caption reading the criterion's six strings. `plural_en_rule_for_fr`: fr at 0 reads "Vous trouvez 0 pièces d'or" and the judge fails naming `locale fr` and `count 0`. Fails: a form by the wrong rule, a placeholder left or misformatted, a locale ignored |
| AC3 `#538.d7b350a3` | `ac3-missing-key.test.ts` (2) | `eval` at step 30 (item 99): the frame draws nothing, and raises `copy.missing {table: loot, key: 99, array: rules.item, step: 30}`; at step 45 (item 17) the caption reads key 17's string with the keys stored 4, 17, 9 and again after a revision sorts them 4, 9, 17. `copy_keeps_first_position`: after the sort it reads key 9's string and the judge fails naming `key 17`. Fails: another key's string or a placeholder for a missing key, no issue, a lookup by position |
| AC4 `#538.5538b44f` | `ac4-fit-check.test.ts` (1) | `deep_show` refuses the offer whose de key 23 doesn't fit, with an error naming 23, de and a width above 200 in its own fields; with de 23 short it is presented; with `args: ["rules.count"]` it is refused, naming `rules.count` or pointing at `…/args/0`. Fails: a fit check over picked keys or one locale only, an argument at its value instead of its widest, a check that refuses every copy |
| AC5 `#538.c737d5fc` | `ac5-labels-locale.test.ts` (2) | `eval` at step 10 in en: each of the 30 bands hashes as the en reference's; at step 10 in fr every band as the fr reference's, the fr frame's `steps` hold no logic step and `revisions` is unchanged; at step 30 in en the 29 other bands as the en reference's, row 17's band draws nothing and exactly one `copy.missing` names `kinds`, 42 and step 30. `labels_keep_first_locale`: every fr band hashes as its en name and the judge's first failure names `row 0 (labels#0)`. Fails: rows looked up by position or by another row's key, a locale switch that steps logic or writes the document, more than one row hidden |
| AC6 `#538.8cc15bf5` | `ac6-flip.test.ts` (2) | `frames` from 0 to step 60: steps 20 to 59 hash as `l37` alone, and step 60 draws nothing; on another session `eval` at step 119 then 45 gives `l37` alone, the played frame 45's hash; `eval` at step 60 raises `flip.unmapped {value: 52, array: story.line, step: 60}`. `flip_holds_last_child`: step 60 still shows child 37 and the judge fails naming `step 60`. Fails: two children shown, the last child held, an issue missing, a seek that differs from play |
| AC7 `#538.4b946374` | `ac7-without-logic.test.ts` (2) | In the build without logic: `registry` lists data, scene3d, cells, text and marks2d and not logic; the grid, the caption, the labels and the dialogue are each refused with an error `module_missing` naming logic and the reader (`ids` or `path`), and each check's `result` is BLOCKED. `test-data-reads-logic-array` (declared by deep-show, built with `test-leave-out-logic`): startup is the seal's refusal naming `data` and a `logic.` array. Fails: a reader that needs the logic module to seal or to be refused, a check that passes, a seal that takes a direct read |
| AC8 `#538.ed6f8052` | `ac8-budgets.test.ts` (1, timed) | No frame after the first of the still document runs more operators than the bare one's (`ran`); on the debug build `compares` (1,048,576 bytes a step), `remaps[].ms` (one row a step, 9,216 on frame 0 and on five seeks back), `upload_ms` (`swarm` with 1,000 element uploads a frame; `field`) and `timing.copy_fit_ms` answer; budgets.json holds `canvas-game-state` (below) and `lanes.mjs` times this file; then, on a reference Mac at rest only, release builds, a warm-up run and five, each number's median judged by `judgeLimit` against compare 0.2 ms, a row 20 µs, the layer 1 ms, the slots 0.5 ms, the overlay 0.1 ms and the fit check 2,000 ms. Catches: the base (no fields, no task); a document that pays per frame; a regression past the issue's numbers |
| AC9 `#538.304491be` | `ac9-taste.test.ts` (1) | The check run (below) writes the four pictures and prints their SHA-256s, then reads `TASTE.json`: none, or a call on other pictures, fails `INCONCLUSIVE:`; `looks_wrong` fails; `looks_right` on exactly these pictures passes. It judges no picture |

## The budgets

"Compared with the merge base" is the perf lane's and the budget window's: they run `benchmarks/budgets.json`'s task and
compare its p50 with the merge base at the task's margin. The test holds the record and judges the issue's own numbers.
The implementer adds:

1. **`benchmarks/budgets.json` gains the task `canvas-game-state`**: `{"id": "canvas-game-state", "command": ["node",
   "benchmarks/canvas.mjs", "game-state"], "margin": 0.5, "limits": {}, "targets": {"compare_ms": 0.2, "remap_row_us":
   20, "remap_layer_ms": 1, "upload_slots_ms": 0.5, "overlay_upload_ms": 0.1, "fit_check_ms": 2000, "idle_steps": 0},
   "initialReason": "<why, naming #538>", "criteria": ["#538.ed6f8052"]}`, which the lane's `validateBudgets` accepts.
2. **`benchmarks/canvas.mjs game-state`**, a mode measuring this suite's budget fixtures on release builds, and its
   targets in `canvas.mjs judge`, as the other canvas tasks do; what the mode prints is the implementer's.
3. The timing fields above (`compares`, `remaps[].ms`, `upload_ms`, `timing.copy_fit_ms`).

The test's readings, per run: `compare_ms` the median `compares[].ms` of `heap`'s frames 5 to 19; `remap_row_us` 1,000
× the median one-row `remaps[].ms` of `layer`'s frames 5 to 39; `remap_layer_ms` the median of the six full remaps (frame
0, a new reader, and five seeks back to frames 30, 25, 20, 15 and 10); `upload_slots_ms` and `overlay_upload_ms` the
median `upload_ms` of `swarm`'s and `field`'s frames 5 to 29; `fit_check_ms` `goods`' `timing.copy_fit_ms`. `idle_steps`
is the counter, read on every machine: 0 operators a frame past the bare document's.

## The taste call

`ac9-taste.test.ts` is the check run. It draws the criteria's own fixtures through `deep-show run` and takes each
picture from the canvas's canonical render of the hub session's frame (`eval`'s snapshot, a PNG the canvas stored in
the evidence store), re-encoded so the same pixels always give the same bytes, into `docs/evidence/538/`:

- `cell-grid.png`: the 40 × 12 grid at step 30 (the grid alone, without `key`);
- `copy-en.png` and `copy-de.png`: the caption at step 5 (count 12) in en and in de, over key 17 in en, fr and de;
- `dialogue-flip.png`: the dialogue at step 45 (story.line 37).

Each SHA-256 is printed. `tests/acceptance/538/TASTE.json`, written by whoever records the call after the pictures are
attached to the PR and shown in the session: `{"issue": 538, "criterion": "#538.304491be", "verdict": "looks_right" |
"looks_wrong", "who", "when": ISO 8601, "screenshots": {<each of the four names>: sha256}, "note"?}`. A call stands while
this run's four hashes equal the ones it names. No agent records a call it wasn't given; this job wrote none.

## Readings where the issue leaves a choice

- **The surfaces** (above). What a cell draws is the `cells` block `determinism` already gives (#1967); what a text shows
  is a pixel hash against the same item with that string written out; issues are `eval`'s.
- **"In the accent role on the ink role"**: the colors the cells module draws for those roles, read from `key`'s cells,
  not from the look file. **"The grid's background"**: its palette's `bg`. **"A blank cell"**: no grapheme, or a space.
- **"Naming the array, the cell, 7 and the step"**, and the other frame issues: the issue's own fields as the Fields name
  them; the array may be written with its index (`story.line[0]`). **"Refused at check, naming it"**: an error issue whose
  own fields (not `what` or `fix`) hold it: U+E000 as the character or as `U+E000`; "both counts" 479 and 480.
- **"Shows S"** (criteria 2, 3, 5, 6): the frame's pixel hash equals the reference's. **"Shows the missing string
  (empty)"** and **"shows no child"**: the frame (or the row's band) draws nothing, every pixel the ground's.
- **"Stored in the order 4, 17, 9 and then sorted"**: two revisions of one document on one live session, the table's keys
  in each order in the JSON line sent.
- **"Fails the fit check at check, naming key 23, the locale de and the width"**: an error at check whose own fields name
  23 and de and hold the width the string shapes to, a number above 200 (u).
- **"A number argument with neither a widest nor a range its source declares"**: `args: ["rules.count"]`; a logic array
  declares no range. "Naming it": `rules.count` in the error's fields or its path at the argument.
- **"Switching the view's locale"**: `eval`'s `view: {locale: "fr"}` on the live session. **"No logic step"**: that frame's
  `steps` hold no entry of the logic module. **"No change to the document's hash"**: `revisions` before and after equal.
  **"For that row alone"**: exactly one `copy.missing` in the frame, its key 42.
- **"Naming the first row"**: the judge lists rows in order, and its first failure names `row 0 (labels#0)`.
- **"Seeked to from the end"**: on a fresh session, `eval` at step 119 (the last frame of the 2 s the steps run in, within
  the 4 s span) then at step 45.
- **"The checks that need it are BLOCKED"**: `deep_show` with `check: true` answers `result: "BLOCKED"`. **"Refused with
  module_missing naming logic"** for a reader: an error `module_missing` naming logic whose `ids` or `path` name the reader,
  so the logic item's own refusal doesn't stand in for the reader's.
- **"Naming the read"** (the planted data module): a `logic.`-prefixed array in the refusal's `arrays` or `what`, and
  `data` in its `modules`.
- **The budgets' sizes**: 1 MiB is 262,144 i32; the layer 96 × 96; the instancer 100,000 slots with 1,000 moving a step;
  the overlay 256 × 256 cells changing every step; the table 5,000 keys × en, fr, de. **"No work per frame"**: by the
  scheduler's `ran` against the bare document's, not time; a cell grid isn't in the still document, since the cells
  module's operator reads `t` at the base and so runs every frame for any grid.

## Not tested, because no criterion reaches it here

`deep_kinds` listing the new forms; templates holding `{copy: …}`; nested lookups; up to four arguments; the attribute
bits 20 to 27; the status distance on a logic grid; `copy.args`, `copy.literal`, `copy.pseudo`, `copy.locale_fallback`
and translation staleness; flips from occurrence lists; changed-row uploads of a logic grid; hex grids, transition tiles
and the board painter (other issues). They are follow-ups for the implementer's own tests.

## What the implementer adds outside this folder

- The lanes lines above.
- In `deep-show`: the new `eval` issues; `frames`' `timings` (`compares`, `remaps[].ms`); `deep_show`'s
  `timing.copy_fit_ms`; the five `planted` names; the cargo feature `test-data-reads-logic-array` (built with
  `test-leave-out-logic`), declared in `crates/deep-show/Cargo.toml`.
- In `deep-gpu`'s `view3d`: `upload_ms` with `timings`.
- `benchmarks/budgets.json`'s `canvas-game-state` and `benchmarks/canvas.mjs`'s `game-state` mode and judge.

`BASE-FAILURE.txt` is the run at the base.
