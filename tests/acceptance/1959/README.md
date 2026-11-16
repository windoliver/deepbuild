# Acceptance tests for #1959: mixed-version documents, each item migrated from its own saved major

Written first, from issue #1959 ("Mixed-version documents: each item migrates from its own saved major, across two
writers' layers": its Scope, its two acceptance criteria and its Proof line, "The migrated corpus documents with their
notices and values"), the design sections it links and those they lean on, and base commit `0e5572731` ("Merge pull
request #2529 …"), the worktree's HEAD and origin/main when this was written, by a job that never saw an
implementation; none existed, and no other worktree, branch or pull request was read. The implementing agent doesn't
edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). Lean: one test
per criterion, plus one for the planted program each criterion names. The issue says no upstream test checks these
criteria.

## What was read

- The issue, live with `gh issue view 1959`; its parent #203, epic #219 and sibling #1956 only for scope.
- `docs/canvas-primitives.md`: Pack: migrations as data (rename, then set, then drop; "a param the new major declares
  and the migration doesn't set takes its default"; "A param the document leaves out and a param it sets to 0 stay
  different through a rename"); Migration ("one major a step, from its major", "the stored document changes only when
  its writer next patches it"); Pack: dependencies ("a new version of a pack reopens nothing until a patch names it");
  Document envelope; Writer layer ("An item may refer to another writer's item (a parent …)"); Patch (undo); Revision
  (the restart).
- `docs/technical-design.md`: Criteria to tests, both ways; Wrong programs; Dogfooding.
- At the base, for how the surfaces are driven: `crates/deep-show/src/main.rs` (scenario fields: `docs.<id>.document`,
  `state`, `sessions`, `planted`; the `read`, `deep show` and `deep_show` patch and undo calls), `shared.rs` (shared
  documents, `read`, patches and undo, restoring from the state folder, `pack_kinds::store_migrations` on a writer's
  patch), `hub.rs` (`notices_reply`), `packs.rs` (`expansions` rows); `crates/deep-canvas/src/document/pack_kinds/
  migrate.rs` (`read`, `apply`, `corpus_faults`, `at_load`, `migrate_item`, `store_migrations`) and `check.rs`
  (`parent`); `scripts/proof-change.mjs` (`criterionId`); the suites `tests/acceptance/1956/` (README, helpers, tests,
  fixtures, `twins.json`), `1961/` and `1958/` for undo, a shared document's patch and the harness. Every expected value
  comes from the issue.

## What the base already does, and these tests don't credit

#1956 landed pack migrations as data: a kind's `migrate` steps and the pack's `corpus` are checked at install (every
step from major 1, each corpus document of an earlier major migrated, its params held to the kind's inputs, its
expansion compared with the record); at load `at_load` migrates each item from its own saved major (`migrate_item` reads
the major off each item's `kind`), one `migrated` notice per step per item; a renamed param the item leaves out stays
out and a 0 stays 0 (`apply`); a writer's patch stores the migrated kind and params of the items in its own layer.
Shared documents seeded by `docs.<id>.document`, `read` (with `document`, `issues` and `expansions`), a session's
`deep_show` patch and undo, and the restart from a scenario's `state` folder are older still. So most of what these
tests read already holds at the base. What it lacks: **`read` carries no `notices`**, so no stage's `migrated` notices
can be read on a shared document, and neither planted value is a planted name (the `planted` match ends
`_ => return None`, so those scenarios answer `bad_input`). Criterion 2's first test passes at the base; its planted
half, and both of criterion 1's tests, fail there. `BASE-FAILURE.txt` holds the one run on the base.

## Run them

They build `deep-show`, so the folder runs alone: `scripts/lanes.mjs` needs `'tests/acceptance/1959/'` in its `alone`
list. This README is the instruction; the implementer makes that edit.

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1959 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1959/tsconfig.json
```

Each file builds `deep-show` once (`cargo build --locked --bin deep-show --no-default-features --features r1`, honoring
`CARGO_TARGET_DIR`, with `CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` unless set; `cargo` must be on `PATH`),
copies the binary to a temporary folder and fails each test whose build failed. Every process gets a fresh evidence
folder; the restart shares only the hub state folder with the run before it; every temporary folder is deleted. Node
built-ins and vitest only. Headless, on the CPU, no timings.

## The surface under test

`deep-show run`, one scenario JSON line on stdin, one reply per call, as #306, #96, #1956 and #1961 left it: the
scenario's `packs: [{id, dir}]` (acme/shelf@1.0.0, @2.0.0 and @3.0.0, installed in that order in every run), `docs`
(the shared document seeded with `document`; four boards for the corpus documents), `sessions` (writer A and writer B),
`state`, `planted`; the calls `packs`, `read`, `deep show` (from your shell, `peer`, `include: ["issues"]`), and
`deep_show` with `patch` or `undo: {patch, of}` from writer A's session. **Every name below that the issue doesn't give
is this job's invention**, the smallest surface consistent with the design and the base; the implementer builds exactly
these, or a dispute goes to a blind redraft.

- **Writers A and B** are two agents' sessions, `sess-alpha` (thread `thread-alpha`) and `sess-beta` (`thread-beta`).
  Writer A's layer is `writer-a` (`writer: agent:thread-alpha`); writer B's is `writer-b` (`agent:thread-beta`).
- **New: `read` of a shared document carries `notices`**: the notices of the check of the revision it shows, as a whole
  revision's reply and a patch's reply already carry them (`notices_reply`): for a document holding items at an earlier
  major of their pinned pack's kind, one `migrated` notice `{code, severity: "notice", ids, kind, from, to, …}` per step
  per item (or per step with several `ids`; the tests read one step per ID). The tests read `ids`, `from`, `to`, and
  that `kind` starts with `shelf.bookcase`. This is the only new reply field; it is how every stage's notices are
  read.
- **"Loaded"**: the first `read` of the seeded shared document (revision 0). **"Patched"**: writer A's `deep_show` patch
  on revision 0, one `create` of a rect in its layer, then `read`. **"Undone"**: writer A's undo of that patch
  (`undo: {patch, of}`), then `read`. **"Opened again after a restart"**: a second `deep-show run` process with a fresh
  evidence folder, the same `state` folder, the same seed and the same pack versions, then `read`; it shows the
  revision the undo made, every item stored as that revision stored it.
- **"Opens … at @3 as {span 1.6, shelves 4, depth 0.4}"**: in each stage's `read`, each instance's `expansions` row has
  `kind` `shelf.bookcase@3` and its `derived` items equal, numbers as numbers, the values acme/shelf@3.0.0's @3 corpus
  record holds for its item `case1` saved at @3 as {span 1.6, shelves 4, depth 0.4}, each derived ID's `case1.` prefix
  read as the instance's ID. After writer A's patch its a1–a6 are also stored as `shelf.bookcase@3` with params exactly
  {span 1.6, shelves 4, depth 0.4} (the Migration rule the base already keeps; partitions left out).
- **"Every ID unchanged"**: the 12 instances and the two tags are stored under their IDs, and each instance has an
  `expansions` row of its own whose derived IDs start with its ID.
- **References**: the scene's two tags, `tag-a` (a rect in writer A's layer, `parent: "b1"`) and `tag-b` (writer B's,
  `parent: "a1"`), each hang from the other writer's bookcase (Writer layer: an item may refer to another writer's item).
  At each stage both are stored with that `parent`, and `read` raises no error (so no `ref_unresolved`).
- **Opening a corpus document under 3.0.0**, as #1956's suite reads it: the record's `document` with its `packs` entry
  naming acme/shelf@3.0.0 (`pinned`), as the patch that takes the version writes it, presented from your shell on its
  own board; its item stays at the major it was saved at.
- **Partitions, span and depth "at @3"** (criterion 2) are read off the item's expansion: partitions is the number of
  derived walls `<item>.walls.<i>` (the @3 recipe draws one upright wall per partition), span the plan strip's width
  and depth its depth, each in u at 100 u a metre.

### `planted` values (scenario field; new, reachable only there)

| Value | Criterion | The wrong program |
|---|---|---|
| `migration_one_major_per_document` | `#1959.7ccdd727` | the loader takes one saved major for the whole document, the lowest any item of the kind is saved at (here @1, which is also a1's, the first item by ID), and migrates every item of the kind from it: b1–b6, saved at @2, raise `migrated` from @1 to @2 too |
| `migration_zero_as_left_out` | `#1959.fd45405b` | the load's migrator reads a param set to 0 as left out, so a rename leaves it out and it takes the new major's default: shelf-0's dividers 0 opens as partitions 1. It plants only the migration at load; the pack check's corpus run is unchanged, so acme/shelf@3.0.0 still installs and the document opens |

`twins.json` maps each criterion to its planted value, as #1956's suite does.

## Fixtures (`fixtures/`)

All packs are `acme/shelf` (an outside owner, as `PackId::parse` needs) with one kind, its recipe of the same name, and
cost class `figure` at `{cpu_ms 0.5, gpu_ms 0.2, items 10}`. Each major draws the same picture at 100 u a metre from its
own params: two sides `levels * 40` u tall, one board per level 40 u apart, one upright wall per divider evenly spaced
(`walls`, at x = (i + 1) × width × 100 / (dividers + 1) − 1), and a plan strip under them as deep as the bookcase. The
pack folders and the scene were written by a script this job ran once against the base binary; the files are what the
tests read.

| Folder | Version | What it holds |
|---|---|---|
| `packs/shelf-1.0.0` | 1.0.0 | `shelf.bookcase@1`: width (m, 0.5–3.0, default 1.2), levels (1–8, default 4), dividers (0–3, default 1); plan strip `width * 25` u deep; `migrate: {}`, no corpus |
| `packs/shelf-2.0.0` | 2.0.0 | `shelf.bookcase@2`: width, shelves (1–8, default 4), depth (m, 0.1–1.0, default 0.3), dividers (0–3, default 1); plan strip `depth * 100` u deep; step 1 `{rename {levels: shelves}, set {depth: old.width * 0.25}, drop []}`; corpus 1 (the four documents below) and 2 |
| `packs/shelf-3.0.0` | 3.0.0 | `shelf.bookcase@3`: span (m, 0.4–3.0, default 1.2), shelves, depth, partitions (0–3, default 1); step 1 as 2.0.0's and step 2 `{rename {width: span, dividers: partitions}, set {}, drop []}`; corpus 1, 2 and 3 |

Corpus records (`corpus/*.json`, `{document, values}` as #1956 reads them, each listed in `assets` with its `sha256`
and `size`): at @1, `shelf-out.json`, `shelf-0.json`, `shelf-2.json` and `shelf-3.json`, items `shelf-out`, `shelf-0`,
`shelf-2` and `shelf-3` with {width 0.8, levels 4} and dividers left out, 0, 2 and 3 (criterion 2's four documents,
the same bytes in 2.0.0 and 3.0.0); at @2, `case-2.json`, `case1` {width 1.6, shelves 4, depth 0.4}; at @3,
`case-3.json`, `case1` {span 1.6, shelves 4, depth 0.4}. Every `values` is the base binary's expansion of the
equivalent @1 document under 1.0.0, the release that saved @1 (`kind`, `params` and `at` of each derived item). dividers
defaults to 1 at every major, as partitions does, so a document that leaves it out draws one wall at @1 and at @3 and
its recorded values hold through the migration.

`mixed-versions.scene`: the issue's lifecycle fixture, a stored board in JSON (its profile is `board`, since the
shelf pack draws 2D rects and the suite builds `r1`): `packs: ["acme/shelf@3.0.0"]`, as the patch that named 3.0.0 left
it; layers `writer-a` and `writer-b`; a1–a6 in `writer-a` at `shelf.bookcase@1` {width 1.6, levels 4}; b1–b6 in
`writer-b` at `shelf.bookcase@2` {width 1.6, shelves 4, depth 0.4}; the tags `tag-a` and `tag-b` (above). Each test
checks the fixture against its criterion before it runs.

## Criteria to tests

Each test's name starts with its criterion's ID, `#1959.` and the first eight hex digits of the SHA-256 of the
criterion's text, trimmed and white space collapsed (`scripts/proof-change.mjs`, `criterionId`, on the live issue
body). Each file's head quotes its criterion and says what it asserts. Each planted program runs in a test of its own
in its criterion's file, with that criterion's check.

| ID | File | Tests | Wrong program it fails on |
|---|---|---|---|
| `#1959.7ccdd727` | `mixed.test.ts` | 2 | the merge base (`read` has no `notices`; the planted value is unknown); `migration_one_major_per_document`, whose load fails the check naming each of b1–b6 |
| `#1959.fd45405b` | `zero.test.ts` | 2 | the merge base (the planted value is unknown); `migration_zero_as_left_out`, which gives shelf-0 partitions 1 and fails the check naming shelf-0 and partitions |

## Readings where the issue leaves a choice

- **The lifecycle** (Scope) is read in criterion 1's test, the one about the scene: IDs, references, evaluated values
  and `migrated` notices are compared at all four stages. The issue gives the notices only for the load, so each other
  stage's are read by the criterion's own rule, each item migrated from the major it is stored at: exactly one step per
  major from the stored major of each of the 12 to @3, as that stage's `read` stores it. At the load that is the
  criterion's set; after writer A's patch, with a1–a6 stored at @3, it is b1–b6 from @2 to @3 only. The tests don't say
  what the undo stores (see Not tested), only that the notices follow it and the restart keeps it.
- **"Opens with all 12 at @3 as {span 1.6, shelves 4, depth 0.4}"** reads partitions as left out (the scene's items
  leave dividers out), so each evaluates with partitions at its default, 1, as the @3 corpus record does.
- **"Raises `migrated` for b1 to b6 from @1 and fails, naming them"**: under the plant, `read`'s notices hold a step
  from @1 for each of b1–b6, and the criterion's check returns, for each, a failure naming it (its values still match:
  step 1 renames a `levels` b1–b6 don't hold and sets depth to 1.6 × 0.25 = 0.4, which they already hold).
- **"Fails, naming the item and the param"** (criterion 2): the check's failure for shelf-0 names the item and gives
  `partitions 1`.
- **Ranges the issue doesn't give**: width at @1 and @2 is 0.5–3.0 (as #1956's fixtures), so old.width × 0.25 lies in
  0.125–0.75, inside depth's 0.1–1.0; dividers is 0–3 with default 1 at @1 and @2, as partitions at @3.

## Not tested, because no criterion asks

What writer A's undo stores for a1–a6. At the base the undo is itself a patch by writer A, so `store_migrations` runs
on it and a1–a6 stay stored at @3 after it; Patch's third fuzzer law (a patch followed by its undo gives back the base's
revision hash) would put them back at @1. The issue gives neither, so the undo stage reads only IDs, references,
evaluated values and notices that follow what is stored.

A rename rewriting channel targets, driver reads, bound values and constraint paths, a drop of a targeted param, and
another writer's layer kept as saved after a writer's patch (#1960; the patched stage reads its notices only by the
rule above, from what is stored); `derived_orphan` (#1961); `requires.packs` (#1957); seeded param sets; what writer
B's own patch stores; the stored form of a left-out param against a 0 after a writer's patch (the criterion reads both
on the opened document).

## Upstream tests (the Oracle lane)

The issue says no upstream test checks these criteria (its oracle page), so these tests are their local proof.
