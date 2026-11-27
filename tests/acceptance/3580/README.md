# Acceptance tests for #3580: a test request its own rule holds back doesn't hold back the run requests behind it

A blind job wrote these tests before any fix existed, from issue #3580 (its text on 2026-11-26), `docs/parallel-proof.md`
section 6, the Dogfooding part of `docs/technical-design.md`, AGENTS.md and base commit `b134dd38f`. At the base it read
`scripts/throttle.mjs` to learn the surfaces driven here, and the suites `2902/`, `3221/`, `2744/` and
`2744-redraft-2833/` for style and helpers. The implementing agent doesn't edit these files (AGENTS.md, Proof); a
dispute goes to a blind redraft by this job.

Run them (they must run under `node --test`: only inside a test run does a table of a test's own, and its readings,
exist; section 6):

```sh
node --test tests/acceptance/3580/*.test.mjs
```

**No test reads or writes the live table at `~/.deepbuild/throttle/`.** The suite reuses #2744's sandbox
(`../2744/helpers.mjs`, unchanged): every `throttle.mjs` process gets `DEEP_THROTTLE_TABLE` pointed at a fresh folder
of the test's own and a temporary `HOME`, runs in its own process group with a stub command that holds its grant until
the test writes its stop file, and after the test each group is stopped by its PID. Nothing is stopped by name or port.
It also reuses #2902's reads of the sandbox's `table.json` and #2833's reading of the test limit from the `LIMITS` line.

## The surface

- **Readings**: `DEEP_THROTTLE_READINGS` names a file the test writes whole: `{"load": 25, "cores": 20, "memory":
  100 GiB}`, the issue's Spark readings, then `load` 10. The machine's own cores and load decide nothing.
- **A held grant** is a real `node scripts/throttle.mjs test --wait 10 -- node stub.mjs holder`, whose stub notes its
  start with the `DEEP_THROTTLE` it was given.
- **A plain request** is the same command; **a run request** is it with `DEEP_THROTTLE_RUN=0`, as `affected.mjs`
  asks (section 6, #3221); **a timed request** is `throttle.mjs timed --wait 10 -- ...`.
- **Waiting** is read from the table (`requests`, by the requesting process's pid) and the absence of the stub's start
  note; **granted** is the stub's start note under a `test:<id>` grant.
- **The log** is `<table folder>/log`, JSON lines. AC4 reads only what the issue names: a line that names the passed
  over request (its pid, or its request ID as the table shows it, as any value in the line) and the run request granted
  past it (its pid or ID), and holds the text `load 25.0 ≥ 20 cores`. No field name is assumed.

The ceiling is the platform's test limit (2 on macOS, 6 on Linux at the base), enough for one held grant and one more.
A run admitted on memory counts each held grant younger than 5 minutes as a run's memory still to come (24 GiB on
Linux, 8 GiB on macOS at the base): with 100 GiB, the run in AC1 is admitted beside one held grant either way (100 − 24
≥ 24; 100 − 8 ≥ 8).

## Criteria

All four are in `order.test.mjs`. Each starts the same way: readings of load 25 on 20 cores and 100 GiB, one test
grant held (the first grant always starts), then a plain request queued and seen waiting in the table.

| Criterion | Test | What it checks | Wrong program it catches |
|---|---|---|---|
| AC1 | `#3580.54cd2bff` | A run request queued behind the plain one is granted within 60 s; then, within a further 3 s, the plain one is still not granted and still waits in the table. | The base: `grantable()` serves strictly in order, so the run request waits behind the plain one and neither is granted. |
| AC2 | `#3580.bd6fae70` | Run requests queue behind the plain one one at a time; each the readings admit is granted (within 3 s), until one waits: the line is then full by the ceiling (macOS: after one) or by memory (Linux: after three). The readings drop to load 10, then the first held grant gives its slot back: the plain request is granted within 60 s, and the waiting run request, queued after it, was not granted before it. | A planted throttle that lets run requests overtake a plain one for good (for example, one that serves every run request ahead of every plain one): the freed slot goes to the run request and the plain one isn't granted. The base passes. |
| AC3 | `#3580.00ead7ac` | A timed request queues (it waits on the held grant), then a run request: within 3 s nothing is granted past the plain request, the plain one isn't granted, and the timed and run requests both still wait in the table. | A planted pass-over that ignores the drain: the run request is granted past the plain one while the timed request waits. The base passes (it grants nothing past the head). |
| AC4 | `#3580.4b48c6a9` | After a run request is queued behind the plain one and given up to 60 s to be granted, then 3 s more, the log has exactly one line naming the plain request, the run request, and `load 25.0 ≥ 20 cores`. | The base: no pass-over, so no such line. Also a throttle that writes no line, one without the rule, or one at every look (more than one line). |

The fixed waits are only bounded negatives, each with a `// deadline:` reason: 3 s (about 15 of the throttle's 200 ms
polls) for "keeps waiting", "nothing is granted past it" and "one line, not one per look". Every positive step waits on
the stub's start note or the table, bounded at 60 s. Nothing waits for the machine's load.

The issue's second scope point (a plain request passed over is never starved: say how it gets in) names no bound, so no
test pins one. AC2 assumes the implementation's bound is longer than the few seconds its run requests queue past the
plain one; with a shorter bound AC2 still passes (none passes it, and it is granted once the slot frees).

## At the base

`BASE-FAILURE.txt` is the base's output on macOS (Darwin arm64, node 24, machine load about 37, which decides nothing
here): `#3580.54cd2bff` fails because the run request isn't granted within 60 s, waiting behind the plain request at
the head of the line; `#3580.4b48c6a9` fails because the log has no line naming the passed-over plain request, the run
request and the rule (the run request is never granted). `#3580.bd6fae70` and `#3580.00ead7ac` pass at the base, as
expected: the base keeps the order and the drain; each fails on the planted wrong program named above, which the
implementer writes as a twin.

Not run here: Linux (the Spark), where AC2's line fills by memory after three run requests rather than by the ceiling.

To check that the tests can pass and that each wrong program fails at its assertion, this job ran them once against scratch copies of `throttle.mjs` outside the repo (a pass-over sketch, and the three wrong programs above on it); none is committed, and none is the implementation.
