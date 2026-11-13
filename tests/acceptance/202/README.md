# Acceptance tests for #202: pack kinds, kind rules and the kind kit

Written first, from issue #202 ("Pack kinds: kinds backed by recipes in any pack, with kind rules and a kind kit whose
planted twins must fail": its Scope, its Fields, its ten acceptance criteria and its Proof line), the design sections it
links and those they lean on, and base commit `a04378eb2` ("Merge pull request #2190 …"), by a job that never saw an
implementation; none existed, and no other worktree, branch or pull request was read. The implementing agent doesn't
edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). Lean: one test
per criterion, plus one per planted program a criterion names. The issue says no upstream test checks these criteria.

## What was read

- The issue, live with `gh issue view 202`.
- `docs/canvas-primitives.md`: Item and kind; Registry and seal; Registry and seal: registries; Recipe; Pack; Pack:
  kinds in any pack; Pack: kind rules and the kind kit; Pack: migrations as data (to leave it out); Control sweep; Phase
  (the frame phases); the budget class table; What holds a document to its rules and Check input (`kind_rules` is a core
  check kind).
- `docs/technical-design.md`: Item and kind; Add anything; Criteria to tests, both ways; Criteria in a checked shape;
  Wrong programs; Dogfooding.
- At the base, for how the surfaces are driven: AGENTS.md; `crates/deep-show/src/packs.rs` (the folder loader and its
  asset hash check), `crates/deep-canvas/src/document/packs.rs` (the pack check, `PACK_KEYS`, a recipe's `rules` and
  inline `twins`, the `kind_rule` issue), `crates/deep-canvas/src/document/mod.rs` (an issue's JSON names the rule's
  code), `crates/deep-show/src/kinds.rs` (`deep_kinds` op list, the kind@1 row, `module_set`), `verdict.rs`, `frames.rs`
  (`registry`, `eval`), `hub.rs` (`set_digest` on every reply), `main.rs` (scenario fields, `planted`),
  `crates/deep-canvas/src/cost.rs` (the cost model's per-kind CPU a module registers); the suites `306/`, `490/`,
  `200/`, `403/`, `405/` and `1653/` (README, helpers, conventions). Every expected value comes from the issue.

## What the base already does, and these tests don't credit

#306's pack format, its loader (assets hash-checked by `sha256` and `size`), recipe expansion with `expansions` rows,
`out_of_range` and `unknown_field` on a recipe instance's params, `install_pack` with `session`, `packs`, and
`timing.check_ms`; #490's recipe-level `rules` at rest with inline `twins: [{params, expect}]`, the issue named by the
rule's code; #200's `registries`, `deep_kinds` and approval asks; #403's claims and `verdict`. The base refuses a pack
with `kinds` as `unknown_field` at the path `kinds`; it has no pack kind, no kind kit, no `kind_rules` requirement (a
requirement of that kind is BLOCKED `not_run`), no pack kind in `deep_kinds`, and none of this suite's planted names or
test feature.

## Run them

They build `deep-show` per Cargo feature set and the budgets time it, so the folder runs alone: `scripts/lanes.mjs`
needs `'tests/acceptance/202/'` in its `alone` list and `'tests/acceptance/202/budgets.test.ts'` in its `timed` list.
This README is the instruction; the implementer makes that edit.

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/202 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/202/tsconfig.json
```

Each file builds the feature sets it lists once (`cargo build --locked --bin deep-show --no-default-features --features
r1` or `r1,test-weight`, honoring `CARGO_TARGET_DIR`, with `CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` unless
set), copies the binary to a temporary folder and fails each test whose build failed. `budgets.test.ts` also builds the
merge base (`git merge-base HEAD origin/main`, exported with `git archive` into `target/acceptance-202-base/<sha>/`,
built there with its own target folder, kept so later runs build warm). Every temporary folder is deleted. Node
built-ins and vitest only.

`budgets.test.ts`'s first test times on a reference Mac only (Mac15,7 or Mac15,12, Low Power Mode off, thermal state
nominal, a 1-minute load at most the core count; mains power never gates), after its structure passed; elsewhere it
skips as `INCONCLUSIVE (reading only): …`, and a reading between the limit and the margin skips as INCONCLUSIVE too;
it never passes by skipping. Its second test is a structure and runs everywhere. Everything runs headless on the CPU.

## The surface under test

`deep-show run`, one scenario JSON line on stdin, one reply per call, as #306, #200 and #403 left it: the scenario's
`packs: [{id, dir}]`, `claims` and `planted`; the calls `install_pack` (with `session` for a pack the working agent
wrote), `packs`, `deep show` (from your shell, `peer`) and `deep_show` (from the agent's session) with `include:
["issues"]` and `"timing"`, `deep_kinds` (`op: "list", registry: "kind@1"`, paged by `next`/`cursor`), `registry`,
`eval` and `verdict`. **Every name below that the issue doesn't give is this job's invention**, the smallest surface
consistent with the design and the base; the implementer builds exactly these, or a dispute goes to a blind redraft.

### The pack format (fixtures/packs)

- **`kinds`**, on the pack, exactly as the Fields line spells it: `{<pack>.<name>@<major> → {minor, recipe, children,
  capabilities: {pickable, snap}, rules, migrate, examples: [sha256], cost: {class, at_defaults: {cpu_ms, gpu_ms,
  items}}}}`.
- **New: `twins: [{example: sha256, expect: code}]` on a kind**: the planted twins, one or more per rule. The design
  names the shape ("Planted twin, one per rule: `{example: sha256, expect: code}`") but no field; the issue's last
  scope bullet extends the recipe-level `twins` to "twins as examples by hash", so the key is `twins`, on the kind
  beside its `rules`.
- **New: `recipe`'s value is the key of the pack's `recipes` it names** (`"shelf.bookcase@1"`); a kind and its recipe
  share that name in every fixture.
- `rules: [{code: "<pack>.<rule>", expr, at: "rest" | ["0s", "1s", …], fix}]`: `at` as a list of times in the time
  grammar (the bench pack's ten times `0s` … `9s`).
- **An example** is an asset of the pack, listed in `assets: [{path, sha256, size, license}]` (the loader checks each
  hash), its bytes a board document holding one item `x1` of the kind and naming the pack in `packs`, as the base's
  generated kind examples are. `examples` lists the clean ones; `twins` names the planted ones by hash.
- `cost.class` is a budget class name (`figure`); `migrate: {}` for a kind at major 1.

### The test canvas module (`deep-show` Cargo feature `test-weight`, never in a shipped build)

**New:** `test-weight` adds the test canvas module `test.weight` (in `crates/deep-canvas-test-modules`, as #200's and
#403's test modules are) registering one item kind, `test.weight@1`: no params, drawn as an 8 × 8 box with no pass of
its own, and costed through the registrar's per-kind CPU (the cost model's "CPU each module's kinds register per item")
at **0.20 ms of CPU per item**. It gives criterion 4 an expansion the check estimates at 0.20 ms, and criterion 9 a kind
whose cost grows with levels². Nothing else.

### Replies read

- **A refused pack** (`packs` row or `install_pack` reply): `state`/`outcome` `refused` and an error issue (severity
  `error`; not `unknown_field` at the path `kinds`, the base's refusal of the whole field, whose `actual` holds every
  name in it) whose JSON names what the criterion says; for criterion 4 its `code` is `cost_understated`. An installed
  pack is `installed`.
- **A kind rule's issue** on a document: #490's, its `code` the rule's code, `ids: [instance]`, `fix` the rule's fix.
- **`expansions`** (#306): `{instance, kind, pack, derived}`; a pack kind's instance has `kind` the pack kind.
- **`deep_kinds` op list, kind@1** — new fields on a pack kind's entry:
  - `name` (`shelf.bookcase@1`), `schema` (each input's `min`/`max`/`default`, in the recipe's spelling or JSON
    Schema's `minimum`/`maximum`/`default` under `properties`: both are read), `example` (a sha256 of one of the kind's
    `examples`);
  - `kit`: #200's one KitResult shape, `{verdict, rules: [{rule, verdict}]}`, its rules being the kit's parts
    `defaults`, `determinism`, `cost`, `rules`, `migration` (the design's kit fields; `migration` isn't read), plus
    **new** `examples: [{example: sha256, raised: [code]}]` (each clean example and the rule codes it raised, none for a
    pass) and `twins: [{example: sha256, expect: code, raised: [code]}]`;
  - `cost: {class, at_defaults: {cpu_ms, gpu_ms, items}, at_extremes: {items, triangles}}` (`at_extremes` as the
    issue names it: the largest item and triangle counts over the hard-range ends and seeds).
  - The listing header's `module_set` is the module-set digest (as at the base).
- **`registry`**: `state`, `seal.runs`, `operators` with their `phase`, and the `set_digest` every reply carries.
- **`eval`**: `nodes` with `operator`, `phase`, `item`.
- **New: `timing.kind_rules_ms`** on a `deep show` reply with `include: ["timing"]`, beside #306's `check_ms`: the wall
  time of the core's `kind_rules` check over the document, as the binary measured it.
- **`verdict`** (#403, #200): `result`; `requirements: [{id, result, issues, asks?}]`; `asks: [{kind: "approval",
  requirement, …}]`. **New: a requirement's check input `{kind: "kind_rules"}`** runs the core's `kind_rules` check on
  the deliverables; on a board whose only pack kind is shelf.bookcase@1 its only cover is shelf.span.

### `planted` values (scenario field; new, each reachable only there)

| Value | Criterion | The wrong program |
|---|---|---|
| `expander_hash_map_order` | 4 | the expander walks a kind's inputs in hash-map order, so an example expands to different bytes twice |
| `counts_agent_rule_as_cover` | 5 | the resolver counts a rule from a pack the working agent wrote as a requirement's cover |
| `kit_tests_defaults_only` | 9 | the kind kit expands each example at its defaults only, never at the hard-range ends or seeds |
| `recipe_rules_twice` | 10 | the check evaluates a pack kind's recipe-level rules a second time for the kind |

## Fixtures (`fixtures/packs/`)

| Folder | Pack | What it holds |
|---|---|---|
| `shelf-1.0.0` | `acme/shelf@1.0.0` | recipe and kind `shelf.bookcase@1`: inputs width (number, m, 0.4–3.0, default 1.2), levels (integer, 1–8, default 4), dividers (integer, 0–3, default 1); steps `sides` (2), `boards` (levels), `dividers` (dividers), each a `rect@1`, a front view at 100 u a metre; rule `shelf.span` `width <= 0.9 * (dividers + 1)` at rest; examples {} and {width 1.79, dividers 1}; twins {width 2.0, dividers 1} and {width 1.81, dividers 1}, each expecting shelf.span; cost figure, {cpu_ms 0.5, gpu_ms 0.2, items 7} |
| `shelf-1.0.0-rule-100` | `acme/shelf@1.0.0` | planted: shelf.span written `width <= 100`, every other file the same |
| `shelf-1.0.0-rule-095` | `acme/shelf@1.0.0` | planted: shelf.span written `width <= 0.95 * (dividers + 1)` |
| `shelf-1.0.0-recipe-only` | `acme/shelf@1.0.0` | the same recipe with shelf.span as a recipe-level rule and its inline twin, no `kinds`: what the merge base installs, for the budgets |
| `shelf-1.0.1-builder` | `acme/shelf@1.0.1` | planted: kind `shelf.panel@1` declaring `builder: "slab"` |
| `shelf-1.0.2-arrays` | `acme/shelf@1.0.2` | planted: kind `shelf.grid@1` declaring `arrays` |
| `shelf-1.0.3-slab` | `acme/shelf@1.0.3` | planted: a kind named `slab@1` |
| `shelf-1.0.4-puppet` | `acme/shelf@1.0.4` | planted: a kind named `puppet.rig@1` |
| `costly-1.0.0` | `acme/costly@1.0.0` | planted: `costly.unit@1` expands into one `test.weight@1` (0.20 ms) and declares cpu_ms 0.10 |
| `tower-1.0.0` | `acme/tower@1.0.0` | planted: `tower.stack@1`, levels 1–8 default 2, expands into levels² `test.weight@1` items (0.8 ms at its defaults, declared 0.9; 12.8 ms at levels 8, over figure's 4 ms) |
| `rack-1.0.0` | `acme/rack@1.0.0` | kind `rack.unit@1` (the shelf recipe) with kind rule `rack.span`, its recipe carrying the recipe-level rule `rack.levels` `levels <= 6` |

The 20-kind bench pack `acme/bench@1.0.0` is written at test time by `writeBench`: kinds `bench.k01@1` …
`bench.k20@1`, each the shelf recipe with four rules at ten times (`bench.kNN_span`, `_levels`, `_dividers`, `_width`)
and a planted twin per rule. Pack IDs carry an outside owner (`acme/…`) as `PackId::parse` needs; the issue's
`shelf@1.0.0` is `acme/shelf@1.0.0`.

## Criteria to tests

Each test's name starts with its criterion's ID, `#202.` and the first eight hex digits of the SHA-256 of the
criterion's text, trimmed and white space collapsed (`scripts/proof-change.mjs`, `criterionId`, on the live issue
body). Each file's head quotes its criterion and says what it asserts. Where a criterion names a planted program,
its own test runs it and asserts the criterion's check fails, naming what the criterion says; a planted pack is input
the right program must refuse, asserted in the criterion's test.

| # | ID | Test | Wrong program it fails on |
|---|---|---|---|
| 1 | `#202.5ad3e3f5` | `kind.test.ts` (1) | the merge base (shelf refused for `kinds`) |
| 2 | `#202.84e9c56a` | `refusals.test.ts` (1) | the merge base; a pack check admitting any of the four planted shelf versions |
| 3 | `#202.9f697217` | `rules.test.ts` (1) | the planted rule `width <= 100` (`shelf-1.0.0-rule-100`); the merge base |
| 4 | `#202.ee304566` | `cost.test.ts` (2) | `expander_hash_map_order`; the cost kind `costly-1.0.0`; the merge base (no `test-weight`) |
| 5 | `#202.4661a547` | `binding.test.ts` (2) | `counts_agent_rule_as_cover`; the merge base (`kind_rules` BLOCKED) |
| 6 | `#202.ed799b46` | `budgets.test.ts` (2) | the merge base (shelf refused; no `timing.kind_rules_ms`) |
| 7 | `#202.e054c7a0` | `resolve.test.ts` (1) | the merge base |
| 8 | `#202.22a0fc71` | `boundary.test.ts` (1) | the planted rule `width <= 0.95 * (dividers + 1)` (`shelf-1.0.0-rule-095`); the merge base |
| 9 | `#202.b0fcc31e` | `extremes.test.ts` (2) | `kit_tests_defaults_only`; the levels² kind `tower-1.0.0`; the merge base (no `test-weight`) |
| 10 | `#202.76f0edd8` | `once.test.ts` (2) | `recipe_rules_twice`; the merge base |

`twins.json` maps each criterion that names a planted program to those names (the `planted` values and the planted
fixture folders), as #1653's suite does.

## Readings where the issue leaves a choice

- **"Naming the kind and the field"** (2): one error issue whose JSON holds both (`shelf.panel@1` and `builder`;
  `shelf.grid@1` and `arrays`). "An array" is a kind field `arrays` (the design: "can't declare a builder, a plan,
  insets, arrays or operators"), shaped as Registry and seal's `arrays` entry. **"Naming the kind it would take"** is
  the declared name itself, `slab@1` or `puppet.rig@1`.
- **"The module-set digest"** (2, 7) is `deep_kinds`' `module_set` and the `set_digest` every reply carries; both must
  be equal with shelf installed and without it, and the seal's `runs` stays 1 after a document resolves the kind.
- **"Within 25% of the check's estimate, else cost_understated"** (4) is read as an operator's rule ("as an operator
  does"): the kit refuses a declaration the estimate exceeds by more than 25%; a declaration above the estimate passes.
  The shelf, rack and bench kinds therefore declare a cost at defaults at or above what 7 rects can cost, inside their
  class. The 0.20 ms estimate comes from the test module's per-item CPU; the kind declares 0.10.
- **"Naming the example"** (4) is the refusal naming one of shelf.bookcase@1's example or twin hashes, beside the word
  `determinism`.
- **"The working agent wrote"** (5) is a pack installed through its session (`install_pack` with `session`, #200);
  "an installed pack the agent didn't write" is the same folder installed by the scenario's `packs`. "Sends the claim
  back" is the claim's `result` FAIL with the requirement FAIL holding the shelf.span issue on the failing bookcase.
- **Budgets** (6): "validating an item of a pack kind adds under 1 µs per param" is the check time of 1,000 instances,
  each setting its 3 params, against the merge base's median for the same board through the recipe-only twin, plus
  3 ms; "kind_rules … under 20 ms" is `timing.kind_rules_ms`; "the kind kit of a 20-kind pack" is the wall time of a
  process installing the bench pack less the median of one installing nothing, an upper bound of the kit's time;
  "no work per frame" is the same frame-phase operators (`registry`) and frame-phase `eval` nodes as the merge base,
  for a board of rects with a pack with kinds in the store. As in #306's and #200's suites the binary is the debug
  build these suites build.
- **"Stays in class"** (9) is the kit's `cost` part PASS, and `cost.at_extremes.items` 11 (2 sides, 8 boards, 1
  divider at levels 8, the largest over the ends of every param with the others at each example's values). A kind
  rule isn't part of "valid" at the ends: shelf.span fails at width 3.0 with one divider, and the issue still has
  shelf pass its kit. **"Naming the param, the value and the cost"** is one error naming `levels`, the number 8 and a
  cost of at least 12.8 (64 × 0.20 ms; 64 items or 128 triangles count too).
- **"Each failing rule once per instance"** (10) is exactly one issue of each code naming the instance, for an
  instance that breaks both the kind's rule and its recipe's.

## Not tested, because no criterion asks

Migrations as data and `migrate` beyond `{}`; `children` and `capabilities` beyond being declared; a sweep `at`; rules
over outputs or derived items' values; dirty classes; `geometry.shading` on a mesh (the shelf is 2D); the three seeds
beyond what `at_extremes` reports; `requires.kinds`; a pack the agent wrote binding its own claim when its rule fails;
`deep_kinds` op read on a pack example.

## Upstream tests (the Oracle lane)

The issue says no upstream test checks these criteria (its oracle page), so these tests are their local proof.
