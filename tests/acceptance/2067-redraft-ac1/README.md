# #2067 AC1 — blind redraft

Inputs: `../issue.json`, `docs/technical-design.md`, `AGENTS.md`, and pristine base
`1c4d1f0e2aaad8c6a6573848823566d04ff73d17`. No implementation, other worktree,
other #2067 draft, or dispute was read. The implementer must not edit this test.

Criterion tag: **AC1 #2067.97392e0a** (the issue's full criterion, trimmed and
whitespace-collapsed, SHA-256 prefix as `scripts/proof-change.mjs` computes it).

## Assertion → criterion → proof

One test, `trunk.test.ts`, enters through real `deep hub run`, Claude Code hooks
through `deep-hook`, `.deepbuild/done.yaml`, and the socket's `events.read`.
It reuses #325's fixture helpers and release-check fixture, not its assertions.

| Assertion | Contract basis |
|---|---|
| Fixture has no local `main`/`master`; recorded `origin/HEAD` points to `trunk` | AC1's trunk repo and issue Scope's last-fetched remote default branch |
| Fixture preflight exits 0 on trunk and PR head separately, 1 with `ERR_ASSERTION` on their conflict-free merge | AC1's “preflight that fails on the merge”; rules out inherited failure or broken setup |
| PR claim outcome is `FAIL` | AC1's “a claim on a pull request is FAIL on preflight” |
| Verdict reasons name `preflight` | Same phrase; design “How runs become one of five verdicts”, failing check named |
| A recorded `preflight` run fails | AC1 requires release execution, not an omitted check; design “Done means switched on” |
| `gh pr create … --body "Closes #9"` is denied | AC1's “Closes is refused”; design “At the claim” |
| Refusal names `preflight` | AC1's “naming it” |

The last five `expect.soft` calls are the criterion assertions. All five are
observed in one scenario before returning failure. Other assertions qualify the
fixture: definition locked, hooks usable, ordinary checks green, commit allowed,
PR opened with `Part of`, preflight premises valid, and a judged PR claim available.
A no-op hub cannot satisfy these premises or the criterion assertions.

The fixture has a local bare remote, fetched once during setup; no network fetch
or real GitHub write occurs. The agent and GitHub responses are external-boundary
stand-ins. The automatic PR review uses the base's #1537 fake reviewer configured
with no findings, as #1523 does, with a synthetic sign-in and plan-window reading.
The real review gate, runner, command checks, record and hooks remain active.
No hooks are installed in repository settings. Processes and short socket paths
are managed by #325's existing fixture cleanup, by owned PID only.

## What is not specified or asserted

AC1 does not prescribe exact diagnostic prose beyond naming `preflight`, a new
RPC, release-check ID format, merge commit hash/parent order, retry timing, or a
particular internal resolver. This test invents none. It reads the existing
public event fields and helper conventions. It does not require a particular
hook exit code when the existing adapter's decision is denial. No private product
module is imported. The fixture's independent merge probes are setup qualification,
not substitutes for a gate-recorded release run.

Only AC1 is covered. No unresolved-main-line, undefined-check, local-main cache
or once-per-head twin is added (AC2–AC4). There is no fixed implementation tested.

## Actual base runs

Run through the mandated entry, Node **24.22.0**, Rust **1.99.1**, using the supplied
base-built dist and deep-hook without rebuilding:

```sh
node scripts/affected.mjs tests/acceptance/2067-redraft-ac1/trunk.test.ts
```

1. Initial run: test failed all five criterion assertions in **16.50 s**. The PR
   claim was `BLOCKED` by the automatic review's missing external reviewer; release
   runs were absent and Closes was allowed. `base-first-run.txt` preserves it and
   the initial test hash. This prompted one fixture correction, not an expectation
   change: install the existing fake reviewer and its synthetic account/window.
2. Corrected run: **1 test, 1 failed, 5 assertion failures**, **15.62 s**. Setup and
   controls completed; no timeout. The trunk PR claim was **PASS**, with unit,
   drafted requirement and review PASS; **0 preflight runs in the record**;
   **Closes allowed**, empty refusal reason, both mocked forge effects reached.
   All five failures name **preflight**. `base-run.txt` preserves the scrubbed
   observation and assertion output. Expectations are unchanged from run 1.

The corrected affected command exited **1**, reporting **173 new findings**
(1 acceptance failure plus 172 unrelated base lint findings), **11 known**,
**0 inconclusive/blocked**, **0 listed skips**, **0 passed**, **23 s**, load **292**.
`base-affected.txt` preserves that output. **No WIDE or INCONCLUSIVE lines** were
emitted. This is a functional test, not a timing measurement.

**Lease limitation:** affected used its normal throttle and `scripts/lease`; the
outer lease reported “no hub token” and used its documented unleased fallback.
No bypass was requested. The fixture hub's real runner/leases were retained.
No settings or baseline were changed to repair this environmental limitation.
Unrelated lint findings were not changed or retried. No full preflight, separate
typecheck, AC2–AC4, or post-implementation run was performed.

`input-hashes.txt` identifies the inputs, reused support and supplied runtime
entries/dist-tree manifest. `SHA256SUMS` identifies the delivered files. Evidence
replaces host paths with placeholders; all remaining session/record IDs are
synthetic fixture IDs. Final review: only this directory is added; product code,
checks, settings, baselines, decisions and other tests are unchanged. No commit.
