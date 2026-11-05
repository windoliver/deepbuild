# Acceptance tests for #412: deep_kinds, one listing for every registry, slot and interface, the guides and gallery, and the rules every tool keeps

Written first, from issue #412 ("deep_kinds: one listing for every registry, slot and interface, the guides and
gallery, and the rules every tool keeps": its Scope, its eighteen acceptance criteria and its Proof line), the design
sections it links, and base commit `960045da` ("Merge pull request #1027 … claude/issue-875-on-main"), by a job that
never saw an implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a
dispute goes to a blind redraft of this job (design: Dogfooding).

## What was read

- The issue, read live with `gh issue view 412`, and its oracle page (`doneright/oracles/issues/412.md` in
  `DeepBuildAI/deepbuild`, branch `doneright`): no upstream test checks any of the eighteen criteria.
- `docs/technical-design.md`: the MCP tools row of "Five ways in, all onto the same core" (the `deep_kinds`
  paragraph: kinds, recipes, packs, presets and check kinds with compact schemas, the canvas modules with versions
  and the module-set digest, other tools' words with their conversions, piece recipes first, the guides and the
  gallery "searched, shown and read in pages that say when they're cut and where the next one starts; each example
  is pinned by its hash, read and never run, and one whose bytes don't match is never served", every registry and
  its entries in one shape, hub slots beside them; "Each tool's description says what its result does not prove.
  Errors share one shape"; "its published schemas are tested against the strict validators of the model APIs agents
  use"); the paragraph after Building blocks (the skill and the tool descriptions generated from the table, a test
  failing when they drift, the canvas working order, `deep_open_item` for a missing kind or field); "Piece recipes
  first"; Composition's hub-slot paragraph; the Agent tools for scenes row ("No tool runs an agent's code outside the
  sandbox (`sandbox@1`), drives a live editor or app, or answers, decides or overrules").
- `docs/canvas-primitives.md`: Conventions (Literals: "`deep_kinds` lists those forms for every field, printed by the
  grammar's printer"); Item and kind (`unknown_kind`, `module_missing`, `kind_too_new`); Canvas module; Canvas
  module: interface and implementation; Registry and seal: registries; Registries and closed lists (the hub-slot
  row, the Cue verbs row); Pack: math@1 (`aliases: {word → {target, renamed_from}}`, "deep_kinds answers a word from
  it", "Conversions, stated", `no_match`); Pack: kinds in any pack (retired packs); Channel and key (`spring
  {freq_hz, damping_ratio}`, spring peaks in closed form); Cue list `cues@1` and `cue.kind@1`; Logic: work across
  steps (step ceilings `deep_kinds` publishes).
- At the base: `packages/hub/src/tools.ts`, `packages/hub/tools.json`, `packages/hub/src/mcp.ts` (`deep mcp`
  answers tools/list with no hub), `scripts/skill.mjs` (exports `generate()`), `skills/deepbuild/SKILL.md`,
  `packages/contracts` (`error@2`, `registry()`, `validate()`, `canonicalize()`), `crates/deep-show` (`deep-show run`
  and `canvas`, `start_args` and `--planted`, the `seal_refused` line, `registry`, `registries`, `schedule`,
  `install_pack`, `deep_query`, `deep_show` with `mode`, the `test-*` features, `src/registries.rs`),
  `crates/deep-canvas` (the document check's `unknown_kind` notice and `unknown_field` issue, `kinds.rs`'s params with
  units, the `deep-canvas parse unit|time` command, the time grammar's whole-flick rule), `crates/deep-canvas-motion`
  (`spring_from_rest`, the spring segment), `crates/deep-canvas-test-modules`, `packages/contracts/hub-slots.json`,
  `benchmarks/budgets.json`; the suites `200` (closest: listing shape, test features, planted names, budgets gating,
  layout), `185` (deep://schedule's `interfaces`), `411` (deep_query, deep_show modes and readings), `26` (the tool
  list, `strictProblems`, the skill's drift check), `393`, `387`, `854`.

## What the base already does, which these tests don't credit

`deep-show run` already lists every registry and hub slot at `deep://registries` (`registries`, #200), with
`test.mark@1`, `dot`, pack entries such as `testpack.ring`, and the plants `registries_without_slots` and
`slot_fill_as_entry`; `schedule` names each interface with its digest and chosen implementation (#185); `deep_query`
and `deep_show`'s modes and their `drawn` readings exist (#411); the document check flags an unknown kind (a notice,
the item skipped) and an unknown field (an error), with no close names; `deep-canvas parse` parses and prints unit
and time literals; `deep mcp` lists twelve tools with strict schemas whose descriptions say what they don't prove,
and `scripts/skill.mjs` generates the skill and the descriptions. There is no `deep_kinds` call or tool, no word
answer, no search or reading of guides or a gallery, no sheet, no dump or diff, no close names or rename records, no
move listing, no entry stability or availability in a listing, none of this suite's test features or plants, and
no cursor on a deep_query or readings reply past 64 KB.

## Run them

```sh
npm ci && npm run build --workspaces     # once: deep mcp and @deepbuild/contracts run from dist
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/412 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/412/tsconfig.json
```

Node 24 (the repo's engines). Each file builds every feature set it lists once (`cargo build --locked --bin
deep-show --no-default-features --features <set>[,<test feature>…]`, honoring `CARGO_TARGET_DIR`, with
`CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` unless set), copies the binary out under its own name, and
fails each test that uses a build that failed; `listing.test.ts` also builds `deep-canvas` (`cargo build --locked -p
deep-canvas --bin deep-canvas`). `budgets.test.ts` builds the merge base (`git merge-base HEAD origin/main`, exported
with `git archive` into `target/acceptance-412-base/<sha>/` and built there with its own target folder, kept so later
runs build warm) only after its structural checks pass on a fit reference Mac, and stops every `deep-show run` it
kept open by its own PID. `tools.test.ts` starts `deep mcp` (`node packages/cli/dist/main.js mcp`) with a scratch
`HOME`, reads its tools/list and lets it exit. Every temporary folder is deleted. Node built-ins and vitest only,
plus the repo's own built `@deepbuild/contracts` (error@2, `registry()`, `canonicalize()`), `deep mcp` and
`scripts/skill.mjs` (run in a child to read `generate()`).

`scripts/lanes.mjs` needs `'tests/acceptance/412/'` added to its `alone` list (the files build cargo binaries and
`budgets.test.ts` times them), which also takes the folder off the parallel line; this README is the instruction,
and the implementer makes that edit.

Every test passes an explicit timeout as the last argument of `it` (`1_800_000` ms; `7_200_000` for the two budget
tests that build the merge base in their body), as #200's suite does: each starts freshly built binaries, whose
first exec on macOS alone can take seconds.

Gates: `budgets.test.ts`'s timings run only on a reference Mac (Mac15,7 or Mac15,12, Low Power Mode off, thermal
state nominal, a 1-minute load at most the core count; mains power never gates); elsewhere they skip as
INCONCLUSIVE after their structural checks, and a reading between the limit and the margin also skips as
INCONCLUSIVE; none passes by skipping. `BASE-FAILURE.txt` is the run at the base.

The Proof line ("Claude Code and Codex each building a scene with the tools alone, with the tool calls, replies and
the checks that ran") is a live check with real agents, outside this suite; no vitest test stands in for it.

## The surface under test

`deep-show run` as #393, #200, #185 and #411 left it: JSON lines in, one answer per scenario line (a scenario line
after the first is answered in the same process, which `budgets.test.ts` uses to time calls); the scenario
(`evidence`, `sessions`, `processes`, `panels`, `docs`, `packs`, `installed`); `deep_show`, `deep_query`,
`schedule`, `registry`; the startup `--planted <name>` argument; the `seal_refused` line with exit 2; build sets
`core` and `full`; test canvas modules behind `test-*` features. Plus `deep mcp`'s tools/list (#26), `scripts/skill.mjs`
and `deep-canvas parse` unchanged in their interfaces. **Every name below that the issue doesn't give is this job's
invention**, the smallest surface consistent with the design and the base; the implementer builds exactly these, or
a dispute goes to a blind redraft. The same calls work on `deep-show canvas` (#806), where the hub sends the
`deep_kinds` MCP tool's arguments, as it sends deep_show's.

### `deep_kinds`: a call of `deep-show run` and the MCP tool `deep mcp` lists

`{"call": "deep_kinds", "op": <op>, …}`. The MCP tool `deep_kinds` takes the same fields (its schema is the
implementer's, in the strict subset); the tests read the tool only through tools/list. Ops (invented):

| `op` | Fields | Answer |
|---|---|---|
| `list` | `registry`?: name@major (that registry or slot alone), `cursor`?: string | `{"core_version", "module_set": d1 digest, "modules": [{"name", "version": semver}], "interfaces": [{"name": name@major, "digest", "implementation", "module"}], "registries": [Listed], "next"?: cursor}` |
| `word` | `word` | `{"word", "target": name@major, "conversion": string, "pack": "<owner>/<name>@<version>"}`, or `{"word", "code": "no_match"}` |
| `search` | `query`, `cursor`? | `{"hits": [{"kind": "example" \| "guide" \| "entry", "name", "title", "hash"?}], "next"?}`, best first; no hit: `{"hits": [], "code": "no_match"}` |
| `read` | `example`: sha256, or `guide`: name with `offset`? (bytes, default 0) | example: `{"example", "title"?, "text": its stored bytes as UTF-8}`; guide: `{"guide", "offset", "text", "truncated": bool, "next"?: offset}` |
| `gallery` | `cursor`? | `{"examples": [{"hash", "title", "steps": declared, "status": "verified" \| "unverified" \| "not_run", "played"?: n}], "next"?}` |
| `sheet` | none | `{"module_set", "text": the sheet, "bytes"?}` |

`Listed` is `deep://registries`' row (#200: a registry's `owner`, `fill`, `since`, `digest`, `kit`, `planted`, …;
a slot's `kind: "slot"`, `interface`, `digest`, `how_many`, `planted`, `fills: [{name, kit}]`), its `entries` in
**the one shape**:

```json
Entry = {"name", "registry", "origin": "first_party" | "pack" | "plugin" | "agent", "pack"?, "binds",
  "schema": JSON Schema (of the entry's value; a kind's params) | null, "example": sha256 | null, "since",
  "deprecated_since"?, "replaced_by"?, "digest", "kit": {"verdict": "PASS" | "FAIL", "rules"}, "cost",
  "stability": "stable" | "preview" | "retired", "tracking"?: issue (a preview entry's), "available": bool,
  "code"?: "module_missing" | …, "description"?: one line,
  "fields"?: [{"name", "type", "unit": string | null, "range", "list": bool, "default"?, "grammar"?: "unit" | "time", "forms"?: [string]}],
  "moves"?: [Move]}
Move = {"path": under the target, such as "at/scale", "from", "to", "start": s, "span": s,
  "ease": {"spring": {"frequency": Hz, "damping_ratio", "decay": 1/s, "peak": {"at": s from start, "value"}}}}
```

- **Pages and cursors**: `list`, `search` and `gallery` cut a reply at 64 KB (65,536 bytes of its JSON) and give
  `next`, which the next call passes as `cursor`; a registry cut across pages continues on the next with its
  remaining entries. `read` of a guide pages it by bytes of its UTF-8 text; each page but the last says
  `truncated: true` and `next` = offset + the page's bytes.
- **Refusals** are `{"error": error@2}` (the shared shape, `packages/contracts/schemas/error@2.json`), at the path of
  the refused value: an unknown `op` at `…/op`, an unlisted field at its path, a missing field at its path; an
  example nothing holds, or whose stored bytes don't hash to its hash, names the hash in `actual` and serves no
  `text`. The hub returns the error as the tool's error.
- **A field that takes a literal** (a number with a unit) lists `grammar` and `forms`, each form as `deep-canvas
  parse <grammar>` prints it, parsing to the field's unit.
- **Example**: a whole document by its hash; a kind's example holds at least one item of that kind, its params
  valid against the entry's `schema` (which is in the contracts' closed node list).
- **Availability**: `available: false` for an entry whose kit result on this core isn't PASS (or whose module is
  missing, or retired).
- **Moves**: printed from the entry's expansion at check at its defaults, never stored; `decay` = 2π · frequency ·
  damping ratio; the expansion's channel follows `spring_from_rest` (#motion) from `from` to `to`, and holds `to` at
  start + span.

### Scenario fields (new)

- `plugin_entries: [{"plugin", "registry", "entry": {"name", …}, "kit": KitResult}]`: entries plug-ins fill, with
  the kit result the hub recorded for each on this core (as #200's `installed` gives slot fills theirs). Listed with
  origin `plugin`.
- `gallery`: a folder used in place of the installed gallery and guides (**The gallery folder**, below).
- `corpus_runs: [{"example": sha256, "module_set": d1 digest, "played": steps, "exit": status}]`: the corpus
  runner's recorded runs, last one last.

### The gallery folder

`<dir>/gallery.json` = `{"examples": [{"file", "hash": sha256 of the file's bytes, "title", "steps": declared,
"words": [string]}], "guides": [{"file", "name", "title"}]}`, each file beside it. The tests write one with three
small board examples (Six hundred steps: 600 steps; Never run here: 120; Played out: 120) and an ASCII guide of about
80 KB, `long-guide`. The **installed** gallery (no `gallery` field) must hold a product reveal example (its title
holding "product reveal") that a search for "turntable" finds first.

### `deep-show kinds` (what `deep kinds` runs)

- `deep-show kinds --dump <dir>` writes the whole sealed listing as canonical JSON (RFC 8785, as
  `@deepbuild/contracts`' `canonicalize` writes it) to `<dir>/<module-set digest's 64 hex>.json` and prints one line
  `{"ok": true, "path", "module_set"}`. Its JSON Schema is `packages/contracts/canvas-schemas/kinds.dump@1.json`, in
  the contracts' closed node list; each entry's `fields` is an ordered array of `{name, type, unit, range, list,
  default?}`.
- `deep-show kinds --diff <a.json> <b.json>` prints `{"ok": true, "changes": [{"entry", "field"?, "change": "added"
  | "removed" | "renamed" | "retired" | "default" | "unit" | "range", "to"?, "from"?, "renamed_in"?}]}`, a rename
  as `{field: old, change: "renamed", to: new}`, a default as `{field, change: "default", from, to}`; renames and
  retirements come only from the registries' migration and deprecation records.
- Both take `--planted <name>`. The CLI's `deep kinds` forwarding to it is the implementer's; this suite runs
  `deep-show kinds`.

### Close names on the document check

An `unknown_kind` issue or notice, and an `unknown_field` issue, carry `close: [{"name", "renamed_in"?, "conversion"?,
"example"?}]`, at most three; a name a rename or retirement record gives comes first, with `renamed_in`.

### Test canvas modules and features of `deep-show` (none in a shipped build)

| Feature | What the build holds |
|---|---|
| `test-sim-b`, `test-mark` | #185's and #200's, unchanged |
| `test-preview` | module `test.preview` 1.0.0, kind `test.preview.blob@1 {box}` drawn as a rect, `stability: preview`, `tracking: "#412"` |
| `test-cue` | module `test.cue` 1.0.0, declaring registry `test.cue.kind@1` with the entry `pop_in` over `{targets, span = 0.5 s}`: the targets' `at/scale` from 0 to 1 over its span on a spring of 4 Hz and damping ratio 0.3; and the kind `test.cue.list@1 {cues: [{id, kind, targets, span?}]}`, which plays its cues in order from 0 s, expanding each at check |
| `test-cue-span` | the same, `pop_in`'s default span 0.8 s, nothing else changed |
| `test-ring-a` | module `test.ring` 1.0.0, kind `ring@1 {center, r, thick = 1, dash = [], segments = 32}` (fixture digest A) |
| `test-ring-b` | module `test.ring` 1.0.0, kind `ring@2 {center, r, stroke_width = 1, segments = 64}` with the migration record from ring@1 renaming thick to stroke_width and retiring dash (fixture digest B) |
| `test-sheet-wordy` | module `test.wordy`, kind `test.wordy.long@1` whose one-line description is 33,000 bytes: the seal refuses the build (`seal_refused`), `entries` naming the kind and `overrun_bytes` the bytes past 32,768, its `what` holding the number |

### Planted startup arguments (`--planted <name>`)

`kinds_names_reference` (the listing names each interface's reference implementation); `listing_without_pack_entries`;
`registries_without_slots` and `slot_fill_as_entry` (#200's, also on deep_kinds' listing); `validator_without_close`
(no close names); `close_by_spelling` (close names ranked by spelling alone, no rename record read);
`form_refused_by_grammar` (adds `1/2m` to every unit field's forms); `listing_without_stability`;
`moves_stored_text` (each entry's moves are the text stored for `test-cue`'s defaults, not its expansion);
`sheet_without_pack_entries`; `dump_fields_by_name` (`--dump` writes each entry's fields as an object keyed by
name); `diff_by_spelling` (`--diff` pairs fields by spelling: thick removed, stroke_width added); `verified_by_exit`
(an example whose last run exited 0 is verified).

### Fixtures

`fixtures/packs/testpack-1.0.0` (#200's, copied); `fixtures/packs/words-1.0.0`, a tool-word pack whose `aliases`
(the design's field) map `Circle` → circle@1 and `Rectangle` → rect@1, each with a `conversion` (invented: the
stated conversion, as text, per word); `fixtures/kinds-catalog-include-exclude.json`, the include fixture the
criterion names as `parity/agent/kinds-catalog-include-exclude.view`: cases pairing a word, a query or a registry
with names that must and must not appear, no_match cases included.

### Strict schemas, the tool list and the skill

- **Strict** is #26's `strictProblems` (copied): the root an object; every object with listed properties, all
  required (an optional one nullable), `additionalProperties: false`; an array with one item schema; strings with
  an optional enum, pattern or listed format; no `anyOf`, `$ref`, map, length, range or other keyword. That is the
  intersection of Anthropic's strict tool use and OpenAI's strict function calling, as #26 reads them.
- **New tools** are the tools `deep mcp` lists that the merge base's `packages/hub/tools.json` doesn't describe;
  deep_kinds must be among them. deep_query's refusals were fixed by #411's suite and deep_job is another task, so
  only deep_kinds' refusals are read here.
- **The tool list's rules** (AC3): none of deep_validate, deep_cost, deep_render, deep_bake; no second search tool;
  no tool named for answering, deciding or overruling, for running code (exec, eval, script, shell, wasm, validate,
  render, bake, cost; deep_run, which runs the spec's checks, aside), or for a live editor or the app (editor,
  unreal, blender, godot, unity, maya, houdini, app, live); no input field that would carry an answer or code.
- **The skill** is `skills/deepbuild/SKILL.md`, equal to `scripts/skill.mjs`'s `generate()`; in its body, in order:
  "piece recipe", "check … before … render", "render … small", "patch", "render … in full"; "deep_kinds"; one
  sentence naming deep_open_item with a kind, a field and "missing" (or "doesn't exist"). It names no input property
  of any listed tool (in a code span, in double quotes, or before `:` or `=`), and every `name@major` in it is an
  entry, registry, slot or interface the `full` build's deep_kinds lists.

## Criteria to tests

| Criterion | Tests |
|---|---|
| AC1 | `names.test.ts` (2): Circle and Rectangle answer their target, conversion and pack; Circel, Rect, Spline answer no_match with no target |
| AC2 | `tools.test.ts` (3): every new tool, deep_kinds among them, says what it doesn't prove; every schema strict (the check refuses six planted patterns); four deep_kinds refusals are error@2 at their paths |
| AC3 | `tools.test.ts` (2): the tool list with deep_kinds breaks no rule; the check fails lists with deep_render, deep_kinds taking `code`, deep_unreal_editor, deep_answer, naming each |
| AC4 | `gallery.test.ts` (2): every example in `full` read by its hash, its kind's items valid against the schema (circle@1, rect@1 among them); the include fixture's words and queries pass, no_match included, and the check fails a made-up mapping |
| AC5 | `gallery.test.ts` (3): turntable → the product reveal first with its hash; the long guide in pages with truncated and next, to the rest; a changed example refused with error@2 naming its hash, its neighbour served |
| AC6 | `tools.test.ts` (2): the skill is generated, states the working order and deep_open_item, names no parameter or unlisted kind; the check fails a skill naming a deep_kinds parameter, and circel@1, naming each |
| AC7 | `listing.test.ts` (2): test.sim@1 with its digest and test.sim.b as deep://schedule, beside the modules and module-set digest; `kinds_names_reference` names test.sim.a and fails naming test.sim@1 |
| AC8 | `listing.test.ts` (3): test.mark@1 with since, digest, fill, dot and testpack.ring in the one shape with kit results, include fixture passes; `listing_without_pack_entries` fails naming testpack.ring; plug.square with kit FAIL listed unavailable |
| AC9 | `listing.test.ts` (3): check.kind@1 as a slot beside test.mark@1 with command and journey and their kit results; `registries_without_slots` and `slot_fill_as_entry` fail naming check.kind@1 |
| AC10 | `budgets.test.ts` (3): deep_kinds p95 under 100 ms, its replies under 64 KB or with a cursor; deep_query of 200 rows under 50 ms (the merge base's reading beside it), its 5,000-row reply under 64 KB or with a cursor; readings add under 20 ms to the merge base's render-back, their 5,000-item reply under 64 KB or with a cursor |
| AC11 | `names.test.ts` (3): circel@1 → unknown_kind naming circle@1 among ≤ 3; centre → refused, unknown_field naming center; `validator_without_close` fails both, naming circel@1 and centre |
| AC12 | `listing.test.ts` (2): every unit field lists forms the grammar parses to its unit and prints back; `form_refused_by_grammar` fails naming the field and 1/2m |
| AC13 | `listing.test.ts` (2): every entry's stability; test.preview.blob@1 preview, tracked by #412, its example naming it in requires.preview; `listing_without_stability` fails naming it |
| AC14 | `redraft/moves-redraft.test.ts` (3, the blind redraft that replaced `moves.test.ts`, owner approved; see `redraft/REDRAFT.md`): pop_in's scale 0 → 1 over 0.5 s with its spring's frequency, damping, decay and peak equal to the expansion within 1e-9, sampled at times the time grammar accepts; span 0.8 s changes only the span; `moves_stored_text` fails naming pop_in and span |
| AC15 | `sheet.test.ts` (3): the full build's sheet ≤ 32,768 bytes naming every available entry, byte-identical twice; testpack.ring named, `sheet_without_pack_entries` fails naming it; `test-sheet-wordy` refused naming the entry and its overrun |
| AC16 | `dump.test.ts` (4): two dumps byte-identical, canonical, schema-valid, fields as arrays; the diff A → B is exactly the 3 changes; `dump_fields_by_name` fails the schema at …/fields; `diff_by_spelling` reports thick removed, stroke_width added, and fails naming thick |
| AC17 | `names.test.ts` (2): ring@2 {thick: 3} refused, first close name stroke_width with renamed_in ring@2; `close_by_spelling` fails naming thick |
| AC18 | `gallery.test.ts` (2): 0 of 600 → unverified with 0 of 600, another digest → not_run, 120 of 120 → verified; `verified_by_exit` lists it verified and fails naming Six hundred steps |

Each test's name starts with its criterion. Where a criterion names a wrong program, the test runs it (a planted
startup argument or a planted test feature) and asserts the criterion's check fails, its failure naming what the
criterion says.

## Readings where the issue leaves a choice

- **"Refused with unknown_kind"** (AC11): the base flags an unknown kind as a notice and skips the item (Item and
  kind); an `unknown_kind` issue or notice on the item, with its close names, is read as the refusal of the item.
  The `centre` board must be refused (an `unknown_field` error).
- **"An entry whose kit failed on this core"** (AC8) is a plug-in's entry whose kit result the hub recorded as FAIL
  on this core (`plugin_entries`); packs' entries are checked at install, which refuses a failing one.
- **"Fails the include fixture"** (AC8, AC15) is this suite's include check (`includeFailures`, `sheetIncludeFailures`)
  run on the planted answer.
- **"Two builds of one module-set digest"** (AC15) are two sealed processes of one build, each generating the
  sheet; **"fails the build"** is the seal's refusal at startup.
- **"Fixture digests A and B"** (AC16) are the module sets of `core,test-ring-a` and `core,test-ring-b`; the diff
  pairs ring@1's fields with ring@2's through ring@2's migration record, so the major change itself is not a fourth
  change.
- **"Each number equal to its expansion's"** (AC14) is read through the expansion's own values (deep_query at the
  move's start, end, listed peak and seven times between, on the time grammar's whole-flick grid), against the
  closed-form spring the listing's numbers give; a cue's moves start at the cue's start, 0 s in the test board.
- **Budgets "compared with the merge base"** (AC10): the readings budget is an increment, judged against the merge
  base's plain render-back (a render-back is deep_show of a whole revision with `include: ["pixels"]`, #393; the
  readings are #411's bounds mode's `drawn`, so both sides draw the same 200-item board); deep_kinds has no base, and deep_query's base reading is printed beside the candidate's
  absolute judgment. Each timing is a scenario's wall time less the median of its twin without the timed call, in a
  `deep-show run` kept open. "Without a cursor" is read to the letter: a reply over 65,536 bytes fails unless it
  carries `next`.
- **"Every new tool"** (AC2) is every tool beyond the merge base's list; the errors read are deep_kinds'.

## Not tested, because no criterion asks

The MCP resources (kinds, packs, familiar-names tables, the check catalog, budgets, the op table, fixtures, document
outlines) as resources; `module_missing` on kinds of absent modules; piece and game recipes first on the sheet;
retired packs; step ceilings and logic threads; the hub's forwarding of deep_kinds to `deep-show canvas`; the CLI's
`deep kinds`; the Proof line's live agent runs.
