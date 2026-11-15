# #2067 — blind public-flow acceptance

## Inputs and boundaries

Originally drafted only from `../issue.json`, the unchanged checkout at
`1c4d1f0e2aaad8c6a6573848823566d04ff73d17`, its design, and the unfinished
`tests/acceptance/2067` draft. The bounded 2026-11-14 correction additionally used
these finalized tests and the human-approved count clarification quoted below.
Only permitted base-run logs were inspected; no implementation patch, implementing
session/report, other worktree, or blind redraft was read.
No production file, other issue's test, check runner, setting, baseline, or decision
was changed. No commits were made. Existing same-base built artifacts were used;
no build was needed.

Design: [verdicts](../../../docs/technical-design.md#how-runs-become-one-of-five-verdicts),
[locked definitions](../../../docs/technical-design.md#what-done-means-fixed-at-the-start),
including “Done means switched on,” slow runs at turn end, and Dogfooding.

## Requirement → assertions

| Issue requirement | Test and expected behavior |
| --- | --- |
| AC1 `#2067.97392e0a`: trunk PR, failing merged preflight, FAIL naming preflight; Closes refused naming it; base drops the run and allows Closes | `release.test.ts`, `trunk`: verdict `FAIL`, reason names `preflight`, exactly one failed release run **on the expected merged commit**, identified by Git's merge tree and the PR and last-fetched heads as its two parents; Closes denied naming `preflight`. Base evidence records the actual verdict, release runs, receipt and guard reply before the assertions. |
| AC2 `#2067.47a66ecb`: no mainline, BLOCKED naming the missing mainline, Closes refused | `release.test.ts`, `missing`: `BLOCKED`, receipt includes `preflight: missing`, reason names preflight, missing mainline and owner `you`; Closes denied naming preflight. |
| AC3 `#2067.fa764398`: release names an undefined preflight, BLOCKED naming it | `release.test.ts`, undefined preflight: same missing-check/owner/refusal assertions with an undefined-check cause. Local main exists so missing mainline cannot explain it. |
| AC4 `#2067.51b5aef6`: unchanged local-main path runs once per head on the same merged commit | `twins.test.ts`: both claims PASS; one passed preflight run in the entire isolated hub, actual merged tree and both parents verified; second claim still names preflight PASS, covers the same branch head and reuses the exact same merge SHA/run; judging leaves branch HEAD unchanged. Completed preflight allows Closes. |
| Scope: recorded remote default, else remote main/master; no fetch | `release.test.ts`: trunk and develop each have remote HEAD pointing at the strict mainline and a green remote-main decoy. Remote-main and remote-master have no local main/master or remote HEAD. Each requires the failed merged run, not a head-only run. Every fixture blocks and records any `git fetch`; any attempted fetch fails the test. The remote URL is a nonexistent local path. |
| Scope: unreadable mainline | `release.test.ts`: a local main ref names an absent object, while PR HEAD remains readable; `BLOCKED`, missing receipt check, mainline-read cause and owner `you`, Closes refused. |
| Scope: genuine conflict remains FAIL naming conflict | `twins.test.ts`: real conflicting edits to `src/merge.txt`; verdict `FAIL`, receipt `preflight: failed`, reason names conflict; Closes refused naming preflight. This unchanged behavior is broken on the supplied base; expectation is retained, not changed to INVALID. |

The four AC texts/expected outcomes are those in the issue; regexes leave cause wording
open rather than requiring an invented exact sentence. A missing claim, verdict or
receipt is a setup/correlation failure, not evidence of the release bug.

## Real flow and fixture qualification

`fixture.ts` reuses #16's hub launcher, #325's temporary repo/session/socket helpers
and its release preflight, and #1537's fake external reviewer. Tests enter through
`deep hub run`, the real `deep-hook` (Claude Code SessionStart, typed prompt, edits,
Bash and Stop), `.deepbuild/done.yaml`, and the public `events.read` / `changes.read`
receipt APIs. No production module is imported or gate result planted.

One typed request names the issue **and** asks for a PR, then stop. This grants the
ordinary PR authority without opening another task through a later prompt or an
answer-delivery turn, and permits the slow lane to start. The issue definition locks;
ordinary unit and drafted checks pass first, with the drafted fix failing on its
base. Then a real commit is made and the external `gh` boundary returns a fixture PR
URL. A subsequent stop claims that PR. The verdict is correlated to that exact
locked-task claim, not an unrelated task's verdict. Closes is a PreToolUse probe only:
it never executes `gh`, even on a buggy allow. No model or GitHub write is made.

The preflight passes on either parent alone and fails only when strict mainline code
is combined with the PR's legacy-token change. The clean local-main twin leaves
legacy tokens disabled. Tests read outcomes, counts, commit objects and guard replies;
a no-op hub or omitted release check cannot satisfy them.

Resume corrections were fixture-only: PR authority/turn setup, explicit verdict
correlation diagnostics, counting all release runs to catch duplicates, and verifying
that the second claim actually includes the reused preflight. The bounded wait for
ordinary prerequisites was extended from 90 to 240 seconds on the loaded host; it
stops on any terminal verdict, not just PASS. No behavior assertion was weakened.
An intermediate authority-answer approach was rejected after its base run did not
reach a verdict; that run is not proof. This paragraph describes the original
fixture qualification, not the later approved assertion correction below.

## Approved count correction — 2026-11-14

The human was asked to approve counting release runs **on the expected merged
commit** in the four AC1 variants, retaining the design-required base comparison,
all other assertions, and AC4's exact reuse count. The supplied response was
"clsoe the gaps that we can close the issue". Its authority is bounded to that
specific correction, not permission to weaken other requirements.

- **Old contract:** `release.test.ts` counted all preflight runs across the hub as
  exactly one, then inspected the first. `BASE-FAILURE.txt` is unchanged historical
  proof under that contract, not a claim that the corrected bytes were run then.
- **Corrected contract:** independently compute `git merge-tree --write-tree` from
  the fixture's PR and last-fetched mainline heads. Count every preflight run whose
  commit has exactly those two parents and that tree; require **exactly one**.
  Inspect every matching run for `failed` and retain the explicit tree/parent
  assertions. No first-run selection, lower bound, invented commit metadata, or
  implementation-derived SHA is used. Wrong-parent/tree or absent runs cannot
  satisfy the count, and duplicate matching runs fail it.
- **Unchanged:** all four AC1 scenarios, FAIL and refusal naming preflight, all
  missing-check/cause/owner assertions, no fetch, fixture base-comparison behavior,
  and both twins. `fixture.ts` still logs **all** release runs, including any base
  comparison; the added merge-evidence line is a separate matching subset. No
  runner behavior was changed to avoid the design's inherited-failure comparison.
- **New base proof:** `COUNT-CORRECTION-BASE.txt` and `count-correction/` record the
  one corrected-file run, its command, scrubbed outputs, failures and hashes.
  `fixture.ts` and `twins.test.ts` are byte-identical, so AC4's already-proven base
  run carries unchanged; the historical conflict failure remains disclosed.

## Running

Use the supplied base-built `node_modules`, `packages/*/dist`, and
`target/debug/deep-hook`. Node used: 24.22.0; installed Rust: 1.99.1.
Run files separately (no changes to lanes or machine throttle):

```sh
node scripts/affected.mjs tests/acceptance/2067/twins.test.ts
node scripts/affected.mjs tests/acceptance/2067/release.test.ts
```

The affected runner also invokes its normal repo lints. Its aggregate status is not
an acceptance verdict; unrelated base lint failures and unrun throttle jobs must be
reported separately. See `COUNT-CORRECTION-BASE.txt` for the corrected-file run and
`BASE-FAILURE.txt` for historical qualification, including the unchanged twins.
Only the release-file command was run for this bounded correction; no retry or
full preflight was run.

## Provenance hashes (SHA-256)

- `../issue.json`: `7ba3103eb68b4fc82af8aff5441bd9a02cfc1126bba687c16c2b375417807ed6`
- `docs/technical-design.md`: `c5e547e50703db9c553eeb2403ce07a99d6215ce81270c14ac67819587075dd5`
- `fixture.ts`: `58ca4e528654f4b0977f4f30e4a058c4e54df89ef2a882d572a7b0d5710b13e6`
- `release.test.ts` (corrected): `f7d9078b71e06fea739820a7786480b7c315f7e43d36f4e091858daeafcf1ef0`
- `release.test.ts` (historical contract): `0cb0aec81f060cbd8331a717ec3078980b5f0e4fcfadca80bc4c0b277cfe1302`
- `BASE-FAILURE.txt` (unchanged): `5194ce5ac61ab7d0e339fd2a968a8d22f35ae6f08130f9b6bc9b5f4af23ecb7f`
- `twins.test.ts`: `084f1260f15ee6ad05b8fe7dd26af88982fec3418d1efc4a4eb96b9f7430c26c`
- `target/debug/deep-hook`: `d2e429bd3602cad08d472757888de6d26cc54a4f29423b493da74dc5b75d415d`
- `packages/hub/dist/release.js`: `45fe955406e56d98b8971f94b319714383b6319181796c3e84df210090f7c4cb`
- `packages/hub/dist/stop-judging.js`: `8f476cbfd925baad67b88036fe36d39e8a6efd13b20f608499487c5adae7db4a`

These are provenance, not goldens. `count-correction/SHA256SUMS` also covers the
finalized tests, documentation and scrubbed correction outputs (not itself).
The implementer must copy the finalized acceptance files byte-for-byte.
Final acceptance cannot be declared PASS on this base.
