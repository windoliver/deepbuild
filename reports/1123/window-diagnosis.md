# #1123: observed window stall and measurement recovery

The prepared native probe has now actually run. This replaces the prior **unrun** diagnostic status, not the original failed full-unit result.

## Observations

- The screen was unlocked. Native `WindowVisibility` changed to **Hidden at 7,163 ms**, with **358 renders / 299 painted samples**. After that event the existing foreground journal reported no callbacks or draws. The candidate's unchanged 30-second watchdog eventually reported explicit INCONCLUSIVE. There were no lost journal entries. CoreGraphics' earlier on-screen flag did not show this occlusion.
- With ordinary activation of **only the owned arm process**, and a serviced AppKit run loop, the instrumented arm remained visible and measured **871 frames over 8.0076 s**. Instrumented values are diagnostic, not budget/acceptance evidence.
- The **uninstrumented** watchdog candidate then passed the original independently drafted shown-window test **unchanged**: **916 measured frames**, independent active-window span **10.876 s**, one pass. The previous failures remain retained; the real environment provision changed, not the assertions or threshold.
- More importantly for AC4, the **original baseline executable** completed `measure --arms blank,list-10k` in **32.77 s** with actual foreground provision: blank **733 frames / 8.0058 s**, list-10k **897 frames / 8.0075 s**. Its omitted arms and decision stayed INCONCLUSIVE. The host was loaded/thermal-fair, so this is completion/measurement-shape evidence, **not a budget PASS**.
- The stronger measurement helper additionally binds the already observed kernel PID/start to AppKit launch identity. Its actual original-baseline arm check completed with **937 frames / 8.0009 s**. Only owned executable identities were activated; no input event, security change or global preference was used.

## Why the hidden test still fails

A run-loop-serviced OS observer saw `hide()` return false, followed by **hidden=true on the same owned app**. Thus the parent-authored hidden regression's Boolean expectation does not prove actual hide state. Packaging both unchanged binaries as temporary app bundles did not repair that mismatch: base timed out and candidate failed the hide-Boolean assertion. Those failures are preserved, not edited into passes. The hidden blind redraft is still non-PASS; no retroactive test waiver is claimed.

The independent shown-window integration redraft builds its real test target and needs no positional executable, but it is an unadopted proposal with no full runtime proof. It does not remove the current failing/unintegrated files. The source candidate and new GUI tests remain uncommitted. **The new full timing pair uses neither candidate nor instrumentation**: it uses the original baseline benchmark on both sides, with the proven real visibility prerequisite supplied externally.

## Fresh complete-pair preparation

Common workload commit: `8b723d70fd407e467ddf2ba624ca174a7d88ce9d`. Both scratch workspaces were restored to that commit after preserving their previous dirty files/diffs. The before side restores only `scripts/lanes.mjs`, `scripts/affected.mjs` and `scripts/proof-runs.mjs` from `092754bb1`; the after side uses the common commit. All tracked tests/helpers/fixtures are byte-identical, every selected file belongs to the manifest, and all 422 package build files match. Targets remain separate at their original checkout paths: before warm, after empty; this is disclosed, not a speedup comparison.

Actual Vitest selection reconciles **2,732 common files**: before **800 parallel / 1,932 alone**; after **808 parallel / 1,924 alone**. The only removed alone folders are #374/#375. Timed, exclusive, by-hand and slow lists are identical.

The external capture harness retains the top-level runner's open reports (not nested fixture output), exact command identities and the lane's evidence record. It provides visibility only to owned #1477 arm processes; temporary `caffeinate` prevents ordinary idle sleep while its parent lives, without unlocking or changing security settings. Complete runs require a real outer timed grant. Missing/partial reports, failed tests, skipped tests and nonzero exits stay visible; no completed duration means no AC4 proof.

The normal **60-minute timed admission expired with no grant**, exit 3; neither lane started and no wall reading exists from this request. The captured output is `window-diagnosis/full-pair-no-grant.txt`. The external observer's review corrections and exact source digests are recorded before launch; missing capture/end data still means missing proof, and exhaustive arbitrary daemonization cleanup is not claimed. Prior incomplete readings are not resumed or spliced into this pair.

A **single bounded continuation** now waits up to 12 hours for an unlocked desktop, no live throttle holders/requests and load below the machine's cores, then makes **one** real timed request. It neither grants itself permission nor retries an executed side; the actual throttle and start-time desktop check remain authoritative. It writes status/results only, never commits, merges, closes the issue, signs approval or changes a verdict. Local state: `/tmp/deep-1123-visible-pair/continuation-status.json`; command log: `continued-request.log`; completed sides, if any, appear under `readings/`. Until then its status is WAITING, not RUNNING tests or PASS. The unchanged checks and the remaining approval/trace obligations still stand. The helper's OS-boundary smoke checks verified owned identity, argv, open-descriptor attribution and retaining final report bytes after unlink; those checks prove the observer plumbing, not the issue.

Local exact inputs/provenance: `/tmp/deep-1123-visible-pair/{recipe.json,before-plan.json,after-plan.json,plan-reconciliation.json,*-input-files.json,*-package-builds.json}`. Redacted native/acceptance results are retained under `window-diagnosis/`. The sole PR is #2321, still Part of #1123.
