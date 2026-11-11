# Acceptance tests for #1956: pack migrations as data, proved on the pack's corpus

Written first, from issue #1956 ("Pack migrations as data: a pack kind's new major migrates old documents at load,
proved on the pack's corpus": its Scope, its Fields, its four acceptance criteria and its Proof line), the design
sections it links and those they lean on, and base commit `76e7855c0` ("Merge pull request #2255 …"), by a job that
never saw an implementation; none existed, and no other worktree, branch or pull request was read. The implementing
agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).
Lean: one test per criterion, plus one for the planted program criterion 4 names. The issue says no upstream test
checks these criteria.

## What was read

- The issue, live with `gh issue view 1956`; its parent #203 (and the one comment on it) and the siblings #1959,
  #1960 and #1962, only for what is out of scope; its oracle page in `doneright/oracles`.
- `docs/canvas-primitives.md`: Migration; Document envelope; Pack; Pack: kinds in any pack; Pack: kind rules and the
  kind kit; Pack: migrations as data; Pack: dependencies (a document names each pack version); Recipe; The closed
  function list.
- `docs/technical-design.md`: Add anything; Criteria to tests, both ways; Criteria in a checked shape; Wrong programs;
  Dogfooding.
- At the base, for how the surfaces are driven: AGENTS.md; `crates/deep-show/src/main.rs` (scenario fields, `docs.<id>.
  document`, `planted`, the `read` and patch calls), `hub.rs` (`deep show`'s reply with `notices` and `expansions`,
  `install_pack`), `packs.rs` (the folder loader and its asset hash check), `shared.rs` (shared documents, `read`, a
  writer's patch and `store_migrations`); `crates/deep-canvas/src/document/packs.rs` (`PACK_KEYS`, recipes, expansion,
  derived items), `pack_kinds.rs` (the kind kit and its refusal of `migrate`), `check.rs` (`migrate_item` and the
  `migrated` notice), `mod.rs` (an issue's and a notice's JSON), `apply.rs`;
  `packages/contracts/canvas-schemas/pack@1.json`; `scripts/proof-change.mjs` (`criterionId`), `scripts/lanes.mjs`;
  the suite `tests/acceptance/202/` (README, helpers, tests, fixtures), and `389/`, `138/` for the migration notice's
  conventions. Every expected value comes from the issue.

## What the base already does, and these tests don't credit

#306's pack loader (assets hash-checked by `sha256` and `size`), recipe expansion with `expansions` rows, `packs` rows;
#202's pack kinds at major 1, with their kit; the core's migrations of canvas modules' kinds at load (`migrate_item`, the
`migrated` notice `{code, severity: "notice", ids, path, actual, what, kind, from, to}`) and `store_migrations` on a
writer's patch, for kinds in the sealed registry only; shared documents seeded by a scenario's `docs.<id>.document`,
`read`, and a session's `deep_show` patch. The base refuses a pack kind with a non-empty `migrate`, or at a major past 1,
with `out_of_range` at `kinds/<kind>/migrate` whose `actual` is `{kind, field: "migrate"}`, and a pack-level `corpus` as
`unknown_field` at the path `corpus`; these refusals of whole fields are left out of every refusal read here. It has no
migration of a pack kind at load, no corpus check, no step check and none of this suite's planted names.

## Run them

They build `deep-show`, so the folder runs alone: `scripts/lanes.mjs` needs `'tests/acceptance/1956/'` in its `alone`
list. This README is the instruction; the implementer makes that edit.

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1956 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/1956/tsconfig.json
```

Each file builds `deep-show` once (`cargo build --locked --bin deep-show --no-default-features --features r1`, honoring
`CARGO_TARGET_DIR`, with `CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` unless set), copies the binary to a
temporary folder and fails each test whose build failed. Every process gets a fresh evidence folder, so no store
carries between processes; every temporary folder is deleted. Node built-ins and vitest only. Headless, on the CPU, no
timings.

## The surface under test

`deep-show run`, one scenario JSON line on stdin, one reply per call, as #306, #202 and #393 left it: the scenario's
`packs: [{id, dir}]` (installed in order before the first call), `docs` (DOC.b seeded with `document`), `sessions` and
`planted`; the calls `packs`, `deep show` (from your shell, `peer`, `include: ["issues"]`), `read`, and `deep_show` with
`patch` from the working agent's session. **Every name below that the issue doesn't give is this job's invention**, the
smallest surface consistent with the design and the base; the implementer builds exactly these, or a dispute goes to a
blind redraft.

### The pack format (fixtures/packs)

- **`migrate`**, on a pack kind, exactly as the Fields line spells it, keyed by the old major as a decimal string:
  `{"1": {"rename": {"levels": "shelves"}, "set": {"depth": "old.width * 0.25"}, "drop": []}}`. **New:** all three keys
  are written, empty where unused. Expressions use the closed function list's spelling (`*` for ×) over `old.<param>`.
- **`corpus`**, on the pack, exactly as the Fields line spells it, keyed by major: `{"1": [sha256], "2": [sha256]}`.
  Each hash is an asset of the pack, listed in `assets` (the loader checks its hash and size).
- **New: a corpus asset is a corpus record**, the JSON object `{document, values}`, after #138's corpus file:
  - `document`: the board as the release of that major saved it, holding one item `case1` of the kind and naming in
    `packs` the version that saved it (`acme/shelf@1.0.0` for @1, `@2.0.0` for @2, `@3.0.0` for @3). **The pack check
    reads each corpus document under the version it is checking**, whatever version the document names, as the kit
    reads its examples.
  - `values`: `{<derived ID> → {kind, params, at}}`, every derived item the document's expansion writes, as the
    `expansions` row's `derived` gives them (#306). Expanded after migration, the document must write exactly these
    IDs, each with equal `kind`, `params` and `at`, numbers compared as numbers (`160` equals `160.0`). Every number in
    the fixtures is exact in binary, so no tolerance is needed.
- **Earlier versions** are always installed in the same store before the version under test: 1.0.0 before a 2.0.0;
  1.0.0 and 2.0.0 before a 3.0.0. Every @1 corpus document sets every @1 param. So the params an old major declares
  can be read from the earlier version that shipped it or from the corpus; the tests don't say which.
- A kind at major 1 has `migrate: {}` and its pack no `corpus`, as #202 left it (1.0.0 installs at the base).

### Opening a corpus document

A document names each pack version, and a new version reopens nothing until a patch names it (Pack: dependencies).
**New:** to open a corpus document under a version, the test presents the record's `document` with its `packs` entry
naming that version (`pinned`), as the patch that takes the version writes it; its item stays at the major it was
saved at.

### Replies read

- **`packs` rows** (#306): `{pack, version, state, issues}`; a refused version is `state: "refused"` with error issues
  (severity `error`), less the base's two refusals of whole fields (above).
- **New: an error about a migration's param**: its `path` ends with `/set/<param>` (the param's own `set` entry,
  `kinds/<kind>/migrate/<from_major>/set/<param>`), or its `param` or `field`, at the top level or in `actual`, is the
  param. Its JSON holds the reason: for a result out of range, the corpus item's ID (`case1`) and the value (`5`); for
  a function outside the closed list, the function's name (`lerp`); for a param the old major doesn't declare, its
  name (`height`). **A refused version holds one such error for each param that fails.** (The expression as `actual`
  carries the function's or the param's name.)
- **New: a dropped step's error**: names the kind (`shelf.bookcase@3`) and the step, by a `path` ending `migrate/1`
  (`kinds/shelf.bookcase@3/migrate/1`, the missing key), or by `from` 1 and `to` 2.
- **New: the refused @1 document's error** (criterion 1's last clause, see Readings): in the refusal of a version that
  moves the kind to @3 with no @1-to-@2 step, an error that names the @1 corpus document (its sha256 or its item
  `case1`), both majors (`from` 1 and `to` 3, at the top level or in `actual`, or the texts `shelf.bookcase@1` and
  `shelf.bookcase@3`), and has a `fix` other than the catch-all "See the issue.".
- **`migrated` notices** on `deep show`'s `notices`: the core's notice as canvas modules' kinds raise it, for a pack
  kind: `{code: "migrated", severity: "notice", ids: ["case1"], kind, from, to}`, one per step per item. The tests read
  `ids`, `from` and `to`, and that `kind` starts with `shelf.bookcase`.
- **`expansions`** (#306): `{instance, kind, derived}`; after migration `kind` is the kind's current major
  (`shelf.bookcase@2`, `@3`).
- **`read`**: `document`, the stored document. A presented revision is stored as stamped; a shared document seeded by
  `docs.<id>.document` is stored as seeded until a patch. **New:** the working agent's `deep_show` patch on the shared
  document (one `create` of a rect) stores the migrated kind and params of the items in its layer, as
  `store_migrations` does for canvas modules' kinds: `read` then gives `case1` as `shelf.bookcase@2` with `{width 2,
  shelves 4, depth 0.5}`. Its layer is `alpha-main`, whose `writer` is `agent:thread-alpha`.

### `planted` values (scenario field; new, reachable only there)

| Value | Criterion | The wrong program |
|---|---|---|
| `migration_stops_at_first_fault` | 4 | the pack check's migration part stops at its first failing param, so a refusal names one |

## Fixtures (`fixtures/packs/`)

All are `acme/shelf` (an outside owner, as `PackId::parse` needs) with one kind, its recipe of the same name, and cost
class `figure` at `{cpu_ms 0.5, gpu_ms 0.2, items 7}`. Each major draws, at 100 u a metre, two sides, one board per
level 40 u apart, and a plan strip under them as deep as the bookcase. `fixtures/packs` was written by a script this
job ran once; the files are what the tests read.

| Folder | Version | What it holds |
|---|---|---|
| `shelf-1.0.0` | 1.0.0 | `shelf.bookcase@1`: width (m, 0.5–3.0, default 1.2), levels (1–8, default 4); sides `levels * 40` u tall; plan strip `width * 25` u deep at `levels * 40 + 10`; `migrate: {}`, no corpus |
| `shelf-2.0.0` | 2.0.0 | `shelf.bookcase@2`: width, shelves (1–8, default 4), depth (m, 0.1–1.0, default 0.3); plan strip `depth * 100` u deep; step 1 `{rename {levels: shelves}, set {depth: old.width * 0.25}}`; corpus 1 and 2 |
| `shelf-2.0.0-depth-25` | 2.0.0 | planted: step 1 sets depth = `old.width * 2.5` |
| `shelf-2.0.0-lerp` | 2.0.0 | planted: step 1 sets depth = `lerp(0, old.width, 0.25)` (`lerp` isn't on the closed list; `mix` is) |
| `shelf-2.0.0-height` | 2.0.0 | planted: step 1 sets depth = `old.height * 0.25` |
| `shelf-2.0.0-three-faults` | 2.0.0 | planted: step 1 `{rename {}, set {width: lerp(0, old.width, 1), shelves: old.height * 10, depth: old.width * 2.5}, drop [levels]}` |
| `shelf-3.0.0` | 3.0.0 | `shelf.bookcase@3`: adds height (m, 0.2–4.0, default 1.6), sides `height * 100` u tall; steps 1 (as 2.0.0's) and 2 `{set {height: old.shelves * 0.4}}`; corpus 1, 2 and 3 |
| `shelf-3.0.0-drop` | 3.0.0 | the same with only step 2 |

Corpus records `corpus/case-<major>.json`: `case1` at @1 `{width 2, levels 4}`, at @2 `{width 2, shelves 4, depth
0.5}`, at @3 the same with height 1.6; every record holds the same values, the @1 expansion: `case1.sides.0–1` (box
`[0, 0, 2, 160]` at x 0 and 198), `case1.boards.0–3` (box `[0, 0, 200, 2]` at y 38, 78, 118, 158) and `case1.plan` (box
`[0, 0, 200, 50]` at y 170). The @1 record has the same bytes, and hash, in every version.

## Criteria to tests

Each test's name starts with its criterion's ID, `#1956.` and the first eight hex digits of the SHA-256 of the
criterion's text, trimmed and white space collapsed (`scripts/proof-change.mjs`, `criterionId`, on the live issue
body). Each file's head quotes its criterion and says what it asserts. The planted migrations are input the right
program must refuse, asserted in their criterion's test; the planted check runs in a test of its own.

| # | ID | Test | Wrong program it fails on |
|---|---|---|---|
| 1 | `#1956.9deb4e8e` | `migrate.test.ts` (1) | the merge base (2.0.0 refused) |
| 2 | `#1956.9e619118` | `refusals.test.ts` (1) | the merge base; a pack check that admits a planted 2.0.0, or refuses it without naming depth with its reason |
| 3 | `#1956.e6c1b60f` | `chain.test.ts` (1) | the merge base (2.0.0 and 3.0.0 refused) |
| 4 | `#1956.fd7b382f` | `faults.test.ts` (2) | `migration_stops_at_first_fault`; the merge base |

`twins.json` maps each criterion that names a planted program or planted migration to those names (the `planted` value
and the planted fixture folders), as #202's suite does.

## Readings where the issue leaves a choice

- **"The values recorded for it"** (1, 3) are the corpus record's `values`, which the @1 release recorded. Each major's
  recipe draws the same picture from its own params, so the right steps reproduce them: @1 drew the plan strip a
  quarter of the width deep, which is why step 1 sets depth = old.width × 0.25, and @3 draws the sides `height * 100`
  u tall where @2 drew `shelves * 40`, which is why step 2 sets height = old.shelves × 0.4.
- **"Opens as @2 with {width 2.0, shelves 4, depth 0.5}"** (1) is read on the expansion, `kind` `shelf.bookcase@2`
  with the recorded values (the plan strip 200 u wide and 50 u deep, four boards), and directly on the stored params
  once its writer patches.
- **"Its stored bytes stay as they were until its writer patches it"** (1): a presented revision's stored `case1` stays
  at @1 `{width 2, levels 4}`; a shared document's `case1`, in the working agent's layer, reads back equal to the seed;
  after that writer's own patch it is stored at @2 with the migrated params.
- **"Once the pack moves the kind to @3, an @1 document is refused with a fix, naming both majors"** (1). A comment on
  #203 notes this clause can't happen at load if criterion 3 holds, and recommends dropping it; the live issue still
  holds it, so it is tested as one event with criterion 3's second clause: the version that moves the kind to @3 with
  only the @2-to-@3 step is refused at its pack check, and among its errors the @1 corpus document, which can't reach
  @3, is refused with a fix naming majors 1 and 3. Criterion 3 reads the same refusal for the kind and the dropped
  step.
- **"Ships only the @2-to-@3 step"** (3): the version is checked with 1.0.0 and 2.0.0 already installed and lists the
  @1 corpus document, so it drops a step by every reading: the store's earlier versions, its own corpus, or a kind at
  @3 carrying steps from 1 and 2.
- **"Naming depth and the item"** (2) is an error about depth naming the corpus item `case1`; "gives the corpus
  document 5.0 m" is the value 5 in that error. **"Naming it"** for the function and old.height is an error about
  depth whose JSON names `lerp` or `height`.
- **"All three params with their reasons"** (4): the faults sit on three params (width calls `lerp`, shelves reads
  old.height, depth comes out 5.0 m), each with an error of its own. **"Names one"**: under the planted check exactly
  one of the three is named, so the check fails naming the other two.
- **"One `migrated` notice per step"** (3): exactly the steps 1→2 and 2→3 for `case1`, in either order.
- **Ranges the issue doesn't give**: @1's width is 0.5–3.0, so old.width × 0.25 lies in 0.125–0.75, inside depth's
  0.1–1.0 with room, and old.width × 2.5 lies in 1.25–7.5, wholly outside it; @3's height is 0.2–4.0 around
  old.shelves × 0.4 in 0.4–3.2. A check that bounds an expression over the old range and one that evaluates the corpus
  agree on every fixture.

## Not tested, because no criterion asks

A rename rewriting channel targets, driver reads, bound values and constraint paths, and a drop of a targeted param
(#1960); a later load after a writer's patch raising no `migrated`, and another writer's layer kept (#1960); mixed
majors across writers (#1959); `derived_orphan` (#1961); moved and removed kinds (#1962); `requires.packs` (#1957); a
corpus value that differs, refused naming the item and the first field; a param the migration doesn't set taking its
default; the kit's `migration` part in `deep_kinds`; seeded param sets; canvas modules' own kinds.

## Upstream tests (the Oracle lane)

The issue says no upstream test checks these criteria (its oracle page), so these tests are their local proof.
