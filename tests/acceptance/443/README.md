# Acceptance tests for #443: 3D titles and logos — extrude from glyphs, paths and SVG through outline.source@1 and its three fillers

Written first, from issue #443 (its scope, its Fields block for Builder `extrude`: outlines from text, paths and SVG,
its five acceptance criteria and its proof line), the design sections it links and those they lean on, its oracle
page, and base commit `ae33c024` ("Merge pull request #1305 …"), by a job that never saw an implementation; none
existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of
this job (design: Dogfooding).

What was read:

- Issue #443 and its oracle page (`doneright/oracles/issues/443.md` in `DeepBuildAI/deepbuild`, branch
  `doneright`): no upstream test checks any of the five criteria (AC1, AC3, AC4 are our builders' rules, AC2 our
  registry rules, AC5 a person's taste call).
- `docs/canvas-primitives.md`: Builder (the `extrude {outline; holes; depth; bevel; twist}` row, "a vertex count
  computable from params"); Builder `extrude`: outlines from text, paths and SVG (the `{text, font, size, weight,
  align, lang}`, `{path, size}` and `{vector: ID[#part], size}` forms, `flatten: 0.001`, the registry
  `outline.source@1` "which the core declares … text, marks2d and vector fill it at the seal"; "in a build without
  one of them, its form of `outline` is refused with `module_missing`, naming the module"; "contours resolve by their
  fill rule (nonzero for glyphs, and a path's or an SVG element's own otherwise)"; "a path or an SVG element with a
  stroke and no fill is refused, naming it"; "The item's string counts as displayed text … honest numbers scans
  it"); Builder `extrude`: sweep along a curve (a text outline with `along` is refused; not tested); Registry and
  seal and its registries (entries "join the filling module's own interface digest, never another module's"; "The
  seal also runs the kit on each planted wrong entry and refuses a registry whose kit admits one, naming the
  registry and the entry"); Registries and closed lists (the Outline sources row: "An entry's outlines cover what
  its 2D fill covers within `flatten` at 1,000 sampled points, holes by its fill rule; planted: an entry that drops
  a hole"); Text `text@1` (one shaper, kerning, bundled fonts); Path `path@1` (`fill_rule`); Vector and formula
  `vector@1` (parts by SVG `id`); Honest numbers (76) and its check (8864: `names: [string]`, "An unsourced number
  fails, naming the item and the fix: bind it, compute it, or mark it a name").
- `docs/technical-design.md`: Canvas modules (1059: the core holds "the registry `outline.source@1` of filled 2D
  outlines that `extrude` reads"; the module table: text's "glyph outlines of a shaped run (an entry of the core's
  `outline.source@1`)", marks2d's "path outlines", vector's "outlines of an SVG or a formula's parts", scene3d's
  "`extrude`'s … outlines, read through the core's `outline.source@1`", scene3d depending on core alone, vector on
  marks2d); Dogfooding; Tests written first.
- At the base, to learn the call shapes only: `crates/deep-canvas-scene3d` (`builders.rs`: `extrude@1` takes a
  polygon `outline`, `holes`, `depth`, `bevel`, `twist`, `levels`, `along`, and scenario plants by name; `module.rs`:
  scene3d implements `scene3d@1`), `crates/deep-canvas/src/registry` (`core_lists.rs`: the core's registries, among
  them `column.source@1` with its rules and planted entries; `lists.rs`: what each module's digest holds, and the
  `hashes_every_entry` fault; `mod.rs`: the seal's refusals, `undeclared_dependency` for a read of a module not
  depended on), `crates/deep-canvas/src/document/rules.rs` (honest numbers scans `text@` kinds only; the
  `honest_numbers` check input's `names`), `crates/deep-text` (`deep-text shape`, the bundled faces: body is Inter),
  `crates/deep-canvas-vector`, `crates/deep-show` (`run`, the scenario's `planted`, the startup `--planted`
  `kit_admits_all:<registry>` and `hashes_every_entry`, the `registry`, `registries`, `schedule` and `geometry`
  calls, the evidence store's `<2 hex>/<62 hex>` layout from which `vector@1`'s `src` is read, the `test-leave-out-*`
  features), `crates/deep-gpu-layer/src/view3d.rs` (`store`), and the suites `441/`, `420/`, `200/`, `397/`,
  `398/`, `406/`, `424/`, `489/`, `1162/`, whose helpers these follow.

## What the base already does, which these tests don't credit

`extrude@1` extrudes a polygon `outline` with `holes` by `depth`, and `geometry` answers its mesh and closed parts;
`deep-show run`'s `registries` lists the core's registries with entries, kit results and planted entries;
`--planted kit_admits_all:<registry>` and `--planted hashes_every_entry` exist for any registry (#200); `schedule`
lists every interface's digest (#185); `deep-text shape` answers a flat run's width; `vector@1` items read their SVG
from the evidence store; `view3d` takes a `store`. There is no `outline.source@1`, no text, path or vector form of
`outline` (an object `outline` is a bad param), no per-glyph closed parts, no `test-leave-out-vector` or
`test-scene3d-reads-vector` feature, and none of the planted names below. So the tests define the surface below. The
suite was not run at the base: every test needs a surface the base plainly lacks, so no `BASE-FAILURE.txt` is kept.

## Run them

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/443 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/443/tsconfig.json
```

Each file first builds what it uses, once (`cargo build --locked --bin deep-show --no-default-features --features
<set>[,<test feature>]`, `cargo build --locked --bin deep-text`, `cargo build --locked --bin deep-gpu`, honoring
`CARGO_TARGET_DIR`, with `CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` unless set), copies each binary out
under its own name into a temporary folder (several `deep-show` feature sets share one target path), and fails each
test that uses a build that failed. So the files run one at a time: `scripts/lanes.mjs` needs
`'tests/acceptance/443/'` added to its `alone` list (the one-at-a-time unit-lane line, which also takes the folder off
the parallel line). This README is the instruction; the implementer makes that edit. Each test passes its own
1,800,000 ms timeout to `it`, which wins over the run line's. Temporary folders (evidence stores, documents, the GPU
layer's outputs) are deleted after each test. Node built-ins and vitest only. A run with `--root
tests/acceptance/443` leaves Vitest's cache in `tests/acceptance/443/node_modules/.vite`; delete it.

AC1–AC4 are CPU only and run anywhere. AC5 draws with the GPU layer on Metal: off macOS, or where `view3d` answers
`unsupported_platform`, it fails with a message starting `INCONCLUSIVE:`; it is INCONCLUSIVE everywhere until the
taste call is recorded (below). No criterion has a time budget.

## The surface under test

The issue names the outline forms, the registry, its fillers and kit, `module_missing`, honest numbers and planted
programs, but no code API. These tests use the binaries and calls the base has (#393's `deep-show run` with
`deep_show`, #420's `geometry`, #200's `registries` and startup refusal, #185's `schedule`, #856's `deep-text shape`,
#378's `deep-gpu run view3d`) and define the smallest additions they need: **outline forms on `extrude@1`**, **one
closed part per glyph**, **the `outline.source@1` listing**, **two test features**, **two scenario plants** and
**one registry plant**. No new binary, no new call. Every name below that the issue or the design doesn't give is
this job's invention.

### Documents

- Documents reach `deep-show` as an agent sends them (`deep_show` from session `sess-alpha`: no `id`, no `layers`),
  and `deep-gpu` as a session holds them (#378), every item at the origin, so item space is world space.
- `extrude@1`'s `outline` takes the design's forms: `{text, font: "body", size: m, weight, align: start | center |
  end = center, lang}` (size the em) and `{vector: ID[#part], size: m}` (size the height of its box). `depth: 0.1`,
  no bevel; depth runs along +z, as the base's extrude. With `align: start` the run's pen starts at x = 0 for every
  title, so two titles of one glyph each put it at the same pen position.
- A `vector@1` item is `{src: sha256, size: [100, 100], colors: {"#000000": "ink"}, alt}` (#398, #1162), its SVG put in
  the evidence store at its SHA-256 (`<2 hex>/<62 hex>`, as the hub keeps bytes); a scene that holds one names
  `requires.modules.vector`. `view3d` reads the same SVG from its `store`.
- Honest numbers: "marked a name" is the document's own honest_numbers check input, `checks: [{"kind":
  "honest_numbers", "names": ["2025"]}]` (Honest numbers: `names: [string]`), which the base already reads.

### `geometry` rows of an extrude from an outline source

The row is #420's (`positions`, `indices`, `closed: {part → {triangles, genus}}`). An extrude whose outline makes
several closed shells reports one closed part per shell. **For a text outline, each glyph's shell is the part
`glyph<k>`**, k the glyph's index in the title's shaped run from 0 in logical order ("OB": `glyph0` the O, `glyph1`
the B; "AV": `glyph0` the A, `glyph1` the V). A vector or path outline's parts are named as the implementer likes.

### `outline.source@1` in deep://registries (`{"call": "registries"}`, #200's listing)

- The row: `owner: "core"`, `fill` holding `"module"`, a kit rule `covers_2d_fill` (an entry's outlines cover what
  its 2D fill covers within `flatten` at 1,000 sampled points, holes by its fill rule).
- Exactly three entries, each named by its form of `outline`: `text` (`module: "text"`), `path` (`"marks2d"`) and
  `vector` (`"vector"`), each `origin: "first_party"` with `kit.verdict: "PASS"`. Each entry's `covers_2d_fill` rule
  result carries `fixture` (the item the kit fills and compares: `"OB"` for text, `"square_hole"` for path, the
  path@1 square with a square hole, `"ring"` for vector, an SVG ring), `samples: 1000` and `misses` (sampled points
  where the outline and the 2D fill disagree farther than `flatten` × size from the boundary), 0 for a PASS.
- A planted entry `drops_counter`: an outline reader that leaves out the O's counter. Its `result` is FAIL on
  `covers_2d_fill`, naming `drops_counter`. With the base's startup plant `--planted kit_admits_all:outline.source@1`,
  the seal refuses the build (`seal_refused`, reason `kit_admits_planted`, `registry: "outline.source@1"`, `entries`
  naming `drops_counter`), as #200's other registries do.

### Interface digests (`{"call": "schedule"}`, #185, as #489's suite reads it)

`interfaces["text@1"]`, `["marks2d@1"]`, `["scene3d@1"]`, each with its `digest`. The base's startup plant
`--planted hashes_every_entry` (#200: the seal hashes every entry of a core registry into each filler's digest) is
this suite's twin for "no other's".

### Test features of `deep-show` (none in a shipped build)

| Feature | What the build holds |
|---|---|
| `test-leave-out-vector` | the set's list without `vector`, as #489's and #490's `test-leave-out-*` |
| `test-scene3d-reads-vector` | a planted scene3d in place of the shipped one, whose extrude reads vector@1's items (its arrays or kinds) itself, not through `outline.source@1`; the seal must refuse it, naming scene3d and vector in `modules` (the base's code for such a read is `undeclared_dependency`; the code isn't pinned) |

### `deep-show run`: scenario `planted` values added (each reachable only there)

| Value | The wrong program | Criterion |
|---|---|---|
| `outline_ignores_fill_rule` | Every outline reader resolves its contours with no fill rule: each contour fills its inside, so a glyph's counters are filled | AC1 (issue-named) |
| `extrude_own_advance` | A text outline places each glyph at the sum of the glyphs' own advances before it, not at the shaped run's positions | AC3 (issue-named) |

### The flat run (`deep-text shape`, #856, unchanged)

`{"text", "font": "body", "size": 1}` → `width`, the run's advance in logical px. The flat run's V sits
width("AV") − width("V") from its A (one LTR line: the pen after A is A's advance plus the pair's kerning). The test
reads the extrude at size 1 m against the flat run at size 1, so the numbers compare as metres.

### The taste call

`taste.test.ts` writes, from one run's output, to `target/acceptance/443/`, each a byte copy of the renderer's final
target (so its SHA-256 is the renderer's own name for it), printing each SHA-256:

| File | What it shows |
|---|---|
| `ob.png` | AC1's "OB", in the body font, 0.1 m deep, lit by a sun |
| `ring.png` | AC1's vector ring, extruded |
| `av.png` | AC3's kerned "AV", extruded |

The camera of each is aimed at the item's bounds from `deep-show`'s `geometry`; no test judges a picture. They are
attached to the PR and shown to the owner in the session. The owner's answer is recorded in
`tests/acceptance/443/TASTE.json`, the one file anyone adds to this folder after this commit, and only to record it:

```json
{"issue": 443, "criterion": "#443.aea1cba1", "verdict": "looks_right" | "looks_wrong", "who": string,
 "when": "ISO 8601 time", "screenshots": {"ob.png": sha256, "ring.png": sha256, "av.png": sha256}, "note"?: string}
```

No file is INCONCLUSIVE; a call on other SHA-256s is INCONCLUSIVE; `looks_wrong` fails; `looks_right` on exactly this
run's pictures passes.

## Fixtures

| Fixture | What it is | Read by |
|---|---|---|
| `fixtures/ring.svg` | One path, `id="ring"`, `fill-rule="evenodd"`: a circle of radius 40 and one of radius 20 about (50, 50), each four cubic Béziers wound the same way, so nonzero would fill the inner circle and only evenodd cuts it out | AC1, AC4, AC5 |
| `fixtures/hairline.svg` | One path, `id="hairline"`, a triangle with `fill="none"` and a 2-unit black stroke | AC1 |

Every document is generated in the test files and `helpers.ts`.

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, with whitespace collapsed and the
leading `- [ ] ` dropped (#607's command, as #305's README gives it, with the issue's five criterion lines on
stdin). Each test's name starts with `AC<n> #443.<id>`. Where a criterion names a wrong program, the test runs it
and asserts it fails the way the criterion says, naming what it says.

| Criterion | Text (abridged) | Tests |
|---|---|---|
| AC1 `#443.359bd359` | "OB" 0.1 m deep builds two closed shells, O's V − E + F = 0, B's −2; a vector ring cut by evenodd gives 0; a stroke-only SVG element is refused naming it; a planted reader that ignores the fill rule gives 2 and fails naming the glyph | `fill-rule.test.ts` (3): "OB": exactly parts `glyph0` and `glyph1`, each closed on welded positions (every edge on two triangles, wound opposite ways) with V − E + F = 0 and −2, the mesh 0.1 m deep; the ring: one closed part with 0; the hairline item refused with an error naming `hairline`; `outline_ignores_fill_rule` fails naming `glyph O` and `glyph B`. Wrong programs: counters filled; evenodd read as nonzero; glyphs merged; a stroke taken as an outline |
| AC2 `#443.f3f6eafa` | The kit holds text's "OB", marks2d's square with a square hole and vector's ring to their 2D fills at 1,000 points; each entry joins only its own module's digest; the planted entry that drops the O's counter is refused at the seal naming the registry and the entry | `kit.test.ts` (3): the listing's row, its three entries and their `covers_2d_fill` results (fixture, 1,000 samples, no miss); text@1's digest equal in `core` and `full`, marks2d@1's with and without vector, and `hashes_every_entry` fails that, naming text@1 and marks2d@1; `drops_counter` FAILs `covers_2d_fill` naming itself, and `kit_admits_all:outline.source@1` is refused at the seal naming outline.source@1 and `drops_counter`. Wrong programs: a kit that never ran an entry, or on fewer points; a kit that admits the planted entry; other modules' entries in a filler's digest |
| AC3 `#443.33177d47` | An extruded "AV" puts V at the flat run's offset within 1e-6 m; a planted per-glyph-advance extrude fails naming the pair; a 3D title "2025" fails honest numbers naming the item and passes once marked a name | `kerning.test.ts` (3): the body font kerns A-V (flat widths); the V's offset from the A read from the meshes, side bearings cancelled by lone "A" and "V" titles, within 1e-6 m of width("AV") − width("V"); `extrude_own_advance` fails naming `AV`; "2025" refused with `number_unsourced` naming `year`, presented once `names: ["2025"]`. Wrong programs: own advances, a second shaper or an unkerned font; a title's string not scanned, or a mark that doesn't clear it |
| AC4 `#443.c78c7ccd` | Without vector, an extrude naming a vector item is refused `module_missing` naming vector while the text title extrudes; scene3d's digest is the same with and without vector; a planted scene3d reading vector items adds an edge the seal refuses, naming it | `module-missing.test.ts` (3): in `full,test-leave-out-vector` the vector extrude is refused with `module_missing` naming vector, and no error naming the extrude has another code, while "OB" from text is presented with its two shells; scene3d@1's digest equal; `full,test-scene3d-reads-vector` refused at the seal naming scene3d and vector (`full` seals). Wrong programs: scene3d holding an edge to vector; a digest that moves with vector; a vector form failing another way; a text title needing vector |
| AC5 `#443.aea1cba1` | Screenshots of "OB", the ring and "AV" from the renderer's own output; one taste call, recorded, or INCONCLUSIVE | `taste.test.ts` (1): writes the three final targets and reads `TASTE.json` (above) |

## Readings where the issue and design leave a choice

- **The look's body font** is the body role of the look in effect, Inter in every shipped look and in AC5's look
  (#417's bundled `Inter-Regular.ttf`). **Inter kerns A-V**: at the base, `deep-text shape` gives width("A") =
  width("V") = 689.94 px and width("AV") = 1,311.52 px at size 1,000, a kern of −68.36 px (−0.0684 em), so the
  planted per-glyph advance puts the V 0.068 m too far at size 1 m. The test checks the kern before it reads the
  extrude, so a font that stopped kerning the pair fails as a fixture, not as the criterion.
- **"Two closed shells, the O's … and the B's"** is two closed parts, one per glyph; "closed" is #420's watertight on
  positions welded at 1e-6 m. V − E + F is counted per part, never read from a declared genus, so a reader that
  fills counters and declares genus 0 still fails. **"Each counter a hole by the nonzero rule"**: Inter winds its
  counters against its outer contours, so the nonzero rule makes them holes and V − E + F shows it.
- **"Naming the glyph"** is a failure that names `glyph O` or `glyph B`; the test maps part `glyph<k>` to the k-th
  character of the title it wrote. **"Naming the pair"** is a failure that names `AV`.
- **"The V at the same offset from its A"** is the pen-to-pen offset. It is read from the meshes alone, not from a
  reported position: the V's left ink edge in "AV" less the lone "V"'s, minus the same for the A, which cancels each
  glyph's side bearing; this assumes only that a glyph's outline is moved, not changed, by where it is set.
- **"A vector@1 ring … extrudes with V − E + F = 0"** is one closed part with 0; the ring's two circles are wound the
  same way so the fill rule decides the hole.
- **"Refused, naming it"** (the stroke-only element) is a `refused` revision with an error whose JSON holds the
  element's id, `hairline`; the code isn't pinned.
- **"Each entry joins its own module's interface digest and no other's"** is read on `schedule`'s interface digests:
  text@1's digest is the same in `core`, where text is the only filler, and in `full`, where marks2d and vector fill
  beside it; marks2d@1's is the same with and without vector. That vector's entry joins vector@1's own digest is not
  observable without a second version of the entry, so it rests on the listing's `module`.
- **"Refused at the seal, naming outline.source@1 and the entry"** is #200's reading: the seal runs the kit on the
  planted entry (its listed result FAILs, naming it), and a kit that admitted it would refuse the build, naming the
  registry and the entry (`kit_admits_all`).
- **"An `extrude` whose outline names a vector item is refused with `module_missing`, naming vector"** is a
  `module_missing` error naming vector in the refusal; the document also holds the vector item, whose own kind is
  missing too, so the test doesn't require the error to point at the extrude, only that nothing about the extrude is
  refused with another code. **"Adds an edge the seal refuses, naming it"** is a seal refusal whose `modules` hold
  scene3d and vector.
- **"Passes once marked a name"** uses the document's `names` list (a field the base reads for text items), so the
  test doesn't depend on a new per-item mark on an outline.

## Not tested, because no criterion asks

`weight`, `lang`, `{copy: key}` text, `align: end`, line breaks at `\n`, `text.glyph_missing` and fallback faces;
`{path: ID}` extruded in a scene (the kit's square with a square hole is the kit's own fixture); `#part` outlines
and formulas; `flatten` other than its default; bevel, twist and caps on a text outline; a text outline with
`along`; overlapping contours merging; reading holds and the accessible name; a vector's `alt` scanned; the vertex
count before the build; shaping once per change; `outline.source@1`'s digest and `since`.
