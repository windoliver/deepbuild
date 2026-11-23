# Acceptance tests for #1722: render-back of an earlier revision answers module_missing for every 3D document

Written first, from issue #1722 (its report, its scope, its three acceptance criteria and its proof line), the design
sections it links and those they lean on, and the base commit `4aa543da7` ("Merge pull request #3201 …"), by a job
that never saw an implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a
dispute goes to a blind redraft of this job (design: Dogfooding). Lean: one test per criterion, one file each, AC3's
plant inside the test that names it.

## What was read

- Issue #1722; the bodies of its dependencies #806 (deep_show from a live session, rendered back headless) and #378
  (scene3d in 3D), its epic #241, and #1719 (a 3D render-back ignores the document's look), which its scope names as
  out of it ("drawing in the document's look is #1719's").
- `docs/canvas-primitives.md`: Render-back (the request `{doc, rev, t, size, …}`, the reply `{rev, …, snapshots:
  [{sha256, w, h}], visible, …}`, "Snapshots render in a headless canvas worker on the same core, so they work with the
  app closed"); Writer layer ("A writer layer that holds any 3D item is a 3D writer layer, fixed at check, and draws its
  2D items as marks in 3D or overlays"); Patch (`{patch, doc, base, reason, ops}`, `set {id, path, value}`); Revision
  ("A whole document is kept only for the current and the last good revision; older ones … keep a reverse delta or a
  hash, enough for history"); Marks in 3D (`mark.box {size: m}`); Camera `camera@1` (`position`, `target`, `fov`
  "across the wider side").
- `docs/technical-design.md`: Render-back; How we know version 0 works (Criteria to tests, both ways; Wrong programs,
  "A planted wrong program lives in test code, or behind a build feature …, and is never chosen by an environment
  variable"; the edit guard on a suite's own lane file; Dogfooding; Tests written first).
- At the base, to learn the surface and never for expected values: `crates/deep-show/src/main.rs` (the `deep_show` and
  `render_back` calls' parse, the scenario's `planted` and its names), `ask.rs` `render_back`, `probe.rs` `draws_3d`
  and `render_back_3d`, `hub.rs` (the presenting path: `has_3d`, `live_drawn`, `draw3d`, `present`, the 2D items drawn
  over the 3D frame), `over3d.rs` `shown3d`, `input.rs` `snapshot`, `snapshot.rs`, `evidence.rs`,
  `crates/deep-canvas-scene3d/src/scene.rs` `has_3d`, `crates/deep-show/tests/render_back_world.rs` (a render-back
  scenario through `deep-show run`), `packages/hub/src/canvas.ts` `showCall` (the hub's `deep_show` tool forwards a
  call with no document and no patch as `render_back`), `scripts/proof-change.mjs` (`criterionId`),
  `scripts/lanes-lists.mjs` and `scripts/proof-guard.mjs` (a suite's own `lane.json`); and `tests/acceptance/1401/`,
  `384/`, `1174/` for conventions.

## The base

The issue was filed against main `d4ed7be7`. Since #1401 (`5eb6ddf42`), `render_back` sends a revision that draws in 3D
(`probe.rs` `draws_3d`: a 3D item, or `requires.modules.scene3d`) to `render_back_3d`, which draws its 3D writer layers
on the GPU and nothing else. So the base no longer answers `module_missing` for this fixture; it draws the 3D frame
without the 2D items over it. Measured at the base (a scratch run of this fixture, since removed, and
`BASE-FAILURE.txt`):

- Presenting rev 1 (a sole writer's document, `deep_show` with its document) draws the box and the badge over it: PNG
  `5d1747c9…`, the badge at its box [40, 30, 100, 60] in the `ink` role over the `accent` box, on a white backdrop.
- Render-back of rev 1 at the same t and size answers `presented` with the 3D frame alone, PNG `8f17f4e6…`: 6,000 of
  76,800 pixels differ from presenting's, exactly the badge's, so the 3D frame is drawn as presenting draws it and only
  the 2D items are missing. The same holds for rev 1 with rev 2 current; rev 2's render-back draws rev 2's 3D frame.
- The unknown planted name answers `{"ok": false, "code": "bad_input"}`.
- A seeded document (stored at revision 0 in the scenario's `docs`, a shared one in `deep-show run`) takes the agent's
  whole document as rev 1 and a `patch` as rev 2, but its presenting reply draws the 3D frame alone too (PNG
  `8f17f4e6…`, no badge), so its render-backs of rev 1, before and after the patch, equal presenting's at the base. That
  is why AC2's rev 2 is the sole writer's next whole revision (Readings).

So all three tests fail at the base: AC1 and AC2 on pixel hash, AC3 at its scenario's `bad_input`. AC1's failure names
both hashes and the pixels that differ rather than a kind, since the base no longer answers `module_missing`; the judge
still names a refusal's code and path, which for a missing module names the kind.

## Run them

```sh
npm ci                          # once, if node_modules is missing
PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  node node_modules/vitest/vitest.mjs run --root tests/acceptance/1722 --no-file-parallelism --testTimeout=600000 --hookTimeout=180000
node node_modules/typescript/bin/tsc -p tests/acceptance/1722/tsconfig.json
```

`PATH` only needs the line when cargo isn't on it already. Every file first builds `deep-show` once (`cargo build
--locked --bin deep-show`, in its own hook with a one-hour timeout), copies it out of `target/debug` and fails each
test if the build failed. Each test plays one scenario through `deep-show run` into its own temporary folder (the
evidence store) and deletes it. A 3D frame draws on macOS's Metal device, so off macOS each test fails with a message
starting `INCONCLUSIVE:`, never passes. Nothing is gated on power or load. A run with `--root` may leave Vitest's cache
in `tests/acceptance/1722/node_modules/.vite`; delete it. Tests print the issue's Proof as lines starting `PROOF
#1722`: the presenting and render-back pixel hashes, and the plant's failure.

At the base the three files took 45 s with `deep-show` already built, at a 1-minute load of 265 to 311 on 18 cores; a
cold build of `deep-show` took 39 minutes at that load.

## Legs that read BLOCKED or INCONCLUSIVE

- Off macOS, every test fails with `INCONCLUSIVE: a 3D revision is presented and rendered back on macOS's Metal device`
  before it runs anything; it never passes there.
- None reads BLOCKED: nothing waits on an asset, a pack, a person or a timing budget.

## What the implementer adds outside this folder

- The planted program `render_back_2d_only` in `crates/deep-show` (a name `planted` maps to, under whatever build
  feature the repo's plant rules ask for), so AC3 can run.
- No `scripts/lanes.mjs` line: this folder's own `lane.json` runs it alone (`shared: the GPU`), and lands with the
  suite unsigned (technical design: the edit guard).

## The surface under test

The issue names `deep_show` with no document and no patch, served by `crates/deep-show/src/ask.rs`'s `render_back`, and
saw the fault "both through `deep-show run` … and through a live hub and `deep mcp`". These tests use `deep-show run`
(#393's stand-in for the hub's canvas side), where `render_back` is a call of its own and where a scenario holds
sessions, documents, revisions and `planted`. Everything #393's, #96's, #384's and #1401's READMEs define for it stays as
it is. Nothing is added to the surface but AC3's planted name.

- **Presenting** *(chosen)*: `{"call": "deep_show", "session", "doc", "document", "t": "0s", "size": [320, 240],
  "include": ["pixels"]}`, the agent's whole document. The scenario's `docs` names the document's panel and holds no
  revision (a sole writer's document, as #393's), so this makes rev 1. Its reply is read for `outcome: presented`, `rev:
  1` and `snapshots[0]`.
- **The change to rev 2** *(chosen)*: the agent's next whole document, `{"call": "deep_show", "session", "doc",
  "document", "t": "0s"}`, with no pixels asked, read for `rev: 2` (Readings: "a patch to rev 2").
- **Render-back** *(chosen)*: `{"call": "render_back", "session", "doc", "t": 0, "rev": n, "size": [320, 240]}`, the
  call `deep-show run` takes for a `deep_show` with no document and no patch; `t` in flicks, as the hub's `deep_show`
  tool forwards it. Its reply is read for `snapshots[0]` and, when it has none, for `code` and `path`.
- **A snapshot** is read from the evidence store at `<first 2 hex>/<other 62 hex>` of its `sha256`, checked to hash to
  its name and decoded as an 8-bit RGB or RGBA PNG of its `w` × `h`.

### Planted program

Reachable only through the scenario's `planted`; at the base it is an unknown name, which `deep-show run` answers
`{"ok": false, "code": "bad_input"}`.

| `planted` | The wrong program | Test, and what its failure must name |
|---|---|---|
| `render_back_2d_only` *(chosen)* | A render-back that drops the 3D writer layers and draws only the document's 2D marks; it refuses nothing and answers no `module_missing`. Presenting is not planted. | AC3: AC1's judge fails on it on pixel hash, naming the render-back's pixel hash against the presenting reply's |

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed, the leading `- [ ] `
dropped (`criterionId` in `scripts/proof-change.mjs`), checked against the live issue. Each test's name starts with
`AC<n> #1722.<id>`. Each file's header states its fixture and wrong programs in full.

| ID | File | What it asserts |
|---|---|---|
| AC1 `#1722.0e7d621b` | `ac1-same-as-presented.test.ts` | The fixture presented at rev 1 (t = 0, 320 × 240), then rendered back at rev 1, t = 0, 320 × 240 in the same run: the render-back's first snapshot has the presenting snapshot's pixel hash. A refusal fails naming its code and path (a missing module's path names the kind); other pixels fail naming both hashes and the count of pixels that differ |
| AC2 `#1722.3cd1b369` | `ac2-earlier-revision.test.ts` | The fixture presented at rev 1; the agent's next whole revision makes rev 2, moving the box 1.5 m (3D) and the badge 120 px (2D); then render-backs of rev 1 and rev 2: rev 1's has the pixel hash of rev 1's first (presenting) snapshot, and rev 2's is a snapshot whose pixel hash differs from it |
| AC3 `#1722.ca41cae8` | `ac3-planted-2d-only.test.ts` | AC1's scenario under `planted: render_back_2d_only`: the render-back reply says `module_missing` nowhere; AC1's judge fails on it, and on pixel hash (a snapshot, unlike the presenting one); and the plant is the one named: where the badge covers the box it draws the badge as presenting did (within 2 codes), where the box shows alone it doesn't draw the box (more than 2 codes off) |

### Wrong programs

- **The merge base** fails AC1 and AC2 as "The base" says, and AC3 because its run refuses the unknown planted name.
- **AC3's plant** fails AC1 on pixel hash, which is AC3's own assertion.
- By construction AC1 also fails on a render-back that draws the 3D frame without the 2D items over it, or the 2D items
  without the 3D frame, or at another `t` or size, or by any path whose pixels aren't presenting's. AC2 fails on one
  that draws the current revision for any `rev`, or rev 1's 3D frame with rev 2's 2D items (or the reverse), since rev
  2 moves both; and on one that draws rev 1 for any `rev`, or refuses rev 2.

## The fixture

None on disk: the document is generated in `helpers.ts`. One agent session, `sess-alpha` (thread `thread-alpha`), and
one document on panel `main` (800 × 600 px), with no revision until the agent presents it.

- **Rev 1**, the agent's whole document, `profile: scene`, `size: [320, 240]`, `camera: cam`, `requires: {modules:
  {scene3d: ^1}}`, no look and no sky, three items:
  - `cam`: `camera@1`, perspective, at (0, 0, 8) m looking at the origin, `fov` 40°;
  - `box`: `mark.box@1`, 2 m on a side at the origin, filled with the `accent` role; it makes the agent's layer a 3D
    writer layer (and is the item whose kind the issue's `module_missing` named, `items/box/kind: mark.box@1`);
  - `badge`: `rect@1` at `box: [40, 30, 100, 60]` (u, px at 320 × 240), filled with the `ink` role, over the box's
    top-left corner: a 2D item the 3D layer draws over its frame.
- **Rev 2**, the agent's next whole document: rev 1's with `items/box/at/pos/0` 1.5 and `items/badge/params/box`
  `[160, 30, 100, 60]`.
- **Fixture checks** on the presenting snapshot before any render-back is judged, so the hashes compared are of a frame
  that holds both layers: the box drawn at (190, 150) more than 24 codes from the backdrop at (300, 225); the badge
  drawn at (55, 40) more than 24 codes from the backdrop and from the box; and the badge over the box at (130, 85),
  within 2 codes of the badge alone. Those pixels hold whether `fov` spans the frame's width or its height.

## Readings where the issue leaves a choice

- **"A 3D document"** is one whose layer holds a 3D item, so it is a 3D writer layer (Writer layer), and it holds a 2D
  item too, since the scope asks render-back to draw "its 3D writer layers on the GPU …, with its 2D items over them"
  and AC3's plant draws "only the 2D marks"; a document of 3D items alone wouldn't tell AC3's plant from a 2D one with
  no 3D, nor the base's render-back (which draws no 2D items over its 3D frame) from presenting.
- **"Presented at rev 1"** is the agent's first whole document through `deep_show` with its pixels; **"the presenting
  reply's"** snapshot is that reply's first, which is also **"rev 1's first snapshot"** in AC2.
- **"The same `t` and size"**: t = 0 (the issue's own call has `t: 0`), as `"0s"` to `deep_show`, which takes the time
  grammar's text, and as 0 flicks to `render_back`; and the document's own 320 × 240, given explicitly in both calls.
- **"A patch to rev 2"** is the agent's next whole revision through `deep_show`, not a `patch` call. In `deep-show run`
  a `patch` applies only to a seeded (shared) document, and presenting a seeded 3D document draws no 2D items over its
  3D frame at the base, so on that path rev 1's render-back already equals its first snapshot there and the test could
  not fail at the base (The base). A sole writer's document changes by whole revisions: Patch lands "R1 whole revisions
  through `deep_show`", and Revision diffs a whole revision against the current one by every ID its writer's layer
  holds. The change is the one a patch would make, two `set`s: the box's x and the badge's box.
- **"Pixel hash"** is SHA-256 of the decoded picture (width and height as u32, then its RGBA bytes), so two PNGs of the
  same pixels match however they were encoded; the reply's `sha256`, the PNG's own hash, is printed beside it.
- **"Rendered back"** is `render_back` in the same `deep-show run` that presented, as the issue saw it ("A one-box 3D
  document presented at rev 1 answers `module_missing` on `{call: render_back, rev: 1, t: 0}`").
- **"Naming the kind"** on the base: a refusal fails with its `code` and `path`, which for a missing module is
  `items/<id>/kind: <kind>`. The base no longer answers that (The base), so its failure is on pixel hash instead.
- **"Rev 2's differs"**: rev 2's render-back is a snapshot, and its pixel hash differs from rev 1's first snapshot's. A
  refusal for rev 2 fails too.
- **"Fails the first criterion on pixel hash"**: AC1's own judge, run on the plant's reply, finds a snapshot whose
  pixel hash isn't the presenting reply's (not a refusal, not a missing snapshot). **"Gives no `module_missing`"**:
  the string appears nowhere in the planted render-back's reply. **"Drops the 3D layers and draws only the 2D
  marks"** is checked at two pixels of the fixture, so a plant that draws something else (a blank frame, the real
  frame) isn't the one AC3 names.

## Not tested, because no criterion asks

The `visible` table (the scope asks for "the same `visible` table"; no criterion reads it); that `module_missing` is
answered when the build lacks the module (the scope's second line); render-back through the live hub and `deep mcp`
(the hub forwards to the canvas core this surface plays); render-back with the app closed; a document with a look
(#1719's); revisions older than the last good one; a seeded (shared) document's presenting and render-back, and a
`patch` call (Readings: "a patch to rev 2"); and the render-back reply's `rev` field.

## Files

- `ac1-same-as-presented.test.ts`, `ac2-earlier-revision.test.ts`, `ac3-planted-2d-only.test.ts`: one test each.
- `helpers.ts`: the build, the scenario runner and the JSON tools (copied in part from #1401's helpers), the PNG
  reader (from #1174's), the fixture, the calls, the pixel hash and AC1's judge.
- `tsconfig.json`: the root's options for these files, as #1401's.
- `lane.json`: runs the folder alone (`shared: the GPU`).
- `BASE-FAILURE.txt`: the run at the base, home paths written as `~`.
