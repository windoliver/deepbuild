# Acceptance tests for #1433: a second toolkit and gpui-kit's fast backend against the app's must-haves

Written first, blind, from issue #1433 (its body; it has no comments), the design sections it links and those they
lean on, and base commit `a1ef97760` (origin/main, last merge #3457), by a job that never saw the work: none existed
when the suite was drafted on 2026-11-24, and the redraft of 2026-11-25 saw none either. The implementing agent
doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

The issue is a spike. It adds nothing to main but what it keeps in `docs/spikes/1433/`: a record, the gates it fixed
and the raw readings the record cites. These tests check what is kept there and nothing else. They take no reading
and run no harness: each gate's verdict, each reading the record names and each arm's last line are worked out from
the kept raw readings and compared with the record (invariant 1). The harness is throwaway and outside the checkout,
so no test can see it.

## Redraft, November 25: the machine the issue runs on

On 2026-11-25 the owner changed one line of the issue and nothing else:

```
before: **Runs on:** Mac only, on the reference Air.
after:  **Runs on:** Mac only, on the reference MacBook Pro (Mac17,10, M5 Max).
```

The twelve criteria are word for word what they were, so their IDs are the same. The suite of 2026-11-24 read the old
line. This redraft settles again, from the new line and the design (The reference Macs; Every task carries its own
budgets; `docs/parallel-proof.md` sections 6 and 12a), what the old line had settled, and changes nothing else:

- **The machine a reading counts on** is the third of the design's reference Macs: `Mac17,10`, `Apple M5 Max`,
  68,719,476,736 bytes (was `Mac15,12`, `Apple M3`, 17,179,869,184). `gates.json`'s `runs_on` says so, and no other
  byte of that file changed. A reading on the Air now reads `inconclusive`, as one on the Mac15,7 does: the line names
  one Mac (reading 3).
- **The load bound** is that Mac's 18 cores (was the Air's 8), `runs_on.cores`: a one-minute load at or above 18 at a
  timed run's start or end makes it a reading. The rule, 12a's "at or above the cores", is unchanged.
- **The gates' sha256** is therefore new: `985cbda74da94b32847f9f9cd45361969781911fc321eed08a5e27d29c536e92` (was
  `2bdeff35b4c39b62f485761451cf497842dc0f5a77c663f40026e0559a1a3888`). The spike's copy of `gates.json`, the record's
  `gates.sha256` and every raw reading's `gates` are held to the new one. A raw reading stamped with the earlier one
  doesn't count: its gate's test and criterion 8's fail, saying it "wasn't read under the gates fixed before the first
  run". Those gates counted a reading on the Air only, so nothing read under them counts on the Mac the issue now
  names. A reading is taken again under these gates; a test can't tell that from the old file with a new stamp
  (reading 2).
- **The words.** The checks say `read off the reference MacBook Pro (…)` and `at or above the MacBook Pro's 18 cores`
  where they said "the reference Air" and "the Air's 8 cores". In this suite "the MacBook Pro" is always the Mac17,10,
  never the design's other 16-inch MacBook Pro, the Mac15,7.
- **What follows from those.** `fixture.mjs`'s machine (its export `AIR` is now `PRO`, with a macOS build such a Mac
  runs). Seven cases of `validate.test.mjs`: the other reference Mac is the Air, and the Mac15,7 where a gate's test
  reads one; the loads are 18, 19 and 17.9 where they were 8, 9 and 7.9; the record that disagrees with its raw
  reading is told that reading's `Mac17,10`; the reading under other gates carries the earlier sha256. This README's
  examples, "What counts", reading 3 and criterion 1's row. `BASE-FAILURE.txt`, from the redraft's own runs (below).
  And where this README (twice) and `validate.mjs` (once) said the gates were written before the work, they say by a
  job that never saw it: a redraft can vouch for that, not for what was run before it.

Unchanged: `record.test.mjs`, byte for byte; every folder, file, field, arm, gate, format and limit of the surface
under test; every other reading below. The limits are the issue's and the design's values, and a budget set on one
reference Mac is met on the others or it is not met (design: The reference Macs), so none moved with the machine.

Run at the base, each file once through the machine's throttle (`BASE-FAILURE.txt`): `validate.test.mjs` passes, 82
of 82, and all 14 tests of `record.test.mjs` fail at their own assertion, no spike record. A first attempt at each,
with a 60-minute wait, got no test grant and ran nothing; the runs came with a wait of 480 minutes, and no test,
validator, fixture or gates file changed between the redraft and them.

## What was read

- Issue #1433 as it reads since 2026-11-25, and its body as it read before, to see that the `Runs on:` line is all
  that changed; #241 (its epic); #337, #1425 and #1546 (it depends on them); #1426, #140, #1482 and #1551, which its
  Scope names or takes words from.
- `docs/technical-design.md`: Decided (The app's toolkit, The canvas's GPU layer, Where agent-built panels run, What a
  speed claim needs, Clicks on the question card); How we know version 0 works (Criteria to tests, Criteria in a
  checked shape, Wrong programs, The edit guard, Dogfooding, Tests written first, Repo guards); Numbers version 0 has
  to hold (Every task carries its own budgets, The reference Macs); Tasks only you can do.
  `docs/canvas-primitives.md`: GPU surface, Frame budget, Panel runtime and panel host. `docs/parallel-proof.md`
  sections 5 to 7 and 12a.
- At the base, for names and shapes and never for expected readings: `scripts/benchmark.mjs` (`fingerprint`,
  `references`, `judgeLimit`), `benchmarks/budgets.json` and `benchmarks/canvas.mjs` with `canvas-judge.mjs`
  (`canvas-idle`: its runs, `shownWindow`, the count rule for frames), `scripts/vendor-rebase.mjs` (`MARK`, `hunksOf`),
  `vendor/gpui-pre-apple/upstream/README.md`, `vendor/gpui-pre-apple/src/metal_renderer/gpu_ledger.rs`,
  `crates/deep-gpu/src/view.rs`, `crates/deep-app/src/trusted_input.rs`, `crates/deep-app/panels/claude-code/main.js`,
  `crates/deep-canvas-marks/looks/clean.json`, `Cargo.lock`, `scripts/proof-change.mjs` and `proof-runs.mjs` (tags),
  `scripts/lease`; the records `docs/spikes/337`, `338`, `339`, `1477`, `3222`; and the suites `tests/acceptance/337`,
  `338`, `391`, `140/gpu`, `377`, `1425`, `1477`, `1482`, `2649` and `3222`.
- `gpui-fast` 0.1.10's source, read where the registry keeps it: `src/fast/retained.rs` (`GPUI_VIEW_RETENTION`,
  `reusable_record` returning nothing while the window is refreshing) and `src/fast/stats.rs` (`views_built`,
  `views_reused`).
- A probe, run once and not kept: the carried hunks of the three gpui trees as `scripts/vendor-rebase.mjs` cuts them
  against the pinned releases (181 hunks in 66 changed files) beside the marks in the same trees (244, in the same 66
  files). Neither is a reading of the spike.

## How to run

```sh
node --test tests/acceptance/1433/record.test.mjs     # the criteria, on the kept spike; under a second
node --test tests/acceptance/1433/validate.test.mjs   # the validators' own check and the planted wrong records; about 8 s
```

Node 24.22 first on `PATH`, and `git` with this checkout's history: the record's `base` commit, and for
`validate.test.mjs` the commit this suite was written on, `a1ef97760cbcc9935b8fdadd4a7bef586969ef4d`. No build, no
`node_modules`, no network, no window, no GPU. Both files read only; `validate.test.mjs` writes its synthetic spikes
under the system's temporary folder and removes them. Nothing waits for time. The folder needs no `lane.json` and no
line in `scripts/lanes.mjs`: nothing here has to run alone, and `scripts/affected.mjs` and the proof lanes run a
`.test.mjs` under `tests/acceptance/` with `node --test`, as they run #3222's and #2649's.

`validate.test.mjs` passes on the base, since it tests the tests and not the spike. None of its tests carries a
criterion's ID: the proof lanes hold a test that carries one to failing on the merge base (`scripts/proof-runs.mjs`,
the before lane), and these read no spike. Its tests named `validator:` are of no one criterion. Its tests named `AC8`,
`AC9` and `AC12` are the wrong records that criterion names, each a copy of the synthetic well-formed spike altered in
test code and given to the same check the kept record takes.

## The surface under test

Every name in this section that the issue or the design doesn't give is this suite's choice, marked **(mine)**, and a
requirement on the implementer. `fixture.mjs` builds a whole well-formed spike in these formats; this writes it to a
folder to read, as `<dir>/docs/spikes/1433/`:

```sh
node -e "import('./tests/acceptance/1433/fixture.mjs').then((f) => f.write(process.argv[1], f.wellFormed()))" /tmp/spike-1433-example
```

### The spike's folder

`docs/spikes/1433/` (the issue: "`record.json` in `docs/spikes`"; #1477's suite already cites
`docs/spikes/1433/record.json`). It holds:

- `record.json`;
- `gates.json` **(mine)**, a byte-for-byte copy of `tests/acceptance/1433/gates.json`;
- the files the record cites, each as `{ "file": "<path relative to the folder, no ..>", "sha256": "<of its bytes>" }`
  **(mine)**. The examples keep them under `raw/`; any relative path does;
- `README.md` if the spike keeps notes. Nothing else: a file there that is none of these fails criterion 8, and so
  does a `spikes/1433/` folder in the checkout.

### `gates.json`: the gates, fixed before the first run

`tests/acceptance/1433/gates.json` is the gates: each criterion that is a gate, the arms it is a gate of, and the
issue's and the design's values. It was written with this suite, by a job that never saw the work, and its `runs_on`
again in the redraft. The spike keeps a copy and every raw reading names its sha256 (`gates`), which is how a kept
reading shows the gates it was read under. The checks judge against this suite's file, never the copy.

| Arm **(mine)** | Gates, in order **(mine)** |
|---|---|
| `candidate` | `canvas-handoff` (AC1), `idle` (AC2), `list-transcript` (AC3), `text-input` (AC4), `accessibility` (AC5), `question-card` (AC6), `panel` (AC7) |
| `gpui-fast` | `list-transcript` (AC3), `retention-frames` (AC10), `still-ledger` (AC11), `list-shapes` (AC12) |

### `record.json`

```json
{
  "spike": 1433,
  "base": "a1ef97760cbcc9935b8fdadd4a7bef586969ef4d",
  "gates": { "file": "gates.json", "sha256": "<sha256 of gates.json>" },
  "arms": {
    "candidate": {
      "pin": { "revision": "<the candidate's pinned commit, 40 to 64 hex>", "mirror": { "sha256": "<of the mirrored source>" } },
      "harness": { "sha256": "<of the candidate arm's harness binary>" },
      "gates": {
        "canvas-handoff": {
          "status": "pass",
          "reading": { "frame_ms": [0.75, 0.8125, 0.875, 0.78125, 0.84375] },
          "machine": { "model": "Mac17,10", "chip": "Apple M5 Max", "memoryBytes": 68719476736, "power": "ac", "lowPowerMode": false, "thermalState": "nominal", "macosBuild": "26B8119" },
          "load": 1.75,
          "raw": { "file": "raw/candidate-canvas-handoff.json", "sha256": "<sha256>" }
        },
        "accessibility": { "status": "inconclusive", "why": "no person has walked the window yet" }
      }
    },
    "gpui-fast": {
      "version": "0.1.10",
      "copies": { "gpui-fast": "<checksum Cargo.lock pins>", "gpui-fast-apple": "<checksum Cargo.lock pins>" },
      "carry": [{ "file": "vendor/gpui-pre-macos/src/events.rs", "line": 21, "issue": 542 }],
      "harness": { "sha256": "<of the gpui-fast arm's harness binary>" },
      "gates": {
        "retention-frames": {
          "status": "pass",
          "reading": { "frames": 3, "first_difference": null },
          "machine": { "model": "Mac17,10", "chip": "Apple M5 Max", "memoryBytes": 68719476736, "power": "ac", "lowPowerMode": false, "thermalState": "nominal", "macosBuild": "26B8119" },
          "load": 1.75,
          "raw": { "file": "raw/gpui-fast-retention-frames.json", "sha256": "<sha256>" },
          "journey": { "file": "raw/journey.jsonl", "sha256": "<sha256>" },
          "planted": { "file": "raw/gpui-fast-retention-frames.planted.json", "sha256": "<sha256>", "view": "row-7" } }
      }
    }
  },
  "lines": { "candidate": "INCONCLUSIVE: accessibility", "gpui-fast": "fallback" }
}
```

This example is cut short: it shows one gate that was read and one that wasn't on the candidate, one gate of
`gpui-fast`, and one carried hunk, where a record lists every gate of each arm and every carried hunk, and its lines
follow from all of them. `fixture.mjs` writes a whole one. All of it is **(mine)** but the folder and the words
`fallback`, `closed` and `INCONCLUSIVE`:

- `spike`: 1433. `base`: the full hash of the main commit the harness was built from, an ancestor of `HEAD`. The tests
  read this checkout's files at it with `git show`, so a later main can't change what a kept reading is held to.
- `arms`: exactly `candidate` and `gpui-fast`, in that order. The record calls the second toolkit the candidate;
  `pin` names its revision and the sha256 of its mirrored source, never its name.
- `arms.<arm>.harness.sha256`: the arm's harness binary. Every raw reading of the arm names it.
- `arms.<arm>.gates`: every gate of the arm and no other. Each has `status`, `pass`, `fail` or `inconclusive`, equal to
  what its raw reading gives. A gate with a raw reading has `raw` (the citation), `reading` (the gate's own shape,
  below, equal to what the raw reading gives, numbers to one part in a million), `machine` (equal to the raw
  reading's) and `load` (the highest one-minute load at the start or the end of any of its runs). A gate with no
  reading has none of the four. A gate that reads `inconclusive` says `why`.
- `arms["gpui-fast"]`: `version`, `"0.1.10"`; `copies`, the checksum `Cargo.lock` at `base` pins for `gpui-fast` and
  for `gpui-fast-apple` at that version; `carry`, every carried hunk (Readings, 16).
- `lines`: the record's last key, one line per arm, exactly the line its gates give: `fallback` when every gate
  passed; `closed: <gate>[, <gate>]` naming every failed gate, in the arm's gate order, when any failed; otherwise
  `INCONCLUSIVE: <gate>[, <gate>]` naming every gate that is unrun or undecided.

### A raw reading

One JSON file per gate and arm, holding all its runs. Every one says of itself **(mine)**:

```json
{
  "spike": 1433, "arm": "candidate", "gate": "idle",
  "gates": "<sha256 of gates.json>",
  "harness": "<sha256 of the arm's harness binary>",
  "profile": "release",
  "command": "scripts/lease ./harness --arm candidate --gate idle",
  "machine": { "model": "Mac17,10", "chip": "Apple M5 Max", "memoryBytes": 68719476736, "power": "ac", "lowPowerMode": false, "thermalState": "nominal", "macosBuild": "26B8119" },
  "surface": "window",
  "runs": [{ "started": "2026-11-26T09:00:00.000Z", "load": { "start": 1.5, "end": 1.75 }, "window": { "state": "shown" }, "seconds": 60, "frames": 0, "wakeups": 0 }]
}
```

- `harness`: the binary whose window, or whose shim, the reading is of, also when another tool read it (`deep-live`).
- `profile`: the harness's build profile. `command`: the command line that took the reading, through `scripts/lease`.
- `machine`: the fields of `scripts/benchmark.mjs`'s `fingerprint()`, as #337's record has them.
- `surface`: `window` for a real window; `replica` or anything else for a reading through a headless render.
- `runs`: one entry per run. `started` is an ISO time; `load` the one-minute load average at the run's start and end;
  `window.state` is `shown` when AppKit showed the window throughout, as a `canvas-idle` run says it.
- `taken_by`: `"person"` on a person's gates (`text-input`, `accessibility`, `question-card`) when a person took it.
- `planted`: only on a planted program's kept run, naming the program; its `harness` is that build's, not the arm's.

### Each gate's raw reading, and the reading the record names

Beyond the fields above. Times are in ms, sizes in bytes, CPU in percent of one core.

| Gate | The raw reading adds **(mine)** | `reading` in the record **(mine)** |
|---|---|---|
| `canvas-handoff` | `slot: { size_px: [1936, 1584], translucent_px, pixel_hash }`: the `deep_gpu::view::Ui` slot as the window shows it, read back: its size, how many of its pixels have an alpha between 0 and 255, and the sha256 of its pixels. `headless: { size_px, pixel_hash }`: the same frame from the headless canvas. `swatches: [{ status, read: [r, g, b] }]`: the #140 colour check, one per status of `crates/deep-canvas-marks/looks/clean.json`, read back from the window's surface. Five runs, each `frame_ms`: the time of each frame of the handoff, at least 300 | `{ frame_ms: [5] }`: each run's mean |
| `idle` | Five runs, each `seconds: 60`, `frames` (presented while still) and `wakeups` (package-idle wakeups), as a `canvas-idle` run reads them | `{ frames: [5], wakeups: [5] }` |
| `list-transcript` | `rows: 1000`; `transcript`: the sha256 of the recorded transcript the runs streamed; on `gpui-fast` also `shape` and `retention: "on"`. Five runs, each `pair` (1 to 5), `streamed` (chunks the transcript streamed, at least 1), `update_ms` (each update's time), `coldStartMs`, `idleCpuPercent`, `memoryBytes`, `appBytes` (the four as `docs/spikes/337/measure.mjs` reads them) | `{ update_p99_ms: [5], coldStartMs: [5], idleCpuPercent: [5], memoryBytes: [5], appBytes: [5] }` |
| `text-input` | `methods: { pinyin, kotoeri, dictation, emoji }`, each `{ lost_composition, wrong_commit, misplaced_candidate_window }`: `false` when the person saw none, `true` when they saw one. One run or more | `{ faults: [] }`, each fault seen as `"<method>: <fault>"`, in the gates file's order |
| `accessibility` | `voiceover: true`; `command` names `deep-live`; `live` and `headless`, each `{ window: { size, scale }, tree }` as `deep-live` and #338's snapshots write a tree: nodes of `role`, `name`, `value`, `bounds` (`[x, y, w, h]` in whole device pixels) and `children` | `{ nodes, first_difference: null }`, or `{ index }` of the first node that differs, in pre-order |
| `question-card` | `built_with: { path: "crates/deep-app/src/trusted_input.rs", sha256 }` (the file as `base` holds it); `card: { covered_by: [] }` (what covers the card; an empty list says nothing does); `status_item: { shown: true }`; `presses: [{ sent, told }]`, each `hardware` or `synthetic`: how the press was sent and how the card told it | `{ covered_by, hardware, synthetic, mistold }`: the list, and the counts of presses sent each way and told wrong |
| `panel` | `panel: { path: "crates/deep-app/panels/claude-code/main.js", sha256 }` (as `base` holds it); `tree`: the panel tree the shim built for one invalidation, in the app's panel-tree text; five runs, each `update_ms` | `{ parity: true, update_p99_ms: [5] }` |
| `retention-frames` | Two runs of the journey the record's gate cites as `journey`: one `retention: "on", switch: null`, one `retention: "off", switch: "GPUI_VIEW_RETENTION=0"`. Each names `journey` (the sha256 of the journey it replayed) and `frames`: `{ step, sha256, reused, views }` for each frame drawn: the journey's step, the sha256 of the frame's bytes, the views drawn again from their last frame (`gpui-fast`'s `views_reused`), and each view's name with the sha256 of its own pixels | `{ frames, first_difference: null }`, or `{ frame, step, views }`: the first frame that differs, from 1, and the views that differ in it |
| `still-ledger` | One run or more, each `vsyncs: [{ still, committed: { main, layers }, ledger: { committed, gpu_ns } }]`: whether the window was still, the command buffers the process committed in that vsync from the main render and from layer paths, counted apart from the ledger, and what the ledger counted. The reading holds vsyncs from before the window went still (`still: false`), with a layer path committing in them, and vsyncs of the still window | `{ still_vsyncs, still_command_buffers, still_gpu_ns, uncounted }`: the ledger's totals while still, and the command buffers it missed in all |
| `list-shapes` | `subject: "list"`; `ships`: `shared` or `own`, the shape the app's list ships in. Eight runs. Four `kind: "list"`, one per `shape` (`shared`, `own`) and `retention` (`on`, `off`), each `rows: 1000`, `state_entities` (the entities that hold the rows' state: 1 when shared, 1,000 when own), `reused`, `switch` and `update_ms`. Four `kind: "label"`, one per `live_rows` (1000, 3000) and `retention`, each `switch` and `frames: [{ rendered, elements, cpu_ms, reused }]` for each frame a label change drew | `{ ships, list: { shared: { on, off }, own: { on, off } }, label: { "1000": { on, off }, "3000": { on, off } } }`: each list cell the p99 of its `update_ms`; each label cell `{ views_rendered, elements_laid_out, cpu_ms_p50, cpu_ms_p95 }`, the highest count in a frame and the CPU by nearest rank |

The planted programs' kept runs are raw readings of the same shape, cited from the gate as `planted`:
`arms["gpui-fast"].gates["retention-frames"].planted` is `{ file, sha256, view }`, the two runs of a build with a glyph
page retired under a retained view, and the name of that view; `arms["gpui-fast"].gates["still-ledger"].planted` is
`{ file, sha256 }`, the run of a build whose ledger counts only the main render.

## What counts, and what each test does with a verdict

- **A reading counts** only when it was taken through `scripts/lease`, on the reference MacBook Pro (`Mac17,10`,
  `Apple M5 Max`, 68,719,476,736 bytes) with its macOS build named, in a real window AppKit showed (every gate but
  `panel`), and, for a person's gate, by a person. A time, a CPU share, memory or wakeups (`canvas-handoff`, `idle`,
  `list-transcript`, `panel`, `list-shapes`) also needs mains power, Low Power Mode off, a nominal thermal state, a
  release build, and a one-minute load below the MacBook Pro's 18 cores at each run's start and end. Anything else is
  a reading, and the gate reads `inconclusive`. A count or an equality that fails needs none of the timing conditions:
  a frame drawn while still, a swatch off, trees or frames that differ, a missed command buffer.
- **A limit** is judged on five runs by the design's rule: pass when all five are within it, fail when all five are
  over it by more than the margin (the larger of 5% and the five runs' spread), otherwise `inconclusive`.
- **A gate that passed** holds. **A gate that failed** is the spike's result, not the suite's failure: its test holds
  when the record says `fail` and ends the arm `closed:` with it, and it logs the reading. **A gate that isn't
  decided** fails its test with a line starting `INCONCLUSIVE:`, or `BLOCKED:` for a person's gate no person took,
  naming the gate and why. The one exception: on an arm that the record ends `closed:` by another gate whose kept
  reading fails it, an undecided gate holds, and the test logs that it wasn't read. A failed gate closes the question.
- **Criterion 8's test** holds a record whose arms end `fallback` or `closed:`. A record that is right and ends an
  arm `INCONCLUSIVE:` fails it with a line starting `INCONCLUSIVE:`: an unrun gate is never a pass.
- **A kept file that can't be read**, or whose sha256 isn't the record's, is `BLOCKED:` naming it.

## Criteria to tests

| Criterion | Test | What it asserts | Fails on |
|---|---|---|---|
| AC1 `#1433.c0b58a25` Canvas handoff | `record.test.mjs` AC1 | `candidate` `canvas-handoff`: a slot of 1936 × 1584 with translucent pixels, shown; every status swatch of the look at `base` read back as its 8-bit values; the slot's pixel hash equal to the headless canvas's; five runs of at least 300 frames, each run's mean under 1 ms | the base (no record). `validate.test.mjs`: 1.25 ms, a swatch one code off, a slot unlike the headless canvas fail; an opaque fixture, another size, 299 frames, four runs, another reference Mac, a load of 18, battery, a debug build, no lease, a covered window read INCONCLUSIVE |
| AC2 `#1433.8f63851f` Idle | AC2 | `candidate` `idle`, by the same harness: five runs of 60 s, 0 frames in each, wakeups at most 1 | the base. A frame while still fails at any load; three wakeups fail; a 5 s hold reads INCONCLUSIVE |
| AC3 `#1433.450e5804` Long list and transcript | AC3 | `list-transcript` for both arms: 1,000 rows, a transcript streaming, the same one for both; five runs an arm, paired, the arm that runs first alternating; each run's update p99 within 4 ms, cold start under 1,000 ms, idle CPU under 1%, memory under 200,000,000 bytes, the app under 60,000,000; `gpui-fast` in the shape the app ships, retention on | the base. 6 ms at p99, a 1.2 s start, 1.5% CPU, 250 MB, a 70 MB app fail; 999 rows, no stream, one arm first in every pair, another transcript, no partner runs, the other shape read INCONCLUSIVE |
| AC4 `#1433.9d8646d2` A person types | AC4 | `candidate` `text-input`, taken by a person: no fault seen in any of the four ways of typing | the base. A wrong commit fails; a way never tried reads INCONCLUSIVE; no person is BLOCKED |
| AC5 `#1433.27d27bbc` VoiceOver and `deep-live` | AC5 | `candidate` `accessibility`, taken by a person with VoiceOver on: `deep-live`'s tree equal to the headless dump node for node | the base. A node's bounds, or a node short, fails naming the node; VoiceOver off or another reader reads INCONCLUSIVE |
| AC6 `#1433.f1fbb5d2` Question card | AC6 | `candidate` `question-card`, built with `trusted_input.rs` as `base` holds it, the status item shown: nothing covers the card; a hardware and a synthetic press were sent, and each was told as sent | the base. A cover or a press told wrong fails; no hardware press, another source file, no status item read INCONCLUSIVE |
| AC7 `#1433.08e2511c` Panel through a shim | AC7 | `candidate` `panel`: `claude-code/main.js` as `base` holds it; the shim's tree equal to the app's panel tree for it; five runs, each update p99 within 4 ms | the base. A changed prop fails naming the line; 8 ms fails; an edited panel reads INCONCLUSIVE |
| AC8 `#1433.1ed927b2` The record | AC8; `validate.test.mjs` AC8 × 5 | Every gate listed; each read gate's reading, machine and load equal to its raw reading's; each arm's line the one its gates give, `lines` last; the gates file the one fixed first; every cited file kept with its sha256; nothing else in the folder; the arms named `candidate` and `gpui-fast` with a pin | the base. Planted: a gate left without its reading, its machine, its load; an arm ending `fallback` with a gate unrun; an arm ending `fallback` with a gate failed |
| AC9 `#1433.ff47ac97` The `gpui-fast` arm's record | AC9; `validate.test.mjs` AC9 × 3 | `version` 0.1.10 and the two copies' checksums from `Cargo.lock` at `base`; `carry` equal, as a set, to every mark in the three gpui trees at `base`; a gate of the arm read through the replica reads `inconclusive` in the record and the arm doesn't end `fallback` | the base. Planted: no version; a carried hunk left out; a replica's reading taken as the window's |
| AC10 `#1433.667977ab` Retention on and off | AC10; AC10 planted | `gpui-fast` `retention-frames`: both runs replay the cited journey; off by `GPUI_VIEW_RETENTION=0` with no view drawn again; on with at least one; the same frames, each byte-equal by its sha256. The planted run fails the same check, and the views the failure names include the planted view | the base. A differing frame fails naming frame, step and view; a frame fewer fails; no view drawn again with retention on, another switch, another journey, the replica read INCONCLUSIVE; a planted run that passes, or names another view, fails the planted test |
| AC11 `#1433.5aa9696a` Still window, ledger | AC11; AC11 planted | `gpui-fast` `still-ledger`: a layer path committed before the window went still; in every vsync the ledger counted every command buffer; while still it counted none and no GPU time. The planted run fails the same check by missing command buffers | the base. A command buffer while still, or a missed one, fails; no layer path before, or no still vsync, reads INCONCLUSIVE; a planted run that fails another way fails the planted test |
| AC12 `#1433.e587284a` List shapes and the label | AC12; `validate.test.mjs` AC12 × 2 | `gpui-fast` `list-shapes`: the subject is the list; a list run for each shape and retention, 1,000 rows, the state held by 1 entity or by 1,000; a label run at 1,000 and at 3,000 live rows, retention on and off, each frame with views rendered, elements laid out and CPU | the base. Planted: one state shape; a reading from a bench whose panels each own their state. Each reads INCONCLUSIVE for the list |

Each test's name in `record.test.mjs` starts with its criterion's number and ID, the first 8 hex digits of the SHA-256
of the criterion's text as `scripts/proof-change.mjs`'s `criterionId` reads it; they came out as the brief gave them.

## Readings where the issue and the design leave a choice

1. **What a gate is.** Criteria 1 to 7 are the candidate's gates, as the Scope says ("the gates below … any failed
   gate closes the question for the candidate"). Criterion 3 names `gpui-fast` too, and criteria 10, 11 and 12 are
   what that arm must hold, so they are its gates: criterion 8 gives every arm a line that is `fallback` or `closed`
   with a failed gate. Criteria 8 and 9 are about the record and are no gate.
2. **Fixed before the first run.** The gates are this suite's `gates.json`, written by a job that never saw the work.
   The spike keeps a copy, byte for byte, and each raw reading names its sha256. A test can't see when a run was
   taken; it can see that every kept reading was stamped with the gates as this suite fixes them, so a run stamped
   with the gates of the draft before the redraft isn't one of them.
3. **The reference MacBook Pro only.** The `Runs on:` line names one Mac, the reference MacBook Pro (Mac17,10, M5
   Max): the third of the design's reference Macs, by the fingerprint `scripts/benchmark.mjs`'s `references` gives it
   (model, chip, memory). The design counts a budget on any of the three; the issue's line is narrower, so a reading
   on another reference Mac, the Air (Mac15,12) or the other MacBook Pro (Mac15,7), reads INCONCLUSIVE, for every
   gate. Timing conditions are the design's (The reference Macs). The load rule is `docs/parallel-proof.md` 12a's,
   "at or above the cores", not `judgeLimit`'s "above": section 6 has a timed grant wait for a load below the core
   count. The cores are that Mac's 18, as the design and `references` give them, read from `gates.json` and not from
   the machine the tests run on. That Mac is shared with other sessions: its one-minute load stood near 32, above its
   cores, when the redraft was written. A time read at such a load is a reading, its gate INCONCLUSIVE and never a
   pass, while a count or an equality that fails still closes the arm.
4. **"Under", "within", "at most".** Under 1 ms and #337's four limits are strict; within the 4 ms budget and at most
   1 wakeup include the bound.
5. **The handoff's time** is each run's mean over its frames, as the design's 0.7 to 0.9 ms is an average, over at
   least 300 frames a run (the design's floor for a timing run's frames).
6. **Under `canvas-idle`** is that task's own run: a shown window held still for 60 s, five runs, frames a count that
   fails at any load, wakeups the package-idle ones judged as a limit. **The same window** is the same harness binary.
7. **The 4 ms update budget** is read at p99 over a run's updates, by nearest rank, as #358 read it for the design
   ("at worst P99 per update") and #1477's criteria do.
8. **#337's cold-start, idle, memory and size numbers** are the must-haves #337 held gpui-kit to: cold start under
   1 s, idle CPU under 1%, memory under 200 MB and an app under 60 MB, in megabytes of 1,000,000 bytes as #337's
   suite counts them. They are not gpui-kit's own readings (204.7 ms, 0.05%, 51.6 MB, 49.8 MB): the issue measures
   the candidate "against the app's must-haves", and a fallback has to meet them, not beat the toolkit in use.
9. **Paired alternating runs**: five pairs, a run of each arm in each, the arm that starts first alternating from pair
   to pair, both arms on 1,000 rows and one recorded transcript. An arm whose partner keeps no list reading is
   unpaired and INCONCLUSIVE, unless a kept reading closed the partner before it read the list.
10. **A person's gate** is an unblock task (design: Tasks only you can do): the reading says a person took it, and
    holds what the harness and `deep-live` read while they did. With no person it is BLOCKED, naming the task.
11. **Node-for-node** is #338's rule, written again here: the window, then role, name, value and bounds of each node
    in pre-order.
12. **Panel-tree parity**: a panel tree is the panel host's tree for one invalidation (#1425's suite). Parity is the
    shim's tree for `claude-code/main.js` equal to the app's, the text #1425's suite keeps at
    `tests/acceptance/1425/base-trees/claude-code.txt`, read at `base`, trailing white space aside.
13. **An arm's line** names every failed gate, or every undecided one. A failed gate outranks an unrun one.
14. **A failed gate and the test of its criterion**: see "What counts". A criterion whose gate was never read holds
    only on an arm a kept failing reading closes.
15. **A reading through the replica** is one whose `surface` isn't `window`. For retention the kept numbers also tell:
    a run with retention on that drew no view again from its last frame says nothing about retention, which is what
    `render_frame`'s refresh does.
16. **Every carried hunk** is named by the mark it carries: one `{ file, line, issue }` for each
    `DeepBuild patch (windoliver/deepbuild#<n>)` in a file of `vendor/gpui-pre`, `vendor/gpui-pre-apple` or
    `vendor/gpui-pre-macos` at `base`, their `upstream/` folders aside; `git grep -n -o -E 'DeepBuild patch
    \(windoliver/deepbuild#[0-9]+\)' <base> -- <the three trees>` lists them. The lint's own cut needs the pinned
    releases, which a checkout doesn't hold, and every hunk it cuts has one of these marks in it or next to it (#1426).
17. **A recorded journey** is a kept file of steps, cited by the record; its frames are the frames a real window drew
    while it replayed. Byte-equal is the equality of each frame's sha256.
18. **The planted programs of criteria 10 and 11** are builds of the harness. What is kept of each is its run, in the
    gate's own format, and the gate's own check has to fail it: the first naming the view the page was retired under,
    which the record gives; the second by counting fewer command buffers than the process committed.
19. **A ledger that counts every command buffer** is shown against a count taken apart from it, in vsyncs where a
    layer path commits. A reading with no such vsync can't tell the two ledgers apart and reads INCONCLUSIVE.
20. **The two state shapes** are `shared`, rows told by one shared model (one entity holds the rows' state), and `own`,
    rows that each hold what they draw (as many entities as rows). A reading whose `subject` isn't the list is the
    bench whose panels each own their state. The list reading is taken both ways for each shape, as the arm "runs both
    ways".
21. **The label reading** gives, per run, the highest count of views rendered and of elements laid out in a frame, and
    the CPU at p50 and p95.
22. **Nothing added to main** is held as the spike's folder holding the record, the gates, an optional README and the
    cited files, and `spikes/1433/` not existing. **No candidate name** is held as the arm's name and a pin by hash.
23. **The resource lease** is held as each reading's `command` running through `scripts/lease`.

## What could not be held

- That a kept number is what was read: a pixel hash, a frame's sha256, a count of command buffers are the harness's
  word. The tests hold that the record follows from them, that they agree with each other, and that they carry the
  gates, the harness and the machine.
- That a person took a person's gate, and that the lease held, beyond the reading saying so.
- That the harness, the copies with the carry applied, the pin and the mirror exist: they are outside the checkout.
- That the candidate's name is nowhere in the repo: the public text lane holds that for every change.
- That `ships` is the shape the app's list ships in.
- That the issue was read on main as the record's `base` says, beyond `base` being an ancestor of `HEAD`.

## What isn't asserted because no criterion says so

- Any time, size or count beyond the gates' own: no limit on the label reading, the list cells, the journey's length,
  or how many updates or vsyncs a run holds beyond what is written above.
- That the journey touches the `DRAWN` and `SLOT_BOUNDS` tables or a `gpu_view` (Scope, hazards; no criterion).
- How each carried hunk went onto the copies (clean or by hand), and the trial's counts.
- The still window with retention off; the panel in a real window; the spike's two days.

## What the other agent adds outside the folder

Nothing for this suite. One fact of the base to know: `tests/acceptance/1477/record.test.ts` fails once
`docs/spikes/1433/record.json` exists, until `docs/spikes/1477/record.json` cites it by a JSON pointer that names
`gpui-fast` and `list` (#1477's README, "The #1433 citation"). `/arms/gpui-fast/gates/list-transcript/reading` is
such a pointer.
