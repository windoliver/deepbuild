# Acceptance tests for #162, Oracle lane: the Lottie spec's tests and examples, and the upstream renderer's corpus, run on our output

Written first, blind, from issue #162 (`gh issue view 162 --repo windoliver/deepbuild`), its oracle map
(`doneright/oracles/issues/162.md` on branch `doneright` of `DeepBuildAI/deepbuild`), the upstream files that map pins
(read from that branch's `doneright/oracles/vendor/`, each checked against the upstream blob at its commit), the #162
suite's surface (`tests/acceptance/162/README.md`, written by the same job) and base commit `53c0e72a3`, by a job that
never saw an implementation of #162; none existed, and no other worktree, branch or PR was read. #136's rule applies:
a linked test counts only when run against our output, so every upstream file here is either read against what
`deep-show run`'s `export` writes, or imported by our import job and its document read back. The implementing agent
doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

Scope: criteria 1, 3 and 5, the three the oracle map links an upstream test or upstream test data to. Their parts the
map calls ours (the stricter type walk, the round trip at 100 times, the sampled keys, colours mapped to roles, the
derived luma matte and trim) are tested here too, beside the upstream reading, so each criterion has one home.

## Sources

| Criterion | Upstream, pinned | Files (vendor/) | Use | Licence |
|---|---|---|---|---|
| 1 | lottie/lottie-spec `4b55957472f8718e34e9c1298f0e8f021b6c597f` | `tests/validate_animations.test.js`, `schema/`, `tests/animations/valid/`, `tests/animations/invalid/`, `docs/static/examples/` | port; run on our code | MIT (code), CSL 1.0 (spec) |
| 3 | the same | `docs/static/examples/` (the 20 examples) | test data run through our import | the same |
| 5 | the upstream renderer (vendor/NOTICE.md) `bede03d25d232826e0c9dca1733d542d8a7754fb` | `test/animations/adrock.json`, `banner.json`, `lights.json` | test data run through our import | MIT |
| 5 | lottie-spec, as above | `docs/static/examples/trim_path.json`, `matte.json` | derived at run time (the corpus has no luma matte and no trim without m) | as above |

Not ported: the upstream renderer's frame-by-frame renders of its corpus (`test/index.js`), since the reference renderer
of the fidelity check is the implementer's choice (criterion 11 reads it through the export's receipt); the corpus's
other eight files, which hold nothing these criteria need that the three copied don't.

## Run them

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH"
npm ci
npm run build --workspaces
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
scripts/lease cargo build --locked -p deep-hook
node node_modules/vitest/vitest.mjs run --root tests/acceptance/162-oracle schema.test.ts --testTimeout=600000      # AC1 (schema, types)
node node_modules/vitest/vitest.mjs run --root tests/acceptance/162-oracle roundtrip.test.ts --testTimeout=600000   # AC1 (round trip, sampled keys; a hub)
node node_modules/vitest/vitest.mjs run --root tests/acceptance/162-oracle examples.test.ts --testTimeout=600000    # AC3 (a hub)
node node_modules/vitest/vitest.mjs run --root tests/acceptance/162-oracle corpus.test.ts --testTimeout=600000      # AC5 (a hub)
node node_modules/typescript/bin/tsc -p tests/acceptance/162-oracle/tsconfig.json                                 # type-check (exits 0)
```

Run one file at a time: the vendored upstream test keeps its name, `validate_animations.test.js`, so a run of the whole
folder would collect it (vendor/NOTICE.md). Each file builds `deep-show` (`full`) once through the #162 suite's helpers;
the hub files start #1922's world. Every `it` passes a 3,600,000 ms timeout. Temp folders are removed after each test or
file; no process is stopped by name or port. Delete `tests/acceptance/162-oracle/node_modules/.vite` after a `--root`
run. `scripts/lanes.mjs` needs `alone.push('tests/acceptance/162-oracle/')` (in the #162 README's line).

The schema validation needs a JSON Schema 2020-12 validator; the base has one in `node_modules` (a dependency of the
repo's dev tools, and the same validator the upstream test requires), so no dependency is added. Without `node_modules`
the test fails `BLOCKED: … Unblock: npm ci`.

## Criteria to tests

| AC | ID | File | Tests |
|---|---|---|---|
| 1 | `#162.ba90a515` | schema.test.ts | 1: the port gives the upstream verdict on the spec's 20 examples, 9 valid and 3 invalid files first; the title and its eased twin, as exported, validate against the merged 1.0.1 schema and hold no layer type outside 0–4 and no shape type outside those the schema's parts define. Planted: the title's file with its first layer's `ip` removed fails the schema; with an `rp` shape or a `ty: 5` layer added fails the walk, naming it |
| 1 | `#162.ba90a515` | roundtrip.test.ts | 2: imported back (the import job, a real hub), the curve's position and trim (start, end) and the tiles' position and turn equal the title's at 100 seeded times within 1e-4; planted: the imported values read one export frame late fail. The eased title's trim end and turn are keyed at every export frame of their segments (0–36, 0–47), linear, within 1e-4 of `eval` at every export frame, and listed as `sampled` warnings on `line` (ease) and `tiles` (spring); planted: the same keys held to the Bézier title's evaluation fail |
| 3 | `#162.6dd976de` | examples.test.ts | 1: each of the 20 examples imports and is presented with no issue of severity error; each literal colour it writes is within one code value of a role of its generated look, and its document's items and channels write no hex colour; each layer with an expression has an issue naming it. Planted: fill.json recoloured #123456 fails the colour judge naming #123456; fill.json with an expression on its layer's opacity comes back with an issue naming the layer, and the plain file's report fails against it, naming the layer; an imported document with an item parented to one it doesn't hold isn't presented clean |
| 5 | `#162.f8f7c065` | corpus.test.ts | 1: banner.json's root layer `bg_avion Outlines 2 Comp 1` imports with a follow_path constraint and its evaluated position stays within 0.1 u of the arc-length position at 100 seeded times between its keys (frames 70 and 341 at 25 fps); trim_path.json without `m` imports with each true; every merge path (adrock.json's 15 layers, banner.json's one), every text layer (banner.json's 11) and every expression (lights.json's 7 layers) comes back as an issue naming its layer and saying merge, text or expression; matte.json with its matte made luma (tt 3) imports a luma matte with `luma: encoded`. Planted: the positions held to the curve by parameter fail (the paths are up to 147 u apart); the trim with m 2 fails "each true"; matte.json's alpha matte fails "luma: encoded"; lights.json with `orange` renamed fails the plain file's expectations, naming orange |

## The surface under test

Exactly the #162 suite's (`tests/acceptance/162/README.md`: The surface under test), with these parts read here:

- **Validation** is the upstream test's: the spec's `schema/` parts merged as its build merges them (root.json, every
  part under `$defs.<folder>.<name>` without its own `$schema`, and the unknown shape and layer types' `not.enum` filled
  with every `ty` the other parts define, which leaves Lottie 1.0.1's layer types 0–4 and shape types el, fl, gf, gs,
  gr, sh, sr, pb, rc, rd, st, tr and tm), compiled by a JSON Schema 2020-12 validator with the keyword `$version`.
- **"No type Lottie 1.0.1 doesn't define"** is the walk over every layer of the root and of each precomposition, and
  every shape in them and their groups, against those lists; the schema itself lets any other type through.
- **"Every literal color"** is each colour the file writes: fills' and strokes' `c` (static, or each key's `s` and
  `e`), gradient fills' and strokes' colour stops, and solid layers' `sc`; "mapped to a role" is a role of the
  generated look (`palette` and `roles`, read by hash from the hub's store) within one code value.
- **"An issue naming its layer"**: an entry of the report's `issues` one of whose fields is the layer's `nm` and whose
  JSON says merge, text or expression.
- **"Imports as follow_path"**: an object of the imported document of kind `follow_path` (or keyed `follow_path`) that
  names the item, or one in the item; its position is `eval`'s `at/pos`, with the layer's anchor read as the item's
  pivot or folded into its position, whichever the first time fits. The arc-length position: the key's time easing
  (`o`, `i`) gives the fraction of the segment, taken by arc length along the cubic its `to` and `ti` make (this suite's
  Gauss–Legendre arc length, 64 panels, and bisection).
- **"Each true"**: every trim op in the imported document's items has `each: true`. **"luma: encoded"**: every object of
  the document whose `mode` is `luma` or `luma_inverted` has `luma: "encoded"`, and there is one.

## Planted mismatches

Each comparison runs once more on a mismatch planted here, and must fail on it (none is a program the implementer
builds):

| Comparison | The planted mismatch | Criterion | It must fail naming |
|---|---|---|---|
| the schema | our title's file with its first layer's `ip` removed | 1 | (invalid) |
| the type walk | our title's file with a repeater shape `rp`, or a text layer `ty: 5`, added | 1 | `rp`; type 5 |
| the round trip | the imported values one export frame late | 1 | a time and a path |
| the sampled keys | the eased file's keys held to the Bézier title's evaluation | 1 | a frame |
| the colours | fill.json recoloured #123456, against its own import | 3 | `#123456` |
| the expressions | the plain fill.json's report, against fill.json with an expression added | 3 | the layer |
| the document check | an imported document with an item parented to an item it doesn't hold | 3 | (not presented clean) |
| follow path | the positions held to the curve by parameter | 5 | a time |
| each true | trim_path.json with `m: 2` | 5 | (each false) |
| luma: encoded | matte.json's own alpha matte | 5 | (no luma matte) |
| the issues | lights.json with `orange` renamed, against the plain file's expectations | 5 | `orange` |

## Readings where the issue and the map leave a choice

- **"Validates against its schema"** is the upstream test's own validation (the same validator and keyword), whose
  verdict on upstream's own files is checked first, so a wrong merge fails the harness rather than passing our file.
- **The 20 examples** are the files the spec's `docs/static/examples` holds at the pin (20 at `4b55957472`); none
  carries an expression, so the expression part of criterion 3 is held by the planted fill.json with one.
- **"At 100 random times"** (AC5): seeded, between the layer's two keys, where its position moves.

`BASE-FAILURE.txt` states where each test fails at the base.
