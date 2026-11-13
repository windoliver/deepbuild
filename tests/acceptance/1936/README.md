# Acceptance tests for #1936: the scene audit: coincident items, interpenetration, floating items, grid and seams, each with a fix as patch ops

These tests were written before any implementation existed. The writer had issue #1936 (its scope, its Geometry
audit: scenes fields, its two acceptance criteria and its proof line: "The coincident walls, the off-grid kit piece
and the moved wall caught, fixed by their own patches and passing, with the issues as data"), its Oracle page, its
parent #455, the design sections the issue names and the sections those lean on, and base commit `7c5e1cc8d` ("Merge
pull request #2184 …"). The Oracle page says no upstream test checks either criterion, so this suite ports nothing.

The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job
(design: Dogfooding). The suite is lean: one file per criterion, plus the one planted wrong program criterion 2 names.

**Not run against a binary.** The machine's one-minute load was 133 on 18 cores, so no Rust was built and the suite
wasn't run at the base. `BASE-FAILURE.txt` says why each test fails there, read from the base's code. The type-check
passes. A scratch vitest file outside the repo (not kept) ran the generators and checked the fixtures' own numbers.

## What was read

- Issue #1936, its Oracle page (`doneright/oracles/issues/1936.md`), #455 (the parent) and its parts #1937, #1938
  and #1941. #1941 owns the loop that applies fixes and checks again, so nothing here tests that machinery.
- `docs/canvas-primitives.md`:
  - What holds a document to its rules (8302): issues as data, `{check, code, severity, ids, path, actual, t, what,
    fix}`, and "A `fix` is patch ops only where … any other fix is text".
  - Check input (8306). Geometry audit (8842). Geometry audit: scenes (8860): `scope`, `overlap`, `support`, and
    "Before the overlap pass, two items with one geometry hash whose transforms put each corner of their bounds
    within 0.1 mm of the same corner are coincident: the failure names both IDs, and its fix is a patch that removes
    one, never a move". At this base the section has no `grid` or `seams` field: those come from the issue's scope.
  - Patch (453): the ops `create`, `set {id, path, value}`, `unset`, `delete {id, cascade}`, `move {id, parent,
    keep}`, `reorder`, `rows`, `break_out`, and the result's `outcome` and `achieved`.
  - The envelope (312): `collections: {ID → {members: [ID] | rule}}`; the glossary's collection, "A set of items, by
    list or by rule". Units (33): "Euler angles turn about X, then Y, then Z, in fixed axes: R = Rz·Ry·Rx". Item and
    kind (335): `at: {pos, rot, scale, pivot}`.
  - Check input: loop kinds: shading defects (8475): "a boundary edge has one face, on welded positions".
- `docs/technical-design.md`: Patch (1534), Document check (1566), Criteria to tests both ways, Criteria in a checked
  shape, Wrong programs (2628 to 2631) and Dogfooding.
- At the base:
  - `AGENTS.md`; `tests/acceptance/405/` (README, helpers, `broken-fixture.test.ts`), the surface this suite
    extends; `96/` and `453/` (a stored document as revision 0, and a patch through `deep_show`); `1937/` (a fix as
    `[op]`).
  - `crates/deep-canvas/src/geometry_audit.rs` and `crates/deep-show/src/geometry_audit.rs` (the audit),
    `verdict.rs` (`judge_audit`), `hub.rs` (`Planted`), `main.rs` (the scenario's `docs`, `claims`, `planted` and
    calls), `shared.rs` (`open_shared`, `patch`, `check_patch`, `marks_check`), `query.rs` (`query_revision`).
  - `crates/deep-canvas/src/document/apply.rs` (the ops) and `crates/deep-canvas-scene3d` (`plate@1` in
    `builders.rs`, `local_of` in `scene.rs`).
  - `scripts/proof-change.mjs` (`criterionId`, `spans`) and `scripts/lanes.mjs`.

Code was read only to learn the surface. Every expected value comes from the issue and the design.

## What the base already does

- `geometry.audit` as a claim's requirement is judged on every deliverable (#405): two items past 0.002 m into each
  other are `geometry.overlap`, an item nothing holds is `geometry.floating`, a tube's loose end is
  `geometry.unlanded`. Each issue's `fix` is a sentence. The input's `support.floating` is read; `scope`, `overlap`,
  `grid` and `seams` are not. There is no coincident pass.
- A stored document opens as revision 0 from the scenario's `docs[…].document` (#96), a verdict judges it (#453),
  and a session's `deep_show` with `patch` applies ops to it and answers `{outcome, achieved, …}`.
- A scenario's `planted` names one wrong program from a closed list; any other name refuses the scenario.

## Run them

Every file builds `deep-show` with cargo, so they run one file at a time. The implementer adds this line to
`scripts/lanes.mjs`. This README is the instruction; this job edits nothing outside the folder.

```js
// #1936's files each build deep-show.
alone.push('tests/acceptance/1936/');
```

```sh
npm ci                          # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/1936 --no-file-parallelism
npx tsc -p tests/acceptance/1936/tsconfig.json   # type-check
rm -rf tests/acceptance/1936/node_modules/.vite
```

Each file first runs `cargo build --locked --bin deep-show --no-default-features --features full`, copies the binary
out of `target/` (honoring `CARGO_TARGET_DIR`), and fails each test whose build failed. Every test writes into
temporary folders and deletes them. A test that can't decide here (cargo can't run) fails with a message starting
`INCONCLUSIVE:`. It never passes.

## The surface under test

**No new binary and no new call.** The suite drives `deep-show run` (one scenario line in, one answer line out) with
stored documents, #403's `claims` and `verdict`, and #96's patch through `deep_show`. Every name below that the issue
and design don't give is this job's choice, listed again under Readings. An implementation builds exactly these, or
disputes them.

### The documents

Each fixture is a `scene` document as the hub stores it: `requires.modules: {scene3d}`, one layer `alpha-main` whose
writer is the working agent alpha (`agent:thread-alpha`, session `sess-alpha`), and every item in that layer. The
scenario's `docs` holds it as `{panel: "main", document}`, so it opens as revision 0. Each is the one deliverable of
a claim of alpha's.

### The check, as a claim's requirement

A Check input of kind `geometry.audit` with `scope: "scene"` and `support: {floating: ["floor"]}` in every test, and:

| Test | Also |
|---|---|
| the wall added twice, and the pair 1 mm apart | nothing: `overlap` and `support` at their defaults |
| the kit piece off the grid | `grid: {unit: 1, sub: 0.5, items: "kit"}` |
| the wall moved 2 mm | `seams: {pairs: [["kit", "kit"]]}`, `max_gap` at its default 0.001 m |

A collection is an ID in the document's `collections`, here `kit: {members: [ID]}`. `{"call": "verdict", "claim"}`
judges each claim.

### The verdict's row

The requirement's row is #405's: `{id, kind, result, issues, …}`, `FAIL` when the audit raises an error, `PASS` when
it raises none. Each issue has the design's shape, `{check: "geometry.audit", code, severity, ids, path, actual, t,
what, fix}`. A code's fields sit on the issue itself or in its `actual`. A sub-address `<id>#<part>` in `ids` reads
as `<id>`. The audit gains three codes, each an error:

| Code | The fault | `ids` | Also read | `fix` |
|---|---|---|---|---|
| `geometry.coincident` | two items with one geometry hash, each corner of their bounds within 0.1 mm of the same corner | both items | | ops that remove one of the two |
| `geometry.off_grid` | an item `grid` lists whose origin is off the sub-grid, or whose yaw isn't a multiple of 90° | the item | | ops that snap it |
| `geometry.seam` | a boundary edge within 0.01 m of another item's boundary edge that doesn't meet it within `max_gap` | both items | `gap`, in m | ops that move one of the two |

The coincident pass runs before the overlap pass, and a coincident pair is never also `geometry.overlap`.

### A fix as patch ops

`fix` is a list of Patch ops, `[op]`, each written as a patch carries it. A patch-shaped `{ops: [op]}` is read too.
A sentence, an empty list or nothing is not patch ops, and fails.

- **Remove one:** every op is `{"op": "delete", "id"}`, its `id` one of the two items; one item is deleted in all.
- **A snap or a move:** every op is `{"op": "set", "id", "path", "value"}`, its `id` an item the failure names and its
  `path` that item's `at` or under it (`items/<id>/at/pos`, `items/<id>/at/pos/0`).

### Applying a fix

The ops the failure names go back through the product's own patch path, unchanged. A second `deep-show run` opens the
same stored document, and alpha sends
`{"call": "deep_show", "session": "sess-alpha", "doc", "patch": {"patch": ULID, "doc", "base": 0, "reason", "ops"}}`,
then `{"call": "verdict", "claim"}`. The patch's reply must say `outcome: "applied"`. For the coincident wall its
`achieved` must count one item deleted, none updated and none created. As read (not run), the base's patch path
applies a `delete` and a `set` at `at` to a 3D item of a stored document, so the implementation adds nothing there.

### The planted program (the scenario's `planted`, reachable only there)

The implementer adds it to `Planted` in `crates/deep-show/src/hub.rs` and names it in `src/main.rs`'s planted match:

| Name | The wrong program | Criterion |
|---|---|---|
| `audit_checks_overlaps_only` | the scene audit runs its overlap pass alone: no coincident pass, no support, no `grid`, no `seams`; everything else as shipped | `#1936.188aa3d2` |

No Cargo test feature is needed: every test builds `full`.

## Fixtures (helpers.ts)

Metres, +Y up. `mark.box@1` is a unit box centred on `at.pos` and scaled by `params.size`. `plate@1` with
`{grid: [1, 1], size: [w, d]}` is a one-sided sheet of two triangles in its own XZ plane, centred on `at.pos` and
turned by `at.rot`. Its four sides are its boundary edges. Every scene stands on `floor`, a 6 × 0.2 × 6 m box whose
top is at y = 0.

**`wallTwice(apart)`.** The floor and one wall, a 4 × 2 × 0.2 m box at (0, 1, −2), held as `wall` and `wall-again`
with the same kind, params and `at`. With `apart` 0 the two are in one place: every corner on its twin's, each 0.2 m
deep in the other. With `apart` 0.001, `wall-again` is at x = 0.001: every corner 1 mm from its twin's.

**`kitRoom(rightX)`.** The floor and three walls, each a 4 × 2 m sheet standing on it, members of `kit`:

| Item | Plane | Origin | `at.rot` | Yaw |
|---|---|---|---|---|
| `wall-back` | z = −2, x from −2 to 2 | (0, 1, −2) | (90, 0, 0) | 0 |
| `wall-left` | x = −2, z from −2 to 2 | (−2, 1, 0) | (90, 90, 0) | 90 |
| `wall-right` | x = `rightX`, z from −2 to 2 | (`rightX`, 1, 0) | (90, −90, 0) | −90 |

- With `rightX` 2 every origin and every corner is on whole metres, and each side wall's back edge lies on an end
  edge of the back wall. The room is open at the front, so `wall-right` meets one wall only.
- With `rightX` 2.05 its origin is 0.05 m off the grid. It is 0.05 m from the back wall, past the 0.01 m within which
  two edges are a seam.
- With `rightX` 2.002, seven pairs of its edges and the back wall's are within 0.01 m, and each pair is 0.002 m
  apart: twice `max_gap`.

**Why 2 mm is a seam fault and nothing else.** The wall slides along the floor, away from the back wall's end.
- *Support:* it stands on the floor as before. The floor runs 1 m past every wall, so the wall is still over it.
- *Overlap:* it moves away from the only wall it touched, leaving a 0.002 m gap, and it rests on the floor's top,
  0 m deep. The walls are sheets: two that meet along an edge are 0 m deep in each other, under the 0.002 m
  tolerance.

## Criteria to tests

IDs are `#1936.` and the first 8 hex digits of the SHA-256 of each criterion's text, as `scripts/proof-change.mjs`
computes them: `- [ ] ` dropped, trimmed, and whitespace collapsed.

```sh
gh issue view 1936 --repo windoliver/deepbuild --json body -q .body | grep '^- \[ \]' | \
  node -e 'for (const t of require("fs").readFileSync(0,"utf8").split("\n").filter(Boolean)) console.log(require("crypto").createHash("sha256").update(t.replace(/^\s*- \[[ xX]\] /,"").trim().replace(/\s+/g," ")).digest("hex").slice(0,8))'
# ce1f055b
# 188aa3d2
```

Each file holds its criterion's ID as a string `const ID`, and every test's name starts with `${ID}` (checked with
`spans` from `scripts/proof-change.mjs`). Each file's header states its fixtures, numbers and wrong programs.

| ID | File (tests) | What it asserts |
|---|---|---|
| `#1936.ce1f055b` | `coincident.test.ts` (1) | The wall added twice: FAIL, and its errors and warnings are exactly one `geometry.coincident` naming `wall` and `wall-again`, so no `geometry.overlap` on the pair. Its fix is ops that delete one of the two and do nothing else. The same pair 1 mm apart: the row is decided and holds no `geometry.coincident`. The fix, applied as a patch: one item deleted, none updated; the verdict after it is PASS, nothing raised. |
| `#1936.188aa3d2` | `kit.test.ts` (2) | **Grid:** the piece 0.05 m off: FAIL, exactly one `geometry.off_grid` naming `wall-right`; its fix is ops that set `wall-right`'s `at`; applied, the verdict is PASS. **Seams:** the wall moved 2 mm: FAIL, and every error and warning is `geometry.seam` naming `wall-back` and `wall-right` with `gap` 0.002 m; its fix is ops that set the `at` of one of the two; applied, the verdict is PASS. **Planted:** under `audit_checks_overlaps_only` the same claim on the moved wall is PASS, so the seam assertion fails on that program. |

## Readings where the issue and design leave a choice

- **Stored documents.** #405's suite shows each scene as the agent's whole revision. A patch reaches only a stored
  (shared) document at the base, so every fixture here is one, opened as revision 0. The audit and the verdict read
  both the same way.
- **"A wall that the same patch added twice"** is how the two items came to be, which the audit can't read: it reads
  evaluated geometry. The fixture holds what such a patch leaves: one wall under two IDs. No patch creates them in
  the test. As read (not run), the base's patch path refuses a patch that creates a 3D item: `marks_check` draws
  what a patch wrote through the 2D marks module.
- **The three codes** `geometry.coincident`, `geometry.off_grid` and `geometry.seam` follow #405's
  `geometry.overlap`. The seam's `gap` sits where #405 put an overlap's `depth`.
- **A fix as patch ops** is the `ops` of a Patch, as #1937's `fix: [op]`. The issue's "remove" is the op `delete`.
  Its "snap" and "move" are `set` at the item's `at`: Patch's own `move` op changes an item's parent, not its place.
  "Never a move" reads as no op but the delete.
- **"Applying the fix"** is the parent's reading: the ops the failure names, applied to the document, give a
  document the same audit passes. A scenario gives all its calls before it runs, so the ops are read in one run and
  sent in a second, on the same stored document. This is not #1941's loop.
- **"Leaves one wall"** is read from the binary twice over: the fix's ops delete one of the two IDs, and the applied
  patch's `achieved` counts one item deleted.
- **"Never coincident"** asserts only that: the row is decided (PASS or FAIL) and no issue is
  `geometry.coincident`. The pair is still 0.2 m deep in itself; what the overlap pass says of it is not asserted.
  The 1 mm is along the wall's length.
- **The walls' kinds.** Criterion 1's wall is a box 0.2 m thick, so an overlap pass that ran on the pair would
  report it. The kit's walls are sheets, so that "boundary edge" is the design's own: an edge with one face, on
  welded positions. A closed box has none.
- **"Kit piece" and "kit room".** A kit piece is an item the check's collection lists. The kit room is three walls,
  open at the front, so the moved wall has one neighbour and "both items" is one pair. The floor is the ground, not
  a kit piece, and each check declares it floating, as #405's base plates are.
- **`grid`.** An origin is the item's own origin placed by its transform: `at.pos`, with no pivot. Every clean
  origin and corner is on whole metres, so a reading by the unit, by the sub-grid, or by a corner of the bounds
  agrees. Yaw is the turn about +Y, `at.rot[1]`. The walls also turn 90° about X to stand up, which is not yaw.
  The criterion's piece is off by its origin; no fixture is off by its yaw.
- **`seams`.** The gap is the distance between two boundary edges. Every pair of edges the 2 mm move brings within
  0.01 m is 0.002 m apart, so a gap per edge pair and a gap per item pair agree. More than one seam issue may name
  the pair. "A 0.002 m gap" is read within 0.00001 m.
- **One rule per check.** The off-grid piece is judged with `grid` alone and the moved wall with `seams` alone, as
  the criterion's two sentences are. With both, the 2 mm move would also be a grid fault.
- **"Its fix applied passes"** applies the first seam failure's fix alone. Only moving `wall-right` back passes:
  moving `wall-back` to meet it opens the back wall's seam with `wall-left`.
- **Exactly.** The wall added twice and the off-grid piece each raise one fault and nothing else. The fixtures hold
  no other fault, so anything else raised fails the test.
- **The planted audit** "that checks only overlaps" is `audit_checks_overlaps_only`. The test asserts it passes the
  moved wall; that it "fails this test" follows, since the test requires FAIL with a seam.

## Not tested

No criterion asks for these, so none is tested:

- **Coincident:** two items in one place with different geometry; a pair between 0.1 mm and 1 mm apart; three or
  more copies; which of the two the fix removes.
- **Grid:** a yaw that isn't a multiple of 90°; an origin on the unit grid but off the sub-grid; `unit` itself;
  where exactly the snap puts the piece.
- **Seams:** `max_gap` other than its default; a gap at the 0.01 m limit; edges that meet along part of their
  length; pairs of two different collections; a collection by `rule`.
- **The rest of the scene scope:** `overlap.pairs` and `overlap.tolerance`, `support.gravity` and
  `support.tolerance`, a tessellated part's INCONCLUSIVE pair, and the fixes of `geometry.overlap` and
  `geometry.floating`, which #1938's planted faults build on.
- **The loop:** stale and conflicting fixes, and checking again on the next render-back (#1941).
