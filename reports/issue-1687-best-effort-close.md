# #1687 — user-directed best-effort tracker closure

The person explicitly requested a bounded best-effort finish and closure even if
all remaining gaps could not be resolved, with no more hour-long waits or approval
questions. This records an **administrative tracker closure**, not an acceptance
PASS, a merge approval, or a claim that all of #1687 is proven.

## Implemented and established

- Hub, extension-host and asks logic is split into the documented owned seams.
- Core has no direct, transitive or type-only concrete-extension dependency.
- The approved synchronous outer factory is shared by production and #822 setup;
  all 21 assertions and seven complete deadline cases remain unchanged.
- The final structural/oracle suite passed 29/29; the final #822 real runtime
  suite passed 7/7. Core method bodies remain at most 95 lines.
- 17/19 original overlays have compiling formal criterion-failure proof. The #18
  overlay additionally compiles and fails the explicit unchanged criterion
  validator on the expected session disclosure, with both clean cases passing;
  automated assertion classification remains unproven because it throws Error.
- Detailed snapshots, comparisons, failed attempts and limits are retained in
  `issue-1687-core-seams.md`, `issue-1687-twin-proof.json`, and the approved check
  change/provenance records. No failing check was weakened to close the tracker.

## Bounded final attempt

The prepared clean and wrong #21 snapshots both had successful TypeScript and
release-hook builds. A new timed request used `--wait 1`, not another 60-minute
wait. It returned exit 3:

```text
INCONCLUSIVE no grant: no timed grant came within 1 min
```

No replay test executed in that attempt. The previous unavailable-grant results
remain evidence; none is a passing replay. The local receipt is
`/tmp/deep-1687-bounded-replay/grant.log` with its numeric exit alongside it.

## Limits retained on PR #2236

1. The timed #21 replay remains unrun.
2. #18's behavioral fault is observed, but the automated proof runner's
   `atAssertion` classification remains blocked; its decision was not changed.
3. Full affected-suite before/after equivalence has not completed. Earlier broad
   attempts encountered inherited failures and heavy shared-machine contention;
   interrupted and missing checks are not PASS.
4. Repository-wide inherited lint/size findings and cryptographic guard approval
   are not relabelled green. The user's explicit message approval is recorded,
   but no signed tag was fabricated.

Issue #1687 may therefore be closed **as not planned for the outstanding tracker
work**, at the person's direction. The implementation is in the single PR #2236,
which remains draft/unmerged with these limits. It must not acquire an automatic
`Closes #1687` assertion or a completed-verification claim from this disposition.
