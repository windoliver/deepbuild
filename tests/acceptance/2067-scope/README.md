# #2067 supplementary blind scope acceptance

Inputs: issue #2067, AGENTS.md, technical design (`How runs become one of five
verdicts`, `What done means, fixed at the start`, Dogfooding), unchanged base
`1c4d1f0e2aaad8c6a6573848823566d04ff73d17`, and base tests, including `../2067/`.
No other worktree, implementation changes or review was read. No existing file
was changed and no commit was made. The four original ACs are not duplicated.

## Requirement → assertion → base proof

| Requirement | Test and assertions | Unchanged-base result |
|---|---|---|
| Scope: nothing fetched; unavailable mainline data is BLOCKED | `promisor.test.ts`: local main commit resolves, but its tree is missing in a promisor repository. A separate twin proves real `merge-tree` lazily fetches that exact missing input from a local bare origin and completes. A transparent OS-Git wrapper enables Git trace2; it does not replace Git, intercept answers or change arguments. Assert zero internal fetches, BLOCKED, missing preflight with mainline-read cause and owner you, Closes refused. | FAIL at intended assertions: one internal fetch, real merge-tree, PASS, preflight passed, Closes allowed. |
| Scope: every release name remains a check, including `review` | `review-name.test.ts`: `release.checks: [review]`, no `checks.review`, and an automatic external reviewer returning no findings. Assert the automatic review completed, but a missing release review remains on the receipt, verdict BLOCKED with undefined-check cause and owner you, and Closes refused naming review. No required ID prefix or numbering. | FAIL at intended assertions: automatic review passed; claim PASS with no missing release check/cause/owner. Closes refusal already holds on base. |
| Design inheritance + AC4 reuse | `inherited-reuse.test.ts`: one real node:test assertion fails on both merged head and base. First claim BLOCKED as inherited; second distinct claim with identical head/check stays BLOCKED naming inherited preflight and reuses the same run IDs. | PASS guard: already correct on this base; two total release runs (one merged, one base), no extra runs on second claim. Not claimed as a newly reproduced defect. |

Existing `../2067/twins.test.ts` proves successful release reuse, `../325/` proves
merge failure, and `../28/rules.test.ts` proves inheritance in the verdict engine.
None proves inherited release reuse through two real PR claims; the small guard
fills that integration gap without duplicating their cases.

Surfaces: real `deep hub run`, real `deep-hook` Claude Code hooks, approved fixture
`.deepbuild/done.yaml`, `events.read` and `changes.read`, and PreToolUse for
`gh pr create`. Helpers reuse `../16/`, `../325/` and the fake external reviewer
from `../1537/`. Only external model/forge/OS-Git boundaries are controlled;
record, runner, merge and test execution are real. All remotes are local fixture
paths. No actual model call or GitHub write. A no-op hub cannot produce the
required locked definition, ordinary PASS, fresh claim, receipt or real runs.

## Verification and limitations

One run, no harness corrections or retries:

```sh
node scripts/affected.mjs tests/acceptance/2067-scope/promisor.test.ts tests/acceptance/2067-scope/review-name.test.ts tests/acceptance/2067-scope/inherited-reuse.test.ts
```

Node 24.22.0; Rust 1.99.1; Git 2.56.0. Same-base existing deps/dist/deep-hook.
Three tests completed: **2 expected failures, 1 passing guard**; no setup,
loader or timeout failures. No broad suites, implementation run or mutant run.
The guard's passing base result is regression protection, not mutant-kill proof.

Normal affected throttle/lease entry was used, with no bypass. The lease wrapper
reported no hub token and ran unleased: a real environment limitation, not a
leased-run claim. Overall affected exits 1: 174 new failures (2 tests and 172
unrelated base lint findings), 11 known lint findings, 0 inconclusive/blocked,
1 passed. No WIDE or INCONCLUSIVE lines were emitted. The host load was 203;
these are behavioral assertions, not timing measurements. No unrelated lint
finding was changed. Fixture cleanup stops only its owned PIDs.

`BASE-FAILURE.txt` summarizes the evidence. `evidence/` preserves the full affected
output, Vitest output and structured reporter, with home/base/temp paths scrubbed.
`SHA256SUMS` pins the additions for byte-for-byte transfer.

## Cross-session supplement — 2026-11-14

The sections above describe the original delivery and remain unchanged. This
supplement uses only the same issue, design, pristine base and supplied coverage
clarification. No production source, implementation changes, other worktree,
review or implementing log was read. Existing base tests were inspected for reuse:
`../1018/hub.test.ts` covers general cross-session sharing, and
`packages/hub/test/shared-runs.test.ts` covers sharing with a test runner stand-in;
neither covers inherited release evidence through two sessions' real PR claims.
The original `inherited-reuse.test.ts` covers only two claims in one session.

| Requirement | Added test and assertions | Base proof |
|---|---|---|
| Design “Carried across sessions”, inheritance, and AC4's unchanged-head release reuse | `inherited-cross-session.test.ts`: two independent sessions, one hub/repo, definitions pinned to the same original base, unchanged head/mainline/check/environment. Each reaches ordinary PASS first. A's PR claim has one real merged-head preflight failure and one real base failure, with the same assertion, and is BLOCKED as inherited. B's fresh PR claim must remain BLOCKED naming inherited preflight, reusing the exact same two release run IDs. | **Expected behavioral failure reproduced**: A is BLOCKED; B is FAIL, saying `preflight: failed on every real run: release is ready`, with no inherited-preflight reason. Both intended assertions fail; exact run reuse and unchanged-head/input assertions pass. |

The 91-line test reuses `./fixture.ts` and public exports of `../325/` unchanged.
Its second task's issue number 2068 is fixture data only, not another real issue
or task input. Distinct task ownership isolates shared release evidence. The
fixture's own checkout briefly moves to its original base to lock B's definition,
then returns to the original branch before either PR claim; no other worktree is
touched. Both claims use the same head and mainline, and the observed verdict keys
also have identical check digests, environment and tools. No event, verdict or
run result is planted. The real hook, hub, record, merge, runner and node:test
execution are exercised; the reviewer and forge remain external stand-ins.

### Qualification, correction and limits

Only the added path was run, once per setup version:

```sh
node scripts/affected.mjs tests/acceptance/2067-scope/inherited-cross-session.test.ts
```

- **Initial setup attempt — BLOCKED qualification, not defect proof.** Both
  sessions used the same fixture task; B made a fresh claim but no correlated
  verdict arrived within the bounded wait. A's control was BLOCKED as inherited.
  `cross-session-evidence/setup-attempt/` preserves that exact test version,
  output, reporter, exit code and hashes. Its runner reports 180 new failures
  (one setup failure plus 179 unrelated lint findings), 11 known, no passed tests.
- **One material setup correction, then one run.** Give B a distinct fixture
  task with the same check and original base, and establish B's ordinary PASS
  before either PR claim. Add second-claim record diagnostics; keep the expected
  BLOCKED result, inherited reason and exact release reuse assertions unchanged.
  The corrected run reaches both PR verdicts and fails only the two intended
  assertions above. This is one setup-correction rerun, not a retry until green.
- **Corrected affected result:** exit 1; 173 new failures (one test plus 172
  unrelated base lint findings), 11 known lint findings, 0 inconclusive/blocked,
  0 listed skips, 0 passed. Vitest: one failed test, two behavioral assertions,
  18.15 s; affected: 143 s, load 188. Neither run emitted WIDE or INCONCLUSIVE
  lines. These are behavior checks, not timing measurements.
- Normal throttle/lease entry was used without bypass. Both runs reported no
  hub token and ran unleased. The first run's teardown reported stopping nine
  processes that file left running; the corrected run has no such warning.
  Fixture cleanup stops owned PIDs only. No real models, GitHub calls or network,
  no new build, no broad suites, no mutant or implementation run, and no commits.
  No remaining #2067 acceptance criterion is claimed closed by this supplement.

`cross-session-evidence/BASE-RESULT.txt`, `affected.txt`, `vitest.txt` and
`reporter.jsonl` preserve the corrected failing base result with home/base/temp
paths scrubbed. `CROSS-SESSION-SHA256SUMS` pins the new test, README and evidence;
it does not replace the historical `SHA256SUMS` or `BASE-FAILURE.txt`.
`cross-session-evidence/prior-files.json` records hashes before this supplement
and verifies that all 19 prior files other than this README are byte-identical;
the original 4,392-byte README remains an identical prefix. The final test's
hash equals its pre-run hash. Copy `inherited-cross-session.test.ts` unchanged.
Base qualification stops here; the cross-session requirement is not PASS.
