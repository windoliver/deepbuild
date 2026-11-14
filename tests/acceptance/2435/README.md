# Acceptance tests for #2435: the ray probe that needs no M1

Written first, from issue #2435 (its Scope, five acceptance criteria and Proof line: "The committed report: the two candidate forms' counts, the three build forms' counts out of 100, the tie's hashes and irradiance, and the rebuild and trace timings, with each plant shown failing"), the design sections it names and the base commit `fe5a88f17`, by a job that never saw an implementation. No other branch or worktree was read, and nothing under `spikes/2435/` or `docs/evidence/2435/` was read. Per AGENTS.md (Proof), the implementing agent doesn't edit these files. A dispute goes to a blind redraft of this job (design: Dogfooding).

## What was read

- The issue, live with `gh issue view 2435 --repo windoliver/deepbuild`.
- `docs/technical-design.md`: Ray-traced light, How we know version 0 works (the canvas-module kit's BLOCKED for a probe a backend can't make), the reference Macs and the timing rules under Budgets, Dogfooding. AGENTS.md.
- `docs/canvas-primitives.md`: Light: ray traced, Light and the light policy.
- At the base, for patterns only: `tests/acceptance/245/` (README, helpers, BASE-FAILURE), `spikes/245/` (a standalone probe crate with its own `[workspace]` and Cargo.lock, and `record.mjs`), the machine's GPU lease (`GpuLease` in `crates/deep-show/src/kit/goldens.rs`), and #1115's rule that a skip is unrun, never PASS, and a failure message starting `BLOCKED` or `INCONCLUSIVE` is that state (`tests/acceptance/1115/`, `gh issue view 1115`).
- The pinned wgpu's own sources in the cargo registry, for names only: `wgpu-types 30.0.1` (`Features::EXPERIMENTAL_RAY_QUERY`, `AccelerationStructureFlags::PREFER_FAST_BUILD` and `PREFER_FAST_TRACE`) and `wgpu-core 30.0.1` `src/command/ray_tracing.rs`, which logs "only rebuild is implemented" (top level, warn) and "only rebuild implemented" (bottom level, debug) when asked to update.

## The surfaces (my choice: the issue names a report beside a headless probe, not their places)

```
spikes/2435/Cargo.toml, Cargo.lock   the probe: its own [workspace] and lock, pinning wgpu and wgpu-core 30.0.1
spikes/2435/target/release/spike-2435  the binary `cargo build --release --locked` leaves (target/ is ignored)
spikes/2435/record.json              the committed report: the run of all four parts, and each plant's run
spikes/2435/README.md                a human report, if the probe keeps one (the tests don't read it)
```

### The probe's command line

```sh
spikes/2435/target/release/spike-2435 --part <candidates|build_order|ties|rebuilds|all> [--plant <name>]
```

It runs the part asked for (`all`: the four, in that order) headless on the machine's GPU and prints **one JSON report on stdout**, logs on stderr. It **exits 0 only when the run reads PASS**, and with a non-zero code otherwise. The report:

```jsonc
{
  "issue": 2435,
  "plant": "end_on_failed_candidate",   // the --plant given, or null
  "host": { "model": "Mac17,10", "os": "macOS", "os_build": "…" },   // more fields allowed
  "status": "FAIL",                     // the run: PASS | FAIL | BLOCKED | INVALID | INCONCLUSIVE
  "parts": { "candidates": { "status": "FAIL", "reason": "…", … } }   // each part asked for
}
```

A part's `status` is `PASS`, `FAIL`, `BLOCKED`, `INCONCLUSIVE` or `NOT_RUN`, and any part that isn't PASS carries a `reason` string. The run reads PASS only when every part asked for reads PASS. A part asked for and not run is in `parts` as `NOT_RUN`, and the run is then BLOCKED, INVALID or INCONCLUSIVE, never PASS (invariant 2, #1115).

The plants, each run on its one part:

| `--plant` | With | The planted program | It must read |
|---|---|---|---|
| `end_on_failed_candidate` | `--part candidates` | the traversal ends a ray when a candidate fails its test | part and run FAIL; some form's `misses` > 0, and the part's `reason` names that count (as `12345` or `12,345`) |
| `top_level_first` | `--part build_order` | the builder submits (or records) the top level before the bottom level | part and run FAIL; some form's `sky` > 0; `reason` names `frame 2` |
| `masked_answers_first` | `--part ties` | the build lets the masked quad answer first | part and run FAIL; `irradiance.gpu / irradiance.reference` between 0.4 and 0.6 |
| `no_ray_queries` | `--part all` | the adapter is read as lacking `EXPERIMENTAL_RAY_QUERY` (for example, its features masked before the device is requested) | each of the four parts BLOCKED with `EXPERIMENTAL_RAY_QUERY` in its `reason`; run BLOCKED |
| `skip_rebuilds` | `--part all` | the runner leaves `rebuilds` out | `candidates`, `build_order` and `ties` PASS; `rebuilds` in `parts` as `NOT_RUN`; run BLOCKED, INVALID or INCONCLUSIVE |

Every plant's report echoes its name in `plant` and exits non-zero.

**The GPU lease.** The probe reads the machine's GPU lease where `GpuLease` keeps it: `$HOME/.cache/deepbuild-gpu/lease`, a file holding the holder's PID. When a live process other than the probe holds it, a timed run (`rebuilds`) reads `INCONCLUSIVE` at once, without waiting, with `lease` in its `reason` and no timing: no key ending in `_ms` anywhere in the part holds a number or a `{p50, p95}` with a number. The test points `HOME` at a temporary folder whose lease holds the test's own PID, so no other session's GPU work waits on it. The count parts may wait for the lease as `GpuLease::take` does.

### `spikes/2435/record.json`

```jsonc
{
  "issue": 2435,
  "host": { "model": "Mac17,10", "os": "macOS", "os_build": "27.2 (26B8119)" },  // one of the three reference Macs
  "status": "PASS",
  "parts": {
    "candidates": {
      "status": "PASS", "rays": 1000000, "layer_triangles": 10000,
      "reference": { "floor": 0, "layer": 0 },          // the CPU f64 reference's answers: each > 0, summing to 1,000,000
      "form_for_475": "candidate_loop",                 // or "opaque_restart"
      "forms": {
        "candidate_loop": { "rays": 1000000, "misses": 0, "extra_hits": 0 },
        "opaque_restart": { "rays": 1000000, "misses": 0, "extra_hits": 0 }   // forced opaque, restarting past a failed candidate up to 16 times
      }
    },
    "build_order": {
      "status": "PASS", "runs": 100, "added_frame": 2,
      "form_for_475": "two_command_buffers",            // or "one_build" | "one_encoder"
      "forms": {                                        // the ray through the added mesh at frame 2: hit + sky = 100
        "one_build":           { "runs": 100, "hit": 100, "sky": 0 },
        "one_encoder":         { "runs": 100, "hit": 0,   "sky": 100 },
        "two_command_buffers": { "runs": 100, "hit": 100, "sky": 0 }
      }
    },
    "ties": {
      "status": "PASS", "runs": 10, "rays": 100000,
      "form_for_475": "as_built",                       // or "merge" | "order": the rule #475's scene build takes
      "as_built":  { "hashes": ["<hex>", "… 10"] },     // the pinned layer alone, always reported
      "with_rule": { "hashes": ["<hex>", "… 10"] },     // the rule's runs, when form_for_475 names one
      "irradiance": { "gpu": 0, "reference": 0 }        // the floor's, from the panel: the named form's trace and the CPU reference
    },
    "rebuilds": {
      "status": "PASS", "form_for_475": "fast_build",   // or "fast_trace"
      "frames": 300, "resolution": [1920, 1080],
      "timings": [                                      // six: triangles 10000 | 50000 | 100000 × fast_build | fast_trace
        { "triangles": 10000, "preference": "fast_build",
          "rebuild_ms": { "p50": 0, "p95": 0 }, "trace_ms": { "p50": 0, "p95": 0 } }
      ],
      "update_check": {
        "frame": 2, "rays": 10000,
        "same_as_fresh": 10000,                         // rays that hit against the structure asked to update where a fresh build's do
        "differ_from_frame_1": 0,                       // rays whose answer against frame 1's structure differs from the fresh build's: > 0
        "log": "…only rebuild implemented"              // wgpu-core's own log line, caught when the update was asked
      }
    }
  },
  "plants": {                                           // each plant's stdout report, as the probe printed it
    "end_on_failed_candidate": { … }, "top_level_first": { … }, "masked_answers_first": { … },
    "lease_held": { … },                                // `--part rebuilds` run while another live PID held the lease
    "no_ray_queries": { … }, "skip_rebuilds": { … }
  }
}
```

Other fields (method, date, versions, samples, notes) are allowed and not read. Hashes are hex of at least 64 bits. Timings are milliseconds from GPU timestamps, each with `0 < p50 <= p95`.

## How to run

```sh
node --test --test-concurrency=1 'tests/acceptance/2435/*.test.mjs'
```

One file at a time, as `scripts/affected.mjs` runs node tests, since the live runs share the GPU. Each file builds the probe once (`cargo build --release --locked`; cargo from PATH, `~/.cargo/bin` or `rustup which cargo`), and cargo makes every later build a no-op. The suite runs the probe six times, each plant on its one part: the candidates plant (1,000,000 rays and the CPU reference), the build-order plant, the ties plant, `rebuilds` under a held lease (no timing), `all` without ray queries (nothing traced), and `all` with `rebuilds` skipped (the three count parts once more). It never runs the 300-frame timing; those numbers come from the committed report. Each run has 10 minutes before the test fails it. Quote the glob, so Node expands it rather than the shell.

## Criteria, tests and wrong programs

| Criterion | Test (file) | Wrong program it fails on (each checked against the scratch probe, below) |
|---|---|---|
| AC1: the form named for #475 finds the floor and the layer wherever the CPU reference does, 0 misses and 0 extra hits in 1,000,000; the other form's counts in the report | `ac1-candidates.test.mjs`, first test: reads `parts.candidates` from the report | The named form misses 3 rays. The other form's counts are missing. A record from a Mac that isn't a reference Mac (INVALID) |
| AC1 plant: a traversal that ends a ray at a failed candidate reads misses above 0 and fails, naming the count | `ac1-candidates.test.mjs`, second test: `plants.end_on_failed_candidate` in the report, then the plant live | The plant reads PASS. It reads FAIL with 0 misses. Its reason doesn't name the count. The report doesn't show the plant |
| AC2: the named form draws the added mesh at frame 2 in 100 of 100 runs; each other form counted | `ac2-build-order.test.mjs`, first test | The named form draws it in 99 of 100 |
| AC2 plant: a builder that submits the top level first reads the sky and fails, naming the frame | `ac2-build-order.test.mjs`, second test: report, then live | No form reads the sky. The reason names frame 20, not frame 2 |
| AC3: ten runs give one hash of the 100,000 answers, and the floor's irradiance is within 1% of the CPU reference; where the pinned layer can't, the report says so and names the rule, and passes with it on | `ac3-ties.test.mjs`, first test | The rule's tenth run gives a second hash. The irradiance is 1.3% off |
| AC3 plant: a build that lets the masked quad answer first reads about half the irradiance and fails | `ac3-ties.test.mjs`, second test: report, then live | The plant reads the full irradiance. It reads none |
| AC4: six rebuild and six trace times as p50 and p95; a structure asked to update is rebuilt: 10,000 rays at frame 2 hit where a fresh build's do | `ac4-rebuilds.test.mjs`, first test: reads `parts.rebuilds` from the report | Five timings. 9,990 of 10,000 rays agree with the fresh build. No log line showing an update was asked. A frame-2 pose that moves no answer from frame 1's, so a stale structure would also pass |
| AC4 plant: a run timed while another GPU job holds a lease reads INCONCLUSIVE, never a number | `ac4-rebuilds.test.mjs`, second test: `plants.lease_held` in the report, then live with the lease held | A probe that ignores the lease and reads PASS with timings. One that reads INCONCLUSIVE but still gives a timing |
| AC5: on an adapter without ray queries every part reads BLOCKED with the missing feature named | `ac5-blocked-not-run.test.mjs`, first test: `plants.no_ray_queries`, then live | One part reads PASS. The reasons don't name `EXPERIMENTAL_RAY_QUERY`. A part is missing |
| AC5: a planted runner that skips a part reports it as not run, never as passed (#1115) | `ac5-blocked-not-run.test.mjs`, second test: `plants.skip_rebuilds`, then live | The run reads PASS with a part skipped. The skipped part is dropped from the report. It reads PASS |

A live run that reads BLOCKED or INCONCLUSIVE where a plant had to read FAIL (a GPU without ray queries, say) fails its test with that state first in the message, never as a pass (#1115).

### How I checked the tests can fail and pass

At the base, all 10 fail, each on `BLOCKED: the probe left no report` (`BASE-FAILURE.txt`), run in a scratch tree holding only the base's `spikes/` and this folder.

I wrote no GPU probe. To check the record-reading tests and the harness around the live runs, I built a scratch tree outside this checkout: a record to the shape above and a stub crate that prints canned reports from that record's plants. The stub drew nothing. Its two path crates were named `wgpu` and `wgpu-core` at 30.0.1, only to meet the lock check. It read the lease file as the probe must. All 10 tests passed on it, through the real build (cargo found by `rustup which cargo`), spawn, `HOME` override and exit codes. Then 26 wrong programs, each a change to the record or to one canned report, each failed the test named beside it in the table and no other. The exception is the record from a Mac that isn't a reference Mac, which fails all 10 as INVALID, since every test reads the report first. Three edge cases also read as they should:

- With the record present and no crate, the six live tests read `BLOCKED: no probe crate`.
- A live plant that reads BLOCKED fails as `BLOCKED: …`.
- A lock pinning wgpu 29.0.4 reads `INVALID`.

None of the scratch tree is kept.

**Not run green:** none of the six live checks has run against a real probe on the GPU, because none exists. Whether a real probe meets them on the M5 Max (counts, the plants' readings, the lease, and the run time of the CPU reference) is unproven until the implementation runs this suite.

## Not covered here

- The truth of the report's own numbers beyond what a live run re-reads. The `skip_rebuilds` run reruns `candidates`, `build_order` and `ties` on this Mac and needs each to PASS, so a report whose live counts fail is caught there. The rebuild check and the timings are read from the report alone: the suite doesn't run the 300-frame timing, which would take it past a few minutes. Whether the report's run happened as recorded is for review of its evidence.
- `spikes/2435/README.md` or any human report: not read. The JSON report is the one the tests hold to.
- Timing conditions (mains power, Low Power Mode, thermal state). The issue says the timings are readings that set no budget, so only the host's model (a reference Mac) and macOS build are gated.
- A lease taken partway through a timed run. The test holds it for the whole run.
- Scope lines that aren't criteria: that the probe draws nothing a document names and adds no field; the emulated ray class, the budgets and #250's compute tracer, which the issue leaves out.

## Assumptions a redraft may revisit

- I picked the paths, the command line, the plant names, the field names, the status word `NOT_RUN`, and that the JSON record is the report and holds each plant's run under `plants`.
- "Naming the count" is the miss count, in digits with or without thousands separators. "Naming the frame" is `frame 2` in the reason. "The missing feature named" is wgpu's own name for it, `EXPERIMENTAL_RAY_QUERY`.
- "About half the irradiance" is 0.4 to 0.6 of the CPU reference.
- "A structure asked to update" is evidenced by wgpu-core's own log line (either wording), not by the report's word. The frame-2 pose must move some answers from frame 1's (`differ_from_frame_1` > 0), or the comparison can't tell a rebuilt structure from a stale one.
- From the Scope ("names, for each of the four, the form #475 takes"), `rebuilds` also names a form, `fast_build` or `fast_trace`. `ties` names `as_built`, or the rule as `merge` or `order`, and always reports the pinned layer's own ten hashes, so a named rule shows what the layer gave without it.
- At least 300 timed frames, at 1920×1080.
- A timed run under another job's lease reads INCONCLUSIVE at once rather than waiting. A probe that waits past the test's 10 minutes fails.
- The run's state with a part not run may be BLOCKED, INVALID or INCONCLUSIVE. #1115 would read an unlisted skip as INCONCLUSIVE.
- Any of the design's three reference Macs counts for the report.
