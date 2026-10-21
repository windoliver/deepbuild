# Acceptance tests for #389: the document contract, the one ops module and the lint lane

Written first, from issue #389 (its 11 acceptance criteria, scope, fields and proof), the design sections it
links (`docs/canvas-primitives.md`: Conventions every primitive uses, lines 1–102; What the kernel holds,
lines 285–547; What holds a document to its rules, lines 8151–8175; the closed function list and the ops
module, lines 5949–5956; the `hash@1` content key, line 5044; `docs/technical-design.md` line 876, Seeded and
replayable) and base commit `f346706`, by a job that never saw an implementation. The implementing agent
doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

Run them (a root with no config of its own uses Vitest's defaults; the repo's `vitest.config.ts` also takes
`tests/**/*.test.ts` from `scripts/lanes.mjs`, so `npx vitest run tests/acceptance/389` runs them too):

```sh
npm ci                      # once, if node_modules is missing
npx vitest run --root tests/acceptance/389
```

Every file first runs `cargo build --locked -p deep-canvas --bin deep-canvas` in the checkout (cached after
the first file) and fails each of its tests when that build fails. `lint.test.ts` builds two throwaway cargo
workspaces under the OS temp folder, which resolve with no registry crate (below). The tests use only node
built-ins, vitest and fast-check, and type-check under the root `tsconfig.json`'s strict options with
`allowImportingTsExtensions` (checked against a copy of the options outside the repo). A run with
`--root tests/acceptance/389` leaves Vitest's cache in `tests/acceptance/389/node_modules/.vite`; delete it,
it is not part of the suite. `BASE-FAILURE.txt` is the run at the base: every test fails there because the
crate and the script don't exist.

## The surface under test

The issue names a document contract, refusal codes, grammars, a lint and color math, but no code API, so
these tests define the smallest surface they need: one workspace crate `crates/deep-canvas` with a binary
`deep-canvas` (found at `target/debug/deep-canvas`), driven by JSON lines on stdin and JSON lines on stdout,
and one Node script `scripts/canvas-lint.mjs`. Nothing else is read.

### The binary

`deep-canvas <subcommand>` reads one JSON object per stdin line and writes exactly one JSON object per input
line to stdout, in order, then exits 0. A line it can't read as JSON, or that lacks a field below, is still
answered with one line, `{"ok": false, "code": "bad_input"}`, never a panic; a run that writes fewer lines
than it read, or exits non-zero, fails every test that drove it. Each test pipes its whole batch (up to
10,101 lines) into one process.

#### `parse <grammar>`

`<grammar>` is `time`, `unit`, `path`, `handle` or `id`. Input `{"text": string, "fps"?: [p, q], "unit"?: string}`:
`fps` (default `[60, 1]`) is the document's frame rate for `time`; `unit` is the field's declared unit for
`unit` (`m`, `u` or `deg`). Output:

- accepted: `{"ok": true, "printed": string, "value": …}`, `printed` being the grammar's printer's text for
  the parsed value, and `value` as the table below gives;
- refused: `{"ok": false, "code": string}` with no `printed` and no `value`. The code is the grammar's:
  `bad_time`, `bad_unit`, `bad_path`, `bad_handle`, `bad_id`; a path whose ID part is malformed may carry
  `bad_id` instead of `bad_path`.

| Grammar | Accepted text | `value` |
|---|---|---|
| `id` | 1 to 8 segments joined by `.`, each `[a-z0-9][a-z0-9_-]{0,47}`; nothing else (no `/ # : @ ~`, no space, no upper case, no empty segment) | `{"segments": [string]}` |
| `time` | `<n>s` with `<n>` = `0\|[1-9][0-9]*` and an optional fraction of 1 to 5 digits, or `<n>f` (a whole frame count). No sign, no leading zero, no space, no other unit. (Marker, bar and narration forms are out of this slice.) | `{"flicks": string}`: the i64 count as decimal text. `s`: n × 705,600,000 (always whole with ≤ 5 fraction digits). `f`: n × 705,600,000 × q ÷ p, whole for every valid rate; the test draws from 24, 25, 30, 48, 50, 60, 120, 24000/1001, 30000/1001 and 60000/1001 |
| `unit` | `-?[0-9]+(\.[0-9]+)?`, then optionally one space and a unit of the field's family (table below). A bare number is in the field's unit. | `{"num": string, "den": string}`: the exact rational in the field's unit, in lowest terms, `den` > 0, both as decimal text |
| `handle` | `<scheme>:<id>[#<fragment>]`; scheme one of `task ask claim verdict run req decision plan lease reading notice doc ev session`; id a ULID (26 upper-case Crockford base32, first ≤ `7`) or a 64-character lower-case hex content hash; fragment `[A-Za-z0-9][A-Za-z0-9_.-]*` | `{"scheme", "id", "fragment"?}` (`fragment` absent, not null, when there is none) |
| `path` | `<section>/<id>[#<sub>]/<field>[/<field>…]`; section one of `items controls channels markers data inputs assemblies`; id per the ID grammar; sub `[a-z0-9][a-z0-9_.-]{0,47}`; each field `[a-z0-9_][a-z0-9_-]{0,47}` (a list index is digits). At least one field; no leading, trailing or doubled `/`; no escaping | `{"section", "id", "sub": string \| null, "fields": [string]}` |

The printers write canonical text: a unit literal as `<number><unit>` with no space, no `+`, no leading or
trailing zeros (`"300 mm"` prints `300mm`, `"1.50m"` prints `1.5m`; a bare number stays bare); the other
grammars print the accepted text itself. The generators draw canonical text only, so the round trip is
exact.

Unit families, with each unit's exact factor into the field's unit: field `m`: `m` 1, `cm` 1/100, `mm`
1/1000, `km` 1000; field `u`: `u` 1; field `deg`: `deg` 1, `turn` 360. A literal whose unit is not in the
field's family is refused with `bad_unit` (so is an unknown unit): "one reading in the field's unit, losing
nothing". `rad` is not a form (π is not a rational factor), nor are `fw`/`fh` in this slice.

#### `check`

Input `{"doc": Document}`. Output
`{"ok": bool, "issues": [Issue], "notices": [Notice], "draws": [ID], "lowered": Document}`:

- `ok` is true when no issue of severity `error` was raised. `issues` holds errors and warnings; `notices`
  holds the notices (migrations, skipped kinds and fields). Both are sorted errors first, then by code and
  first ID.
- `draws` lists the IDs of the items that would draw (every known, checked item), sorted.
- `lowered` is the document after its migrations ran and skipped fields were dropped: the form the check
  read. It is present whether or not the check passed. An `unknown_kind` item stays in it byte for byte.
- Issue: `{"check": string, "code": string, "severity": "error" | "warning", "ids": [ID], "path": string,
  "actual": JSON, "what": string, "fix": string | [op], "forms"?: [string]}`. `check` is the check kind
  that raised it (`document.validate` for every issue these tests expect); `path` is the path grammar's text
  of the refused field (`items/<id>/params/width`, `items/<id>/parent`, `items/<id>/kind`,
  `channels/<id>/target`, `bound_values/<id>/source`), `actual` the value found there, `forms` the forms a
  field takes (only on `bad_unit`), each a literal the unit printer wrote (`1m`, `1cm`, `1mm`, `1km`; the bare
  form is left out). `t` is absent in this slice.
- Notice: `{"code": string, "severity": "notice", "ids": [ID], "path": string, "actual": JSON, "what": string,
  "kind"?: string, "from"?: number, "to"?: number}`. `migrated` carries `kind` (family.name), `from` and `to`
  (majors) and one notice per step per kind, in step order; `unknown_kind` carries the item's `kind` text in
  `actual` at `items/<id>/kind`; `unknown_field` (the skipped case) names the field's path.

Codes these tests expect from `check` and `apply`: from the design's closed patch list, `unknown_kind`,
`kind_too_new`, `unknown_field`, `out_of_range`, `ref_unresolved`; and the grammar codes above. Every code
an issue carries must be one of those or another member of the design's closed list.

#### `apply`

Input `{"doc": Document, "writer": string, "patches": [Patch]}`: the patches apply in order, each all or
nothing, as the named writer (the writer comes from this field, standing in for the connection; a payload
never carries it). Output `{"outcome": "applied" | "refused", "issues": [Issue], "hash": string,
"doc": Document}`: `doc` is the document after the last applied patch (the input document, unchanged, when
refused) and `hash` its revision hash, the SHA-256 of its canonical bytes. A patch with any refused op is
refused whole, and so is the run.

Patch `{"patch": ULID, "doc": doc ID, "base": u64, "reason": string, "ops": [op]}` (`base` is carried, not
checked here; no lease or layer rule beyond the writer's own layer applies). Ops:

- `{"op": "create", "item": Item}`: the item without `layer`, which is stamped with the writer's layer (the
  layer whose `writer` is the given writer). The ID must be new and in the ID grammar (`bad_id` otherwise).
- `{"op": "set", "id": ID, "path": path, "value": JSON}`: `path` is a full path in the grammar whose ID part
  equals `id`; it reaches params (`items/<id>/params/<name>`), `at` members and indices
  (`items/<id>/at/rot/1`), and the item's own fields. A path outside the grammar is `bad_path` (or `bad_id`),
  `actual` the path text; a path that resolves to nothing is `ref_unresolved`.
- `{"op": "unset", "id": ID, "path": path}`: a param back to its default; an optional field removed.
- `{"op": "delete", "id": ID, "cascade": bool}`: removes a childless item (the histories delete nothing else).

`move`, `reorder`, `rows` and `break_out` are not used here.

#### `canonical`

Input `{"doc": Document}`; output `{"bytes": string, "sha256": string}`: the canonical document as text
(UTF-8 when hashed) and the lower-case hex SHA-256 of those bytes. The canonical form, per Revision:

- Every map keyed by ID (`layers`, `items`, `channels`, `bound_values`, …) and every object has its keys
  sorted by code point. No whitespace outside strings.
- A field equal to its declared default is left out: a param equal to its kind's default; an item's
  `parent` null, `role` decoration, `visible` true, `pickable` true; each `at` member at its default (`pos`,
  `rot`, `pivot` `[0,0,0]`, `scale` `[1,1,1]`, `shear` 0) and `at` itself when empty; a layer's `role`
  content and `locked` false; the envelope's `transport`, `safe`, `locale`, `aspect`, `requires`, `seed`,
  `look`, `camera`, `budget`, `packs`, `assets` and every ID map when absent or at their default or empty.
  `format`, `id`, `profile`, `title`, `description`, `size`, `layers`, `items` and an item's `params` (even
  `{}`), `id`, `kind`, `layer`, `name` and `order` are always written.
- Each float is the shortest decimal text that reads back to the value at the field's declared width,
  without exponent, integral values without a fraction (`640`, `0.1`, `33.3`, `2.25`); `-0` is `0`. f32
  fields: `size`, `safe`, `at` vectors and `shear`, and every `f32` param. f64 fields: the numbers in
  `data`. `format` is a u32.
- Strings are NFC, written with only `"`, `\` and controls below U+0020 escaped (`\n`, `\t`, `\r`, `\b`,
  `\f`, else `\u00XX`), every other code point as UTF-8.

#### `color`

Input `{"from": space, "to": space, "value": [a, b, c]}` with spaces `srgb` (encoded, 0–1), `linear`
(linear BT.709), `oklab` (L, a, b) and `oklch` (L, C, h with h in degrees); output `{"value": [x, y, z]}`,
f64. Conversions are Björn Ottosson's published OKLab (the matrices palette and bevy_color carry) and the
sRGB transfer, in f64 through the ops module. OKLCh hue is reported in [0, 360); any hue angle is accepted on
input (359.9999, −0.0001 and 719.9999 are one hue). Where chroma is below 1e-4 hue is powerless and the tests
never read it.

### The document contract these tests use

A document is the envelope of the design with these fields read: `format` (1), `id`, `profile`, `title`,
`description` (≤ 400 characters), `size` `[w, h]`, `data`, `requires: {kinds: ["family.name@major.minor"]}`,
`layers: {ID → {writer, title, order, role?, locked?}}`, `items: {ID → Item}`, `channels: {ID → {target: path}}`
and `bound_values: {ID → {target: path, source: handle}}`. An envelope key outside the design's list is
`unknown_field` at its path. An item is `{id, kind, layer, parent?, name, role?, params, at?, visible?,
pickable?, order}` with the design's defaults; `id` equals its key; `layer` names a layer; `parent` names an
item (`ref_unresolved` at `items/<id>/parent`, `actual` the text, otherwise); `at.pos`, `rot`, `scale`,
`pivot` are three f32s. A channel's `target` must parse (`bad_path` at `channels/<id>/target`) and resolve;
a bound value's `source` must parse as a handle (`bad_handle` at `bound_values/<id>/source`). A param may be
a number (in the field's unit) or a unit literal string, which the check converts, or refuses with
`bad_unit` at the param's path listing the field's `forms`.

The test kind `test.slab`, which the binary registers at major 3, minor 1:

| Major | Params (`type, unit, default, min, max`) | Migration into it |
|---|---|---|
| `test.slab@1` | `w: f32, m, 10, 0, 1000`; `h: f32, m, 10, 0, 1000`; `label: string, ""` | — |
| `test.slab@2` | `width` (was `w`), `h`, `label`, same ranges | from 1: rename `w` → `width` |
| `test.slab@3` | `width`, `height` (was `h`), `label`; minor 1 adds `corner: f32, m, 0, 0, 100` | from 2: rename `h` → `height` |

Outside min and max is `out_of_range` (an error) at the @3 path. A field the kind's version doesn't define is
`unknown_field` at `items/<id>/params/<field>`, unless `requires.kinds` names the kind at a minor above the
build's (such as `test.slab@3.2`), when it's dropped from the lowered form with a notice. A kind the build
doesn't know (`test.cube@1`) is skipped with the notice `unknown_kind` and the rest draws; a known kind at a
major above the build's (`test.slab@4`) is `kind_too_new` (an error) at `items/<id>/kind`. A document saved at
`test.slab@1` migrates 1 → 2 → 3 with one `migrated` notice per step, and only the lowered form is checked.

### The lint script

`node scripts/canvas-lint.mjs --root <workspace dir>` lints the workspace at `<workspace dir>` (its
`Cargo.toml`; nothing from the repo's own tree is in scope then). Its scope is every workspace crate whose
name starts with the canvas prefix `deep-canvas`, plus every workspace crate in the dependency closure of a
crate whose `Cargo.toml` says `[package.metadata.deep] check_kinds = [...]` with at least one entry (it
registers a check kind), computed from `cargo metadata`. It prints one line per finding of the form
`FAIL <text> <file>:<line>[:<column>] <text>` (any text around, but the token `<file>:<line>` with the file
relative to the workspace root, such as `reader-planted/src/lib.rs:17`) and exits non-zero on any finding;
with no finding it exits 0 and prints no `FAIL` line. A compile error in a scope crate is not a finding (the
planted workspaces compile).

The planted workspace `lint.test.ts` builds under the OS temp folder: `deep-canvas-planted` (the prefix)
and `reader-planted` (`check_kinds = ["planted.read"]`), each with one `src/lib.rs` holding the seven forms
once each, on these marked lines:

```rust
use glam::Vec4 as V;                                        // glam-rename   (line 2)
let a = x.sin();                                            // method-sin    (line 15)
let b = f64::sin(x);                                        // path-sin      (line 16)
let c = v.powi(3);                                          // powi          (line 17)
let started = std::time::Instant::now();                    // instant-now   (line 18)
let draw = rand::thread_rng().next_u64();                   // thread-rng    (line 19)
let out: Vec<f64> = m.values().copied().collect();          // hashmap-iter  (line 20; m: &HashMap<u32, f64>)
```

Both crates depend on `glam` and `rand` as path crates `stubs/glam` (a `pub struct Vec4`) and `stubs/rand`
(`thread_rng() -> ThreadRng` with `next_u64`), excluded from the workspace members. Why stubs: `glam` is not
in the repo's `Cargo.lock`, and resolving `rand` from the registry in a throwaway workspace needs the index
cache, so with stubs the workspace resolves and builds offline, deterministically, and the lint must catch
`glam::Vec4` and `rand::thread_rng` by path, whichever crate provides them (the design's lint is a path and
method lint, not a version check). The stubs are not workspace members, so a lint that lists third-party
crates with equivalence classes finds nothing to list here; this test does not cover that listing, and a
lint that fails the twins for the stubs being unlisted fails this test. The clean twins keep the same shape
with `x * x`, `f64::max(x, P)` (with `use core::f64::consts::PI as P;`, a renamed import that is not glam),
`v * v * v`, `Duration::from_secs(1)`, a seeded LCG and a `BTreeMap`; a lint that flags any of those is wrong.

## Fixtures

All under `fixtures/`, written by this job before any canonicalizer or converter ran:

- `doc-five.json`: the five-item document as an agent might write it: defaults spelled out, `title`
  `"Café sign"` decomposed (`e` + U+0301), a label `"ünï"` decomposed, items and keys in authoring order.
  Items `base`, `cap-1`, `post`, `sign`, `z9`, all `test.slab@3` in layer `main` (writer `agent-a`); one with
  `at`, one with a parent, one not pickable, one not visible, one with `params: {}`; `data` with f64 numbers.
- `doc-five.canonical.json`: `{bytes, sha256}`, the canonical text and its SHA-256
  (`1cee12f8…445d`), computed by this job's own canonicalizer (a scratch script, not in the repo) from the
  rules above, the hash with `node:crypto`. The text is NFC, has no whitespace, drops every default, and
  writes `0.1`, `33.3`, `2.25`, `0.75`, `120.5`, `640`, `1000`, `2.5`.
- `doc-five.permuted.json`: every object's keys reversed, maps reordered, `640.0`, `120.50` and
  `0.1000000015` (the same f32 as `0.1`) spelled differently. Same bytes, same hash.
- `histories.json`: `{start, writer, histories: {A, B}}`. `start` is the envelope with no items. A creates
  the five items in one patch. B creates `base` with a width, `sign` with `rot [0,0,0]` and a throwaway
  `tmp`, then (patch 2) creates `post` with an explicit default, unsets base's width, creates `cap-1` and
  sets its `corner` and sign's `items/sign/at/rot/2` to 45, then (patch 3) deletes `tmp` and creates `z9`
  with a decomposed label. Both end at the fixture's hash.
- `corpus-slab1.json`: `{doc, saved_at: "test.slab@1", expect}`: the corpus document with `params: {w: 20,
  h: 7, label: "one"}` and the values recorded for it at @3: `{width: 20, height: 7, label: "one"}`.
- `corpus-slab1-wide.json`: the same with `w: 5000` (past `width`'s max of 1000).
- `broken-ref.json` (`sign.parent = "ghost"`), `unknown-field.json` (`glow` on `test.slab@3`),
  `unknown-kind.json` (`test.cube@1` beside a slab), `newer-major.json` (`test.slab@4`),
  `unit-mismatch.json` (`width: "45deg"`), `unit-converts.json` (`width: "300 mm"`, `height: "2.5m"`).
- `colors.json`: 24 sRGB samples (black, white, three near-black, greys, the six primaries and secondaries,
  mixed colors, two tiny steps, and four hue-wrap samples within a degree of the 0/360 seam) with their
  linear, OKLab and OKLCh values from `palette` 0.7.7 (`Srgb<f64>` → `LinSrgb<f64>` → `Oklab<f64>` →
  `Oklch<f64>`, hue by `into_positive_degrees()`) and from `bevy_color` 0.20.0 (`Srgba` → `LinearRgba` →
  `Oklaba` → `Oklcha`, f32), printed by a one-off scratch crate outside the repo that depends on both at
  those pinned versions; `source` records this. bevy_color computes in f32: its linear, OKLab, L and C values
  sit within 1.8e-7 of palette's f64 values on these samples, but its hue in degrees sits up to 4.6e-5° off,
  so the bevy hue is held to 1e-6 of a turn (3.6e-4°) and everything else, both references, to 1e-6.

## Criteria to tests

Each test's name starts with its ID. Where a criterion names a wrong program, a comment at the assertion
that catches it says so, and the assertion's message names what the criterion asks for.

| ID | Criterion (short) | Tests, and how a failure names it |
|---|---|---|
| AC1 | a broken reference is refused; the agent gets the issue by ID | `document.test.ts` AC1: `ref_unresolved` with `ids` `["sign"]`, path `items/sign/parent`, actual `ghost`; a message quotes the issues list |
| AC2 | seven planted forms fail the lint in a canvas crate and a check-reader crate, naming file and line; clean twins pass | `lint.test.ts` AC2: each missing finding is reported as `<form> in <crate>: no FAIL line names <file>:<line>` with the lint's output; the twins' failure quotes the output |
| AC3 | OKLab, OKLCh, sRGB match palette and bevy_color within 1e-6; near-black and hue-wrap; hue modulo 360 above chroma 1e-4 | `color.test.ts` AC3: each component's message names the reference, sample, space and index; the inverse and seam tests |
| AC4 | 10,000 seeded mutations per grammar: no panic, a code on every refusal, a refusal changes nothing | `grammar.test.ts` AC4: one process per grammar over 10,000 mutations with a sentinel valid input every 100 lines whose answer must not change; messages name the grammar and the input; 100 refused paths as `set` ops leave the revision hash at the fixture's |
| AC5 | `unknown_field` unless a newer minor is required (then a notice); `unknown_kind` skips while the rest draws; `kind_too_new` | `document.test.ts` AC5 (four tests), each naming the code and path it expects |
| AC6 | a non-converting unit fails naming the field and the forms, printed by the printer; `"45deg"` lists only length units | `document.test.ts` AC6: `bad_unit` at `items/slab/params/width`; `forms` must be non-empty (a check naming the field alone fails there), equal to exactly the `m` family, and each form must parse and print back as itself; `"300 mm"` reads as 0.3 |
| AC7 | one path grammar for patches, channels and bound values; an ID with `/` is refused | `grammar.test.ts` AC7: parses, a `set` through `at/rot/1`, `bad_path` on four non-grammar paths, a channel and a bound value at their paths, `bad_id` on `sign/post`, a create with `a/b`, and a 200-case fast-check property (seed in the file) splicing `/` into valid IDs |
| AC8 | 10,000 seeded valid paths, handles, IDs, time and unit literals parse, print back and resolve to the rational reference; `"195f"` at 30 fps = 4,586,400,000 | `grammar.test.ts` AC8: per grammar, the first failures are reported as `<grammar>: refused the valid input …`, `… printed back as …` or `… resolved to …, the reference gives …`; a planted parser that refuses everything fails here with the grammar's name first, while passing AC4 |
| AC9 | canonical bytes and SHA-256 of a five-item document, written first; two histories and a permuted file give one hash; a 17-digit canonicalizer fails naming the field | `canonical.test.ts` AC9: `expectCanonical` compares number tokens by text and names the first differing field (`/items/sign/params/height`, `/data/ratio`, …), so 17 digits fail even where the value reads back equal; the fixture's own hash, the permuted file, 50 seeded permutations, histories A and B, and a fixed point |
| AC10 | a `test.slab@1` corpus document opens at major 3 through @2 with one `migrated` notice per step and the recorded values; a build with only 2→3 fails naming the kind | `migration.test.ts` AC10: the refusal message starts `test.slab: …`; notices must be `[[1,2],[2,3]]` for kind `test.slab`; lowered params equal the recorded values; the ID is unchanged |
| AC11 | the check reads only the lowered form: `w` past max raises `out_of_range` at `items/<id>/params/width`; a check reading saved @1 bytes fails naming the check and the path | `migration.test.ts` AC11: messages start `document.validate: …` and name `items/slab/params/width`; `check` must be `document.validate`; no issue may name `params/w` |

## Readings where the issue and design leave a choice

- **The surface** is a CLI over JSON lines, like #311's, because the issue names no API. `check` returns
  the lowered document and the draw list so that "skipped", "draws" and "reads only the lowered form" are
  observable without a renderer.
- **Defaults left out** is read for every field with a declared default, not only params, so two
  histories that spell defaults differently reach one hash; the always-written fields are listed above.
- **Floats** are written without exponent; the fixtures hold no value that would need one.
- **Time literals** are limited to seconds (≤ 5 fraction digits, always a whole flick count) and frames,
  the two forms that resolve with only a frame rate. Marker, bar and narration forms need a document and
  are not generated or mutated; a mutation never produces them.
- **The unit grammar** accepts an optional single space (`"300 mm"`) and prints none. `fw`/`fh` and
  `1/300fw` need a frame size and are out of this slice; a mutation never produces them. `rad` is refused
  for a `deg` field since the factor is irrational.
- **Handles** take an upper-case ULID or a lower-case 64-hex hash; lower-case ULIDs and upper-case hex are
  outside the grammar. The tests never ask a handle to resolve.
- **`forms`** are literals the printer wrote (`1m`, …) rather than unit names, so the printer is exercised.
- **`test.slab`'s params are in meters**, so the length family has four units and `"45deg"` has something to
  be listed against.
- **The lint's scope marker** is `[package.metadata.deep] check_kinds = [...]`, and the canvas prefix is a
  crate-name prefix `deep-canvas`; a stub `glam` and `rand` stand in for the real crates (above).
- **bevy_color's hue** is f32; see the fixture note. Everything else is held to 1e-6 against both.

## The Oracle lane

Three of the eleven criteria are also checked by other projects' tests pinned by commit in the private
`doneright/oracles` repo (`oracles/issues/389.md`), which this job can't reach, and a linked test counts
only when run against our output (#136). That lane is **BLOCKED** here with one unblock ask: give the
runner read access to `DeepBuildAI/deepbuild` at branch `doneright`, path `doneright/oracles/issues/389.md`,
and the runner of #136. These tests are the local proof for every criterion; they don't stand in for that
lane.

## A note on this draft's inputs

While this draft was being written, another session began an implementation in the same worktree (an
untracked `crates/deep-canvas/`, `scripts/canvas-lint.mjs` and `scripts/canvas-lint/`, with edits to
`Cargo.toml`, `Cargo.lock`, `scripts/lanes.mjs` and `scripts/repo-rules.json`). The surface, fixtures and
tests here were written before that appeared; a first run of the suite, meant to be the base run, hit that
script, and this job then read the header comment of `scripts/canvas-lint.mjs` (its scope marker is
`registers = ["check"]`, not this README's `check_kinds`) before noticing. Nothing here was changed on it.
`BASE-FAILURE.txt` was then produced against a read-only `git archive` of the base commit, where neither
exists. The implementing agent builds to this README's surface, the marker included.
