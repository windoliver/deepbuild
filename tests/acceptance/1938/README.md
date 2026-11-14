# Acceptance tests for #1938: the loop's render checks: scale, framing, exposure, contrast and noise, with planted faults and fixes as patch ops

These tests were written before any implementation existed, by a job that never saw one. The writer had issue #1938
(its scope, its Fields, its two acceptance criteria, its proof line "The nine planted faults caught, each with its code
and a fix as patch ops, and their clean twins passing, with the issues as data", and its Oracle line), its Oracle page,
its parent #455 and its siblings #1939, #1940 and #1941, the design sections the issue links and those they lean on,
and base commit `23baa43b4` ("Merge pull request #2453 …"). The Oracle page links an upstream accessibility library's
contrast tests to criterion 1; their port is `tests/acceptance/1938-oracle/`, with its own README. Criterion 2 has no
upstream test.

The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job
(design: Dogfooding). The suite is lean: one test per planted fault with its clean twin (the nine pairs criterion 1
lists), one test for criterion 2, and the one wrong program it names.

**Not run against a binary.** The machine's one-minute load was 155 to 233 on 18 cores, and `cargo` isn't on this
shell's PATH, so no Rust was built. `BASE-FAILURE.txt` says what each test meets at the base, read from the base's code,
and what running the files here without cargo showed. The type-check passes. A scratch vitest file outside the repo (not
kept) ran the generators and checked the fixtures' own numbers, listed under Fixtures.

## What was read

- Issue #1938, its Oracle page (`doneright/oracles/issues/1938.md`), #455 (the parent and its amendment of Nov 8), and
  #1939 (light readings on every snapshot), #1940 (`effects.audit`) and #1941 (fixes applied and checked again, stale and
  conflicting fixes, screenshots), so nothing here tests their parts.
- `docs/technical-design.md`: Patch, Render-back and Document check (1534 to 1589: "the loop's checks: scale, framing …,
  exposure, contrast, noise, shading …, interpenetration and floating items, … each naming its fix").
- `docs/canvas-primitives.md`:
  - The document envelope (296: `size`, `camera`, `budget: {class, …}`, `assets: {id → {sha256, license}}`,
    `collections`); Item and kind (330: `at`, `adjust`); Patch (455: the ops and their fields); Render-back (957);
    Camera `camera@1`: framing (4508); Material: texture maps (3964: `maps: {base_color, …: sha256}`); Asset (7151:
    `license: {id, terms, shareable, credit}`, `asset_missing`); Pack: studio@1 (3476: `sizes: {kind | role → [m, m]}`,
    "such as a door 1.9 to 2.4 m"); Paint: noise fill (1772); Channel and key (5348); Look `look@1`: samples (2585).
  - Check input (8390), Check input: loop kinds (8539: every field, and "Each code kind returns numbers, the pixels or
    item IDs that fail, and a fix as patch ops (raise exposure 0.7 EV; pull the camera back 1.4 m; the door is 20 m and
    doors are 1.9 to 2.4 m) … scale, framing, shading, animation and the effect counts run on evaluated data and hold on
    any machine; exposure, contrast, noise and effect timing read pixels on one machine and are INCONCLUSIVE
    elsewhere"), its occluded-share and camera-path sections, Geometry audit: scenes (9012).
  - Flicker's `reseed` rule (9147: "a fill, paper or boil seed may change only with quantized time (⌊t × hz⌋ …)"), and
    the determinism classes (9513: "A same-machine result carries the run's environment fingerprint …; another machine
    means another fingerprint", "never … let a same-machine result count on another machine").
- At the base: `AGENTS.md`; `crates/deep-show/src/main.rs` (the scenario's `docs`, `claims`, `planted`, `environment`,
  the `verdict` call), `verdict.rs` (`judge`, `judge_audit`, `raised_json`: `check`, `fix`, `fix_ops`, `machines`),
  `geometry_audit.rs` (`fix_of`), `kept.rs` and `kit/goldens.rs` (`environment`: a backend's fingerprint from the
  scenario's `os` and `driver`); `crates/deep-canvas-loop/src/lib.rs` (`geometry.shading`, `PLANTED`);
  `crates/deep-canvas/src/registry/mod.rs` (`CORE_CHECK_KINDS`, `module_of_check`), `document/check.rs`
  (`budget_check`'s `over_budget`, unknown params), `document/mod.rs` (`Issue::to_json`), `budget.rs`, `cost.rs` and
  `costs.json` (the classes and the terms the fixtures are sized by), `geometry_audit.rs` (`apart`, `fall`);
  `crates/deep-canvas-scene3d` (`spec.rs`: `camera@1`, `material@1`, `mark.box@1`, `mark.sphere@1`, `arch.wall@1`,
  `arch.opening@1`; `light.rs`: `maps`; `building.rs`); `crates/deep-canvas-marks/looks/clean.json` (the role colours);
  `scripts/proof-change.mjs` (`criterionId`, `spans`), `scripts/lanes.mjs`.
- The sibling suites `tests/acceptance/453/`, `1936/`, `1937/`, `1899/`, `1401/`, `138/README.md`, `1897/` and
  `2014-oracle/`, for conventions.

Code was read only to learn the surface and what the base already does. Every expected value comes from the issue and
the design.

## What the base already does

- `geometry.audit` with `scope: scene` (#405, #1936): two items past 0.002 m into each other are `geometry.overlap`, an
  item nothing holds is `geometry.floating`, and each fix is patch ops in `fix` where a patch can make it (a `set` of the
  item's `at/pos`). **The crates' and the floating vase's tests pass at the base**, as read.
- `geometry.shading` (#453, #1935) is the loop module's one check kind; its issues carry `check`, `module`, a text `fix`
  and `fix_ops` (none yet). A row says `machines` from the registry (`any` for it).
- `document.validate` runs the document's own checks and reads no `assets` input. `document.budget` as a requirement is
  BLOCKED `not_run`. The budget estimate (`budget_check`) refuses a document over its class with `over_budget`, its
  fix text.
- `scene.scale`, `camera.framing`, `render.exposure`, `render.contrast` and `render.noise` are registered by no module:
  a requirement naming one is BLOCKED `module_missing`, naming no module.
- A scenario's `environment: {os, driver}` (#138) is what every backend reports for the run; it enters each backend's
  fingerprint. `verdict` takes `claim` and ignores other fields. `material@1` declares no `maps`, so a material that
  names one is `unknown_field` at the base (README: What the implementer meets).

## Run them

Every file builds `deep-show` with cargo, so they run one file at a time. The implementer adds this line to
`scripts/lanes.mjs`, beside #1936's (this README is the instruction; this job edits nothing outside its folders):

```js
// #1938's files and its Oracle lane's each build deep-show.
alone.push('tests/acceptance/1938/', 'tests/acceptance/1938-oracle/');
```

```sh
npm ci                          # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/1938 --no-file-parallelism
npx tsc -p tests/acceptance/1938/tsconfig.json   # type-check
rm -rf tests/acceptance/1938/node_modules/.vite
```

Each file first runs `cargo build --locked --bin deep-show --no-default-features --features full`, copies the binary out
of `target/` (honoring `CARGO_TARGET_DIR`; `CARGO_INCREMENTAL` and `CARGO_PROFILE_DEV_DEBUG` default to `0`), and
fails each test whose build failed. Every test passes a 60-minute timeout and writes into temporary folders it deletes.
A 3D document's pixels are drawn on macOS's Metal device (deep-show has no software 3D rasteriser): off macOS, or when a
row is BLOCKED `gpu_unavailable` or `unsupported_platform`, the exposure test and the criterion 2 test fail with a
message starting `INCONCLUSIVE:`, as does every test when cargo can't run. None passes or skips. The 2D documents
(contrast, noise) draw on the CPU. Tests print the issue's proof as lines starting `PROOF #1938`.

## The surface under test

**No new binary and no new call.** The suite drives `deep-show run` (one scenario line in, one answer line out) with
#96's stored documents (`docs[id] = {panel, document}`, opened as revision 0), #403's `claims` and `verdict`, #387's
`planted` and #138's `environment`. It adds one field to `verdict` (`against`), one field to a same-machine row
(`fingerprint`) and one planted name. Every name the issue and design don't give is this job's, and is listed again
under Readings. An implementation builds exactly these, or disputes them.

### The documents

Each fixture is a document as the hub stores it: one layer `alpha-main` whose writer is the working agent alpha
(`agent:thread-alpha`, session `sess-alpha`), every item in that layer. 3D fixtures are `scene` documents of 320 × 240
px viewed through `cam`, `requires.modules: {scene3d: "^1"}` (plus `building` for the door). 2D fixtures are `board`
documents drawn in the shipped clean look. Each document is the one deliverable of a claim of alpha's whose one
requirement is the pair's check input.

### The checks, as claims' requirements

| Pair | `check` |
|---|---|
| a subject cut by the frame | `{kind: "camera.framing", keep: ["subject"]}` |
| clipped highlights | `{kind: "render.exposure", subject: "hero"}` (`hero` a collection holding `subject`) |
| text under 4.5:1 | `{kind: "render.contrast"}` (`text: wcag`, `min: 4.5` by default) |
| two items passing into each other, an item floating | `{kind: "geometry.audit", scope: "scene", support: {floating: ["floor"]}}` |
| a 20 m door | `{kind: "scene.scale"}` |
| a missing texture | `{kind: "document.validate", assets: {missing: 0, maps: "present", licenses: "present"}}` |
| a fill that reseeds each frame | `{kind: "render.noise", flat_variance_max: 0.001}` (`seeds: 2` by default) |
| a scene over its class | `{kind: "document.budget"}` |
| (criterion 2) an inward cube | `{kind: "geometry.shading"}` |

### The verdict's row

`{"call": "verdict", "claim"}` → `{result, key, requirements: [row]}`. A test reads, of its requirement's row:

- `result`: `PASS`, `FAIL`, `BLOCKED`, `INVALID` or `INCONCLUSIVE`;
- `machines`: `any` or `same`, the machines its result holds on (as the base already writes it);
- `blocked`: its rows' `code`, read only to tell a machine with no GPU (`gpu_unavailable`, `unsupported_platform`);
- `issues`: each `{check, code, severity, ids, …, fix, fix_ops?}` (the design's issue shape, as the base writes it);
  errors and warnings count, notices don't. A sub-address `<id>#<part>` in `ids` reads as `<id>`;
- `fingerprint` (new, criterion 2): on a row of a kind whose result holds on one machine, the environment fingerprint of
  the run that judged it. Any JSON value; it is compared whole.

A planted fault is **caught** when its row is `FAIL` and one error or warning on it has `check` equal to the pair's
kind, a non-empty `code`, every one of the fault's items in `ids`, and a fix as patch ops. The design names no codes for
the new kinds, so their code is the implementer's; where the design or the base names one, it is required:

| Pair | `check` | `code` | `ids` hold |
|---|---|---|---|
| a subject cut by the frame | `camera.framing` | any | `subject` |
| clipped highlights | `render.exposure` | any | `subject` |
| text under 4.5:1 | `render.contrast` | any | `caption` |
| two items passing into each other | `geometry.audit` | `geometry.overlap` | `crate-a`, `crate-b` |
| an item floating 0.2 m above the floor | `geometry.audit` | `geometry.floating` | `vase` |
| a 20 m door | `scene.scale` | any | `door` |
| a missing texture | `document.validate` | `asset_missing` | (any); the issue names the texture's SHA-256 |
| a fill that reseeds each frame | `render.noise` | any | `grain` |
| a scene over its class | `document.budget` | `over_budget` | (any) |

A clean twin **passes** when its row is `PASS` with no error or warning.

### A fix as patch ops

The ops are read from `fix_ops` when it is a list, else from `fix` when it is a list (or `{ops: [op]}`); a sentence, an
empty list or nothing is not patch ops. Each op is one of Patch's (`create`, `set`, `unset`, `delete`, `move`,
`reorder`, `rows`, `break_out`); an op by `id` names an item the document holds; a `set` or `unset` writes at or under
`items/<id>/`, and a `set` carries `value`. Where the design gives the fix's numbers the tests hold them:

- **The floating vase:** "lower the vase 0.2 m": every op sets `items/vase/at/pos` (or one of its components), and the
  vase ends at (0, 0.3, 0) within 1e-6 m, x and z unchanged.
- **The crates:** "moves one of the two out along the axis of least overlap": every op sets one crate's `at/pos`, which
  moves along x only, by at least 0.2 m.

Applying a fix and checking again is #1941's; no test here applies one.

### Another machine (criterion 2)

- **The machine** is #138's scenario `environment`: `{"os": "deep-test-os-a", "driver": "deep-test-driver-a"}` is
  machine A, `…-b` machine B. Three runs share one evidence store: A, A again (a new process), and B.
- **`verdict` gains `against`:** `{"call": "verdict", "claim", "against": V}`, `V` the whole reply of a `verdict` call
  on the same claim from another run. It judges the claim here as that verdict is read on this machine:
  - a row of a kind whose result holds on any machine (`machines: any`) is judged here, as without `against`;
  - a row of a kind whose result holds on one machine (`machines: same`) holds where `V`'s row for the same requirement
    names this run's `fingerprint`: it has `V`'s result and issues. Where `V`'s row names another fingerprint it is
    `INCONCLUSIVE`, never `PASS` or `FAIL`, and names both: its own `fingerprint` and, anywhere in the row, `V`'s.
- Without `against`, every row is judged here as the base judges it.

### The planted program (the scenario's `planted`, reachable only there)

The implementer adds it beside the loop module's `PLANTED` (or the hub's `Planted`) and names it in
`crates/deep-show/src/main.rs`'s planted match:

| Name | The wrong program | Criterion |
|---|---|---|
| `pixel_checks_hold_anywhere` | `render.exposure`, `render.contrast` and `render.noise` hold on any machine: given `against` from another fingerprint, each row is judged here and keeps its result (PASS or FAIL), never INCONCLUSIVE; everything else as shipped | `#1938.636cd049` |

#1936's `audit_checks_overlaps_only` (the scene audit's overlap pass alone) is used as it stands. No Cargo test feature
is needed: every test builds `full`.

## Fixtures (helpers.ts)

Metres, +Y up; `cam` is a perspective `camera@1` at (0, 1, 6) looking level at (0, 1, 0), 40° across the 320 px side
(focal 439.6 px), near 0.1 m, far 200 m; `sky` is black with no ambient light. `mark.box@1` is a box of `params.size`
centred on `at.pos`. Materials are unlit, opaque and double-sided. 2D boards are px at design size, y down, over a
full-frame `rect@1` in the `ground` role (#ffffff in the clean look's light theme).

| Pair | Planted fault | Clean twin |
|---|---|---|
| framing | a 1 m cube at (1.8, 1, 0): its bounds run 87.9 to 183.8 px right of the centre, past the frame's edge at 160 px | the cube at (0, 1, 0): ±40 px each way, 80 of 240 rows (fill 0.33), centred, the camera level |
| exposure | a 1.2 m cube at (0, 1, 0) of linear grey 0.18 that also emits linear white at strength 4: it draws at 4.18, every pixel clipped | the cube at 0.18 (middle grey, key 0 EV), nothing clipped or crushed; both before a 12 × 8 m backdrop of the same grey at z = −3 that fills the frame |
| contrast | a 48 px body caption "Seventy percent" in the `muted` role (#8b8f97) on the ground: 3.24:1 by the WCAG 2 formula | the caption in `ink` (#1b1d22): 16.86:1 |
| overlap | two 1 m crates standing on a 6 × 0.2 × 6 m floor (top at y = 0, declared floating), `crate-b` at x = 0.8: 0.2 m into `crate-a` along x, 1 m along y and z | `crate-b` at x = 1.2: 0.2 m apart |
| floating | a 0.3 × 0.6 × 0.3 m vase centred at y = 0.5 over the floor: its base 0.2 m above it | the vase at y = 0.3, standing on the floor |
| scale | a 4 m `arch.wall@1` 2.7 m tall with an `arch.opening@1` of `type: door`, 0.9 m wide and 20 m tall | the same door 2.1 m tall |
| missing texture | a 1 m crate whose material's `maps.base_color` names a 4 × 4 PNG by its SHA-256, the envelope's `assets` listing it with a CC0 `license`; the evidence store doesn't hold the PNG | the same document; the store holds the PNG (83 bytes) |
| noise | a 240 × 160 px rect with a value-noise fill (stops `ink` to `ground`, scale 6 px, seed 7) on a 1 s board at 60 fps; the channel `reseed` holds the fill's seed at a new whole number every frame (60 `hold` keys, 1 to 60) | the same fill, its seed 7 throughout |
| over class | a `figure`-class scene (2 ms of GPU a frame): a 1 m subject and 1,600 0.1 m `mark.sphere@1` specks on the ground 20 to 60 m away; by the base's cost terms about 6.2 ms of GPU (256 vertices a sphere at 15.04 ns) | the same scene with 16 specks, about 0.07 ms |
| (criterion 2) shading | a `mesh.asset@1` unit cube, 8 shared corners, every triangle and normal turned in: signed volume −1 m³ (#453's inward cube) | |

The scratch run checked: the framing extents and fill above; the PNG inflates to 4 rows of 17 bytes; the inward cube is
closed (every edge held twice, in opposite directions), its volume −1 m³ and no face flipped against its normals; the
contrast ratios above; the speck counts and estimates above; the noise channel's 60 keys.

## Criteria to tests

IDs are `#1938.` and the first 8 hex digits of the SHA-256 of each criterion's text, `- [ ] ` dropped, trimmed and
whitespace collapsed (`criterionId` in `scripts/proof-change.mjs`):

```sh
gh issue view 1938 --repo windoliver/deepbuild --json body -q .body | grep '^- \[ \]' | \
  node -e 'for (const t of require("fs").readFileSync(0,"utf8").split("\n").filter(Boolean)) console.log(require("crypto").createHash("sha256").update(t.replace(/^\s*- \[[ xX]\] /,"").trim().replace(/\s+/g," ")).digest("hex").slice(0,8))'
# f19b61dd
# 636cd049
```

Each file holds its criterion's ID as a `const ID`, and every test's name starts with `${ID}` (`spans` reads all 10).

| ID | File (tests) | What it asserts |
|---|---|---|
| `#1938.f19b61dd` | `faults.test.ts` (9) | One test per pair: the planted fault caught (FAIL; an issue by the pair's check kind, with a code, naming its items, with a fix as patch ops on the document) and its clean twin PASS with nothing raised. The floating vase's fix lowers it 0.2 m; the crates' fix moves one along x by at least 0.2 m; the missing texture's failure names its hash. Under `audit_checks_overlaps_only` the floating vase isn't caught. The Oracle lane's `contrast.test.ts` holds the contrast pair to the upstream formula too |
| `#1938.636cd049` | `machines.test.ts` (1) | Seven planted faults (scale, framing, shading, the scene audit, exposure, contrast, noise) judged on A: each FAIL; the first four `machines: any`, the last three `machines: same` with a `fingerprint`. On A again, against A's verdict: every row A's result and issues (the pixel rows A's codes, items and fingerprint). On B, against A's verdict: the four give A's result and issues exactly; the three are INCONCLUSIVE under another fingerprint, naming A's. Under `pixel_checks_hold_anywhere` the three are FAIL on B |

Wrong programs each file fails on are in its header. Criterion 1 fails on the base at seven of its nine pairs; its
crates and floating vase are #1936's and pass there. Criterion 2 fails on the base at its first assertion, and on its
named planted program.

## Readings where the issue and design leave a choice

- **Through `verdict`, not render-back.** The loop's kinds "run on request" (Check input), and criterion 1's "clean twin
  passes" and criterion 2's "report INCONCLUSIVE" are verdicts. So each check is a claim's requirement judged by
  `verdict`, as #453's and #1936's are; "read from render-back" in the issue's scope is how a check gets its pixels.
- **Codes.** The design names none for the new kinds, so a test requires a non-empty `code` and `check` equal to the
  kind; it requires `geometry.overlap`, `geometry.floating` (the base's), `asset_missing` (Revision: "as `asset_missing`")
  and `over_budget` (Patch's refusal codes, and the base's budget estimate) by name.
- **One issue is enough.** A check may raise more than one issue on a fault (clipped and too bright, say); one that
  names the kind, the code and the items and carries patch ops catches it. Since "a check that decides a verdict counts
  every issue of the revision", the document's own issues may sit beside it (the over-class scene's own `over_budget`
  from the budget estimate, by `document.validate`); the twin, which differs from its fault only by the fault, must
  raise nothing, so every fixture is otherwise clean.
- **The subject.** Framing's `keep` names the cube; exposure's `subject` is a collection holding it. Neither uses
  `kept` (the camera's `fit.keep`), which would move the camera to frame the subject and make a cut impossible.
- **Clipped highlights** are planted by the material's emission, not the look: a patch reaches only items, and the look
  is an envelope asset. The fix is the implementer's (the design's "raise exposure 0.7 EV" is an underexposure fix);
  any patch ops on the document's items count.
- **Text under 4.5:1** is drawn on a 2D board: 2D colours are roles, so the ratio is fixed by the look (3.24:1 and
  16.86:1), and 2D draws on the CPU. A document with no kept items has no subject for `subject_ratio` to judge.
- **A 20 m door** is the building module's `arch.opening@1` with `type: door`, the base's only door. The document names
  no pack: studio@1's `sizes` are first-party, so `scene.scale` reads them, or the kind's own, without it. The wall is a
  typical 4 × 2.7 m.
- **A missing texture** is a material's base colour map (Material: texture maps) whose bytes the evidence store doesn't
  hold, licensed in the envelope's `assets` so `licenses: present` holds on the twin. The planted and twin documents
  are the same; only the store differs, so each runs with its own store.
- **A fill that reseeds each frame** keys the noise fill's `seed` to a new value every frame with `hold` keys: the
  reseed rule's ⌊t × hz⌋ at the frame rate, which a document may hold. The twin is the same fill with one seed, so a
  stable texture is no noise: `render.noise` must tell a pattern that changes between its draws from one that doesn't.
  The design gives `flat_variance_max` no default; 0.001 is far under the planted fill's variance in any unit (its
  stops are near black and white) and above the twin's 0.
- **A scene over its class** is over by the cost model's estimate, the measure `document.budget` shares with the budget
  estimate before every show, so the fault is the same on every machine and in every run. Its excess is many small far
  specks, which a draw-distance candidate (#1937's closed list) can drop while changing the picture least; which ops
  the fix holds is the implementer's.
- **Another machine** is a run whose `environment` differs, the only seam for one in `deep-show run` (#138). A
  same-machine result "carries the run's environment fingerprint" and never counts on another, so the test carries A's
  verdict to B as `against`, as `determinism`'s `cross_machine` carries a record (#1897): A's pixel results read on B are
  INCONCLUSIVE, naming both fingerprints; the evaluated-data rows are judged on B and equal A's. "Hold on one machine" is
  A's verdict read on A in a new process: the pixel rows keep A's result. "The same results" compares results and issues
  whole for the four evaluated-data kinds, and codes and items for the pixel kinds, whose numbers come from pixels.
- **Shading** in criterion 2 is #453's inward cube; its fix isn't asserted (criterion 1 names no shading fault).

## What the implementer meets

- `material@1` declares no `maps` at the base, so the missing-texture pair raises `unknown_field` on both documents
  there. Material: texture maps defines the field and the renderer and the glTF import already use it; `maps: present`
  needs the kind to declare it.
- The noise fixture keys a `seed`, a whole number, with an `f32` channel.

## Not tested

No criterion asks for these, so none is tested: `geometry.shading`'s fixtures and fixes (#453, #1935); `effects.audit`
(#1940); `render.review`, `animation.*`, `physics.audit`'s fields (#132); `document.budget`'s `lod` and
`document.validate`'s `maps` and `licenses` beyond the twin passing them; `camera.framing`'s `margin`, `fill`, `horizon_max`,
`overlay`, occluded share and camera paths, and `render.exposure`'s crushed shadows and key one at a time; APCA; the
fixes' amounts beyond the vase's and the crates'; applying a fix, stale and conflicting fixes (#1941); light readings
on snapshots (#1939); the checks' costs.

## Upstream tests (the Oracle lane)

`tests/acceptance/1938-oracle/` ports the upstream accessibility library's WCAG 2 contrast ratio and runs it against
this suite's contrast pair. It re-exports this folder's `helpers.ts`.
