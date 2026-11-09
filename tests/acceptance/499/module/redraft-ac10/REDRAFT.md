# Blind redraft of #499's AC10: a video's picture and its sound strip move together

Written from issue #499 (as of Nov 9, 2026), the design and base commit `f1e8736e` ("Merge pull request #1742"), by a
job that never saw an implementation of #499, another branch, a PR or the first draft of `tests/acceptance/499/`
(AGENTS.md, Proof; technical-design.md 2623 Dogfooding, 2654 Tests written first). The implementing agent doesn't edit
these files.

The criterion, exactly: "A patch that changes the rate of a video's image item and not its sound strip fails the
document check with `av_unlinked`, naming both, and the revision before it stays current; one that changes both
together applies; a planted check that compares only `start` lets the rate change through and fails".

## What was read

- The issue: Scope ("A video's picture and its sound move together: a picture of a video asset and a sound strip of
  the same asset must agree on start, in and rate unless the sound strip declares an `offset`; the document check
  reports a revision where they disagree with `av_unlinked`, naming both, so a patch that changes one alone never
  becomes current"; "An image can play a video's frames … its sound stays a strip"), Fields (Strip and track: `track`,
  `src: asset | …`, `start: time`, `in, out: flick`, `rate: rational = 1`; Image `image@1`: video frames: `frames:
  {start: time = 0, in: flick = 0, rate: rational = 1, loop, hold}`), AC10.
- `docs/technical-design.md`: Document check (1546–1568: issues as data, validation), The media module (1909), Strip
  and track (1921: "A video the camera, masks or callouts must reach plays as an image instead, its sound still a
  strip").
- `docs/canvas-primitives.md`: Time and the flick (9–25: documents write time as text, `"2s"`); Document envelope
  (292–321: `assets: {id → {sha256, license}}`; "The maps keyed by ID are closed … a canvas module adds kinds and
  items, never a map", so a strip is an item); Patch (453–466: ops `set {id, path, value}`, the result's `outcome`,
  `rev`, `issues: [{code, ids, path, …}]`, all or nothing); Revision (470–481: "A revision becomes current only after
  its check passes; a refusal keeps the last good one and returns its issues"); Image `image@1`: video frames
  (1812–1825: "Its sound, if it has any, stays a strip placed with the same start, in and rate"); Sound and video on
  the picture's clock (7101), Asset (7107–7125), Strip and track (7312–7336).
- At the base: `tests/acceptance/384/` (README, helpers: `docs` entries stored at revision 0, the agent's `deep_show`
  patches on base k − 1 making revision k, `putPng` into the evidence store), `96/README.md` (shared documents, patch
  replies, `revisions`), `498/decode/` (ffmpeg fixtures, the `BLOCKED:` rule, `tsconfig` depth); `crates/deep-show/src/
  shared.rs` (`open_shared` 572: each `docs[…].document` opens as revision 0, current, checked, with whatever issues it
  has; `patch` 645: reply `{outcome, rev, ids, achieved, issues, cost_delta, undo}`, `rev` the current revision when
  refused; `blocking` 400: a revision is refused for each new `error` issue on an item of the writer's layer; `read`
  1463: `{rev, hash, draws, issues, document}`; `shared_revisions` 1567: `{revisions: [{rev, base_rev, writer, hash,
  state: current | superseded, patches}]}`), `main.rs` (call parsing 398 `revisions`, 755 `read`, 782 patches; the
  clock-free scenario at 2296–2330), `crates/deep-canvas/src/document/apply.rs` (`op_path` 765: a `set` path is
  `items/<id>/…`; `set` 913: `params/<a>/<b>` writes a nested key), `check.rs` 1316 (an unknown kind is a notice,
  kept byte for byte), `crates/deep-canvas-marks/src/scene.rs` 4835 (`image@1` params `asset` (64 hex), `alt`, `box`,
  `fit`), `packages/evidence/src/index.ts` 255 and `intake.ts` (an `mp4` put is checked by its bytes).

## The surface

No new binary or call: `deep-show run`, with one scenario line, no virtual clock (calls carry no `at`, so an applied
patch is current at once, as `main.rs`'s clock-free scenario shows).

- **The recording**: 4 s of `testsrc2` 160 × 90 at 30 fps (H.264, no B-frames) with a 440 Hz sine at 48 kHz (AAC),
  in an MP4, made by ffmpeg at test time and put into the evidence store (`declares: 'mp4'`, `kind: 'video'`); its
  SHA-256 is the asset.
- **The film**, `docs[DOC].document`, opened as revision 0 (#96): profile `film`, `transport {frame_rate: [30, 1],
  span: "10s"}`, `assets {"rec.mp4": {sha256, license}}`, one layer `main` written by `agent:thread-alpha`, and two
  items in it:
  - `rec.picture`: `image@1`, `params {asset: sha256, box: [0, 0, 640, 360], fit: "contain", alt, frames: {start:
    "2s", in: "1s", rate: [1, 1]}}`: the recording's picture playing its frames.
  - `rec.sound`: **`media.strip@1`**, the media module's sound strip kind, `params {track: 1, src: {asset: sha256},
    start: "2s", in: "1s", rate: [1, 1]}`: the same asset's sound, no `offset`.
  Rationals are `[p, q]`, as the base writes `frame_rate`; times are the time grammar's text.
- **The patches**, the agent's (`{"call": "deep_show", "session": "sess-alpha", "doc", "patch": {patch, doc, base: 0,
  reason, ops}}`), each on revision 0:
  - start only: `set items/rec.picture/params/frames/start "3s"`;
  - rate only (the criterion's): `set items/rec.picture/params/frames/rate [2, 1]`;
  - both: that op and `set items/rec.sound/params/rate [2, 1]`, in one patch.
- **Calls, in order**: `read`, start only, rate only, `revisions`, `read`, both, `revisions`, `read`.
- **What an implementer builds**: the `media.strip@1` kind (registered by the media module, checked as an item of
  its layer), `frames` on an `image@1` whose asset is a video, and a document-check rule `av_unlinked`, severity
  `error`, whose `ids` hold both the image item and the strip, raised when an image playing a video's frames and a
  strip whose `src.asset` is that same asset differ in `start`, `in` or `rate` and the strip declares no `offset`. The
  rule must fire on a patch that touches only one of the pair, so the incremental re-check (`recheck_with`) has to
  reach the partner. With it, the base's `blocking` refuses the patch and keeps revision 0 current.
- **The planted program**: scenario `planted: "av_link_start_only"`: the same rule compares only `start`. Reachable
  only through that field, only to prove the test fails.

## Who checks what

`judge` in `helpers.ts`, the suite's own check, reads the eight replies and returns failures as sentences, each naming
its code or field in backticks. A pass is no failures:

- revision 0 reads at `rev` 0 with no `av_unlinked` and no error issue on either item, both rates 1;
- the start-only and the rate-only patch are each `refused`, `rev` 0, with an `av_unlinked` issue whose `ids` hold
  `rec.picture` and `rec.sound`;
- after the rate-only patch, `revisions` lists only revision 0, current, and `read` shows `rev` 0 with revision 0's
  hash and the picture's rate still 1;
- the both-rates patch applies as revision 1 with no `av_unlinked`; `revisions` has revision 1 current, and `read`
  shows both rates at 2, with no `av_unlinked`.

The start-only patch comes from the scope line (start, in and rate must agree); it is there so the planted twin is
shown to be the one named: under `av_link_start_only` it must still be refused. Under the twin the rate-only patch
applies, and the same `judge` must fail with a sentence naming the rate-only patch's `frames.rate` and `av_unlinked`.

## Run it

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/499/module/redraft-ac10 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/499/module/redraft-ac10/tsconfig.json   # type-check
```

The file builds `deep-show` once with `cargo build --locked --bin deep-show`, copies it out of `target/debug`, and
fails each test if the build failed. Each test makes its own temporary folder (the evidence store and the recording)
and deletes it. Node built-ins, vitest and `packages/evidence`'s public entry only. ffmpeg with libx264 (on `PATH`,
`/opt/homebrew/bin`, `/usr/local/bin` or `DEEP_FFMPEG`) makes the fixture; without it a test fails `BLOCKED:` with
`brew install ffmpeg`. Nothing reads wall time, the network or a GPU. A `--root` run leaves Vitest's cache in
`node_modules/.vite` here; delete it. `scripts/lanes.mjs` needs this folder in its one-at-a-time list, as the other
cargo-building suites do; the implementer makes that edit.

Not run by this job: the vitest run itself (the machine is shared and loaded, so no cargo build was made). Expected at
the base: the real-program test fails because the rate-only (and start-only) patch applies, with `revisions` listing
revisions past 0 (and revision 0 may carry `unknown_field` on `frames`); the planted test fails because the base
answers `planted: "av_link_start_only"` with `{"ok": false, "code": "bad_input"}`. `tsc` passes.
