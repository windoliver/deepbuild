# Continued closure attempt

The owner asked not to stop at the prior partial result. This attempt continued code correction, actual verification and a full normal-duration measurement request. It did **not** waive the proof bar or claim missing hosts/checks ran.

## Further behavior fixes

- **Failed process enumeration:** reproduced an unsafe successful cleanup reading while a worker survived. Fixed to return BLOCKED/nonzero, stop the demonstrably owned group and retain an unverified record. `scan-before.txt`, `scan-after.txt`, `safety-before.txt`, `safety-after.txt`.
- **Actual lease loss:** SIGKILL of the real lease while its original caller remained alive stranded a detached worker and held captured output open. Ancestor PID/start lineage now participates in cancellation; a live non-ancestor cannot authorize launch. `lease-loss-before.txt`, `lease-loss-after.txt`.
- **Spawn timeout:** the unchanged timeout case fails on the reverted supervisor and passes on the corrected lineage supervisor. `timeout-wrong.txt`, `timeout-after.txt`.
- **Bay cleanup barrier:** seven public-claim cases failed first, then passed unchanged: delayed supervisor cleanup, dead supervisor, live owner, wrong group start, malformed record, process-scan failure and cleanup timeout. A complete atomic build record is published before the IPC-gated compiler group starts. Claim and every reuse inspect those records before source/target reset. `barrier-before.txt`, `barrier-after.txt`.
- **Real publisher integration:** actual guardian/worker record and reclaim case passed; wrong published group identity fails at an assertion. The reverted-bay variant also passed because its test setup did not force the race, so that run is **not** a barrier discriminator; the seven deterministic claim cases are the red proof. `bay-live.txt`, `bay-live-wrong-group.txt`.
- **Existing behavior:** four existing bay-death/target/signal tests passed unchanged. `existing-bay-targeted.txt`.

Integrated mechanism/lifetime run: **13 passed, 1 failed**. The three-second timeout case failed before its worker was ready under load; earlier focused execution passed and the reverted implementation failed. The failing test was not edited or rerun to obtain green. `final-guardian-mechanism.txt`. Thus no final all-green claim is made.

## Check results, not attribution by filenames

Real checks on two fixed source/test copies of commit `63e11e81a`, with only pre/post mechanism/routing overlays:
- repo-rules: **24 matching failures on both sides**;
- conformance: **22 matching failures on both sides**;
- slots: **10 matching failures on both sides**;
- record-reader: **1 matching failure on both sides**;
- canvas-closures, color-literal-guard, guide: **0 findings on both sides**.

Each comparison is a retained JSON check result here. Matching failures remain failures, not approved known-list entries. This establishes attribution for those checks only, not the entire prior affected result. First shell entry invocation mistakenly used `node scripts/lease`; it was a syntax/setup error and counted as no check. Corrected commands executed the real shell entry.

Two required focused affected runs completed separately (supervisor corrections; existing bays plus new barrier). Each reported **FAIL: 58 new findings, 0 known, 11 inconclusive/blocked jobs, 0 passed tests**. The Node test job and ten throttled lint jobs received no grant; lightweight lints ran and failed. No WIDE lines. Direct fixture results above do not convert those unrun affected jobs into passes. `affected-correction.txt`, `barrier-affected.txt`.

## Required human approval is now an observed guard failure

`node scripts/proof.mjs guard` actually returned FAIL for the protected tooling changes, including each prior commit and the uncommitted supervisor correction. Full output: `guard.txt`.

`.deepbuild/approvers` is absent on the merge base and live main. Per the repository design, a person must first bootstrap the presence-requiring signer list on main by their own push; then the proposals need a merge base containing it and human-signed approval tags for the exact protected commits/files. `human-approval-items.txt` lists the already-committed paths; new correction commits must be included too. An agent may not create this trust root, use a software key to bypass it, sign as the owner, or merge unapproved proposals under a general instruction to close the issue.

At this historical run #2336/#2337 were unmerged. The owner subsequently requested a single PR; both are now superseded by #2321, which contains their byte-identical independent helpers and proof in an adoption commit before scheduling. The packaging deviation is owner-approved; no proof/signature rule is waived. Actual Spark remains inaccessible (`spark-ts` does not resolve); no alternate configured/user-recorded route was found. Linux container proof is not relabelled Spark proof.

## Full unit reading

A complete fixed source/test commit pair was prepared, with before restoring only the three pre-T4 runner files and after keeping T4. Plans contain 397 before-alone entries and 395 after-alone entries, removing only #374/#375; timed lists match. Package builds were copied from the same source checkout; Cargo target directories were not shared or relocated. Commands, overlay hashes and source recipe are retained locally under `/tmp/deep-1123-complete/full-pair/`.

The full pair was requested under the normal **60-minute timed grant**. The request completed with exit 3: **INCONCLUSIVE no grant: no timed grant came within 60 min**. Neither unit command started, no readings directory was produced, and there is no before/after wall reading. `unit-pair-no-grant.txt`, `measurement-recipe.json`, and `measurement-plan-summary.json` retain this result and plan. The original live-checkout request was replaced before admission with the pinned pair to avoid measuring a changing tree. No check result was retried.

**Unchanged proof conditions:** all four issue criteria need evidence, actual requested host coverage, approved independent redrafts and protected tooling approval. Per the owner's later packaging decision these changes share #2321 rather than separate prerequisite merges. Nothing in this attempt authorizes closing #1123 while those remain missing.
