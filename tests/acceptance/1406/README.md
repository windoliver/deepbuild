# Acceptance tests for #1406: budget failures that pass unseen

Drafted blind from issue #1406, AGENTS.md, the Dogfooding section of `docs/technical-design.md`, and the base commit
`da22dbe4`, where I read `scripts/proof-guard.mjs`, `scripts/affected.mjs` and `scripts/benchmark.mjs`, and
`tests/acceptance/1113/` and `1116/` for the shape of a guard test. Nothing is imported from another suite. Per
AGENTS.md the implementing agent doesn't edit these tests; a dispute goes to a blind redraft by this job.

Run them with:

```sh
npm ci                                   # once, if node_modules is missing (affected.mjs and proof-change.mjs import typescript)
node --test 'tests/acceptance/1406/*.test.mjs'
```

Three tests, offline, on the real `proof.mjs guard`, real git and the real `classify`. About 5 to 15 s.

Each test's name starts with its criterion's ID, `#1406.<first 8 hex digits of the SHA-256 of its "- [ ]" text>`, as
`criterionId` in `scripts/proof-change.mjs` works it out.

| Criterion | Test | What it proves | How it fails on main |
|---|---|---|---|
| AC1 `#1406.9a60feb9` A planted edit of `judgeLimit` is refused without a signed tag | `guard.test.mjs` | In a scratch repo whose main holds the guard and this checkout's `benchmark.mjs`, one unsigned commit makes `judgeLimit` return PASS first thing. `proof.mjs guard` prints a `FAIL guard: scripts/benchmark.mjs:` line and exits non-zero. An edit of `guide.mjs` in the same commit isn't refused, so the guard tells a check from a script that is none. | `LANES_CODE` doesn't match `benchmark.mjs`: `PASS guard`, exit 0. |
| AC2 `#1406.28b2532a` A baseline timing failure below the core count reads FAIL | `classify.test.mjs` | A FAIL on an id in `baseline.timing`, at load 1 (0.5 on one core), lands in `fresh` as FAIL and not in `unsure`. | It lands in `unsure` as INCONCLUSIVE. |
| AC3 `#1406.9024eb9f` The same failure above the core count reads INCONCLUSIVE, naming the load | `classify.test.mjs` | At load cores × 4 it lands in `unsure` as INCONCLUSIVE, not in `fresh`, and its message holds that number. | INCONCLUSIVE, but the message names the machine's own load, so it fails unless that load happens to round to cores × 4. |

## The surface (my choice where the issue leaves it open)

- **The load passed in.** The issue says `classify` is "run at both loads with the load passed in". The base signature is
  `classify(failures, findings, baseline)`, so the load is a fourth positional argument, a number, the one-minute load
  average: `classify(failures, findings, baseline, load)`.
- **The core count** is `os.availableParallelism()`. "Below" is 1, or 0.5 on a one-core machine; "above" is four times
  the cores, so neither is near the boundary and the test doesn't decide what happens at exactly the core count.
- **Naming the load.** The message contains the number passed in, as `toFixed(0)` prints it at the base (`48` on 12
  cores); `48.0` counts too.
- **A failure** is `{ id, state: 'FAIL', message }` and the baseline `{ timing: [id], failures: {}, lint: {} }`, the
  shapes `classify` reads at the base.

## Files

- `guard.test.mjs`: AC1.
- `classify.test.mjs`: AC2 and AC3.
- `BASE-FAILURE.txt`: the run on the base, and a run on a planted right program, both in a scratch copy.

Issue 9406 and the test id `tests/acceptance/9406/…` are made up. No fixture holds a secret or personal data.
