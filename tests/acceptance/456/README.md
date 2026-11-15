# Acceptance tests for #456: render.review from a fresh context, grounded in an ID view, as a reading that never passes

These tests were written before any implementation existed, by a job that never saw one. The writer had issue #456 (its
scope, Fields, seven acceptance criteria, Proof line "A review's dropped observations counted, one taste ask across
reruns, and findings marked resolved, remaining or regressed" and Oracle line), its Oracle page (no upstream test checks
any criterion: render.review is a model reading under our rules, and criterion 7 is a person's taste call), its epic
#310, its parent #133, its dependency #455 and #455's parts (#1935 to #1941, #2513; titles and bodies), the design
sections the issue links and those they lean on, and base commit `d8c46f0d5` (main). No other branch, pull request or
worktree was read.

The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job
(design: Dogfooding). The suite is lean: one file and one test per criterion, each test also running the planted wrong
programs listed below.

## What was read

- Issue #456 and its Oracle page; #310, #133, #455 and its parts' titles and bodies, so nothing here tests their parts.
- `docs/canvas-primitives.md`: Render-back (957: the reply's `snapshots`, "a table of visible item IDs with screen
  boxes", probes and `hits`, "count as proof" never); the issues-as-data paragraph before Check input (8388); Check
  input (8391); Check input: loop kinds (8540: `render.review {asks: [matches_brief | reads_as_modeled | mood]}`, "oracle
  model: a reading or a taste ask, never a pass"; its taste ask "keyed by the revision's hash, so one revision raises at
  most one, and a hash you answered is never asked again"; "at most five findings, worst first, each with a stable ID
  tied to the revision, its evidence (the snapshot and the crop), the symptom, a fix and an acceptance condition a check
  can measure"; "On a later revision it renders the same cameras and marks each earlier finding resolved, remaining or
  regressed, and a review that can't read its images says so and gives no reading"); Check input: loop kinds: ID view
  and observations (8646: `grounding: ids | none = ids`, the closed `observe` list, `observations: [{category, item:
  u16}]`, `dropped: u16`; "A kept item that doesn't show at all is listed under a number of its own with no mark";
  "Each number resolves to the item's ID, kind and material"); the glossary rows for the ID view and the occluded share
  (264, 266); Camera `camera@1`: framing (`fit.keep`, the kept items); Film brief: defaults, treatment and asks (9119:
  "render.review's reading from a second model", "a model's reading never passes a claim"); `ask.created` (595).
- `docs/technical-design.md`: Render-back (1558), Document check (1566: "`render.review` as a model's reading, grounded in
  an ID view, that never passes"), Dogfooding (2658) and Tests written first (2689).
- At the base, only for surfaces and what the base already does: `AGENTS.md`; `crates/deep-canvas/src/camera.rs`
  (`fit` refuses a `position`); `crates/deep-show/src/main.rs` (the
  scenario, its calls and `planted`), `hub.rs` (`Scenario`, `Session`, `Claim` with its `brief`, `Requirement`),
  `verdict.rs` (`judge`: an unregistered kind is BLOCKED `module_missing`; asks as `{kind, id, requirement, …}`),
  `geometry_audit.rs` (`answer_call`), `ask.rs` (`ask`, `messages`, `render_back`), `probe.rs` (`render_back_3d`,
  probes and `hits`), `snapshot.rs` (`visible`); `crates/deep-canvas-loop/src/scene.rs` (`kept`: `kept` is the
  document camera's `params.fit.keep`) and `framing.rs` (camera.framing's safe frame, margin and fill);
  `crates/deep-canvas-scene3d/src/scene.rs` (`Scene::boxes`); `scripts/proof-change.mjs` (`criterionId`, `spans`) and
  `scripts/lanes.mjs`.
- The sibling suites `tests/acceptance/1941/`, `1938/` and `1729/`, for conventions.

Code was read only to learn the surfaces and what the base already does. Every expected value comes from the issue and
the design.

## What the base already does

Run at the base: all 7 tests fail, none passes or skips (`BASE-FAILURE.txt`).

- Nothing of render.review: no module registers the kind, so a render.review requirement's row is BLOCKED
  `module_missing` with no reading, no ID view, no observations, no findings and no taste ask. No `review_model` is read.
- What the tests lean on is there: stored documents opened as revision 0; claims with a `brief`; `verdict`; alpha's
  `deep_show` patches; `read` (revision and hash); a 3D `render_back` drawn on Metal, its snapshot a PNG in the evidence
  store, with `probes` answered by `hits` nearest first; your point-and-ask to alpha's session and alpha's `messages`;
  `answer` (which at the base answers only the scene audit's asks); camera.framing with `keep`.
- None of the planted names below exists, so a scenario naming one is refused `bad_input`.

## Run them

Every file builds `deep-show` with cargo and draws on the GPU, so they run one file at a time. The implementer adds this
line to `scripts/lanes.mjs`, beside #1941's (this README is the instruction; this job edits nothing outside its folder):

```js
// #456's files each build deep-show and draw on the GPU; shots.test.ts writes docs/evidence/456/ and waits on your
// taste call in tests/acceptance/456/TASTE.json.
alone.push('tests/acceptance/456/');
```

```sh
npm ci --ignore-scripts         # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/456 --no-file-parallelism --testTimeout=600000
npx tsc -p tests/acceptance/456/tsconfig.json   # type-check
rm -rf tests/acceptance/456/node_modules/.vite
```

Each file first runs `cargo build --locked --bin deep-show --no-default-features --features full` (cargo on `PATH`),
copies the binary out of `target/` (honoring `CARGO_TARGET_DIR`; `CARGO_INCREMENTAL` and `CARGO_PROFILE_DEV_DEBUG`
default to `0`), and fails each test whose build failed. Every test writes into temporary folders it deletes, except
`shots.test.ts`, which writes `docs/evidence/456/`. Off macOS, or where a row is BLOCKED `gpu_unavailable`,
`unsupported_platform` or `software_adapter`, a test fails with a message starting `INCONCLUSIVE:`, as does every test
when cargo can't run. None passes or skips. Tests print the issue's proof as lines starting `PROOF #456`.

## Surfaces this suite assumes

Everything goes through `deep-show run` (one scenario line in, one answer line out). The design gives no wire shape for
the model, so this suite adds the smallest one it needs: one scenario field, `review_model`, the stub model, and the
fields of render.review's row listed below. An implementation builds exactly these, or disputes them.

### The check input

A claim's requirement `{kind: "render.review", asks: ["matches_brief", "reads_as_modeled", "mood"], keep: [ID],
grounding?: "ids" | "none"}` (grounding defaults to `ids`; `observe` defaults to the whole closed list). The claim
carries `brief: {goal}` (#407's field).

`keep` is this suite's: render.review's kept items, as camera.framing's `keep` and render.exposure's `subject` name
theirs (`keep: [ID] | collection | kept = kept`). The design says "a kept item" without naming where render.review reads
it. The base's `kept` is the document camera's `params.fit.keep`, but at the base a 3D camera with `fit` refuses a
`position` ("framing sets the distance") and frames itself, which would move the hidden item into view, so the fixture
poses its camera and names the kept items on the check.

### The stub model: the scenario's `review_model`

```json
"review_model": {"name": "stub:456", "replies": [<reply>, <reply>, …]}
```

Each time a verdict judges a render.review requirement, render.review makes one model call, and the stub answers it with
the next reply in the list, in the order calls are made in the process (a verdict judges its requirements in the
claim's order). A reply is the model's own answer, which render.review reads as it would read a real model's:

```json
{
  "answers": {"matches_brief": "yes" | "no" | "unsure", "reads_as_modeled": "…", "mood": "…"},
  "observations": [{"category": "<string>", "item"?: <number>, "words"?: "<string>"}],
  "findings": [{"severity": <number, higher is worse>, "symptom": "<string>", "fix": "<string>",
                "accept": <a check input>, "snapshot": <index into the review's snapshots>, "crop": [x, y, w, h]}],
  "unreadable"?: "<the model's words: it couldn't read its images>"
}
```

A reply may carry anything else (the tests send `result: "PASS"` and `pass: true`); nothing may read it. A taste ask
opens when any answer isn't `yes`. A reply with `unreadable` is a model that couldn't read its images. Only the
scenario reaches the stub; no other path calls a model in these tests.

### The row and its reading

A render.review requirement's row in a verdict is never PASS, and carries:

- `reading`:
  - `model`: the model's name (`review_model.name`);
  - `context`: the SHA-256 of the exact bytes the model was given (its prompt: the brief, the document's outline, the
    images by hash), kept in the evidence store by that hash;
  - `answers`: as the model gave them;
  - `snapshots`: `[{sha256, w, h, camera}]`, each a PNG in the evidence store, render-back's own;
  - `id_views`: with grounding `ids`, one per snapshot, same order: `{sha256, w, h, numbers: [{n, id, kind, material,
    at: [x, y] | null}]}`, the ID view a PNG in the evidence store at its snapshot's size, `at` the number's mark in px
    (`null`: listed with no mark);
  - `observations`: those kept, each `{category, item: n, id, kind, material}` (more fields allowed), and `dropped`;
  - `findings`: at most five, worst first, each `{id, rev, severity, symptom, fix, accept, snapshot: <sha256>, crop:
    {box: [x, y, w, h], sha256}}`, `rev` the revision it was found on, the crop a PNG in the evidence store;
  - `earlier`: on a later revision, `[{id, status: "resolved" | "remaining" | "regressed"}]`, one per finding an earlier
    review of the same requirement and document kept;
  - `why`: when the model couldn't read its images, words saying so, with `findings` and `observations` empty.
- `asks`: a taste ask is `{kind: "taste", id, requirement, key}`, `key` the reviewed revision's hash (`read`'s `hash`),
  in the row's `asks` or the verdict's (`asksOf` reads both, an ask listed twice counted once).

`{"call": "answer", "peer": <your shell>, "claim", "requirement", "answer": "yes"}` answers the taste ask open on that
requirement with `outcome: "answered"`.

### The planted programs (the scenario's `planted`, reachable only there)

The implementer adds each to `Planted` in `crates/deep-show/src/hub.rs` and names it in `crates/deep-show/src/main.rs`'s
planted match:

| Name | The wrong program | Criterion |
|---|---|---|
| `review_passes_on_yes` | a render.review requirement passes when the model answers yes to every ask and finds nothing | `#456.04d3fc26`, `#456.b4b19f96` |
| `review_sees_session` | the review's context also holds its session: the session's name, the words sent to it and its patches' reasons | `#456.e76ba4d1` |
| `keeps_bad_observation` | an observation with no number, or a number the ID view doesn't list, is kept (with no item), not dropped | `#456.58ad7293` |
| `id_view_varies_by_run` | the ID view's colours come from each item's ID hash salted by a value each process draws afresh | `#456.b4b19f96` |
| `ask_keyed_by_words` | the taste ask is keyed by the reading's words, so each wording opens another | `#456.b291398a` |
| `asks_again_after_answer` | a revision whose taste ask you answered is asked again by the next review | `#456.b291398a` |
| `keeps_all_findings` | the reading keeps every finding the model returns | `#456.a599239f` |

## Fixtures (helpers.ts)

Metres, +Y up; px y down; every frame 320 × 240 px through the document's perspective `camera@1` `cam` (40° across the
wider side), lit by a `light.sun@1` of π lx from the front left and above, under a pale `sky@1`. Items are rough,
non-metal `material@1`s, one per item.

- **The review room** (criteria 1 to 5 and 7): ten items, boxes and spheres 0.9 m across, each alone in a cell of a 4 ×
  3 grid 1.3 m apart on the plane z = 0, seen by a camera 8 m out on the grid's axis; a 1.25 m wall (`wall`) 0.6 m in
  front of the last cell; and `lantern`, a 0.5 m sphere 0.6 m behind it, which no pixel shows. render.review keeps
  (`keep`) `globe`, which shows, and `lantern`. Render-back's ID table holds these twelve items and nothing else.
  Observed at the base, on a 16 px grid of 300 render-back probes: each of the eleven others is the nearest hit of 7 to
  25 probes, the lantern of none, the sky of the rest.
- **Five crates** (criterion 6): five 1 m crates seen by a level camera 6 m out, each cut by an edge of the frame at
  revision 0 (crate-a left, crate-b right, crate-c top, crate-d and crate-e the lower corners). A crate is whole in the
  frame when camera.framing keeping it passes; alpha's patches move crate-a and crate-c whole into the frame (revision
  1), then crate-c back (revision 2). Observed at the base: camera.framing keeping each crate FAILs `loop.framing`
  (cut) on all five at revision 0; at revision 1 crate-a's and crate-c's PASS; at revision 2 crate-c's FAILs again.

## Criteria to tests

IDs are `#456.` and the first 8 hex digits of the SHA-256 of each criterion's text, `- [ ] ` dropped, trimmed and
whitespace collapsed (`criterionId` in `scripts/proof-change.mjs`); `spans` reads every test name with its ID.

| ID | File | What it asserts |
|---|---|---|
| `#456.04d3fc26` | `review.test.ts` | Two reviews of revision 0: a model that answers yes to every ask and claims PASS, then one that doubts the brief. Each row carries a reading with the model's name, its context (bytes in the store by hash) and its answers; no row and no verdict is PASS; the second verdict carries a taste ask on the requirement keyed by the revision's hash. Under `review_passes_on_yes` the first row passes |
| `#456.e76ba4d1` | `session.test.ts` | A hint planted in alpha's session name, your words to alpha (which alpha's `messages` hold) and alpha's patch reason; the review of the patched revision has a context holding the brief's goal and the outline (the lantern's ID) and not the hint. Under `review_sees_session` it holds the hint |
| `#456.58ad7293` | `idview.test.ts` | The ID view, at the snapshot's size, numbers exactly the twelve items (99 not among them), each resolving to its ID, kind and material; the lantern's number has no mark; every other mark is on its item (a probe there hits it first) and within 16 px of its visible centre (the mean of the 16 px probe grid's first hits on it). A model naming the lantern's number as missing_item, plus missing_item with no number, extra_item on 99 and `glare` on the wall: the reading keeps exactly the lantern's, with ID `lantern`, kind `mark.sphere@1`, material `lantern-mat`, and `dropped` reads 3. Under `keeps_bad_observation` it doesn't |
| `#456.b4b19f96` | `stable.test.ts` | Two runs of one revision, view, size and t give the grounded review's ID view one SHA-256 and one pixel hash, though their models answer differently; the second keeps its observations; no row (grounding `ids` and `none`) and no verdict is PASS. Under `id_view_varies_by_run` two runs differ; under `review_passes_on_yes` a row passes |
| `#456.b291398a` | `ask.test.ts` | Three reviews of revision 0 in one run, the model's one observation worded two ways: the first two verdicts carry one taste ask between them, on the requirement, keyed by the revision's hash; your `answer` is `answered`; the third verdict carries no ask. Under `ask_keyed_by_words` there are two; under `asks_again_after_answer` the third asks |
| `#456.a599239f` | `findings.test.ts` | Eight findings keep five, severities 8 to 4 in order, each with its own ID, `rev: 0`, the model's symptom, fix and acceptance condition, a snapshot among the reading's and a crop whose pixels are the snapshot's in the model's box. Revisions 1 and 2 render the same cameras and mark each finding: crate-a's resolved (both), crate-c's resolved then regressed, the others remaining. A model that can't read its images gives a reading with no finding and no observation and a `why`. Under `keeps_all_findings` eight are kept |
| `#456.95e1edbb` | `shots.test.ts` | The reading's snapshot is render-back's own (hash and size); the run writes it and its ID view to `docs/evidence/456/snapshot.png` and `id-view.png`, each existing, decoding at the snapshot's size and hashing to the reading's SHA-256, and prints the ID view's numbers. Then `TASTE.json`: absent or recorded on other SHA-256s is INCONCLUSIVE; `looks_wrong` fails; `looks_right` on exactly these passes |

## Readings where the issue and design leave a choice

- **The reading lives on the verdict row.** render.review is a claim's requirement, judged by `verdict`; its row is the
  reading, never PASS. The design names no other call that runs it.
- **"Fresh context" is checked by what the model was given.** The reading records the exact context by hash, as the scope
  says ("recorded with the model and prompt that made it"); the test reads those bytes. "The authoring session" is what
  the design and the base hold of alpha's session: its name, the words sent to it (alpha's `messages`) and its patches'
  reasons.
- **The ID view's numbers are read as data, never from the picture** (criterion 7: "no criterion above reads a picture
  to judge it"). "At its visible centre" is checked against render-back's own probes, which answer what lies under a
  pixel: the mark lies on the item and within one grid step of the mean of the grid probes that hit it first. Every item
  of the fixture is convex and wholly seen, so its visible centre and the centre of its visible box agree within that.
- **"Render-back's ID table"** is the twelve items the fixture puts in frame, each a solid; whether the table lists the
  hidden lantern by its projected box (as the base's `visible` does) or not, the view numbers twelve: eleven that show
  and the kept lantern with no mark.
- **Numbers are learned, then named.** The stub can't know the numbers before a run, so a first run with a model that
  finds nothing reads them, and the next run's replies name items by them; the ID view of one revision is stable
  (criterion 4).
- **A taste ask opens when the model doubts an ask** (any answer not `yes`). Whether an all-yes reading also asks is not
  tested.
- **"Asks nothing"** is a verdict that carries no ask at all.
- **Findings are marked by their acceptance conditions.** Each finding carries a check input a check can measure; on a
  later revision render.review measures it there: passing is `resolved`, failing `remaining`, and failing after an
  earlier review marked it resolved is `regressed` ("one that came back"). So the test takes three revisions: crate-c's
  finding is fixed on revision 1 and comes back on revision 2. Later reviews' own models find nothing, so the marks
  can't come from the model.
- **"Worst first"** is by the model's `severity`, higher worse; the five kept are the five highest.
- **"Its images unreadable"** is a model that answers it couldn't read them (`unreadable`); the reading is then empty
  and says why. How a real model call reports it is the implementation's.
- **The screenshots** are the check run's own: the reading's snapshot (equal to render-back's of the same revision, size
  and t) and its ID view, by the hashes the reading names.

## The taste call

`shots.test.ts` writes `docs/evidence/456/snapshot.png` and `docs/evidence/456/id-view.png` and prints each one's
SHA-256 and the ID view's numbers. After a run, show both to the owner in the session, attach them to the PR, and
record the answer in `tests/acceptance/456/TASTE.json`, the one file anyone adds to this folder after it is written:

```json
{"issue": 456, "criterion": "#456.95e1edbb", "verdict": "looks_right" | "looks_wrong", "who": "...",
 "when": "<ISO 8601 time>", "screenshots": {"snapshot.png": "<sha256>", "id-view.png": "<sha256>"}, "note": "..."}
```

A call on other bytes is INCONCLUSIVE. The pictures are evidence for the one taste call only; no other test reads them.

## Not tested

No criterion asks for these, so none is tested: render.review's `reference.aspect` and its still beside a snapshot
(#970); a film's contact sheet and moment strips attached to the review; the ID view's colours keeping the look's status
distance, and its numbers marked as names (that is the taste call's to see); a real model call, its cost and its ask;
what your answer to a taste ask does beyond asking nothing again; a narrowed `observe` list; a review on another machine.
