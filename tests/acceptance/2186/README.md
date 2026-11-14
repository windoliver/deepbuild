# Acceptance tests for #2186: a view's first frame after its warm-up draws its shadow maps, not maps it never drew

Written first, from issue #2186 (its account of the bug, the scene with its exact values, its scope, its three
acceptance criteria with their merge-base readings, and its proof line), the design sections it links and those they
lean on, and base commit `579001ddb` ("Merge pull request #2168 …"), by a job that never saw an implementation; none
existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of
this job (design: Dogfooding).

What was read:

- `docs/technical-design.md`: **Light without history** ("A cached shadow map or capture always equals a clean
  rebuild"; checks, goldens, render-back and exports read it, never history); Frame history (canonical renders draw
  the frame a live view settles to); How we know version 0 works, only its line on criterion IDs.
- `docs/canvas-primitives.md`: **Light and the light policy** (`shadow`, the `shadowed: 1 sun + 2 spots` cap, "static
  shadow maps are cached by everything they read"); Light policy: cascades ("a cached map always equals a clean
  render"; "It can never … depend on earlier frames; reuse a map after anything it read changed"); Light policy:
  local shadows (`shadowed.spots`, `cache: static`, "a still interior costs no shadow passes at all, and a cached map
  always equals a clean render"); **Meter and degrade ladder** ("Canonical renders (exports, render-back snapshots,
  checks and goldens) never step down or climb: they run at their class's fixed quality"); Render-back; Look `look@1`:
  ground grid in 3D (`ground_3d.kind` none by default).
- At the base: AGENTS.md (its Proof section); `tests/acceptance/379/` (README "The live call" and "Other calls": the
  `canonical` call and event, the writer's payload a session opens; `helpers.ts`; `fixtures/look.json`, which this
  suite's look copies), `tests/acceptance/378/` (`view3d`: frames, `capture`, `targets`, the PNG finals named by
  SHA-256; `helpers.ts`'s PNG reader, which this suite's copies), `tests/acceptance/1173/` README (`canonical`'s
  `targets: ["final"]`), `tests/acceptance/446/helpers.ts` (how a session document, `material@1`, `light.sun@1` and
  `light.spot@1` with `at.rot` are written), `tests/acceptance/1899/` (the README and BASE-FAILURE.txt this follows),
  `tests/acceptance/1897/helpers.ts` (the build with incremental builds and debug info off);
  `crates/deep-gpu-layer` (`main.rs`: `deep-gpu run` and its call dispatch, the features; `live.rs`: `parse` with
  `capture`, the frame's `finals`, `reply`, `render_canonical`, `canonical`; `view3d.rs`: `parse`, `run`'s capture
  and `final`, `write_final`; `liveview.rs`: searched for `View::new`'s warm-up `prepare` and `View::warm`, only to
  place the issue's account); `crates/deep-canvas-scene3d` (`look.rs`; `scene.rs`'s material lookup; `light.rs` and
  `sets.rs` searched for the light, material and `light_policy` field names); `scripts/proof-change.mjs` (how a
  criterion's ID is computed); `scripts/lease`.

What the base already does and these tests don't credit: `canonical` (#379) renders a writer's payload at a frame
and, with `targets: ["final"]` (#1173), writes its final as a PNG; `live` (#379) presents frames of a session and,
with `capture` (#425), writes each captured view's final; `view3d` (#378) draws a session document's frames and
writes captured finals. All three draw the issue's scene. At the base the first two draw it wrong and `view3d` draws
it right, so no new surface is needed: the criteria are each a comparison of finals these calls already write.

## Run them

They build `deep-gpu` and draw on the Metal device, as #378's and #379's suites do, so they run with
`--no-file-parallelism`, and `scripts/lanes.mjs` needs this folder in its `alone` list beside the other `deep-gpu`
suites (`tests/acceptance/377/`, `378/`, `379/`, `1899/`). This README is the instruction; the implementer makes that
edit.

```sh
npm ci                          # once, if node_modules is missing
npx vitest run --root tests/acceptance/2186 --no-file-parallelism --testTimeout=600000
npx tsc -p tests/acceptance/2186/tsconfig.json   # type-check: the root's strict options, allowImportingTsExtensions, noEmit
```

Every file first builds `cargo build --locked --bin deep-gpu` once (cargo on `PATH`), with `CARGO_INCREMENTAL=0` and
`CARGO_PROFILE_DEV_DEBUG=0`, copies the binary out of the target folder (`CARGO_TARGET_DIR` when set) into a temporary
folder, and fails each test if the build failed. **The shipped build**: `canonical`, `live` with `capture`, and
`view3d` hold no field that only `test-meter` has, and the criteria name the shipped `deep-gpu run`, so no test
feature is built. Each test writes its documents and finals into its own temporary folder and deletes it, and runs
each call in its own `deep-gpu run` process, so the two sides of a comparison share no device, cache or view. The
tests use node built-ins and vitest only. A run with `--root tests/acceptance/2186` leaves Vitest's cache in
`tests/acceptance/2186/node_modules/.vite`; delete it. `BASE-FAILURE.txt` is the run at the base.

The criteria compare pixels the Metal device draws ("Runs on: macOS, on the Metal device"). Off macOS, and wherever
the binary answers `unsupported_platform`, a test fails with a message that starts `INCONCLUSIVE:`; it never passes
there. No test reads a timing or gates on power, Low Power Mode, thermal state or load (the owner's rule).

## The surface under test

Existing calls only, on `deep-gpu run` with no arguments (the Metal device), each as the base answers it.

- **`canonical`** (#379, #1173): `{"call": "canonical", "look", "writer": "agent:alpha", "doc": <payload>, "size":
  [320, 240], "frame": 1, "purpose": "render_back", "targets": ["final"]}` → `{…, "final": sha256}`, the final at
  `<out>/<sha256>.png`.
- **`live`** (#379, #425's `capture`): `{"call": "live", "look", "frames": 1, "sessions": [{"session": "scene",
  "writer": "agent:alpha", "doc": <payload>, "size": [320, 240]}], "capture": [1]}` → `frames[k]` with `frame: 1`,
  its `views[j]` with `session: "scene"` and `"final": sha256`.
- **`view3d`** (#378): `{"call": "view3d", "doc": <session document>, "look", "size": [320, 240], "frames": 1,
  "capture": [0], "targets": ["final"]}` → `frames[k]` with `frame: 0` and `"final": sha256`.

Every final is an 8-bit RGBA PNG named by the SHA-256 of its bytes. A test reads both, checks each is written, hashes
to its name and is 320 × 240, checks that `view3d`'s subject centre is lit (each colour channel at least 64), then
counts the pixels where any of the four 8-bit channels differs by more than 2. Any count above 0 fails, naming the
criterion, the count, the worst difference with where it is, and the subject centre's values on both sides.

## Fixtures

- `fixtures/scene.json`: the issue's scene as the writer's payload (#393's deep_show payload, as #379's `live` and
  `canonical` take it: the envelope and ID maps, no `id`, no `layers`, no item `layer`). Envelope `size: [320, 240]`,
  `camera: "cam"`, `budget: {class: "showpiece"}`, `light_policy: {shadowed: {spots: 2}}`, `requires: {modules:
  {scene3d: "^1"}}`; items `cam`, `floor`, `subject`, `bar`, `key`, `fill-a` and `fill-b` with the issue's values, and
  the two materials they name.
- The session document for `view3d` is the same payload with `id: "scene-2186"`, one writer layer `main` of
  `agent:alpha`, and every item in it (`helpers.ts`'s `sessionDoc`).
- AC2's three variants are the same two documents with that one light's `params.shadow` set to false.
- `fixtures/look.json`: #379's acceptance look (tone map none, exposure −log2(1.2), `finish: []`, deband none), with
  `bloom: "none"` and `ground_3d: {kind: "none"}` written out: the issue's "no finish, deband, bloom or 3D ground".

## Criteria to tests

| Criterion | Test | What it compares |
|---|---|---|
| `#2186.540fbb6b` AC1: `canonical` (render_back, frame 1, final, 320 × 240) on the scene within 2 levels of `view3d`'s frame 0, every channel of every pixel | `canonical.test.ts`, AC1 | `canonical`'s final against `view3d`'s frame 0, all three shadows on |
| `#2186.f9f118b5` AC2: the same with each one of the three lights' `shadow` false in turn | `canonical.test.ts`, AC2 × 3 (`key`, `fill-a`, `fill-b`) | the same, on each variant; one test per light, so each light's result is its own line |
| `#2186.b9ad6749` AC3: a `live` session on the scene, its frame 1 captured, within 2 levels of `view3d`'s frame 0 at every pixel | `live.test.ts`, AC3 | the session's frame 1 final against `view3d`'s frame 0, all three shadows on |

Each test fails on the merge base at its comparison, for its criterion's reason, with the issue's readings (see
`BASE-FAILURE.txt`). None can pass on a program that draws nothing: a missing final, one of another size, or a
`view3d` frame whose subject centre isn't lit fails before the comparison.

## Readings where the issue and design leave a choice

- **The materials.** The issue gives each box a material ("base colour 0.5 grey, roughness 1, metallic 0"; the bar
  takes "the floor's material"); a `mark.box@1` names a `material@1` item by ID, so the scene holds two,
  `floor-grey` (`base_color: [0.5, 0.5, 0.5, 1]`, linear) and `subject-grey` (0.8), named by `floor`, `bar` and
  `subject`. Item names and order keys are this job's.
- **No sky, no transport.** The issue's envelope names neither, so the scene has neither; both sides draw the same
  document, and the issue reads the background at 16 on both.
- **"8-bit channel"** is each of R, G, B and A of the RGBA PNG each call writes; alpha is compared too.
- **"The subject's centre is lit"** is the guard against a program that returns nothing: each colour channel of
  `view3d`'s (160, 130) at least 64, between the background's 16 and the issue's lowest reading there (106).
- **Separate processes.** "The same document" is the same scene, sent as a payload to `canonical` and `live` and as a
  session document to `view3d` (the issue's own split); each call runs in its own process so one can't warm the other.
- **One test per light** for AC2, so a fix that heals one light and not another names the light.

Not tested, because no criterion asks: the shadow cache's own behaviour across frames (#446's tests, out of scope),
`frame_budget`'s frames (`budget.rs`; the issue names them as affected, but no criterion measures them), `View::warm`
on a document with several reachable scenes, live frames after frame 1, and #1937's `budget_fix`.

## Upstream tests (the Oracle lane)

No Oracle page was among this job's inputs, so none was read and no upstream test is ported. The criteria compare this
project's own two render paths with each other, which no upstream suite checks.
