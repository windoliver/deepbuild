# #2516 — radius-bounded ambient visibility: final proof

PR [#2578](https://github.com/windoliver/deepbuild/pull/2578). **Every issue acceptance criterion, including the owner-approved AC4 clarification, has passing evidence.** This is not a claim that the repository-wide checks are green; their failures, comparison with the merge base, and unrun work are disclosed below.

Final code tested: **`b85c4522b39ce1ff97be0933bd6d2365a1b82891`**, merging main `0e55727311da14cb0c4644f9afd5e33c9505fefa`. Final `deep-gpu` SHA-256: **`16b8a262fbf59cf700feaa3f68217c7ac019dda91ac2cac8b1f76bcb90d588db`**. The final approved tests are byte-for-byte the independent author's delivered files, plus the owner's hash-bound `TASTE.json`.

## Owner approval and independent checks

The owner directed **“goea d do whatever you reockemnd to close the issue”** after the pending reconciliation and exact four before/after frames were presented. The instruction was recorded at 2026-11-15T07:41:02Z, in [the PR comment](https://github.com/windoliver/deepbuild/pull/2578#issuecomment-6891236604), the issue's explicit clarification, [the approved proposal](2516-approval-proposal.md), and [the test author's edit map](../tests/acceptance/2516/APPROVED.md).

The author received only the original issue/base/design, the two existing drafts and the approved proposal, not the implementation or its run output. It applied only:

- separate qualification of the cube center-point values (0.68/0.81) and the band-average reference actually compared with the GPU, with no tolerance change;
- the mechanical tuple-index type correction, with no compiler-setting change;
- this issue's reference-Mac gate accepting the design's three model IDs, without editing #379;
- the original wall fixture at full resolution, both cameras and both sample counts, for the **full-radius wrong-program wall demonstration only**. Every shipped wall/slab/cube setting and bound is unchanged.

Original drafts remain in commit `3cd75b8aa`; their failures are retained. No second blind redraft, covert skip, plant-specific tuning, or unauthorized expected-value change occurred. The owner accepted the recommendation to retain radius 0.5 m and strength 1 on the four exact images; `TASTE.json` quotes the instruction rather than inventing a detailed visual assessment.

## Requirement → change → proof

| Criterion | Change | Passing proof |
|---|---|---|
| AC1: wall visibility at 5–40 cm, 8/16 samples, half/full, two cameras; main rejected | `ao.wgsl` integrates cosine-weighted directions blocked before the radius, with depth-crossing refinement and visible-surface validation | Both camera/setting grids meet ±0.05. Main's loop fails naming its first point. Base's 10 cm reading was 0.822 against 0.6265; final shipped 8/half camera A reads about 0.638. |
| AC2: floor past radius reads 1; raised-strength main fails at 5 cm | Radius cut; literal main loop retained for proof | All open-floor settings read 1. Raised-strength main reaches the 10 cm band but fails 5 cm by name and reading. |
| AC3: slab at 0.25/0.375 m; main and uniform plants rejected | Full direction segments, cosine-weighted rather than endpoint counting | All shipped settings meet 0.25/0.5625 ±0.05. Main reads above 0.8 at the first height and is rejected; uniform reads approximately 0.502 and is rejected. |
| AC4, approved clarification: qualified cube reference; full-radius wall/cube witness | No product tolerance change; independent point/band qualification and original full-resolution wrong-program wall demonstration | Both CPU reference files pass (14 tests); both cube files pass at all shipped settings/cameras. The literal full-radius plant passes the approved wall witness and reads above 0.99 on the cube, failing the same visibility judge by camera. |
| AC5: original #418 occlusion tests unchanged | Ambient-only application, same prepass membership and no history | Original three tests pass, and #2516's wrapper confirms their byte equality with the drafting base. |
| AC6: five warmed runs, three timestamp scopes, all four settings, Cost line, lease contention | Separate `scene3d.ao_prepass`, `scene3d.ao`, `scene3d.ao_blur`; existing reader resolves after the frame | Qualified measurement passes under real timed/GPU grants on Mac17,10, nominal thermal state and all loads below 18 cores. The Cost-line and held-lease/no-number tests pass. All three cases have run; measurement is not silently rerun until green. |
| AC7: check-run main/after room/castle, shown and PR-linked, recorded taste | Exact renderer PNGs and owner-approved defaults, hashes in `TASTE.json` | The unchanged official taste test rebuilds the original base, draws both sides and passes on the exact approved hashes. It passes again on final integrated code. Images are attached on the PR; no golden is changed. |

**Final run:** all eight non-timing files pass, **29/29 tests, no skipped tests**. TypeScript passes. The two affected timing assertions pass, with only the already-qualified measurement intentionally unselected; combined with its successful five-run check, all **32 suite cases** have been exercised. Earlier renderer-library run: **29/29 unit tests pass**, none ignored. It predates the last lens integration; the final integrated renderer build and full non-timing acceptance run are the final-code proof, not a claim of rerunning those library tests.

## Measurement and images

[Timing record](../docs/evidence/2516/timings-803322230a66.json), measured on `c7b6f97233c4f37828cfdcaccf7081a014defc8a`: castle 1920 × 1080, one warm-up run then five, 30 kept frames per setting/run, 150 pooled. The record includes per-run medians, model/chip/memory/OS, power/thermal state, and every run's start/end load. The lease's private home was redacted and the JSON body rehashed; no numeric value changed.

| Samples / resolution | Prepass p50 / p95 ms | Occlusion p50 / p95 ms | Blur p50 / p95 ms |
|---|---:|---:|---:|
| 8 / half | 0.02 / 0.07 | 0.70 / 2.70 | 0.19 / 0.39 |
| 8 / full | 0.05 / 0.09 | 0.62 / 4.99 | 0.40 / 0.85 |
| 16 / half | 0.02 / 0.04 | 1.34 / 4.89 | 0.17 / 0.40 |
| 16 / full | 0.03 / 0.05 | 2.43 / 5.89 | 0.27 / 0.48 |

The [AO Cost line](../docs/canvas-primitives.md#look-look1-ao) carries all 24 rounded numbers, verified by the unchanged check. The Decided row revisits the measured costs without silently changing defaults or class budgets. Per-pass percentiles are not added into a frame percentile, and this measures AO rather than proving every class's whole-frame budget. Later merges leave the three AO shader files byte-identical; the record remains honestly pinned to its measured commit, not relabelled as a new timing run.

[Comparison frames and provenance](../docs/evidence/2516/README.md) are byte-for-byte renderer output. The official final taste run produces the same four hashes; the owner's approval therefore still names exactly what was rendered. These are the AC7 PR comparison artifacts, not re-recorded goldens. Committed #422 castle goldens use AO-off `castle.look.json`; no stored golden was moved or blessed. `physical_film` and `physical_night` keep their defaults.

## Scope and implementation

The existing renderer owns the depth/normal prepass, visibility shader, blur and shading input; an ordinary extension cannot replace those internal bindings. No kernel addition, dependency, look option, frame history or ray-query requirement is added.

Each Hilbert-R2 cosine direction marches 16 segments to the radius. Hidden endpoints trigger five bisections, followed by local-plane intersection and depth-buffer verification; directions count at most once. This catches thin visible occluders and keeps the receiver's flat tangent plane from self-occluding. A surface-aware half-resolution lookup reduces contact bias while staying within the existing texture-binding limit. Main's wrong loop remains literal; only its point length changes for the full-radius twin. A paired-tap blur experiment failed to improve the required witness and was removed, with its output retained.

The existing adapter/pass declarations, proof switches, frame types and ambient functions were mechanically extracted into small modules while preserving public crate-root entries, keeping touched files under their existing size limits. Upstream inset and lens changes were preserved in merge resolutions. Ceilings were lowered, never raised. The diff exceeds the ~400-line guideline because it includes the immutable independent tests, one redraft, explicitly approved reconciliation, issue-required measurement/images and mechanical moves; no unrelated shared-checkout work is included.

## Repository-wide checks and unrun work

The issue-specific proof above is not a repository-wide green verdict:

- Initial merged `affected.mjs`: **165 new-to-baseline findings, 44 already listed, 3 inconclusive, 23 passing tests**. Its two #2516 failures were subsequently corrected by owner-approved changes. Its three machine-gated cases now pass through this issue's corrected gate. It printed the unrun timing line; the later qualified AC6 run and the final Cost/lease assertions supply that proof. No WIDE line was emitted.
- Approved GPU `affected.mjs`: **14/14 selected tests pass**, overall **FAIL: 86 new-to-baseline findings**. Ten queued global lint requests from this run were stopped by their exact owned PIDs after a foreign session held the build grant over an hour; those checks are **INCONCLUSIVE/unrun**, even though the aggregate labels their interrupted jobs FAIL. They are not passes or waivers. No selected acceptance test was skipped.
- Official taste through `affected.mjs`: **1/1 selected test passes**, overall **FAIL: 165 new-to-baseline global findings, 44 listed**.
- The approved-reference aggregate could not get its test grant or ten global-lint grants within 30 minutes and is **INCONCLUSIVE for those jobs**; the direct CPU run subsequently exercised both real files, **14/14 pass**. This operational deviation is explicit, not a claim that the unavailable aggregate passed.
- An archived merge-base run confirmed the 75 findings from the seven global guards that ran on both sides: same repo-rule/dependency (50), conformance (23), closure drift (1) and record-reader (1) findings, none new on the head. The comparison did **not** run all remaining guards: their grants were unavailable. A later slots diagnostic also could not read listeners with lsof under load; it is not hidden as success.
- Full release preflight, broader dependent/golden suites, final lens-library unit reruns, clippy and the unavailable global guard jobs remain **unrun or inconclusive**. Neither their limits nor known-failure baselines were changed. Remaining findings belong to untouched repository work and are disclosed, not fixed by this PR or declared globally green.
- `git diff --check`, exact approved-test hashes, scoped Rust formatting, WGSL validation, locked offline build and the final acceptance/type checks were reviewed. No hooks/CI, secret, home-path evidence, process-name kill, or unapproved check/golden edit was introduced.

The slow official taste check was allowed to rebuild the original base. While its worker waited on that CPU-only build, only that owned worker was briefly paused; the same task's GPU lease stayed held while the approved pixel run executed, then the worker resumed. No two jobs of this task drew together. No timing was claimed under that load. All owned workers and waiters have ended.

## Retained proof locations

External run directory: `/tmp/deep-2516-closure.4O0Qxc/`; independent approved-author inputs/outputs: `/tmp/deep-2516-approved.Je3AVS/`. Redacted copies are under the first directory's `evidence/`; the issue-required public measurement/frame artifacts alone are under `docs/evidence/2516/`.

Key logs: `approved-final-build.log`, `approved-final-acceptance.log` (29/29), `approved-final-types.log` (empty, exit 0), `approved-final-cost.log` (2/2 affected assertions), `approved-gpu-affected.log` (14 selected passes), `approved-taste-affected.log` (1 selected pass), `approved-reference-direct.log` (14/14), `base-global-lints.log`, and `approved-base-lint-comparison.json`. Earlier base failures, rejected drafts, shader/binding failures, stale-cache diagnostics and the removed blur experiment remain retained; none was overwritten as a pass.
