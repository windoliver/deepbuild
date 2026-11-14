# #2236 — merge-conflict resolution (2026-11-11)

Part of #1687. This updates the existing draft PR, not its administrative issue
closure, acceptance status, or merge approval.

Merged main `bd6ed2b7e` into `f8d0cff0a` as `8fba7da2f`, then incorporated main's
new head `85331033b98dd45c8e87d8a951dce96c31f75702`. The textual conflicts were
`packages/hub/src/core.ts` and `packages/extension-host/src/host.ts`; the second
merge conflicted only in Core. Both sides' behavior is retained in the extracted
owners rather than restoring the monolith.

## Requirement → change → proof

| Upstream behavior / refactor constraint | Resolution | Proof and limits |
| --- | --- | --- |
| Multi-file job inputs and 64 MiB output cap | Host accepts `JobBytes`; `JobTools` owns encoding and fixture conversion | Three execution method bodies match main; existing job-counter test passes |
| #2018 names, rename, explanations of session state | `SessionState` owns name maps, title reconciliation, `session.state@2`, rename and `whySeen`; control preserves settled/reflected reads | Five method bodies match main after capability substitutions; verified title-hook statement retained |
| #504 figures explain, never prove | `HubCanvas` owns minted documents, explanation lookup and fault plants; cards/readings consume it | Four method bodies match main after capability substitutions |
| #1945 root plans | Hosts receives upstream append/raw/evidence capabilities; MCP and control dispatch reach its operations | Source/diff review; runtime suite unrun |
| #1331 landing | Core composes Landing; judgement and send-back stay in their owners; forge capabilities remain injected | Judge/send-back bodies match main; dispatch and issue filtering reviewed; runtime suite unrun |
| #2029 coded verdict reasons from the newer main | Applied to `StopJudging`, not Core | `invalid` and `judged` bodies match main; `checks_not_started` argument retained |
| Shutdown and seam ownership | Existing debounce wake/drain unchanged; no whole-Core context or new extension import | Shutdown body parity; first-merge structural/cycle tests below |

The local static comparison checked 16 moved/upstream method bodies, the two
shutdown methods and the coded error call. It passed; syntax parsing and scoped
whitespace checks passed. These are static results, not runtime equivalence.

## Checks actually run

At the first resolved merge, `scripts/affected.mjs` ran the four existing #1687
structural/oracle files and `packages/extension-host/test/job-counters.test.ts`
under a permitted test grant. Result: **26/29 structural tests and 1/1 counter
test passed**. Three AC3 checks are **BLOCKED**: main introduced unclassified
`@deepbuild/checks-host` and `@deepbuild/routing-replay`, and changed computed
loader/provenance inputs (Host, Core, plant and server). Frozen reviews and tests
were not rewritten or weakened. Independent review remains necessary.

The complete affected invocation reported:

```text
FAIL affected: 165 new, 11 already failing on main, 3 inconclusive or blocked,
0 listed skips, 27 passed
```

“New” is relative to the committed known-failure table, not an attribution to
this merge. It includes repository-wide dependency, vendor, size, canvas and
conformance findings; no baseline run established attribution. The source-path
selection listed 338 parallel Vitest, 15 Node, 666 alone, 69 timed and 32 slow
files plus `deep-app`. That broad selection was **not run**. Neither the source
selection nor the focused invocation emitted a WIDE line.

Both bounded TypeScript-build attempts (one for each merge target) ended without
execution: `INCONCLUSIVE no grant: no build grant came within 1 min`. The final
main follow-up has static parity only, not a fresh runtime test pass. Its affected
selection attempt also timed out under machine contention. Full affected/base
comparison, native runtime suites, fault-overlay refresh and preflight remain
unrun. Historical 29/29 and 7/7 results belong to the pre-merge snapshot, not this
head. Repository-wide whitespace checking also finds upstream terminal-recording
fixtures and acceptance evidence; those bytes were preserved unchanged.

Local receipts: `/tmp/deep-1687-merge-{parity,latest-parity,build,latest-build,affected}.log`
and corresponding `.exit` files; test reports in the affected run's
`deep-affected-4VMVZk/{node,vitest}.jsonl`. No acceptance checks, known-failure
entries, approvals or scheduler settings were edited to resolve these conflicts.
