# #2068 — requirement/proof record

## Latest result

All four original, independently drafted #2068 acceptance cases pass unchanged. The same files fail on the merge base at the required wait/fallback assertions; the instant-source guard passes there. The author-role scenarios reused from #322 pass. The **affected run is not green**: see inherited cleanup and repository-wide findings below. No test or known-failure entry was weakened to get these results.

Merge base tested: `5c92a77023e251385c6b9c7727d103ec5ed61a0e`. Initial drafting base: `1c4d1f0e2aaad8c6a6573848823566d04ff73d17`. The timing test prints the initial baseline as metadata on both sides; `final-timings.json` names the actual comparison base. `acceptance.sha256` pins the original delivered tests; `source.sha256` pins the tested source and added regressions.

## Requirement → change → proof

| Requirement | Change | Proof |
|---|---|---|
| AC1 `#2068.3406ba1b`: B arrives 100 ms after A and records before the forge's first 5 s answer; base fails naming the wait | Work-item preparation runs before the shared hook chain. A reply waits for its own intake, not another session's source. | `merge-base-failure.txt`: B waited **25,003 ms after arrival**, first answer about 5,062 ms after A; failed its named wait assertion. `acceptance-pass.txt`: B records before the first answer. Earlier fixed reading: about **13 ms after B's arrival**. Exact final intervals: `final-timings.json`. |
| AC2 `#2068.b095ccdc`: never-answering source ends within the read deadline, records A and a task from your words, and shows the unread-issue row | One 1,000 ms abort signal covers token acquisition, requests, response bodies and all pages. Expiration discards partial readings. A distinct deterministic `session.reading` supplies the row warning. | Base waits about **20,015 ms**, misses its advertised prompt hold, and has no unread-issue row. Fixed never-answering and endless-pagination cases pass, checking actual committed prompt/task visibility and `rows.read`. Credential-child and stalled-body regressions fail on base and pass on the fix (`deadline-before.txt`, `deadline-after.txt`). |
| AC3 `#2068.865fe586`: instant source retains criteria and authors' provider-derived roles | Keep the existing `readIssue` criteria/membership logic; consume preparation only after person/app origin placement, for the final prompt's link. | Instant HTTP twin passes on base and fix for owner and page-2 collaborator. Unchanged #322 normal scenarios pass for outside comments/owner attribution, automated collaborators, and complete/incomplete membership pages (`roles-result.txt`). Negative-control cleanup failures are disclosed below, not reported as PASS. |

The exact read duration is an implementation choice, not an issue-specified number. The blind acceptance draft checks the public prompt hold as the outer bound; one second leaves room in its existing two-second hold for intake and recording. This belongs at the existing core hook/ask scheduling boundary: an extension cannot release a chain that the core itself is awaiting. No new dependency, product setting, flag, event schema or verdict is introduced.

## Regression protection and review corrections

`packages/hub/test/prompt-items.test.ts` uses real hub/socket/record components and the existing external forge fixture. Each new behavior correction was made after its unchanged test failed:

- Same-session tools cannot overtake their issue prompt; other sessions remain independent. `same-session-before.txt` / `same-session-after.txt`.
- An in-flight live prompt's spooled copy does not start another forge read. `replay-before.txt`.
- A spool that already contains the live prompt cannot form a replay/live mutual wait. `replay-cycle-before.txt`.
- A genuinely fresh hook after spool replay still processes queued words. `live-after-replay-before.txt`.
- An authenticated app note carried by the prompt retains its prepared criteria. `app-before.txt` / `app-after.txt`.
- A prompt whose transcript is written only after its reply still gets that reply; its late origin placement retains the issue definition.

`regressions-pass.txt` records the final six prompt regressions and four existing replay cases passing (10 tests). `github-deadline.test.ts` proves cancellation at the external credential executable and unfinished-body boundaries. Its fake `gh` is the only executable on the child's PATH, returns no real credential and never reads login state; no authentication implementation or clock is mocked. Both tests fail at assertions on the merge base and pass on the fix.

An independent read-only review prompted these corrections. The shutdown wait now covers intake rather than a parked job's final settlement, so shutdown can reach runner cancellation. That path has code review/typecheck, not a dedicated end-to-end parked-job test.

## Checks and commands

```sh
# Builds, on each side, with installed dependencies and the installed Rust toolchain on PATH
npm run build --workspaces
cargo build --locked -q -p deep-hook

# Original immutable acceptance file, same on base and fix
node node_modules/vitest/vitest.mjs run \
  --config tests/acceptance/2068/vitest.config.ts \
  tests/acceptance/2068/forge-wait.test.ts --reporter=verbose

# Reused role coverage
node node_modules/vitest/vitest.mjs run \
  --config tests/acceptance/2068/vitest.config.ts \
  tests/acceptance/322/github.test.ts --reporter=verbose

# Added regression protection
node node_modules/vitest/vitest.mjs run \
  packages/hub/test/prompt-items.test.ts packages/hub/test/replay.test.ts \
  --maxWorkers=1 --no-file-parallelism --reporter=verbose
node node_modules/vitest/vitest.mjs run packages/hub/test/github-deadline.test.ts \
  --maxWorkers=1 --no-file-parallelism --reporter=verbose
```

Builds/tests used the repository's machine throttle. The rebased workspace initially lacked the new `@deepbuild/briefs` workspace link; restoring that install link and rebuilding the affected CLI resolved the setup error. Hub and acceptance typechecks, diff whitespace, and immutable acceptance hashes passed. The code changed no dependency manifests. `core.ts` stays at main's 2,638-line ceiling.

### Affected result — NOT PASS

The source-change `affected --list` reaches over 1,000 files plus a crate. No WIDE line was emitted. Rather than run a whole-core/graphics sweep on this heavily loaded machine, verification explicitly named the sufficient acceptance/regression files:

```sh
node scripts/affected.mjs \
  tests/acceptance/2068/forge-wait.test.ts tests/acceptance/322/github.test.ts \
  packages/hub/test/prompt-items.test.ts packages/hub/test/github-deadline.test.ts \
  packages/hub/test/github-source.test.ts packages/hub/test/prompt-flush.test.ts \
  packages/hub/test/queued.test.ts packages/hub/test/replay.test.ts
```

`affected-result.txt`: **155 new/unlisted findings, 44 known on main, 24 passed** on that snapshot. No WIDE or INCONCLUSIVE line. Three failures were #322 negative controls' `afterEach` cleanup (`ENOTEMPTY`), not role assertions. Cleanup failures also occur on the unmodified merge base (`base-roles-result.txt`); these are inherited/flaky, not excused as passes. The normal owner/outside/bot/paged-membership scenarios pass. An earlier affected run also hit the same cleanup problem in prompt-flush; the subsequent meaningful-change run passed that file, so its history remains inconclusive, not retry-green proof.

The other unlisted findings concern unchanged repository files: stale dependency/size/vendor tables, an existing fixture home path, code mappings, record-reader/closure lints and expired known-failure entries. The last correction (fresh-hook handling after spool replay) was checked by the 10-test regression run and all four acceptance cases, not another whole affected run. **Full source-selected affected, timed/slow/by-hand lanes, full preflight, native UI rendering, mutation and static proof-trace lanes were not run.** The original blind tests use numbered AC names rather than static hash tags; the table above supplies the exact criterion mapping but is not a static trace PASS.

Measurements occurred on an arm64 Mac with Node v24.22.2, with load above its 18 cores. They establish the planted causal ordering, not a reference-Mac latency budget or a statistical speedup. Prior overloaded/inconclusive runs are preserved, not discarded.

## Blind drafting and retained history

The first acceptance job used only the issue, design and a base archive. `tests/acceptance/2068/` remains byte-for-byte unchanged. A one-time blind redraft was requested while the original AC1 was inconclusive; it was written in a separate base archive, without seeing the implementation or dispute. It requires a separately approved numeric oracle and leaves static-tag metadata open, so it was **not adopted**, not run and not used to replace any test. The original check subsequently proved the required base/fix relation unchanged. The unused redraft remains outside the PR; no criterion was dropped.

The old `base-failure.txt`, `first-fix-failure.txt`, `row-fix-result.txt`, `timed-unrun.txt`, `affected-unrun.txt`, `timings.json` and setup/size logs document the initial attempt. They are historical, not current passing evidence. The original dirty worktree was never edited by this task; all changes are on the issue worktree.

Handwritten acceptance + regression + implementation exceeds the ~400-line guideline: the independent real-process fixture, three issue criteria, and essential ordering/replay/cancellation regressions belong to one bug fix. Existing #322 author-role coverage is reused rather than duplicated. Generated command output accounts for most of the PR's remaining lines. No CI is added, no hook settings are written, no failed checks are edited or suppressed, and only owned child PIDs are stopped.
