# Acceptance tests for #499, part "module": media@1 and its kit, a build without media, and av_unlinked

Written first, from issue #499 (as of Nov 8, 2026: acceptance criteria 5 and 10 and its Scope line on `media@1`), its
oracle map, the design sections it links and those they lean on, and base commit `f1e8736e` ("Merge pull request
#1742"), by a job that never saw an implementation; none existed. The implementing agent doesn't edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding, technical-design.md 2623 and
2654). The clock, mix and video criteria belong to the other parts of #499's suite.

## What was read

- The issue, read live with `gh issue view 499`: Scope ("The media module's interface `media@1` (#185) …"; "A video's
  picture and its sound move together …"; "Processors declare their tail and latency and checkpoint their state …"),
  Fields (Strip and track; Processor, `checkpoint_every`, derived `tail`; Image `image@1`: video frames), criteria 5
  and 10, Depends on (#498, #185).
- The oracle map (`doneright/oracles/issues/499.md`): criteria 5 and 10 have no upstream test ("The seal, the module
  set and interface digests are ours"; "av_unlinked is our document check"), and the scope line isn't a criterion, so
  nothing is ported.
- `docs/technical-design.md`: Document check (1546: "Each returns issues as data"); The media module (1909), Media
  asset (1913), Strip and track (1921: "A video the camera, masks or callouts must reach plays as an image instead,
  its sound still a strip"), Bus, processor and emitter (1929: "Each processor declares its tail and latency; the
  tail is pre-rolled on a seek"), Device gate, capture and export (the decode worker is the trusted ring's, never the
  media module's); Dogfooding (2623), Tests written first (2654).
- `docs/canvas-primitives.md`: Canvas module: interface and implementation (1033), Registry and seal (1052), Carried
  state (1184: `kind: bake | tail | checkpoint`, "Seeking restores the nearest checkpoint or pre-rolls the tail and
  steps forward, so seeking equals playing"), Image `image@1`: video frames (1812: "Its sound, if it has any, stays a
  strip placed with the same start, in and rate"), Sound and video on the picture's clock (7101), Asset (7107),
  Strip and track (7312), Bus (7355), Processor (7373: "State is checkpointed on a fixed grid … seek equals play bit
  for bit").
- At the base: AGENTS.md; `crates/deep-show` (`Cargo.toml`'s test features, `main.rs`'s build-set list and its
  `test-leave-out-*` features, the scenario `planted` field, `media.rs`'s `workers` call, `kit/carried.rs`'s
  `step_hash` failure `{code, module, part, step, checkpoint, fixture}`, `kit/mod.rs`'s thirteen parts),
  `crates/deep-canvas-scene3d/src/emitters.rs` (the shipped `media` module), `crates/deep-canvas/src/document`
  (`strips` among the top-level maps; `set` reaches items only); the earlier blind suites `tests/acceptance/185/`,
  `138/` (carried state, the release gate), `418/` and its redraft (an interface's kit on a shipped module),
  `443/` (a leave-out build and a planted edge the seal refuses), `498/decode/` (the decode worker, `workers`, the
  `BLOCKED:` rule), `306/` (patches, `revisions`, "stays current").

What the base already does and these tests don't credit: `full` holds a canvas module `media` (#427: strips and
emitters read as data) whose manifest implements `media@1` with the reference implementation `media` 1.0.0 and one
fixture, `bell`, with a strip and an emitter and no processor; the kit (#138) has its thirteen parts and a
`carried_state` part that seeks from a module's declared checkpoints and reports `step_hash` with the step; a release
build embeds the kit's ledger and refuses a module that failed; the decode worker probes files for `deep-show run`'s
`media_*` calls and `workers` lists its jobs; the document holds a top-level `strips` map; `image@1` takes an `asset`
by SHA-256. There is no processor, no checkpointed tail, no `test-leave-out-media`, no `test.probe` module, no
planted media implementation, no `av_unlinked` check, no `frames` on `image@1`, and a patch can't set a strip.

## Run them

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/499/module --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/499/module/tsconfig.json   # type-check
```

Each file builds each feature set it uses once (`cargo build --locked --bin deep-show --no-default-features
--features <set>`, honoring `CARGO_TARGET_DIR`), copies the binary to a temporary folder and fails each test that
uses a build that failed. `kit.test.ts`'s second test also makes one release build (`--release`, `DEEP_KIT_LEDGER`
naming the ledger the kit just wrote, #138), so it is slow (its timeout is two hours). Every test gets its own
temporary folder (evidence store, fixtures, ledger), deleted after it. Node built-ins and vitest only.

The folder must run alone: each file builds cargo binaries, one a release build. `scripts/lanes.mjs` needs
`tests/acceptance/499/module/` in its `alone` list; this README is the instruction, and the implementer makes that edit.

Platform needs:

- **ffmpeg** with the libx264 and aac encoders (on `PATH`, `/opt/homebrew/bin`, `/usr/local/bin`, or `DEEP_FFMPEG`)
  for `av-link.test.ts` only: it makes the 2 s recording with sound. It never stands in for the decode worker.
  Without it those tests fail with a message starting `BLOCKED:` and the unblock line `brew install ffmpeg`.
- **macOS** for a passing `seal.test.ts`: the decode worker's codecs are the macOS backend (#498). The tests are
  platform-neutral; elsewhere they fail where the backend is missing.

What is deterministic: everything. No test reads wall time, the network or a device, and none needs a person. The kit
runs with 100 patch sequences and 50 param sets per module (fewer than its defaults; the parts read here don't depend
on them).

Nothing missing passes (invariant 2): a reply without a field a test reads fails naming the field; a run that answers
`bad_input`, exits non-zero or writes other than one line fails every test that drove it; a missing fixture tool
fails `BLOCKED:`; nothing is skipped.

`BASE-FAILURE.txt` says why every test fails at the base. The tests were not run there: the machine's disk was nearly
full, so no cargo build was made; the note reads the base's code instead.

## The surface under test

Everything is `deep-show run` as #393, #305, #138, #185 and #498 left it: JSON lines in, one reply per call, the
`registry`, `schedule`, `manifest`, `kit`, `deep_show`, `revisions` and `workers` calls, the scenario's `planted`
field (an unknown name answers `bad_input`), the `seal_refused` startup line with exit 2. **Bold** names are this
suite's choices where the issue leaves them open; the implementer provides them as written.

### Test features of `deep-show` (none in a shipped build)

| Feature | What it is |
|---|---|
| **`test-leave-out-media`** | the `full` set's list without the `media` module, as #443's and #489's `test-leave-out-*` |
| **`test-probe`** | test canvas module **`test.probe`** with kind **`test.probe@1`**, `params: {asset: <sha256>}`, an asset in the evidence store (`<2 hex>/<62 hex>`); at check the module reads the asset's probe through the decode worker (#498's, the trusted ring's, reached through the core and the codecs seam), with no dependency on `media` |
| **`test-probe-via-media`** | planted: `test.probe` whose probe calls through the media module (it depends on `media` to probe); in a build without media the seal must refuse it |
| **`test-media-checkpoint-without-tail`** | planted: the media module's implementation replaced by one of another name, `equivalence: bit`, `state: canonical`, whose reverb checkpoint leaves out its tail (the restored reverb starts from an empty tail) |

### What the media module must have (shipped `full`)

- `schedule.interfaces["media@1"]` (#185): `module: "media"`, `implementation.{name, version (semver), equivalence:
  "bit", state: "canonical"}`, `reference` equal to the implementation's name, `behavior: "none"`, `kit` listing all
  thirteen parts of #138's kit (`fixtures`, `clean_rebuild`, `patch_fuzz`, `read_set`, `order`, `schedule`,
  `repair_loop`, `carried_state`, `late_entry`, `time_order`, `contribution`, `catalog`, `migration`) and not
  `behavior`.
- A fixture of the media module (the `manifest` call's `fixtures[]` with `module: "media"`) whose `document` holds a
  reverb processor: a processor whose `kind` is `"reverb"` or an object keyed `reverb` (Processor's `kind`), on a bus
  with sound reaching it, with its state (its tail) declared as carried state and checkpointed, so `carried_state`
  seeks from that fixture's checkpoints (cases with `fixture` naming it) and passes.
- The kit over `media` passes every part it runs, each with `ran == declared` and at least one case, at media@1's
  digest.

### The document check's `av_unlinked`

On a document, an `image@1` item whose `asset` is a video and carries **`params.frames: {start, in, rate, …}`** (the
issue's field) and a strip in the top-level `strips` map whose **`src`** is the same asset's SHA-256 (a 64-hex
string) must agree on `start`, `in` and `rate` unless the strip declares `offset`. Where they disagree the document
check reports an error issue `{"code": "av_unlinked", "severity": "error", "ids": [<image item ID>, <strip ID>, …]}`
and the revision is refused (`deep_show` outcome `refused`), so it never becomes current.

The strip the tests write: `{"track": 1, "src": sha, "start": "1s", "in": 0, "out": 1411200000, "rate": 1}` (`out` in
flicks, 2 s). A **patch op on a strip**: `{"op": "set", "id": <strip ID>, "path": "strips/<strip ID>/rate", "value":
2}`, beside the item op `{"op": "set", "id": "rec", "path": "items/rec/params/frames/rate", "value": 2}`. Today `set`
reaches only items.

**Scenario `planted`: `av_link_compares_start_only`**, the check comparing only `start`.

### The seal and the kit

- `seal.test.ts` reads the startup refusal's `modules`, which must include `"media"`; its `reason` isn't read (the
  base's for an absent dependency is `missing_dependency`).
- `kit.test.ts` reads `carried_state`'s `step_hash` failures as the base writes them: `{code: "step_hash", module,
  part: "carried_state", step, checkpoint, fixture}`. The release build's refusal must name media in `modules` or as
  `interface: "media@1"`.

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each line's text, trimmed, whitespace collapsed, the leading `- [ ] `
(or, for the scope line, `- `) dropped. Each test's name starts with its ID.

| ID | Text (short) | Test |
|---|---|---|
| `#499.64602440` (AC5) | a test module reading an asset through the decode worker seals and probes without media; a planted one calling through media is refused, naming media | `seal.test.ts` (2): `full,test-leave-out-media,test-probe` seals without media and with test.probe, a board with a `test.probe@1` item over a WAV is presented with no error, and `workers` shows a decode worker's `probe` job on that WAV's SHA-256; `full,test-leave-out-media,test-probe-via-media` is refused at startup, `modules` holding `media` |
| `#499.3a4c1fc9` (AC10) | a rate change to the image alone fails `av_unlinked` naming both, the revision before stays current; both together applies; a planted start-only check fails | `av-link.test.ts` (2): in `full`, revision 0 presented; the rate-only patch refused with `av_unlinked` whose `ids` hold `rec` and `rec_sound`, the current revision unchanged; the patch of both applied and a new revision current. With `planted: "av_link_compares_start_only"` the same assertions fail, naming av_unlinked, the rate-only patch not refused |
| `#499.6b5a4e6c` (scope) | media@1's manifest names the implementation; its kit is every canvas-kit part on its fixtures, carried state over processors' tails among them, no behavior part; a planted implementation whose reverb checkpoint leaves out its tail fails carried_state naming the module and the first differing step, and a release build refuses it | `kit.test.ts` (2): the shipped interface record and kit, as above; `full,test-media-checkpoint-without-tail` chooses another bit, canonical implementation, fails `carried_state` with `step_hash` failures naming `media` and a step equal to the checkpoint sought from; the ledger records media and carried_state FAIL; the release build embedding it refuses to start, naming media |

Test count: 2 + 2 + 2 = 6.

## Readings where the issue leaves a choice

- **"Reads an asset through the decode worker … probes its asset"** is seen from outside: the build seals, the item
  is presented with no error, and the run's decode worker ran a `probe` job on that asset's file. No other item in
  the board names the asset, so the probe is the test module's.
- **"Calls through the media module"** is a dependency on `media`, the way a canvas module reaches another's code;
  "naming media" is `media` in the refusal's `modules`. The reason code isn't pinned.
- **"The first step whose hash differs from a straight run"** is the failure's `step`. The kit hashes the state after
  each step, and a reverb whose tail was left out of its checkpoint holds another state from the first step played
  after the restore, so each `step_hash` failure's `step` must equal its `checkpoint`. A checkpoint whose tail is empty
  raises no failure, so only failures are held to it.
- **"Every part of the canvas kit (#138) on this module's fixtures"** follows #418's blind redraft: the interface
  lists all thirteen parts, and the kit runs on the module only parts with something to test there, each passing with
  at least one case. `carried_state` must be among them, over a fixture holding a reverb.
- **"A release build refuses it"** embeds the ledger of the whole kit over the planted build (#138's gate) and is read
  at startup.
- **"Naming both"** is the error's `ids` holding the image item's ID and the strip's ID.
- **Values:** the issue gives none for AC10; the tests use rate 1 → 2, start 1 s, in 0, on a 2 s recording.

## Not tested, because another part or no criterion asks

The clock, seek-equals-play by PCM hash, the ring's budget, frame lookup, proxies, the live mix, device changes,
players, decoding out of view, the shader, emitters and the cone (the other parts' criteria); the `offset` exemption
of `av_unlinked`; a `start` or `in` mismatch (only rate is named); a measured implementation of media@1.
