# Acceptance tests for #1983: the x86_64 lane on the reference Mac

Written first, from issue #1983 (its Scope, seven acceptance criteria and Proof line), its Oracle page
(`doneright/oracles/issues/1983.md` in DeepBuildAI/deepbuild, branch `doneright`: no upstream test for any criterion),
the design sections it links and the base commit, by a job that never saw an implementation: none existed, and no
other branch or worktree was read. The base is this worktree's HEAD, `d51be2c3` ("Merge pull request #2108 …"), which
holds #531's and #532's merges. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a
blind redraft of this job (design: Dogfooding).

## What was read

- The issue, live with `gh issue view 1983 --repo windoliver/deepbuild`, and its Oracle page.
- `docs/technical-design.md`: Rules every primitive follows (Seeded and replayable), The logic module (Logic; Sandbox
  and budgets; Logic bake and checks), the platform bullet "CPU architecture" (a linux/amd64 container on the reference
  Mac counts as the other architecture for CPU checks, recorded as emulated, never for GPU output, timing or a budget),
  Dogfooding. AGENTS.md.
- `docs/canvas-primitives.md`: Golden (its fields and report, `machines: same`, the emulated container), Check input:
  logic kinds, Check input: `physics.determinism`.
- `docs/parallel-proof.md`: §8 Remote lanes (the record comes back; merged per test, any FAIL wins), §10a (each lane's
  evidence record at `~/.deepbuild/lanes/<tree>-<lane>.json`, #1115), §11.
- At the base: `crates/deep-logic` (`lib.rs`'s calls, `checks.rs`, `main.rs`'s `--planted`), `scripts/lanes.mjs`
  (`exactTree`, `writeRecord`, `worst`, `alone`), `rust-toolchain.toml`, and the suites `tests/acceptance/531/` and
  `532/` (README, helpers.ts, programs.ts, their docker linux/amd64 helpers) and `1115/` (README, evidence.test.mjs) as
  patterns. Nothing is imported from them.

What the base already has, which these tests don't credit: deep-logic's `golden` (its `machine` is `{os, arch, cpu}`,
here `macos`, `aarch64`), `golden_verify` (`machines` `same` or `different`, `first_step`), `budget`, and `determinism`
with a `compare` other than `same_machine` answering a stub: `BLOCKED` with one `ask` and nothing read;
`scripts/lanes.mjs`'s `exactTree` and `writeRecord`. It has no lane, no pin, no reader of a lane's record, no merge of
records, and none of this suite's planted names.

## Run them

```sh
npm ci                                   # once, if node_modules is missing
colima start                             # once, if Docker is down: the lane's container runtime
docker pull --platform linux/amd64 "$(node -p "const p=require('./scripts/lane-x86.json'); p.image+'@'+p.digest")"   # once
docker pull --platform linux/arm64 "$(node -p "const p=require('./scripts/lane-x86.json'); p.image+'@'+p.digest")"   # once: criterion 3's arm64 run
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/1983 --no-file-parallelism
npx tsc -p tests/acceptance/1983/tsconfig.json
rm -rf tests/acceptance/1983/node_modules/.vite
```

What a run builds: **`deep-logic`** for this Mac (`cargo build --locked --bin deep-logic` in the checkout, copied to a
temporary folder), helpers.ts putting Homebrew's rustup on PATH when present. The suite builds nothing in a container
itself: **the lane** does, as the issue says (deep-logic for linux/amd64 in the pinned image for criteria 1, 2 and 6,
for linux/arm64 and natively for criterion 3's planted runs), with its own caches under `target/`. Its first linux/amd64
build runs under emulation and takes over 30 minutes under load, so every test passes an explicit timeout of 2 hours,
and one lane run may take 110 minutes before it is killed by its PID.

**`scripts/lanes.mjs` needs `'tests/acceptance/1983/'` in its `alone` list**: the files build deep-logic, run the lane's
Docker builds under emulation, and read the runtime's image list, which another file's container run could change. This
README is the instruction; the implementer makes that edit.

Gates: a missing host is `BLOCKED:` (a failed test, never a pass): a host other than the reference Mac (macOS arm64);
Docker unreachable (criteria 1, 2, 3's arm64 run, 4 and 6: start the runtime); no linux/amd64 image of the pinned digest
(criteria 1, 2 and 6) or no linux/arm64 one (criterion 3's arm64 run), naming `docker pull --platform <platform>
<image>@<digest>`. **The suite never pulls, removes or stops anything in the real runtime**: criterion 4's two cases are
simulated at the runtime's command line (Docker, below). Temporary folders are deleted. Node built-ins and vitest only.

`BASE-FAILURE.txt` is the run at the base: every test fails on the missing surface, none is BLOCKED and none passes.

## The surface under test

The issue names the lane's host, image, build, network, record fields, `cross_machine`, logic.budget, planted replays
and runs, BLOCKED asks and the merge, but no file, command or field name for most of them. **Every name below that the
issue or the design doesn't give is this job's invention**, the plainest one consistent with the design and the base
(deep-logic's JSON-lines calls, `writeRecord`'s record and its place, #1115's record shape, rust-toolchain.toml's
channel); the implementer builds exactly these, or a dispute goes to a blind redraft.

### The pin: `scripts/lane-x86.json`

`{"image": "rust:<channel>[-<variant>]", "digest": "sha256:<64 hex>"}`: the official Rust toolchain image of the channel
`rust-toolchain.toml` names (today `1.99.1`; #531's and #532's suites use `rust:1.99.1-slim-bookworm`), pinned by its
digest, the image index's, so one pin names its linux/amd64 and linux/arm64 images. The lane runs `<image>@<digest>`,
and its one unblock ask for a missing image holds exactly `docker pull --platform linux/amd64 <image>@<digest>`.

### The lane: `node scripts/lane-x86.mjs [--planted <name>]`

Run from the checkout (its working directory), with deep-logic calls as JSON lines on stdin; this suite sends exactly
one, #532's `golden_verify` (`{"call": "golden_verify", "piece", "track", "steps", "golden"}`). Its exit status isn't
read; its record is. It:

1. reaches the container runtime only through `docker` on its PATH (the docker CLI, with the environment's
   `DOCKER_HOST` and `DOCKER_CONFIG`), and never pulls an image;
2. writes a `BLOCKED` record when the runtime doesn't answer, whose `ask` names docker as unreachable (it holds `docker`
   and `unreachable`, and no `docker pull`), and when the runtime has no linux/amd64 image of `<image>@<digest>`,
   whose `ask` holds the pull command above;
3. builds deep-logic in that image for linux/amd64, `cargo build --locked --bin deep-logic` with the checkout mounted
   read-only and its caches under `target/`, in a container whose command runs cargo;
4. runs the calls through that deep-logic in another container (`docker run` or `docker container run`) with
   `--platform linux/amd64`, the image named by an argument holding the pinned digest (`sha256:<64 hex>`),
   `--network none`, and a command (the arguments after the image) that names the `deep-logic` binary and runs no
   cargo (no argument `cargo`, none holding `cargo build`);
5. writes its record with `scripts/lanes.mjs`'s `writeRecord('x86_64', state, exactTree(checkout), tests, more)`, so at
   `~/.deepbuild/lanes/<tree>-x86_64.json`, whatever its state.

### The record

\#1115's fields, `{lane: "x86_64", state, host, platform, tree, tests}` (`state` PASS when the replay passed, FAIL when
it differed, BLOCKED when it couldn't run; `host` is `os.hostname()`; `tests` isn't read here), and:

| Field | Value |
|---|---|
| `recording_machine` | the golden's `machine` as `{os, arch}` (more keys allowed): `{"os": "macos", "arch": "aarch64"}` |
| `lane_arch` | the architecture the replay's own deep-logic reports (`about`'s `arch`, Rust's name): `x86_64` in the lane |
| `host_arch` | the host's architecture as the host names it (Node's `process.arch`, `uname -m`): `arm64` |
| `emulated` | true when the replay's architecture isn't the host's: `true` for x86_64 on arm64 |
| `image_digest` | the pinned digest the replay ran from: the pin's `digest` |
| `network` | the network the replay's container ran on: `"none"` |
| `bake_key` | the golden's `bake_key` (`{<logic ID>: 64 hex}`); it and `recording_machine` are on every record, BLOCKED too |
| `report` | on FAIL, Golden's report `{first_step, field: {id, field, values: [a, b], ulp_distance}}`; else null |
| `ask` | on BLOCKED, the one unblock ask (a string); else null |
| `readings` | readings taken in the lane (criterion 5 plants them): `{"name": "step_time" \| "frame_time", "ns"}`, `{"name": "budget", "verdict"}` |

### `deep-logic`: what this suite adds

deep-logic finds `~/.deepbuild` through `HOME`. Calls and fields not named here stay as #531's and #532's READMEs
define them.

- **`{"call": "determinism", …the fields of bake, "at_times", "compare": "cross_machine", "tree": "<40 hex>"}`** reads
  the lane's record for its golden, `~/.deepbuild/lanes/<tree>-x86_64.json` whose `bake_key` is the piece's bake keys,
  and answers `{"ok": true, "kind": "logic.determinism", "verdict", "failures": [DetFailure], "machines": "same" |
  "different" | null, "refusals": [{"field", "value"}], "ask": string | null}`:
  - **PASS** only when that record exists, its state is PASS, it has every field criterion 1 names (`recording_machine`,
    `lane_arch`, `host_arch`, `emulated`, `image_digest`, `tree`), its `lane_arch` isn't `recording_machine.arch`
    (`machines: "different"`), and its `network` is `"none"`; `failures` and `refusals` are then empty.
  - **FAIL** when the record's state is FAIL: a DetFailure (#532's shape) from its report for each item that differs,
    `{"item", "run": "golden", "step": first_step, "array": "<logic ID>.<name>", …}`.
  - **BLOCKED** with one `ask` when no such record exists (the ask names the lane), or the record is BLOCKED (its own
    ask, whatever fields a lane that couldn't run leaves out).
  - **Refused**: a missing named field, a `lane_arch` equal to the recording machine's arch, or a `network` other than
    `"none"` each gives one refusal naming the record's field and its value (`null` when missing), and the verdict is
    never PASS. `machines` is `"same"` when `lane_arch` is the recording machine's arch, `"different"` when it isn't.
- **`{"call": "budget", …, "tree": "<40 hex>"}`** (logic.budget) reads the same record and refuses every reading in it,
  `"refusals": [{"reading": name, "as": "timing" (step_time, frame_time) | "budget" (budget), "lane": "x86_64",
  "emulated": true}]`, counting none: its verdict and failures are those of the same call without `tree`.

### Planted twins

Each is one criterion's wrong program, reachable only through `--planted <name>`, and changes nothing else. A planted
lane writes its record where the lane writes one, and truthfully: the architecture its run reports, the network its
replay ran on.

| Name | Of | Criterion | The wrong program |
|---|---|---|---|
| `replay_changes_step_37` | the lane and deep-logic | 2 | in a replay (`golden_verify`), after step 37 runs, the first value of the first array the piece's first logic item writes (in its `writes` order) changes, as if step 37 had written it: an i32 plus one, an f64 to the next f64 above it, a bool flipped; the lane runs its container's deep-logic with this name |
| `container_arm64` | the lane | 3 | builds and runs the replay in a linux/arm64 container of the pinned image; all else as the lane |
| `native` | the lane | 3 | runs the replay with deep-logic built on this Mac by its own cargo, in no container |
| `default_network` | the lane | 6 | runs the replay's container on the runtime's default network (no `--network none`) |
| `budget_counts_lane_reading` | deep-logic | 5 | logic.budget counts the lane record's readings as this host's own (a step or frame time joins its frame rule, a budget reading's verdict joins its verdict) and refuses none |

### Merge: `scripts/lanes.mjs` exports `mergeRecords(tree)`

It reads every record `~/.deepbuild/lanes/<tree>-*.json` and returns (or resolves to) `{tree, state, lanes}`: `state`
the worst of their states by `lanes.mjs`'s `worst` (FAIL, INVALID, BLOCKED, INCONCLUSIVE; PASS when none is below
PASS), and `lanes` the names of the lanes whose own state is that state.

### The sandbox

Every test points `HOME` at a temporary folder, so `~/.deepbuild/lanes/` is the test's, never the real one (as #1115's
suite does), and keeps Docker's configuration (`DOCKER_CONFIG`, so colima's context), `CARGO_HOME` and `RUSTUP_HOME`
at the real ones. deep-logic, the lane and `mergeRecords` run with that HOME; the expected tree is `exactTree` of the
checkout run under the same environment.

### Docker

The real runtime is this Mac's (Docker 29 through colima). The suite inspects and lists its images and never pulls,
removes or stops anything. `docker-shim.mjs` stands at the boundary this suite doesn't own, the runtime's command line:
for criteria 1, 4 (no image) and 6 it is first on the lane's PATH as `docker`, logs every command line, refuses and logs
every pull (`docker pull`, `docker image pull`, a `run` or `create` of a hidden image without `--pull never`), and runs
the rest on the real CLI. In criterion 4's no-image case it hides the pinned image (its digest, tag and IDs): an
inspect, history, save or tag of it has no such image, a run or create can't find it locally, and a listing leaves its
lines out; the real image stays. For an unreachable runtime the lane's `DOCKER_HOST` is `unix://<temporary
folder>/no-docker.sock`, where nothing listens, with `DOCKER_CONTEXT` unset: the real daemon is never stopped. The image
list compared before and after is `docker image ls --all --digests --no-trunc` (repository, tag, digest, ID) from the
real runtime.

### The program

`tally` (helpers.ts), hand-encoded WebAssembly (no assembler) with #531's exports: `memory` (one page, maximum one),
`init(seed)`, `step(k)`, `reads_at` 0 and `writes_at` 4096. It keeps one f64 s at byte 8192, set by `init` to the
seed's top 20 bits; step k sets s to s × 1.000001 + k × 0.25 and writes `x` (f64 × 2) = [s, √s] and `n` (i32) = k, at
the offsets `check` reports for the item. Every value is IEEE f64 arithmetic both architectures give bit for bit. Each
test's piece holds one `tally` with its own seed, baked for 120 steps; logic.determinism samples 1 s.

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s: the first 8 hex digits of the SHA-256 of each criterion's text, trimmed, white
space collapsed. Each test's name starts with its criterion's ID.

| ID | File (tests) | What it asserts, and the wrong program each fails on |
|---|---|---|
| 1 `#1983.156a4df2` | `ac01-golden-pass.test.ts` (1) | tally's golden recorded here names macos/aarch64; the lane's record of its replay is PASS and names the host, the tree, the recording machine (macos, aarch64), `lane_arch` x86_64, `host_arch` arm64, `emulated: true` and the pin's digest; the replay's container ran `--platform linux/amd64` from the pinned digest; cross_machine reads PASS with `machines: different`; that record with each named field taken out is refused, naming the field. Fails: a lane that runs elsewhere or records a field wrong, a check that ignores a missing field |
| 2 `#1983.ba96b4f2` | `ac02-step-37.test.ts` (1) | the lane with `replay_changes_step_37`: its record is FAIL with Golden's report at step 37, `tally`, `x`; cross_machine reads FAIL with a golden failure naming step 37, `tally` and `tally.x`. Fails: a lane that drops the plant, a check that passes a FAIL record or names no step or field |
| 3 `#1983.10110411` | `ac03-same-arch.test.ts` (2) | the lane with `container_arm64`, then `native`: each record names `lane_arch` aarch64, and cross_machine is never PASS, reads `machines: same` and refuses `lane_arch` aarch64. Fails: a check that counts any other machine, a lane that records its configured architecture instead of the run's |
| 4 `#1983.ea54db89` | `ac04-blocked.test.ts` (2) | with the pinned image hidden, the lane pulls nothing, the real image list is unchanged, its record is BLOCKED, and cross_machine reads BLOCKED with one ask holding `docker pull --platform linux/amd64 <image>@<digest>`; with the runtime unreachable, the same, with an ask naming docker unreachable and no pull. Fails: a lane that pulls, or passes or fails without its host, an ask without the digest |
| 5 `#1983.bc212c80` | `ac05-timings.test.ts` (2) | a lane record holding a step time, a frame time (10 s each) and a budget verdict FAIL: logic.budget with the tree refuses each, as a timing or a budget, naming `x86_64` and `emulated: true`, with the verdict and failures it gives alone. `budget_counts_lane_reading`: this criterion's judgement of its reply fails, naming each reading. Fails: a budget that counts a lane reading or refuses it unnamed |
| 6 `#1983.d39b413d` | `ac06-network.test.ts` (2) | the lane's record says `network: none` and every replay container it ran had `--network none`; the lane with `default_network` ran its replay with a network, its record says so, and cross_machine is never PASS and refuses `network`. Fails: a replay with a network, a record that says none for one, a check that ignores the network |
| 7 `#1983.bcb406af` | `ac07-merge.test.ts` (1) | for one tree, the x86_64 lane's FAIL record and the Mac's `unit` PASS record merge to `{state: FAIL, lanes: [x86_64]}`. Fails: a merge where a pass hides a FAIL, or that doesn't name the lane |

Test count: 1 + 1 + 2 + 2 + 2 + 2 + 1 = 11.

How each planted wrong program makes its test fail (reasoned; no implementation exists to run): a record missing a
named field (1) reads PASS under a check that ignores that field, which the test reports by field; with
`replay_changes_step_37` (2) a lane or check that drops the change gives a PASS record or verdict where the test needs
FAIL at 37; `container_arm64` and `native` (3) give a PASS if the check counts a run on aarch64; `default_network` (6)
gives a PASS if the check ignores the network; `budget_counts_lane_reading` (5) refuses nothing and fails the 10 s
step and frame times, so its reply has no refusal and another verdict, and the judgement names all three readings.

## Readings where the issue leaves a choice

- **"Reads the lane's record for its golden by bake key and tree hash"**: the tree comes in the call (`tree`); the bake
  key is the piece's own, matched against the record's `bake_key`.
- **"The host's architecture (arm64)", "the lane's architecture … (x86_64)", "naming the architecture aarch64"**: each as
  its own platform names it: the Mac's `arm64`; Rust's `x86_64` and `aarch64`, as deep-logic's `about` and the golden's
  machine give them.
- **"Refused, naming the field" / "the network"**: a `refusals` entry whose `field` is the record's field.
- **"One unblock ask"**: the reply's single `ask` string, the field the base's BLOCKED stub has. "Naming that" (the
  runtime unreachable): the ask holds `docker` and `unreachable`, and no pull command, which can't help.
- **"The runtime's image list"**: `docker image ls --all --digests --no-trunc`, its repository, tag, digest and ID.
- **"With no linux/amd64 image of the pinned digest" and "unreachable"**: simulated at the runtime's command line, so a
  run never touches the user's runtime or images (Docker, above).
- **"A step time, frame time or budget reading taken in the lane"**: a reading in the lane's record; logic.budget is
  where a timing or a budget would count, so it is where each is refused.
- **"A planted reader … fails, naming the reading"**: this criterion's judgement of the planted reply fails, naming the
  reading, as #532's planted budget fails its criterion.
- **"Merges with the Mac's records as remote lanes merge"**: `mergeRecords(tree)` over the tree's records in
  `~/.deepbuild/lanes/`; the Mac's record is a `unit` lane record in #1115's shape.
- **"A run in a linux/arm64 container" and "a native run"**: the lane's own planted runs, so each record is written as
  the lane writes one and names what the run reported.

## Not tested, because no criterion reaches it here

Other kinds reading the record (physics.determinism, bakes, erode jobs, rebuilds: their own issues); a real x86_64 host
writing `emulated: false`; `compare: web`; cross_machine with no record at all; the checkout mounted read-only and the
lane's cache folder; a GPU or a timing in the lane beyond logic.budget's refusal.
