# Acceptance tests for #306: pack format and recipe expansion, and a missing pack's refusal

Written first, from issue #306 ("Pack format and recipe expansion: packs any author ships, recipes expanded at
check, and a missing pack's refusal": its scope, its Recipe and Pack field lists, its eight acceptance criteria
and its proof line), the design sections it names and those they lean on, and base commit `a8e5480` ("Merge
pull request #767 … feat/63-read-by-reference"), by a job that never saw an implementation; none existed. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.
The issue's Oracle page (`doneright/oracles/issues/306.md` in `DeepBuildAI/deepbuild`, branch `doneright`) says
no engine's or project's own test checks these criteria, so these tests are their local proof.

What was read:

- `docs/canvas-primitives.md`: Recipe (3227: the header, `inputs` with `min`/`max`, `steps` with `op`, `kind`,
  `params: {k → literal | expression}`, `at`, `repeat: {count, as}`; "Expanded at check time, never per frame,
  into derived items `<instance>.<step>[.<index>]`, keyed by hash(recipe@version, inputs) and shared, so equal
  expansions draw instanced … seeds come from (instance, step, index) … patches change an instance's inputs,
  never its derived items"; break_out: "it becomes the writer's own item with the same ID and the values it was
  expanded with, the instance in the writer's layer adds it to `broken_out`, which joins the instance's key, and
  stops writing it, and a later change of inputs re-expands everything else … undoing the break-out hands it
  back as expanded"); Pack (3265: `name` "the name half of its package envelope's `owner/name` ID … a document
  names at most one pack of a name, and check refuses a second, naming both IDs", `version`, `license`,
  `description`, `requires: {core, modules}`, `recipes: {kind → file | sha256}`; "checked once per version, and
  a published version never changes"; cost "Checked once per version … recipes expand at check, never per
  frame"); Pack: retired and missing (3381: notice `pack_missing {pack, version, ids}`, "Nothing draws an
  instance with another version"; R2 lands "a document that names a missing version refused whole"); Canvas
  module (990: "A build without it refuses documents that need it with `module_missing`, and a check that needs
  it is BLOCKED"); Registry and seal (1034: build sets, `r2` adds scene3d; `r1` doesn't); Document envelope
  (291: `packs: [name@version]`; cost "Full check O(items + refs + fields), at most 50 ms per 10,000 items …
  nothing per frame while still"); Item and kind (321: "outside min and max is an error"; `module_missing`);
  ID and sub-address (393: derived IDs; "A recipe instance owns every ID under it … patches can't target
  them"; a recipe step's seed "of (instance seed, step, index)"); Writer layer (428) and Patch (451: `break_out
  {instance, item}`, the closed refusal codes `derived_item`, `out_of_range`, `module_missing`, `pack_missing`;
  "It can never … target a derived item"); What holds a document to its rules (8165: issues as data).
- `docs/technical-design.md`: Composition (802: "Packs compose the same way … since a document names each pack
  version, a new version reopens nothing until a patch names it"); Dogfooding, Tests written first (2549).
- At the base: AGENTS.md; `crates/deep-show` (`deep-show run`: scenarios as JSON lines, `bad_input` for an
  unknown `planted` value or call, the Cargo features `core`, `r1`, `r2`, `full` and the test features; the
  `deep_show` and `deep show` calls with `document`, `patch`, `undo`, `check: true`, `include` with `issues`,
  `pixels` and `timing`; `read`, `revisions`, `registry`, `packs` absent); the earlier blind suites
  `tests/acceptance/371/` (the convention followed here), `305/` (build sets, `module_missing`, BLOCKED checks,
  the reference-Mac gate and judge), `96/` (patches, undo and `read` by writer) and `378/` (instanced batches as
  a reply's `encoded` rows). The base has no pack, no recipe, no expansion, no `break_out`, no `packs` scenario
  field, no `install_pack` or `packs` call, no `expansions`, `batches` or `timing` reply field and none of this
  suite's planted values, so these tests define the surface below.

## Run them

Like #371's suite they build `deep-show` per Cargo feature set, so they run with `--no-file-parallelism`
(`scripts/lanes.mjs` needs `tests/acceptance/306/**` added to the unit lane's `--exclude` list and
`tests/acceptance/306/` to its one-at-a-time line, as those suites' READMEs say for theirs; this job edits
nothing outside this folder):

```sh
npm ci                          # once, if node_modules is missing
npx vitest run --root tests/acceptance/306 --no-file-parallelism
npx tsc -p tests/acceptance/306/tsconfig.json   # type-check: the root's strict options, allowImportingTsExtensions, noEmit
```

Each file first runs `cargo build --locked --bin deep-show --no-default-features --features <set>` for each
build set it lists (`r1`, the build without scene3d; `full`, the one with it; no test canvas module: every pack
this suite needs is data in `fixtures/packs/`), copies each binary to a temporary folder, and fails each test
whose build failed. Each test opens an evidence store in a temporary folder and deletes it. The tests use only
node built-ins, vitest and the evidence store's public entry (`packages/evidence/src/index.ts`). A run with
`--root tests/acceptance/306` leaves Vitest's cache in `tests/acceptance/306/node_modules/.vite`; delete it.
`BASE-FAILURE.txt` is the run at the base, with a header saying why each test fails there.

`budgets.test.ts`'s timing test skips with an `INCONCLUSIVE` message off a reference Mac (Mac15,7 or Mac15,12
on mains, Low Power Mode off, no thermal warning); it never passes by skipping. Everything runs headless on the
CPU; no GPU and no app.

## The surface under test

The issue names the pack format, the pack check, `requires.modules`, recipe expansion, derived items and their
keys and seeds, `break_out`, `pack_missing`, `module_missing`, `out_of_range` and `derived_item`, but no code
API. These tests reuse `deep-show run` (#393's scenario binary standing in for the hub's canvas side) with
everything #393's, #96's, #305's and #371's READMEs define for it: the JSON-lines convention and `bad_input`,
sessions, the process table and its peer check, panels, `evidence`, whole revisions (`deep_show` and `deep
show` with `document`, `include`, `size`, `t`, `check: true`) and their replies (`outcome`, `issues`,
`snapshots`, `result`), patches and undo (`deep show` with `patch` or `undo` from your shell, the Patch result),
shared documents stored in `docs[…].document` (opened as revision 0, your layer `you-main`), `read` (`document`,
`draws`, `issues`), `revisions`, and the planted convention (a scenario field, each value reachable only there;
an unknown value is `bad_input`). What follows adds to it, as little as the criteria need.

### Packs in the store

- **The document names a pack version** in its envelope's `packs: ["<owner>/<name>@<version>"]` (Document
  envelope; Pack: `name` is "the name half of its package envelope's `owner/name` ID"). An instance is an item
  whose `kind` is `<pack>.<name>@<major>` (Recipe: "Used as an item") with the recipe's inputs as `params`, as
  `{"id": "c1", "kind": "chart.bars@1", "params": {"n": 5}}`.
- **A pack on disk** is a folder with `pack.json` (the Pack fields: `name`, `version`, `license`, `description`,
  `requires: {core, modules}`, `recipes: {kind → file}`) and each recipe file it names (the Recipe fields:
  header, `inputs`, `steps`, `outputs`). An expression is a string wherever a literal may be (`"40 + 8 * i"`,
  `"n"`); a literal is any other JSON value.
- **Scenario field `packs`**: `[{"id": "<owner>/<name>", "dir": <absolute path to the folder>}]`, the packs
  installed in the store before the first call, each put through the pack check once, in list order.
- **Call `install_pack`**: `{"call": "install_pack", "id": "<owner>/<name>", "dir": path}` installs one pack
  version mid-run (AC2's "a newer version of the pack is installed"). Reply: `{"outcome": "installed" |
  "refused", "pack": "<owner>/<name>", "version": semver, "issues": [Issue]}`. Publishing a version the store
  already holds with other bytes is refused (the issue code is the implementer's; the tests read `outcome`,
  `pack` and `version`).
- **Call `packs`**: `{"call": "packs"}` → `{"packs": [{"pack": "<owner>/<name>", "version", "state":
  "installed" | "refused", "checks": n, "issues": [Issue]}]}`, one row per pack version the scenario or an
  `install_pack` offered, in that order; `checks` is how many times that version's pack check has run in this
  process (1 after its install, whatever documents opened or frames drew since: Pack, "checked once per
  version"); `issues` are the pack check's, a refused pack's `module_missing` among them.

### Reply fields added

- **`expansions`** on every `deep_show` / `deep show` reply whose document was checked (presented, and with
  `check: true`), on every patch and undo reply, and on `read`: `[{"instance": ID, "kind":
  "<pack>.<name>@<major>", "pack": "<owner>/<name>@<version>", "key": string, "derived": {derived ID → Item},
  "seeds": {derived ID → string}}]`, one row per recipe instance that expanded, sorted by instance. `key` is the
  expansion key (hash(recipe@version, inputs), joined by `broken_out`), read only through sameness and
  difference; `derived` holds each derived item as expanded (`id`, `kind`, `params`, `at`, …), the items the
  instance writes now (a broken-out item is not among them); `seeds` each derived item's seed as a string,
  read only through sameness. Derived items are not in `read`'s stored `document.items` (a document never
  copies a recipe's steps) but are in its `draws`.
- **`batches`** on every reply that carries a snapshot: `[{"batch": string, "items": [ID]}]`, the instanced
  batches the draw made for that snapshot, each with every item it draws (as #378's `encoded` rows); equal
  expansions draw in one batch.
- **`timing`**, with `include: ["timing"]` (an include name the base already parses): `{"check_ms": number}`,
  the wall time of the document's full check as the binary measured it, expansion included.
- **`broken_out`** on an instance in `read`'s stored document, after a break-out: `["<derived ID>"]`.
- **Issues** are #389's `{code, severity, ids, path, actual, what, …}`. A `pack_missing` issue names the pack and
  the version (the design's notice fields `pack` and `version`, or its `what`: the tests read the issue's whole
  JSON text for both). A `module_missing` issue names the module in `what` as #305's do. A document naming two
  packs of one name is refused with an error whose text names both IDs (`<owner>/<name>@<version>`, both); the
  code is the implementer's. `out_of_range` on an input is at `items/<instance>/params/<input>` with
  `ids: [instance]`; `derived_item` on a patch names the derived item in `ids`.
- **`deep show --check`** of a document that needs a missing pack or module answers `result: "BLOCKED"`.

### `planted` values added (scenario field, each reachable only through it)

| Value | Criterion | The wrong program |
|---|---|---|
| `seeds_by_expansion_order` | AC4 | a derived item's seed comes from a counter over the document's expansion order, not (instance, step, index) |
| `reexpansion_overwrites_broken_out` | AC5 | a change of inputs re-expands every derived item, the broken-out one included, overwriting the writer's item |
| `pack_check_skips_requires_modules` | AC6 | the pack check never reads `requires.modules`, so a pack naming a module the build lacks installs |
| `packs_keyed_by_name` | AC7 | the store and the document's `packs` are keyed by the name half alone, so an entry resolves through the first pack of its name listed |

## Fixtures

- `packs/test-chart-1.0.0/`: pack `test/chart@1.0.0` (`name: chart`, `requires.modules: {marks2d}`), recipe
  `chart.bars@1`: input `n` (`integer`, default 3, min 1, max 12), one step `bars` (`op: mark`, `kind:
  rect@1`, `repeat: {count: "n", as: "i"}`, box `[0, 0, 16, "40 + 8 * i"]`, at `["24 * i", 0, 0]`), so an
  instance `c1` with `{n: 5}` expands into `c1.bars.0` … `c1.bars.4`.
- `packs/test-chart-1.1.0/`: `test/chart@1.1.0`, the same recipe with bars 20 wide and 12 steeper (AC2's newer
  version).
- `packs/test-chart-1.0.0-changed/`: `test/chart@1.0.0` again with bars 18 wide (AC2's republish with other
  contents; refused).
- `packs/test-solid-1.0.0/`: `test/solid@1.0.0`, `requires.modules: {scene3d}`, recipe `solid.block@1` (one
  `mark.box@1` of side `side`) (AC6).
- `packs/alice-foley-1.0.0/` and `packs/bob-foley-1.0.0/`: `alice/foley@1.0.0` (recipe `foley.tap@1`: one
  rect) and `bob/foley@1.0.0` (`foley.tap@1`: two rects, `repeat: {count: 2}`), so which pack an entry resolved
  through shows in the expansion's `pack` and in its derived count (AC7).
- `chart-board.json`: your stored board (layer `you-main`, `you:you`) naming `test/chart@1.0.0`: `c1` and `c2`
  (each `chart.bars@1`, `{n: 5}`) and a plain rect `frame` (AC1, AC5, AC8).

## Criteria to tests

Each test's name starts with its criterion's ID; each file's head quotes its criterion and names in `asserts`
the assertions that carry it. Where a criterion names a wrong program, the test runs it through `planted` and
asserts the criterion's check fails, its failure naming what the criterion says. AC1–AC5 and AC7 run on `r1`
(the build without scene3d, the issue's "2D-only build"); AC6 on `r1` and `full`; AC8 on `full`.

| ID | Criterion | Tests (count) |
|---|---|---|
| AC1 | Rebuilding a recipe with the same inputs keeps its generated items' IDs, and a patch aimed at a generated item is refused as derived | `derived.test.ts` (2): on the stored board, revision 0 expands c1 into exactly `c1.bars.0..4`; after a patch to `frame`, and after n goes to 6 (six bars) and back to 5, the derived IDs, key and items are revision 0's; a `set` on `c1.bars.1` and a `delete` of `c1.bars.3` are refused with `derived_item` naming the item, revision 0 still current. Wrong program: the base (no packs: the board is refused) |
| AC2 | A document names pack@version and keeps expanding that version's recipes byte for byte after a newer version of the pack is installed, and publishing a version again with different contents is refused | `version.test.ts` (2): a board naming 1.0.0 presented; `install_pack` 1.1.0 installed; the board again: the same expansion bytes (key and derived) and snapshot sha256; a board naming 1.1.0: other bytes (control); `install_pack` of 1.0.0 with other contents refused naming `test/chart` and `1.0.0`, the store's 1.0.0 still installed, the board's bytes unchanged |
| AC3 | A document that names a pack version this build lacks is refused with pack_missing, naming the pack and the version, never drawn with another version, and a check that needs it is BLOCKED; … | `missing.test.ts` (2): with 1.0.0 installed, a board naming `test/chart@2.0.0`: refused, no snapshot, `pack_missing` naming `test/chart` and `2.0.0`, no current revision, `--check` BLOCKED; with nothing installed, a board naming 1.0.0: the same. The pack versions task's later opening (#203) is not read |
| AC4 | A test outside pack chart@1.0.0 … checks and draws in a build without scene3d: c1 {n: 5} expands at check into c1.bars.0 to c1.bars.4, the same bytes twice, c2 with equal inputs shares c1's expansion key and draws in one instanced batch with it; an n outside the input's range is refused with out_of_range, naming n; a planted expander that seeds by expansion order … gives c2's rects other seeds and fails, naming the item | `expand.test.ts` (4), on `r1`: presented with a snapshot, c1's derived exactly `c1.bars.0..4` each `rect@1`, through `test/chart@1.0.0`; c2's key is c1's; one batch holds all ten; a second process gives the same `expansions` bytes and snapshot; `{n: 20}` refused with `out_of_range` at `items/c3/params/n` on `c3`; c2's seeds equal alone and beside c1 (`seedFailures`); `seeds_by_expansion_order` fails naming `c2.bars.0` |
| AC5 | Breaking out c1.bars.2 by patch makes it the writer's own item with the same ID and the values it was expanded with; broken_out lists it and joins c1's key; changing n to 6 re-expands the others and adds c1.bars.5 while c1.bars.2 keeps its values; undoing the break-out hands it back as expanded; a planted re-expansion that overwrites a broken-out item fails, naming it | `break-out.test.ts` (3): your `break_out` applies; `read` holds `c1.bars.2` with the expanded kind, params and at, `c1.broken_out == ["c1.bars.2"]`, c1 writes bars 0, 1, 3, 4 and its key differs from c2's; n = 6 applies, c1 writes 0, 1, 3, 4, 5 and `c1.bars.2` keeps its values (`brokenOutFailures`); in a second run the undo applies, `c1.bars.2` is gone from your items, expanded again with the same values, c1's key c2's again; `reexpansion_overwrites_broken_out` fails naming `c1.bars.2` |
| AC6 | A test pack whose requires.modules names scene3d is refused with module_missing naming scene3d in a build without scene3d, and so is a document that names it, its checks BLOCKED, while the same pack checks clean in a build with scene3d; a planted pack check that skips requires.modules admits it and fails, naming the pack | `modules.test.ts` (3): on `r1` the `packs` row for `test/solid@1.0.0` is refused with `module_missing` naming scene3d (`packModuleFailures`), a board naming it refused with `module_missing` naming scene3d and its check BLOCKED; on `full` installed with no error; `pack_check_skips_requires_modules` on `r1` fails naming `test/solid` |
| AC7 | A document whose packs name alice/foley@1.0.0 and bob/foley@1.0.0 is refused at check, naming both IDs; with only bob/foley@1.0.0 it checks and its entry foley.tap resolves through bob's pack; a planted check that keys packs by name alone resolves foley.tap through the first pack listed and fails, naming the entry | `owners.test.ts` (2): both installed, alice's first; the board naming both refused with an error naming both IDs, no snapshot, its check not PASS; naming bob's alone presented, t1's `pack` is `bob/foley@1.0.0` (`resolutionFailures`) and its derived are bob's two taps; `packs_keyed_by_name` fails naming `foley.tap` |
| AC8 | Budgets, on the reference Mac in the local preflight, compared with the merge base: a document of 10,000 items, 1,000 of them derived from recipe instances, checks in under 50 ms …; a pack version's check runs once, never on open; and nothing runs per frame | `budgets.test.ts` (2), on `full`: 8,800 rects and 200 instances with n = 5, `--check` PASS with 200 expansions of 5, `timing.check_ms` over five fresh processes after a warm-up judged against 50 ms (INCONCLUSIVE off a reference Mac); in one process `packs[].checks` for `test/chart@1.0.0` is 1 after three boards naming it open (two sent, one stored and read) and six frames at six times draw |

## Readings where the issue and design leave a choice

- **Pack IDs carry an owner.** The Pack section makes `name` the name half of an `owner/name` ID and AC7 names
  `alice/foley@1.0.0`, so a document's `packs` entry is `<owner>/<name>@<version>` everywhere, and the issue's
  "chart@1.0.0" is `test/chart@1.0.0` here (its owner the suite's). The instance's kind is `<pack>.<name>@<major>`
  with the name half (`chart.bars@1`, `foley.tap@1`), which is why two owners of one name must be refused.
- **"The same bytes twice"** is the expansion rows' canonical JSON (keys sorted at every depth) and the
  snapshot's sha256, from two fresh processes.
- **"Draws in one instanced batch"** is read on `batches`, the way #378 reads instanced draws on `encoded`: one
  batch holds all ten derived items. Its pixels aren't read.
- **Seeds "by (instance, step, index)"** are read through what that rule implies and expansion-order seeding
  breaks: c2's seeds don't change when c1 is in the document too. The seeds' form isn't read.
- **"The values it was expanded with"** are the derived item's `kind`, `params` and `at`; its `layer` and
  `order` are the writer's and aren't compared.
- **Which pack a document "names"** for AC7's refusal is read in the issue's text, not a code, since the
  closed refusal list has none for it; "its checks BLOCKED" isn't in AC7, so its check is only read as not PASS.
- **`requires.modules` on the chart and foley packs** names `marks2d` (the module that draws `rect@1`, in `r1`
  and `full`), so a 2D pack checks in a build without scene3d; the version ranges are `>=0.0.0`, since the
  tests read nothing of range matching.
- **"Never on open" and "nothing per frame"** are read on the pack check's count across opens and frames (as
  #305 reads the seal's `runs`); each `deep show` at a new `t` is a revision, so expansion per revision isn't
  counted. The budget's clock is the binary's own (`timing.check_ms`), since a process start loads fonts and
  the look; "compared with the merge base" names the perf lane's comparison, not this test's.
- **Build sets.** "A build without scene3d" is `r1` and "with scene3d" is `full` (Registry and seal: `r2` adds
  scene3d); the tests never name shipped modules beyond `marks2d` and `scene3d` in `requires.modules`.

Not tested, because no criterion asks: `let`, `outputs`, `when`, nesting, `repeat` forms other than `count`,
conditions, lights, channels in recipes, pack kinds, migrations, `requires.packs`, retired packs and the
R6 opening of a document with a missing pack (its instances kept and skipped), registry entries from packs,
programs, the pack's other fields, a recipe's `preview`, `soft_min`/`soft_max` warnings, and the fuzzer laws
on `break_out`.

## Upstream tests (the Oracle lane)

The Oracle page lists no upstream test for any of the eight criteria, so these tests are their local proof.
