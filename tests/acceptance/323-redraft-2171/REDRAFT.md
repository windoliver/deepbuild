# #323 AC12, AC13 and AC14 blind redraft (2171): the request you type names the pull request the session opens

`tests/acceptance/323/review.test.ts` has each session type a prompt that names only the code change ("make the auth
middleware reject expired tokens", "… refuse expired tokens"), then open a pull request with `gh pr create`. When the
suite was written that call ran. Since 2026-11-05 (#84) the shipped defaults, `crates/deep-hook/default-rules.json`,
hold `pr-needs-ask` (`effect:pr`, block): "Opening a pull request goes ahead only when the thread's ask names it: a
request authorizes exactly what it names." The design's decisions table says the same (Requests that name an action):
"A request you type authorizes exactly what it names, in that thread: "create PR" covers the push and the PR, not the
merge. Anything it doesn't name is still an authority ask." So the frozen scenarios' `gh pr create` is held at
PreToolUse, the helper returns `allowed: false`, no PostToolUse carries the PR's URL, the hub never learns of the PR,
and no review thread is read. The judges then fail on a missing open item, which is not what they are about. The
redraft keeps every scenario, judge, constant, assertion and message, and has each typed prompt name the pull request.

Written from issue #323 (read live with `gh issue view 323 --repo windoliver/deepbuild`, `updatedAt`
2026-11-19T07:34:45Z: its statement, Scope, the fifteen criteria, Proof, Depends on and Added Oct 9; its comments
and linked pull request are under "The issue's comments" below), the design (`docs/technical-design.md`, the passages found by a search: Open items as records,
Proven on the base, Done means switched on, Questions at the stop, Criteria to tests, Wrong programs, Dogfooding, and
the decisions table row Requests that name an action), `AGENTS.md`, and the frozen `tests/acceptance/323/`:
`review.test.ts`, `github.ts` and `tsconfig.json` in full; `helpers.ts` by a search for its exports and BLOCKED
lines, with `decision`, `replyText`, `Session.call`, `Session.bash` and `begin` read in full; `README.md` and
`BASE-FAILURE.txt` only searched for the review tests' lines. From `crates/deep-hook/default-rules.json`: the
`push-needs-ask` and `pr-needs-ask` entries (the search's context lines also showed the first lines of
`merge-needs-ask` and the two entries' planted and twin calls). For form: `tests/acceptance/1097-redraft-defaults/`
(REDRAFT.md, tsconfig.json), `tests/acceptance/1633/README.md` and the three lines of `reopened.test.ts` that hold its
prompt and its `gh pr create`, and the `scripts/lanes.mjs` lines naming #2204's and #1097's redrafts. A search of
`scripts/lanes.mjs` for "redraft" also printed its `alone` list and the comments on other issues' redrafts; nothing
here was taken from them. I never read `packages/*/src`, `crates/*/src`, any diff, branch, pull request, other
worktree or another session's notes.

**The issue's comments.** The first draft of this file said the issue had no comments or linked pull requests. That
was wrong: I had read only the body. The issue is open and has two comments and one linked pull request, #1208. I read
both comments after the redraft was written, when the mistake was pointed out. Nothing in `review.test.ts` comes from
them. I did not open #1208.

- 2026-11-03: the suite was built in #1208 and passed all 19 of its tests then. That is a word about the work, which a
  blind job shouldn't see; it changed nothing here.
- 2026-11-19, the closed-issue sweep (#2047): no test on main names the issue's criteria by their live IDs, so the
  issue is open again. It lists the live IDs.

**The tags are the original's, not the live ones.** The redraft carries `AC12 #323.9ddcf826`, `AC13 #323.b0a29209` and
`AC14 #323.d6d5ec0c`, imported from `../323/helpers.ts`, so the `describe` titles stay word for word. The sweep's
comment gives the IDs the live criteria hash to today: AC12 `#323.f5ae1695`, AC13 `#323.e39f94f1`, AC14
`#323.043c5f5a`. They differ. So the trace lane holds none of #323's live criteria by this redraft, as it holds none
by the rest of the frozen 323 suite. That gap is #2047's. This redraft doesn't change it.

**What reached this job beyond its inputs.** Two things, both in its instructions:

- The base run's result for the frozen file, 2 failed and 3 passed, with the failing lines and messages, as Proven on
  the base sends a failing check back to its drafting job: AC12 at `twoThreads` `review.test.ts:42` ("the unresolved
  review thread PRRT_kwDOAcme0021a on PR 21 must become one open item … 0 name it; the task's open items are none")
  and AC13 at `judge13` `review.test.ts:99` ("at the first stop both threads are unresolved … PRRT_kwDOAcme0023a has
  none, PRRT_kwDOAcme0023b has none; the task's open items are none"). The two wrong-program tests pass there only
  because the right program fails the judge too.
- A follow-up's corrected cause, which goes beyond file, line and message: the `pr-needs-ask` default (commit
  d6aacc01b, #84, 2026-11-05) denies the session's `gh pr create` with exit 2 ("DeepBuild denied this (guard
  pr-needs-ask): no request you typed in this thread names it …"), and with that one default in watch mode the frozen
  file passes 5 of 5. I checked the entry's text in the defaults file and the design's row. I did not replay the run,
  and I did not read the commit.

## What changed since the suite was written

| Original (path › describe title › it title) | Criterion | Why the old expectation no longer holds | Replaced by |
|---|---|---|---|
| `tests/acceptance/323/review.test.ts` › AC12 #323.9ddcf826 each unresolved review thread on the claim's PR is an open item, and the claim can't pass while one is open › AC12 #323.9ddcf826 PR 21 has two unresolved threads: the stop's claim gets one open item for each, naming the thread and quoting its first comment, and doesn't pass | #323 AC12 | The prompt names no pull request, so `gh pr create` is held by `pr-needs-ask`. The hub never sees PR 21, reads no thread, and the judge fails at line 42 with no open items | `tests/acceptance/323-redraft-2171/review.test.ts` › the same describe › the same title with ` (redraft 2171)` |
| the same file and describe › AC12 #323.9ddcf826 (wrong program) a gate that reads only the PR body (DEEP_HUB_PLANT=pr-body-only) misses both threads and fails this test, naming PRRT_kwDOAcme0021a | #323 AC12 | It passes, but for the wrong reason: the right program fails the same judge with the same message, so the test can't tell the plant from the real gate | the same file › the same describe › the same title with ` (redraft 2171)` |
| the same file › AC13 #323.b0a29209 a thread the session resolves stays open, naming the session; one a reviewer resolves closes › AC13 #323.b0a29209 PRRT_kwDOAcme0023a, resolved by the session's account you-gh, keeps its open item open naming the session; PRRT_kwDOAcme0023b, resolved by maya, closes its item | #323 AC13 | Same cause for PR 23: no thread is read, and the judge fails at line 99, both threads with no item | the same file › the same describe › the same title with ` (redraft 2171)` |
| the same file and describe › AC13 #323.b0a29209 (wrong program) a gate that counts every resolved thread as closed (DEEP_HUB_PLANT=resolved-counts-closed) fails this test, naming PRRT_kwDOAcme0023a | #323 AC13 | It passes only because the judge's first line fails on any program and its message names the thread | the same file › the same describe › the same title with ` (redraft 2171)` |
| the same file › AC14 #323.d6d5ec0c a reply the session tries to post under your name to a review thread is held as one ask › AC14 #323.d6d5ec0c the session's `gh api … /comments/9101/replies`, tried twice, is held at PreToolUse both times, before anything is posted, as one ask | #323 AC14 | Its expectation still holds and it passes on the base. It reads AC13's scenario (`played13`), so it moves with the file; in the old scenario the reply follows a pull request that was never opened | the same file › the same describe › the same title with ` (redraft 2171)` |

### The wording choice

- `PROMPT_12`: `make the auth middleware reject expired tokens and open a pull request`
- `PROMPT_13`: `make the auth middleware refuse expired tokens and open a pull request`

Why these words:

- **They are the original prompts with one clause added.** The clause is #1633's, whose suite words its prompt "Fix
  <link> and open a pull request" for the same default (`tests/acceptance/1633/README.md`, The scenario).
- **They name the pull request and nothing else.** By the design's row a request that names the PR covers the push
  and the PR. It doesn't cover a reply, a merge or resolving a thread. So AC14's `gh api … /replies` is still a send
  no request names, and is still held as one ask.
- **They add no open item.** The clause is none of the things #323's Scope turns into open items: no "still open"
  section, no placeholder, no follow-up, no limit. The final messages are the originals'.
- **The handed definition is unchanged.** `draft(PROMPT)` is keyed by the prompt's exact text, and both the draft and
  `begin` take the same constant, so each scenario is still handed R1 with its drafted check.

### The BLOCKED line for a held `gh pr create`

Added: `prOpened(await s.bash('gh pr create …'), AC…)` throws `BLOCKED: … the session's gh pr create must be allowed,
since the request you typed names the pull request: <the hook's exit, stdout and stderr>` when the call isn't allowed.
Why:

- It is the suite's own convention. `helpers.ts` does the same for the scenario's own steps: a denied Read, Edit,
  Write or TodoWrite is `BLOCKED:` with `shown(r.before)`. The pull request is such a step here: no criterion of the
  three is about whether it may be opened.
- A held pull request then reads as what it is. It can't again look like a missing open item, and `failureOf` throws a
  `BLOCKED:` message on, so a wrong-program test can't pass on it either.
- It is not applied to the reply (AC14 judges that call) or to the `resolveReviewThread` call, which the original
  doesn't check; that line is unchanged.

## Kept as they are

- **The file runs in its original's place.** It holds all five tests of `review.test.ts`, so the frozen file can be
  kept as written, by hand only, as #1097's and #2204's first drafts are (`scripts/lanes.mjs`, their `byHand` lines).
  The implementer adds that line and puts this folder where the lanes need it; this job doesn't edit `lanes.mjs`.
- Each scenario (`twoThreads`, `resolvedThreads`), each judge (`judge13`, the AC12 and AC14 judgements), the threads,
  `PR_BODY`, `REPLY`, `RESOLVE`, the titles and bodies of the pull requests, the final messages, the plants
  (`pr-body-only`, `resolved-counts-closed`) and every expectation and message are the original's, copied exactly.
  The lines that differ, all of them: the head comment; the two import paths; the new `prOpened` function with its
  doc comment (four lines after `PR_BODY`); the two prompts; one new comment line above each prompt; the two
  `gh pr create` lines, wrapped in `prOpened`; and the five `it` titles.
- Everything else is imported unchanged from `../323/helpers.ts` and `../323/github.ts`.
- The `describe` titles are the originals' word for word, with the tags `AC12 #323.9ddcf826`, `AC13 #323.b0a29209`
  and `AC14 #323.d6d5ec0c`. Each `it` title is the original's with ` (redraft 2171)`.
- Not redrafted: the suite's other files. None was named in the dispute.

## Not known to this job

- Whether a prompt that names a pull request changes anything else the hub does with the task (a deliverable, a
  requirement, an ask). The design's row says only what the request authorizes. If it does, the run will show it.
- Whether the session's `resolveReviewThread` call is let through by today's defaults. The original doesn't check it
  and AC13 doesn't need it to run: GitHub's recorded answers say who resolved each thread.

## Run

```sh
npx vitest run --root tests/acceptance/323-redraft-2171 review.test.ts --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/323-redraft-2171/tsconfig.json
```

With the setup of `tests/acceptance/323/README.md` (the hub and CLI built, `target/debug/deep-hook` built). 5 tests in
1 file. The type-check is clean; the tests were not run by this job. `RUNS.txt` in this folder holds runs recorded by
the implementer, not by this job; I did not read it.
