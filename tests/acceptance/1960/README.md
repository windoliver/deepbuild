# Acceptance tests for #1960: migrated references and writer patches

Written first, from issue #1960 ("Migrated references and writer patches: a rename carries every path that names the
param, and a patch stores only the writer's own items": its Scope, its three acceptance criteria and its Proof line,
"The migrated corpus documents with their notices and values, and each refused migration with its reason"), the design
sections it links and those they lean on, and base commit `d8c46f0d5` ("Merge pull request #2601 …"), the worktree's
HEAD and origin/main when this was written, by a job that never saw an implementation; none existed, and no other
worktree, branch or pull request was read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute
goes to a blind redraft of this job (design: Dogfooding). Lean: one test per criterion, plus one for the planted program
each criterion names; criterion 1's test also holds its pack check clause. The issue says no upstream test checks these
criteria.

## What was read

- The issue, live with `gh issue view 1960`; its parent #203, epic #219 and siblings #1956, #1959 and #1961 only for
  scope.
- `docs/canvas-primitives.md`: Pack: migrations as data ("A `rename` also rewrites every channel target, driver read,
  bound value and constraint path that names the old param, and a `drop` of a param some path targets refuses the
  migration, naming the path"; "After a migrated load, a writer's patch stores the migrated kind and params of the items
  in its own layer and nothing of another writer's layer, and a later load migrates those items no further and raises no
  `migrated` for them"); Migration ("the stored document changes only when its writer next patches it"; a corpus
  document "gives the evaluated values … the release that saved it recorded at its sampled times"); The path grammar;
  Path and handle ("an unresolved path is `ref_unresolved`"); Writer layer; Patch (`set {id, path, value}`, undo);
  Revision (layer files by hash, the restart); Channel and key; Driver ("each path var of a driver resolve[s] at check
  as a channel's target does"); Bound value; Constraint; Document envelope; Pack: kinds in any pack; Recipe.
- `docs/technical-design.md`: Criteria to tests, both ways; Wrong programs; Dogfooding.
- At the base, for how the surfaces are driven: `crates/deep-show/src/main.rs` (scenario fields, the `planted` match,
  the calls), `shared.rs` (shared documents, `read` with `notices` and `files`, a patch and `store_migrations`, undo,
  `restore` from the state folder, `layer_file`), `hub.rs`, `packs.rs`, `query.rs` (`deep_query`'s `values` at the
  times of `at`); `crates/deep-canvas/src/document/pack_kinds/migrate.rs`, `packs.rs` (`driven_counts`, `expand`) and
  `check.rs` (`check_targets`, `resolve`, `check_constraints`); `crates/deep-canvas-motion/src/doc.rs`, `program.rs`
  and `constraint.rs` (how a document writes channels, drivers and constraints, and a `follow_path`'s `fraction`);
  `scripts/proof-change.mjs` (`criterionId`); the suites `tests/acceptance/1959/` in full, and `1956/` and `1961/`.
  Every expected value comes from the issue.

## What the base already does, and these tests don't credit

#1956 and #1959 landed pack migrations as data: each item migrates at load from its own saved major with one `migrated`
notice a step, `read` carries the `notices` and each layer file's hash (`files`), and a writer's patch stores the
migrated kind and params of the items in its own layer and leaves another writer's as saved (on a patch that creates an
item: probed once, a later restart raises `migrated` for b1 to b6 only, writer B's file keeps its hash, and an undo
applies after a restart). A channel's or a bound value's target that reaches nothing is `ref_unresolved`
(`check_targets`), and `deep_query` gives a channel's and a driver's evaluated values at the times asked when nothing
migrates. What it lacks, which is what every test here fails on:

- **A rename carries no path.** The pack check of acme/shelf@2.0.0 refuses it, because its @1 corpus document's channel
  on `items/b1/params/levels` is left `ref_unresolved` once b1 has `shelves`; the scene loads with its channel and its
  bound value `ref_unresolved`.
- **A driver's read and a constraint's path aren't resolved at check.** A driver var that names a param its item
  doesn't hold reads 0 and raises nothing. A constraint has no path form at all: a `follow_path` whose `fraction` is
  `{path}` raises nothing on `read`, and with it in the document `deep_query` gives no channel or driver its value.
- **`deep_query` evaluates the stored items**, filled with the new major's defaults (a2's `span` reads 1.2, not 1.6).
- **`read` has no `opened`**, so no path reads as the load left it.
- **A `drop` of a param a path targets isn't checked**: the planted drop installs.
- **A patch's `set` on an item saved at an earlier major is refused** with `unknown_kind` ("kept as written, and never
  patched"), so writer A's patch on a3 never applies.
- None of the three planted values is a planted name (the `planted` match ends `_ => return None`, so those scenarios
  answer `bad_input`).

`BASE-FAILURE.txt` holds the one run on the base: all six tests fail there.

## Run them

They build `deep-show`, so the folder runs alone: `scripts/lanes.mjs` needs `alone.push('tests/acceptance/1960/');`
beside #1959's line. This README is the instruction; the implementer makes that edit.

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1960 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1960/tsconfig.json
```

Each file builds `deep-show` once (`cargo build --locked --bin deep-show --no-default-features --features r1`, honoring
`CARGO_TARGET_DIR`, with `CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` unless set; `cargo` must be on `PATH`),
copies the binary to a temporary folder and fails each test whose build failed. Every process gets a fresh evidence
folder; a restart shares only the hub state folder with the run before it; every temporary folder is deleted. Node
built-ins and vitest only. Headless, on the CPU, no timings.

## The surface under test

`deep-show run`, one scenario JSON line on stdin, one reply per call, as #306, #1956, #1959 and #1961 left it. Scenario
fields, all existing: `packs: [{id, dir}]` (acme/shelf@1.0.0, @2.0.0 and @3.0.0 offered in that order, or 1.0.0 and one
planted 2.0.0), `docs.<id>.document` (a shared document seeded as stored), `sessions` (writer A and writer B),
`processes`, `panels`, `record` (one reading, held for no session), `state`, `planted`. Calls, all existing: `packs`,
`read`, `deep_query` (`{session, doc, items: [], paths, at}`: no rows, `values[path]` one value per time of `at`), and
`deep_show` with `patch` or `undo: {patch, of}` from writer A's session. **Every name below that the issue doesn't give
is this job's invention**, the smallest surface consistent with the design and the base; the implementer builds exactly
these, or a dispute goes to a blind redraft.

- **Writers A and B** are two agents' sessions, `sess-alpha` (thread `thread-alpha`) and `sess-beta` (`thread-beta`).
  Writer A's layer is `writer-a` (`writer: agent:thread-alpha`); writer B's is `writer-b` (`agent:thread-beta`).
- **New reply field: `read` of a shared document carries `opened`**: the document of the revision it shows as its
  load's migration left it, before expansion. It is `document` with every item the load migrated at its migrated `kind`
  and `params`, and with every channel target, driver read, bound value target and constraint path the migration
  rewrote; where the load migrates nothing it equals `document`. `document` stays the stored document. This is the only
  new reply field, and it is how "the channel on …" and "after the load they name …" are read. The tests read four
  places in it: `channels/<id>/target`, `drivers/<id>/vars/<name>`, `bound_values/<id>/target` and
  `constraints/<id>/fraction/path`.
- **New document form: a constraint's path.** At the base no field of a constraint holds a path in the path grammar
  that names a param (a `follow_path`'s `fraction` is a number or `{data: <name>}`, a keyed data value). The suite
  writes "a constraint path" as a `follow_path` whose fraction reads a path:
  `fraction: {path: "items/b2/params/width"}`. The fraction is the number at that path, read each frame as `{data}`
  reads a keyed data value and clamped to 0..1 as any fraction is; the path resolves at check as a channel's target
  does, so one that reaches nothing is `ref_unresolved`. The tests read only the path's name after the load and its
  `ref_unresolved` under the planted migrator, never the pose it gives.
- **New behaviour, `ref_unresolved` for a driver's read and a constraint's path.** A driver's path var and a
  constraint's `fraction.path` that reach nothing raise an error issue with code `ref_unresolved`, as a channel's and a
  bound value's target do at the base. The tests take an error to be about a path when its `path` is the path's place
  (`drivers/<id>/vars/<name>`, `bound_values/<id>/target`, `constraints/<id>/fraction/path`, `channels/<id>/target`) or
  lies under its entry (`drivers/<id>`, …), or when its JSON holds the path's text, as saved or as it must open.
- **New behaviour, `deep_query` evaluates the revision as its load opened it**: each migrated item at its migrated kind
  and params and each path as rewritten. A channel's evaluated value is read at the path it is on after the load
  (`items/a1/params/shelves`), a driver's at the path it writes (`items/gauge-a/at/pos/0`).
- **New behaviour, a patch's `set` applies to the item as the load migrated it**: writer A's
  `{op: "set", id: "a3", path: "items/a3/params/shelves", value: 5}` on revision 0 applies though a3 is stored at
  shelf.bookcase@1 with `levels`.
- **New behaviour, the pack check refuses a `drop` a path targets**: the `packs` row of that version reads
  `state: "refused"` and one of its error issues holds, anywhere in its JSON, the path that targets the dropped param,
  `items/b1/params/dividers` (its `path`, `actual`, `what` or any other field).
- **"Loaded"**: `read` of the seeded shared document (revision 0). **"After a restart"**: a new `deep-show run` process
  with a fresh evidence folder, the same `state` folder, the same seed and the same pack versions, then `read`.
- **Opening a corpus document**: the record's `document` seeded as a shared document, with its `packs` entry naming the
  version it opens under, as the patch that takes that version writes it, and every item in one layer, `main`, writer
  A's, as the hub stamps a shown revision (`stored` in `helpers.ts`). Its item stays at the major it was saved at. The
  record itself holds the document with no layer, as the pack check stamps it.
- **New member of a corpus record: `sampled`**, `{times: [time literal], values: {<path> → [number]}}`: the evaluated
  value at each path at each sampled time, as the release that saved the document recorded it (Migration). Only the
  channel document's record holds one. The tests read it; the base's pack check ignores it and may go on ignoring it.

### `planted` values (scenario field; new, reachable only there)

| Value | Criterion | The wrong program |
|---|---|---|
| `migration_renames_params_only` | `#1960.fc74f8ec` | the load's migrator renames each item's params and rewrites no path, so a channel keyed on the old param is left `ref_unresolved` |
| `migration_rewrites_channel_targets_only` | `#1960.5e2a1e73` | the load's migrator rewrites channel targets and nothing else, so a driver's read, a bound value's target and a constraint's path that name the old param are left `ref_unresolved`, each raised as its own error |
| `store_migrated_params_under_saved_major` | `#1960.40e69d87` | on a writer's patch the store writes the migrated params of the items in its layer and leaves each item's `kind` at the major it was saved at, so the next load migrates a1 to a6 again and raises `migrated` for them |

The first two plant only the migration at load, and the third only the store: the pack check's corpus run is unchanged
under all three, so every pack version still installs and the documents open. Under the third the patch still applies.

`twins.json` maps each criterion to its planted values and its planted pack folder, as #1956's suite does.

## Fixtures (`fixtures/`)

All packs are `acme/shelf` (an outside owner, as `PackId::parse` needs) with one kind, its recipe of the same name, and
cost class `figure` at `{cpu_ms 0.5, gpu_ms 0.2, items 10}`. Each major draws the same picture at 100 u a metre from its
own params: two sides `levels * 40` u tall, four boards a quarter of that height apart, one upright wall per divider
evenly spaced, and a plan strip under them as deep as the bookcase. No repeat counts by levels or shelves, unlike
#1959's recipes: a channel on a param a repeat counts by is refused at the base ("a count is fixed at check, so no
channel or driver may move it"), and criteria 1 and 2 key a channel on exactly that param. The pack folders, the scene
and the recorded values were written by a script this job ran once against the base binary and kept out of the repo;
the files are what the tests read.

| Folder | Version | What it holds |
|---|---|---|
| `packs/shelf-1.0.0` | 1.0.0 | `shelf.bookcase@1`: width (m, 0.5–3.0, default 1.2), levels (1–8, default 4), dividers (0–3, default 1); plan strip `width * 25` u deep; `migrate: {}`, no corpus |
| `packs/shelf-2.0.0` | 2.0.0 | `shelf.bookcase@2`: width, shelves (1–8, default 4), depth (m, 0.1–1.0, default 0.3), dividers; plan strip `depth * 100` u deep; step 1 `{rename {levels: shelves}, set {depth: old.width * 0.25}, drop []}`; corpus 1 (`case-1.json` and `lift.json`, the channel document) and 2 (`case-2.json`) |
| `packs/shelf-3.0.0` | 3.0.0 | `shelf.bookcase@3`: span (m, 0.4–3.0, default 1.2), shelves, depth, partitions (0–3, default 1); step 1 as 2.0.0's and step 2 `{rename {width: span, dividers: partitions}, set {}, drop []}`; corpus 1 (`case-1.json`), 2 and 3 |
| `packs/shelf-2.0.0-drops-read` | 2.0.0 | planted: `shelf.bookcase@2` with no dividers (no walls), step 1 as 2.0.0's with `drop: [dividers]`; its @1 corpus document `drop-read.json` holds a driver whose var reads `items/b1/params/dividers` |
| `packs/shelf-2.0.0-drops-unread` | 2.0.0 | the control: the same kind and step; in its @1 corpus document `drop-unread.json` the driver reads `items/b1/params/width`, which the step keeps |

Corpus records (`corpus/*.json`, `{document, values}` as #1956 reads them, each listed in `assets` with its `sha256`
and `size`): `lift.json`, b1 at @1 {width 1.6, levels 4} with the channel `lift` on `items/b1/params/levels`, ten held
keys a second apart (4, 5, 6, 7, 8, 6, 3, 2, 1, 5), and `sampled` at 100 times, the middle of every tenth of a second
from 0.05 s to 9.95 s; `case-1.json`, `case-2.json` and `case-3.json`, `case1` at @1 {width 1.6, levels 4}, @2 {width
1.6, shelves 4, depth 0.4} and @3 {span 1.6, shelves 4, depth 0.4}; `drop-read.json` and `drop-unread.json`, b1 at @1
{width 1.6, levels 4, dividers 0}, a rect `marker` and the driver `count` (`n * 10` to the marker's x). Every `values`
and the `sampled` values are the base binary's under acme/shelf@1.0.0, the release that saved @1: the expansion of the
equivalent @1 document, and the channel's value at each sampled time. dividers 0 draws no wall, so the planted drop and
its control expand at @2 to the values recorded at @1 and differ only in what their driver reads.

`mixed-versions.scene`: the issue's lifecycle fixture, a stored board in JSON (its profile is `board`, since the shelf
pack draws 2D rects and the suite builds `r1`), 10 s long: `packs: ["acme/shelf@3.0.0"]`; layers `writer-a` and
`writer-b`; a1–a6 in `writer-a` at `shelf.bookcase@1` {width 1.6, levels 4}; b1–b6 in `writer-b` at
`shelf.bookcase@2` {width 1.6, shelves 4, depth 0.4}; a rect `gauge-a` in `writer-a` and a rect `gauge-b` in
`writer-b`; and the four paths of criterion 2:

| Entry | Its path, as saved | After the load |
|---|---|---|
| channel `rise`: `target`, five held keys (4 at 0 s, 6 at 2 s, 3 at 4 s, 8 at 6 s, 5 at 8 s) | `items/a1/params/levels` | `items/a1/params/shelves` |
| driver `reach`: `vars.w`, in `w * 100 + t * 2` with `t` the time, written to `items/gauge-a/at/pos/0` | `items/a2/params/width` | `items/a2/params/span` |
| bound value `stock`: `target`, its `source` the record's one reading | `items/b1/params/width` | `items/b1/params/span` |
| constraint `slide`: `fraction.path`, a `follow_path` of `gauge-b` along `[[0, 0], [100, 0]]` | `items/b2/params/width` | `items/b2/params/span` |

The channel and the driver name only writer A's items and the bound value and the constraint only writer B's, so each
entry's path belongs with one writer's layer. #1959's two tags are left out: no criterion here reads a parent.

`mixed-versions.recorded.json`: the values recorded for the scene's channel and driver at the 101 times, every 0.1 s
from 0 to 10 s (`0.0s` … `10.0s`): what the base binary gives under acme/shelf@1.0.0 for writer A's half of the scene
(a1–a6 as saved at @1, `gauge-a`, the channel and the driver), the channel's value read at `items/a1/params/levels`
and the driver's at `items/gauge-a/at/pos/0`. The channel's steps through 4, 6, 3, 8, 5; the driver's rises from 160
to 180.

Each test checks its fixture against its criterion before it runs. One probe, not kept, loaded the scene as a right
load would leave it (all 12 at @3, the four paths rewritten, the constraint left out) on the base binary: it gave the
recorded values, and the patch, the restart, the undo and the second restart gave what criterion 3 says.

## Criteria to tests

Each test's name starts with its criterion's ID, `#1960.` and the first eight hex digits of the SHA-256 of the
criterion's text, trimmed and white space collapsed (`scripts/proof-change.mjs`, `criterionId`, on the live issue
body). Each file's head quotes its criterion and says what it asserts. Each planted program runs in a test of its own
in its criterion's file, with that criterion's check.

| ID | File | Tests | Wrong program it fails on |
|---|---|---|---|
| `#1960.fc74f8ec` | `channel.test.ts` | 2 | (1) the channel document opens at @2 with the channel on shelves and the recorded values at the 100 sampled times, and the planted drop is refused naming the driver's path while its control installs: the merge base (2.0.0 refused for the channel left unresolved; the planted drop installs), a pack check that refuses every drop, or one that refuses without the path. (2) `migration_renames_params_only`, whose load leaves the channel `ref_unresolved` and fails the check naming `lift`; the merge base (unknown planted value) |
| `#1960.5e2a1e73` | `paths.test.ts` | 2 | (1) the four paths after the load and the channel's and the driver's recorded values at the 101 times: the merge base (no `opened`, the channel and the bound value unresolved, neither value evaluated). (2) `migration_rewrites_channel_targets_only`, whose load leaves the three other paths `ref_unresolved` and fails the check naming each; the merge base (unknown planted value) |
| `#1960.40e69d87` | `store.test.ts` | 2 | (1) the patch, the restart, the undo and the second restart: the merge base (the patch on a3 is refused). (2) `store_migrated_params_under_saved_major`, whose restart raises `migrated` for a1 again and fails the check naming a1; the merge base (unknown planted value) |

## Readings where the issue leaves a choice

- **"That document"** (criterion 2) is the Scope's lifecycle fixture, `mixed-versions.scene`: it is the document that
  holds a1, a2, b1 and b2 with a's at @1 (`levels`) and b's at @2 (`width`), and criterion 3 patches its a3. Criterion
  1's corpus document can't be it, since its b1 is saved at @1.
- **"Opens at shelf.bookcase@2"** (1): b1's `expansions` row has `kind` `shelf.bookcase@2`. **"With the channel on"**
  and **"after the load they name"** (1, 2): the path at that entry's place in `read`'s `opened`, with no error raised.
- **"The same evaluated values at 100 sampled times"** (1): at each time of the record's `sampled`, `deep_query`'s
  value at `items/b1/params/shelves` under acme/shelf@2.0.0 equals the value recorded at `items/b1/params/levels`. The
  test first holds the record to the binary: the same document under acme/shelf@1.0.0 opens clean and gives the
  recorded values. Numbers compare as numbers, within 1e-9.
- **"The channel and the driver give the values recorded for them"** (2): a channel's value is read at the path it is
  on, a driver's at the path it writes; "recorded" is `mixed-versions.recorded.json` (Fixtures).
- **"A constraint path"** (2): `follow_path`'s `fraction: {path}` (The surface under test). b2's width, 1.6, clamps to
  the path's end; no criterion reads where `gauge-b` sits.
- **"A migration that drops a param a driver reads is refused at pack check, naming the driver's path"** (1): the
  planted 2.0.0 is offered after 1.0.0 in a process of its own; "the driver's path" is the path the driver reads, the
  one that targets the dropped param, as the design's "naming the path" has it. The control holds the refusal to that
  read: the same step with a driver that reads a kept param installs.
- **"Leaves the channel `ref_unresolved` and fails, naming the channel"** (1): under the plant `read` raises a
  `ref_unresolved` error about `channels/lift/target`, and the criterion's check returns a failure naming `lift`. The
  plant still renames params, so b1 still opens as shelf.bookcase@2.
- **"Leaves the other three `ref_unresolved` and fails, naming each path"** (2): under the plant `read` raises a
  `ref_unresolved` error about each of the three, none about the channel, whose `opened` target is still carried, and
  the check returns for each of the three a failure naming its place and the path it must name.
- **The lifecycle** (3) runs in three processes on one state folder. Process 1: `read` and the 101 values (the first
  load), then writer A's patch. Process 2, "after a restart": `read`, then writer A's undo. Process 3, "a second
  restart": `read` and the 101 values.
- **"a3 opens with shelves 5"**, **"a3 shelves 4"** (3): a3's `expansions` row has `kind` `shelf.bookcase@3` and its
  sides are shelves × 40 u tall (200 u, 160 u), as each major's recipe draws them.
- **"`migrated` names only b1 to b6, for @2 to @3"** (3): among the 12 instances the restart's notices hold exactly one
  step for each of b1–b6, from 2 to 3, and none for a1–a6.
- **"Writer B's layer file has the hash it had before the patch"** (3): `read`'s `files["writer-b"]` after the restart
  equals the one the first load gave.
- **"The evaluated values of the first load"** (3): each of the 12 instances' `expansions` row's `derived` items, and
  the channel's and the driver's values at the 101 times, equal those process 1 read. The first load is held to a3's
  shelves 4 and to the recorded values, so equal values are evaluated ones.
- **References at each stage** (Scope): after the restart and after the second restart `read` raises no error, so no
  path is left `ref_unresolved` once writer A's items are stored migrated. The issue doesn't say where the store keeps
  a rewritten path that names a writer's migrated item; only that later loads resolve it and writer B's layer file
  keeps its hash.
- **"Raises `migrated` for a1 again and fails, naming it"** (3): under the plant the restart's notices hold a step for
  a1, and the restart's check returns a failure naming a1.
- **Which versions must install.** Every process offers the versions in order, earlier ones first, so the params an old
  major declares can be read from the version that shipped it or from the steps. Criterion 1's tests hold 1.0.0 and
  2.0.0 to `installed`; the scene's tests hold only 3.0.0, the version the scene names. 3.0.0's corpus holds one
  document per major and not the channel document, which is 2.0.0's, so criteria 2 and 3 fail at the base on their own
  behaviour and not on 2.0.0's refusal.
- **Ranges the issue doesn't give**: width at @1 and @2 is 0.5–3.0, so old.width × 0.25 lies inside depth's
  0.1–1.0; dividers is 0–3 with default 1 at @1 and @2, as partitions at @3.

## Not tested, because no criterion asks

The pose the constraint gives `gauge-b`, and the value the bound value shows; a `drop` of a param a channel, a bound
value or a constraint targets (the criterion names a driver's read); paths in status bindings, placements, clip
channels or a driver's `target`; what writer A's undo stores for a1–a6 (as #1959's suite left it: at the base an undo
is itself a patch of writer A's, and Patch's third fuzzer law would put them back at @1), and the `migrated` notices
after it; the first load's `migrated` notices and every instance opening at @3 (#1959); writer B's own patch; the pack
check reading `sampled`; where the stored document keeps a rewritten path; `derived_orphan` (#1961); `requires.packs`
(#1957); moved and removed kinds (#1962).

## Upstream tests (the Oracle lane)

The issue's Oracle line says no upstream test checks these criteria, so these tests are their local proof. The page
it links was not read.
