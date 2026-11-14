# Acceptance tests for #1881 on the real hub: the cut-off turn's pull request lookup

Written blind from issue #1881 (read live on November 10, 2026), `docs/technical-design.md` at the base `f6988e1a6` (An ask, and your answer getting back: the paragraph **Tasks close themselves.**, its "an identical send … is denied at PreToolUse with the earlier result: a pull request the forge holds for the session's branch when the hub can read one within the gate's hold, else the outcome unknown"; and Dogfooding), and the base, read only to learn how to drive the hub and what it records: `tests/acceptance/85/hub/README.md` (Criteria 13 and 15: the cut-off turn), `tests/acceptance/85/hub/cutoff.test.ts` and `helpers.ts`, `packages/hub/src/server.ts` (`DEEP_HUB_TEST_FORGE` becomes the core's `forge`, the REST root every forge read uses), `packages/hub/src/core.ts` (`resent`, `pullFor`, `openedPr`, `appendReading`) and `packages/hub/src/forge.ts` (`Forge.pullFor`'s request). The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft by this job.

## Run

```sh
npm ci
npm run build --workspaces
cargo build -p deep-hook   # the hub won't start without a built deep-hook under target/
node node_modules/vitest/vitest.mjs run tests/acceptance/1881 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1881/tsconfig.json
```

The real clock; each run of the scenario takes several seconds (the third test runs it three times). Hook lines are written to the socket as deep-hook writes them, so the tests never run deep-hook, but `deep hub run` at the base refuses to start without one built (`no deep-hook is built under …/target; run cargo build -p deep-hook first`). `BASE-FAILURE.txt` holds the base run.

## What's real and what's faked

The hub (`deep hub run` in a temporary HOME), its socket, its record and the session's working folder are real: a git checkout made by `git init`, one commit on `main`, then branch `fix-cart-total` checked out; for AC1 an `origin` remote `https://github.com/acme/cart.git`, for AC2 no remote at all. The hub is started with `DEEP_HUB_TEST_FORGE` naming **the stand-in forge** (`startForge`), the one boundary faked: a GitHub-shaped REST API on 127.0.0.1 that holds pull requests under `acme/cart` only. `GET /repos/acme/cart/pulls` lists them with GitHub's `state` and `head` (`owner:branch`) filters, `POST` opens one, `/pulls/<n>` reads one, and any other path is GitHub's 404. It logs every request's method and path with its query. The test's own `gh pr create` (`ghPrCreate`, one POST, as #85's suite runs it) carries a header of its own and is left out of the log, so the log holds only what the hub asked. **The Claude Code stand-in** is #85's: hook lines and the transcript as Claude Code writes them, and the waiter. No forge token reaches the hub (`GH_TOKEN` and `GITHUB_TOKEN` are dropped; the hub reads `gh auth token` only in your own home). Every port comes from the OS, processes are stopped by PID, and nothing leaves 127.0.0.1.

## The scenario

#85's cut-off turn (`cutOffTurn`): turn 1 you typed ends normally and the waiter runs; turn 2 you typed ("Fix the cart total and open the PR.") runs `git status` to its end, then `gh pr create --title "Fix the cart total" --body "Sums the cart with tax"`, which is let through at PreToolUse and runs (with an origin, the forge gets PR #1, `https://github.com/acme/cart/pull/1`, head `fix-cart-total`), and the connection drops before PostToolUse (`StopFailure`, `server_error`, the API host reachable). The hub continues the session (`session.continued`, `because: transient`), the waiter wakes it, the agent takes the wake's turn and sends the identical `gh pr create`. The test reads the hub's PreToolUse reply to it, waits 2 s for any late request to land, and reads the forge's log and the session's readings.

## The surfaces read

- **The forge's request log**: every request the hub made, as `METHOD path?query`.
- **"Records that pull request's URL"**: the record's `session.reading` events for the session. On the base, a PR the hub learns a session opened is recorded there (`openedPr` appends the reading `Opened pull request <url>`, which the receipt reads back), both off a `gh pr create`'s own PostToolUse and when the cut-off lookup finds one. The test asks for a reading holding the URL; its wording isn't held.
- **The hub's reply to the identical call** (hook.reply@2), read as #85's suite reads it: `denies` (exit 2, or `decision: block` / `permissionDecision: deny`) and `replyWords`.

## How the design and the issue were read

- **"Under the origin's owner and name"**: the stand-in serves `/repos/acme/cart/…` for an origin `https://github.com/acme/cart.git`, as GitHub's API names a repo. Lowercase throughout, so case folding can't decide a run.
- **The proof's "request path"**: every assertion message carries the forge's log, so a failure names the path the hub asked. AC1 also asserts a `GET` whose path starts `/repos/acme/cart/pulls`: the issue's title, "the lookup asks the forge by owner and name". The query isn't held; the stand-in honours GitHub's `head` filter, so a `head` naming another owner finds nothing, as it would on GitHub.
- **AC1's "records that pull request's URL"** is asserted with the design's "denied at PreToolUse with the earlier result: a pull request the forge holds": the identical call is denied, its words hold the URL, and the forge holds one PR at the end (if the reply let it through, the test's gh would open a second).
- **AC2's "receives no request"** covers the whole run, from the hub's start to 2 s after the identical call's reply. With no remote the hub can't read a pull request, so by the design's "else the outcome unknown" the identical call is still denied and its words name `gh pr create`; this is asserted after the request check, so a run that makes a request fails at the request.
- **The cut-off `gh pr create` in a checkout with no remote** opens nothing (gh has no repo to open one in), so AC2's forge holds no PR and gets no POST.
- **Preconditions** (#85's behaviour the scenario needs: the first call let through, the one automatic continue, the waiter's wake) are asserted with messages starting `precondition:`, so a failure there doesn't read as this issue's.

## Criteria, tests and wrong programs

| Criterion | Test | Wrong programs it fails on | On the base |
|---|---|---|---|
| AC1 | `AC1: with the forge holding one open PR …` | the base: the lookup names the repo by the scope ID | FAIL: `AC1: the cut-off turn records the pull request's URL https://github.com/acme/cart/pull/1 (the forge received: GET /repos/cartwork21cc828f/pulls?state=all&head=cartwork21cc828f%3Afix-cart-total&per_page=10; …)`; the identical call is denied as outcome unknown |
| AC2 | `AC2: in a checkout with no remote, the stand-in forge receives no request` | the base: it asks `/repos/<scope ID>/pulls` with no remote too | FAIL: `AC2: … receives no request; it received: GET /repos/cartwork96ce56d4/pulls?…` |
| AC2 | `AC2 fails on a lookup that reaches the forge …` | planted at the test's side around the real hub: a lookup that asks `/repos/cart-work/pulls` as the identical call goes out (fails naming that path); a reply that lets the identical call run (fails at the denial) | FAIL at its first, unplanted run, as the AC2 test does |
| AC3 | none here | #85's suites (`tests/acceptance/85/hub/cutoff.test.ts` and the rest), run unchanged by the implementer | not run by this job |

The lookup was the only request the base hub made to the stand-in forge in every run. To check that the three tests can pass, this job also ran them once against a throwaway one-line change to the compiled hub (the lookup named by the origin's owner and name from `forgeOf`, nothing when there is none), restored afterwards and never committed: 3 of 3 passed, both plants rejecting with the expected messages. That change isn't a proposed implementation.

## Not covered here

- AC3 ("#85's suites pass unchanged"): this job writes no test for it.
- The gate's hold (`within the gate's hold`): the stand-in answers at once; a forge slower than the hold isn't driven.
- A remote other than `origin`, an SSH origin URL, and a host other than github.com: the issue names the origin's owner and name only.
- A real `gh`: its POST is the test's stand-in, as in #85's suite.

## Files

- `helpers.ts`: the hub (with `DEEP_HUB_TEST_FORGE` passed through `extra`), hook lines, the waiter, the record, the git checkout, tool calls as Claude Code's hooks and transcript report them, the stand-in forge and `gh pr create`'s POST. Copied from `tests/acceptance/85/hub/helpers.ts` where they match.
- `lookup.test.ts`: three tests.
- `BASE-FAILURE.txt`: the base run, trimmed to each failure's reason.
