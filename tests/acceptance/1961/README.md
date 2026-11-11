# Acceptance tests for #1961: recipe versions in an open document

Written first, from issue #1961 ("Recipe versions in an open document: expansions keyed by recipe version, and broken-out
items a new version no longer derives": its Scope, its two acceptance criteria and its Proof line, "The corpus documents
with their notices and values"), the design sections it links and base commit `07b638444` ("Merge pull request #2257 …"),
by a job that never saw an implementation; none existed, and no other worktree, branch or pull request was read. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding). Lean: one test per clause, plus one per planted program the criteria name. The issue says no upstream test
checks these criteria.

## What was read

- The issue, live with `gh issue view 1961`.
- `AGENTS.md` (the four invariants, Proof) and `docs/technical-design.md`, Dogfooding ("Who drafts it").
- `docs/canvas-primitives.md`: Pack; Pack: migrations as data ("When a new version no longer derives an ID that an
  instance broke out, or that a note or handle names, the broken-out item stays the writer's own with its values and
  the load raises `derived_orphan`, naming it and each note and handle, and a later version that derives that ID again
  never writes it"); Pack: dependencies ("Since a document names each version, a new version of a pack reopens nothing
  until a patch names it"; "A patch that names a new pack version in an open document re-expands that pack's instances
  under the new version, and its undo re-expands them under the old one"; `deep try`'s "a cell whose load raises a notice
  … (`migrated`, `derived_orphan` or `pack_missing`)" and "one patch per document that sets every changed pin
  together"); Recipe (keyed by `hash(recipe@version, inputs)`, `broken_out`, Patch `break_out {instance, item}`);
  Patch (`set {id, path, value}`, undo as the inverse patch); Revision; Note (its fields); The path grammar.
- At the base, only for how the surfaces are driven: `crates/deep-show/src/main.rs` (scenario fields, `planted`, the
  `read` and `deep show` calls), `hub.rs` (`deep show`, the planted values handed to the pack code), `shared.rs` (stored
  documents opened at revision 0, patches and undo, `read`, `notices` on whole-revision replies), `packs.rs`
  (`expansions` rows); `crates/deep-canvas/src/document/packs.rs` (expansion, its key, `broken_out`) and `apply.rs`
  (patch ops and paths); the suites `306/`, `202/`, `1957/` and `1720/` (README, helpers, conventions). Every expected
  value comes from the issue.

## What the base already does, and these tests don't credit

#306's pack store, recipe expansion with `expansions` rows `{instance, kind, pack, key, derived, seeds, broken_out, …}`,
documents stored in a scenario's `docs[…].document` and opened at revision 0, `read` (`document`, `draws`,
`expansions`), your patches and undo from your shell, and `break_out`. The base's expansion key already hashes the pack
ID and `recipe@major.minor` with the inputs and `broken_out` (`expand_one` in deep-canvas's `document/packs.rs`), so a
fresh check keys by the recipe's version; these tests read keys only by comparing a warm evaluation with a cold one. The
base has no way for a patch to name a pack version: the pin patch below is refused with `bad_path`, "section `packs` is
not one of items, controls, channels, markers, data, inputs, assemblies" (the path grammar's sections; `op_path` in
`apply.rs` then lets a patch reach only items). A `broken_out` entry the recipe doesn't derive is an error at the base
(`out_of_range`, "not a derived ID of this instance", in `expand_one`), so the instance writes nothing. `deep-show` holds
no notes, and a patch's reply carries no `notices` (a whole revision's reply does).

## Run them

Each file builds `deep-show`, so the folder runs alone: `scripts/lanes.mjs` needs `'tests/acceptance/1961/'` in its
`alone` list. This README is the instruction; the implementer makes that edit.

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1961 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1961/tsconfig.json
```

Each file first runs `cargo build --locked --bin deep-show --no-default-features --features r1` (honoring
`CARGO_TARGET_DIR`, with `CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` unless set), copies the binary to a
temporary folder and fails each test if the build failed. Each test runs one `deep-show run` process with a fresh
evidence folder, and a cold evaluation is one more process with its own; every temporary folder is deleted. Node
built-ins and vitest only; everything runs headless on the CPU. `BASE-FAILURE.txt` holds the one run on the base and
why each test fails there.

## The surface under test

`deep-show run`, one scenario JSON line on stdin, one reply per call, as #306, #96 and #1957 left it: the scenario's
`packs: [{id, dir}]` installed before the first call (here acme/shelf@1.0.0 and acme/shelf@1.1.0, both, in every run),
`docs: {<doc>: {panel, document}}` (your stored board, opened at revision 0, your layer `you-main`), `planted`, and the
calls `read` (from your shell; reply `document`, `draws`, `issues`, `expansions`), `deep show` with `patch` and `deep
show` with `undo: {patch, of}` (from your shell, so they write as you; reply the Patch result: `outcome`, `rev`,
`issues`, `undo`, `expansions`). **Every name below that the issue doesn't give is this job's invention**, the smallest
surface consistent with the design and the base; the implementer builds exactly these, or a dispute goes to a blind
redraft.

- **The pin patch: a patch names a pack version with one `set`** whose path is the document's `packs` entry for the
  pack of that name: `{"op": "set", "id": "shelf", "path": "packs/shelf", "value": "acme/shelf@1.1.0"}`. It is Patch's
  own `set {id, path, value}` in the path grammar's `<section>/<id>` shape: a document names at most one pack of a name
  (Pack), so the name half (`shelf`) is the entry's ID, and it never holds `/`. Applied, the stored document's `packs`
  reads `["acme/shelf@1.1.0"]`; its undo, `deep show` with `undo: {patch, of}` as at the base, puts `acme/shelf@1.0.0`
  back. Nothing else of the patch envelope is new.
- **Scenario field `notes`**: `[{note: ULID, doc, item, rev, region: {x, y, w, h}, text}]`, each a note you wrote, with
  the Note section's fields, that the hub holds on that document when the run starts. Here one note, on `b.board.2` at
  revision 0. (The base ignores a scenario field it doesn't know, so this is no load error there.)
- **`derived_orphan`** is read as an entry whose `code` is `derived_orphan` in the `notices` or `issues` of the pin
  patch's reply (`notices` is the field the base's whole-revision replies already carry a check's notices in, severity
  `notice`), or of the `read` of the revision that patch made. "Naming `b.board.2` and the note on it" means one such
  entry's JSON text holds `b.board.2` and the note's ULID. No other field of it is read.
- **"Keeps that item as the writer's own by hash"**: in the `read` after the pin patch, `document.items["b.board.2"]`
  is in your layer, the sha256 of its canonical JSON (keys sorted at every depth) equals revision 0's, and b's
  `expansions` row doesn't hold `b.board.2` among `derived`.
- **"`X` expands" and "derives `X`"**: b's `expansions` row in the `read` holds `X` among `derived`'s keys; "no `X`":
  it doesn't. After the pin patch the row's `pack` is acme/shelf@1.1.0 (#1961.0c0ae838) and the stored document names
  that version (both criteria).
- **"A cold evaluation of that revision"**: a fresh `deep-show run` process, with its own evidence folder, the same two
  pack versions installed and the same `planted` value, that opens the stored document the warm `read` showed (its
  `document`) as `docs[<doc>].document` and reads it. **"Every evaluated output and content key"**: every field of every
  `expansions` row, compared field by field as canonical JSON (`pack`; `key`, the expansion's content key, which Recipe
  keys by `hash(recipe@version, inputs)`; `derived`, each derived item with its evaluated values; `seeds`;
  `broken_out`; the rest), and `draws`.
- **Recipe and pack names**: the issue's shelf.bookcase 1.0 and 1.1 are the recipe `shelf.bookcase@1` at recipe
  versions `1.0` and `1.1`; "the pack version carrying 1.1" is acme/shelf@1.1.0, and 1.0 is carried by
  acme/shelf@1.0.0. Pack IDs carry an outside owner (`acme/…`) as `PackId::parse` needs.

### `planted` values (scenario field, each reachable only there; names are this job's)

| Value | Criterion | The wrong program |
|---|---|---|
| `orphan_load_drops_broken_out` | #1961.0c0ae838 | loading an instance under a version that no longer derives an ID it broke out drops the writer's broken-out item |
| `orphan_load_hands_id_to_expansion` | #1961.0c0ae838 | that load hands the broken-out item's ID to the new version's expansion, which writes it in the writer's item's place |
| `expansion_cache_without_recipe_version` | #1961.7bc49ab6 | expansions are cached by the instance's kind and its inputs, without the recipe's version, so the patch that names acme/shelf@1.1.0 reuses 1.0's expansion of b |

The issue's "a planted loader that drops the broken-out item, or hands its ID to the new expansion" is read as two
wrong programs, each its own test. A cold evaluation under the planted cache starts with an empty cache.

## Fixtures (`fixtures/`)

| File | What it holds |
|---|---|
| `packs/shelf-1.0.0/` | `acme/shelf@1.0.0`: recipe `shelf.bookcase@1` at 1.0, inputs width (0.4–3 m, default 1.2) and levels (1–8, default 3); steps `sides` (2) and `board` (one per level), each a `rect@1`, so an instance `b` derives `b.sides.0–1` and `b.board.0–2` |
| `packs/shelf-1.1.0/` | `acme/shelf@1.1.0`: `shelf.bookcase@1` at 1.1, the same recipe with the step `board` renamed `shelf` (`b.shelf.0–2`) |
| `bookcase-1.0.json` | the corpus document for #1961.7bc49ab6: your stored board naming acme/shelf@1.0.0, holding instance `b` (kind `shelf.bookcase@1`, params at their defaults) in your layer `you-main` |
| `bookcase-1.0-broken-out.json` | the corpus document for #1961.0c0ae838: the same board after your `break_out {instance: b, item: b.board.2}`, as the base's hub stored it (made once with the base binary: `bookcase-1.0.json` opened, the break-out applied, the `read` reply's `document` saved with its `id` left out and its description reworded): `b.broken_out` is `["b.board.2"]` and your layer holds `b.board.2` with the values 1.0 expanded it with |

The issue's Proof line, "The corpus documents with their notices and values", is read as these two documents and what
the tests assert of them: the `derived_orphan` notice and the broken-out item's values, the derived items and the
warm and cold expansions. They are fixtures of this suite, not a pack's `corpus` field (Pack: migrations as data), which
is for a kind's earlier majors; the recipe here keeps its major.

## Criteria to tests

Each criterion's ID is `#1961.<first 8 hex digits>` of the SHA-256 of its text, trimmed and white space collapsed
(`scripts/proof-change.mjs`, `criterionId`, on the live issue body). Each test's name starts with it and says its clause;
each file's head quotes its criterion and says what each test asserts.

| ID | File | Tests | What they assert | Fails at the base because |
|---|---|---|---|---|
| `#1961.0c0ae838` | `orphan.test.ts` | 5 | with your note on `b.board.2`: revision 0 holds it as your item and b, through acme/shelf@1.0.0, doesn't write it; your pin patch to acme/shelf@1.1.0 applies; then (1) `b.board.2` is in your layer with its sha256 unchanged and b doesn't write it, (2) a `derived_orphan` names `b.board.2` and the note's ULID, (3) b expands through acme/shelf@1.1.0 and derives `b.shelf.2`; (4, 5) under each planted loader the three checks fail, a failure naming `b.board.2` | the pin patch is refused (a patch reaches only items); the planted values are unknown, so the scenario is `bad_input` |
| `#1961.7bc49ab6` | `versions.test.ts` | 4 | revision 0's b derives `b.board.2` and no `b.shelf.2`; (1) after your pin patch the document names acme/shelf@1.1.0 and b derives `b.shelf.2` and no `b.board.2`; (2) after its undo the document names acme/shelf@1.0.0 and b derives `b.board.2` and no `b.shelf.2`; (3) after each, the warm `read`'s expansions and draws equal a cold evaluation's; (4) under the planted cache those checks fail, a failure naming `` `b` ``, `b.board.2`, shelf.bookcase 1.0 and shelf.bookcase 1.1 | the pin patch is refused, so neither it nor its undo applies; the planted value is unknown, so the scenario is `bad_input` |

## Readings where the issue leaves a choice

- **How a document from 1.0 comes to load under 1.1** (#1961.0c0ae838): by the pin patch. Pack: dependencies says a new
  version "reopens nothing until a patch names it", so "the load" of a document from 1.0 under 1.1 is the check of the
  revision your patch that names acme/shelf@1.1.0 makes. The note is on the item before the patch, at revision 0.
- **"The note on it"** is named by its ULID, the Note's ID field.
- **"Fails, naming"**: as #306's suite reads its planted programs, the failures are sentences this suite's checks write
  from the replies, each naming what it found wrong; a planted program must make the clauses' checks fail with a
  failure that names what the criterion says (the ID; or `` `b` ``, and both versions as shelf.bookcase 1.0 and 1.1, the
  failure also giving acme/shelf@1.0.0 and acme/shelf@1.1.0). Each planted test first requires that the pin patch
  applied and the document names acme/shelf@1.1.0, so a refused patch never counts as the plant's failure.
- **The planted cache "keeps `b.board.2` after the patch"**: read in the warm `read` after the patch; the test requires a
  failure naming `b.board.2` too.

## Not tested, because the criteria don't ask

A handle that names an ID a new version no longer derives; a note or handle on a derived ID that isn't broken out; a
later version that derives the ID again never writing it; the key holding the recipe's version read directly rather
than through the cold comparison; migrations of a kind's major, the `migrated` notice and a pack's `corpus`; `deep try`;
a patch naming two pack versions together; other writers' layers.

## Upstream tests (the Oracle lane)

The issue's oracle page says no upstream test checks these criteria, so these tests are their local proof.
