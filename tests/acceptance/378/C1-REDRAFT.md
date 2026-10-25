# C1 blind redraft: the skill's figure declares the module its kinds need

Test file: `figure-redraft.test.ts`. One `describe` ("#378.6ab4aece a skill's figure (an isometric machine with
labeled parts and motion) renders natively through deep_show, with no web view (redraft)") with two `it`s. Each `it`
redrafts one of the two tests in `figure.test.ts` and keeps its ID and order. The ID is the first draft's
`6ab4aece`.

The criterion: "A skill's figure (an isometric machine with labeled parts and motion) renders natively through
`deep_show`, with no web view".

New fixture: `fixtures/machine-figure-requires.json`. The first-draft files (`README.md`, `helpers.ts`, every
`*.test.ts`, `fixtures/machine-figure.json` and the other fixtures) are unchanged, byte for byte. The test file
copies the first draft's local helpers (`scenario`, `presented`, `drawnShare`, `mostCommon`, `blank`,
`webViewProblems`) unchanged. It adds nothing to `helpers.ts`.

## What I read

- Issue #378 (the body as the job was given it).
- `docs/canvas-primitives.md`, Document envelope (291–313). Line 306 is `requires: {core: semver, kinds:
  [family.name@major.minor], modules: {canvas module → semver range}, preview: [name@major]}`.
- `docs/technical-design.md`, Document (1097–1099): "A document declares the canvas modules its kinds need; one whose
  canvas module this build lacks is refused with `module_missing`, naming the module". Also Canvas modules (1058).
- At base `6173ee0`:
  - `crates/deep-canvas/src/document/check.rs`: `check_by` collects the declared set from `requires.modules`
    (line 90). `required_minors` checks each declared module against the build: an absent module is
    `module_missing` at `requires/modules/<m>`. In `check_item` (805–835), a kind whose registered module is not in
    the declared set is `out_of_range` at `items/<id>/kind`: "kind `…` is the `<module>` module's, and
    `requires.modules` does not name it".
  - `crates/deep-canvas/src/registry/mod.rs`: `KNOWN_MODULES` (scene3d at R2), `module_of_kind` and `core_held`.
  - `tests/acceptance/305/`: its documents declare modules as `requires({ name: '^1' })`.
- The first draft: `README.md`, `helpers.ts`, `figure.test.ts`, `fixtures/machine-figure.json` and its
  `BASE-FAILURE.txt`. At the base, deep_show refuses the figure with `module_missing` at `items/base/kind`.
- 387's redraft convention: its README section "Blind redrafts…", `A4-REDRAFT.md` and `history-redraft.test.ts`.

## What the first draft asserted, and why it can't hold

Both tests send `fixtures/machine-figure.json` through `deep_show` and require
`presented(reply, …)` (outcome `presented`, no error issue). The figure has no `requires`. Its parts are
`mark.box@1`, `mark.cylinder@1`, `mark.line@1` and `mark.text@1`, all scene3d kinds. scene3d is an R2 module, not one
of the core's own (`core_held`).

Any build that registers scene3d and keeps #305's rule therefore answers the first `deep_show` with
`items/base/kind` `out_of_range`: "kind `mark.box@1` is the `scene3d` module's, and `requires.modules` does not name
it". The design asks for that refusal (Document: "A document declares the canvas modules its kinds need"). So the
first draft could pass only in a build that dropped #305's rule. A skill's agent writes documents to the design, so
the figure it sends declares scene3d.

## What the redraft asserts instead

| # | Assertion | Kept or new |
|---|---|---|
| 0 | The figure is the first draft's, with `requires: {modules: {scene3d: "^1"}}` and no other change (deep equality, in both tests) | new: shows that only the declaration changed |
| 1–9 | Every assertion of the first draft's two tests, in the same order and with the same messages: presented with no error, one snapshot per call at the figure's size, not blank, at least 5% off the ground, 0.5 s differs from 0 s, 0 s twice is one PNG, no web engine loaded and its WebKit twin, no web-view crate and its `wry` twin, every part and label on screen at its box, labels hold type, the window's process loads no web engine | kept |

The redraft keeps every check of the first draft. The figure now also passes #305's check.

**How a wrong program fails it:**
- The base, or any build without scene3d: the first `deep_show` is refused with `module_missing` at
  `requires/modules/scene3d` (assertion "deep_show call 1 is presented").
- A figure drawn in a web view: the dyld list names WebKit, or `cargo metadata` names the crate.
- A still render: 0.5 s equals 0 s.
- A blank render, or parts or labels missing from the window: their assertions fail.
- A build that refused the declared document: "presented" fails.

## Planted names and surface fields

There is no new planted name. The surface gets no new field: `requires.modules` is the base's own Document envelope
field.

The version range `^1` is my reading. The design gives no version for scene3d. `^1` matches the kinds' major (`@1`)
and #305's suite's convention. The implementer reports that `"^1"` lets the figure through. If the owner sets scene3d
at another major, this one string changes with it.

I add no `requires.kinds`. The check doesn't require it, and leaving it out requires minor 0 of each kind, which every
build of the kind meets.

## Type check

`npx tsc -p tests/acceptance/378/tsconfig.json` exits 0 with no output.

## Run on the base

`BASE-FAILURE-REDRAFT.txt` holds the run. Both tests fail at the first `deep_show` reply, at the assertion "deep_show
call 1 is presented" and "the deep_show call is presented". The failure is the expected one: the base lacks scene3d.
In the second test, the `cargo metadata` check and its `wry` twin pass first.

```
"code":"module_missing","path":"requires/modules/scene3d","actual":"^1","what":"the document requires the scene3d module, which this build lacks" … "outcome":"refused"
```
