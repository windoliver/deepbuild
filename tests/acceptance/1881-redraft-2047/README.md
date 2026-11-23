# Blind redraft of #1881's acceptance tests, for the closed-issue sweep (#2047)

Written blind at the base `8b9f8d6c7` (origin/main, which already holds #1881's fix), from issue #1881 as read live on
November 23, 2026, `docs/technical-design.md` (An ask, and your answer getting back: **Tasks close themselves.**; How we
know version 0 works: Dogfooding), AGENTS.md and the base. The sweep (`scripts/closed-sweep.mjs`) reopened #1881
because no test on main names its criteria's live IDs. The first draft, `tests/acceptance/1881/`, was read as the first
draft; this folder is a suite of its own and names all three IDs. The job read no pull request, commit message or diff
about #1881 and no session transcript. Read from the base only to learn how to drive the hub and what it records:
`tests/acceptance/85/` (its READMEs, `hub/cutoff.test.ts`, `hub/helpers.ts`), `packages/hub/src/answer-delivery.ts`
(`resent`, `pullFor`), `packages/hub/src/paths.ts` (`forgeOf`, `repoOf`), `packages/hub/src/forge.ts`
(`Forge.pullFor`), `packages/hub/src/stop-judging.ts` (`openedPr`), and for the house format
`tests/acceptance/1297-redraft-2047/` and `tests/acceptance/1421-redraft-2047/`. The implementing agent doesn't edit
these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

## Criteria to tests

IDs are `#1881.` and the first 8 hex digits of SHA-256 of each criterion's text, trimmed and whitespace collapsed
(`criterionId` in `scripts/proof-change.mjs`), recomputed from the live body. Each test's name starts with its ID.

| ID | Criterion | Test | Twin |
|---|---|---|---|
| `#1881.6ee547f4` | With a stand-in forge that holds one open pull request for the session's branch under the origin's owner and name, a cut-off turn records that pull request's URL. On the merge base the request goes to `/repos/<scope ID>/pulls` and finds none | `lookup.test.ts`, first test: the session's record holds one `session.reading` naming `https://github.com/acme/cart/pull/1`, and the forge was asked `GET /repos/acme/cart/pulls…` | `scope-id-lookup` |
| `#1881.5d46b7e2` | In a checkout with no remote, the stand-in forge receives no request | `lookup.test.ts`, second test: the forge's request log is empty for the whole run | `no-remote-asks-by-scope-id` |
| `#1881.e56f5a3e` | #85's suites pass unchanged | `suites85.test.ts`, one test: #85's files keep the base's bytes, and every test in every #85 test file but one passes when the checkout's own vitest runs them. The one left out, #85's criterion 12 reference-Mac budget measurement, is **open** here (below) | `no-remote-reads-as-none` |

## The scenario (`lookup.test.ts`)

#85's cut-off turn, on `deep hub run` in a temporary home started with `DEEP_HUB_TEST_FORGE` naming the stand-in forge.
The session's working folder is a real git checkout (`git init`, one commit on `main`, branch `fix-cart-total`), with an
`origin` remote `https://github.com/acme/cart.git` for `#1881.6ee547f4` and no remote for `#1881.5d46b7e2`. Turn 1 you
typed ends; the waiter (`session.wait`) starts; turn 2 you typed runs `git status` to its end, then `gh pr create`, let
through at PreToolUse; with an origin, gh opens PR #1 for the branch on the forge (one POST under `acme/cart`, as #85's
suite runs gh); the connection drops (`StopFailure`, `server_error`, the API host reachable). The hub continues the
session once (`session.continued`, `because: transient`) and the waiter wakes; the agent takes the wake's turn and sends
the identical `gh pr create`. That PreToolUse is where the hub looks the branch's pull request up; the test then reads
the forge's log and the session's readings.

- **The stand-in forge** is the one faked boundary (the issue names it): GitHub-shaped on 127.0.0.1, holding pull
  requests under `acme/cart` only; `GET /repos/acme/cart/pulls` honours GitHub's `state` and `head` (`owner:branch`)
  filters, any other path is a 404. It logs every request except the test's own gh POST (which carries a header of the
  test's), so the log is what the hub asked.
- **"Records that pull request's URL"**: the record's `session.reading` events for the session (`openedPr` appends
  `Opened pull request <url>`); the test asks for exactly one reading holding the URL, not its wording.
- **"The request goes to"**: the first test also asserts a `GET` whose path starts `/repos/acme/cart/pulls` (the
  issue's Proof: "the request path it made"); every failure message prints the forge's log. The criterion's second
  sentence describes the merge base; the `scope-id-lookup` twin is that program, and the run below shows its request.
- **"Receives no request"** covers the whole run, the hub's start to the identical call's reply. The hub awaits the
  lookup before it replies, so no settle wait follows. A precondition (asserted after the log) checks the identical
  call reached the hub's resend check and was denied, so the test can't pass on a hub that never gets there.
- **Preconditions** (#85's behaviour the scenario needs) have messages starting `precondition:`.
- No fixed waits: the waiter's request is written before turn 2 starts (`sent`), turn 1's hooks are stamped before the
  waiter's `since`, and the continue is the waiter's wake, bounded by #85's 15 s (`within`, a `// deadline:` timer).

## #1881.e56f5a3e: "#85's suites pass unchanged" (`suites85.test.ts`)

The criterion names its own check, so the test runs #85's suites rather than a copy, as
`tests/acceptance/1297-redraft-2047/ac2-shadow-edge.test.ts` does for its "suites pass unchanged" criterion (the
precedent found by `git grep -n "suites pass" -- tests/acceptance`; `tests/acceptance/1879/floor.test.ts` is another).

- **Unchanged** is held on the bytes: every `.ts` and `tsconfig.json` under `tests/acceptance/85/` has its SHA-256 at
  the base (READMEs and BASE-FAILURE files are not pinned; they don't change what runs).
- **Pass** is: the checkout's own vitest runs all 17 #85 test files, one at a time, with `--testTimeout=240000` (the
  longest #85's READMEs give), and every test passes: none failed, skipped or missing, and each file reports tests.
- **Left out, and open: #85's criterion 12 measurement** (`budgets.test.ts`, "on the reference Mac, a task closes
  within 10 s …"). No tagged test of this suite holds it, because none could be proven by the before lane
  (`scripts/proof-runs.mjs`: a tagged test must pass on the change and fail at its assertion on the merge base or a
  twin; one that skips as it runs reads INCONCLUSIVE, and one that passes everywhere reads FAIL):
  - It takes a reading only on a reference Mac (Mac15,7 or Mac15,12) with Low Power Mode off, thermal state nominal and
    the Mac not loaded past its core count, and skips as INCONCLUSIVE otherwise, or when its runs straddle a limit. So
    off a reference Mac a test over it skips on every run.
  - It drives the asks core and the record directly and never reaches the hub's pull request lookup, the code #1881
    changes. No twin of #1881's can make it fail, so on a reference Mac a test over it passes on every twin.

  So `suites85.test.ts` leaves it out of its run (vitest's `--testNamePattern` with a negative lookahead on its name)
  and out of its judgement. Whether #85's criterion 12 still holds after #1881 is for `budgets.test.ts` itself, run on
  a reference Mac by #85's own lane; this suite does not prove that part of "#85's suites pass unchanged". An earlier
  draft of this folder held it with a second tagged test that skipped (and before that failed) as INCONCLUSIVE off a
  reference Mac; that test could never be proven, so it was dropped.
- **Time:** the one test runs #85's other 40 tests in about 4 to 8 minutes here (load 25 to 190), inside the before
  lane's 20-minute vitest cap (`scripts/proof-runs.mjs`) with `lookup.test.ts`'s 10 s, but not with a wide margin on a
  heavily loaded Mac.

## Twins

`twins.json` maps each ID to a planted wrong program: the base's whole `packages/hub/src/answer-delivery.ts` with one
change in `pullFor`'s lookup.

| Twin | The wrong program | ID |
|---|---|---|
| `scope-id-lookup` | the merge base's lookup: `const repo = repoOf(meta.cwd)`, the decision scope's ID (folder name and path digest) | `#1881.6ee547f4` |
| `no-remote-asks-by-scope-id` | owner and name from the origin, but with no remote it falls back to the scope ID and asks the forge | `#1881.5d46b7e2` |
| `no-remote-reads-as-none` | a lookup with no repo (no remote) or no branch answers "the forge holds none" (`null`) instead of "can't be read", so the cut-off turn's `gh pr create` is let through again; #85's `hub/cutoff.test.ts` sees a second PR | `#1881.e56f5a3e` |

## What was run

On this Mac (Apple M5 Max, macOS 27.2, not one of #85's reference Macs), at the base, `RUNS.txt` has the detail:

| ID | Test | Base | Its twin laid over the base |
|---|---|---|---|
| `#1881.6ee547f4` | `lookup.test.ts` first | pass | `scope-id-lookup`: fails at its first `expect`: no reading names the PR; the forge got `GET /repos/cartwork<digest>/pulls?…` and nothing else |
| `#1881.5d46b7e2` | `lookup.test.ts` second | pass | `no-remote-asks-by-scope-id`: fails at its first `expect`, the log holding `GET /repos/cartwork<digest>/pulls?…` (the first test passes on this twin) |
| `#1881.e56f5a3e` | `suites85.test.ts` | pass (all 40 judged #85 tests, 17 files; RUNS.txt) | `no-remote-reads-as-none`: fails at its `expect`: 38 of 40 passed, both of #85's `hub/cutoff.test.ts` tests failing with "the forge receives one PR: … opens a second" |

The `scope-id-lookup` twin also fails `#1881.5d46b7e2`, and `no-remote-reads-as-none` also fails it (at its
precondition: the identical call is let through). After each twin the source was restored (`git diff --stat` empty)
and the workspaces rebuilt. `tsc -p tests/acceptance/1881-redraft-2047/tsconfig.json`: exit 0; each twin builds.

## Run them

```sh
npm ci
npm run build --workspaces --if-present
cargo build --locked -p deep-hook      # deep hub run refuses to start without a built deep-hook
node node_modules/vitest/vitest.mjs run --no-file-parallelism tests/acceptance/1881-redraft-2047/
node node_modules/typescript/bin/tsc -p tests/acceptance/1881-redraft-2047/tsconfig.json
```

`suites85.test.ts` runs all of #85's files (about 4 to 8 minutes here; its hub tests start hubs of their own), so it
belongs in a lane that runs alone; this job doesn't edit `scripts/lanes.mjs` (its edits need a signed
tag). Each hub here runs in its own temporary home, every port comes from the OS, processes are stopped by PID, and
nothing leaves 127.0.0.1.

## Not covered here

- A remote other than `origin`, an SSH origin URL, a host other than github.com: the issue names the origin's owner and
  name only.
- A forge slower than the gate's hold: the stand-in answers at once.
- #85's criterion 12 budget measurement: left out and open (above).
