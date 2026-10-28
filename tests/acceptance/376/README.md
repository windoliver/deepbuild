# Acceptance tests for #376: accessible documents, with descriptions, part names and control roles, and readouts announced

Written first, from issue #376 ("Accessible documents: descriptions, part names and control roles, with readouts
announced": its body, scope, its one acceptance criterion and its proof line), the design sections it names and
those they lean on, and base commit `a8e5480` ("Merge pull request #767 … feat/63-read-by-reference"), by a job
that never saw an implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md,
Proof); a dispute goes to a blind redraft of this job.

What was read:

- `docs/technical-design.md`: Rules every primitive follows, **Accessible.** (882: "the document check refuses a
  document without a description, a part without a name or a control without a role, naming the item, and the
  accessibility tree and its announcements are compared as data in a replica; a screen-reader run is a smoke
  test, never the check"); the Canvas block's readouts bound to readings (517); Dogfooding and Tests written
  first (2549).
- `docs/canvas-primitives.md`: Document envelope (291: `title`, `description ≤ 400 chars`, both required; `data`),
  Item and kind (321: `name` "required when pickable, or named by a control, stage, readout, bound value or
  check"; `role: part | control | label | data | decoration`), the replica (970–988: a headless copy with the same
  core on a virtual clock; `see` → "a text tree of roles, names, values and bounds, with canvas items by ID"),
  Overlay (4504: a text's `role` may be `readout`; "Templates fill only from bound values and drivers"), Control
  (5471: `label`; `role` (an ARIA role); `value_text`; `announce: {on, quiet: s}`; "Readouts are announced when
  they change, after a quiet interval"), What holds a document to its rules (the cheap kinds, accessible names
  among them, run before every show).
- At the base: `crates/deep-show` (`deep-show run`, its scenario, `planted`, `presented`, the virtual clock),
  `crates/deep-canvas` (`document/check.rs`, `template.rs`), `crates/deep-canvas-marks` (text@1's `template`),
  `crates/deep-replica`, and the earlier blind suites `tests/acceptance/371/`, `381/`, `383/`, `387/` (READMEs,
  helpers).

## Run them

Like #371's suite they build `deep-show`, so they run with `--no-file-parallelism` (`scripts/lanes.mjs` needs
`tests/acceptance/376/**` added to the unit lane's `--exclude` list and `tests/acceptance/376/` to its
one-at-a-time line, as those suites' READMEs say for theirs; this job edits nothing outside this folder):

```sh
npm ci                          # once, if node_modules is missing
npx vitest run --root tests/acceptance/376 --no-file-parallelism
npx tsc -p tests/acceptance/376/tsconfig.json   # type-check
```

Each file first runs `cargo build --locked --bin deep-show --no-default-features --features full`, copies the
binary to a temporary folder, and fails each test if the build failed. Each test gets an evidence folder in a
temporary directory and deletes it. The tests use only node built-ins and vitest. A run with `--root
tests/acceptance/376` leaves Vitest's cache in `tests/acceptance/376/node_modules/.vite`; delete it.
`BASE-FAILURE.txt` is the run at the base, with a header saying why each test fails there and which pass already.

## The surface under test

The issue names the document check, the accessibility tree, announcements and a replica, but no command. These
tests reuse `deep-show run` (#393's scenario binary standing in for the hub's canvas side) with everything #393's,
#96's, #383's and #371's READMEs define for it: the JSON-lines convention and `bad_input`, sessions, the process
table, panels, `evidence`, `deep_show` whole revisions and their replies (`outcome`, `issues` with `code`,
`severity`, `ids`, `path`), the virtual display clock (`clock`, `at`) and `presented`. `deep-show run` is headless,
draws with the same core and runs on a virtual clock, which is what the design asks of a replica; the call it
gains below is the replica's `see` request, for one canvas panel. What follows adds to it, as little as the
criterion needs.

### The document check (no new field)

A deep_show whole revision whose document has no `description`, has an item with `role: part` and no `name`, or
has a control (in `controls`) with no `role` is `refused`, its reply's `issues` holding an error whose `path` is
the missing field (`description`, `items/<id>/name`, `controls/<id>/role`) and whose `ids` hold the item or control
(none for the envelope's description). The issue's code isn't read. A refused revision never shows: the panel
presents no frame of it (`presented`).

### Call added: `see`

`{"call": "see", "panel": P}` (with `at`, like every call) answers, for the canvas on panel `P` as of the call:

- **`tree`**: the accessibility tree, read as data: `[{"id", "role", "name", …}]`, one row per node, in reading
  order. An item's node has its item ID as `id`, its `name` as `name` and its `role` as `role`; a control's node
  has its control ID as `id`, its `label` as `name` and its `role` (the ARIA role) as `role`. Other fields (a
  value, bounds, a parent) and other nodes (the document's own, labels, readouts) may be present; no test reads
  them.
- **`announcements`**: every announcement the panel made since the scenario began, in order: `[{"t", "id",
  "text"}]`, `t` the virtual clock's time in flicks when it was announced, `id` the item announced (a readout's
  item ID), `text` what a screen reader says.

### What a readout is here

The design gives a readout no kind of its own in this build. The figure's readout is a `text@1` item with `role:
data` whose text is a `template` over a story constant (`Rays: {data/count}`, `data.count = {value, source:
"story"}`), as #381 defines templates: "a readout that templates the same values". Its value changes when a whole
revision changes `data.count.value`.

### `planted` value added (scenario field, reachable only through it)

| Value | Criterion | The wrong program |
|---|---|---|
| `announces_every_frame` | AC1 | the accessibility tree announces each readout on every frame the panel presents, changed or not |

## Fixture

- `figure.json`: a `figure` of 480 × 270 with a description; parts `beam`, `lens`, `screen` (`rect@1`, `role:
  part`, named), a backdrop (`decoration`), a caption (`text@1`, `label`), the readout `count` (above, at 3), and
  two view controls: `c-rays` (slider, label "Number of rays", role `slider`) and `c-labels` (toggle, label "Show
  labels", role `switch`). It is the fixed twin of each wrong figure; the tests derive the wrong ones by deleting
  `description`, `items/lens/name` or `controls/c-rays/role`, and the revisions with the readout at 4 or the beam
  moved 40 down.

## Criteria to tests

Each test's name starts with its criterion's ID; each file's head quotes its part of the criterion and names in
`asserts` the assertions that carry it.

| ID | Criterion | Tests (count) |
|---|---|---|
| AC1 | A fixture figure without a description, one with an unnamed part and one with a control without a role are each refused before showing, naming the item and the field, and their fixed twins show | `refusal.test.ts` (3): each wrong figure is `refused` with an error at `description`, at `items/lens/name` naming `lens`, at `controls/c-rays/role` naming `c-rays`; the panel has presented no frame when the fixed twin arrives at 1 s; the twin is `presented` and the panel presents a frame of it |
| AC1 | In a replica, the figure's accessibility tree read as data has one node per part and control with its name and role | `replica.test.ts` (1): `see` at 30 s has exactly one node each for `beam`, `lens`, `screen`, `c-rays`, `c-labels`, with the document's name (a control's `label`) and role |
| AC1 | changing a readout from 3 to 4 emits exactly one announcement with '4', and redrawing an unchanged readout emits none | `replica.test.ts` (1): readout at 3 at 0 s; the beam moved, readout unchanged, at 10 s (the panel presents a frame of it); readout at 4 at 20 s; `see` at 30 s: no announcement in [10 s, 20 s), exactly one in [20 s, 30 s], naming `count`, its text holding "4" |
| AC1 | a tree that announces every frame fails, naming the readout | `replica.test.ts` (1): the same run with `planted: "announces_every_frame"` fails that check, a failure naming `count` |

## Readings where the issue and design leave a choice

- **"Naming the item and the field"** is an issue's `ids` holding the item's or control's ID and its `path` being
  the field. The envelope's description belongs to no item, so its refusal is read by `path: description` alone.
- **"An unnamed part"** is an item with `role: part` and no `name` field. (At the base the check already refuses
  any item without a `name`, so that test passes there.)
- **"Before showing"** is the reply's `refused` and no frame on the panel by the time the fixed twin arrives.
- **A node's role** is the role the document gives: `part` for a part (Item's `role`), the control's ARIA `role`
  for a control. A node's name is the item's `name`, or the control's `label`.
- **Announcements and the quiet interval.** "After a quiet interval" leaves the interval open; the tests wait 10 s
  after each revision before reading, so an interval up to 10 s passes. The initial showing at 0 s may or may not
  announce the readout; no test reads announcements before 10 s. Between the unchanged redraw and the change no
  announcement at all is allowed (nothing else in the figure changes).
- **"Redrawing an unchanged readout"** is a new revision that moves a part and keeps the readout's value; a still
  figure presents one frame per revision (#371 AC2), and the test asserts that frame is presented.
- **"A tree that announces every frame"** is the planted program above; the check it fails is the one the real
  program passes, and its failure names the readout's ID.

Not tested, because the criterion doesn't ask: the screen-reader run the proof line names (a smoke test, never
the check, per the design; it needs a person or AppKit and is left to the implementing job's manual proof), a
description over 400 characters, `value_text`, `announce: {on, quiet}` on controls, overlays with `role: readout`,
names required of pickable items that aren't parts, and how the tree nests.

## Upstream tests

No upstream test checks this criterion, so these tests are its local proof.
