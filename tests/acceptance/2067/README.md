# #2067 — blind public-flow acceptance

## Inputs and boundaries

Drafted only from `../issue.json`, the unchanged checkout at
`1c4d1f0e2aaad8c6a6573848823566d04ff73d17`, its design, and the unfinished
`tests/acceptance/2067` draft. The resume inspected only permitted base-run logs;
no implementation patch, implementing session, or other worktree was read.
No production file, other issue's test, check, setting, or baseline was changed.
No commits were made. Existing built artifacts were used; no build was needed.

Design: [verdicts](../../../docs/technical-design.md#how-runs-become-one-of-five-verdicts),
[locked definitions](../../../docs/technical-design.md#what-done-means-fixed-at-the-start),
including “Done means switched on,” slow runs at turn end, and Dogfooding.

## Requirement → assertions

| Issue requirement | Test and expected behavior |
| --- | --- |
| AC1 `#2067.97392e0a`: trunk PR, failing merged preflight, FAIL naming preflight; Closes refused naming it; base drops the run and allows Closes | `release.test.ts`, `trunk`: verdict `FAIL`, reason names `preflight`, exactly one failed release run; its commit's tree equals Git's merge tree and its parents are the PR and last-fetched heads; Closes denied naming `preflight`. Base evidence records the actual verdict, release runs, receipt and guard reply before the assertions. |
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
reach a verdict; that run is not proof.

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
reported separately. See `BASE-FAILURE.txt` for measured outcomes and limitations.

## Provenance hashes (SHA-256)

- `../issue.json`: `7ba3103eb68b4fc82af8aff5441bd9a02cfc1126bba687c16c2b375417807ed6`
- `docs/technical-design.md`: `c5e547e50703db9c553eeb2403ce07a99d6215ce81270c14ac67819587075dd5`
- `fixture.ts`: `58ca4e528654f4b0977f4f30e4a058c4e54df89ef2a882d572a7b0d5710b13e6`
- `release.test.ts`: `0cb0aec81f060cbd8331a717ec3078980b5f0e4fcfadca80bc4c0b277cfe1302`
- `twins.test.ts`: `084f1260f15ee6ad05b8fe7dd26af88982fec3418d1efc4a4eb96b9f7430c26c`
- `target/debug/deep-hook`: `d2e429bd3602cad08d472757888de6d26cc54a4f29423b493da74dc5b75d415d`
- `packages/hub/dist/release.js`: `45fe955406e56d98b8971f94b319714383b6319181796c3e84df210090f7c4cb`
- `packages/hub/dist/stop-judging.js`: `8f476cbfd925baad67b88036fe36d39e8a6efd13b20f608499487c5adae7db4a`

These are provenance, not goldens. The implementer must copy the finalized acceptance
files byte-for-byte. Final acceptance cannot be declared PASS on this base.
