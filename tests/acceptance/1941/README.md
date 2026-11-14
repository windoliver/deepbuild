# Acceptance tests for #1941: the fix loop: named fixes applied as patches and checked again, with stale and conflicting fixes

These tests were written before any implementation existed, by a job that never saw one. The writer had issue #1941
(its scope, its Fields line, its four acceptance criteria, its proof line "The nine planted faults caught, fixed by
their own patches and passing, with the issues as data", and its Oracle line), its Oracle page (no upstream test
checks these criteria: fixes as patches, stale bases and conflicts are our patch rules, and the taste call is a
person's), its parent #455 and its siblings #1936, #1937 and #1938, its dependency #393, the design sections the issue
links and those they lean on, and base commit `7002c04af` ("Merge the #1938 branch (PR #2467) as #1941's base"), main
merged with the branch whose loop checks this issue builds on.

The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job
(design: Dogfooding). The suite is lean: one file per criterion; one test per planted fault for criterion 1, two
tests each for criteria 2 and 3, one for criterion 4, and the five planted wrong programs listed below.

**Run against the base.** `deep-show` was built at the base (`cargo build --locked --bin deep-show
--no-default-features --features full`, about 10 minutes from a warm cache) and every file was run there on an arm64
Mac with Metal: 6 of the 14 tests fail and 8 pass. The base already does part of what the criteria ask (#1938's fixes
cure eight of the nine faults; #96's stale-base rule rebases and refuses stale patches). Where a test's own
assertions hold at the base, it passes there or fails only at a planted program the base doesn't have, and each fails
on the wrong program it names. `BASE-FAILURE.txt` gives each test's first failing assertion, as
observed.

## What was read

- Issue #1941 and its Oracle page; #455 (the parent, and its Nov 8 amendment); #393 (writer layers, whole revisions,
  render-back); #1936 (the scene audit's planted faults), #1937 (the over-class fix) and #1938 (the nine planted
  faults, the loop checks and their fixes as patch ops), so nothing here tests their parts.
- `docs/canvas-primitives.md`: Writer layer (432: "a patch writes only its writer's layer", "your patch that changes
  it first takes the item into your layer"), Patch (455: `{patch, doc, base, writer, reason, ops}`, the result's
  `outcome: applied | superseded | conflict | refused`, "A stale base rebases when no ID it touches changed since;
  otherwise it's a conflict naming both writers", "a refused patch or a dry run leaves the canonical bytes
  unchanged", "The IDs a patch touches are those its ops target, plus the parent a create or move names and the
  neighbor a reorder names"), Revision (472: the revision hash is the SHA-256 of the canonical bytes; "matched by
  issue code and item IDs"; the closure lists what a revision needs to evaluate), Render-back (957: `{doc, rev, t,
  size}`, its reply's `rev` and `snapshots: [{sha256, w, h}]`, "count as proof" never), the issues-as-data paragraph
  before Check input (8388: `{check, code, severity, ids, …, fix}`; "A `fix` is patch ops only where … the second
  check returned that fixture's other codes and nothing else"), Check input: loop kinds (8539: every field, "a fix as
  patch ops (raise exposure 0.7 EV; pull the camera back 1.4 m; …)", "It can never: Pass on a model's judgment or a
  picture; … fix the document itself").
- `docs/technical-design.md`: Patch (1534), Render-back (1558), Document check (1566), Dogfooding (2658), and the
  parity-suite paragraph (2678): "Every loop fixture also applies its fix as a patch and reruns the checks, including a
  stale fix and two conflicting ones, and a fix that brings back an issue the loop already fixed stops it with one ask".
- At the base: `AGENTS.md`; `crates/deep-show/src/main.rs` (the scenario's `docs`, `claims`, `planted` and calls:
  `deep_show` with `patch`, `deep show` from a peer process, `read`, `render_back`, `verdict`, `answer`), `hub.rs`
  (`Planted`), `shared.rs` (`check_patch`: the stale-base rule, `conflict: {ids, writers}`), `verdict.rs` (`verdict_call`,
  `judge`, `judge_audit`'s `asks` and `pending`), `geometry_audit.rs` (`answer_call`), `ask.rs` and `probe.rs`
  (`render_back`), `pixels.rs` (`pixel_runs`), `extended.rs` (`asset_issues`, `over_class_fix`);
  `crates/deep-canvas-loop/src/` (`lib.rs`, `framing.rs`, `exposure.rs`, `scale.rs`, `contrast.rs`, `noise.rs`,
  `fixtures.rs`); `crates/deep-canvas/src/document/rules.rs` (number words); `scripts/proof-change.mjs`
  (`criterionId`, `spans`), `scripts/lanes.mjs`.
- The sibling suites `tests/acceptance/1938/`, `1938-redraft-contrast/` (its dispute: a caption that shows a number
  word fails validation), `1936/`, `1937/`, `96/` (writers, stale bases, conflicts), `393/` and `226/` (the taste
  call), for conventions.

Code was read only to learn the surface and what the base already does. Every expected value comes from the issue and
the design.

## What the base already does

- #1938's loop checks are built: each of the nine planted faults FAILs its check at revision 0 and names a fix as
  patch ops (`fix_ops`). The scene audit (#1936) and document.budget's over-class fix (#1937's measure in deep-show)
  name theirs too.
- A stored document opens as revision 0 (#96); alpha's `deep_show` with a `patch` applies ops on a base revision; a
  verdict judges each deliverable's current revision (#403), and its key names the revision it judged.
- The stale-base rule is #96's: a stale patch rebases when no ID it touches changed since, and is otherwise refused with
  `outcome: conflict`, `conflict: {ids, writers}` and a `stale_base` issue, the document unchanged. `rebase_by_path`
  (#138) is a planted wrong program that rebases by path instead.
- A verdict row may carry `asks` (#200, #405: approvals asked once, then listed in `pending`); `answer` (you, from your
  own shell) answers the asks open on a claim's requirement.
- `render_back` draws a revision and keeps its snapshot as a PNG in the evidence store, by hash.
- What is missing, as observed: the missing texture's fix (unset the map) leaves the texture in the envelope's
  `assets`, so document.validate still raises `asset_missing`; nothing notices a fix that brings back an issue the
  loop fixed, and no ask is raised; the planted programs below don't exist.

## Run them

Every file builds `deep-show` with cargo, so they run one file at a time. The implementer adds this line to
`scripts/lanes.mjs`, beside #1938's (this README is the instruction; this job edits nothing outside its folder):

```js
// #1941's files each build deep-show and draw on the GPU; taste.test.ts writes docs/evidence/1941/ and waits on your
// taste call in tests/acceptance/1941/TASTE.json.
alone.push('tests/acceptance/1941/');
```

```sh
npm ci                          # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/1941 --no-file-parallelism --testTimeout=600000
npx tsc -p tests/acceptance/1941/tsconfig.json   # type-check
rm -rf tests/acceptance/1941/node_modules/.vite
```

Each file first runs `cargo build --locked --bin deep-show --no-default-features --features full`, copies the binary out
of `target/` (honoring `CARGO_TARGET_DIR`; `CARGO_INCREMENTAL` and `CARGO_PROFILE_DEV_DEBUG` default to `0`), and
fails each test whose build failed. Every test passes a 60-minute timeout and writes into temporary folders it deletes,
except `taste.test.ts`, which writes the screenshots to `docs/evidence/1941/`. A 3D document is drawn on macOS's Metal
device (deep-show has no software 3D rasteriser): off macOS, or where a row is BLOCKED `gpu_unavailable`,
`unsupported_platform` or `software_adapter`, a test that draws one fails with a message starting `INCONCLUSIVE:`, as
does every test when cargo can't run. None passes or skips. Tests print the issue's proof as lines starting
`PROOF #1941`.

## The surface under test

**No new binary and no new call.** The suite drives `deep-show run` (one scenario line in, one answer line out) with
#96's stored documents and writers, #393's `deep_show` patches, `read` and `render_back`, #403's `claims`, `verdict`
and `answer`, and #387's `planted`. It adds no field to any call. Every name the issue and design don't give is this
job's, and is listed again under Readings. An implementation builds exactly these, or disputes them.

### The documents and writers

Each fixture is a document as the hub stores it: one layer `alpha-main` whose writer is the working agent alpha
(`agent:thread-alpha`, session `sess-alpha`), every item in that layer, opened as revision 0 from the scenario's `docs`.
Each is the one deliverable of a claim of alpha's. Alpha writes with `{"call": "deep_show", "session": "sess-alpha",
"doc", "patch": {"patch": ULID, "doc", "base", "reason", "ops"}}`. You write with the same patch through `{"call":
"deep show", "peer": {pid, start}}` from your own shell (pid 3002, under your terminal, not under alpha's process).

### The loop

The loop is the agent's, as the design has it ("It can never: … fix the document itself"): the check names a fix, the
agent applies it as a patch, and the check runs again.

1. **The check** is a claim's requirement judged by `{"call": "verdict", "claim"}`. A test reads, of a requirement's
   row: `result`, `issues` (each `{check, code, severity, ids, …, fix, fix_ops?}`; errors and warnings count, notices
   don't; a sub-address `<id>#<part>` in `ids` reads as `<id>`), and `asks`; and of the verdict, `result`, `asks` and
   `key.revisions[{doc, rev, hash}]`, the revision it judged.
2. **A fix as patch ops** is read from `fix_ops` when it is a list, else from `fix` as a list or as `{ops}`. Its base
   is the revision the verdict judged, unless the fix names its own as `fix: {base, ops}`.
3. **Applying it** sends those ops unchanged, as alpha's patch on that base. The reply's `outcome` must be `applied`
   and its `rev` the next revision.
4. **The next render-back** is `{"call": "render_back", "session": "sess-alpha", "doc", "rev", "t"?}` of the revision
   the patch made: `outcome: "presented"`, that `rev`, and a snapshot. Then `verdict` again, which must name that
   revision in its key. No test reads the picture.

A scenario gives all its calls before it runs, so a test learns each fix in one run and replays the loop in the next,
on the same stored document: the loop's run starts with its own `verdict`, which must name the same fix again.

### The checks, as a claim's requirements

Criterion 1 judges each planted fault by every loop check (`loopChecks`), in this order:

| `check` | |
|---|---|
| `{kind: "scene.scale"}` | |
| `{kind: "camera.framing", keep: [the fixture's kept items]}` | |
| `{kind: "render.exposure", subject: "hero"}` | `hero` the collection of the kept items |
| `{kind: "render.contrast"}` | |
| `{kind: "render.noise", flat_variance_max: 0.001}` | |
| `{kind: "geometry.shading"}` | |
| `{kind: "geometry.audit", scope: "scene", support: {floating: ["floor"]}}` | the scene audit |
| `{kind: "document.validate", assets: {missing: 0, maps: "present", licenses: "present"}}` | |
| `{kind: "document.budget"}` | |

A fault's own check is the first of its kind. A check that doesn't apply to a fixture (contrast with no text,
framing on a board) is BLOCKED there before and after its fix, which is no regression.

**A regression** of another check is a row that was PASS before the fix and isn't after, or an error or warning, by
check, code and items, that the row raises after and didn't before.

### Conflicts

A stale fix refused under the stale-base rule has `outcome: "conflict"` and names, anywhere in its reply, each writer
(as `{kind, id}` or as `<kind>:<id>`) and the item it touches. **Byte-identical** is read from `read` before and after:
the same `rev`, the same `hash` (the SHA-256 of the canonical bytes, Revision) and the same `document`.

### The ask

A loop stopped "with one ask" carries it as the base carries asks: in a row's `asks` or the verdict's, each naming the
claim's `requirement` it is on (`asksOf` reads both lists, an ask listed twice counted once). Two asks are the same
ask when they carry the same `id`, or, without one, are the same JSON. One ask means one distinct ask over the
verdicts that follow: a later verdict may list the same ask again, never another. `{"call":
"answer", "peer": <your shell>, "claim", "requirement", "answer": "yes"}` must reply `outcome: "answered"`.

### The planted programs (the scenario's `planted`, reachable only there)

The implementer adds each new one to `Planted` in `crates/deep-show/src/hub.rs` (or the loop module's `PLANTED`) and
names it in `crates/deep-show/src/main.rs`'s planted match:

| Name | The wrong program | Criterion |
|---|---|---|
| `loop_checks_cached_by_doc` | a loop check keeps the result it first gave for a document in a run (its issues and fixes) and gives it again for any later revision | `#1941.7c623121`, `#1941.2a9a26f0` |
| `floating_fix_deletes_item` | the scene audit's fix for a floating item deletes the item instead of lowering it onto what holds it | `#1941.7c623121` |
| `stale_fix_never_rebases` | a patch on a stale base is refused as a conflict even when no ID it touches changed since | `#1941.2a9a26f0` |
| `rebase_by_path` (#138's, at the base) | a stale patch rebases when no path it writes changed since its base | `#1941.2a9a26f0`, `#1941.b8b6c42f` |
| `regression_asks_every_verdict` | the ask for an issue the loop already fixed is raised again, as a new ask, by every verdict that finds the issue back | `#1941.b8b6c42f` |

Criterion 4's wrong programs are no recorded call and a call recorded on other pictures, both INCONCLUSIVE. No Cargo
test feature is needed: every test builds `full`.

## Fixtures (helpers.ts)

Metres, +Y up. Every 3D fixture is a `scene` of 320 × 240 px through a perspective `camera@1` `cam` (40° across the
wider side, near 0.1 m, far 200 m), lit by a `light.sun@1` of π lx from the front left and above that casts shadows
(at `rot` (−45°, 20°, 0)), under a pale `sky@1` with a little ambient light. Every mark has a rough, non-metal
`material@1`; the kept subjects' colours have a luminance near 0.25, so their key is near middle grey. Every scene stands
on `floor`, a box whose top is at y = 0, declared floating by the scene audit, and names the budget class `figure` (2 ms
of GPU a frame) unless said. 2D boards are drawn in the shipped clean look over a full-frame `rect@1` in the `ground`
role; no visible text shows a number or a number word.

| Fault | Fixture | Camera |
|---|---|---|
| a subject cut by the frame | a 1 m cube on the floor, 1.5 m right of the line of sight: its near face runs past the frame's right edge | 4 m out, 1.3 m up |
| clipped highlights | the cube in view, its material also emitting white at strength 4 | the same |
| text under 4.5:1 | a 480 × 240 board: "Reading room" in `ink`, 40 px; under it "Quiet hours begin at dusk" in `muted` (3.24:1 on the ground), 22 px | none |
| two items passing into each other | `crate-a` (wood) at x = −0.5 and `crate-b` (green) at x = 0.3, 1 m crates on the floor, 0.2 m into each other along x | 6 m out |
| an item floating 0.2 m above the floor | a 0.3 × 0.6 × 0.3 m vase centred at (0, 0.5, 0), its base 0.2 m above the floor | 4 m out |
| a 20 m door | a 4 × 2.7 m `arch.wall@1` with an `arch.opening@1` of `type: door`, 0.9 m wide and 20 m tall; framing keeps the wall | 12 m out |
| a missing texture | a 1 m crate whose material's `maps.base_color` names a 4 × 4 PNG by its SHA-256, listed in the envelope's `assets` with a CC0 license; the evidence store never holds the PNG | 4 m out |
| a fill that reseeds each frame | a 1 s, 60 fps board: a 240 × 160 px rect with a value-noise fill (`ink` to `ground`, scale 6 px, seed 7), its seed held at a new whole number every frame by the channel `reseed` | none |
| a scene over its class | the cube and 1,600 0.1 m spheres resting on a 44 × 66 m floor 20 to 60 m away: about three times the `figure` class by the cost model | 4 m out |

Criterion 2 makes the floating vase 0.8 m tall (from your shell) or recolours the floor's material. Criterion 3 uses
the cut cube emitting white (both faults on one camera), and the 20 m door kept by the camera 12 m out with framing's
`fill` tightened to [0.3, 0.9]. Criterion 4 adds #1936's scenes, each seen 6.5 m out in front of the room's open
side: a 4 × 2 × 0.2 m wall held twice under two IDs; and the kit room of three one-sided 4 × 2 m `plate@1` sheets with
`wall-right` at x = 2.05 (off the 0.5 m grid) or at x = 2.002 (a 0.002 m seam); and #1937's showpiece (10 ms class) with
3,600 specks, about 14 ms by the cost model.

As run at the base (`BASE-FAILURE.txt`): every fault fails its own check at revision 0 and names a fix as patch ops.
Every other loop check passes, or is BLOCKED where it can't judge the fixture (contrast with no text; framing,
exposure and the budget on a board), except where the fault itself reaches it: the cut cube's exposure, and the
over-class scene's `over_budget`, which the document's own validation adds to every row. Each fixture draws.

## Criteria to tests

IDs are `#1941.` and the first 8 hex digits of the SHA-256 of each criterion's text, `- [ ] ` dropped, trimmed and
whitespace collapsed (`criterionId` in `scripts/proof-change.mjs`):

```sh
gh issue view 1941 --repo windoliver/deepbuild --json body -q .body | grep '^- \[ \]' | \
  node -e 'for (const t of require("fs").readFileSync(0,"utf8").split("\n").filter(Boolean)) console.log(require("crypto").createHash("sha256").update(t.replace(/^\s*- \[[ xX]\] /,"").trim().replace(/\s+/g," ")).digest("hex").slice(0,8))'
# 7c623121
# 2a9a26f0
# b8b6c42f
# afbf01b2
```

Each file holds its criterion's ID as a `const ID`, and every test's name starts with `${ID}`.

| ID | File (tests) | What it asserts |
|---|---|---|
| `#1941.7c623121` | `fix.test.ts` (9) | One test per planted fault: at revision 0 its own check FAILs naming a fix as patch ops; in the loop's run the check names the same fix, alpha's patch of it on the judged revision is applied as the next revision, render-back presents that revision, and the verdict on it has the fault's check PASS with nothing raised and no other loop check regressed. The floating vase's test also requires `loop_checks_cached_by_doc` to leave the audit failing after the fix, and `floating_fix_deletes_item` to regress another check |
| `#1941.2a9a26f0` | `stale.test.ts` (2) | **Rebase:** after you recolour the floor on revision 0, the vase's fix on revision 0 is applied; both changes are in the document and the audit passes. Under `stale_fix_never_rebases` it isn't applied. **Conflict:** after you make the vase 0.8 m tall on revision 0, the fix on revision 0 is a conflict naming alpha, you and the vase; `read` before and after is the same revision, hash and document; the rerun judges revision 1 and names a fresh fix that puts the taller vase's base on the floor (centre (0, 0.4, 0)), which, applied on revision 1 by the vase's writer, passes. Under `rebase_by_path` the stale fix is no conflict; under `loop_checks_cached_by_doc` the rerun names no fresh fix |
| `#1941.b8b6c42f` | `loop.test.ts` (2) | **Two fixes:** framing's and exposure's fixes for revision 0 both set the camera; the first applies, the second on revision 0 is a conflict naming alpha and the camera with the document unchanged; the rerun passes framing and names exposure's fix fresh, which applies on revision 1, and both pass. Under `rebase_by_path` the second is no conflict. **One ask:** framing's fix, then scale's, applied in one run; no ask before; the verdict that finds framing's issue back carries exactly one ask on a requirement of the claim, framing doesn't pass and the verdict doesn't pass; a second verdict asks nothing new; your `answer` is `answered` and the verdict after it asks nothing new. Under `regression_asks_every_verdict` the two verdicts ask twice |
| `#1941.afbf01b2` | `taste.test.ts` (1) | Each planted-fault scene of #1936, #1937 and #1938: its check's fix, render-back of the judged revision, the fix applied, render-back of the new revision; each snapshot's bytes are the PNG of the hash and size render-back names, written to `docs/evidence/1941/`. Then `TASTE.json`: absent or recorded on other SHA-256s is INCONCLUSIVE; `looks_wrong` fails; `looks_right` on exactly these passes. Attaching them to the PR and showing them in the session is the implementer's, outside any test |

## Readings where the issue and design leave a choice

- **The check runs through `verdict`; "the next render-back" is a `render_back` of the patched revision, then
  `verdict`.** The loop kinds "run on request" and are claims' requirements, as #1938's suite reads them. Render-back's
  reply carries `issues` in the design, but the issue names no request that makes render-back run a claim's checks, so
  the test requires render-back to present the patched revision and the verdict to judge that same revision. Neither
  reads the picture: render-back never counts as proof.
- **A fix's base** is the revision its verdict judged, from the verdict's key. A fix may name its own (`fix: {base,
  ops}`); then that one is used and, after a conflict, must be the current revision.
- **The other loop checks** are the nine kinds of `loopChecks` with each fixture's kept items. Their own results before
  the fix are what a regression is measured against, so a check that can't judge a fixture (BLOCKED before and after)
  doesn't count against it, and one the fault itself breaks (FAIL before) may pass after.
- **The missing texture's fix** must make document.validate pass on the same evidence store: no patch can put the
  bytes back. The texture stays listed with its license in the envelope's `assets`, as #1938's fixture lists it, so
  `licenses: present` holds; Revision's closure lists only what a revision needs to evaluate, so once no material
  names the texture, nothing needs it. How the implementation gets there (the check, or the fix) is its own.
- **The loop's run** is one `deep-show run`: the loop memory a test needs (an issue the loop fixed) lives at least as
  long as the process. The test learns each fix from an earlier run on the same document and requires the loop's own
  verdict to name the same fix.
- **A fix whose base moved on** is the floating vase's fix sent on revision 0 after you changed the document from your
  own shell. Two writers can only change one item when one of them is you (Writer layer), so "both writers" are alpha
  and you. Your change to the vase takes it into your layer, so its fresh fix is yours to apply; the test applies it as
  you, as the kit applies an issue's fix as the item's writer. A conflict between alpha's own two fixes (criterion 3)
  names alpha, the only writer.
- **"Touches" for the conflict** is the design's by-ID rule: the vase's height (`params/size`) and its place
  (`at/pos`) are one item, so the fix conflicts though their paths differ. That is what `rebase_by_path` gets wrong, and
  why it matters: the stale fix would sink the taller vase 0.1 m into the floor.
- **"The rerun names a fresh fix"** is read as a fix worked out on the current revision: for the 0.8 m vase, its base
  on the floor at centre (0, 0.4, 0), within 1e-6 m.
- **Two fixes for one revision that touch the same item** are framing's and exposure's on one camera (the design's
  "pull the camera back" and "raise exposure" pair), sent one after the other on revision 0: the second follows the
  stale-base rule and is a conflict; "one at a time" is the rerun naming it again on the new revision, where it
  applies.
- **"An issue the loop already fixed"** is one a verdict raised, a later verdict after the loop's patch didn't, and a
  later verdict raises again, matched by check, code and item IDs (Revision's match). The fixture brings framing's
  issue back by scale's own fix, so no test patch is made up.
- **"Stops the loop with one ask"** is read through the verdict's asks: the verdict that finds the issue back carries
  one ask on one of the claim's requirements, the requirement whose issue came back doesn't pass, and the claim's
  verdict doesn't pass. Whether that row is FAIL, BLOCKED or INCONCLUSIVE, and whether its issue keeps its fix as data,
  is the implementation's. No verdict before the issue comes back carries an ask. What the person's answer does is not
  in the issue; the test requires only that `answer` answers it and that no new ask follows.
- **The screenshots** are render-back's snapshots of the revision the check judged and of the revision the fix made,
  taken in the test run, written under fixed names. The reseeding fill is also drawn one frame later each time, since a
  still can't show the fault. The screenshots cover every scene the scope lists, criterion 1's nine and #1936's and
  #1937's; the missing texture's "after" is drawn whatever its check then says.

## What the implementer meets

- At the base the missing texture's fix, `unset` of `items/crate-mat/params/maps/base_color`, applies, but
  document.validate then raises `asset_missing` with no item for the texture the envelope's `assets` still lists.
- `answer` at the base answers only the scene audit's approval asks (`no_open_ask` otherwise).
- The taste call: after a run writes the screenshots, show them to the owner, attach them to the PR, and record the
  answer in `tests/acceptance/1941/TASTE.json`.

## The taste call

`taste.test.ts` writes to `docs/evidence/1941/`, for each scene `<scene>-before.png` and `<scene>-after.png`
(`framing-cut`, `exposure-clipped`, `contrast-muted`, `overlap-crates`, `floating-vase`, `scale-door`,
`texture-missing`, `noise-reseeds` with `-before-next-frame.png` and `-after-next-frame.png` too, `budget-over-class`,
`coincident-walls`, `grid-off`, `seam-moved`, `budget-showpiece`), and prints each one's SHA-256. The call is recorded
in `tests/acceptance/1941/TASTE.json`, the one file anyone adds to this folder after it is written:

```json
{"issue": 1941, "criterion": "#1941.afbf01b2", "verdict": "looks_right" | "looks_wrong", "who": "...",
 "when": "<ISO 8601 time>", "screenshots": {"<name>.png": "<sha256>", ...}, "note": "..."}
```

`screenshots` names every picture with the SHA-256 the call was made on; a call on other bytes is INCONCLUSIVE. The
pictures are evidence for the one taste call only; no other test reads them.

## Not tested

No criterion asks for these, so none is tested: the clean twins (#1938's suite holds them); the fixes' amounts (the
exposure EV, the camera's distance, the vase's 0.2 m, which #1938's suite holds); the kit's parity fixtures that apply
fixes (the scope's loop fixtures), beyond the behaviour they prove; a fix with `create`, `move` or `reorder` ops under
the stale-base rule; undo; leases; `superseded`; what an answer to the loop's ask does; the reseeding fill's,
exposure's and contrast's results on another machine (#1938's criterion 2); render-back's `issues`, `audit` and
`timing`.
