# Acceptance tests for #371: the canvas document language, show-time admission and scenes from agents

Written first, from issue #371 ("Canvas document language: typed kinds checked all at once, show-time admission
by new issues, and scenes from plug-ins and agents": its scope, its Document envelope fields, its eight
acceptance criteria and its proof line), its Oracle page (`doneright/oracles/issues/371.md`, which says no
upstream test checks any of the eight criteria), the design sections it names and those they lean on, and base
commit `14561af` ("Merge pull request #755 … claude/issue-349-close"), by a job that never saw an
implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute
goes to a blind redraft of this job.

What was read:

- `docs/technical-design.md`: Blocks for plug-ins that host something live (511: the Canvas block's scene, motion
  the app runs "stopping when everything settles … and holding still under reduced motion", "Agents draw the
  same scenes through `deep_show`, as their own layer"); Rules every primitive follows (863: typed, versioned,
  addressed by ID; checked before it shows, "every failure comes back as data: the check, the IDs, the time and
  a fix"); The canvas core (1050) and Canvas modules (1058); the read cap of 8,192 characters (157: "the event
  keeps the first 8,192 characters"); Patch, Render-back and Document check (1476–1508); Who drafts it (2085),
  Dogfooding and Tests written first (2549); Contract history (2693: `deprecated_since`, `replaced_by`).
- `docs/canvas-primitives.md`: Document envelope (291), Item and kind (321: "A kind with `deprecated_since` still
  loads, with a `deprecated` notice naming its `replaced_by`"), ID, Path and handle, Writer layer (428), Patch
  (451: the closed refusal codes, `record_view` among them; "It can never: Edit a view of the record"), Revision
  (468: the whole-revision diff "in every map keyed by ID", show-time admission "matched by issue code and item
  IDs; the others come back marked carried", "A view of the record has no revisions"), Admission and latch,
  Frame clock and scheduler (723), Render-back (934: "Each reply carries a table of visible item IDs with screen
  boxes, at most 200 rows sorted by ID"), Circle `circle@1` (1504), Cell grid `cells@1` (2369), Bound value
  (2138), Control (5471), What holds a document to its rules (8165: "`actual` is the value refused at `path`,
  cut at 8,192 characters", issues kept as evidence by hash, inlined up to the read cap).
- At the base: `crates/deep-show` (`deep-show run`, its scenario, `planted` values, the `--planted` startup
  argument, its `test-*` Cargo features), `crates/deep-canvas` (`document`, `show`, `registry`),
  `crates/deep-canvas-marks`, `crates/deep-canvas-test-modules`, `packages/evidence`, and the earlier blind
  suites `tests/acceptance/393/`, `96/`, `305/`, `383/`, `387/`, `388/`, `389/`, `374/`, `671/` (READMEs, helpers,
  BASE-FAILURE files).

## Run them

Like #388's suite they build `deep-show` per Cargo feature set, so they run with `--no-file-parallelism`
(`scripts/lanes.mjs` needs `tests/acceptance/371/**` added to the unit lane's `--exclude` list and
`tests/acceptance/371/` to its one-at-a-time line, as those suites' READMEs say for theirs; this job edits
nothing outside this folder):

```sh
npm ci                          # once, if node_modules is missing
npx vitest run --root tests/acceptance/371 --no-file-parallelism
npx tsc -p tests/acceptance/371/tsconfig.json   # type-check: the root's strict options, allowImportingTsExtensions, noEmit
```

Each file first runs `cargo build --locked --bin deep-show --no-default-features --features full[,<test
feature>]` for each build it lists, copies each binary to a temporary folder, and fails each test whose build
failed. Each test opens an evidence store in a temporary folder and deletes it. The tests use only node
built-ins, vitest and the evidence store's public entry (`packages/evidence/src/index.ts`:
`openEvidenceStore`, `read`). A run with `--root tests/acceptance/371` leaves Vitest's cache in
`tests/acceptance/371/node_modules/.vite`; delete it. `BASE-FAILURE.txt` is the run at the base, with a header
saying why each test fails there and which pass already.

## The surface under test

The issue names deep_show, its snapshot reply and table, patches, whole revisions, show-time admission, issues
with `actual`, deprecated kinds and test canvas modules, but no new command. These tests reuse `deep-show run`
(#393's scenario binary standing in for the hub's canvas side) with everything #393's, #96's, #383's and #387's
READMEs define for it: the JSON-lines convention and `bad_input`, sessions, the process table and its peer
check, panels, `evidence`, `record`, whole revisions (`deep_show` with `document`, `removes`, `include`,
`size`) and their replies, patches (`deep_show`/`deep show` with `patch`), shared documents stored in
`docs[…].document` (opened as revision 0), `read`, `revisions`, `by_writer`, `screen`, the virtual display
clock (`clock`, `at`), `presented` and `eval` (with `view.reduced_motion` and `pixels`). What follows adds to
it, as little as the criteria need.

### Reply fields added

- **`visible`** (AC3), on every deep_show reply that carries a snapshot: `[{"id": ID, "box": [x, y, w, h]}]`,
  the items visible in that snapshot (an item with `visible: false` is not one), at most 200 rows, sorted by ID
  in code-point order. `box` is the item's screen box in the snapshot's pixels: the box of what it draws, so a
  snapshot at twice the document's `size` doubles it. Which items are kept when more than 200 are visible is
  not read.
- **`actual` cut at the read cap** (AC7): an issue's `actual` is the value refused at its `path`; a string
  longer than 8,192 characters (code points) is cut to its first 8,192, in the reply and in the issue list kept
  at `issues_evidence` alike.
- **`carried`** (AC6): on a patch's reply (and a whole revision's), each issue the revision has that the last
  good revision, checked by the same rules, also had, matched by code and item IDs, is in `issues` with
  `"carried": true`; issues it brings have no `carried` or `false`. A refusal is decided only by errors it brings.
- **`notices`** (AC8), on deep_show replies: `[Notice]`, #389's notice shape (`{code, severity: "notice", ids,
  path, actual, what}`). Loading an item of a kind with `deprecated_since` adds `{"code": "deprecated", "ids":
  [item], …, "replaced_by": "family.name@major"}`, naming the kind's `replaced_by`.
- **A view of the record has no revisions** (AC4): `revisions` on a shared document stored with a `source`
  answers `{"revisions": []}`, before and after patches; patches to it are refused with a `record_view` issue,
  and `read` returns it unchanged. Without `source` it opens as #96's work product: revision 0 current.

### `planted` values added (scenario field, each reachable only through it)

| Value | Criterion | The wrong program |
|---|---|---|
| `counts_every_issue` | AC6 | show-time admission refuses a revision for any error it has, carried or not |
| `matches_carried_by_code` | AC6 | an issue counts as carried when the last good revision had one with the same code, whatever its IDs |
| `issues_without_actual` | AC7 | the check returns its issues without `actual` |
| `loads_deprecated_silently` | AC8 | a kind with `deprecated_since` loads with no `deprecated` notice |

AC5 reuses #393's `diffs_items_only` (the whole-revision diff reads only the `items` map).

### Test builds: two test canvas modules, each under its own Cargo feature on `deep-show`

As #305's and #388's suites add theirs (in `crates/deep-canvas-test-modules` or `deep-show`, never in a shipped
build); each joins the `full` set:

- **`test-title-cap`** → canvas module `test.title_cap`, standing in for a new release's stricter rule: a check
  over `text@1` items that raises an error `title_too_long` on each one whose `params.text` is over 20
  characters, with `ids: [item]`, `path: items/<id>/params/text` and `actual` the text. In the test board the
  titles are its only text items over 20 characters, so the rule flags exactly the titles; axis labels are short.
- **`test-deprecated`** → canvas module `test.deprecated`, registering kinds `test.old@1` and `test.new@1`, each
  with one param `box: [x, y, w, h]` and drawn as a `rect@1` is; `test.old@1` has `deprecated_since` (a version
  the tests don't read) and `replaced_by: test.new@1`.

## Fixtures

- `board14.json` (AC5): an agent's board of 14 items (`bar-1`…`bar-7` rects, `label-1`…`label-6` texts with no
  digits, and `total`, a text a bound value fills), three view controls `c-week`, `c-team`, `c-scale` (shaped as
  Control's fields) and one bound value `bv-total` reading `reading:01JB71R0000000000000000001`, which the
  scenario's `record` gives to alpha's session.
- `checks-board.json` (AC4, AC6): your board as the last release stored it, one layer `you-main` (`you:you`):
  the title `you.title`, "Weekly checks by service" (24 characters), axis labels `you.x-label` ("Wekk", the
  typo) and `you.y-label` ("Checks"), and a plot rect. AC4 stores it with and without `source: {projections:
  ["tasks"], append: "none"}`. The second title AC6 adds, `you.title-2`, is "Daily retries by service" (24).

## Criteria to tests

Each test's name starts with its criterion's ID; each file's head quotes its criterion and names in `asserts`
the assertions that carry it. Where a criterion names a wrong program, the test runs it through `planted` and
asserts the criterion's check fails, its failure naming what the criterion says.

| ID | Criterion | Tests (count) |
|---|---|---|
| AC1 | An agent's `deep_show` scene appears as its own layer, outlined as the agent's | `layer.test.ts` (2): alpha's and bravo's scenes of parts (a path with a gradient fill and a stroke under a transform, text, a rect), each on its own document: on `screen` each is one layer owned by its thread, agent band, `outline: true`, `name` its session's name, two different layers; alpha's scene on your stored board: its own layer beside yours, yours not outlined, `by_writer` putting alpha's three items in alpha's layer and only your node in yours |
| AC2 | A still scene draws no new frames, and under reduced motion nothing moves | `motion.test.ts` (3): on a 60 Hz virtual clock a still scene presents one frame in its first second and, after a second revision at 1 s, exactly two over 2 s, one per revision; control: a box sliding over the first second presents at least 30 frames in it; `eval` under `reduced_motion` at 0, 0.25, 0.5, 0.75, 1 and 1.5 s gives one snapshot hash, while without it 0.25 s and 0.75 s differ |
| AC3 | Each deep_show snapshot reply carries a table of visible item IDs with their screen boxes, at most 200 rows sorted by ID | `visible.test.ts` (3): three visible rects and a hidden one: rows `a-head, b-foot, c-bar`, each box within 1 px; at 2× size the boxes double; 250 visible rects `r-1`…`r-250`: 200 distinct rows, sorted by code point, each box within 1 px |
| AC4 | A board with a source opens as a view of the record and a patch to it is refused with record_view, while the same board without a source opens as a work product that a patch edits | `view.test.ts` (2): with `source`: `revisions` empty, your patch and alpha's each refused with `record_view`, `read` unchanged; without: revision 0 current, your patch applied as revision 1, `read` edited |
| AC5 | A board revision that keeps all 14 items but leaves out two of its three controls and one bound value without naming them is refused with unintended_removal naming those three IDs; a planted diff over the items map alone presents it and fails, naming the three | `removal.test.ts` (3): refused, `unintended_removal` naming exactly `bv-total, c-scale, c-team`, the 14-item revision current by rev and hash; with the three in `removes`, presented and listed as removed; `diffs_items_only` presents it and the check fails naming all three |
| AC6 | A test canvas module … flagging any title over 20 characters, is added after a board's last good revision, whose title has 24: a patch fixing a typo in one axis label is admitted, its reply listing the title's issue as carried, while a patch adding a second 24-character title is refused, naming its ID; a planted admission that counts every issue refuses the typo fix, and one that matches carried issues by code alone admits the second title, each failing, naming the patch | `carried.test.ts` (3), on `full,test-title-cap`: the stored board reads with `title_too_long` on `you.title`; the typo fix is applied with that issue `carried: true`; the second title is refused with a non-carried error naming `you.title-2`; `read` has the fix and no second title; `counts_every_issue` fails naming the typo fix's patch ULID, `matches_carried_by_code` fails naming the second title's |
| AC7 | A document check's issue carries `actual` …: a `circle@1` whose `radius` is -2 fails with `out_of_range` at `items/c/params/radius` and `actual` -2, and a value longer than 8,192 characters is cut there; a check that returns issues without `actual` fails this test, naming the code | `actual.test.ts` (3): refused with that issue and every issue carrying `actual`; a 10,000-character value (every fourth character outside the BMP) at `items/c/params/note` refused with `actual` its first 8,192 code points, read from `issues_evidence`; `issues_without_actual` fails naming `out_of_range` |
| AC8 | A kind with `deprecated_since` still loads, with a `deprecated` notice naming its `replaced_by`; a check that loads it silently fails this test, naming the kind | `deprecated.test.ts` (2), on `full,test-deprecated`: a board with a `test.old@1` item is presented and current, with a `deprecated` notice naming the item and `replaced_by: test.new@1`; `loads_deprecated_silently` fails naming `test.old@1` |

## Readings where the issue and design leave a choice

- **`radius`, not `r`.** The issue's criterion names `circle@1`'s `radius` and the path `items/c/params/radius`;
  the design's Circle section names the field `r`. These tests use the issue's values exactly, as the drafting
  rules require; if `r` is meant, that is a dispute for the blind redraft, not an edit here.
- **"Cut there"** is the read cap's rule for an event field: the first 8,192 characters, counted in code points
  as #393's suite counts the read cap. The over-long value is a field `circle@1` doesn't define (`note`), so
  the issue's code isn't read, only its path and `actual`. An issue that long doesn't fit the reply's inline
  list, so the test reads the whole list from `issues_evidence`.
- **"Opens as a view of the record"** is read through Revision: "A view of the record has no revisions: it's
  rebuilt from projections as of an event", so `revisions` is empty. Your patch and an agent's are both
  refused; the refusal's other fields aren't read.
- **"Marked carried"** is `carried: true` on the issue in `issues`. The title rule is this suite's test module,
  so its code `title_too_long` is the suite's; which items count as titles is the module's rule above.
- **"Added after a board's last good revision"**: the board is stored as the previous release wrote it
  (`docs[…].document`, revision 0, current), and the build that opens it holds the test module, so revision 0,
  checked by the same rules, has the title's issue. Both patches are your patches on base 0 (`deep show` from
  your shell), so the second rebases past the first, as #96's rule allows.
- **Still scenes and reduced motion.** "Draws no new frames" is read on #383's `presented` frames on #96's
  virtual clock: one frame per revision that becomes current, none between. The control (a sliding part
  presents frames while it moves) comes from the Canvas block's "the app moves the parts every frame … stopping
  when everything settles"; it asserts only at least 30 of the 60 vsyncs, not when frames stop. Reduced motion
  is the view input `eval` takes (#387); "nothing moves" is every frame's snapshot being byte for byte one
  snapshot, with the document's default `reduced_motion: hold`.
- **"Screen boxes"** are boxes in the snapshot's pixels, as #393's `screen` items are in window pixels; 1 px of
  tolerance covers antialiased edges. The 200-row cap is asserted as exactly 200 rows when 250 are visible.
- **"Its own layer, outlined as the agent's"** is read on `screen`'s bands (#393): one row per layer, owner,
  band, `outline` and `name`.

Not tested, because no criterion asks: the cell-grid form of a scene (`cells@1`, whose fields no criterion
names), plug-ins' scenes through gpui-shell (#44), springs, the envelope's other fields, "a check that decides a
verdict still counts every issue", carried issues on whole revisions, the visible table on `deep show --snap`,
and which 200 rows a capped table keeps.

## Redrafts

Two first drafts failed on every program that follows the design, for a reason their criterion doesn't name,
and went to a blind redraft of this job from the same inputs (issue #371, the design, base `14561af`); its notes
are in `REDRAFT.md` (AC7) and `REDRAFT-AC8.md` (AC8). On the owner's go-ahead the redrafts replace them:

| First draft (removed) | Redraft |
|---|---|
| `actual.test.ts`: `circle@1`'s radius sent as `radius`, at `items/c/params/radius`; the design's Circle section and the base name it `r`, so a faithful check answers `unknown_field` | `actual-redraft.test.ts`: the radius sent as `r`, at `items/c/params/r`; every other value as the criterion states |
| `deprecated.test.ts`: a board using `test.old@1` that doesn't name `test.deprecated` in `requires.modules`, refused at `items/old/kind` by #305's rule before deprecation is read | `deprecated-redraft.test.ts`: the same board declaring `requires.modules: {"test.deprecated": "^1"}` |

The module this README names `test.title_cap` is registered as `test.titlecap`: the seal refuses a module name
that isn't `[a-z0-9]+` segments joined by `.`, and no test reads the name.

## Upstream tests (the Oracle lane)

The Oracle page lists no upstream test for any of the eight criteria, so these tests are their local proof.
