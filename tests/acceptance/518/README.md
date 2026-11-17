# Acceptance tests for #518: encoding as a registered job kind, today's encoders as its tools, and every delivery judged on its own bytes

Written first, blind, from issue #518 (as of November 15, 2026: its Scope, its Fields, its 12 acceptance criteria, its
Proof line and its dependencies), its oracle map, the design sections it links and those they lean on, and the base
commit `d8c46f0d5` (`d8c46f0d58162ff0a4a483544149316aec960637`, "Merge pull request #2601"), by a job that never saw an
implementation; none exists at the base, and no other worktree, branch, stash, PR or transcript was read. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding). The oracle map links no upstream test to any of the 12 criteria, so there is no `518-oracle` folder.

## What was read

- The issue, live (`gh issue view 518 --repo windoliver/deepbuild --json title,body`), and for context its parent #217,
  its epic #219 and its siblings #519 and #1218 by title. Each test's name starts `AC<n> #518.<id>`, the first 8 hex
  digits of the SHA-256 of the checkbox's text after `- [ ] `, trimmed, white space collapsed, computed by
  `scripts/proof-change.mjs`'s own `criterionId` on the live text.
- The oracle map (`doneright/oracles/issues/518.md` in DeepBuildAI/deepbuild, branch `doneright`): 0 of 12 criteria
  have an upstream test.
- `docs/canvas-primitives.md` at the base: Export (its fields, its receipt, its Semantics and Cost in full), Export:
  encode job, Check input: export kinds, Decode worker, Asset job, the registries row of `export.target@1`.
- `docs/technical-design.md`: Device gate, capture and export; the Building blocks table's Job row; the extension API
  list (`deep.registerJob`, `deep.registerJobTool`) and the slot table's two job rows; budgets and The reference Macs;
  Criteria to tests, both ways; Wrong programs; The edit guard; Dogfooding. `AGENTS.md`.
- At the base, for surfaces and conventions only: `crates/deep-show/src/export.rs` (the delivery `export`, its
  receipt with `encoder` and `handoff: "copy"`, its outcomes, `planted`, the temporary name `.<name>.part` and the
  scratch folder beside `out`, what it does when the rename fails), `export/{feed,frames,fidelity}.rs` (frames piped to
  the encode tool one at a time, the 10 s wait, `encoder_stalled`, the PNG sequence's exact fidelity, the tag issue's
  words), `main.rs` (the scenario's keys, `planted`, `installed`, `packs`, `frame_hash`), `media.rs`;
  `crates/deep-codecs/src/{lib,pipe,export}.rs` (the helper framing: one JSON line, then `bytes` raw bytes; `encode`,
  which reads every frame first; the PNG sequence's folder of `000000.png` onward; the encoder's name and version in
  the receipt); `crates/deep-gpu/src/frame_checks.rs` (`nv12`, the fixed-point formula and its unit vector);
  `packages/extension-host` (`src/job-kinds.ts`, `src/jobs.ts`: a tool is data, `run {dir, entry}` run by Node in the
  platform sandbox with only Node and its own folder to read; `runtime/deep.mjs`), `packages/jobs/*` (first-party job
  plug-ins and their manifests), `packages/contracts/hub-slots.json`, `packages/hub/src/{canvas,hub-canvas}.ts` (the
  hub hands its canvas core a world; no film export is reachable through the hub), `scripts/proof-change.mjs`,
  `scripts/benchmark.mjs` (`fingerprint`, `judgeLimit`, `validateBudgets`), `scripts/lanes.mjs`.
- Suites as patterns and, by import, for their helpers: `157` and `157-oracle` (the closest sibling: fixture films,
  export replies, the box reader, FFmpeg, the taste test), `501` (the build, scenarios, BLAKE3, the PNG reader, the
  reference-Mac gate, `frame_hash`), `498/decode` (`media_decode`, `workers`), `1922` (the hub world, `deep install`,
  `deep_job`, plug-in fixtures), `220`, `154`, `1924`, `1925`, `1606` (a pinned merge base built by the suite).

## Run them

Put Node 24.22 and the pinned Rust toolchain first on PATH, install once, then run one file at a time. Each file builds
the `deep-show` feature sets it lists once, in `beforeAll`; `base.test.ts` and `budgets.test.ts` also build the merge
base's `deep-show` once per machine, into `target/base-518/d8c46f0d5816/`, from this repository's own history, offline.

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH"
npm ci
npm run build --workspaces                       # registered.test.ts runs the hub's CLI, packages/cli/dist/main.js
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
node node_modules/vitest/vitest.mjs run --root tests/acceptance/518 registered.test.ts --testTimeout=600000  # AC1 (full; a hub)
node node_modules/vitest/vitest.mjs run --root tests/acceptance/518 base.test.ts --testTimeout=600000        # AC1 (full; the merge base)
node node_modules/vitest/vitest.mjs run --root tests/acceptance/518 av1.test.ts --testTimeout=600000         # AC2 (full,test-encode-tools; FFmpeg)
node node_modules/vitest/vitest.mjs run --root tests/acceptance/518 trust.test.ts --testTimeout=600000       # AC3 (full)
node node_modules/vitest/vitest.mjs run --root tests/acceptance/518 handoff.test.ts --testTimeout=600000     # AC4 (both; reference Mac)
node node_modules/vitest/vitest.mjs run --root tests/acceptance/518 slots.test.ts --testTimeout=600000       # AC5, AC6 (both; macOS)
node node_modules/vitest/vitest.mjs run --root tests/acceptance/518 planes.test.ts --testTimeout=600000      # AC7 (full; reference Mac, software adapter)
node node_modules/vitest/vitest.mjs run --root tests/acceptance/518 budgets.test.ts --testTimeout=600000     # AC8 (full; the merge base; reference Mac)
node node_modules/vitest/vitest.mjs run --root tests/acceptance/518 blocked.test.ts --testTimeout=600000     # AC9 (full)
node node_modules/vitest/vitest.mjs run --root tests/acceptance/518 open.test.ts --testTimeout=600000        # AC10 (full,test-encode-tools)
node node_modules/vitest/vitest.mjs run --root tests/acceptance/518 taste.test.ts --testTimeout=600000       # AC11
node node_modules/vitest/vitest.mjs run --root tests/acceptance/518 memory.test.ts --testTimeout=600000      # AC12 (full)
node node_modules/typescript/bin/tsc -p tests/acceptance/518/tsconfig.json                                  # type-check (exits 0)
```

Every `it` passes a timeout of an hour or two: a first cargo build takes many minutes, and the merge base's is a second
whole build. `registered.test.ts` also runs `cargo build --locked -p deep-hook` (the hub won't start without it) and
starts a real hub in a temp home, as #1922's suite does; the supervisor's sandbox needs a shell that may start it.
Temp folders are removed after each test or file; no process is stopped by name or port (a watched run is stopped only
by its own PID). Nothing leaves the machine and no model is called. Delete `tests/acceptance/518/node_modules/.vite`
after a `--root` run.

`scripts/lanes.mjs` needs these lines (this job writes only its folder; the implementer adds them). Every file builds
cargo binaries and exports films through the GPU, an encode tool and a fresh decode worker, `registered.test.ts`
starts a hub, and `base.test.ts` and `budgets.test.ts` build the merge base, so none may share the machine with
another heavy file; `budgets.test.ts`, `open.test.ts` and `slots.test.ts` read a clock and the machine's load:

```js
// #518's files each build deep-show (most with test-encode-tools too) and export films through the GPU, an encode tool
// and a fresh decode worker; registered.test.ts starts a hub, base.test.ts and budgets.test.ts build the merge base,
// and budgets.test.ts, open.test.ts and slots.test.ts read a clock and the machine's load.
alone.push('tests/acceptance/518/');
timed.push('tests/acceptance/518/budgets.test.ts', 'tests/acceptance/518/open.test.ts', 'tests/acceptance/518/slots.test.ts');
```

Nothing missing passes (invariant 2): a reply without a field a test reads fails naming the field; a run that answers
`bad_input`, exits non-zero or writes other than one line fails every test that drove it; BLOCKED and INCONCLUSIVE
legs fail with a line starting `BLOCKED:` or `INCONCLUSIVE:` (#501's `blocked()` and `inconclusive()`).

## Criteria to tests

| AC | ID | File | Tests, and the wrong program each fails on |
|---|---|---|---|
| 1 | `#518.7ecf15cf` | registered.test.ts | 1: `packages/jobs/encode` installed on a real hub; `deep_job` lists the kind `encode`, held by it; the tools this machine's H.264 and PNG sequence receipts name are among its tools. Wrong program: the merge base (no plug-in, no kind; its receipt names "VideoToolbox H.264") |
| 1 | `#518.7ecf15cf` | base.test.ts | 3: the 60 s fixture film as H.264 with AAC gives the merge base's 1,440 frame hashes and 1,440 PCM hashes (the merge base's `deep-show` is built and run); the receipt's `encoder` is name@version and `handoff` is `surface` or `copy` (wrong program: the merge base's receipt); planted `handoff_drops_last_buffer` FAILs export.fidelity naming frame 1,439, nothing left |
| 2 | `#518.3c98d3de` | av1.test.ts | 4: `test-av1@1.0.0` qualifies (`encode_qualify`) and delivers the 60 s film: fidelity reads 1,440 frames and 2,880,000 samples, the file's video track is `av01`; planted tool `test-av1-drops-100th@1.0.0` FAILs export.fidelity, the first frame named 100; planted tool `test-av1-bt601@1.0.0` FAILs export.color naming the tags 6-6-6; where the decode worker can't decode AV1, the qualification and the export are `blocked` naming `av1`, nothing delivered |
| 3 | `#518.0204e16d` | trust.test.ts | 2: planted tool `suite-truncates@1.0.0` (the suite's own) cuts frame 77's file, writes none after and reports 120: FAILs export.fidelity, the first frame named 77, nothing left, while the same program whole is delivered; a `tool` with no brief, an empty brief or a brief pinning another tool is `refused` naming the tool, no frame drawn, nothing written (wrong program: the merge base, which reads no `tool` and delivers) |
| 4 | `#518.65044f7b` | handoff.test.ts | 3: `test-frames@1.0.0` by GPU surface and `suite-frames@1.0.0` by copy each report the receipt's 120 frame hashes in order, and the receipts read `handoff: surface` and `handoff: copy`; planted `handoff_sends_before_hash` fails naming the first frame whose hash differs |
| 5 | `#518.326be00d` | slots.test.ts | 1: planted tool `test-red-before@1.0.0` FAILs export.fidelity naming frame 0, its reply's `frame_hashes` the clean run's, nothing left; `test-red-after@1.0.0` is delivered with the same hashes and every delivered PNG hashes to its frame hash. Wrong programs: the two tools themselves, and a hand-off that hashes after it hands over |
| 6 | `#518.a412bee0` | slots.test.ts | 3: planted tools `suite-keeps-frames@1.0.0` (memory, the suite's own) and `test-keeps-slots@1.0.0` (surface) let go of no frame after 500: the export is `stopped` within 11 s of the tool taking frame 504, an issue names frame 505, nothing left; planted `export_waits_for_slot_forever` is still running 60 s after and fails |
| 7 | `#518.c5c5c15e` | planes.test.ts | 2: `frame_planes` on the 60 s film's 1,440 frames (read back from an H.264 export) and on the ten-frame 1080p ramp equals the CPU reference's Y and CbCr planes byte for byte, hardware and software adapter; planted `nv12_rounds_chroma_down` fails on the ramp naming frame 0, plane cbcr |
| 8 | `#518.b0585e2f` | budgets.test.ts | 2: a perf-lane task names `#518.b0585e2f`, valid against the merge base's budgets; on a reference Mac five alternated pairs after a warm-up, this build over the merge base's own `deep-show`, each ratio held to 1.05 by `judgeLimit`. Wrong program: any hand-off that costs 5% (the criterion names no twin) |
| 9 | `#518.40d2d493` | blocked.test.ts | 3: `vp9` is `blocked` naming the codec with `frames_drawn: 0`, `frames_hashed: 0` and no frame in the evidence store, the file at the destination keeping its SHA-256 (wrong program: the merge base, which refuses `unknown_target`); `suite-fails-open@1.0.0` leaves the two files at the destination unchanged and nothing else; this job's twin `export_clears_destination_first` fails naming `film.mp4` |
| 10 | `#518.f259d9bf` | open.test.ts | 2: the 60 s film's least wall time of three with `test-open-2s@1.0.0` is at most 0.2 s over its least with `test-open-0s@1.0.0`, and `timing.open` reads at least 2.0 s; planted `export_opens_tool_after_first_frame` grows by 1.5 to 3 s and fails naming the encoder open |
| 11 | `#518.2feca46b` | taste.test.ts | 1: the recorded taste call on exactly the check run's two screenshots and its recording; INCONCLUSIVE without them or the call |
| 12 | `#518.3e752f74` | memory.test.ts | 4: `suite-slow@1.0.0` (memory, `frame_delay: 3`) is never handed more than 5 frames unanswered over the 60 s film; the encode job's peak resident memory on the 60 s film as a PNG sequence is within 10% of its 6 s cut's; this job's twin `encode_reads_all_frames_first` fails each, naming the count and both peaks |

31 tests in 12 files.

## The surface under test

`deep-show run` (one scenario line on stdin, one answer line `{"ok": true, "replies": [...]}`), with the scenario's
`planted` key for the wrong programs that can only live in the product and its new `job_tools` key for encode tools a
hub holds; one Cargo feature for the native test tools; the files an export writes; and, for criterion 1 alone, a real
hub with `deep install` and `deep_job`. No new binary or subcommand. Names the issue or the design give are used as
given; **every name marked *(chosen)* is this job's**, taken from the design's words and shaped like its neighbours;
the implementer builds exactly these, or a dispute goes to a blind redraft. Times are flicks or seconds as said; hashes
are lower-case hex.

### The job kind and its first-party plug-in

- **`packages/jobs/encode`** *(chosen path, by `packages/jobs/<name>`)*: the first-party plug-in that registers the
  job kind **`encode`** through `deep.registerJob` and today's encoders as its tools through `deep.registerJobTool`,
  installed with `deep install packages/jobs/encode` as the other first-party job plug-ins are. Its manifest lists
  `encode` in `jobs`. `deep_job {op: "list"}` (#1922's reply, `{kinds: [{kind, plugin, tools: [{tool, …}]}]}`) then
  lists `encode` with `plugin` the manifest's `id` and each tool by name@version.
- **The receipt names a registered tool:** on any machine, `<encoder.name>@<encoder.version>` of an H.264 delivery and
  of a PNG sequence is a `tool` that list holds. Nothing else of the kind's descriptor is read.

### The scenario

`{"evidence", "sessions", "processes", "panels", "docs", "planted"?, "job_tools"?, "calls"}` as #501's suite writes it.

**`job_tools`** *(chosen; it sits beside #306's `packs` and #200's `installed`, what a hub hands its canvas core)*:
the encode tools the hub holds from installed plug-ins, each qualified when it was installed, in registration order,
after the build's own first-party tools. `deep-show run` takes them as qualified and qualifies none of them again.
An entry:

```json
{ "kind": "encode", "tool": "suite-frames@1.0.0", "plugin": "test/encode-suite-frames",
  "codecs": ["png_seq"], "containers": ["png"], "hardware": false, "input": "memory", "frame_delay": 0,
  "argv": ["<node>", "<plug-in folder>/tool/encode.mjs"], "cwd": "<plug-in folder>/tool" }
```

`tool` to `frame_delay` are what the plug-in handed `deep.registerJobTool` (the design's tool fields; `tool` is the
job API's name for name@version); `argv` and `cwd` are the command the host runs a `run {dir, entry}` tool by (#1922:
Node on `<run.dir>/<run.entry>`, its working folder `run.dir`). The suite reads every entry from the test plug-in's own
registration (helpers.ts `jobTool`, `fixtures/register.mjs`), never from a second description.

### `export`

The delivery form (#501, #157). New request fields:

| Field | Value | From |
|---|---|---|
| `video.codec`, `audio.codec` | any codec a qualified tool registers: `h264`, `png_seq`, and in the test build `av1`; `vp9` has no tool | issue |
| `tool` | `"name@version"`: the tool that encodes, in place of the first qualified tool for the codec | issue |
| `brief` | `{tools: ["name@version"]}`: the tools the brief pins, beside #157's `refuse` | *(chosen)*: stands in for the locked definition's brief, as #157's suite puts one on the call |
| `out`, `range`, `readback: true`, `doc` | as #501 | existing |

Outcomes, and what a test reads of each:

| Outcome | Fields read | Criterion |
|---|---|---|
| `"exported"` | `receipt` (below); the file or folder at `out` | all |
| `"failed"` by export.fidelity or export.color | `issues[]`, each `{check, frame \| frames, …}` (#157's); **`frame_hashes`** *(chosen)*: the hashes the receipt would have held, since a delivery check runs after every frame is hashed. An export.color issue about written tags names them: `tags: {nclx: [6, 6, 6], …}`, or `6-6-6` in its text, or the three fields the base's issue quotes | 1, 2, 3, 5 |
| `"stopped"` | an issue with `frame`, the frame that found no free slot (the base's `encoder_stalled` carries `frame`) | 6 |
| `"blocked"` | **`codec`** (on the reply or on an issue) *(chosen)*; **`frames_drawn`** (existing in the base's readiness stop) and **`frames_hashed`** *(chosen)*, both 0 | 2, 9 |
| `"refused"` | **`tool`** (on the reply or on an issue) *(chosen)*: the tool the brief didn't pin; any `code` | 3 |

Whatever the outcome but `exported`, nothing is left in `out`'s folder that wasn't there before: no file and no
temporary folder. The temporary name an encode tool writes under (`out` in its open) is in `out`'s folder (#501's
rule), which is where criterion 6's test watches a PNG sequence grow.

**The receipt** keeps #501's, #502's and #157's fields. Read here:

| Field | Shape | From |
|---|---|---|
| `encoder` | `{name, version, hardware: bool}`: the tool, `<name>@<version>` its name@version | issue |
| `encoder.report` | the tool's own report, the `report` of its last line (below), as it gave it; never trusted, read here only from test tools | *(chosen)*; the design speaks of a tool's "own report" |
| `handoff` | `"surface" \| "copy"` | issue |
| `timing.open` | seconds the encode tool's open took, apart from preparing | issue's Scope ("the receipt times that open apart from preparing"); the key *(chosen)*, in the design's `timing` |
| `frame_hashes`, `pcm_hashes`, `fidelity {frames, samples, floor, worst_1pct}` | as #157 | existing |

### Other calls

| Call | Request | Reply read | New or existing |
|---|---|---|---|
| **`frame_planes`** | `frames: [{size: [w, h], bytes: sha256 in the evidence store}]`, `adapter?: "software"` | `outcome: "converted"`, `planes: [{y: sha256, cbcr: sha256}]` (each plane's bytes in the evidence store: Y, w × h bytes; CbCr, w × h ÷ 2 bytes, Cb then Cr), `adapter: {name, software}`; `refused` with a code naming the adapter when it can't be opened | *(chosen)*, shaped as #501's `frame_hash`: the export's GPU conversion pass on given frames |
| **`encode_qualify`** | `tool: "name@version"` | `outcome: "qualified" \| "failed" \| "blocked"`; with `blocked`, `codec` | *(chosen)*: the kind's qualification run on one tool (the export kinds' fixture film through it, its delivery through export.fidelity, export.color and the sync rule in a fresh decode worker) |
| `media_decode` | `path`, `out`, `format: "bgra"`, `video_frames: 1` | `decoded.streams[]` with a video stream's frame file, or none | existing (#498) |
| `workers` | — | `workers[]: {pid, role, jobs}` | existing (#498) |
| `deep show` | `peer`, `doc`, `document` | `outcome: "presented"` | existing |

### How the export runs a memory-input tool *(chosen)*

The design gives the tool's fields and what a tool is handed, not the wire. A `run {dir, entry}` tool with `input:
memory` is a program the export starts as a process of its own (`argv` in `cwd`) when it opens the encode session,
its stdin and stdout pipes, with the base's own helper framing (`crates/deep-codecs/src/pipe.rs`): every message is one
JSON object on a line, and a line whose object has `"bytes": n` is followed by exactly n raw bytes.

| Direction | Message | Meaning |
|---|---|---|
| export → tool | `{"op": "open", "format": "bgra8" \| "nv12", "size": [w, h], "frames": N, "first": k, "out": "<path>", …}` | the job: its frames' format, size and count, the first frame's index and where to write. It may carry more (the job's params and the rest of its input); a tool ignores what it doesn't read |
| tool → export | `{"ready": true}` | its encoder is open: the open the receipt times |
| export → tool | `{"frame": k, "key": bool, "bytes": n}` + n bytes | frame k, in order: BGRA8 rows top-down without padding, or the Y plane then the CbCr plane |
| tool → export | `{"frame": k}` | its encoder let frame k go: a coded frame, the wake |
| export → tool | `{"end": true}` | no more frames |
| tool → export | `{"done": true, "frames": n, "report": {…}}`, then exit 0 | `out` is whole; `report` is the tool's own |
| tool → export | `{"error": "<text>"}`, then exit 1 | it failed, at its open or later |

- **The window:** the export sends a frame only while fewer than `frame_delay + 2` frames it has sent are unanswered
  (frames read but not yet coded). A frame that finds the window full for 10 s stops the export, naming that frame.
- **Stopping:** the export ends a job by closing the tool's stdin; the tool then exits.
- **A PNG sequence's `out`** is a folder the tool makes, holding `000000.png` onward, one file a frame named by the
  film's frame index, 8-bit RGBA with straight alpha, as the first-party writer's are.

### Cargo features of `deep-show`

| Feature set | What the build holds |
|---|---|
| `full` | the shipped set (existing): today's encoders as the kind's first tools, with no scenario key |
| `full,test-encode-tools` | **`test-encode-tools`** *(chosen)*: the native test tools below, each a tool of `encode` in that build. A release build refuses the feature (Wrong programs) |

### The native test tools *(chosen names; the implementer builds them)*

A test tool encodes only for an export whose request names it and whose brief pins it; none is ever taken by codec
alone, so no other suite's export meets one. `encode_qualify` runs the kind's qualification on one.

| Tool | Registers | What it does |
|---|---|---|
| `test-av1@1.0.0` | `av1` in `mp4`, with whatever the build needs to deliver that MP4's AAC sound | encodes AV1 4:2:0 from the conversion pass's planes, tagged BT.709 limited range (nclx 1-1-1, range tv), every frame at its own time. Its encoder is the implementer's choice, under a licence the repo takes (never GPL) |
| `test-av1-drops-100th@1.0.0` | the same | the same tool, leaving out every frame whose index is a positive multiple of 100 (100, 200, …) |
| `test-av1-bt601@1.0.0` | the same | the same tool, writing the tags nclx 6-6-6 (primaries, transfer and matrix SMPTE 170M), range tv |
| `test-frames@1.0.0` | `png_seq`, `input: surface`, `frame_delay: 2` | for each frame it is handed: reads the slot's BGRA8 rows top-down without padding, hashes them with BLAKE3, writes the frame's PNG (`000000.png` onward, in the folder at its `out`) as it takes the frame, and returns the slot. Its report is `{frames: [BLAKE3 hex, in order]}` |
| `test-red-before@1.0.0` | the same | `test-frames`, first writing a 16 × 16 square of opaque red (bytes `00 00 ff ff`) into the slot's top-left corner, before it reads the slot |
| `test-red-after@1.0.0` | the same | `test-frames`, writing that square into the slot after it has read and encoded the frame and before it returns the slot |
| `test-keeps-slots@1.0.0` | the same | `test-frames` for every frame up to 500; it takes each later frame, writing its PNG as it takes it, and never returns that frame's slot |
| `test-open-2s@1.0.0`, `test-open-0s@1.0.0` | what this machine's first-party H.264 tool registers | that tool behind a stub open: it answers its open 2.0 s after it is asked (or at once), and otherwise encodes as the first-party tool does |

**Why some tools are native.** A `run {dir, entry}` tool runs under Node with only Node and its own folder to read
(`packages/extension-host/src/jobs.ts`), so a tool this suite owns can hold no AV1 or H.264 encoder and can't be handed
a GPU surface. The tools that need neither are the suite's own (below); the nine above can only be the product's.

### The suite's tools

One test plug-in (`fixtures/plugin`: `deepbuild.json`, `index.ts.fixture`), copied per use with its `*.fixture` files
renamed and its manifest's `id` and `job_tools` set, registers one tool of `encode` through `deep.registerJobTool`
with `codecs: ["png_seq"]`, `containers: ["png"]`, `hardware: false`, `input: "memory"`, its `frame_delay` and
`run: {dir: "tool", entry: "encode.mjs"}`. Its program (`fixtures/tool`: `encode.mjs`, `png.mjs` and `blake3.mjs`,
each kept as `.fixture`, and a `plan.json` written per use) speaks the wire above and writes a PNG sequence; what
else it does is its plan's. The plug-in is never installed on a hub here, so its manifest's `digest` is left as the
fixture's zeros. Each tool is `<name>@1.0.0` of the plug-in `test/encode-<name>`:

| Tool | `frame_delay` | What it does | Criterion |
|---|---|---|---|
| `suite-frames` | 0 | hashes each frame it is handed with BLAKE3 (its port checked against the published vectors at its open) and reports `{frames: [hex]}` | 3, 4 |
| `suite-truncates` | 0 | writes frames 0 to 76 whole, cuts frame 77's file to half its bytes, writes none after it, answers every frame, reports all as written, exits 0 | 3 |
| `suite-fails-open` | 0 | answers its open with an error and exits 1, writing nothing | 9 |
| `suite-keeps-frames` | 2 | answers every frame up to 500 and never a later one, writing each frame's PNG as it takes it | 6 |
| `suite-slow` | 3 | takes every frame as it comes; from every 100th frame on it answers none until no frame has come for 400 ms, then answers all it holds; reports `{pending_max, holds}` | 12 |

## Planted programs (the scenario's `planted`)

Each is a wrong program the implementation builds, accepted in the scenario's `planted` beside the earlier suites'
names (an unknown name answers `bad_input`) and reachable no other way. Each planted test asserts this suite's own
judge fails and that a failure names what the criterion says.

| Name | Where it plugs in, and what it does wrong | Criterion | A failure must name |
|---|---|---|---|
| `handoff_drops_last_buffer` | the hand-off never gives the encode job the last frame's buffer: every frame is drawn and hashed and the receipt would hold them all, the tool gets one frame fewer and is told the film has ended | 1 | export.fidelity, frame 1,439 |
| `handoff_sends_before_hash` | the hand-off sends a slot's index for frame k before the GPU has finished frame k's hash and planes in it, so a tool that takes GPU surfaces reads what the slot held before | 4 | `frame <k>`, the first frame whose hash differs |
| `export_waits_for_slot_forever` | the export waits for a free slot with no deadline | 6 | still running 60 s after the tool took frame 504 |
| `nv12_rounds_chroma_down` | the conversion pass floors each 2 × 2 block's chroma (the formula below without its + 512) | 7 | the ramp, frame 0, plane cbcr |
| `export_clears_destination_first` | the export removes whatever is at the destination before it finds its tool (this job's twin: the criterion names none) | 9 | `film.mp4` |
| `export_opens_tool_after_first_frame` | the export opens the encode tool's session only after its first frame is drawn | 10 | the encoder open; a growth of 1.5 to 3 s |
| `encode_reads_all_frames_first` | the encode job reads every frame into memory before it codes the first, with no bound, as `encode` in `deep-codecs` does at the base: the export hands a memory-input tool each frame as soon as it is hashed, never waiting for a coded frame, and the first-party PNG sequence writer keeps every frame it is handed until the last is in (this job's twin: the criterion names none, the issue's Scope describes it) | 12 | the count over 5; both peaks |

The planted tools (`test-av1-drops-100th`, `test-av1-bt601`, `test-red-before`, `test-keeps-slots`, and the suite's
`suite-truncates`, `suite-fails-open`, `suite-keeps-frames`) are tools, not `planted` names.

## Fixtures

All made at test time but the plug-in and its tool's program; no personal data; licences CC0, and `blake3.mjs` keeps
BLAKE3's notice (CC0-1.0 OR Apache-2.0).

- **The fixture film** is the export guards' (#157's `filmDoc`, by import): 160 × 90 at 24 fps, a ground, a side panel
  and two bars that move a pixel a frame, so every frame differs, with a 48 kHz stereo tone. The 60 s film is 1,440
  frames and 2,880,000 sample frames a channel; the cuts used are 2 s, 5 s (120 frames), 30 s (720) and, for the
  budget, 10 s at 1920 × 1080 and 60 fps (600 frames), #157's own budget film.
- **The ramp** (`nv12.ts` `rampFrame`): ten opaque 1920 × 1080 BGRA8 frames tiled 256 × 256. In a tile red is x mod
  256 and green is y mod 256; blue is one value a tile, 28·f + 7·ty + tx (mod 256) over a frame's 28 whole tiles, the
  part tiles at the right and bottom edges taking their whole neighbour's. Every blue value has a whole tile, so every
  8-bit colour appears. Half of frame 0's chroma bytes differ between rounding to nearest and rounding down, the first
  of them byte 0 (checked with `node`, and again in the planted test).
- **The CPU reference** (`nv12.ts` `nv12`): Y = 16 + ((47·R + 157·G + 16·B + 128) >> 8); with SR, SG, SB the sums of a
  2 × 2 block's four pixels, Cb = 128 + ((−26·SR − 86·SG + 112·SB + 512) >> 10) and Cr = 128 + ((112·SR − 102·SG −
  10·SB + 512) >> 10), the shift a floor. It is held to the base's own unit vector before it judges anything.
- **The AV1 sample**: half a second of FFmpeg's `testsrc` at 160 × 90, encoded by the first of libsvtav1, libaom-av1
  and librav1e this FFmpeg has; made in a temp folder, never committed.

## Legs that read BLOCKED or INCONCLUSIVE

None of these is ever a pass.

- AC1 (base.test.ts): BLOCKED when the merge base isn't in this repository's history or its `deep-show` doesn't build
  offline, with the unblock line.
- AC2: BLOCKED without `ffmpeg` (PATH, `/opt/homebrew/bin`, `/usr/local/bin` or `DEEP_FFMPEG`) or without an AV1
  encoder in it; the first three tests are BLOCKED on a machine whose decode worker can't decode AV1, and the fourth
  on one whose decode worker can. No one machine passes all four: the criterion names two kinds of machine.
- AC4: INCONCLUSIVE off a reference Mac (Mac15,7, Mac15,12, Mac17,10 by `scripts/benchmark.mjs`), after every hash
  that ran is compared; the planted test isn't run there.
- AC5, and AC6's surface test: BLOCKED off macOS; AC5 also where the hand-off to `test-frames` reads `copy`.
- AC6: INCONCLUSIVE when the stop came later than 11 s while the one-minute load is above the core count.
- AC7: BLOCKED where `frame_planes` with `adapter: "software"` is refused with a code naming the adapter, and
  INCONCLUSIVE off a reference Mac, each only after every plane that came back is compared.
- AC8: INCONCLUSIVE off a reference Mac or not on mains power, Low Power Mode on, the thermal state not nominal, a
  run's load above the core count, or when `judgeLimit` reads the five ratios as neither all within nor all over.
- AC10: INCONCLUSIVE when a reading fails while the one-minute load is above the core count.
- AC11: INCONCLUSIVE without the two screenshots and the recording in `docs/evidence/518/` or without a recorded call
  on exactly them.

## The taste call

The check run takes `h264-aac.png` (a frame of the 60 s fixture film's H.264 with AAC delivery, from the exported
file) and `av1.png` (a frame of the AV1 tool's delivery, from the exported file) and records `both-films.mp4` (both
films playing) into `docs/evidence/518/`, attaches them to the PR and shows them in the session. The call is recorded
in `tests/acceptance/518/TASTE.json`: `{issue: 518, criterion: "#518.2feca46b", verdict: "looks_right" |
"looks_wrong", who, when (ISO 8601), screenshots: {"h264-aac.png": sha256, "av1.png": sha256}, recording:
{"both-films.mp4": sha256}, note?}` (#157's record, with `recording` *(chosen)* beside `screenshots`). This job writes
no TASTE.json and makes no picture. The AV1 picture can only be made on a machine whose decode worker decodes AV1.

## Readings where the issue and design leave a choice

- **"Registered as encode tools"** (AC1) is read on the job API's own list: `deep_job` after `deep install
  packages/jobs/encode`. The export itself is reachable only through `deep-show run`, which has no hub, so the two are
  joined by the receipt: its encoder must be a tool the list holds.
- **"The same hashes as on the merge base"** (AC1) and **"over the merge base"** (AC8): the merge base is pinned to
  `d8c46f0d5`, the commit these tests were written on, and its `deep-show` is built and run by the suite, as #1606's
  suite builds the merge base's deep-hook. Nothing recorded stands in for it.
- **"The fixture film"** is the export guards' fixture film as #157's suite makes it, 60 s where the criterion says so
  and in AC10, whose words follow AC1's. **"The export kinds' fixture film"** a tool qualifies on (AC2) is the
  product's own, which `encode_qualify` runs; the delivery the same criterion speaks of is of the suite's 60 s film.
- **"A planted AV1 tool … fails export.fidelity"** (AC2) is read at the delivery: an export the brief pins to the tool.
  Whether its qualification also names frame 100 depends on the product's fixture film being over 100 frames long,
  which no criterion says, so the planted tools' `encode_qualify` replies aren't read.
- **A test tool encodes only when pinned** *(chosen)*: so `av1` unpinned has no tool in any build, and criterion 9's
  codec is `vp9`, which the design lists among those today's encoders don't write.
- **"A file it truncated"** (AC3): the tool this suite owns writes a PNG sequence, so the file it truncates is frame
  77's, cut to half its bytes, with no frame after it; the first missing frame is 77.
- **"A document that names a tool its brief didn't pin"** (AC3): the export request's `tool`, as the design's Export
  field has it, and `brief: {tools}` on the call, standing in for the locked definition's brief. "At check" is read as
  `refused` before a frame is drawn.
- **"On the reference Mac"** (AC4) governs the whole criterion, the copy leg too.
- **A tool's hashes** (AC4, AC12) reach the test in the receipt's `encoder.report`, the tool's own report. It is the
  test's instrument, not evidence the product trusts.
- **"Sends a slot before its hash and planes are done"** (AC4) is a fault of GPU surfaces; a copy is taken from a
  finished frame, so the plant is judged with the surface tool only. The judge names the first frame whose hash
  differs, or, when the changed frames keep the export from delivering, the first frame an issue names.
- **"Leaves the receipt's frame hashes as they were"** (AC5), of an export that isn't delivered: the failed reply
  carries `frame_hashes`. **"Only after its encoder lets the frame go"**: after it has read and encoded the frame and
  before it returns the slot, so no write races the export's next draw into the slot.
- **"The frame that found no free slot"** (AC6): with `frame_delay: 2` the window is four frames; a tool that lets go
  of every frame up to 500 takes 501 to 504, and frame 505 finds none. The same count holds for a memory-input tool
  (the issue: one bounded number, whichever `input` a tool takes), so the criterion is judged with both.
- **"Within 11 s"** and **"still running at 60 s"** (AC6) are measured from outside, from the moment the tool's last
  PNG (frame 504's) appears in the destination's folder to the process's end, read every 100 ms.
- **"The same fixed-point BT.709 formula"** (AC7) is the one the encode tool's planes are made by at the base
  (`deep_gpu::frame_checks::nv12`), which matches the design's words; the design gives no coefficients.
- **"A 1080p ramp through every 8-bit red, green and blue value"** (AC7): every 8-bit colour, in ten frames.
- **"The conversion pass's planes"** (AC7) are asked through `frame_planes`, as #501 asked the hash pass through
  `frame_hash`; that an export hands a tool the same planes is not read apart from it.
- **"Under 5%"** (AC8) is `judgeLimit` at 1.05 on five ratios, which passes a ratio of exactly 1.05. Both sides are
  the debug builds the acceptance tests run, timed from the command to the answer.
- **"0 frames drawn and 0 frames hashed"** (AC9): the reply's two counts, and, since a count is the product's word, no
  frame in the evidence store with `readback: true`.
- **"A file already at the destination"** (AC9): `film.mp4` for the blocked request; for the tool that fails at open,
  whose delivery is a folder, the two files of an earlier sequence in that folder.
- **"A stub tool"** (AC10) is the machine's own H.264 tool behind a stub open, so the film is the fixture film as the
  issue exports it. The growth is the least of three wall times less the least of three, each a cold fresh run.
- **"The encode job's peak memory"** (AC12): the resident memory of the processes the run starts that aren't decode
  workers, summed and sampled ten times a second, on the first-party PNG sequence writer. **"Frames read but not yet
  coded"**: frames sent to a memory-input tool and not yet answered, counted by the tool.

## Not tested, and why

No criterion asks: a third party's encode tool installed with `deep install` and qualified there (the `job_tools`
seam stands in for what the hub hands its canvas core); NVENC, VA-API, OpenH264 and the GIF writer (not on this
platform or not built at the base); the job's key and that the film is kept under it; the kind's input and params
beyond what a tool's open reads; shards, each to its own encode job; a repeated slot for a held frame; a path-traced
final's frames; `export.target@1` naming the encode job as the video writer; that a tool has no network; that the
slots are apart from every window's; the IOSurfaces sent once over XPC, which only the hand-off's results show.

## Not settled

- **AC10 holds only if the fixture film's preparing lasts about as long as the open.** An export can't run more than
  `frame_delay + 2` frames ahead of a tool that isn't open, so its wall time grows by the open less whatever preparing
  the open overlaps. The criterion says at most 0.2 s for a 2.0 s open; the test holds it as written.
- **AC7's software leg needs a software adapter**, which the base refuses (`software_adapter_unavailable`, #230, open).
  Until one opens the test is BLOCKED.
- **AC2 can't pass whole on one machine**, and its first leg needs the decode worker to decode AV1, which the base's
  doesn't on any machine.
- **The wire of a memory-input tool** and **`job_tools`** are this job's. If the product settles other shapes, the
  suite's tools and their entries are what a redraft would change; the criteria don't depend on them.
- **The merge base's build** is a second whole `deep-show` build per machine, kept under `target/base-518/`.
