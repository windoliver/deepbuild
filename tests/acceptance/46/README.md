# Acceptance tests for #46: verdicts as commit statuses, and GitHub's record of each push

Written first, blind, at base commit `c12a65bb` ("Merge pull request #1281 …"), from the issue, the design and the base
alone, before any implementation. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a
blind redraft of this job.

## What was read

- Issue #46 as given to this job: Scope, its 11 checkbox criteria (AC1 to AC11, in issue order), Proof, Depends on.
- `docs/technical-design.md`: First-party extensions that ship on by default (the `github` row above all), Threats (the
  rows on what a command's children do and Untrusted PR heads), Decided, Pinned to a commit, Work source
  (`push.record@1`), the slot table's `deep.registerSource` rows, Dogfooding, and Numbers (the timing rule).
- The base: `packages/gate/src/head.ts`, `packages/hub/src/forge.ts`, `github-source.ts`, `gate-runner.ts`, `core.ts`
  (`test.verdict`, `verdict.made`, `offer`, the waiter), `plant.ts`, `packages/contracts/schemas`
  (`push.record@1`, `verdict.made@1`, `open_item.opened@3`), `packages/extension-host/src/sources.ts`,
  `crates/deep-hook/default-rules.json`, `scripts/lanes.mjs`.
- The conventions and helpers of `tests/acceptance/27`, `29`, `83`, `364`, `883` and `packages/hub/test/gate-stop.test.ts`.

## How to run

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # the hub and the CLI run from dist/
cargo build --locked -p deep-hook
node node_modules/vitest/vitest.mjs run --root tests/acceptance/46 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/46/tsconfig.json
```

Use the repo's Node (`.node-version`, 24.22.0). With `--root` here Vitest writes its cache to
`tests/acceptance/46/.vite/`; delete it before committing. Nothing reaches `api.github.com` but `live.test.ts`, which
only runs when you name a test repo. Temp folders are `/tmp/dh46-*`; every process a test starts is stopped by its PID
or its process group, never by name or port.

A real check runs Node in the platform sandbox. A Mac whose Node links libraries outside its own folder (Homebrew's
`node@24`) can't start it there, so the run is uncounted and the verdict INCONCLUSIVE. The one test that needs a real
PASS then reads BLOCKED, never a pass (`World.gatePass`); AC10's scenario follows whichever verdict the gate made.

## The surface under test

The issue names behaviors and no API. These tests define the smallest surface they need, in three parts. Everything else
is reached through what exists at the base: `deep hub run`, `deep setup`, deep-hook, `events.read`, `test.verdict`
(`DEEP_HUB_TEST_VERDICT=1`), `deep_claim`, `deep_open_item`, and `DEEP_HUB_TEST_FORGE=<url>`, the REST root the hub's forge
calls use, with its token from `GH_TOKEN`, as the hub's other forge calls take it.

### 1. A new workspace package, `@deepbuild/github`, at `packages/github/src/index.ts`

```ts
import type { ProviderPush, PushRecordReader } from '@deepbuild/gate';

/**
 * GitHub's record of each push of `repo` (owner/name) and of the forks that open pull requests into it, one entry per
 * pushed commit, through the REST routes below: `recorded.pusher` is the forge's actor for the push (null when it has
 * none), `recorded.repo` the repo that took the push, `recorded.fork` whether that repo is a fork, and `author` and
 * `committer` the commit's accounts.
 */
export function githubPushes(o: { api: string; token?: string; repo: string }): Promise<ProviderPush[]>;
/**
 * The reader that turns those into `push.record@1` readings, `{ commit, pusher }` and no other field, an empty pusher
 * null. `plant` selects the wrong program, as @deepbuild/gate's HeadPlant does: 'author-as-pusher' reads each commit's
 * author as its pusher. Tests only.
 */
export function githubPushReader(o?: { plant?: 'author-as-pusher' }): PushRecordReader;
```

`ProviderPush`, `PushRecordReader`, `headTrust` and `runPushRecordKit` are `@deepbuild/gate`'s, unchanged.

### 2. What the hub does, with the fixture forge as GitHub

**Which repo.** A session's repo is `owner/name` from `git remote get-url origin`, read as the base's `forgeRepos` reads
it: `/github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?$/`. The world's origin is a local path ending
`github.com/acme/shop.git`, so `git fetch` and `git push` are real and never leave the machine.

**The delivery rule and your accounts** are in your settings, `~/.deepbuild/config.json`, read at each verdict and each
head-trust decision, so a change needs no restart:

```json
{ "github": { "delivery": { "acme/shop": "on" }, "yours": ["maya"] } }
```

`delivery["owner/name"]` is `"on"` or `"off"`. Absent or `"off"`, nothing is written to GitHub for that repo, public or
private. `yours` is the `yours` of `headTrust`.

**A status.** Each `verdict.made` in the record posts one `POST /repos/{owner}/{repo}/statuses/{sha}` with a bearer token:

| The verdict | `state` | `description` holds |
|---|---|---|
| PASS on a head that isn't held as untrusted | `success` | `PASS`, and any open items |
| INCONCLUSIVE, BLOCKED | `pending` | the verdict's word, and any open items |
| FAIL, INVALID | `failure` or `error` | the verdict's word, and any open items |
| any verdict on a head `headTrust` doesn't trust | `pending` | `untrusted head` |

- `context` is `deepbuild/verdict`, always.
- `sha` is the verdict's `commit` when that commit is pushed. A verdict whose commit isn't pushed, a snapshot's above all,
  holds its status until a pushed commit has the same tree, and posts it there. Nothing is posted on HEAD for being HEAD.
- Open items are the `open_item.opened` events of the claim's task with no closing event. GitHub refuses a description
  past 140 characters, so a list that doesn't fit is cut: the verdict's word stays, and the number of open items is named.
- Head trust is `headTrust` over the commits since the default branch: `recorded` from the record's `commit.made`,
  `provider` from the push readings, `yours` from your settings. The tests read only the status it leads to.
- A rate limit (a 429, or a 403 with `Retry-After` or with `X-RateLimit-Remaining: 0` and `X-RateLimit-Reset`) stops every
  POST until it lifts; then each verdict waiting posts once.
- The hub makes no read that names the commit before its POST, and changes no branch protection or ruleset. Its push
  reads go through `activity`, `compare`, the commits list and a PR's commits, never `commits/{sha}`, so the calls a
  verdict costs can be counted.

**A conflict.** While a session is idle, the hub reads its branch's open pull request often enough that a PR that stops
merging wakes it within 60 s of the base moving, through the session's waiter, as an answer does. `mergeable` is null
until GitHub has computed it; read again. GitHub's API names no conflicting file, so the text the session hears names the
files a real merge of the PR's head and base leaves in conflict, and no other file.

**Pushes.** While a session has worked in a repo the hub reads that repo's pushes (at most `READ_WAIT`, 90 s, after a push)
into `push.record@1` readings. A ref change those readings show that no guarded call named is recorded, by the core, as a
new kind:

```jsonc
// ref.unguarded@1, appended under the session's connection, so the event's `session` is the session's ID
{ "ref": "refs/heads/feature",   // the ref that changed
  "commit": "<40 hex>",          // what it now holds
  "pusher": "maya",              // the reading's pusher, null when empty
  "call": "toolu_…",             // the tool call that was running: tool.before's `data.call`
  "command": "npm test" }        // that call's command
```

A push a guarded call named, such as the session's own `git push origin HEAD:refs/heads/own`, gets no such record.

### 3. Three new plants in `packages/hub/src/plant.ts`, selected with `DEEP_HUB_PLANT` as every hub plant is

| Plant | The wrong program |
|---|---|
| `posts-on-head` | posts a verdict on the session's HEAD, whatever the worktree holds |
| `unguarded-marks-every-push` | records every push it reads as unguarded |
| `unguarded-marks-none` | records no push as unguarded |

A hub that doesn't list a plant refuses to start, so a plant test can't pass by accident: it is BLOCKED.

## The fixture forge (`forge.ts`)

Real HTTP on 127.0.0.1, over real bare repos at `<tmp>/github.com/<owner>/<repo>.git`. `git push` into one runs its
`post-receive` hook, which logs the ref change with `FORGE_ACTOR` from the pushing process's environment: unset or empty,
the forge records no actor. Bodies have GitHub's field names. Unknown routes answer 404. `forge.calls` keeps every call.

| Route | Answers |
|---|---|
| `GET /repos/{o}/{r}` | `full_name`, `private`, `visibility`, `fork`, `parent`, `default_branch`, `owner` |
| `GET /repos/{o}/{r}/activity` | ref changes: `id`, `before`, `after`, `ref`, `timestamp` (whole seconds), `activity_type`, `actor` (`{login}` or null); newest first, `direction=asc`, `per_page`, next page in `Link` by `after` |
| `GET /repos/{o}/{r}/compare/{base}...{head}` | `commits`, `files`, `status`, `ahead_by`, `behind_by`; 404 for the all-zero SHA a new branch's `before` holds, and for `owner:branch` forms |
| `GET /repos/{o}/{r}/commits/{sha}`, `GET …/commits?sha=` | a commit: `sha`, `parents`, `commit.{author,committer,message,tree}`, `author.login`, `committer.login` (its git name) |
| `GET …/commits/{sha}/status`, `…/statuses` | the combined status; the statuses, newest first |
| `POST …/statuses/{sha}` | 201; 401 with no token; 422 for an unknown commit, a state outside GitHub's four, or a description past 140 characters. `forge.limitNext` forces the next answer |
| `GET …/pulls?state=&head=&base=` | open pull requests, no `mergeable`, as GitHub's list has none |
| `GET …/pulls/{n}` | with `mergeable` and `mergeable_state` from `git merge-tree` on the bare repo: null and `unknown` on the first read after either side moved |
| `GET …/pulls/{n}/commits`, `…/files` | the PR's commits; its changed files |
| any write to `…/branches/{b}/protection…` or `…/rulesets…`, a GraphQL mutation of either | 403, and kept in `forge.refused` |

## The world (`helpers.ts`)

`World.start` builds a home, the forge with `acme/shop` seeded and pushed by `maya`, a real hub and `deep setup`'s hooks.
`world.session` is one Claude Code session in its own clone, run by the stand-in `fixtures/claude.mjs` (#27's, copied, so a
redraft of theirs moves nothing): real deep-hook, a real waiter, real tool calls, its commands children of the session.
Its prompt names the push, so the guard's `push-needs-ask` lets the session push, and a definition is handed for it. AC7's
sessions type a question instead: it opens no task, so their stop goes through and they sit idle with their waiter running.
`session.verdict` plants an outcome on a real claim with `test.verdict`. `session.stop` after work runs the real gate.

## Criteria

| AC | Test | The wrong program it must catch |
|---|---|---|
| AC1 | `status.test.ts`: the gate's PASS lands `success` on its commit, not the parent; a PASS on an older commit lands there, and HEAD never holds it | a poster that takes HEAD or the branch tip; one that posts on every commit of the push |
| AC2 | `status.test.ts`: after a PASS, the next pushed commit holds no `success`, then or after a BLOCKED of its own | a poster that carries the last green onto a new head |
| AC3 | `status.test.ts`: INCONCLUSIVE and BLOCKED post `pending` naming the verdict; FAIL and INVALID are never green; INCONCLUSIVE after a PASS on one commit turns it pending; the description names open items; nine long items still post | a map from "not FAIL" to success; a poster that keeps the first status; one that ignores open items; one that GitHub refuses past 140 characters |
| AC4 | `reader.test.ts`: the kit passes the reader; over the API a fork's push, a stranger's push authored as you and an empty actor read as recorded, and `headTrust` holds them; planted `author-as-pusher` fails the kit naming each commit, and the gate doesn't read it | **named:** a reader that copies a commit's author into its pusher; a reader that passes the kit but reads GitHub's answers wrong; one that turns an empty actor into a guess; one that never reads a fork |
| AC5 | `status.test.ts`: a head over a stranger's commit authored as you gets `pending` naming `untrusted head`, from the gate's own verdict and from a planted PASS; the same head pushed by a named account goes green | a poster that doesn't ask `headTrust`; one that trusts the author; one that holds every commit from outside a session |
| AC6 | `status.test.ts`, private and public: no rule, then `off`: nothing but GETs reach the forge; `on`: the next verdict posts | a poster with no rule check; one that takes a public repo as on |
| AC7 | `wake.test.ts`: the session whose PR conflicts wakes within 60 s hearing `src/total.ts`, not a file that merged cleanly or a file only the PR touched; the session whose PR merges doesn't wake | no conflict watch; one slower than 60 s; one that names every changed file; one that wakes on any base move; one that doesn't read again past a null `mergeable` |
| AC8 | `budgets.test.ts`: the preflight runs the file; on the reference Mac, verdict to status within 5 s against the merge base; five verdicts make one call each that names their commit; three rate-limit shapes stop every POST until they lift | a read before each POST; a retry loop that ignores `Retry-After`; a poster that lets a second verdict through a limit |
| AC9 | `status.test.ts`: statuses land while the forge refuses nothing, and no source names such a route; the README's section names `deepbuild/verdict` and how to require it | a setup step that adds the required check itself; a README with no instructions |
| AC10 | `snapshot.test.ts`: the real gate's verdict on a snapshot posts nothing while HEAD differs or a pushed commit has another tree, then lands on the pushed commit with its tree; planted `posts-on-head` fails naming the commit | **named:** a poster that posts on HEAD while the worktree differs from it; one that posts on the snapshot's own commit, which GitHub doesn't know |
| AC11 | `unguarded.test.ts`: the push inside `npm test` is recorded naming the session, the call and the command; the session's own `git push` isn't; both plants fail, naming the push | **named:** a recorder that marks every push it reads, or none; one that names the wrong call |

The Proof line is `live.test.ts`, below.

## Lanes

| Lane | Files | Why |
|---|---|---|
| Alone | all of `tests/acceptance/46/`: add it to `alone` in `scripts/lanes.mjs` | each test starts a real hub, and AC7 and AC8 read real time. `budgets.test.ts`'s first test fails until it is added |
| Timed | the `on the reference Mac` test in `budgets.test.ts` | a warm-up, five runs of 20 verdicts, and the merge base's side. Off a reference Mac (Mac15,7 or Mac15,12), with Low Power Mode on, a thermal warning or a load past the core count it skips as INCONCLUSIVE with its readings, on battery or mains alike, and never passes by skipping |
| By hand | `live.test.ts` | the issue's Proof, on real GitHub. Skipped unless `DEEPBUILD_46_LIVE_REPO` (owner/name) and `DEEPBUILD_46_LIVE_TOKEN` name a test repo whose default branch requires `deepbuild/verdict` and nothing else, and a token that can push and post statuses there. It creates no repository and changes no protection: it pushes one branch, opens one PR, and closes and deletes them |

## Values the issue and the design leave open, and what these tests chose

1. **A delivery rule.** Neither says what one is or where it lives. Chosen: `github.delivery` in your settings, per repo.
2. **"Public repos start with it off."** With "nothing posts until the repo has a delivery rule" it adds nothing a test can
   tell apart: every repo starts off. Tested on both, as no rule, then `off`, then `on`.
3. **"An account you named as yours."** No place is named. Chosen: `github.yours` in your settings.
4. **The gate's own identity (#1325)** is in Scope with no criterion. The tests post with the hub's `GH_TOKEN`, as the hub's
   other forge calls do, and don't judge whose token it is. The forge keeps each call's token if a later test wants it.
5. **FAIL and INVALID.** The issue names no state. The tests hold them to `failure` or `error`, naming the verdict.
6. **AC2 and the old commit.** A status is about its commit, so the older commit's green stays. Only the new head is held.
7. **AC5 and a PASS.** Design: a stranger's head may run in the sandbox. AC5: "never a green one". Read strictly: a PASS on
   an untrusted head still posts pending.
8. **A rate-limited POST** that GitHub refused is one call and its retry a second. "At most one API call per verdict" is read
   as: one when nothing refuses. Tested as three POSTs for two verdicts when the first is refused.
9. **A description past 140 characters**: the issue says it names "any open items"; GitHub's limit can't hold them all.
   Chosen: the verdict's word and the number of open items.
10. **Compared with the merge base.** The base has no poster, so its side has no reading and nothing regresses from it, as
    #83's budget does. Once main holds this work the same driver compares medians, a regression past 50% failing.
11. **`push.record@1` holds `commit` and `pusher` alone**, while the design has "a ref change those readings show". The
    `ref` of `ref.unguarded@1` has to come from the same read of the forge. Its `x-since` says R2; the issue and the slot
    table say R1. The schema is left as it is.
12. **Mains power.** The design counts a budget only on mains; the owner's later rule, and this job's brief, is never to gate
    on it, so battery and mains count alike. #27's and #83's gates are the same.
13. **How often the hub reads the forge** is left open but for AC7's 60 s. `READ_WAIT` is this suite's own bound on a push
    reaching the record: 90 s.
