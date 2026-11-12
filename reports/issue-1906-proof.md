# #1906: helper folds — partial proof, not a closing claim

Part of #1906. Base: `331b68be1f25104d39a3d9800eed4e2983da9af5`. The PR is draft: the remaining scope decisions and checks below are not waived.

## Requirement → change → proof

| Requirement | Change | Evidence / limit |
|---|---|---|
| AC1: core.ts is shorter, with one forge default and one done.yaml reader | One initialized forge URL and one reader; raw callback reuse; five session appends and three Answers forwarders folded | `core.ts`: **8666 → 8645** lines. Both source assertions fail on base and pass unchanged on work. The audit's keyOf copy was already gone. |
| AC2: one shell quote, duration and listener probe | Hub shell quoting has one owner, including inline callers; m/h/d use asks.duration, with channel-only seconds preserved; supervisor owns the listener probe | Three source assertions fail on base and pass unchanged on work. Malformed nonempty lsof output remains insufficient proof of a free port. |
| AC3: every core child in children.ts's table at exit; two named forks fail on base | OpenItems' Git reads and SizeScope's accepted-history read go through children.ts | Two module-level assertions and three real-hub assertions fail on base and pass unchanged on work. **The universal/exit clause is not proven**: see decisions below. |
| AC4: unchanged covering suites and package type-checks | Existing tests are unchanged. Type guards preserve their unknown/JSON narrowing; HTTP sharing preserves redirects, caps, CONNECT behavior and refusal wording | Workspace build passes. Selected comparison: **188 pass, 1 platform skip, 1 environment-blocked assertion on both base and work**, identical outcomes across 20 unchanged files. This is not full affected-suite equivalence. |
| Extension host folds | Work/library call lifetime, approval waits, bounded HTTP | `host.ts`: **4299 → 4269** lines. Existing host/source/asset/approval tests pass; the declined-update close race has additional regression proof. |

The shared helpers belong to existing owners: contract object guards, asks' duration parser, supervisor process observation, hub shell arguments and durable writes. No new core service or dependency is added. The hub's runtime import graph has no cycle. No check, golden, known-failure entry, setting or workflow was changed.

## Recorded local checks

- `npm run build --workspaces`: **exit 0**, on base and work. After review corrections, the affected supervisor/env-local/hub and extension-host builds also exit 0.
- `node scripts/affected.mjs tests/acceptance/1906/children.test.ts tests/acceptance/1906/sources.test.ts`: test block **8/8 pass**. Base: **7 expected failures, 1 guard pass**.
- `node scripts/affected.mjs tests/acceptance/1906/ownership/forks.test.ts`: test block **3/3 pass**. The blind real-hub base run fails all three routing assertions after recording the expected placeholder items and usual change size.
- The selected unchanged comparison uses `affected.mjs`'s `select`/`plan`, the repo's unchanged Vitest reporter and test throttle. It runs the same 20 files once on each side, sequentially; only four files initially blocked by a missing deep-hook were rerun after that prerequisite was built. Outcomes match exactly: 188 passed, one Secret Service platform skip, one canvas-dependent failure. This bounded comparison is **not** a substitute for the full affected selection.
- Review regression proof: unreadable listener output, declined-update/host-close race, and invalid child arguments pass on base, fail against the earlier refactor for their named reason, then pass unchanged after correction. Four assertions, all green in the final targeted affected test blocks.
- Correction checks: listener callers plus source acceptance **58/58**; approval regression plus #139 **5/5**; invalid-argument tests **2/2**; child acceptance plus scope regression **7/7**.
- `git diff --check`: passes. Frozen acceptance files are byte-identical to the independent authors' submitted files.

### Affected runner is not green

The final targeted affected run reports:

```
FAIL affected: 156 new, 11 already failing on main, 0 inconclusive or blocked, 0 listed skips, 4 passed
```

These are repo lint findings, not four failed regression assertions. Many exist on the base (dependency allowlist, cards, slots, closures and record-reader findings), and others were unrun in the original base attempt. They are **not all classified as inherited** without a complete matching base run. Notably:

- `core.ts` exceeds the inherited 8263-line ceiling, even after shrinking to 8645; this change does not silently raise it.
- `host.ts` shrank below its recorded 4298 ceiling, so the ratchet requests 4269. No check definition was changed without approval; that update remains outstanding.
- The server exceeds the default file-size ceiling on the base too.

The completed focused runs print **no WIDE or INCONCLUSIVE lines**. Earlier attempts did report no-grant INCONCLUSIVE jobs, retained in the local logs. Full changed-path selection was listed, not executed: **625 parallel Vitest files, 124 node files, 755 alone Vitest files, 92 timed files, 39 slow files, `deep-app` and `deep-logic`, and 83 hand/lane skips**. It prints no WIDE line and notes that `children-worker.ts` has no statically detected test; the real-hub test does execute it. Nothing in that unrun selection passes by implication. No full preflight was run.

### Environment and evidence provenance

The missing deep-hook was built in the independent base checkout. All 24 local crate/workspace/toolchain inputs match both comparison checkouts byte-for-byte; the same binary was copied to each ignored target folder (SHA-256 `c2a09504d24d1d4e8cbcdb13609d9657f0b463a76c9dca48a493a5452df7bb1f`). It is not a stub.

The remaining #1731 fetch assertion needs `deep-show`: its saved `deep show --check --json` reply says no canvas core is built. That assertion fails identically on both sides; it is not reported PASS. The platform skip is the Linux Secret Service test on macOS.

Raw local logs and exact command/report hashes are retained under `/private/tmp/deep-1906-proof/`, not checked in because raw output includes local paths. Key files: `resume-build.log`, `resume-acceptance-affected.log`, `ownership-base.log`, `ownership-work-affected.log`, `regression-comparison.json`, `hook-provenance.json`, `listener-draft-red.log`, `listener-fix-tests.log`, `update-close-red-assertion.log`, `update-close-green.log`, `children-arguments-{base,red,green}.log`, and `final-targeted-affected.log`.

The original acceptance author had build/grant setup failures. The supplemental author corrected a hook-fixture UUID/ULID setup error before submitting; the final base failures are on the routing assertions. The implementer's new update-close regression initially had an invalid provider namespace (also failing on base); its corrected, frozen fixture subsequently failed at the close-race assertion and passes on base/fix. These setup runs are retained and are not counted as repeated proof. Only processes started by this task were stopped, by PID. Other worktrees and their jobs were left alone.

## Decisions and work still open

1. **Liveness:** both current helpers already return alive on EPERM and gone on ESRCH. For other thrown errors the terminal helper says gone while supervisor says alive. Folding them changes a socketless terminal tab's `ended` state. The owner has been asked whether to use the supervisor's conservative rule; no answer is assumed, and the helper is not folded.
2. **Child ownership:** the base has a private `waiting` map of jobs, not PIDs, and no child-table behavior at hub exit. “At exit” could mean the child's completion or a new hub-shutdown policy. The independent author confirms the issue/design does not decide it. Other direct core-thread starts remain (including gate.measure); the universal criterion is not narrowed to the two named forks without approval.
3. **No-visible-change proof:** full affected coverage, timed/slow/platform checks, the canvas-binary-dependent case, and repo lint/ratchet findings remain open. Shared durable writes intentionally add fsync behavior; their I/O-failure and latency effects are not proven equivalent.
4. **Dependency:** #1687 is open, and PR #2236 is unmerged. This draft does not claim that the seam refactor is complete.

## Size and delivery deviation

The issue asks for small PRs by file group. This is one draft review branch at the user's request, with separate test-first and file-group commits. Production changes total about 482 changed lines, mostly deletion/replacement of copies; independent acceptance adds 540 lines including its fixture/docs/config, and review regressions add 72. It can and should be split by file group before ready-to-merge delivery if the reviewer requires it. No exception is inferred from a passing subset, and no `Closes #1906` claim is justified yet.
