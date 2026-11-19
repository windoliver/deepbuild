# Acceptance test for #1992, criterion 5 (blind redraft): the castle keeps the merge base's pixels

A blind redraft of #1992's criterion 5, written from the issue, the design rows it links and the base commit `16dc5eab0` by a job that never saw an implementation, the first draft or the dispute.

The criterion, `#1992.597ff532`:

> A document with no new field draws the castle fixture (`packs/examples/castle.json`) with the same pixel hash as the
> merge base on one machine. A planted default of `fog: true` on text dims the fixture's labels and fails, naming the
> first differing pixel

It is a guard: behavior that must not change. It is judged against the merge base's own renderer, built and run on
the machine and in the run that judges it, never against a hash recorded on another machine or commit. So it holds
after main moves and the branch merges it. The implementing agent doesn't edit these files (AGENTS.md, Proof).

## What was read

- Issue #1992's body: its scope, its Fields block and its seven criteria. The fields it adds: on `sky@1`,
  `fog_curve: linear {near, far}` and `background_intensity`; on a 3D mark, `fog: bool`, true by default for lines,
  points and images and false for text.
- `docs/canvas-primitives.md`: Sky `sky@1` ("Fog applies to every lit surface by distance"; `fog: background` mixes a
  surface "toward what the background shows along its pixel's view ray"), Sky `sky@1`: height fog ("Fog applies to
  lit surfaces before tone mapping"), Marks in 3D (`fog: bool` listed with `size_space`, `paint` and `status`; "A
  mark with `fog: true` takes the sky's fog").
- `docs/technical-design.md`: What done means, fixed at the start (Who drafts it; Proven on the base: a guard must
  pass there), and Dogfooding (a disputed test goes to a fresh run of the drafting job).
- At the base: `packs/examples/castle.json`, `packs/examples/castle.look.json` and `packs/composites-1.0.0`;
  `crates/deep-gpu-layer` (`view3d`: `packs`, `targets`, `from`, `capture`, each frame's `pixel_hash`, the SHA-256 of
  the frame's bytes); `crates/deep-canvas-scene3d` (`sky.rs`, the label in `scene/rest.rs`, `spec.rs`'s common
  params); `crates/deep-scene3d-render` (`scene3d.wgsl`: `fogged`, `text_fs`; `label.wgsl`); `scripts/throttle.mjs`;
  and #422's suite, whose JSON, run and PNG helpers are copied here, since suites don't import each other.

## What the base has

- `view3d` draws the castle from its description with its recipes expanded from the pack folders in `packs`, and
  replies each frame's `pixel_hash`; with `targets: ["final", "ids"]` it writes the frame's PNG and the object-ID
  target with its `picks`.
- The castle's sky has `fog: "background"`, `fog_density: 0.002`, `fog_height: {top: -6, density: 0.1}` and
  `fog_curve: "exp"`. `sky.rs` takes `exp` or `exp2` and refuses any other curve; it reads no `background_intensity`.
- The castle holds no `mark.text@1`, and no line, point or image mark.
- A world-size label draws in the geometry pass with its paint as it is: `text_fs` doesn't call `fogged`. A
  screen-size label writes only depth and pick there, and its color is drawn after tone mapping (`label.wgsl`).
- No 3D mark reads `fog`. `fog: true` in a label's `params` is accepted and ignored: the frame's `pixel_hash` is the
  one without it.
- The labels this suite adds are dark on the frame. An unlit paint is at most 1 in the linear target, where the dusk
  sky behind them is some hundreds before exposure.

## Run it

```sh
export PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
node node_modules/vitest/vitest.mjs run --root tests/acceptance/1992-redraft-ac5 --no-file-parallelism --testTimeout=7200000 castle-guard.test.ts
node node_modules/typescript/bin/tsc -p tests/acceptance/1992-redraft-ac5/tsconfig.json
```

It builds `deep-gpu` twice, so it runs alone: `scripts/lanes.mjs` needs `'tests/acceptance/1992-redraft-ac5/'` in its
`alone` list, beside `'tests/acceptance/422/'`. This README is the instruction; the job that wrote these tests writes
only in this folder. Both builds queue in the machine's build throttle (`scripts/throttle.mjs build --wait 60`). The
GPU layer draws on macOS only; anywhere else both tests are INCONCLUSIVE, which is a failure, never a pass.
`BASE-RUN.txt` holds the run on the base.

## What each test asserts

Both tests draw through `deep-gpu run`'s `view3d` call, one process per document and renderer, one call per sampled
frame (`from: n`, `frames: 1`, `fps: 30`, `capture: "every"`, `targets: ["final", "ids"]`, `packs`): the final target
at the castle's own size, 1280 × 800 at the base, at the four quarter-turns of its orbit, frames 0, 180, 360 and 540
(t = 0, 6, 12 and 18 s), the times #422 samples. Each renderer draws its own commit's castle, in its own look, with
its own pack, and runs in its own commit's folder.

**The fixture.** Three labels are added in the test to each commit's castle; the committed file is never changed.
Each is a `mark.text@1` with `text`, `size: 2`, `size_space: "world"` and `paint: {fill: {role: "ink"}}`, facing the
camera by default: `label_keep` "Keep" at (-3, 17, -2), `label_gate` "Gate" at (-1.5, 19.5, -6) and `label_castle`
"The castle" at (3, 22, -2). They stand above the parts they name and above the camera's height (about 15.6 m), so
the sky is behind each at every sampled time. On the base each covers 939 to 2,052 pixels a frame.

| Test | Asserts |
|---|---|
| `AC5 #1992.597ff532 the castle as committed names no new field, and its frames at the four quarter-turns of its orbit, alone and with labels that name none either, have the merge base renderer's pixel hash on this machine with no pixel differing` | 1. The checkout's `packs/examples/castle.json` names no field #1992 adds, and neither does the labelled castle. 2. In the merge base's frames each label covers pixels at each sampled time, and at each of them the castle as committed draws no item (the sky is behind it). 3. For the castle as committed and for the labelled castle, at each of the four frames, this checkout's `pixel_hash` is the merge base renderer's and no pixel of the final target differs. A failure names the document, the frame and the first differing pixel with both colors. |
| `AC5 #1992.597ff532 a planted default of fog: true on text, drawn as the labelled castle with fog: true written on each label, fails the same judge at every sampled frame, naming its first differing pixel, and dims each label against the sky behind it` | 1. The labelled castle with `fog: true` in each label's `params`, drawn by this checkout, goes to the judge of the first test against the merge base's labelled frames: the judge fails at each of the four frames, and each failure names that frame's first differing pixel. 2. Each label is dimmed at each frame: its contrast against the sky behind it is lower than in the merge base's frame. |

The judge compares, frame by frame, the two replies' `pixel_hash` and the two final PNGs' RGBA pixels. The first
differing pixel is the first in rows top-down, left to right in each. A label's contrast is the mean over its pixels
(those the merge base's object-ID target gives it) and the three color channels of |frame − the same frame of the
castle without labels|, in 8-bit codes; about 121 to 134 on the base.

## The merge base and how its build is shown to be its own

**Found.** At test time: `git merge-base HEAD origin/main`, and against `main` when that fails.

**Kept.** `target/acceptance/1992-redraft-ac5/base-<sha>/` holds that commit's `deep-gpu`, the files its renderer
draws (`packs/examples/castle.json`, `packs/examples/castle.look.json`, `packs/composites-1.0.0/`) and the marker
`PROVEN.json`, written last and only after the check below held. A run reuses the folder when the marker names the
merge base's SHA and every file it lists is there with the SHA-256 it lists. Otherwise the folder is deleted and
built again. A kept folder for another SHA is deleted when a new one is proven, so one binary is kept.

**Built.** In `target/acceptance/1992-redraft-ac5/work/`, deleted when the build ends either way:

1. `git archive <sha>` exports the commit whole into `work/src`. Nothing of the checkout's working tree is copied.
2. `cp -c -R` clones this checkout's `target/debug` copy-on-write into `work/target/debug`, for the third-party
   crates: a registry crate or a pinned git revision is fixed by its version and checksum, so its compiled artifact
   is the same in any tree.
3. Every path crate of the export (its workspace members and `vendor/` crates, by `cargo metadata`'s `source: null`)
   has its fingerprint folders and build-script output folders removed from the clone, so cargo has to compile them.
4. `cargo build --locked --bin deep-gpu --message-format=json-render-diagnostics` runs in `work/src` with
   `CARGO_TARGET_DIR=work/target`.

**Shown.** Step 3 only makes cargo rebuild. What shows the build is the export's own is cargo's build messages, read
by `ownBuild` in `helpers.ts`. The build is accepted only when all of these hold:

- cargo reports `build-finished` with `success: true`, and exits 0;
- every `compiler-artifact` whose `manifest_path` lies in `work/src` has `fresh: false`: each lib, build script and
  macro of each workspace and `vendor/` crate that `deep-gpu` links was compiled in this build, from the export;
- no artifact of a path crate has its manifest outside `work/src`;
- the `deep-gpu` binary itself is one of the units compiled.

Third-party units are not judged, fresh or compiled. cargo compiles again any crate that depends on a rebuilt one, so
one that depends on a `vendor/` crate isn't reused: on the base 930 third-party units were reused, 6 fewer than in
the unsound build below (which six wasn't recorded).

Any unit cargo took as fresh fails the check with its crate named, and so does a failed build. Then no binary is
kept, no marker is written, and both tests fail with the list, never pass. This is needed because cargo's
fingerprint for a path crate doesn't depend on where the workspace sits, and `git archive` gives every file the
commit's time: beside a copied target folder cargo takes the export's crates as fresh and links the other tree's
compiled crates. `BASE-RUN.txt` records that case made once by hand (steps 1, 2 and 4 without 3): cargo took 33
units fresh and the check failed, naming each.

**Cost**, on this Mac on Nov 17, 2026, beside other sessions' builds (load 20 to 28 on 18 cores):

| | Time | Disk |
|---|---|---|
| First run | 288 s: 105 s waiting for a build grant and 1 s for this checkout's build; 166 s for the merge base (export 4 s, clone 2 s, about 37 s waiting for its own grant, 123 s compiling 39 workspace and `vendor/` crates with 930 third-party units reused); 14 s drawing and judging | 344 MB kept. While it builds, about 2 GB more, deleted after: the export (630 MB, and its tar for a moment) and the crates compiled into the clone (an estimate from the same crates' artifacts in this checkout's target folder, not measured) |
| Later run | 1,207 s and 427 s in two runs, of which 1,196 s and 398 s waiting for a build grant behind other sessions' builds. The rest, 11 s and 29 s: 1 to 3 s for this checkout's build, about 1 s to check the marker (it hashes the kept binary), 10 to 25 s drawing and judging | Nothing new |

The waits are the queue's, not the suite's. By these parts, with a free build slot a first run is about two and a
half minutes and a later one 11 to 29 seconds; neither was measured without a wait.

A checkout with no `target/debug` yet builds cold instead, which is sound and slow; it didn't happen here, since
this checkout's build runs first.

## Planted program

A default of `fog: true` on text. No `deep-gpu --planted` name is added. The second test draws what that default
draws through the field itself: the labelled castle with `fog: true` written in each label's `params`, by this
checkout's renderer, judged against the merge base's labelled frames by the first test's judge.

- A renderer whose default is `fog: true` on text fails the first test: its labelled frames differ from the merge
  base's, and the failure names the first differing pixel.
- A renderer that reads no `fog` on text draws the planted document as the merge base does, and fails the second
  test. The base is that renderer: there the second test fails at "the judge found no differing pixel", and the
  first passes (`BASE-RUN.txt`).

## Readings where the issue leaves a choice

- **"The fixture's labels."** The castle has none. The criterion's second sentence needs them, so the tests add
  three, with fields the base has, to each commit's castle. The guard draws both documents: the castle as committed,
  which is the first sentence to the letter, and the labelled castle, without which a wrong default on text couldn't
  reach the guard at all.
- **Where `fog` is written.** In the mark's `params`, beside `size_space`, `paint` and `status`, which the design row
  lists it with and the base reads there.
- **World-size labels.** Fog applies before tone mapping, where the base draws only world-size text; a screen-size
  label's color is drawn after it. Criterion 3 reads a label on linear targets, where only a world-size label shows.
- **"Dims."** The castle's fog mixes toward what the sky shows along the ray, and the labels are dark on a bright
  sky, so fog makes their pixels lighter, not darker. "Dims" is read as fades: the label's contrast against the sky
  behind it falls. That holds for a dark label on a bright sky and a bright label on a dark one. It is judged strictly:
  any fall counts, since the criterion states no amount.
- **"The same pixel hash."** `view3d`'s own `pixel_hash` of each frame, equal for both renderers. Since a failure
  must name a pixel, the final PNGs are also compared pixel by pixel, and a difference in either fails.
- **"On one machine."** Both renderers run on this machine in this run.
- **"No new field."** On a `sky@1`: no `background_intensity`, and `fog_curve` absent, `exp` or `exp2`. On any other
  item: no `fog`, in its `params` or on the item. A sky's own `fog` is its color, a field the base has.
- **The frames.** The four quarter-turns of the orbit, from the castle's own `transport.span` at 30 fps.

## Not tested

- A screen-size label with `fog: true`: the issue doesn't say what it draws.
- Lines, points and images, a status color, and the readings at 30 m: criterion 3.
- The linear curve, the distance from the eye and `background_intensity`: criteria 1, 2 and 4. Frame time:
  criterion 6.
- The amount a fogged label fades by, and other frames of the orbit.
- A document other than the castle.
