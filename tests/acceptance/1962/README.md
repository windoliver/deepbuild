# Acceptance tests for #1962: moved and removed kinds

Written first, from issue #1962 ("Moved and removed kinds: a pack version moves a kind to another pack, or removes it
with a reason": its Scope, its four acceptance criteria and its Proof line, "The migrated corpus documents with their
notices and values, and each refused migration with its reason"), the design sections it links and those they lean on,
and base commit `55fd5b84a` ("Merge pull request #2877 …"), the worktree's HEAD and origin/main when this was written,
by a job that never saw an implementation; none existed, and no other worktree, branch or pull request was read. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding). Lean: one test per criterion, plus one for the planted program criteria 1 and 4 each name. The issue says
no upstream test checks these criteria.

## What was read

- The issue, live with `gh issue view 1962`. Its dependencies #202, #1956, #1957 and #1960 and its siblings #1958,
  #1959 and #1961 are merged at the base; their issue texts were not read, only the suites listed below, for scope and
  conventions.
- `docs/canvas-primitives.md`: Pack (fields, a version checked once and never changed); Pack: kinds in any pack; Pack:
  kind rules and the kind kit (the kit's migration part); Pack: migrations as data; Pack: dependencies (`requires.packs`
  by exact version, "a document that names the pack resolves them as if it listed them", "a new version of a pack
  reopens nothing until a patch names it"); Pack: retired and missing; Pack: assets fetched on first use (the asset
  catalog's own `moved: {old path: new path}`, the one `moved` the design spells); Migration (the `migrated` notice, a
  corpus document giving "the evaluated values and the snapshots the release that saved it recorded at its sampled
  times"); The path grammar; Path and handle (an unresolved path is `ref_unresolved`); Patch (the closed refusal
  codes); Recipe; Channel and key.
- `docs/technical-design.md`: Dogfooding; Tests written first, by a job that never sees the code; Wrong programs.
- At the base, for how the surfaces are driven: AGENTS.md; `crates/deep-show/src/main.rs` (scenario fields, the
  `planted` match), `packs.rs` (the folder loader, `install`, `packs` rows), `hub.rs` (`deep show`'s whole revision
  with `issues`, `notices`, `expansions` and `snapshots`), `shared/calls.rs` (`read` with `notices` and `opened`),
  `kit/migration.rs` (#138's `corpus_record`, which takes no pack); `crates/deep-canvas/src/document/packs.rs`
  (`check_pack`, `PACK_KEYS`, `Packs::admit`, `resolve`), `packs/deps.rs`, `packs/module_fields.rs` (a field no module
  reads is `unknown_field`), `pack_kinds.rs` (`check_kinds`, the kit's migration part), `pack_kinds/migrate.rs`
  (`at_load`, `carry_paths`, `loaded`, the `migrated` notice), `apply.rs` (#1961's pin patch), `mod.rs` (an issue's and
  a notice's JSON, `fix_for`); `crates/deep-canvas/src/registry/mod.rs` (`unremoved`, a canvas module's removed preview
  kind); `scripts/proof-change.mjs` (`criterionId`), `scripts/proof-runs.mjs` (`twins.json`), `scripts/lanes.mjs`; the
  suites `tests/acceptance/1956/` (README, helpers, a test, fixtures), `1957/` (README, test), `1958/` (README,
  helpers), `1960/` (README, helpers, a test, fixtures), `1961/` (README) and `202/` (`twins.json`). Every expected
  value comes from the issue or from the fixtures' records (Fixtures).

## What the base already does, and these tests don't credit

#306's pack store and folder loader, recipe expansion with `expansions` rows and snapshots by sha256; #202's pack kinds
and their kit; #1956's migrations as data, run at load with one `migrated` notice a step, and its corpus records; #1957's
`requires.packs`, each required version resolved as if the document listed it; #1958's missing version, whose
instances a document keeps and skips with `pack_missing`; #1960's `read` with `opened` and `deep_query` evaluating the
revision as its load opened it; #1961's pin patch. What it lacks, which is what every test here fails on:

- **No `moved` and no `removed`.** `check_pack` hands a top-level field outside `PACK_KEYS` to the canvas modules, and
  none reads these two, so every version that declares either is refused with `unknown_field` at `moved` or `removed`:
  acme/shelf@2.0.0 in each of its variants but one, and acme/furniture@3.0.0.
- **A kind can disappear silently.** The variant of acme/shelf@2.0.0 that ships nothing and lists nothing installs.
- So a document upgraded to a refused 2.0.0 names a version the store lacks, and opens as #1958 left it: its bookcases
  kept, skipped with `pack_missing`, no expansion, no `migrated`, a snapshot of an empty board. A document that names
  the dropped 2.0.0, which the base installs, opens with the bookcases skipped as `unknown_kind` notices, never refused
  (a probe of the fixture script, not kept).
- Neither planted value is a planted name (the `planted` match ends `_ => return None`), so those scenarios answer
  `bad_input`.

`BASE-FAILURE.txt` holds the one run on the base: all six tests fail there.

## Run them

They build `deep-show`, so the folder runs alone: `scripts/lanes.mjs` needs `'tests/acceptance/1962/'` in its `alone`
list. This README is the instruction; the implementer makes that edit.

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/1962 --no-file-parallelism --testTimeout=600000
npx tsc --noEmit -p tests/acceptance/1962
```

Each file builds `deep-show` once (`cargo build --locked --bin deep-show --no-default-features --features r1`, honoring
`CARGO_TARGET_DIR`, with `CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` unless set; `cargo` must be on `PATH`),
copies the binary to a temporary folder and fails each test whose build failed. Every process gets a fresh evidence
folder and its own pack store; every temporary folder is deleted. Node built-ins and vitest only. Headless, on the CPU,
no timings (the issue states none).

## The surface under test

`deep-show run`, one scenario JSON line on stdin, one reply per call, as #306, #1956, #1958 and #1960 left it. Scenario
fields, all existing: `packs: [{id, dir}]` (offered to the store in order before the first call, earlier versions
first), `docs.<id>.document` (a shared document seeded as stored), `sessions` (writer A, `sess-alpha`), `processes`,
`panels`, `planted`. Calls, all existing: `packs` (`{packs: [{pack, version, state, issues}]}`); `deep show` from your
shell with a whole revision, `t`, `size` and `include: ["issues", "pixels"]` (reply: `outcome`, `issues`, `notices`,
`expansions`, `snapshots: [{sha256}]`); `read` (`issues`, `expansions`, `notices`, `opened`); and `deep_query` from
writer A's session (`{session, doc, items: [], paths, at}`, reply `values[path]`, one value per time).

### Opening a corpus document under a version

A document names each pack version, and a new version reopens nothing until a patch names it (Pack: dependencies). As
#1956's and #1960's suites do, **"upgraded" is the document with its `packs` entry naming the new version, as the patch
that takes that version writes it**, each item still as saved: presented as a whole revision from your shell
(criteria 1 and 3), or seeded as a shared document with every item in writer A's layer `main` (criterion 4). The
document upgraded to acme/shelf@2.0.0 lists `acme/shelf@2.0.0` alone; furniture@1.0.0 (or 2.0.0) comes through its
`requires.packs`.

### Choices

**Every name below that the issue doesn't give is this job's invention**, the smallest surface consistent with the
design and the base; the implementer builds exactly these, or a dispute goes to a blind redraft.

- **`moved` and `removed` are top-level fields of a pack's `pack.json`**, beside `requires` and `kinds`, spelled as the
  issue spells them: `moved: {"shelf.bookcase@2": "furniture/case@1"}`, a key `<pack>.<name>@<major>` (a kind an
  earlier version of the pack shipped) and a target `<pack>/<name>@<major>`, the kind `<pack>.<name>@<major>` (here
  `furniture.case@1`) of that pack, the same pack or one its `requires.packs` lists; `removed: {"shelf.bookcase@2":
  "superseded"}`, the kind and its reason as a string.
- **A pack check that reads earlier versions reads the store.** Whether a version drops a kind is judged against the
  earlier versions of the same pack (`owner/name`) the store holds when it is offered: every test offers
  acme/shelf@1.2.0 first, and furniture@1.0.0 before 2.0.0 and 3.0.0. A target is followed into the version of its pack
  that `requires.packs` names (or into the version itself), which the store holds.
- **A target "exists"** when its pack's version carries that kind at that major, or carries the kind at a later major
  with the steps from that one (Scope: the move "applies the target's migration steps from that major"; criterion 4
  needs it: `furniture/case@1` against furniture@2.0.0, which carries `furniture.case@2` and the step from 1).
- **A refused `moved` entry** is an error (severity `error`) on the refused version's `packs` row whose `path` is the
  entry's place, `moved/<key>` (`moved/shelf.bookcase@2`), and whose `actual` holds `reason` (the tests also take
  `reason` at the issue's top level), one of:

  | Reason | When | Code |
  |---|---|---|
  | `target_moved` | the target is itself a key of its pack version's `moved`: a chain longer than one step | `out_of_range` |
  | `loop` | following the targets comes back to the entry's own key (here at once: its target is its key); a loop is `loop`, though its target is also moved | `cycle` |
  | `undeclared_pack` | the target's pack is neither the version's own nor in its `requires.packs`, though the store holds it | `ref_unresolved` |

  `cycle` is the closed code the design already gives a loop (pack graphs, recipe chains); `ref_unresolved` is what
  #1957 gave a step that names a kind of an undeclared pack.
- **A silent removal**: a version that no longer ships a kind an earlier version of its pack in the store shipped, and
  lists it under neither `moved` nor `removed` (nor carries it at a later major), is refused with an error
  `unintended_removal` (a closed refusal code) whose JSON names the kind as `shelf.bookcase@2`.
- **A refused upgrade**: a document that names a version listing its items' kind under `removed` is refused
  (`outcome: "refused"`): each such item is in the `ids` of an error `unknown_kind` (the code the base already gives an
  item whose kind no installed version carries, as a notice) whose `fix` names the item, as a sentence such as "Delete
  b1, b2 and b3, or keep acme/shelf@1.2.0, whose shelf.bookcase@2 acme/shelf@2.0.0 removed (superseded)." One error may
  name all three.
- **`migrated` on a move**: one `migrated` notice (the core's notice, `ids` naming the item) for each moved item, read
  on the whole revision's `notices`; one notice with all three IDs counts once for each. The tests read only its `ids`.
- **A corpus record may hold `snapshot`**, `{t, size, sha256}`: the snapshot the release that saved the document drew
  at time `t` in a `size` pixel `deep show`. Only the room's record holds one. The tests read it; no pack check reads it.
  `sampled` is #1960's member, held by the lift's record.

### `planted` values (scenario field; new, reachable only there)

| Value | Criterion | The wrong program |
|---|---|---|
| `loader_drops_moved_instances` | `#1962.6edffdaf` | the load drops every instance of a kind its pack's version lists under `moved` (the old name), so none of them opens, draws or raises `migrated` |
| `move_rewrites_kind_only` | `#1962.f5eb6b43` | the load's move rewrites each moved instance's kind to its target and runs the target's steps on its params, and carries no path, so a channel keyed on the old param is left `ref_unresolved` |

Both plant the load only: the pack check is unchanged under either, so every version still installs and the documents
open. `twins.json` maps each criterion to its planted value or to its planted pack folders, as #1956's and #1960's
suites do.

## Fixtures (`fixtures/packs/`)

Pack IDs carry an outside owner (`acme/…`), as `PackId::parse` needs. Every kind is a pack kind backed by a recipe of the
same name, cost class `figure` at `{cpu_ms 0.5, gpu_ms 0.2, items 7}`, and every recipe draws one picture at 100 u a
metre from its own params: two sides 40 u a level tall (`shelves * 40`, or `tiers * 40` at `furniture.case@2`), four
boards a quarter of that apart, and a plan strip under them `depth * 100` u deep. No repeat counts by the level param,
so a channel may key it. Params: width (m, 0.5–3.0, default 1.2), the level param (integer 1–8, default 4), depth (m,
0.1–1.0, default 0.3). No description names an item ID or a pack version.

| Folder | Version | What it holds |
|---|---|---|
| `shelf-1.2.0` | `acme/shelf@1.2.0` | `shelf.bookcase@2` {width, shelves, depth}; its step from 1 `{rename {levels: shelves}, set {depth: old.width * 0.25}, drop []}` (a kind at major 2 must ship it); corpus 1 `case-1.json` (`c1` at @1, for the kit) and 2 `room.json` and `lift.json` |
| `furniture-1.0.0` | `acme/furniture@1.0.0` | `furniture.case@1` {width, shelves, depth}, `migrate {}` |
| `furniture-2.0.0` | `acme/furniture@2.0.0` | `furniture.case@2` {width, tiers, depth}; step from 1 `{rename {shelves: tiers}, set {}, drop []}`; corpus 1 `case-1.json` |
| `furniture-3.0.0` | `acme/furniture@3.0.0` | `furniture.cabinet@1`; `moved {furniture.case@1: furniture/cabinet@1}` |
| `shelf-2.0.0` | `acme/shelf@2.0.0` | `requires.packs ["furniture@1.0.0"]`, `moved {shelf.bookcase@2: furniture/case@1}`; no kind, no recipe |
| `shelf-2.0.0-chain` | `acme/shelf@2.0.0` | planted: `requires.packs ["furniture@3.0.0"]`, `moved {shelf.bookcase@2: furniture/case@1}` |
| `shelf-2.0.0-loop` | `acme/shelf@2.0.0` | planted: `moved {shelf.bookcase@2: shelf/bookcase@2}` |
| `shelf-2.0.0-undeclared` | `acme/shelf@2.0.0` | planted: no `requires.packs`, `moved {shelf.bookcase@2: furniture/case@1}` |
| `shelf-2.0.0-dropped` | `acme/shelf@2.0.0` | planted: nothing of the bookcase, no `moved`, no `removed` |
| `shelf-2.0.0-removed` | `acme/shelf@2.0.0` | `removed {shelf.bookcase@2: "superseded"}`, nothing else |
| `shelf-2.0.0-tiers` | `acme/shelf@2.0.0` | `requires.packs ["furniture@2.0.0"]`, `moved {shelf.bookcase@2: furniture/case@1}` |

Corpus records (`{document, values}` as #1956 reads them, each listed in `assets` with its `sha256` and `size`):

- `room.json`, **the corpus document** of criteria 1 and 3: a 480 × 280 board naming `acme/shelf@1.2.0`, with `b1`
  {width 1.2, shelves 3, depth 0.3} at (20, 20), `b2` {0.8, 4, 0.5} at (180, 20) and `b3` {1.6, 2, 0.4} at (300, 20),
  each at `shelf.bookcase@2`; `values`, the 21 derived items (`b1.sides.0` … `b3.plan`, each `{kind, params, at}`);
  and `snapshot`, `{t: "0s", size: [480, 280], sha256: "e006448e…"}`.
- `lift.json`, the document of criterion 4: `b1` {width 1.6, shelves 4, depth 0.4} at `shelf.bookcase@2` and the
  channel `lift` on `items/b1/params/shelves`, ten held keys a second apart (4, 5, 6, 7, 8, 6, 3, 2, 1, 5), 10 s long;
  its `values`; and `sampled`, the 100 times from 0.05 s to 9.95 s, the middle of every tenth of a second, with the
  value at `items/b1/params/shelves` at each.
- `case-1.json` in shelf-1.2.0 and furniture-2.0.0: one item `c1` saved at major 1 ({width 2, levels 4} and {width 2,
  shelves 4, depth 0.5}), for the kits' migration part; no test reads them.

**Where each recorded value comes from.** A script this job ran once, kept out of the repo, wrote the folders and
recorded every value with the base binary (`deep-show` of `r1` at `55fd5b84a`) under acme/shelf@1.2.0, the release
that saved the documents: the room's `values` and `snapshot` from its whole revision under that version; the lift's
`values` from `read` and `sampled` from `deep_query` at the 100 times; each `case-1.json`'s values from the expansion of
its migrated params through the same steps as a plain recipe. Each test first holds its record to the binary: the room
and the lift under acme/shelf@1.2.0 give the recorded values, snapshot hash and sampled values again. Probes on the
base binary, not kept, showed the values reachable: the room with its bookcases written by hand at `furniture.case@1`
under furniture@1.0.0 drew to the recorded hash and expanded to the recorded values, and the lift written at
`furniture.case@2` with tiers and the channel on `items/b1/params/tiers`, under furniture@2.0.0, gave the recorded
values with no error.

## Criteria to tests

Each test's name starts with its criterion's ID, `#1962.` and the first eight hex digits of the SHA-256 of the
criterion's text, trimmed and white space collapsed (`scripts/proof-change.mjs`, `criterionId`, on the live issue
body). Each file's head quotes its criterion and says what it asserts. Each planted program runs in a test of its own,
with its criterion's check.

| ID | File | Tests | What they assert | Wrong program it fails on |
|---|---|---|---|---|
| `#1962.6edffdaf` | `moved.test.ts` | 2 | (1) shelf@1.2.0, furniture@1.0.0 and shelf@2.0.0 install; the room under shelf@1.2.0 gives its record (fixture); the room pinned to shelf@2.0.0 is presented with no error, b1, b2 and b3 each expand as `furniture.case@1` to exactly the values recorded for it, each is named by one `migrated`, and the snapshot is the recorded hash. (2) under `loader_drops_moved_instances` all three install and the check fails naming b1, b2 and b3 | the merge base (shelf@2.0.0 refused, the bookcases skipped); the planted loader |
| `#1962.248e8322` | `refusals.test.ts` | 1 | three stores: shelf-2.0.0-chain refused with `out_of_range` at `moved/shelf.bookcase@2`, reason `target_moved`, after furniture@3.0.0 installs; shelf-2.0.0-loop with `cycle`, `loop`; shelf-2.0.0-undeclared with `ref_unresolved`, `undeclared_pack`, with furniture@1.0.0 installed | the merge base (each refused as `unknown_field` at `moved`, furniture@3.0.0 too); a check that admits a planted entry or refuses it without its place or its reason |
| `#1962.1c118241` | `removed.test.ts` | 1 | shelf-2.0.0-dropped refused with `unintended_removal` naming `shelf.bookcase@2`; shelf-2.0.0-removed installs; the room on shelf@1.2.0 draws to the recorded hash (fixture); the room pinned to shelf-2.0.0-removed is refused, each of b1, b2 and b3 in the `ids` and the `fix` of an `unknown_kind` error; the room on shelf@1.2.0 then draws to the same hash as before | the merge base (the dropped version installs, the removed one is refused, the room opens with its bookcases skipped); the planted dropped version |
| `#1962.f5eb6b43` | `channel.test.ts` | 2 | (1) shelf@1.2.0, furniture@1.0.0, furniture@2.0.0 and shelf-2.0.0-tiers install; the lift under shelf@1.2.0 gives its record (fixture); the lift pinned to shelf-2.0.0-tiers opens with b1 as `furniture.case@2`, `opened` holding the channel on `items/b1/params/tiers`, no error, and `deep_query` there giving the recorded value at each of the 100 times. (2) under `move_rewrites_kind_only` all four install, b1 opens as `furniture.case@2`, the channel is `ref_unresolved`, and the check fails naming `lift` | the merge base (shelf-2.0.0-tiers refused, b1 skipped); the planted migrator |

## Readings where the issue leaves a choice

- **"The corpus document"** (1, 3) is a document of acme/shelf@1.2.0's own corpus, at major 2: the release that shipped
  `shelf.bookcase@2` saved it, so its record holds what that release drew (Migration). shelf.bookcase@2 is a pack kind,
  not a plain recipe, so "a kind a pack drops" reads one way whichever map the check looks in; a kind at major 2 must
  carry the step from 1 and a corpus document of major 1 (#1956), which shelf@1.2.0 does.
- **"Opens its 3 bookcases as `furniture.case@1` with the values recorded for them"** (1): each bookcase's `expansions`
  row has `kind` `furniture.case@1` and its `derived` items equal the record's, ID for ID, `kind`, `params` and `at`,
  numbers as numbers, and no derived item the record lacks. furniture.case@1's recipe draws as shelf.bookcase@2's from
  the same params, so a move that carries every value reproduces them.
- **"Draws to the snapshot hash recorded for it"** (1): the whole revision's one snapshot, drawn at the record's `t` and
  `size`, has the recorded `sha256`. The recorded hash is the base binary's CPU draw on this Mac (darwin-arm64); each
  test that reads it first holds it to the binary with the room as saved, so a machine that draws other bytes fails at
  that fixture check, never at a criterion's.
- **"Fails, naming the items"** (1) and **"fails, naming the channel"** (4): as #1956's and #1960's suites read their
  planted programs, the failures are sentences this suite's checks write from the replies; under the plant the
  criterion's own check must return a failure that names each item (b1, b2, b3) or the channel (`lift`) as a word.
- **"Naming the entry and the reason"** (2): the entry by its place, `moved/shelf.bookcase@2`; the reason by `reason`
  (Choices). The loop is the one-entry loop, a move whose target is its own source: the smallest that "loops back to its
  source" with no kind that no release shipped, and with no pack cycle, which a loop through another pack would make and
  #1957 would refuse first. The undeclared target's pack is installed, so the only fault is the undeclared pack (as
  #1957's suite installs lamp first). The chain's middle pack, furniture@3.0.0, moves the case on to a kind of its own,
  so the only fault is the second step.
- **"Refused at pack check, naming the kind"** (3): the version's `packs` row is `refused` with an `unintended_removal`
  error naming `shelf.bookcase@2`. The removal is judged against acme/shelf@1.2.0 in the store (Choices).
- **"Upgrading the corpus document is refused with a fix, naming the 3 items"** (3): the room pinned to the removing
  version is refused, and the three items are named in the `ids` and in the `fix` of the refusal's `unknown_kind`
  errors, so the fix is the refusal's own and never the catch-all or the code's generic one.
- **"The document on shelf@1.2.0 still draws to the same snapshot hash"** (3): with the removing version installed, the
  room as saved is presented to one document, which draws to the hash recorded for it (the fixture); the upgrade is
  presented to the same document and refused; then the room as saved, presented again, draws to the same hash as
  before.
- **Criterion 4's move renames.** A move to a target at the target pack's current major changes no param, so a
  migrator that skips the paths would leave every channel resolved and no planted program could fail. The Scope's move
  "applies the target's migration steps from that major", so criterion 4 upgrades to a 2.0.0 that requires
  furniture@2.0.0, whose case is at major 2 and renames shelves to tiers in its step from 1: the moved b1 opens as
  `furniture.case@2` with `tiers`, and the channel must follow it to `items/b1/params/tiers` (#1960's rename carrying
  every path). That 2.0.0 is another variant of acme/shelf@2.0.0, never in a store with criterion 1's.
- **"Keeps its evaluated values at 100 sampled times"** (4): at each time of the record's `sampled`, `deep_query`'s value
  at the path the channel is on after the upgrade, `items/b1/params/tiers`, equals the value recorded at
  `items/b1/params/shelves`; and `read`'s `opened` holds the channel there with no error raised. Numbers compare as
  numbers, within 1e-9.
- **"Leaves the channel `ref_unresolved`"** (4): under the plant `read` raises a `ref_unresolved` error about
  `channels/lift/target` (at that place, under that entry, or naming either path). The plant still moves and renames,
  so b1 still opens as `furniture.case@2`.

## Not tested, because no criterion asks

A move within the same pack that succeeds; a version that keeps a move an earlier version declared, or drops it; a
`moved` key naming a kind no earlier version shipped; the pack check running a pack's corpus through a move; a moved
item's stored bytes before and after its writer's patch, and the pin patch itself (the Scope's "stored bytes stay as
they were until the writer patches, as for any migration", #1960's store); `deep_kinds` listing moved or removed kinds;
`deep try`; the `migrated` notice's `kind`, `from` and `to` on a move; a `removed` reason other than a string; driver
reads, bound values and constraint paths on a moved item (#1960 holds them for a rename); a drop of a param a path
targets; anything timed.

## Upstream tests (the Oracle lane)

The issue's Oracle line says no upstream test checks these criteria, so these tests are their local proof. The page it
links was not read.
