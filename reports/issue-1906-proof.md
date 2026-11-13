# #1906: final folds and ownership proof

**PR #2322 — implementation and functional comparison complete; independent loader-review gate still BLOCKED.**

Tested base: `81a5a9b2f63f09c4e9c6777b4ce174541ab6a300`. Tested implementation: `040e6aa6f2543c28ab82e9ae5a7e6da2c08df89b`. Node 24.22.2, macOS arm64. The branch incorporates the landed #1687 seams and #2070 binding fix and is mergeable. No acceptance test, golden or known-failure baseline differs from that main revision except the independently authored additions under `tests/acceptance/1906/`.

[Machine-readable results](issue-1906-results.json) bind the source and test bytes, exact comparison files, report hashes, counts and non-passing checks. They are observations, not a whole-repository PASS. Earlier claims about private `spawn_sync` use, an open #1687 dependency, or inherited failure counts alone preventing closure are superseded by this report.

## Requirement → change → proof

| Requirement | Change | Actual proof |
|---|---|---|
| AC1: shorter core; one forge default and one done.yaml reader | Core resolves the forge once; its reader is passed to MCP, stop judging and canvas domains. Raw callbacks and append envelopes share owners; `Answers` forwarders are removed and the landed settings seam already uses `statKey`. | Both source assertions fail on the new base and pass unchanged on work. Core **2641 → 2639** lines; host **3225 → 3201**. Both ceilings tightened. Before the seam merge, the same folds reduced core **8818 → 8797** and host **4299 → 4269**. |
| AC2: one shell quote, duration and listener probe | Shared shell quote; asks' lightweight duration public entry; channel seconds retained; supervisor listener observation preserves empty-versus-unreadable results. | All three source assertions fail on base and pass on work. Real apostrophe-path hook tests, duration properties and listener regressions pass. |
| AC3: every core child owned at exit, including the two named forks | Named git calls use the children worker. Diagnostics retain asynchronous child objects through exit; public Node sync APIs retain each invocation through completion. Both workers load the owner. | **13 behavioral ownership assertions fail on base and pass unchanged on work**, plus the oracle control passes on both. Includes real hub routing, indirect gate starts, Box/service calls, and **two 1,000-case properties, seed 1906**. |
| AC4: no visible change; covering suites unchanged and package types pass | Behavior-preserving folds, native compatibility corrections, and startup-import correction; folds retained through the landed seams. | **52 unchanged files: 358 PASS/PASS, zero changed outcomes, one SKIP/SKIP**. Every package type-check passes; exact hook/show builds and both acceptance tsconfigs pass. The separate frozen loader-review gate below remains BLOCKED; it is not included in the passing count or waived. |

Across the five frozen #1906 files, current base has **18 expected failures / 1 oracle-control pass**; work has **19 passes**. The source reader assertion fails on the new base because #1687 moved its readers out of core; work provides the single core reader the issue requires. The behavioral reds reach real assertions, not missing builds or failed setup.

## Changed-behavior comparison

The plan was fixed from the changed behaviors, not chosen by passing outcomes. Every compared file is byte-identical between base and work. Both sides ran every file serially, with the repository's unmodified reporters. `affected.mjs` supplied selection/classification; the few acceptance suites requiring `--testTimeout=600000` used their own README command on both sides. No assertion deadline changed.

| Fold / regression protection | Covering files and checks |
|---|---|
| Object guards and schemas | Contracts/envelope tests; added 1,000-value object-guard property. Array-accepting mutant fails. Guard-only import substitutions were also compared after AST normalization. |
| Record callbacks, session appends and answers | Answers, answer-after-restart, threads, session-states, numbers, past-sessions, gone-watch, scope, reading, and #331 child tests. Queries retain parameters and caller binding; append envelopes retain session/agent/subject/time/ID. |
| Forge, spec and shell callers | Forge, github-source, hook-parent, codex-files, hook-programs, hosts, install, codes, gate-queue, products-start, and done-reader regression. Present/missing/malformed done specs retain MCP refusals; an empty-reader mutant fails the required `unit` result. |
| Durations, environment and liveness | Staging, asks/timing, env-local, stack-provider, leftover, teardowns; supervisor process-error/readings checks; #989 terminal version cases. Added properties retain m/h/d, seconds only for channels, and each caller's previous unknown-OS-error policy. |
| Source calls, approvals and HTTP | Host/sources/asset probe/range/quota, all five #1731 files, #139 prices, update-close/default and fetch-fold. Approve-on-default and redirect-follow mutants fail. CONNECT is not converted into an asset probe; cap/redirect/error wording stays unchanged. |
| Ownership and startup integration | Start-ps, startup-memory, #323 todos, #65 routes, #2070 binding and the real #1687 loader-boundary cases. Native parity covers overloads, outputs/errors, stderr, metadata, getters, constructors, ignored arguments, permission/deprecation modes and failed spawns. |

The single skip is `sources.test.ts`'s **Linux Secret Service** integration on macOS. It was skipped identically on base and work, is not PASS, and does not exercise a changed transport/liveness path. No Linux-platform or timing-budget claim is made.

The final focused `affected.mjs` run reports **48 passing tests**: 36 Vitest assertions across 14 files and 12 Node assertions across nine files. These include all frozen acceptance and added regressions, not an alternative to the matched comparison.

### A real regression found and fixed

The first complete pre-integration comparison caught `startup-memory.test.ts`: importing `duration` from the asks package root also loaded the record store into the hub's event-loop thread. A lightweight public `@deepbuild/asks/duration` entry fixed it. The existing test then passed unchanged. The final 52-file comparison passes startup on both sides. #1687 already supplies the extracted parser; this branch reuses it, without a duplicate implementation or private package import.

Sync ownership now uses captured **public `spawnSync`**, not `process.binding`. The receiving file keeps Node's MIT license notice for its normalization/error handling. Compatibility tests are evidence for Node 24.22.2, not a guarantee about future Node implementations. No new shutdown-kill policy, dependency or user setting was added.

## Non-passing checks — not waived

### Frozen computed-loader review: needs its check owner

The unchanged #1687 structural/oracle run reports **19 pass / 2 fail on both base and work**. Actual runtime/type-inclusive cycle checks, the absolute core-to-extension boundary, and ownership/method-length assertions pass. Two completeness assertions reject stale reviewed-source fingerprints:

- Main already differs from its reviewed `plant`, core, server, core-worker and search inputs.
- This branch additionally changes the **whole Host class/file** fingerprints, although its loader and placement implementation is unchanged.
- Normalized AST hashes for `Host.start`, `runTests`, `hubBound`, `sandboxed`, `load` and `check` match the pinned base exactly; the hashes are in the results JSON.
- The real released/sandboxed loader-boundary tests pass **3/3 on both sides**, including the planted wrong placement. They do **not** override the frozen completeness check.

The review table explicitly requires independent review before a trust-chain source fingerprint changes. This agent has not refreshed it, edited the assertions or fabricated an approval. **That precise review gate remains BLOCKED.** A passing functional comparison is not permission to re-record it. PR #2322 retains `Part of #1906` until this requirement is resolved through the approved check-owner process.

**Proposed next human action:** authorize the independent check owner to review the exact `81a5a9b2f → 040e6aa6f` loader/placement provenance and the already-stale main inputs. Any approved fingerprint update must be separate, leave the behavioral/cycle/boundary assertions intact, and retain these failing results. Repository signature requirements still apply; broad message approval is not a signed tag.

### Repository lints

The final focused runner's actual verdict is:

```text
FAIL affected: 166 new, 11 already failing on main,
0 inconclusive or blocked, 0 listed skips, 48 passed
```

Of its 166 “new” lint keys, **165 exactly match the independently executed pinned-main lint sweep**. The remaining key is interleaved output from the two canvas-closures commands sharing a log filename; pinned main also fails the same Map-projections drift. No new behavior failure appears in this run. No core/host ceiling violation remains after the seam integration. The full lint verdict remains FAIL, not PASS or an edited baseline. This inheritance comparison does not make the completed functional comparison incomplete; the specific review lock above is the remaining approval requirement.

There are **no WIDE or INCONCLUSIVE lines in the completed focused run**. The full production-path `affected --list` inventory is retained separately; it is not an execution result. The broader timed, slow, manual/platform and Rust selections have not all been rerun on this head. No full preflight or release/timing PASS is claimed.

## Build and evidence provenance

- Base `npm run build --workspaces`: exit 0. On merged work, the first full build exposed only hub/CLI merge-resolution type errors; corrected hub and CLI builds both exit 0, retaining the other packages' successful results from that full attempt. No failed type check is hidden.
- `cargo build --locked -p deep-hook -p deep-show -j 2`: exit 0 independently at each side's own path. Relocated caches were revalidated, not treated as provenance.
- `tsc -p tests/acceptance/1906/{exit,ownership}/tsconfig.json`: both exit 0 on final work.
- `git diff --check 81a5a9b2f..040e6aa6f`: clean. Incoming main has whitespace in old acceptance evidence; it was retained unchanged, not “cleaned up” by editing frozen files.
- All 13 frozen #1906 files retain their authors' bytes. No production import cycle or core-to-extension edge was introduced. Review prose is advisory, never a check result.

Raw logs are retained locally under `/private/tmp/deep-1906-proof/`; paths and fixture process identities are not copied into committed evidence:

- `seams-{base,work}-jobs.json`, per-file `.jsonl`/`.log`, `seams-final-comparison.json`, `seams-selected.json`, `seams-selected-run.mjs`.
- `seams-base-1906.{log,jsonl}`, `seams-final-affected.log`, `seams-proof-jobs.json`, final acceptance typecheck logs.
- `seams-base-build.log`, `seams-work-build-first.log`, `seams-hub-cli-build-corrected.log`, `seams-builds.json`, both Rust build logs.
- `seams-base-lints.json`, `seams-lint-comparison.json`, `seams-base-structure.{log,jsonl}`, `seams-production-selection.log`.
- The completed final affected report directory is named in `seams-final-affected.log`; the interrupted structure wrapper's completed test reports are retained separately. Its unfinished lint wrapper is INCONCLUSIVE, not a completed affected verdict.

## Deviations and earlier attempts

Before the long-held timed grant cleared, some short native probes, TypeScript checks and pre-integration workspace/Rust builds ran through `scripts/lease` **without a throttle grant**. That was a scheduling deviation after hours waiting, not timing proof or an explicit scheduler-policy approval. Final merged-base/work builds and tests used the throttle. The lease script reports no hub token, so none is claimed as cpu.slot-leased. No other session's job/grant was stopped or altered; no CI was added or dispatched.

The first done-reader mutant was invalid because a concurrent rebuild temporarily left no hook binary; the next failed in cleanup. Both are retained. A diagnostic-only inspector run exposed the intended unchanged assertion: a present spec must name `unit`, not “it names none”. The update-default mutant installs the unwanted version and fails the exact keep-version assertion. An earlier asks/timing invocation omitted its report destination: its assertions passed but the runner failed; the corrected reporter setup is logged separately. No test expectation changed for these corrections.

Earlier broad attempts on `bcd02c238` recorded partial base **5619 pass / 1063 fail / 436 skip**, work **934 pass / 238 fail / 4 skip**, with missing grants and an inherited Rust acceptance compile error. They remain partial, not a suite verdict or equivalence proof. They are not substituted for the completed matched comparison here.

The production delta against the integrated base is **377 added / 316 removed lines**, including license notice and wiring. The larger PR consists primarily of independent acceptance/properties and test-first regression evidence. It remains one issue/PR as requested. The core owns its process boundary and shared read/wiring capabilities; an extension cannot observe starts before it loads or every indirect core start, and does not own these cross-domain dependencies.
