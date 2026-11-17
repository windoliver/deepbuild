# Blind redraft for #172, criterion 2: the refusals at export

A fresh draft of one test, criterion 2's refusal half, written blind as the design's Dogfooding rule says: from issue
#172 (live, November 15, 2026), the design and the base commit `d8c46f0d5` ("Merge pull request #2601") with the
first draft of this issue's suite in `tests/acceptance/172/` (commit `c7f88693c`). No implementation, other branch,
other worktree, PR or dispute was read. The implementing agent doesn't edit these files (AGENTS.md, Proof). The secrets
half of the criterion stays the first draft's (`../172/refusals.test.ts`, its first test); it isn't redrafted here.

## What was read

- The issue, live (`gh issue view 172 --repo windoliver/deepbuild`): Scope ("Refused at export, naming each: …"),
  Fields, the criterion's text.
- AGENTS.md; `docs/technical-design.md`: How we know version 0 works (Dogfooding; tests written first);
  `docs/canvas-primitives.md`: Export: web player, Capture, Control: device, Seam and backend (device classes and
  `hands@1`), Strip and track, Status binding, Item and kind (`module_missing`).
- The first draft: `../172/README.md` (The surface under test, Fixtures, Readings), `../172/refusals.test.ts`,
  `../172/helpers.ts`, `../172/BASE-FAILURE.txt`, and the helpers they import: `../169/helpers.ts` (the scenario,
  `deep show`, the builds, #169's plate with its status binding), `../499/video/helpers.ts` (`cfr30`),
  `../503/helpers.ts` (the 360° video background scene, the depth points scene, the gray H.264 videos).
- At the base, for surfaces only: `crates/deep-show/Cargo.toml` (features), `crates/deep-canvas-input/src/session.rs`
  (the control kinds the base's input module holds).

Every expected value comes from the issue and the design.

## Run it

```sh
export PATH="$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH"
npm ci && npm run build --workspaces            # once, in a fresh worktree
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 scripts/lease \
  node node_modules/vitest/vitest.mjs run --root tests/acceptance/172-redraft-ac2 refusals.test.ts --testTimeout=3600000
node node_modules/typescript/bin/tsc -p tests/acceptance/172-redraft-ac2/tsconfig.json   # type check
rm -rf tests/acceptance/172-redraft-ac2/node_modules                                       # vitest's cache after a --root run
```

The file builds `deep-show` twice in `beforeAll` through #169's `useShow`: `full`, and `full,test-web-lacks`. It needs
ffmpeg with libx264 for the three videos, as #499's and #503's helpers make them. Temp folders are removed after the
test. `scripts/lanes.mjs` needs `alone.push('tests/acceptance/172-redraft-ac2/')` (the implementer adds it, beside the
first draft's lines).

## Criterion to test

The ID is `#172.` and the first 8 hex digits of the SHA-256 of the criterion's text (`criterionId` in
`scripts/proof-change.mjs`), the first draft's `AC[2]`.

| AC | ID | File (tests) | What it asserts, and the wrong programs it fails on |
|---|---|---|---|
| 2 (refusals) | `#172.33b3fb42` | `refusals.test.ts` (1): `AC2 #172.33b3fb42 a status binding, a capture, a video strip, a video background, a video point set and a canvas module the player lacks are each refused by the web export, naming it, with nothing written; a piece with three of them names all three` | Seven pieces, each first presented by `deep show` (outcome `presented`), then exported with `video.codec: "web"` into a fresh folder: the reply is `refused`; its `refused` list holds `{item, why}` entries, a non-empty `why` each; an entry's `item` names the piece's offending item; no entry names a plain item of the piece; the folder stays empty. Fails on: the merge base (`unknown_target`, no `refused` list, names nothing); an export that writes any file for a refused piece; one that names only the first thing it meets in the combined film; one that refuses naming every item of the piece |

Test count: 1. At the base it fails as `BASE-FAILURE.txt` says (observed): six pieces presented, each export
`unknown_target` with no `refused` list; the module piece's build missing.

## The surface under test

The first draft's, unchanged (`../172/README.md`: The surface under test), so the implementer builds one surface:

- `deep-show run` scenarios (#393's), `deep show` then `{call: "export", doc, out, video: {codec: "web"}}`
  (`../172/helpers.ts` `webExport`).
- Outcome `"refused"` naming each item that can't go, with nothing written in `out`'s folder. This draft reads the
  first draft's "naming each item (the design's `refused: [{item, why}]`)" as the reply carrying that list at its top
  level: `{"outcome": "refused", "refused": [{"item": <string>, "why": <string>}], …}`. An `item` names an item when it
  is its ID, a path one of whose `/`-separated segments is the ID (`status_bindings/lamp_status`, `items/sky`,
  `controls/wave`, `strips/clip`), or the ID with a version (`test.native@1`). For the module piece, `native` or the
  module's name `test.native` both name it.
- Cargo feature `test-web-lacks`: the full set plus the test canvas module `test.native` 1.0.0, kind
  `test.native@1 {box}`, which no player module set holds and no shipped build has.

## Fixtures

All made at test time; no personal data; CC0. The plain items of each 2D piece are a camera `cam`, a backdrop `back`
and an ink band `band`, as #169's pieces have.

| Piece | Build | Shown from | Offending item(s), each to be named | Plain items, never to be named |
|---|---|---|---|---|
| #169's plate with the status binding `lamp_status` on its fill (`statusDoc(true)`) | full | the agent's tree, whose record holds the verdict | `lamp_status` | cam, back, band |
| A figure with the device control `wave` (class document, role `button`, label naming the camera, `device: {class: hands@1}`, fallback the press control `wave_key`) | full | your shell | `wave` | cam, back, band, `wave_key` |
| A film with the strip `clip`: #499's 60-frame 320 × 240 H.264 file at 30 fps, track 1, from 0 s, `in` 0, `out` 2 s | full | your shell | `clip` | cam, back, band |
| #503's scene whose sky `sky` draws a 1024 × 512 equirectangular H.264 video as its background, a still HDR lighting it, its layers left out | full | your shell | `sky` | cam, white_metal, sphere |
| #503's scene whose `mark.point@1` item `depth` is drawn from a 640 × 480 depth H.264 video, its layers left out | full | your shell | `depth` | cam |
| A figure with the item `native` of kind `test.native@1`, requiring `test.native ^1` | full,test-web-lacks | your shell | `native` (or `test.native`) | cam, back, band |
| One film with the plate and its status binding, the device control and its fallback, and the video strip | full | the agent's tree | `lamp_status`, `wave`, `clip` | cam, back, band, `wave_key` |

## Readings where the issue and design leave a choice

- **Capture**: the camera's one input use (Capture: "`use: input`, which feeds only the `hands@1` backend"), which a
  document declares as a device control reading `hands@1` (Control: device). The control has what Control: device
  says every device control has: a role, a label naming the device, and a `fallback` a keyboard can operate.
- **A video strip, background or point set "the bundle can't carry"**: each from an H.264 video. Export: web player
  names only sound in FLAC or Opus as media a bundle ships compressed, so a video it can't carry decoded is refused.
- **"Naming each"**: every offending item of a piece is named, so a piece holding three is refused naming all three;
  and the refusal names what can't go, not every item of the piece.
- **"Refused at export"**: the export's reply, with nothing written, as the first draft read it (all or nothing).

## Legs that read BLOCKED or INCONCLUSIVE

None of these is ever a pass.

- BLOCKED without ffmpeg with libx264 (#499's helper's ask: `brew install ffmpeg`).
- The module piece fails, naming the build, while `deep-show` can't be built with `full,test-web-lacks` (at the base
  the feature doesn't exist); the other six pieces are still judged in the same run, and every failure is listed.

## Not tested, and why

The secrets half (the first draft's test stands); a source that needs a key and threads (in the Scope's refusal list,
not in the criterion); sound strips in FLAC or Opus (the design ships them compressed, so they aren't refused).
