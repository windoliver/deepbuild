# #2068 — closure evidence

All three issue criteria are proven on the final source. The original blind acceptance files are unchanged (`acceptance.sha256`). [Machine-checked criterion/result mapping](closure/criterion-results.json) and the raw Vitest JSON accompany the output. This is not a claim that the separate static-tag trace or release preflight ran.

**Comparison base:** `2baafea73726387c4fabe5057599be0831774f0a`. The branch was rebased before the run; it then added the five-line shutdown correction below. Both sides built their own workspace packages and `deep-hook`. [Final source hashes](closure/source.sha256) pin the tested files. No product behavior depends on a test flag.

## Requirement → change → proof

| Criterion | Change | Check result |
|---|---|---|
| AC1 `#2068.3406ba1b`: A names an issue, B arrives 100 ms later, 5 s per forge request; B records before the first answer, base fails naming its wait | Prepare issue data before the shared hook chain; a reply waits only for its own intake. Preserve same-session order without blocking another session. | [Base](closure/base-acceptance.txt): B waited **25,004 ms after arrival**, after the whole read; assertion failed naming the wait. [Final head](closure/final-acceptance.txt): B waited **6.8 ms**, first forge answer at **5,032 ms after A**; unchanged test passed. |
| AC2 `#2068.b095ccdc`: a never-answering forge yields recorded A and a task from your words by the read deadline, with an unread-issue session row | One 1,000 ms abort signal covers credential acquisition, requests, response bodies and all pages. Discard partial readings, create the words task, and record/show the issue warning. | Base A appears at **20,016 ms**, with no fallback by its hold and no warning; assertions fail. Head A appears at **1,022 ms**, its task is linked, and `rows.read` carries the warning, within the existing **2,001 ms** advertised hold. Endless-pagination case also passes. |
| AC3 `#2068.865fe586`: immediate source retains criteria and every author's provider-derived role | Retain existing `readIssue` criteria/membership logic; bind prepared data to the requested URL and authenticated person/app origin. | Instant HTTP owner/page-2 collaborator twin passes on both sides. All **six unchanged #322 role/negative-control cases pass on both sides**: outside comments/owner, forged role text, every-author-collaborator, automated collaborators and complete/incomplete membership pages. |

The acceptance entry ran **10 tests, 10 passed, 0 failed, 0 skipped** on the final head. The same entry on base ran **10 tests: 3 expected failures at the wait/fallback assertions, 7 guards passed, 0 skipped**. No failure on setup/imports is counted as proof.

The one-second duration is an implementation choice inside the existing two-second prompt hold, not a number invented as an issue requirement. The independent acceptance draft uses that public outer hold. The measured record visibility is actual committed SQLite visibility, not ACK time or an event's backdated timestamp. These are causal scenario readings, not a statistical speedup or reference-Mac p95 claim.

## Gaps closed since the draft PR

- **Fresh comparison after rebase:** both sides above use the same current merge base, dependency environment and unchanged checks.
- **Parallel timing interference:** the acceptance file's own serial config and the affected run's documented `VITEST_MAX_WORKERS=1` schedule one file at a time. No scenario timer, timeout, expected value or test body changed. Earlier INCONCLUSIVE runs remain in this folder as history.
- **#322 cleanup:** prior leftovers were real Claude auth/plugin-probe outputs. The hermetic PATH excludes personal executable directories, `claude` and `gh` on both sides; no real credentials or agent runs are needed for these fixtures. All six reused role tests now pass; no cleanup code was changed.
- **Words-task shutdown:** one prompt-flush cleanup failure remained even with that environment. Its leftover was a workspace's `.git/objects`: asynchronous task initialization outlived the clean hub stop. A deterministic real-component regression gated only external `git`, failed at the assertion that `workspace.created` precedes `hub.stopped`, then passed unchanged after shutdown began draining `AskTasks.locking`. See [before](closure/workspace-stop-before.txt) and [after](closure/workspace-stop-after.txt). The unchanged prompt-flush tests pass too. The fix is four lines in `ask-tasks.ts` and one shutdown await in `core.ts`; core remains at main's 2,638-line ceiling.
- **Regression protection:** final selected run covers same-session order, no duplicate read on replay, live/spool/startup deadlocks, fresh hooks after replay, authenticated app-note criteria, canonical HTTP/HTTPS URLs, late transcript replies, credential-child/body cancellation, queued prompts and clean workspace shutdown. Earlier corrections each retained their failing output and passed unchanged tests.

These changes belong at the existing hook/ask scheduling boundary: an extension cannot release a chain the core is awaiting. No new dependency, product option, flag, configuration key, schema, CI workflow or repository hook setting was added.

## Affected verification: all selected tests pass; inherited lint is not PASS

Run on **both base and head**, with the same hermetic PATH, `VITEST_MAX_WORKERS=1`, `DEEP_SHARDS=1` and the unmodified runner:

```sh
node scripts/affected.mjs \
  tests/acceptance/2068/forge-wait.test.ts tests/acceptance/322/github.test.ts \
  packages/hub/test/prompt-items.test.ts packages/hub/test/prompt-start-replay.test.ts \
  packages/hub/test/github-deadline.test.ts packages/hub/test/github-source.test.ts \
  packages/hub/test/prompt-flush.test.ts packages/hub/test/queued.test.ts \
  packages/hub/test/replay.test.ts packages/hub/test/prompt-workspace-stop.test.ts
```

**Final head: 31 tests passed, zero failed/skipped/unrun tests, no WIDE or INCONCLUSIVE line.** It includes #322's coverage test selected by the runner in addition to the named files. Base's required fix tests fail; guards pass. JSONL reports are in `closure/head-vitest*.jsonl` and `closure/base-vitest*.jsonl`.

The raw affected command still exits FAIL on **151 unlisted + 44 known lint findings**, not on these tests. The pinned base has all of them too. [Comparison](closure/affected-comparison.json): **195 inherited lint findings, zero introduced lint findings, zero head test failures, zero WIDE/unrun findings**. They concern unrelated dependency/vendor/size/mapping/closure tables and expired known-failure entries. Nothing was whitelisted, deleted, weakened or recorded as PASS. One canvas-closures log interleaves its lease prefix with the same base drift diagnostic because two jobs share its filename; both raw logs and the normalization are disclosed.

The complete source-selection listing reaches over 1,000 files and a crate through the shared core; verification ran the explicitly mapped sufficient files above, **not that whole sweep**. Full source-selected affected, timed/slow/by-hand neighboring lanes, full preflight, native app rendering, mutation and repository static-tag trace are **unrun**. The original blind tests use numbered AC names rather than literal hash tags. `closure/criterion-results.json` independently checks report identities and named base assertion failures against all three issue texts; it is not a static trace-lane PASS. Issue closure is supported by these actual acceptance results, not by the agent's statement or a green repository-wide verdict.

## Reproduce

Use Node 24.22.2 and Rust 1.99.1. Set PATH to those toolchain directories plus system utilities only, not personal agent binaries; remove inherited forge tokens/agent billing variables. The exact redacted environment is [recorded](closure/hermetic-env.json).

```sh
npm run build --workspaces
cargo build --locked -q -p deep-hook -j 2
node node_modules/vitest/vitest.mjs run \
  --config tests/acceptance/2068/vitest.config.ts --reporter=verbose
node node_modules/typescript/bin/tsc -p packages/hub/tsconfig.json
node node_modules/typescript/bin/tsc -p tests/acceptance/2068/tsconfig.json
```

Commands ran through the repository's machine throttle. Build-slot waiting is excluded from scenario timing. Mac arm64 load was above 18 cores; no reference-machine budget is claimed. The final whole acceptance run was repeated only after the meaningful shutdown correction; every prior failed/inconclusive result remains recorded. Hub and acceptance typechecks and `git diff --check` passed.

## Provenance, scope and history

The first blind job saw only issue/design/base `1c4d1f0e2aaad8c6a6573848823566d04ff73d17`; its files remain byte-for-byte unchanged. A one-time blind redraft was requested during the earlier timing dispute but was not adopted: it demanded a numeric oracle not specified by the issue and left tag metadata open. The original tests subsequently proved the required relation without modification. No criterion was dropped.

Files outside `closure/` retain the earlier attempt and rebased runs. Their red/inconclusive results are historical, never silently replaced with PASS. `closure/` is the current evidence. Separate pre-existing behavior remains outside this issue: issue links first discovered only in intake-created transcript/app-note drafts lack source reads on the base too; network-stop-only parked jobs can wait for cancellation. Neither changes this issue's required ordinary-prompt scenarios or is claimed fixed.

Handwritten implementation plus independent acceptance and regression fixtures exceeds the ~400-line guideline because the real-process harness and ordering/replay/cancellation proof belong to this one fix. Existing author-role coverage is reused. Most PR lines are retained command output. The original dirty worktree was not edited; only owned child processes were stopped. No issue is closed by hand: the PR may now say `Closes #2068` for merge.
