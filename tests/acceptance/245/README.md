# Acceptance tests for #245: the copy-on-write step-block spike

Written first, from issue #245 (its Scope, three acceptance criteria and Proof line: "The recorded numbers, the stored verdict, and the rule's test on the planted records"), the design sections it names and the base commit `6042ef5a`, by a job that never saw an implementation. No other branch or worktree was read, and nothing under `spikes/245/` or `docs/evidence/245/` was read, though an implementation started appearing in this worktree while these were drafted. Per AGENTS.md (Proof), the implementing agent doesn't edit these files. A dispute goes to a blind redraft of this job (design: Dogfooding).

## What was read

- The issue, live with `gh issue view 245 --repo windoliver/deepbuild`.
- `docs/technical-design.md`: The logic module, Step blocks, the reference Macs and the timing rules under Budgets, Dogfooding. AGENTS.md.
- `docs/canvas-primitives.md`: Logic: step blocks (fields, forms, the spike's line, logic threads per class).
- At the base, for patterns only: `tests/acceptance/80/` (a spike whose tests read its record under `spikes/80/`), `tests/acceptance/532/README.md` and `BASE-FAILURE.txt`, and `crates/deep-logic` (its `about` call and the `parallel` field it doesn't build yet).

## The surfaces (my choice: the issue names a stored record and a rule, not their places)

```
spikes/245/record.json   the spike's numbers and verdict, the evidence
spikes/245/rule.mjs      the rule, as a pure function the logic module's build can read
<fixture.path>           the 8,000-agent steering fixture, anywhere in the repo, by hash (#212 reuses it)
```

### `spikes/245/rule.mjs`

An ES module with one named export, `verdict(record)`, returning the string `"copy_on_write"` or `"one_instance"`. It is pure and never throws, and it reads only the fields below. It never reads `record.verdict`, the samples, or the fixture's path or hash. It returns `"copy_on_write"` only when every one of these holds, and `"one_instance"` otherwise, including for `undefined`, `null`, arrays, strings or `{}`:

- `host.model` is a reference Mac: `Mac15,7`, `Mac15,12` or `Mac17,10`. `host.os === "macOS"`, `host.os_build` is a non-empty string, `host.power === "ac"`, `host.low_power_mode === false` and `host.thermal === "nominal"` (design: a timing counts only on one of those machines, on mains power, Low Power Mode off, thermal nominal).
- `fixture.agents === 8000`, `fixture.rate_hz === 60`, `fixture.blocks === 8`.
- `forms.one_instance.threads === 1` and `forms.copy_on_write.threads === 4`.
- For each form, `steps` is an integer of at least 300. `wall_ms.p50` and `wall_ms.p95` are finite numbers with `0 < p50 <= p95`. `overhead_ms.p50` and `overhead_ms.p95` are finite numbers with `0 <= p50 <= p95`. A string such as `"4"` is not a number.
- `copy_on_write.wall_ms.p50 <= 0.5 × one_instance.wall_ms.p50` **and** `copy_on_write.wall_ms.p95 <= 0.5 × one_instance.wall_ms.p95`. Exactly half passes, since the issue says "at most half".
- `copy_on_write.overhead_ms.p95 < 0.3`. Exactly 0.3 ms fails, since the issue says "under".

### `spikes/245/record.json`

```jsonc
{
  "issue": 245,
  "host": { "model": "Mac17,10", "os": "macOS", "os_build": "…", "power": "ac", "low_power_mode": false, "thermal": "nominal" },
  "fixture": { "path": "<repo-relative .wasm or .wat>", "sha256": "<64 hex of that file>", "agents": 8000, "rate_hz": 60, "blocks": 8 },
  "forms": {
    "one_instance":  { "threads": 1, "steps": 600, "deep_hash": "<hex>",
                       "wall_ms":     { "p50": 0, "p95": 0, "samples": [/* one per step */] },
                       "overhead_ms": { "p50": 0, "p95": 0, "samples": [/* one per step */] } },
    "copy_on_write": { "threads": 4, "steps": 600, "deep_hash": "<same hex>", "wall_ms": { … }, "overhead_ms": { … } }
  },
  "verdict": "copy_on_write" | "one_instance"
}
```

Other fields (method, date, versions, notes) are allowed and not read. `wall_ms` is a step's wall time, and `overhead_ms` is that step's mapping and page-fault overhead (for `one_instance`, what it spends restoring slices and scratch and on page faults). Both are in milliseconds, one sample per step, and `p50` and `p95` are the nearest-rank percentiles of those samples (the `ceil(q·n)`-th smallest), so they can be recomputed. `deep_hash` is the full-state hash after the last step. The two forms must match, as the design's "same bits either way" requires.

## How to run

```sh
node --test 'tests/acceptance/245/*.test.mjs'
```

The tests read files only. They build nothing and time nothing, and run in well under a second. Quote the glob, so Node expands it rather than the shell.

## Criteria, tests and wrong programs

| Criterion | Test (file) | Wrong program it fails on (each checked against a scratch spike, below) |
|---|---|---|
| AC1: both forms run the fixture, recording step wall time (p50 and p95) and mapping and page-fault overhead for each | `ac1-record.test.mjs`: the host is a reference Mac under the timing conditions. The fixture's path is in the repo, outside this folder, a `.wasm` (magic bytes) or a `.wat` (`(module`), and its SHA-256 matches, at 8,000 agents, 60 Hz and 8 blocks. Each form has its threads (1 and 4), at least 300 steps, one finite sample per step for wall time (each > 0) and overhead (each ≥ 0), and p50 and p95 equal to the nearest rank of those samples. The two forms ran the same number of steps to the same `deep_hash` | A record from a non-reference Mac, on battery, with Low Power Mode on or not nominal. A fixture edited after it was hashed. A p95 that isn't its samples'. Forms that ended in different bits. A form with no overhead |
| AC2: the stored verdict follows the rule from the recorded numbers | `ac2-verdict.test.mjs`: `verdict` is one of the two strings and equals both this suite's own copy of the rule (`expectedVerdict` in `helpers.mjs`) and `rule.mjs` applied to the stored record. The stored record, with copy_on_write moved to 0.4× and 0.2 ms, gives `copy_on_write`, and at 0.6× or with 0.35 ms gives `one_instance`, with the record's own `verdict` set the other way each time | A stored verdict that disagrees with its numbers, even when a wrong `rule.mjs` agrees with it. A rule that returns the record's `verdict` field |
| AC3: the planted records 0.6× → one_instance, and 0.4× with 0.2 ms → copy_on_write | `ac3-planted.test.mjs`: the issue's two records. Then twins: 0.4× with 0.35 ms → one_instance. Exactly 0.5× → copy_on_write, and 0.5001× → one_instance. Exactly 0.3 ms → one_instance, and 0.299 ms or 0 → copy_on_write. p50 and p95 tested separately, each way. Overhead p50 under the threshold but p95 over it. A record's own `verdict` field contradicting its numbers. Off the reference Mac or its conditions, off the parameters, wrong thread counts, under 300 steps, a form missing, and each of the eight numbers missing, NaN, null or a string → one_instance. Non-records → one_instance. The suite's oracle is checked against the same table | A strict "under half" (`<`). "At most 0.3 ms" (`<=`). Halving only at p50. Overhead judged at p50. Returning the stored verdict. No host check |

### How I checked the tests can pass and fail

At the base, 10 of 11 fail, each on `BLOCKED` (`BASE-FAILURE.txt`). The one that passes checks only this suite's oracle against its planted table. I built a scratch spike outside this checkout: a rule written to the spec above, a record with 600 synthetic samples per form, and a one-line `.wat` fixture. It passed all 11, both with a `copy_on_write` verdict and with copy_on_write's wall time equal to one_instance's and verdict `one_instance`. Each wrong program in the table's third column failed the test named beside it. None of that scratch spike is kept.

## Not covered here

- "The logic module's build reads the verdict", "every class's logic threads read 1" and "nothing in a document changes" are in the issue's Scope but not its acceptance criteria. Neither does the base have the logic module's step blocks (`crates/deep-logic` refuses `parallel`), so no build can be driven to read it. A redraft may add a test once step blocks land (R6).
- The real timing. The tests trust the samples the record holds and check that its summaries and verdict follow from them. Whether the run happened as recorded, on the Mac it names, is for review of the spike's evidence. The design's five-runs-after-warm-up rule for budgets isn't required of the spike's record.
- Whether #212 can reuse the fixture. The test checks only that the fixture is kept in the repo by hash with the issue's parameters.

## Assumptions a redraft may revisit

- I picked the paths, the field names, the units (ms) and the function's name.
- "Step's wall time at most half" is required at both p50 and p95, since the issue names both and says nothing about which one decides. "Overhead stays under 0.3 ms a step" is judged at the per-step p95 (and p50 ≤ p95). A stricter reading would use the maximum.
- Any of the design's three reference Macs counts, and the design's timing conditions (mains power, Low Power Mode off, thermal nominal) are gated. Unlike #80's owner decision, nothing here waives them.
- At least 300 steps per form follows the design's "at least 300 frames" for a p95 over a fixture's run.
- Malformed summaries (p50 above p95, zero wall time, negative overhead) are treated as missing.
- The fixture is a WebAssembly program, `.wasm` or `.wat`, as logic@1 is.
