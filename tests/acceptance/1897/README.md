# Acceptance tests for #1897: determinism by hash — seek equals play, Vello CPU rasters across machines, the GPU pixel hash

Written first, from issue #1897 (its Scope, its Determinism fields, its three acceptance criteria and its Proof line),
its oracle page, the design sections it links and those they lean on, and the base commit `d51be2c3` ("Merge pull
request #2108"), by a job that never saw an implementation; none existed. The implementing agent doesn't edit these
files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

What was read:

- The issue text and its oracle page (`doneright/oracles/issues/1897.md`): upstream tests for criterion 2 only, Vello's
  snapshot suite at `linebender/vello` `235739c4f0`, marked "run on our code; port; formula"; criteria 1 and 3 have
  none.
- `docs/canvas-primitives.md`: What holds a document to its rules (issues as data); Check input (`document.determinism`
  is one of the core's own kinds); Determinism (the fields `at_times`, `compare: same_machine | cross_machine | shards`,
  `evaluated`, `raster_2d: Vello CPU, f32 pipeline, scalar SIMD level`, `pixel_hash: a GPU reduction to 128 bits;
  order-sensitive: swapping any two differing pixels changes it`; the Semantics paragraph in full: on one machine
  "compared on canonical renders' raw pixels (hashed on the GPU, 16 bytes read back)", across machines "evaluated data
  and Vello CPU rasters from its f32 pipeline at the scalar SIMD level, never GPU pixels … every result says machines:
  any or same"; "It can never: Compare GPU pixels across machines; compare encoded bytes"); Determinism class (exact
  operators read integer formats and bits only; "the determinism check's GPU pixel hash is the first exact operator");
  Export (hashes taken on the GPU, only the digest read back); Golden (a run on the same architecture "reads machines:
  same and never satisfies cross_machine"; a linux/amd64 container counts as the other architecture for CPU checks).
- `docs/technical-design.md`: Document check ("determinism by hash"); Proven on the base; Dogfooding; Decided "The 2D
  renderer" (goldens and snapshots render with Vello CPU's f32 pipeline at the scalar SIMD level, the configuration
  Vello's own snapshot suite takes as its reference); Platform seams (aarch64 first, then x86_64; anything a check reads
  matches bit for bit across them).
- At the base: `AGENTS.md`; `crates/deep-show` (`time.rs`: `determinism` and its two sides; `verdict.rs`:
  `determinism_runs` and `judge` for `document.determinism`, rows carrying `machines`; `export.rs`: `frame_hash` and the
  GPU BLAKE3 pass; `main.rs`: the call list, the scenario's `planted`, the startup `--planted`); `crates/deep-marks-render`
  (`raster`'s `simd`, `pipeline`, `golden` and its `renderer` block); the suites `tests/acceptance/488/` (seek against
  play, `checkpoint_nearest_in_distance`, `test-tick`), `385/` (`golden_config` naming `simd` or `pipeline`), `501/`
  (`frame_hash`, `--planted`, `blocked()`), `1162/` (the `document.determinism` requirement and `verdict`) as patterns.

## Run them

Put Node 24.22 and the pinned Rust toolchain first on PATH, install once, then run one file at a time (each builds the
`deep-show` feature set it lists once, in `beforeAll`, with `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0`):

```sh
export PATH=/opt/homebrew/opt/rustup/bin:$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:$PATH
npm ci && npm run build --workspaces
npx vitest run --root tests/acceptance/1897 seek-play.test.ts --no-file-parallelism --testTimeout=600000      # AC1 (full,test-tick)
npx vitest run --root tests/acceptance/1897 cross-machine.test.ts --no-file-parallelism --testTimeout=600000  # AC2 (full)
npx vitest run --root tests/acceptance/1897 pixel-hash.test.ts --no-file-parallelism --testTimeout=600000     # AC3 (full)
npx tsc -p tests/acceptance/1897/tsconfig.json
```

`scripts/lanes.mjs` needs `'tests/acceptance/1897/'` in its `alone` list: these files build `deep-show` and hold the GPU.

## Criteria to tests

IDs are the first 8 hex digits of the SHA-256 of each criterion's text, trimmed and with white space collapsed
(`scripts/proof-change.mjs`). Each test's name starts with `AC<n> #1897.<id>`.

| AC | ID | File | Tests |
|---|---|---|---|
| 1 | `#1897.b9031214` | seek-play.test.ts | the ticking board over its named times: seek's `pixel_hash` = play's at every time, the step at 0.5 s moves it, `document.determinism` PASS with `machines: same`; planted `checkpoint_nearest_in_distance` fails at 352,799,999 flicks in the call and the verdict |
| 2 | `#1897.0cf38b45` | cross-machine.test.ts | one test: an honest record (Vello CPU, f32, scalar; no `pixel_hash`); records at the detected level and through u8 refused on either side, naming `simd` / `pipeline`; an honest pair from one machine never PASS; the other architecture's record PASS, `machines: any` (BLOCKED without it) |
| 3 | `#1897.de2ffa3e` | pixel-hash.test.ts | 1,000 seeded rgba8 / rgba16float frames: GPU = CPU, read-back = frame, 1,000 distinct hashes; 100 one-bit flips and 10 swaps per format each move it; planted `hash_xors_without_position` passes the flips and fails the swaps naming the pixels |

## The surface under test

The issue names the determinism check, its fields and the GPU pixel hash, but no call API. These tests drive
`deep-show run` (one JSON scenario per stdin line, one answer line `{"ok": true, "replies": [...]}`, one reply per call,
as #393, #488 and #501 left it), the scenario's `planted` value (#488's), the startup `--planted <name>` argument
(#501's; an unknown name is `bad_input`, exit 2) and the `verdict` call on a scenario's `claims` (#403's). No new binary
or subcommand. **Every name below that the issue or the design doesn't give is this job's choice; the implementer
builds exactly these, or a dispute goes to a blind redraft.** Times are flicks (integers); hashes are lower-case hex.

| Surface | Request fields | Reply fields read | New or existing |
|---|---|---|---|
| scenario | `evidence`, `sessions`, `processes`, `panels`, `docs`, `claims`, `planted`, `calls` | `ok`, `replies` | existing |
| `deep_show` | `session`, `doc`, `document`, `include: ["issues"]` | `outcome: "presented"` | existing |
| `determinism`, same machine | `doc`, `display_hz: 144`, `at_times`, **`compare: "same_machine"`** (the default) | `outcome: "compared"`, `frames[]: {t, play: {…, pixel_hash}, seek: {…, pixel_hash}}` | extends #488's call |
| `determinism`, cross machine, a record | `doc`, `display_hz`, `at_times`, **`compare: "cross_machine"`**, **`raster_2d?: {simd?, pipeline?}`** | **`outcome: "recorded"`, `record`** | new form |
| `determinism`, cross machine, compared | the same, with **`against: <record>`** | **`outcome: "compared"`, `result`, `machines`**, or **`outcome: "refused"`, `code: "cross_machine_raster"`, `setting`** | new form |
| `verdict` | `claim` (a requirement `{kind: "document.determinism", at_times, compare: "same_machine"}`) | the requirement's row: `result`, **`machines: "same"`**, `issues[].t` | existing; `machines` changes |
| **`pixel_hash`** | `frames: [{size: [w, h], format: "rgba8" \| "rgba16float", bytes: sha256}]` | `outcome: "hashed"`, `hashes: [{gpu, cpu, readback}]` | new |
| `--planted hash_xors_without_position` | startup argument | — | new value |

### `determinism`, same machine (criterion 1)

```json
{"call": "determinism", "doc": ID, "display_hz": 144, "at_times": [flick], "compare": "same_machine"}
```

answers #488's reply with one field added to each side:

```json
{"outcome": "compared", "at_times": [flick], "frames": [{"t": flick,
  "play": {"pixels": sha256, "nodes": [...], "pixel_hash": hex32},
  "seek": {"pixels": sha256, "nodes": [...], "pixel_hash": hex32}}]}
```

- `pixel_hash` is the GPU pixel hash of that side's canonical render at t: its raw pixels reduced on the GPU to 128
  bits, the 16 bytes read back, as 32 lower-case hex digits. It is the same function `pixel_hash` (below) computes.
- Play and seek keep #488's meaning (play: the warm path at `display_hz`; seek: a cold evaluation jumped back to t).
  The test compares only `pixel_hash`; `pixels` and `nodes` stay as #488 left them.
- `compare` absent means `same_machine`. A machine with no GPU answers `{"outcome": "refused", "code":
  "gpu_unavailable"}`, which the test reads as BLOCKED.

### `verdict` on `document.determinism` (criterion 1)

The scenario's `claims` hold one claim (`session`: the agent's, `deliverables`: the document) whose one requirement is
`{"id": REQ, "check": {"kind": "document.determinism", "at_times": [flick], "compare": "same_machine"}}`;
`{"call": "verdict", "claim": CLAIM}` answers `{result, key, requirements: [row]}` as #403 left it. The row for the
requirement reads: `result: "PASS"` when every time's hashes agree, `"FAIL"` otherwise with an issue per time that
differs carrying `t` (the flick); and **`machines: "same"`**, since a comparison of GPU pixel hashes holds on one
machine only (at the base the row says `"any"`).

### `determinism`, cross machine (criterion 2)

Making this machine's record:

```json
{"call": "determinism", "doc": ID, "display_hz": 144, "at_times": [flick], "compare": "cross_machine",
 "raster_2d": {"simd": "scalar" | "neon" | "detected", "pipeline": "f32" | "u8"}}
```

`raster_2d` is optional, and each of its fields defaults to the reference (`simd: "scalar"`, `pipeline: "f32"`), the
values #385's `raster` takes. It answers:

```json
{"outcome": "recorded", "record": {
  "machine": {"os": string, "arch": string, "cpu": string, "emulated"?: bool},
  "frames": [{"t": flick,
              "raster_2d": {"raw": sha256, "renderer": {"name": "vello_cpu", "version": string, "pipeline": "f32" | "u8", "simd": string}},
              "evaluated": {...}}]}}
```

- `machine.arch` is the CPU architecture the record was made on (`aarch64` / `x86_64`, or Node's `arm64` / `x64`: any
  spelling, as long as two architectures differ); a linux/amd64 container on an arm64 Mac records `x86_64` with
  `emulated: true` (Golden).
- `raster_2d.raw` is the SHA-256 of the raster's raw pixel buffer as Vello CPU wrote it (never an encoded file's bytes),
  at the document's size; `renderer` names what drew it as #385's `raster` answer does (a detected level by its own
  name: `neon` on Apple silicon).
- `evaluated` holds the evaluated data the design lists (instance arrays, poses, glyph runs, layout positions, PCM from
  our own kernels) in whatever form the check compares; this suite doesn't read it. The record holds no key named
  `pixel_hash` anywhere: GPU pixels are never cross-machine evidence.
- Making a record at non-reference settings is allowed: the record says what drew it.

Comparing against another record: the same call with `"against": <a record>` makes this machine's record at the
settings asked and compares the two:

```json
{"outcome": "compared", "result": "PASS" | "FAIL" | "INCONCLUSIVE", "machines": "any" | "same", "issues": [...], "record": {...}}
```

or, when a raster on either side wasn't rendered by Vello CPU's f32 pipeline at the scalar level:

```json
{"outcome": "refused", "code": "cross_machine_raster", "setting": "simd" | "pipeline", "value": string}
```

- `setting` names the setting that is off (`simd` before `pipeline` when both are, as #385's `golden_config`); `value`
  is what drew it (`neon`, `u8`, …).
- Two records of one architecture may be compared, but the result is never `PASS` (Golden: a run on the same
  architecture never satisfies `cross_machine`); this suite doesn't fix which other result it is.
- Two records of different architectures whose evaluated data and rasters are identical give `result: "PASS"`,
  `machines: "any"`.

### `pixel_hash` (criterion 3)

```json
{"call": "pixel_hash", "frames": [{"size": [w, h], "format": "rgba8" | "rgba16float", "bytes": sha256}]}
```

Each frame's bytes are in the scenario's evidence store: rows top-down without padding, 4 bytes a pixel for `rgba8`,
8 for `rgba16float` (four little-endian binary16 channels). For each frame the call puts the bytes in a GPU texture of
that format, runs the GPU pixel hash on it (an exact operator: it reads the texture's bits as integers, never through
a float operation, and reads back 16 bytes), copies the texture back to the CPU, keeps those bytes in the evidence
store and hashes them with the CPU's implementation of the same hash. It answers:

```json
{"outcome": "hashed", "hashes": [{"gpu": hex32, "cpu": hex32, "readback": sha256}], "adapter": {"name": string, "software": bool}}
```

one entry per frame, in order: `gpu` the 16 bytes the GPU read back, `cpu` the CPU's hash of the read-back buffer,
`readback` that buffer's SHA-256. A frame missing from the store or of the wrong length is refused (`unknown_asset`,
`bad_frame`); a machine with no GPU answers `{"outcome": "refused", "code": "gpu_unavailable"}`, read as BLOCKED.

### Builds (Cargo features of `deep-show`)

| Feature set | Used by |
|---|---|
| `full` | cross-machine.test.ts, pixel-hash.test.ts |
| `full,test-tick` | seek-play.test.ts: #488's test canvas module `test.tick` (steps at 60 Hz, a checkpoint every 0.5 s) |

### Planted programs

| Name | How | What it does wrong | Criterion |
|---|---|---|---|
| `checkpoint_nearest_in_distance` | the scenario's `planted` (existing, #488) | a seek restores the checkpoint nearest to t by distance, so at 0.5 s − 1 flick it shows 0.5 s's step | 1 |
| `hash_xors_without_position` | `deep-show run --planted hash_xors_without_position` (new) | the GPU pixel hash and its CPU twin fold each pixel's bits by XOR with no term for the pixel's position: any one bit flip changes it, no swap does | 3 |

The first must fail by hash first at 352,799,999 flicks, in the call and as a verdict issue with that `t`. The second
must pass this suite's flip check and fail its swap check, the failure naming both pixels by `(x, y)`.

## Fixtures

All made at test time, with no outside tool; no personal data.

- **The ticking board** (`TICK_BOARD`, #488's): 320 × 200, 3 s; a `test.tick@1` item, a rect sliding x 16 → 216 over
  2 s, a label. Named times: 0; 2 s − 1 and 2 s (the slide's last key); every checkpoint 0.5 s … 2.5 s and the flick
  before each; the midpoints 0.25 s … 2.75 s; 3 s − 1.
- **The sliding board** (`SLIDING`): 320 × 200, 3 s, plain 2D items (a ground, a sliding rect, a still rect, a label),
  compared across machines at 0, 1 s and 2 s − 1.
- **The 1,000 frames**: mulberry32 seeded 1897; frame i is `rgba8` for even i and `rgba16float` for odd i, w and h each
  in [1, 64], every byte seeded.
- **The flips and swaps**: mulberry32 seeded 18970; per format one 64 × 64 frame, 100 distinct pixels each with one bit
  flipped (pixel k of the 100 flips bit k mod 32 for rgba8, k mod 64 for rgba16float, bit 0 the first byte's lowest),
  and 10 pairs of distinct, unequal pixels swapped.

## Legs that read BLOCKED or INCONCLUSIVE

None of these is ever a pass.

- Any GPU leg (criteria 1 and 3) on a machine where the call answers `gpu_unavailable` (or another refusal naming a
  GPU or adapter): BLOCKED.
- Criterion 2's cross-architecture leg, after the one-machine half has run and passed: BLOCKED until
  `DEEP_1897_OTHER_RECORD` names a record made on the other architecture. The test writes this machine's honest record to
  `target/acceptance-1897/record-<platform>-<arch>.json`; run the same test on a machine of the other architecture (an
  x86_64 Linux or Mac for an arm64 Mac, or the reverse; the design lets a linux/amd64 container count for CPU checks),
  take the record it writes there, and point `DEEP_1897_OTHER_RECORD` at it here. A record from the same architecture is
  BLOCKED too.
- Criterion 2's detected-level refusal on a machine where Vello CPU detects no SIMD level (the detected record says
  `scalar`): INCONCLUSIVE.

## The oracle

The oracle page links Vello's snapshot suite (`vello_tests/vello_dev_macros/src/test.rs`, `vello_tests/test_support/src/
diff.rs`, `vello_tests/snapshots`) for criterion 2, as "run on our code; port; formula". There is no
`tests/acceptance/1897-oracle/` folder, because those tests can't run against our output: they render Vello's own test
scenes, built through Vello's scene API, and compare them with Vello's reference PNGs; our code draws documents, adds no
Vello scene, and has nothing to say about Vello's scenes that running Vello's suite at our locked version (`vello_cpu`
0.3.0) wouldn't say about Vello alone. What the suite establishes is carried over instead. Port: the reference is
Vello CPU's f32 pipeline at the scalar level, so this suite requires a cross-machine record's rasters to be exactly that,
named in its `renderer` block as #385's goldens are. Formula: the reference compares at tolerance 0, while SIMD levels
and the u8 pipeline only match within their own tolerances; so only scalar f32 rasters are exact evidence across
machines, the cross-architecture leg passes only on identical records, and the detected level and u8 are refused (the
refusal naming the setting is ours, as the page says). Under the issue's rule that a linked test counts only when run
against our output, the oracle lane for criterion 2 stays BLOCKED with one ask: a runner that draws Vello's snapshot
scenes through our raster path, which neither the base nor this issue has.

## Readings where the issue and design leave a choice

- "By hash" (criterion 1) is the GPU pixel hash, the same-machine comparison the Determinism semantics and the
  Determinism class name. The design also names raw samples; the board has no sound, so no sample hash is read here.
- The design's seek "from a cold session and from one last played past the target" isn't asserted beyond #488's seek
  side; the planted restore is the wrong program criterion 1 must catch.
- "1,000 seeded rgba8 and rgba16float frames" is 1,000 frames in all, 500 of each format, alternating.
- "Any one bit flips at 100 random pixel positions": 100 seeded positions per format, one bit each, the flipped bit
  running through every bit of a pixel; "two unequal pixels swap": 10 seeded pairs per format, each on its own.
- "The CPU's hash of the same read-back buffer": the program's CPU implementation of the hash, applied to the buffer it
  read back; the test checks that buffer is the frame it sent (by SHA-256) and that the 1,000 hashes are distinct.
- "Naming the setting" is the refusal's `setting` field, `simd` or `pipeline`, as #385's `golden_config` names its
  `path`; "naming the pixels" is the suite's own swap check naming both pixels' `(x, y)`.
