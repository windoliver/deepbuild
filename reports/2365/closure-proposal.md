# #2365: the unblock proposal, decided 2026-11-15

Status: **decided by the owner on 2026-11-15**. Proposal A is approved, and #2365's first Scope bullet carries its wording. Proposal B ran as a separate maintenance job that never saw the implementation (commit `2a88eab5b`, runs in `repair/`). What is still open is in [../2365.md](../2365.md). The text below is the proposal as it was put.

## Proposal A — distinguish verification reads from copying

Current scope sentence:

> A pass on a transcript that only grew reads, scrubs and stores what it gained since its last copy.

Proposed replacement:

> A pass on a transcript that only grew scrubs and stores what it gained since its last copy. It may verify the previously copied prefix by reading and hashing it in bounded buffers, without decoding, scrubbing or storing it again. An unchanged transcript is not read. The added-megabyte pass still meets all of this issue's evidence, time, memory and responsiveness limits.

Reason: for an ordinary mutable file, two writers can produce identical size, inode and modification metadata while one appends and the other rewrites an earlier byte and then appends. Without observing that earlier byte or a trusted write journal, the archive cannot distinguish them. Sampling is not exact rewrite detection. The supported agents do not provide a portable trusted byte-range write journal.

This proposal explicitly acknowledges that verification IO remains proportional to the prefix. It does **not** claim every part of a pass costs only the addition. It preserves exact rewrite detection, zero reads for unchanged files, and all six acceptance criteria and their numerical limits. If rejected, the issue needs a separately specified trusted write-tracking mechanism; metadata heuristics are not a substitute.

## Proposal B — independently repair test plumbing, preserve the oracles

Authorize a test-maintenance job, separate from the implementation job, to make these exact classes of repair. It may see the frozen tests, issue/design, base commit and failing outputs, but not the implementation diff. This is a proposed owner-approved repair, **not** another blind redraft.

1. **Original AC4 byte-difference diagnostic:** preserve the differing line's message ID across streaming comparison chunks rather than retaining only the first 240 bytes. Keep the required first-line/message diagnostic and every byte comparison unchanged.
2. **Original AC5 and AC4-redraft diagnostic checks:** construct explicit, untruncated failure messages from observed differing values. Keep all semantic assertions and the planted wrong implementations. Do not loosen `.toThrow` to accept a less informative failure.
3. **AC5-redraft exported-base loader:** build the exported base or use the repository's TypeScript-resolution approach so its `.js` source imports resolve to `.ts`. Still execute the actual merge base, not the implementation, and fail when the base is unavailable. Keep the same source fixtures and byte-for-byte comparison.
4. **Synthetic-key lint findings:** review the two deliberately non-usable private-key fixtures and, only if approved as such, use the existing exact fixture allowance mechanism. Do not disable the secrets check, allow a broad path pattern, or conceal a real secret.

Repair proof must include the unchanged semantic expectations on the actual base and implementation, each planted wrong program rejected with the required diagnostic, and fixture/criterion hashes showing what was preserved. Any unexpected semantic change goes back to the owner, not into the repair.

Recorded failures are in `reports/2365/pr/vitest.log.txt`, `reports/2365/pr/lint-scripts-repo-rules-mjs.log.txt`, and `reports/2365/memory/identity-tail-final.txt`.

## Still required after either approval

Approval alone does not make this issue pass:

- Bound arbitrary individual lines/masks without leaking or dropping text; prove generic structured-field continuation across passes. The fixed private-key/held-value examples do not prove every possible input.
- Complete AC2 on the final code: both 600 MB pass/on-demand, every part compared and last-message handle resolved. A superseded run is not a pass.
- Run AC1 and the existing perf-task baseline comparisons under the reference machine's qualifying conditions and local proof policy. Keep 1,000 ms, 50 ms, 64,000,000 RSS bytes and 2,000,000 evidence bytes unchanged. Latest memory/timer readings fit, but timing certification is INCONCLUSIVE under load and thermal fair.
- Complete the relevant `affected.mjs` checks and catalogue/API/lint review, separating known main failures. Preserve every required failure until its cause is resolved.

Only after these requirements have check results may the PR change from **Part of #2365** to **Closes #2365**. Until then it stays draft and the issue stays open.
