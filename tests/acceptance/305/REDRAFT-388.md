# Blind redraft of three #305 acceptance tests

A fresh run of #305's acceptance-test job, with the same inputs, redrafting three disputed tests (AGENTS.md,
Proof; technical design, Dogfooding). It saw no implementation.

## What was read

- Issue #305 (`gh issue view 305 --repo windoliver/deepbuild`): scope, the Canvas module and Registry and seal
  field lists, the six criteria.
- At base `7fc4f14a65d10cb6ad4a3102de7980563cdd8a58`: AGENTS.md; `docs/technical-design.md`, Canvas modules
  (build sets core, r1, r2 and full; text and look in every one; optional and required dependencies;
  `module_missing`), the module table (which canvas module registers which kinds), Document (`requires`,
  module_missing, "a check that needs it is BLOCKED"); `docs/canvas-primitives.md`, Document envelope
  (`requires.modules`), Item and kind (a kind whose module the build lacks is `module_missing`; an unknown kind is
  skipped with `unknown_kind`), Canvas module, Registry and seal (`build_set` and its text), Phase;
  `crates/deep-show` (`main.rs`: the scenario and calls); `crates/deep-canvas` (`requires` checked as a closed
  object; the existing field-form `module_missing`). The base has no `crates/deep-canvas/src/registry`.
  `tests/acceptance/393/README.md` for the deep_show reply, `deep show --check` results and `revisions`.
- The base has no `tests/acceptance/305/`. The first drafts were added in `bbf02be` (parent: the base). From
  that commit only these files were read, nothing else: `tests/acceptance/305/README.md`, `helpers.ts`,
  `tsconfig.json`, `leave-out.test.ts` and `optional.test.ts`. `helpers.ts` and `tsconfig.json` are copied here
  unchanged so the redrafts type-check; the redrafts import `helpers.ts` unchanged and keep any extra helper in
  their own file.

## How the builds were chosen

Registry and seal says: `core` is the core with text and look; `r1` adds marks2d, data, graph, record, sheet and
motion; `r2` adds vector, cells, scene3d and effects; `full` holds every canvas module. The module table puts
`rect@1` and `text@1` in marks2d (text supplies the shaper, look the roles). So a document drawn with rect and
text needs marks2d, which `core` doesn't hold, and `r1` is the smallest build set that does. The test canvas
modules are in no build set; they join only by their Cargo features (`test-a`, `test-b`), as the first draft's
README fixes. A shipped module isn't named in `requires.modules`, because the issue keeps R1's canvas code the
core's own until #137, so a document naming marks2d could be refused in every build for a reason this criterion
doesn't cover; the kind alone tells the build which module draws it.

## The redrafts

### `leave-out-redraft.test.ts`, criterion `#305.4e03e5e7`

1. **A document that uses no test canvas module.** Document: a 320 × 200 board with two `rect@1` (ground and a
   bar) and one `text@1`: marks2d, text and look only. Builds: `full` and `r1`. Each is one fresh process:
   deep_show with a snapshot, `revisions`, an empty board with a snapshot under another doc ID, and `registry`.
   It asserts that each build seals as the set it names and `r1` holds no module `full` lacks; that in each
   build the document is presented with no error and its snapshot isn't the empty board's, so drawing nothing
   can't pass; and that the current revision's hash and the snapshot's sha256 are equal in `r1` and `full`.
2. **A document that uses test.a.** Document: the same kind of board with a `test.a@1` item between a ground
   rect and a label, with `requires.modules: {"test.a": "^1"}`. Control: the same board without the test.a item.
   Builds: `full,test-a` and `r1,test-a`. `r1` is used because the document also draws with marks2d. It asserts
   the same seal and subset checks, that both builds hold `test.a`, and that neither reply has `unknown_kind` or
   `module_missing`. It also asserts the frame differs from the control's in each build, so the test.a item is
   evaluated and not skipped. Then the revision hash and snapshot sha256 must be equal across the two builds.

### `optional-redraft.test.ts`, criterion `#305.a15bd49b`

3. **Without test.a, echo is refused and plain draws.** Build: `core,test-b`. `core` is enough because
   test.b's kind draws itself, text and look are in every set, and no build set holds test.a. One process, each
   document under its own doc ID: `registry`; an empty board shown with a snapshot; a `test.b@1` board without
   `echo` shown with a snapshot, then checked with `deep show --check`; the same board with `echo: 3` shown with
   a snapshot, its `revisions`, then checked. Both boards declare `requires.modules: {"test.b": "^1"}` and
   neither declares test.a. It asserts:
   - the sealed set holds `test.b` and not `test.a`;
   - the plain board is presented with no error, no `module_missing` for test.a, and a snapshot that isn't the
     empty board's, and its check is `PASS`;
   - the echo board is refused with an error-severity `module_missing` naming `test.a` that points at item `b-1`
     (by `ids` or an `items/b-1…` path), with no snapshot and no current revision;
   - its check is `BLOCKED` with the same `module_missing`.

## Where these differ from the first drafts

- Test 1 compared `full` with `core` for a rect and text board. By the design's build sets, `core` lacks
  marks2d, which draws those kinds, so once #137 lays R1's canvas out as modules that board should be refused
  in `core`, not drawn. The redraft uses `r1`.
- Test 2 compared `full,test-a` with `core,test-a`. The redraft uses `r1,test-a` and a document that also uses
  marks2d. It adds a twin without the test.a item, so a build that skips test.a's kind can't pass on equal
  hashes.
- Test 3 drops two strict asserts: the exact `items/b-1/params/echo` path with `ids: [b-1]`, and "no
  `module_missing` names test.b". The criterion asks neither, and a `what` that mentions test.b while naming
  test.a would fail the second. It keeps "points at b-1". Each document and caller gets its own doc ID, so no
  revision depends on another call's.

## Not run

Type-checked with `npx tsc -p tests/acceptance/305/tsconfig.json` (exit 0). Not run: the base has no build
sets or test canvas modules, so every build these tests ask for fails there.
