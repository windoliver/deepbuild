# Acceptance tests for #140 (GPU group): the GPU seam, its feature and quirk tables, adapter choice, device loss in flight, the validation lane, the error channel, and the color and capture seams on the app's window

Written first, blind, from issue #140 ("Canvas platform seams: one interface per platform part, macOS backends first,
each with its conformance suite"), its Oracle page and the upstream test it names (wgpu `tests/tests/wgpu-gpu/device.rs`
at `eddf0b4c8f`), the design (`docs/technical-design.md`: How it installs, the Platforms list and its canvas seams, How
we know version 0 works; `docs/canvas-primitives.md`: Seam and backend, GPU surface, Render worker, Liveness and
recovery, Meter and degrade ladder, Compile, validate and cache) and base commit `f41a5b3e` ("Merge pull request
#888 …"), by a job that never saw an implementation; none existed. The implementing agent doesn't edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

This folder holds the criteria of the **GPU group**: 1, 5, 9, 11, 16, 17, 19, 20, 21 and 22, numbered as the issue
lists them. Criteria 2, 3, 4, 6, 7, 8, 10 and 15 (the view group) and 12, 13, 14 and 18 (the platform group) are in
`tests/acceptance/140/view/` and `tests/acceptance/140/platform/`, written by other blind jobs.

## Run them

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/140/gpu --no-file-parallelism
npx tsc -p tests/acceptance/140/gpu/tsconfig.json   # type-check: the root's strict options, allowImportingTsExtensions, noEmit
# the live tests (a window on this Mac's screen; the capture test needs a person at the picker):
DEEP_140_LIVE=1 npx vitest run --root tests/acceptance/140/gpu --no-file-parallelism color.live.test.ts capture.live.test.ts
```

Each file builds the `deep-gpu` feature sets it uses once (`cargo build --locked --bin deep-gpu [--features
test-seam]`), copies each binary out of `target/debug` under its own name into a temporary folder, and fails each test
that uses a build that failed. Each test writes into its own temporary folder and deletes it. The tests use node
built-ins and vitest. A run with `--root` may leave Vitest's cache in `tests/acceptance/140/gpu/node_modules/.vite`;
delete it. `BASE-FAILURE.txt` is the run at the base.

`scripts/lanes.mjs` needs, and the implementer makes (this README is the instruction): `tests/acceptance/140/gpu/` in
`alone` (the files build cargo binaries); `tests/acceptance/140/gpu/color.live.test.ts` and
`tests/acceptance/140/gpu/capture.live.test.ts` in `byHand` (they open a window on the screen, and a person answers the
capture picker); and a release lane named `gpu validation` in `releaseLanes` whose commands run the GPU fixtures through
`deep-gpu run --validation` (criterion 21; `validation.test.ts` checks the lane exists by that name).

Every test needs macOS with Metal; anywhere else it fails `INCONCLUSIVE:`, never passing. The live tests fail
`INCONCLUSIVE:` without `DEEP_140_LIVE=1`. The M1-against-M3 comparison fails `BLOCKED:` without an M1's record
(`DEEP_140_M1_RECORD`): this reference Mac has one GPU. None of these files times a budget (criterion 18 is the platform
group's), so none depends on the machine's load.

## The surface under test

The issue names a feature table checked at startup, required features, a tier, test adapters (integrated, discrete,
one with a quirk row), a quirk table with a digest, receipts, a compile-thread job held open, a forced device loss, a
validation lane with planted operators and an uninstrumentable shader kind, the device's uncaptured-error callback,
status swatches read back, the window's CAMetalLayer and wgpu's Srgb surface, and capture through the system picker,
but no command or API. So these tests extend the binaries that exist: **#377's `deep-gpu run`** (startup arguments,
one test feature set, new calls, new fields on #379's `adapter` and #377's `compile` and `frames` replies, and planted
programs) and **`deep-app`** (two report modes, as #105's `--capture-bug` is one). No new binary.

### `deep-gpu`: builds and startup

#377's JSON-lines protocol holds: one scenario `{"out": dir, "calls": [Call]}` per stdin line, answered with exactly one
line `{"ok": true, "replies": [Reply]}`, one reply per call, then exit 0; an unknown argument, planted name or withheld
feature answers one `{"ok": false, "code": "bad_input"}` line and exits 2; a call it doesn't hold, or with a field or
value outside what it takes (a feature the table doesn't hold, a test fixture on the shipped build), is answered
`{"code": "bad_input", …}`.

**Builds.** The shipped build (`cargo build --locked --bin deep-gpu`) and `test-seam` (`--features test-seam`), which
adds, and no shipped build has: `--adapters`, `--quirks`, and the test fixtures `storage_read`, `float_target`,
`uncovered_kind`, `clean_render` and `raises_validation_error`.

`deep-gpu run [--adapters <file>] [--quirks <file>] [--withhold <feature>]… [--validation] [--planted <name>]`

- **The startup check.** Before reading any scenario, the GPU seam reads the adapter's tier and its feature table and
  creates the device. An adapter that doesn't report a feature the table marks required, or a device created without
  one (`--withhold` of a required feature), ends the run with exactly one line `{"ok": false, "code":
  "missing_feature", "adapter": name, "missing": [feature], "reason": text}` naming each missing required feature, and
  exit status 1 (as #377's `no_device`). No reply is written.
- `--withhold <feature>` (repeatable): #379's `--withhold timestamps`, for any feature of the tier's table: the device
  is created on the same adapter without it. A name outside the table is `bad_input`.
- `--adapters <file>` (test-seam): the seam enumerates these test adapters instead of the platform's, in file order.
  `{"adapters": [{"name", "type": "integrated_gpu" | "discrete_gpu", "vendor": n, "device": n, "driver": string,
  "memory": bytes, "features": [feature]}]}`. Each stands on this Mac's Metal adapter, reports the identity, type and
  memory the file gives, and reports exactly the listed features of the tier (any others withheld at device creation,
  as a software adapter that declares its feature set would). The seam picks among them by its own rule (criterion 17).
- `--quirks <file>` (test-seam): the quirk table the seam reads instead of the shipped one: `{"rows": [{"backend":
  name, "match": {"vendor"?: n, "device"?: n, "driver"?: string}, "withholds"?: feature, "workaround"?: name,
  "reason": string}]}`. A row applies to an adapter when every match field it gives equals the adapter's. The shipped
  table is reviewed data in the GPU seam's crate (its path is the implementer's).
- `--validation`: the validation lane's run (below).

### The `adapter` call (#379's, extended)

`{"call": "adapter"}` keeps #379's fields (`backend`, `name`, `timestamps`, `withheld`) and adds:

```json
{"seam": {"name": backend name, "version": backend version},
 "adapter": {"name", "vendor": n, "device": n, "driver": string, "type": string, "memory": bytes, "test": bool},
 "tier": name,
 "table": [{"feature": name, "wgpu": [wgpu Features flag, as wgpu's Debug prints it], "required": bool,
            "fallback": name | null, "fixtures": [fixture name]}],
 "reported": [feature], "granted": [feature], "withheld": [feature],
 "quirks": {"digest": string}}
```

- `table`: the adapter's tier's feature table, one row per feature. A required row has `fallback: null` and no
  fixtures need to gate on it; a gated row names its fallback (the absent path's name) and the fixtures of the paths
  it gates. The macOS tier's table holds at least pass timestamps (`TIMESTAMP_QUERY`, fallback: the CPU timing) and
  depth-clip control (`DEPTH_CLIP_CONTROL`, fallback: a pancaked near plane), and at least one required feature.
  Limits and MSAA counts may be reported beside it; no test reads them.
- `reported`: the table's features the adapter reports. `granted`: the table's features the device was created with,
  read from the device itself (a row is granted when the device has every flag in its `wgpu`), never from the
  seam's intent. `withheld`: those withheld at device creation by `--withhold` or a quirk row.
- `quirks.digest`: the digest of the quirk table in force; a changed row changes it.

### The `gated` call

`{"call": "gated", "feature": name}` runs every fixture the table lists for that gated feature on this device:
`{"feature", "granted": bool, "took": name, "fixtures": [{"fixture", "result": "PASS" | "FAIL" | "BLOCKED", "took":
name, "reason"?: text, "content_key": string, "receipt": {"gpu": {"name", "version"}, "adapter": {"name"}, "quirks":
digest}}]}`. `took` is the path the fixture ran: the feature's own name when granted, the table's `fallback` when
absent. `content_key` is the content key of the GPU result the fixture's render fed (its backend's name and version
and the quirk table's digest enter it, as the design says); `receipt` is that result's receipt. A required feature or
a name outside the table is `bad_input`.

### The `seam_suite` call (criterion 1's comparison)

`{"call": "seam_suite", "seam": "gpu", "records"?: [path]}` runs the GPU seam's conformance suite on this machine,
writes this GPU's exact-class record into `out`, compares it with the given records, and answers `{"seam": "gpu",
"backend": {"name", "version"}, "result": "PASS" | "FAIL" | "BLOCKED", "record": path, "parts": [{"part", "result",
…}], "asks": [{"kind": "unblock", "ask": text, …}]}`. The parts include `cross_family`, the exact-class fixtures'
bits compared across GPU families: `BLOCKED` with fewer than two families among this GPU and the records (and then
exactly one unblock ask), `PASS` when every fixture's bits are equal, `FAIL` naming each fixture that differs. The suite
is never `PASS` while a part is `BLOCKED`, and `FAIL` when one is. A record is `{"gpu": {"name", "family"}, "backend":
{"name", "version"}, "fixtures": {fixture → SHA-256 of its output bits}}`.

### Device loss with a job in flight (criterion 20)

- `{"call": "compile", "scene", "hold": true}` (#377's call, with `hold`): starts the scene's pipelines on the compile
  thread on the current device and holds the job open, its result not handed back, then answers at once `{"job": id,
  "state": "held", "device_epoch": n}`. One job is held at a time.
- `{"call": "lose_device"}`: forces the device lost; the GPU layer opens a new one. `{"lost_epoch": n, "device_epoch":
  m}`.
- `{"call": "release_job"}`: releases the held job and answers once its result has reached the view: `{"job",
  "compiled_on": epoch, "outcome": "dropped" | "installed"}`.
- `frames` (#377's call) adds to each Frame `"device_epoch": n` (the device it drew on) and `"pipelines": [{"key",
  "device_epoch"}]`, every pipeline the frame drew with the epoch of the device it was compiled on (empty for a frame
  that drew none).

`fixtures/pipelines.scene` is a #377 scene (its format: `tests/acceptance/377/README.md`, The scene format): 128 × 64,
eight cells each drawn by its own pipeline, still, 60 frames.

### The validation lane (criterion 21)

`deep-gpu run --validation` turns Metal's API and shader validation on and the shader translator's own bounds checks
off for the run. `{"call": "validate", "fixtures": [name]}` runs those fixtures and answers `{"lane":
{"api_validation": bool, "shader_validation": bool, "bounds_checks": bool}, "uncovered": [shader kind], "fixtures":
[{"fixture", "kind": shader kind, "result": "PASS" | "FAIL" | "BLOCKED", "golden": "PASS" | "FAIL" | null,
"pixel_hash": sha256 | null, "pipelines": [name], "passes": [name], "findings": [Finding], "reason"?: text}]}`.
Findings: `{"finding": "out_of_bounds", "pipeline", "binding": {"group", "binding"}}` and `{"finding": "non_finite",
"pass", "target": {"name", "format"}, "texel": [x, y], "value": "NaN" | "Inf" | "-Inf"}` (the first non-finite value
read back from every float target and storage buffer the fixture writes). A fixture whose shader kind the lane can't
instrument is `BLOCKED` with a reason naming the kind, and the kind is listed in `uncovered`. Test fixtures
(test-seam): `storage_read` (an operator reading a storage buffer, with a golden that allows a share of wrong pixels),
`float_target` (a pass writing an rgba16float target) and `uncovered_kind`.

### The error channel (criterion 22)

`{"call": "check_render", "fixture", "declares"?: [{"kind", "contains"}]}` runs a check that renders the fixture and
compares it with its golden, reading the device's uncaptured-error callback for the whole render: `{"fixture",
"result": "PASS" | "FAIL", "golden": "PASS" | "FAIL", "errors": [{"kind": "validation" | "out_of_memory" | "internal",
"error": text, "declared": bool}]}`. An error is declared when one of `declares` has its kind and its text contains
`contains`. The check passes only when the golden passes and every error is declared. Test fixtures (test-seam):
`clean_render` (no error) and `raises_validation_error` (pixels matching its golden, and one wgpu validation error
raised through the callback).

### Planted programs (`deep-gpu --planted <name>`, each reachable only there)

| Name | The wrong program | Criterion |
|---|---|---|
| `withholds_in_code` | The backend withholds the tier's first gated feature (table order) by a code branch on the adapter's vendor 4660 and device 22136, with no quirk row | 16 (issue-named) |
| `picks_first_adapter` | The seam picks the first adapter enumerated | 17 (issue-named) |
| `installs_stale_pipelines` | The view installs whatever the compile thread returns, whatever device it was compiled on | 20 (issue-named) |
| `reads_past_buffer` | `storage_read`'s operator reads one element past its storage buffer; its wrong pixels stay inside its golden's share | 21 (issue-named) |
| `writes_nan` | `float_target`'s pass writes NaN into one texel of its rgba16float target | 21 (issue-named) |
| `reads_pixels_only` | The check runner reads only the pixels, never the error channel | 22 (issue-named) |

### `deep-app`: the live runs

- `deep-app --color-check [--planted gpui_layer_untagged | wgpu_default_colorspace]` opens the app's window with a
  GPU-layer view and a surface wgpu configures with its `Srgb` color space, draws each status color of the shipped look
  as a swatch through every Metal layer the app presents through, reads each swatch back from its layer's drawable,
  reads each layer's `colorspace` from the layer itself, prints one line and quits, exit 0: `{"color": 140, "layers":
  [{"layer": name, "owner": "gpui" | "wgpu", "colorspace": CGColorSpace name | null}], "swatches": [{"layer", "status",
  "read": [r, g, b]}]}`. `null` is a layer whose colorspace is nil. The window's CAMetalLayer is the one `gpui` layer.
  `gpui_layer_untagged` drops the GPUI patch's tag on the window's layer (GPUI alone leaves it nil);
  `wgpu_default_colorspace` leaves the wgpu surface's layer at wgpu's default (nil).
- `deep-app --capture-seam`: asks the capture seam's backend for a capture of the main display with no picker (it must
  be refused); opens ScreenCaptureKit's system picker; once a person picks a display or window, records it for 3 s,
  keeping nothing; reads whether the system's screen-recording indicator shows while frames arrive from the window
  server, never from the app's own state; prints one line and quits, exit 0: `{"capture": 140, "backend": {"name",
  "version"}, "permission": "granted" | "denied" | "undetermined", "direct": {"outcome": "refused" | "started",
  "frames": n, "indicator": {"system": bool}}, "picker": bool, "picked": {"kind", "id"}, "recorded": {"kind", "id"},
  "frames": n, "indicator": {"system": bool}}`.

## Criteria to tests

| # | Criterion (the issue's text, shortened) | Tests (each name starts `AC<n>`) | Surface |
|---|---|---|---|
| 1 | The GPU feature table is checked at startup, and an adapter missing a required feature is refused with its name; the exact-class fixtures give identical bits on two GPUs of different families (an M1 and an M3); with one GPU that comparison is BLOCKED with one unblock ask, never PASS | `features.test.ts`: this Mac's table holds timestamps and depth-clip control with fallbacks and a required feature, every required one granted; a test adapter missing each required feature in turn is refused at startup with one `missing_feature` line naming exactly it, and starts with it; the wgpu port: an adapter reporting nothing is refused naming every required feature. `exact.test.ts`: one GPU: `cross_family` BLOCKED, the suite BLOCKED, exactly one unblock ask, the record naming this GPU, the same bits twice; twins of this record: another family's equal bits PASS, a changed fixture FAIL naming it, one family twice still BLOCKED; with `DEEP_140_M1_RECORD`, M1 against M3 PASS, else `BLOCKED:` | `adapter`, `--adapters`, `seam_suite` |
| 5 | Status color swatches read back from the surface as the same 8-bit values, and capture starts only through the system picker with the system's indicator showing | `color.live.test.ts` (AC5): every status color of `looks/clean.json` read back from every layer as its 8-bit value. `capture.live.test.ts`: a capture without the picker refused, no frame, no indicator; through the picker, what the person picked recorded, the system's indicator on | `deep-app --color-check`, `--capture-seam` (live) |
| 9 | The window's CAMetalLayer reports the sRGB colorspace, which the GPUI patch sets and GPUI alone leaves unset, and a status swatch reads back as the same 8-bit values | `color.live.test.ts` (AC9): the one `gpui` layer reports `kCGColorSpaceSRGB`, its swatches exact; `gpui_layer_untagged` reads nil and the check fails naming the layer | `deep-app --color-check` (live) |
| 11 | Each feature in the macOS tier's table runs its fixtures granted and absent, withheld at device creation on the same adapter; the absent run takes the table's fallback; none crashes or skips silently | `features.test.ts`: for every gated row, `gated` granted (its own path) and with `--withhold` (same adapter, device without it, the table's fallback): the row's fixtures exactly, each PASS on the path it names; a withheld required feature ends in a `missing_feature` refusal, never a crash | `adapter`, `gated`, `--withhold` |
| 16 | A test adapter whose quirk row withholds a feature it reports runs its absent path, its results carry the digest, a changed row changes its content keys; a planted backend withholding in code without a row passes its gated fixtures and fails this test, naming the feature | `quirks.test.ts`: the row withholds F (absent path, fixtures PASS, every receipt the digest, the same table the same keys, a changed row a new digest and every key changed, a row for another vendor withholding nothing); `withholds_in_code` with an empty table passes its gated fixtures and the test's check (reported − granted − rows − `--withhold`) fails naming F | `--adapters`, `--quirks`, `adapter`, `gated` |
| 17 | With a test integrated and a test discrete adapter granting every feature, the seam picks the discrete one and the receipt names it; withheld, the integrated one; a planted pick of the first enumerated fails, naming both | `adapters.test.ts`: integrated listed first; discrete picked when features decide and when memory decides, every receipt naming it; integrated alone picked and named; `picks_first_adapter` fails naming both | `--adapters`, `adapter`, `gated` receipts |
| 19 | Every Metal layer the app presents through reports sRGB, including a wgpu Srgb surface; a planted surface left at wgpu's default reads nil and fails, naming the layer | `color.live.test.ts` (AC19): a `wgpu` layer present, every layer sRGB; `wgpu_default_colorspace` reads nil, fails naming it, the window's layer still tagged | `deep-app --color-check` (live) |
| 20 | With a compile-thread job held open, the device lost and the job released: no frame draws a pipeline from the lost device, the pipelines compile again on the new epoch, the next settled frame equals a clean start's; a planted view installing what the thread returns fails, naming the pipeline and both epochs | `device-loss.test.ts`: the released job `dropped`; every frame on the new epoch drawing only its pipelines; the first settled frame's eight pipelines on the new epoch and its hash a clean start's (not the background's); `installs_stale_pipelines` fails naming a pipeline and both epochs | `compile` + `hold`, `lose_device`, `release_job`, `frames` fields |
| 21 | In the validation lane a planted out-of-bounds operator inside its golden's share fails naming pipeline and binding; a planted NaN texel fails naming pass and texel; clean twins pass; an uninstrumentable shader kind is BLOCKED naming it | `validation.test.ts`: the `gpu validation` release lane exists; lane flags on/on/off; `reads_past_buffer` changes pixels, passes its golden, fails naming the fixture's pipeline and a binding; `writes_nan` fails naming the pass, an rgba16float target, the texel and NaN; clean twins PASS with no finding; `uncovered_kind` BLOCKED naming its kind, listed uncovered | `--validation`, `validate`, test fixtures |
| 22 | A check whose render raises an undeclared validation error through the uncaptured-error callback fails, naming it, while its pixels match the golden; a planted runner reading only pixels passes it and fails this test | `errors.test.ts`: `clean_render` PASS; `raises_validation_error` golden PASS, an undeclared validation error named, FAIL; declared, PASS; `reads_pixels_only` passes it and the test's check fails naming the error | `check_render`, test fixtures |

The surface's fences (`features.test.ts`, last describe): the test-seam build takes a test adapter the shipped build
refuses; the shipped build answers `--adapters`, `--quirks` and an unknown `--withhold` with one `bad_input` line and
status 2, and `gated` on a feature outside the table with `bad_input`.

## Readings where the issue and design leave a choice

- **One binary for the GPU seam.** The seam's GPU parts are the canvas core's GPU side, which #377's `deep-gpu` already
  drives headless (its device, its `--withhold`, #379's `adapter`, #380's exact records); the new calls extend it, as
  #378, #379 and #380 did. The window's layers and the capture picker need the real app, so they extend `deep-app`, as
  #105's `--capture-bug` did.
- **Required and gated rows.** The issue's "required feature" (criterion 1) and "each feature … takes the fallback the
  table names" (criterion 11) read together as two kinds of row: required rows, with no fallback, whose absence refuses
  the adapter, and gated rows, each naming its fallback. Criterion 11 runs every gated row; a required row withheld at
  device creation must end in the startup refusal, which is how it "doesn't crash". The design names pass timestamps,
  depth-clip control and ray queries as gated features; ray queries land in R6 (canvas primitives, `rays`), so only
  the first two are required of this tier's table.
- **Test adapters.** "A test adapter" (criteria 1, 16, 17) is read as an adapter the seam enumerates in place of the
  platform's, standing on this Mac's GPU and reporting the identity and features a test gives it, so one Mac can stand
  in for several GPUs. Its features beyond those it reports are withheld at device creation, as the design's software
  adapter "that declares its feature set" would. "With the discrete one withheld" is that adapter left out of the
  enumeration.
- **The quirk test's check.** The criterion's "fails this test, naming the feature" is a check in the test: every
  feature an adapter reports that its device lacks must be withheld by `--withhold` or by a row of the table the test
  wrote that matches the adapter. It reads the device's granted features, so a code branch can't hide.
- **The digest and the keys.** A result "carries the table's digest" as its receipt's `quirks`; the content keys are
  each fixture's `content_key`. The test asserts they are stable for one table and all change when a row's reason
  changes, which the design's "the table's digest enters every content key" implies.
- **Exact-class fixtures across families.** This Mac has one GPU, so the M1/M3 comparison is shown three ways: the
  BLOCKED outcome with one unblock ask (the criterion's own one-GPU clause), the comparison's logic on twins of this
  Mac's record (as #380 did), and the real comparison when someone supplies an M1's record. Without it that test fails
  `BLOCKED:`, never passing.
- **Device loss with a held job.** The issue doesn't say how a job is held; `hold` on #377's `compile`, `lose_device`
  and `release_job` are the smallest calls that let one scenario order them. A frame lists the pipelines it drew with
  their epochs so "no frame draws a pipeline from the lost device" is read per frame. "A clean start's" is a fresh
  process drawing the same scene.
- **The validation lane's surface.** The lane is a release lane (`gpu validation`); its run is `deep-gpu --validation`.
  The planted operator and pass are test fixtures' planted twins, selected by `--planted` as #377's are. "Whose wrong
  pixels stay inside the share a golden allows" is asserted as: the planted fixture's pixel hash differs from the clean
  twin's while its golden comparison passes.
- **Declared errors.** A check that "didn't declare" an error implies one can; `declares` (kind and a text fragment) is
  the smallest form, and the declared twin shows the error channel, not the fixture, decides the verdict.
- **The color check.** "Read back from the surface" is read as each layer's own drawable, in the real window; the
  expected values are the shipped look's status map, read from `crates/deep-canvas-marks/looks/clean.json`, not from
  the app. "Reads nil" is the layer's `colorspace` property being nil, reported as `null`. The colorspace's name is
  CoreGraphics' `kCGColorSpaceSRGB`.
- **The capture check.** "Only through the system picker" is shown by the backend refusing a capture asked for without
  it; "with the system's indicator showing" is read from the window server (the system's indicator, not the app's
  own), off for the refused capture and on while recording.
- **Live gating.** The color check needs no person but opens the app's window on this Mac's screen, so both live files
  run only with `DEEP_140_LIVE=1`, as #105's live test does, and fail `INCONCLUSIVE:` otherwise.

## Not tested here, and why

- Limits and MSAA counts in the tier's table: the criteria don't state them.
- An upload not yet flushed when the device is lost (the issue's scope beside criterion 20): criterion 20 names only
  the compile-thread job.
- That the validation lane runs every shipped GPU fixture: the criterion states its planted fixtures and the uncovered
  kind, which the tests run; the lane's full run is the release preflight's.

## The Oracle lane

The Oracle page links one upstream test, for criterion 1: wgpu's `request_device_error_message`
(`tests/tests/wgpu-gpu/device.rs` at `eddf0b4c8f2c50b7895ad26ee946401e563cdd32`, use: port). It asks an adapter for every
feature with impossible limits and requires the request to fail with "Unsupported features were requested:". It is
ported in `features.test.ts` ("ported from wgpu's request_device_error_message") against our output: a test adapter
reporting no feature must be refused at our startup check, naming every required feature of our table. wgpu's own
message is wgpu's; ours names our table's features, which the criterion asks for. The other criteria here have no
upstream test (the Oracle page's "No upstream test" rows).
