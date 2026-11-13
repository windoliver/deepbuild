# Acceptance tests for #1958: retired and missing packs

Written first, from issue #1958 ("Retired and missing packs: uninstalling keeps every version a document names, and a
missing version's instances are kept and skipped": its Scope, its Fields, its three acceptance criteria and its Proof
line, "The retired pack's document drawing to its old hash, and the missing pack's document with its skipped
instances"), the design sections it links and those they lean on, and base commit `145315636` ("Merge pull request
#2297 …"), by a job that never saw an implementation; none existed, and no other worktree, branch or pull request was
read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job
(design: Dogfooding). Lean: one test per criterion's clause group, one per planted program a criterion names, and one
budgets file of two tests. The issue says no upstream test checks these criteria.

## What was read

- The issue, live with `gh issue view 1958`.
- `docs/canvas-primitives.md`: Pack (a build without a version "keeps the pack's instances byte for byte and skips them
  when drawing with `pack_missing` … never draws them with another version; a check that needs it is BLOCKED"), Pack:
  retired and missing (the store's `{state: installed | retired, named_by: u32}`, the notice `pack_missing {pack,
  version, ids}`, "A patch that creates an instance of it is refused with `pack_missing`, and a check that touches one is
  BLOCKED, naming the pack"; Cost "A count per pack version, O(1) per save, bake or delete; nothing per frame"), Pack:
  kinds in any pack (`deep_kinds`), Pack: migrations as data, Pack: dependencies, Recipe; Item and kind (an unknown kind
  "skipped when drawing with the notice `unknown_kind` and kept byte for byte through other writers' patches"); Writer
  layer.
- `docs/technical-design.md`: Composition ("An instance whose pack's bytes are gone is kept byte for byte and skipped when
  drawing with `pack_missing`, as an unknown kind is, and every check that touches it is BLOCKED").
- At the base, only for how the surfaces are driven: `crates/deep-show/src/main.rs` (scenario fields, `docs.<id>.document`,
  `claims`, `planted`, the calls), `hub.rs` (`install_pack`, packs installed before the first call, `deep show` replies,
  `refused_reply`, the check's `result`), `shared.rs` (stored documents opened at revision 0, `read` with `draws` and
  `expansions`, whole revisions and patches by writer), `packs.rs` (the folder loader, `packs` rows, `blocked`),
  `kinds.rs` (`deep_kinds` op list and its `packs` rows), `verdict.rs` (#403's `blocked` rows in a claim);
  `crates/deep-canvas/src/document/packs.rs` (`Packs`, `resolve` and its whole-document `pack_missing`), `packs/deps.rs`,
  `pack_kinds.rs`, `pack_kinds/migrate.rs`, `check.rs` (the `unknown_kind` notice), `apply.rs` (`not_your_layer`, an
  unknown kind never patched); `scripts/proof-change.mjs` (`criterionId`), `scripts/lanes.mjs`; the suites `306/`,
  `202/`, `403/`, `1956/` and `1957/` (README, helpers, conventions). Every expected value comes from the issue.

## What the base already does, and these tests don't credit

#306's store (`packs` scenario field, `install_pack`, `packs` rows `{pack, version, state, checks, issues}`), recipe
expansion with `expansions` rows naming the pack version, snapshots by sha256, and `pack_missing`, which refuses a
document naming a version the store lacks whole (an error, `actual: {pack, version}`, `ids` the instances), its check
BLOCKED; #403's claims, `deep show --check` in a claim and its `blocked` rows, and the `unknown_kind` notice for an item
of a kind the build doesn't know, kept and skipped, its check in a claim BLOCKED; #96's stored documents, `read` and
patches by writer; #202's `deep_kinds` op list, whose reply lists the installed packs `{pack, version, origin, recipes,
aliases}`; #1956's pack migrations at load; #1957's `requires.packs`. At the base the stored room from another machine
already opens at revision 0 (with the `pack_missing` error), its `read` draws the 12 other items, and the working
agent's patch to its own items applies with b1–b3 unchanged; these tests don't credit that, and fail on what the base
lacks: there is no `uninstall_pack`, no `retired` state, no `named_by`, no `timing.migrate_ms` or `timing.resolve_ms`,
none of this suite's planted names, and a document naming a missing version is refused rather than opened.

## Run them

The files build `deep-show` and the budgets time it, so the folder runs alone: `scripts/lanes.mjs` needs
`'tests/acceptance/1958/'` in its `alone` list and `'tests/acceptance/1958/budgets.test.ts'` in its `timed` list. This
README is the instruction; the implementer makes that edit.

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1958 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1958/tsconfig.json
```

Each file builds `deep-show` once (`cargo build --locked --bin deep-show --no-default-features --features r1`, honoring
`CARGO_TARGET_DIR`, with `CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` unless set), copies the binary to a
temporary folder and fails each test whose build failed. `budgets.test.ts` also builds the merge base (`git merge-base
HEAD origin/main`, exported with `git archive` into `target/acceptance-1958-base/<sha>/`, built there with its own target
folder, kept so later runs build warm), only after its own structure passed. Every temporary folder is deleted. Node
built-ins and vitest only; everything runs headless on the CPU.

`budgets.test.ts`'s first test times on a reference Mac only (Mac15,7 or Mac15,12, Low Power Mode off, thermal state
nominal, a 1-minute load at most the core count; mains power never gates), after its structure passed; elsewhere it
skips as `INCONCLUSIVE (reading only): …`, and a reading between the limit and the margin skips as INCONCLUSIVE too; it
never passes by skipping. Its second test is a structure and runs everywhere. `BASE-FAILURE.txt` holds the one run on
the base and why each test fails there.

## The surface under test

`deep-show run`, one scenario JSON line on stdin, one reply per call, as #306, #403, #1956 and #1957 left it: the
scenario's `packs: [{id, dir}]` (offered to the store in order before the first call), `docs` (a document seeded with
`document` is stored and opened at revision 0), `sessions`, `processes`, `claims` and `planted`; the calls `packs`, `deep
show` from your shell (`peer`, with `include` `issues`, `pixels`, `timing`, `size`, `check`), `deep show --check` in the
working agent's claim (`peer` in its process tree, `claim`), `deep_show` with `patch` from the working agent's session,
`read`, `deep_kinds` op list, `registry` and `eval`. **Every name below that the issue doesn't give is this job's
invention**, the smallest surface consistent with the design and the base; the implementer builds exactly these, or a
dispute goes to a blind redraft.

### The store

- **New call `uninstall_pack`**: `{"call": "uninstall_pack", "id": "<owner>/<name>", "version": "<semver>"}`, beside
  #306's `install_pack`. It retires that version: the version stays in the store with its bytes, takes no new instance,
  and every document that names it loads, checks and draws as before. Its reply is not read. **New:** the call then runs
  the store's sweep once, which deletes each retired version that nothing names (`named_by` 0); no test reads a deletion.
- **`packs` rows** add the issue's Fields: `state` is `installed`, `retired` or (as at the base) `refused`, and **`named_by`**
  is a number, the documents, saves and bakes that name the version. In this binary a document names a version when it
  is open in the hub (a stored document, or one presented by `deep show`) with the version in its `packs`; a version
  reached only through another pack's `requires.packs` counts as named (design). The tests read `named_by` ≥ 1 for one
  stored document, and exactly 3 after three documents, each naming the version, are presented once.
- **`deep_kinds` op list**: each row of its reply's `packs` adds **`state`**, `installed` or `retired`; a retired
  version stays listed.

### The missing version

- **The open.** A document naming a version the store has never had is presented (`outcome` `presented`), not
  refused, with no error. Its reply carries the issue's notice **`pack_missing`** among its `notices` (or its `issues`,
  as long as nothing with severity `error` refuses the document): the tests read an entry with `code` `pack_missing`
  whose JSON names the pack (`acme/shelf`) and the version (`9.9.9`), and whose `ids` are exactly that pack's
  instances (`b1`, `b2`, `b3`, in any order). No instance of it has an `expansions` row (#306: every expansion has one,
  naming the pack version it expanded through), and the snapshot draws the document's other items alone.
- **A stored document** naming it opens at revision 0; another writer's patch to its other items applies, and `read`
  gives each of the pack's instances with the same bytes; its `draws` holds the other items and nothing of the pack's.
- **A check that touches one**: `deep show --check` in a claim whose deliverable is the document (#403's form) answers
  `result` `BLOCKED`, with a **`blocked` row naming the pack** (its JSON holds `acme/shelf`), as #403's names an unknown
  kind.
- **A patch that creates an instance** of a retired version is refused (`outcome` `refused`) with an issue `pack_missing`
  naming the pack and the version.

### Timings (`include: ["timing"]`, beside #306's `check_ms`)

- **`timing.migrate_ms`** (new): the wall time the load spent applying pack kinds' data migrations to the document's
  items, as the binary measures it.
- **`timing.resolve_ms`** (new): the wall time resolving the document's pack graph (its `packs` and every version they
  require), as the binary measures it.

### `planted` values (scenario field; new, each reachable only there; an unknown value stays `bad_input`)

| Value | Criterion | The wrong program |
|---|---|---|
| `store_sweep_deletes_named` | 1 | the store's sweep after `uninstall_pack` deletes every retired version, whatever names it |
| `loader_draws_missing_with_installed` | 2 | a document naming a version the store lacks resolves that pack through the installed version of the same pack (`owner/name`), and draws its instances with it, each with an `expansions` row naming the version it used |

## Fixtures

- `fixtures/packs/shelf-1.2.0/`: `acme/shelf@1.2.0`, the recipe `shelf.bookcase@2` (2.0): width (0.4–3 m, default 1.2)
  and levels (1–8, default 3); two sides and a board per level, each a `rect@1`, at 100 u a metre. Copied from #1957's
  suite, its description and author renamed. The bookcase is a plain recipe, so no kind kit is involved.
- `fixtures/packs/shelf-1.0.0/` and `shelf-2.0.0/`: `acme/shelf@1.0.0` (the pack kind `shelf.bookcase@1` {width, levels})
  and `acme/shelf@2.0.0` (`shelf.bookcase@2`, whose @1-to-@2 migration renames levels to shelves and sets depth = old.width
  × 0.25, with its corpus), copied from #1956's suite for the migration budget; the corpus assets are byte for byte as
  there, so their listed hashes hold.
- The ten-pack graph is written at test time (`writeGraph`): `acme/g01@1.0.0` … `acme/g10@1.0.0`, each with the recipe
  `gNN.tile@1` (one 20 u rect), `gNN` requiring `g(NN+1)@1.0.0`, offered g10 first.
- The documents (`helpers.ts`): **the reading room**, a 640 × 400 board of the 3 bookcases `b1` {1.2 m, 3 levels}, `b2`
  {0.8 m, 4 levels}, `b3` {1.6 m, 2 levels} along the top and the 12 other items `r01`–`r12`, 40 u boxes along the
  bottom; the same room naming `acme/shelf@1.2.0` (criterion 1, "the saved document", stored on DOC.b in your layer) or
  `acme/shelf@9.9.9` (criterion 2, "the document from another machine", presented on DOC.a and stored on DOC.b with the
  bookcases in your layer and r01–r12 in the working agent's); and the 12 other items alone, naming no pack.

## Criteria to tests

Each test's name starts with its criterion's ID, `#1958.` and the first eight hex digits of the SHA-256 of the
criterion's text, trimmed and white space collapsed (`scripts/proof-change.mjs`, `criterionId`, on the live issue body).
Each file's head quotes its criterion and says what it asserts.

| # | ID | Test | Wrong program it fails on |
|---|---|---|---|
| 1 | `#1958.c08c09f6` | `retired.test.ts` (2): the retired version's document; the planted sweep | the merge base (no `uninstall_pack`); `store_sweep_deletes_named` |
| 2 | `#1958.4879b3fb` | `missing.test.ts` (2): the missing version's document; the planted loader | the merge base (the document refused whole); `loader_draws_missing_with_installed` |
| 3 | `#1958.26ef0787` | `budgets.test.ts` (2): the timings; nothing per frame | the merge base (no `timing.migrate_ms`, no `uninstall_pack`) |

## Readings where the issue leaves a choice

- **"A saved document"** (1) is a document the store holds: DOC.b, seeded as a stored document naming acme/shelf@1.2.0.
  **"Loads, checks and draws to the same snapshot hash as before"**: before and after `uninstall_pack`, `read` gives the
  same `draws` (each bookcase's derived items among them), and the same room presented again from your shell is
  presented, its check (`check: true`, no claim) `PASS`, its snapshot sha256 the one before. A whole revision that holds
  the instances the document already holds creates no instance.
- **"The store's fixture"** (1) is the scenario `retiredCalls` on the stored DOC.b, with its check `retiredFailures`
  (`helpers.ts`): after uninstalling, the version is still in the store, `retired`, `named_by` ≥ 1, and the document
  loads, checks and draws as before. Each failure names the pack and the document, so the planted sweep fails it naming
  `acme/shelf@1.2.0` and DOC.b's ID.
- **"A patch that creates a new bookcase"** (1) is your patch on DOC.b with one `create` of a `shelf.bookcase@2` item.
- **"Opens"** (2) is the room presented from your shell; **"its 12 other items draw"** is its snapshot sha256 equal to
  that of the 12 other items alone, drawn in the same process (and `read`'s `draws` of the stored copy); **"skipped with
  pack_missing naming shelf@9.9.9"** is one `pack_missing` naming `acme/shelf` and `9.9.9` whose `ids` are the 3
  bookcases. The pack ID carries an outside owner (`acme/`), as `PackId::parse` needs.
- **"Another writer's patch to those items"** (2): the room stored with the bookcases in your layer (they came from
  another machine as yours) and r01–r12 in the working agent's layer; the agent's patch moves r01 and r12. **"By hash"**
  is the SHA-256 of each bookcase's canonical JSON (keys sorted) in `read`'s stored document, before and after, and
  before equal to the stored bytes.
- **"A check that touches one"** (2) is the document's check in a claim that names it (#403's form; outside a claim an
  unknown kind stays a notice), so every item is touched. **"Naming the pack"**: a `blocked` row names `acme/shelf`.
- **"A planted loader that draws them with the installed shelf@1.2.0 fails, naming the item and both versions"** (2):
  the open's check `skippedFailures` gives one failure naming `b1`, `9.9.9` and `1.2.0` together, read from the
  `expansions` row the planted draw makes.
- **Budgets** (3): the issue's limits are absolute, so migrate_ms and resolve_ms are judged against 5 ms and 1 ms;
  "compared with the merge base" is read where a clause says *adds* or *nothing*. **"Keeping the store's counts adds
  O(1) per save"**: a save is a document's revision committed (`deep show`); one process saving 500 documents that
  each name acme/shelf@1.2.0 takes within 5% of the merge base's median for the same saves (the 5% is this job's), and
  the count itself is read as `named_by` 3 after three. **"Nothing runs per frame"**: the same frame-phase operators in
  `registry`, and the same frame-phase `eval` nodes, as the merge base gives the room with acme/shelf@1.2.0 installed
  (for the retired one) and the 12 other items alone (for the missing one), as #202's suite reads it; at the base an
  unknown kind's item adds no frame node either.
- **Builds**: everything runs on `r1`, which draws 2D rects; nothing here needs scene3d.

## Not tested, because no criterion asks or no surface reaches it

- **Bakes and deletes in the counts budget.** The binary has no surface that saves or bakes a logic run naming a pack, or
  that deletes a document, a save or a bake, and adding three is beyond the smallest surface; only a document's save is
  timed. This is a gap in criterion 3's proof, left open for the owner.
- The sweep deleting a retired version nothing names; a version named only through `requires.packs`; a baked logic run
  playing without its program; a patch that names a new pack version; `deep try`; removing a pack's data from the record.

## Upstream tests (the Oracle lane)

The issue says no upstream test checks these criteria (its oracle page), so these tests are their local proof.
