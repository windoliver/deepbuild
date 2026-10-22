# Acceptance tests for #394: salience and sheets

Written first, from issue #394 (its scope, the Salience, Sheet and Graph and layout memory fields, its six
acceptance criteria and its proof line), its Oracle page (`doneright/oracles/issues/394.md` in
`DeepBuildAI/deepbuild`, branch `doneright`, and the palette file it copies under `doneright/oracles/vendor/`),
the design sections it names and the ones they lean on (`docs/technical-design.md`: Judgment, line 754; Ask,
961; Decision and rule, 969; The canvas core, 1041, with the module table's marks2d, graph, record and sheet
rows, 1054–1058; An ask, and your answer getting back, 2131, with Work goes on while you decide, 2167; the
view row, 2224; Dogfooding, 2508; Tests written first, 2539; `docs/canvas-primitives.md`: Conventions every
primitive uses, line 7, with Units and axes, 28; Question card, 775; Marks, data and diagrams, 1363; Graph and
layout memory, 2230; Route, 2250; Labels, 2273; Salience, 2303; Selection, 2324; Sheet, 2342; Variant, 4929;
Level of detail, 4943), the asks core and its schemas at the base (`packages/asks`, `ask.created@1`,
`ask.answered@2`, `claim.sent_back@1`, `ask.sources@1`), and base commit `5f498a6` ("Merge pull request #651 …
feat/391-line-motion-marks"), by a job that never saw an implementation; none existed. The conventions follow
#391's suite for the binaries and #318's for the record and the asks core. The implementing agent doesn't edit
these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

Run them (a root with no config of its own uses Vitest's defaults; the repo's `vitest.config.ts` also takes
`tests/**/*.test.ts` from `scripts/lanes.mjs`, so they join the unit lane; like #389–#391's they build cargo
binaries, so they run with `--no-file-parallelism`, and `scripts/lanes.mjs` needs its exclude and its
one-at-a-time line widened to this folder too):

```sh
npm ci                        # once, if node_modules is missing
npm run build --workspaces    # once: the asks core imports @deepbuild/record through its dist
npx vitest run --root tests/acceptance/394 --no-file-parallelism
```

`graph.test.ts` first runs `cargo build --locked --bin deep-graph`, `salience.test.ts` `--bin deep-salience`,
and `sheet.test.ts` and `taste.test.ts` `--bin deep-sheet`, in the checkout (cached after the first file); each
fails every test of its file when its build fails. The tests that raise asks open a real record on SQLite in a
temporary folder and delete it. They use only node built-ins and vitest, import the asks core and the record
through their public entries (`packages/asks/src/index.ts`, `packages/record/src/index.ts`), as #318's suite
does, and type-check with `npx tsc -p tests/acceptance/394/tsconfig.json` (the root's strict options with
`allowImportingTsExtensions` and `noEmit`). A run with `--root tests/acceptance/394` leaves Vitest's cache in
`tests/acceptance/394/node_modules/.vite`; delete it, it is not part of the suite. `BASE-FAILURE.txt` is the
run at the base: every test fails there because none of the three binaries exists.

Every test runs on the CPU, on any platform: nothing here draws pixels.

## The surface under test

The issue names salience, sheets, a layout and its memory, and a taste call, but no code API, so these tests
define the smallest surface they need: three binaries found under `target/debug/`, one per canvas module the
design's module table lists for this work (graph, record and sheet, each depending on marks2d; the core never
imports a module), plus the asks core and the record as they are at the base.

- `deep-graph` (`target/debug/deep-graph`): `layout`, the graph module's basic layered layout with its memory.
- `deep-salience` (`target/debug/deep-salience`): `level`, the record module's salience over one level.
- `deep-sheet` (`target/debug/deep-sheet`): `taste`, a taste call's candidates on a variant sheet with near
  copies dropped, and `view`, a view that lists an ask with the card's slot and its sheet beside it.
- `@deepbuild/asks` and `@deepbuild/record` as at the base: `openRecord`, `read`, `close`; `openAsks` with its
  `deliver` callback, `raise`, `answer`, `card` and `needsYou`. The tests raise the ask `taste` returns over the
  agent's connection (`mcp:<session>`, source `deep_ask.taste`, as `deep_ask` would) and answer on the trusted
  path (`app`, the question card's click). At the base `ask.created@1` closes its data
  (`additionalProperties: false`), so an ask that names its dropped copies needs a schema change; where it
  names them is the implementer's choice (below).

All three binaries run on the CPU and needn't reach GPUI. Crates named `deep-canvas…` fall in
`scripts/canvas-lint.mjs`'s scope (#389); none of these draws canvas text, so none needs the text lint.

### The JSON-lines convention

As #391's: `<binary> <subcommand>` reads one JSON object per stdin line and writes exactly one JSON object per
input line to stdout, in order, then exits 0. A line it can't read as JSON, or that lacks a required field, or
names an unknown `planted` value, is still answered with one line, `{"ok": false, "code": "bad_input"}`, never
a panic. A run that writes fewer lines than it read, or exits non-zero, fails every test that drove it. Every
refusal is `{"ok": false, "code": string}`; every acceptance has `"ok": true`. Numbers are written so they
read back to the same f64. Sizes and positions in a view and a sheet are device px at scale 1, y down, origin
top left; a layout's are in `u` (Units and axes). A rect is `[x, y, w, h]`.

### `deep-graph layout`

Input `{"graph": {"nodes": [Node], "edges": [Edge]}, "layout": {"algo": "layered", "direction": "down",
"seed": u64}, "memory"?: Memory}`. Nodes and edges are graph@1's rows; the tests send `{id, kind, w, h}` and
`{id, a, b, kind}` and leave the rest at the design's defaults (`spacing {node: 24, rank: 48, edge: 12}`,
`min_len` 1, no pins). Output `{"ok": true, "memory": Memory}`.

Memory is the layout memory format, `{id → (rank, order, x, y)}` as JSON: an object whose keys are the node
IDs and whose values are `[rank, order, x, y]`, `rank` the node's rank from 0 at the top, `order` its place in
its rank from 0 at the left, and `x`, `y` the top-left corner of its box in u. With `memory` given, it is the
memory a previous layout wrote; the output is the layout after this one.

### `deep-salience level`

Input `{"level": frame ID, "show"?: 9, "fits": n, "items": [{"id": ID, "facts": Facts}]}`. Facts are the
record facts salience ranks by, `{"needs_you", "sent_back", "failing", "lacks_proof", "touched", "changed":
bool, "priority": i16}` (touched: touched by this work; changed: changed since you last looked). `fits` is how
many items fit in the level at the minimum readable size, as the view measured it. Output:

```json
{"ok": true, "shown": [{"id": ID, "rank": n, "reasons": [key]}], "fold": {"count": n, "items": [ID], "line": string} | null}
```

`shown` in rank order, each item's computed `{rank, reasons}` (`reasons` the fact keys that hold for it);
`fold` the one count item holding everything not shown, `line` its sentence, null when nothing folds.

### `deep-sheet taste`

Input `{"ask": AskData, "candidates": [{"option": ID, "still": Still}]}`. `ask` is the agent's taste call as
`ask.created@1` taste data, one option per candidate (same IDs, `decision: none`). A still is `{"size": [w, h],
"rgba": base64}`: w × h × 4 bytes of opaque sRGB-encoded RGBA8, row-major from the top left, the candidate's
still at the cell's size as one machine rendered it. Output:

```json
{"ok": true, "ask": AskData, "sheet": Sheet, "dropped": [{"option": ID, "same_as": ID}]}
```

- `dropped`: each candidate dropped as a near copy, with the earlier candidate it counts as one with.
- `ask`: the ask to raise: the agent's ask less each dropped candidate's option, plus one option labelled
  `None of these` (`decision: none`), and naming the dropped candidates so that once raised the record names
  them: an event about the ask (its `ask.created`, or one whose `subject` is the ask) holds each dropped
  option's ID as a string value in its `data`. Which field or event is the implementer's choice.
- `sheet`: sheet@1, `{"cells": [{"id", "show", "size": [w, h], "label", "names_option"}], "columns", "gap"}`:
  one cell per kept candidate, in the candidates' order, its `size` its still's size and `names_option` its
  option. The tests read `id`, `size` and `names_option`.

### `deep-sheet view`

Input `{"view": [w, h], "card": {"ask": handle, "size": [w, h]}, "sheet": Sheet, "inputs": [{"click": [x,
y]}], "planted"?: "cell_click_answers"}`. A view that lists one ask: it reserves the card's slot (the card is
the shell's, at its measured `size`) and draws the sheet beside it, then takes the clicks in order. Output:

```json
{"ok": true, "card": Rect, "sheet": Rect, "cells": {cell ID: Rect}, "trace": [{"preselect": option ID | null, "sends": [Message]}]}
```

`card` is the slot, `sheet` the sheet's rect and `cells` each cell's rect; `trace` has one entry per input:
the session's preselected option after it, and the messages the view hands the hub for it. An answer would be
`{"answer": {"ask": handle, "option": ID}}`; the tests forward every one on the trusted path, as the app would.
The sheet never answers (Sheet: "A click preselects; only the question card answers"), so a correct view sends
none for a cell click.

`planted: "cell_click_answers"` is criterion 1's planted twin, reachable only through this field and only for
this proof: a cell click sends `{"answer": {"ask", "option"}}` for the cell's option. Nothing else reads it.

## Fixtures

All written by this job before any implementation ran.

- `fixtures/layered.graph.json`: ten nodes of different sizes and fifteen edges over five ranks, with two edges
  that skip ranks (plan → deploy, docs → deploy) and a second source (lint), so ordering matters; seed 7.
- `fixtures/level-40.json`: a level of 40 items, `i-01` to `i-40`, with their facts. Three need you (`i-31`
  also failing, `i-07`, `i-18`), two were sent back (`i-02`, `i-25`), two fail (`i-12` also lacks proof,
  `i-09`), three lack proof (`i-33` also touched and changed, `i-20` also changed, `i-04`), three were touched
  (`i-27` also changed, `i-15`, `i-38`), five changed and the rest have none; every priority is 0. IDs are
  spread so ID order, input order and "most facts" order all differ from the rank order.
- Stills are built in the tests (`helpers.ts`: `bands`, `paint`, `exposed`) and measured there with palette's
  OKLab, so each fixture's ΔE is checked before it is used:
  - three figures of three vertical bands, 120 × 80 px: warm, cool and mono differ pairwise by ΔE 0.24–0.69 at
    the 90th percentile; warm with a 2% exposure change (linear light × 1.02, re-encoded to 8 bits) differs from
    warm by 0.006;
  - two 40 × 40 pairs: a uniform still, and the same with 6 rows (15% of pixels) at a near color and 2 rows
    (5%) at a far one. Every percentile from the 81st to the 95th of the per-pixel ΔE is the near color's ΔE,
    0.08997 (base 235 grey, near [204, 206, 207], far 60 grey) and 0.10996 (base black, near [6, 4, 2], far 120
    grey), while the far pixels are 0.58 and 0.57 away.

## Criteria to tests

Each test's name starts with its ID. Where a criterion names a wrong program, a comment at the assertion that
catches it says so, and the assertion's message names what the criterion asks for.

| ID | Criterion (the issue's text) | Tests, and the wrong program each fails on |
|---|---|---|
| AC1 | A taste call shows its sheet beside the card, and a cell click only preselects | `sheet.test.ts`: a taste call of three candidates that really differ (none dropped) is raised; `view` puts the card's slot and the sheet side by side inside a 1280 × 800 view, the slot at least the card's size, no overlap, each cell at its still's exact size inside the sheet (a sheet over the card, or a scaled cell, fails). Clicks on the cool cell, on empty view and on the mono cell preselect cool, cool, mono; every message the view sent is forwarded on the trusted path, and the ask is still in Needs you with no `ask.answered` and nothing delivered; then the card's own click (`answer` over `app`) records mono and delivers it. The planted twin `cell_click_answers` fails that same check, naming the ask |
| AC2 | Re-rendering the basic layered layout with no change moves no node, and each node's rank, order and position is stored by stable ID | `graph.test.ts`: the memory has one `[rank, order, x, y]` entry per node, keyed by its ID, and is a layered layout (every edge goes down a rank or more, each rank's orders are 0…k−1 left to right at least 24 u apart, each rank at least 48 u below the last), so a layout that returns nothing or stacks nodes fails; re-rendered with its memory and no change, the memory's bytes are the same, and the same graph, memory and seed give the same output line in other processes and twice in one (a layout seeded from the clock or iterating a per-process hash map fails); the same graph with its node and edge rows reversed, with the memory, keeps every node's entry bit for bit (a memory read or written by row position fails) |
| AC3 | A canvas level with 40 items shows exactly nine when nine fit at the minimum readable size, ranked by what needs you, and folds the rest into one counted line; a view that lists asks still shows every open ask | `salience.test.ts`: with nine fitting, exactly `i-31, i-07, i-18, i-02, i-25, i-12, i-09, i-33, i-20` in that order, ranks increasing, each with the reasons that hold for it, and one fold of the other 31 whose line starts "31 more" (ID order, input order, ranking by how many facts hold, or listing all 40 fails); with all 40 fitting, still those nine; with five fitting, the first five; with seven needing you and five fitting, all seven in rank order and 33 folded (a program that lowers show below the needs-you count, folding an open ask, fails) |
| AC4 | A level with 12 open asks from four sessions, three from each, and 30 other items shows all 12 asks and folds the 30 others into one counted line | `salience.test.ts`: 12 taste calls raised through the asks core, three in each of four sessions; Needs you lists all 12; the level of those 12 (needing you) and 30 others with nine fitting shows the 12, ordered by ID, and one fold of exactly the 30 whose line starts "30 more" (a program that caps the level at nine or at what fits fails) |
| AC5 | A taste call with three figure candidates, one a copy of another with a 2% exposure change, shows two side by side beside none of these and names the dropped copy in its record; answering none of these sends the work back to the agent with your note | `taste.test.ts`: warm, warm with a 2% exposure change, and cool: `taste` drops exactly the exposed copy as the same as warm (keeping all three, or dropping the earlier, fails); the raised ask's card offers warm, cool and none of these; the sheet's two cells name warm and cool and sit in one row 8 px apart, beside the card; an event about the ask in the record holds `fig-warm-exposed`. Answering none of these on the card with a note delivers to the agent, in its session, none of these with that note and `decision: none`, and the record holds that answer |
| AC6 | Two candidates whose stills differ by ΔE 0.09 at the 90th percentile count as one, and by 0.11 as two | `taste.test.ts`: the ported formula reproduces palette's own test values and the fixture pairs measure 0.09 and 0.11 at the 90th percentile within 0.0005; the 0.09 pair counts as one (the second dropped as the same as the first, the ask offering one candidate and none of these, one cell), the 0.11 pair as two (nothing dropped, both offered, two cells). The fixtures make the wrong measures fail: a maximum (0.58) or an sRGB distance (0.20) counts the 0.09 pair as two; a mean (0.045), a median (0) or an sRGB distance (0.03) counts the 0.11 pair as one |

The bad_input convention is checked once per binary and subcommand (`graph`, `salience`, and `sheet` for both
`view` and `taste`).

## Readings where the issue and design leave a choice

- **Three binaries, one per module.** The design's module table makes graph (layout and its memory), record
  (salience) and sheet separate canvas modules on marks2d, so each has its own proof surface; `view` sits with
  the sheet because the sheet is the evidence the view draws beside the card. None draws pixels: what the
  criteria name is placement, ranking, counting and the ask's flow, so the tests read rects and records.
- **The card is #327's.** #327 (the question card: arming, hardware input) depends on this issue, so here the
  card is its slot in the view and its answer is the asks core's trusted path (`answer` over `app`), as the
  Question card section's "only a serial delivered to the card answers it" leaves it. "A cell click only
  preselects" is read as: it sets `preselect` and sends the hub nothing, so the ask stays open, unanswered and
  undelivered.
- **"Beside"** is read as left or right of the card's slot at an overlapping height, both inside the view,
  never covering it (Question card: "the view draws the evidence beside it, such as a sheet"; "It can never: Be
  covered"). Exact pixel sizes come from Sheet's "never scaled".
- **None of these** is an option of the ask the card shows, labelled `None of these`, with `decision: none`,
  not a cell: a sheet shows the candidates (Sheet: "a variant sheet shows a document's variants side by side
  … it adds none of these"), and the card, beside it, holds the options. "Sends the work back to the agent
  with your note" is read through the asks core's delivery: the agent's adapter receives none of these with
  your words as the note, so no candidate is taken. It is not read as `claim.sent_back@1`, which needs a claim
  and a verdict this flow doesn't have.
- **"Names the dropped copy in its record"** is read as: an event of the record about the ask holds the dropped
  candidate's option ID; the field or event is left to the implementer (`ask.created@1` is closed at the base).
- **The stills are data.** The taste call takes each candidate's still, at the cell's size as one machine
  rendered it, as a generation job's result reaches it; rendering a figure is #391's. So the fixtures control
  the ΔE exactly. "A 2% exposure change" is read as linear light × 1.02, re-encoded to 8-bit sRGB.
- **The 90th percentile** is of the per-pixel OKLab ΔE (Euclidean in OKLab, Ottosson's matrices as palette has
  them) between two stills of one size. The fixtures put every percentile from the 81st to the 95th on one
  value, so nearest-rank and interpolated percentiles agree. "Under 0.1" counts as one, so 0.09 is one and
  0.11 two. The later of a pair is the one later in the candidates' order.
- **Salience's facts are input.** Ranking is by record facts with no model; the tests hand each item its facts,
  as a projection of the record would. The rank list is read lexicographically ([needs you, sent back, failing,
  lacks proof, touched, changed, priority], each true before false, then ID), so one higher fact outranks any
  number of lower ones. Priority is 0 throughout, so its direction isn't assumed. `reasons` are the fact keys
  that hold for the item.
- **"When nine fit at the minimum readable size"** is read through `fits`, the count the view measured; the
  design gives no number for the minimum readable size. Show is `min(show, fits)`, never below the number of
  items that need you (Salience: "When more items need you than show allows, all of them show and every other
  item folds"; "It can never: fold or hide a needs-you item"). **"A view that lists asks still shows every open
  ask"** is read as that rule with more open asks than fit.
- **The fold's line** starts with its count, "N more", as the design's example ("14 more: 2 lack proof, 12
  unchanged"); the rest of the sentence is not read.
- **Four sessions, three each.** The 12 asks come from the asks core, which folds a thread's asks past five
  (#318); three a session keeps all 12 open and listed, which the test checks before salience sees them.
- **Layout memory.** The format is `{id → [rank, order, x, y]}`, x and y the box's top-left in u. R1 lands the
  basic layered layout with the memory format and R2 the memory rules (graph@1, Lands), so "no change moves no
  node" is held with the memory passed back unchanged, and the reordered-rows test passes whether the layout
  honours the memory or orders its input by ID. The spacing defaults are read as gaps between boxes, at least
  24 u in a rank and 48 u between ranks.

Not tested, because no criterion asks: `hold` and the "N new" wait, `files`, priority's direction, the
salience's level-of-detail and label-priority outputs, aggregate, focus, query and compare, groups, routes and
labels, pins and `layout.relayout_needed`, the 10,000-node budget, sheet treatments, highlights, columns and the
cell texture cache, contact and model sheets, and the Variant patch. The scope lists some of them; these
criteria don't reach them.

## Upstream tests (the Oracle lane)

The Oracle page lists an upstream reference for criterion 6 only; it is run here against our fixtures:

| Criterion | Upstream test (pinned) | How it runs here |
|---|---|---|
| 6 | palette `71011dee47` palette/src/oklab.rs | formula: `linear_srgb_to_oklab` (Ottosson's matrices) is ported into `helpers.ts` with palette's MIT notice; its test module's values (sRGB blue within 1e-9, linear red and green within 1e-8) are checked against the port, which then measures each fixture's ΔE at the 90th percentile. The 0.1 threshold, the percentile and counting two as one are ours, as the page says |

Criteria 1–5 have no upstream test (the page says so); these tests are their local proof.
