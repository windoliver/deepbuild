# Blind redraft of #162's AC6: a repeater's copies and a twist's output path in the Lottie export

AC6, `#162.bc95e877`: "A repeater with 3.5 copies exports as four groups, the last at half its opacity, and a document
with a twist exports its output path keyed at each export frame where it changes"

Written by a fresh blind job from issue #162, the design sections it links, its oracle map and the base commit
`53c0e72a3` (`53c0e72a3c36cfd5b2d8e34006770c67d0be4be6`), which has no Lottie export. No implementation was seen, and
no other worktree, branch or PR was read or checked out. The implementing agent doesn't edit these files (AGENTS.md:
Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

## What was read

- The issue, live (`gh issue view 162 --repo windoliver/deepbuild`, November 13, 2026): its Scope ("a repeater as its
  copies, groups with their transforms and opacities; zig zag, offset path and twist as their output paths, keyed at
  each export frame where they change"), its Fields and its acceptance criteria. The test ID is the first 8 hex digits
  of the SHA-256 of the checkbox's text, trimmed, white space collapsed (`scripts/proof-change.mjs`, `criterionId`).
- The oracle map (`doneright/oracles/issues/162.md` in DeepBuildAI/deepbuild, branch `doneright`): AC6 has no upstream
  test, since Lottie 1.0.1 defines no repeater or twist and its players draw ⌈copies⌉ at full opacity.
- `docs/canvas-primitives.md`: Export; Export: Lottie; Path `path@1`; Path `path@1`: ops (the repeater's "a fractional
  count draws its last copy at the fraction's opacity"; twist's fields); Units and axes (y down, degrees).
- `docs/technical-design.md`: Films and figures on the canvas; Dogfooding.
- At the base: `AGENTS.md`; `tests/acceptance/501/` (README and helpers: `deep-show run`, the scenario, `deep show`, the
  film fixture), `tests/acceptance/160/` (README and `parity.test.ts`: how its ops behave and how its suite reads a
  path's output), `tests/acceptance/157/README.md`; `crates/deep-canvas-marks/src/pathops.rs` (`twist`, `repeat_from`,
  `Repeater::power`), `outline.rs` (`rect`), `scene.rs` (`base_verbs`, `build_path`); `crates/deep-show/src/export.rs`
  (`parse`, `Job::target`, the `unknown_target` refusal); `crates/deep-canvas-motion/src/curve.rs` (a channel holds
  before its first key and after its last), `eval.rs` (`write`, `through_op`), `module.rs` (the motion fields' edits);
  `crates/deep-canvas/src/schedule/view.rs` (`slot_at`).
- Probes of the base build (`deep-show`, `full`): both fixture films are presented; `eval` with pixels of the twist
  film at 0 s and 1.5 s draws the rect's fill on both sides of the edges `twistedPlate` puts there (inside and
  outside the twisted shape, where the untwisted rect would differ); on a twisted path, a channel on
  `items/<id>/params/ops/0/angle` is refused at show and one on `…/ops/0/twist/angle` is presented (below: Notes).

## Run it

```sh
export PATH="$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH"
npm ci    # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  node node_modules/vitest/vitest.mjs run --root tests/acceptance/162-redraft-ac6 repeater-twist.test.ts --testTimeout=600000
```

The file builds `deep-show` once in `beforeAll` (`cargo build --locked --bin deep-show --no-default-features --features
full`) and fails both tests with cargo's error when the build fails. Since it builds a cargo binary it runs alone:
`scripts/lanes.mjs` needs `'tests/acceptance/162-redraft-ac6/'` in its `alone` list (this job writes only this folder;
the implementer makes that edit). Each test runs one `deep-show run` and writes its evidence store and its Lottie file
under the OS temp folder, deleted after the test. Node built-ins and the test runner only; the folder type-checks with
`tsc -p tests/acceptance/162-redraft-ac6/tsconfig.json`. A run with `--root` leaves a cache in
`tests/acceptance/162-redraft-ac6/node_modules/.vite`; delete it, it is not part of the suite. `BASE-FAILURE.txt` holds
the run at the base.

## The surface under test

The suite's established surface for this issue. Every name the issue or the design doesn't give is marked *(chosen)*.

| Surface | Request | Reply or file read | Status |
|---|---|---|---|
| scenario | `deep-show run`, one line on stdin: `{evidence, sessions, processes, panels, docs, calls}` as `tests/acceptance/501`'s helpers write it | one line `{"ok": true, "replies": [...]}`, exit 0 | existing |
| `deep show` | `{call: "deep show", peer, doc, document, include: ["issues"]}` from your shell's peer (501's process tree; the document ID `01JB162A000000000000000006` *(chosen)*) | `outcome: "presented"` | existing |
| `export` | `{call: "export", doc, out, video: {codec: "lottie"}, lottie: {container: "json", images: "embed"}}` (the whole range, the film's own rate) | `{outcome: "exported", receipt}` (an object; its fields aren't read here) and a Lottie JSON file at `out` | new: the issue's fields |
| the file | — | the root composition's `fr`, `ip`, `op`, `layers`; each item's layer has the item's `name` as its `nm`; shapes by `ty` (`gr` with `it`, `sh` with `ks`, `fl` with `o`, `tr`); groups' `tr` and layers' `ks` (`a`, `p` or split `p`, `s`, `r`, `o`); properties `{a, k}`; keyframes `{t, s, h?, o?, i?}`; `sh` values `{c, v, i, o}` (a keyframe's `s` as a one-element list or the value itself); `hd`, `st`, `sr`, `ip`, `op`, `parent`, `ind` | the Lottie format |

A repeater's copies are written as groups (Lottie 1.0.1 has no repeater), each holding the item's geometry, with its
own `tr` (position and opacity). The film is a `film` profile document with a 2D orthographic camera over its frame
(320 × 180 u) and a ground rect.

## Fixtures

Made at test time (`helpers.ts`), both 320 × 180 at 24 fps:

- **The repeater film** (1 s, 24 export frames): `Tiles`, a path@1 square `M 20 20 L 50 20 L 50 50 L 20 50 Z` filled
  in `accent`, with one op `{repeater: {copies: 3.5, at: {pos: [60, 0]}}}` (opacity `[1, 1]`, partial `fade` and
  composite `below` at their defaults). Copy k is the square moved 60k u along x (the transform applied k times,
  Path: ops; the base's `Repeater::power`), at opacity 1 for k = 0, 1, 2 and 0.5 for k = 3 (3.5 − 3, faded). *(chosen)*
- **The twist film** (2 s, 48 export frames): `Plate`, a rect@1 with box `[100, 50, w, 80]` filled in `accent`, with one
  op `{twist: {angle: 60, center: [100, 50]}}`, and a channel `grow` on `items/plate/params/box/2` keying w from 40 at
  0.5 s to 160 at 1.5 s, linear (held before and after). *(chosen)* A rect with ops becomes a path (Path: ops), at the
  base `M (x, y) L (x + w, y) L (x + w, y + h) L (x, y + h) Z`. The base's twist turns every point about `center` by
  angle × max(0, 1 − d ÷ R), R the farthest anchor's distance from the centre, from +x toward +y, and keeps a line a
  line. So the corner at the centre stays, the far corner stays, and the other two turn by 60° × (1 − w ÷ R) and
  60° × (1 − 80 ÷ R), R = √(w² + 80²). w is 40 through frame 12, 40 + 5 (f − 12) from frame 12 to 36, and 160 from
  frame 36 on, so **the output path changes at every export frame from 13 to 36 and at no other**; each change moves a
  corner more than 1 u. The test checks these two facts of its own fixture before it exports.

## What the test asserts

`repeater-twist.test.ts`, two tests, each named `AC6 #162.bc95e877 …`:

1. **A repeater with 3.5 copies exports as four groups, the last at half its opacity.** The film is presented and
   exported; the file's `fr` is 24 and `op − ip` is 24; one root layer has `nm` `Tiles`; its tree holds no repeater
   shape (`rp`); descending through any one group that wraps all of its geometry, exactly four groups hold geometry and
   no geometry sits beside them. At each of the 24 export frames the layer is on, each group holds one path, its
   square (through the groups' `tr` and the layer's `ks`) lies on one copy's square within 0.01 u, each copy is matched
   once, and each draws at its copy's opacity within 0.001: 1, 1, 1 and 0.5.
2. **A document with a twist exports its output path keyed at each export frame where it changes.** The film is
   presented and exported; `fr` 24, `op − ip` 48; one root layer has `nm` `Plate`; it holds no twist shape (`tw`) and
   one path (`sh`). Its keys: each at a whole export frame inside 0 to 47; a key at each of frames 13 to 36, where the
   output path changes; no key at a frame where it doesn't change, other than frame 0 and frame 12 (the held frame the
   change starts from, which a player needs to hold the path there). At each of the 48 export frames the layer is on,
   and the path, read as a player reads it, is the twist's output path within 0.01 u: the same four sides from any
   starting corner in the same direction, each side's handles on it.

Each failure names its frame (and its group or side), and every failure is listed, not only the first.

## Readings where the issue and the design leave a choice

1. **Export frame f is composition frame `ip + f`**, and a key at layer time t is at composition frame `st + t × sr`
   (the layer's local time is (F − st) ÷ sr). *(chosen)*
2. **"Read as a player reads it"**: a static property is its `k`; a keyed one holds its first key's `s` before it and
   its last key's `s` after it, holds from a key with `h: 1` to the next, and otherwise eases from its `s` to the next
   key's `s` by the cubic Bézier (0, 0), `o`, `i`, (1, 1) in time (each ease's first dimension). A point maps through
   each group's `tr`, inner first, then the layer's `ks` and its parents': position + rotation · scale ÷ 100 · (point −
   anchor), rotation from +x toward +y. Skew is not read (no fixture needs it).
3. **Where the copies' positions live** is the writer's: the test compares where each group's square lands, so a copy's
   offset may sit in its group's `tr` or in its vertices. *(chosen)*
4. **A copy's opacity** is the product of its layer's `ks.o`, the `tr.o` of every group from the layer down to its path,
   and the `o` of every fill at each level it sits in, each ÷ 100: what a single-fill square draws at. *(chosen)*
5. **The copies** are the groups at the first level, from the layer's shapes down through any one group that wraps all
   the geometry, where more than one group holds geometry; hidden shapes (`hd: true`) don't count. *(chosen)*
6. **"Keyed at each export frame where it changes"** reads as the key frames being the frames where the output path
   differs from the frame before, plus at most the frames a player needs to hold it: frame 0 and the frame just before
   each run of changes. A key at every export frame, at a half frame or outside the export's frames fails. *(chosen)*
7. **Tolerances**: 0.01 u for points (#160's tolerance for path ops) and 0.001 for opacity; the criterion gives
   none. *(chosen)*
8. **The twist's semantics** are the base's (`crates/deep-canvas-marks/src/pathops.rs` `twist`), since the export
   writes the document's own output path: the design gives no profile or sense for twist, and #160's suite left the
   sense open. *(chosen)*
9. **What changes the twist's output** is its input, the rect's width, rather than its angle. *(chosen)* Path: ops
   makes every op field a channel target, but at the base the hub refuses a channel on `items/<id>/params/ops/0/angle`
   (#160's convention, the op's one key naming its kind) with `bad_doc` at `items/<id>/params/ops/0`, while
   `…/ops/0/twist/angle` is presented. A fixture on either spelling would rest on a choice this criterion doesn't
   make; a twist whose input moves changes its output path with neither.
10. **The film's layers**: an item's layer is a layer of the root composition, found by `nm`, exactly one per item; a
    precomposition is not searched. *(chosen)*

## Wrong programs

Before committing, both judgements (`tilesFailures`, `plateFailures`) were run, in a scratch harness that isn't part of
this suite, on hand-written Lottie files. These pass: the right files, with the copies' offsets in their `tr` or in
their vertices, a fill shared outside the copy groups, the copies straight in the layer's shapes, the path in the
layer's own space under a layer position and a group anchor, a layer with `st` 1, hold keys, and `s` written either
way. Each of these fails, naming a frame or the shape: three groups; five; every copy at full opacity; every copy at
half; opacities ramped 1 to 0.5; the copies at one place; copies 59 u apart; a repeater shape beside the copies; the
last copy at half in both its `tr` and its fill; the rect written untwisted, keyed right; a twist shape beside right
keys; keys only at frames 12 and 36, the channel's keys (the corners then travel on chords, 1.2 u off at frame 13 and
about 3 u mid-span); keys at every export frame; keys a frame late; one static path; keys at 0 and 13 to 36 with no
hold; a key at frame 48; keys at half frames; a key at every other changing frame. At the base both tests fail
because the export is refused with `unknown_target` (`BASE-FAILURE.txt`).

## Notes for the implementer (found while reading, not tested here)

- At the base, `deep show` of a document with a channel on `items/<id>/params/ops/<i>/<field>` (as #160's suite and
  `pathops.rs` spell an op's field) is refused with `bad_doc` at `items/<id>/params/ops/<i>` ("marks2d.frame can't
  evaluate this"): the motion module's field edits go through `deep_canvas::schedule::view::slot_at`, which writes the
  field beside the op's kind key, where `deep-canvas-motion`'s own `eval.rs` `write` reaches through it
  (`through_op`). `…/ops/<i>/<kind>/<field>` is presented by the hub; read from the code, not run, `eval.rs`'s writer
  would put it under the op's params as a key the op doesn't read. Other criteria of #162 that may key an op's field
  (a trim with Bézier keys) would meet this.
