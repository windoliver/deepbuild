# Acceptance tests for #1957: pack dependencies by exact version, in the composition graph

Written first, from issue #1957 ("Pack dependencies: a pack declares the packs it builds on by exact version, in the
composition graph": its Scope, its Fields, its one acceptance criterion of four clauses and its Proof line, "Each refused
pack graph with its reason"), the design sections it links and base commit `04f44a4ba` ("Merge pull request #2230 …"),
by a job that never saw an implementation; none existed, and no other worktree, branch or pull request was read. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding). Lean: one test per clause. The issue names no planted program, so none is added: the merge base is the
wrong program each test fails on. The issue says no upstream test checks this criterion.

## What was read

- The issue, live with `gh issue view 1957`.
- `docs/canvas-primitives.md`: Pack (`requires.packs: [name@version]`; "a document names at most one pack of a name";
  a published version never changes), Pack: dependencies (exact versions; "a document that names the pack resolves
  them as if it listed them"; a step naming a recipe, a kind or a program from a pack outside the list "is refused at
  pack check, naming it"; "a cycle is refused, naming it, and two versions of one pack in one document's packs are
  refused, naming both"), Pack: kinds in any pack, Recipe (the `recipe` step op; a recipe chain's `cycle`), Pack:
  retired and missing ("A pack version reached only through another pack's `requires.packs` counts as named"), and
  Patch's closed refusal codes (`cycle` among them).
- `docs/technical-design.md`: Composition ("Packs compose the same way: a pack names the packs it uses by exact version
  in `requires.packs`, a cycle among packs is refused, naming it"; "An install whose uses would make a cycle in the
  composition graph is refused, naming the cycle").
- At the base, only for how the surfaces are driven: `crates/deep-show/src/main.rs` (scenario fields, `packs: [{id,
  dir}]`, the `packs` and `deep show` calls), `crates/deep-show/src/hub.rs` (the store's packs installed in order before
  the first call; `outcome` `presented`/`refused`), `crates/deep-show/src/packs.rs` (the folder loader, `packs` rows,
  `expansions`), `crates/deep-canvas/src/document/packs.rs` (the pack check and its refusal of `requires/packs`,
  `resolve`, nested `recipe` steps and their derived IDs), `crates/deep-canvas/src/document/pack_kinds.rs`, and the
  suites `306/`, `202/` and `1720/` (README, helpers, conventions). Every expected value comes from the issue.

## What the base already does, and these tests don't credit

#306's pack format, folder loader, store (`packs` scenario field, `packs` call with one row per version), recipe
expansion with `expansions` rows, a document's `packs` resolved by `owner/name@version`, `pack_missing`, and the refusal
of two entries of one name in a document's own `packs`; #420's nested `recipe` steps, whose derived item `<instance>.<step>`
holds the nested recipe's kind and whose own items sit under it (`<instance>.<step>.<child step>.<index>`), and `cycle`
for a recipe chain that nests itself; #202's pack kinds. The base's pack check refuses `requires.packs` outright
(`out_of_range` at `requires/packs`, "pack dependencies land with the pack versions task"), so a pack that declares a
dependency never installs; it doesn't look at a recipe step's kind from another pack at all (a step naming `lamp.desk@1`
passes the pack check of a pack with no `requires.packs`); and a document resolves only the packs it lists itself.

Found while checking the fixtures against the base, and not this issue's: a nested `recipe` step's own item (here
`r1.shelves`, kind `shelf.bookcase@2`) stays in the board as it draws, so in the `r1` build `marks2d.frame` refuses
the board with `module_missing` at `items/r1.shelves/kind`, even when the board lists every pack itself and the
nesting is inside one pack (`acme/nest`'s `nest.box@1` nesting `nest.leaf@1` gives the same). These tests therefore
read the expansion, not whether the board is presented (Readings, clause 1); drawing a nested recipe on a 2D board is
a follow-up.

## Run them

The file builds `deep-show`, so the folder runs alone: `scripts/lanes.mjs` needs `'tests/acceptance/1957/'` in its
`alone` list. This README is the instruction; the implementer makes that edit.

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1957 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1957/tsconfig.json
```

The file first runs `cargo build --locked --bin deep-show --no-default-features --features r1` (honoring
`CARGO_TARGET_DIR`, with `CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` unless set), copies the binary to a
temporary folder and fails each test if the build failed. Each test runs one `deep-show run` process with a fresh
evidence folder; every temporary folder is deleted. Node built-ins and vitest only; everything runs headless on the CPU.
`BASE-FAILURE.txt` holds the one run on the base and why each test fails there.

## The surface under test

`deep-show run`, one scenario JSON line on stdin, one reply per call, as #306 and #202 left it: the scenario's `packs:
[{id, dir}]`, offered to the store in order before the first call; the `packs` call (`{packs: [{pack, version, state,
issues}]}`, `state` `installed` or `refused`); and `deep show` (from your shell, `peer`) with `include: ["issues"]`,
whose reply has `outcome` (`presented` or `refused`), `issues` (`{code, severity, path, actual, what, …}`) and
`expansions` (`{instance, kind, pack, derived}`). **Every name below that the issue doesn't give is this job's
invention**, the smallest surface consistent with the design and the base; the implementer builds exactly these, or a
dispute goes to a blind redraft.

- **`requires.packs`** on a pack's `pack.json`, beside `requires.core` and `requires.modules`, a list of
  `"<name>@<major>.<minor>.<patch>"` strings, spelled as the design spells it (`[name@version]`): the pack's name half,
  no owner (`"shelf@1.2.0"`, `"study@1.0.0"`). A document still lists `owner/name@version`, as at the base.
- **A pack check doesn't need its dependencies installed.** It reads its own manifest and the names in
  `requires.packs`; whether a dependency is in the store matters when a document resolves it (a missing one is
  `pack_missing`, not tested here). Clause 3 needs this reading: shelf@1.2.0 can't be published twice with other bytes,
  so the only way to offer a shelf@1.2.0 that closes the cycle is after a study@1.0.0 that was admitted while no
  shelf@1.2.0 was in the store.
- **A refused pack graph is read as an error issue** (severity `error`) on the refused pack's `packs` row (clauses 2
  and 3) or on the refused document's `deep show` reply (clause 4). "Naming X" means the issue's JSON text holds X as
  the issue spells it (`lamp`; `study@1.0.0`, `shelf@1.2.0`, `shelf@1.3.0`, which an `acme/…@…` ID also holds).
- **The cycle's code is `cycle`**, the one the closed refusal codes and the recipe chain already use; its JSON names
  each pack version on the cycle, study@1.0.0 and shelf@1.2.0. The undeclared-pack refusal and the two-versions
  refusal assert no code: the issue gives none, and the design's closed list offers more than one fit.
- **Recipe names** (inventions, but for those the issue names): `study.room@1`, the reading room, in study@1.0.0 a
  single step `shelves` (`op: "recipe"`, `kind: "shelf.bookcase@2"`), and in study@1.1.0 also a step `light` (`op:
  "recipe"`, `kind: "lamp.desk@1"`); `shelf.bookcase@2` (recipe version 2.0: steps `sides`, 2, and `boards`, one per
  level, 3 levels by default, each a `rect@1`); shelf@1.3.0's `shelf.bookcase@2` at 2.1 adds a step `crown`, so its
  expansion differs from 1.2.0's; `lamp.desk@1` (steps `stem` and `shade`). The bookcase is a plain recipe, not a pack
  kind, so no kind kit is involved.
- Pack IDs carry an outside owner (`acme/…`), as `PackId::parse` needs; the issue's `study@1.0.0` is
  `acme/study@1.0.0`.

## Fixtures (`fixtures/packs/`)

| Folder | Pack | What it holds |
|---|---|---|
| `shelf-1.2.0` | `acme/shelf@1.2.0` | recipe `shelf.bookcase@2` (2.0): width (0.4–3 m, default 1.2), levels (1–8, default 3); 2 sides and a board per level |
| `shelf-1.3.0` | `acme/shelf@1.3.0` | `shelf.bookcase@2` at 2.1: the same and a `crown` |
| `shelf-1.2.0-cyclic` | `acme/shelf@1.2.0` | the 1.2.0 bookcase, with `requires.packs: ["study@1.0.0"]` |
| `study-1.0.0` | `acme/study@1.0.0` | `requires.packs: ["shelf@1.2.0"]`; `study.room@1` (1.0): step `shelves` names `shelf.bookcase@2` |
| `study-1.1.0` | `acme/study@1.1.0` | `requires.packs: ["shelf@1.2.0"]`; `study.room@1` (1.1): `shelves`, and `light` naming `lamp.desk@1` |
| `lamp-1.0.0` | `acme/lamp@1.0.0` | recipe `lamp.desk@1`: a stem and a shade |

No description in a fixture names a version or `lamp` where a refusal could echo it.

## Criteria to tests

The one criterion's ID is `#1957.d88f8e3a`, the first eight hex digits of the SHA-256 of its text, trimmed and white
space collapsed (`scripts/proof-change.mjs`, `criterionId`, on the live issue body). Each test's name starts with it and
says its clause; the file's head quotes the criterion and says what each test asserts. All four are in
`dependencies.test.ts`.

| Clause | Test | What it asserts | Fails at the base because |
|---|---|---|---|
| 1 | study@1.0.0 … expands its reading room | with shelf@1.2.0, shelf@1.3.0 and study@1.0.0 installed, a board listing only `acme/study@1.0.0` resolves its packs (no error `pack_missing`, `ref_unresolved` or `cycle`, none naming a pack version), and its reading room `r1` expands through study@1.0.0 into exactly `r1.shelves` (kind `shelf.bookcase@2`), `r1.shelves.sides.0–1` and `r1.shelves.boards.0–2`: shelf@1.2.0's bookcase, never 1.3.0's crown | study@1.0.0 is refused for `requires/packs`, so it never installs |
| 2 | a step that names lamp.desk@1 … naming lamp | with shelf@1.2.0 and lamp@1.0.0 installed, study@1.1.0 is refused at its pack check by an error naming `lamp` | study@1.1.0 is refused only for `requires/packs`, and no error names lamp |
| 3 | a shelf@1.2.0 that also requires study@1.0.0 … the cycle | after study@1.0.0, the cyclic shelf@1.2.0 is refused by an error `cycle` naming study@1.0.0 and shelf@1.2.0 | it is refused only for `requires/packs` (`out_of_range`), no `cycle` |
| 4 | a document that lists shelf@1.3.0 beside study@1.0.0 | with shelf@1.2.0, shelf@1.3.0 and study@1.0.0 installed, a board listing `acme/study@1.0.0` and `acme/shelf@1.3.0` is refused by an error naming shelf@1.2.0 and shelf@1.3.0 | study@1.0.0 is refused for `requires/packs`, so it never installs (the board could only be refused with `pack_missing` for study, naming neither shelf version) |

## Readings where the issue leaves a choice

- **"Expands its reading room … in a document that lists only study@1.0.0"** (1): the `deep show` reply's
  `expansions` row for `r1`, which the base writes only for an instance that expanded with no issue, holds exactly the
  derived items; and no error of the reply is a refusal of the board's packs (`pack_missing`, `ref_unresolved`,
  `cycle`, or one naming `shelf@…` or `study@…`). The board isn't required to be presented: at the base no board with a
  nested recipe step draws (What the base already does), and the issue asks for the expansion. shelf@1.3.0 is in the
  store too, so a resolution by name alone, or by the newest version, shows as a `crown` in the expansion; exact
  versions are the issue's Scope.
- **"Refused at pack check"** (2): the `packs` row of study@1.1.0 is `refused`; lamp@1.0.0 is installed first, so the
  only fault is that study@1.1.0's `requires.packs` leaves lamp out, not that no store holds `lamp.desk@1`. shelf.bookcase@2,
  from the declared shelf, is in the same recipe, so the refusal is of the undeclared pack alone.
- **"Is refused, naming the cycle"** (3): the pack that closes the cycle is refused at its pack check (the tech design's
  "An install whose uses would make a cycle … is refused, naming the cycle"); study@1.0.0, offered first, closes none.
  Its row is printed with a failure but not asserted.
- **"A document that lists shelf@1.3.0 beside study@1.0.0 is refused"** (4): the `deep show` reply's `outcome` is
  `refused`; the error names the version the document lists (1.3.0) and the one study@1.0.0 requires (1.2.0).

## Not tested, because the criterion doesn't ask

Kinds and programs from an undeclared pack (only a recipe step is tested); a dependency missing from the store at
document time; the store keeping a version reached only through `requires.packs`; a patch that names a new pack version
and its undo; `deep try`; the pack graph being visible with the rest; `requires.packs` holding a version range.

## Upstream tests (the Oracle lane)

The issue says no upstream test checks this criterion (its oracle page), so these tests are its local proof.
