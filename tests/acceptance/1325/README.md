# Acceptance tests for #1325: only the gate can turn a commit green

Written first, blind, by a job that never saw an implementation of #1325; none existed. The implementing agent doesn't
edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

The issue has five checkbox criteria, AC1 to AC5 in the body's order. Each test's name carries its criterion's ID
(`#1325.` and the first 8 hex digits of SHA-256 of the criterion's text, white space collapsed, as
`scripts/proof-change.mjs` reads it):

| AC | ID | File |
|---|---|---|
| AC1 | `#1325.49a90c4b` | `statuses.test.ts` |
| AC2 | `#1325.22c213fe` | `refusals.test.ts` |
| AC3 | `#1325.26d4fba5` | `gate-secret.test.ts` |
| AC4 | `#1325.e743366f` | `session-end.test.ts` |
| AC5 | `#1325.818e4076` | `person-push.test.ts` |
| Proof | (live, by hand) | `live.test.ts` |

## What was read

- Issue #1325 as of 2026-11-07: Scope, the five criteria, Proof, Depends on (#46). Its epic #1324 and #46, for context.
- `docs/technical-design.md`: Threats, and what stops each one (the rows on sessions DeepBuild starts, what a
  command's children do, secrets, untrusted PR heads), First-party extensions that ship on by default (the `github`
  row), Scale later, Dogfooding. `AGENTS.md` (Proof).
- At the base `92aee55f95e0506614996dfced6503bfeafd0c97` (main, 2026-11-07), for surfaces and conventions only:
  `packages/github/src` (#46's poster, its push reader, `ref.unguarded`, `GitHubOptions.posts`, which already says the
  gate's own token is #1325's), `packages/hub/src/core.ts` (`openGitHub`, `GH_TOKEN`, `test.verdict`, `config.json`),
  `starts.ts` and `start-command.ts` (#1330: `deep start approve`, `deep start`, the session's environment, the sandbox
  settings from the facts), `keychain.ts` (`DEEP_HUB_TEST_KEYCHAIN`), `env.ts`, `plant.ts`,
  `adapters/claude-code.facts.json` (`sandbox`, `launch.started`); the suites `tests/acceptance/46`, `1330`, `1333` and
  `1328`'s README (which names a `gate.key` in config.json as #1325's stand-in; this suite leaves it alone).
- Imported by path, not copied: `../46/forge.ts` (the fixture forge this one wraps) and `../342/fixtures/agent.mjs`
  (a session's agent process in your terminal). Copied, with the changes marked: #1330's Claude Code stand-in.

## What the base does

There is no `deep gate rules`, no gate identity, no credential of a session's own and none of the plants below. The
hub posts with `GH_TOKEN`, your own forge login, and a session it starts inherits that login in its environment.
Every test fails or reads BLOCKED; `BASE-FAILURE.txt` has the run.

## Redraft: two helper defects

Dispute from the implementing job on the first draft (`edca8beb`): two helpers in `helpers.ts` made tests fail
whatever the implementation did. Both are fixed; no criterion's reading, expected value, plant or other test changed.

1. **`gatePass()` took the oldest `deepbuild/verdict` status on the head.** AC1 posts the agents' app's status on that
   head first, so `gatePass()` returned it at once and AC1 failed naming `deepbuild-agents[bot]` even when the hub
   posted as the gate. It now waits for a status with the context posted after the planted PASS, from any poster, so a
   hub posting as the wrong identity still fails AC1 and AC3 naming that poster.
2. **`standIn()` could take a log that isn't the session's.** When a started session's first hook arrives, the hub runs
   `claude plugin list --json` in the session's folder with its own environment; the stand-in logs that run too
   (`refused: "subcommand plugin"`, `done`, no session, no Bash call). Depending on the folder's order, AC2 read the
   hub's `GH_TOKEN` as the session's, and AC3 crashed on a log with no Bash call. `standIn()` now skips logs the
   stand-in refused, and AC3's BLOCKED message no longer reads a Bash call that isn't there.

## Run them

macOS only (the stand-in agent's sandbox is Seatbelt), with the repo's Node (`.node-version`, 24.22.0):

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:/opt/homebrew/opt/rustup/bin:/opt/homebrew/bin:$PATH"
npm ci                                      # once
npm run build --workspaces                  # every test runs packages/cli/dist/main.js
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -p deep-hook
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1325 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/1325/tsconfig.json
```

Each world has its own home under `/Users/Shared/dh1325-*` (a short path, for the hub's socket, outside the temp
folders AC3 walks on their own), removed at the end. Every process is stopped by its PID. Nothing leaves 127.0.0.1 but
`live.test.ts`, which is skipped unless you name a live repo. No model is called. A missing CLI build, deep-hook or
`/usr/bin/sandbox-exec`, a hub that won't start with a plant it doesn't list, or a #1330 start that doesn't start,
reads BLOCKED, never a pass.

## The surface under test

The issue names a gate identity, a session's credential, the default branch's rule and the record, but no command,
field or event. This suite defines the smallest surface that reaches every criterion, on top of what exists: the
hub's start path (#1330), #46's poster and push reader, `ref.unguarded`, and the Keychain.

### 1. Two forge apps, named in your settings

The gate identity is a GitHub App of the gate's own; a session's credential is an installation token of a second app,
the agents' app. Two apps, because a token of the gate's app is the gate's identity: whatever it posts counts as the
gate's, however narrow its permissions. Your settings, `~/.deepbuild/config.json`, name both:

```json
{ "github": {
    "delivery": { "acme/shop": "on" }, "yours": ["maya"],
    "gate":   { "app_id": 913251, "key": "deepbuild.github.gate" },
    "agents": { "app_id": 913252, "key": "deepbuild.github.agents" } } }
```

`key` is the Keychain service holding the app's private key (PEM, as GitHub hands it over), read through the hub's
`keychain()` (`DEEP_HUB_TEST_KEYCHAIN` in tests, a file in `~/Library/Keychains/`, which a session's sandbox can't
read). The hub finds each app's installation with `GET /repos/{owner}/{repo}/installation` and mints tokens with
`POST /app/installations/{id}/access_tokens`, both by the app's JWT.

- **The gate's credential** stays in the hub's process: #46's poster posts every `deepbuild/verdict` status with a
  token of the gate's app. Nothing of it, the key, a JWT or a token, reaches a session's environment, its arguments or
  a file a session can read (AC3), the record's own files included.
- **A session's credential.** Each session a run starts (#1330's `deep start`) gets its own installation token of the
  agents' app, in its environment as `GH_TOKEN`, in place of anything the hub's own environment holds there. It can
  push branches and, as its permissions say, open PRs and comment; it can't post statuses, merge, push the default
  branch or push `deep/approved/` tags (AC2). It stops working within 60 s of its session's end (AC4); an installation
  token lives an hour unless revoked with `DELETE /installation/token`.
- **Your own login** stays the hub's: `GH_TOKEN` in the hub's environment (what `gh auth token` gives it on your
  machine) never reaches a session.

### 2. `deep gate rules --json`

Prints, and exits 0, one JSON object `{ "rulesets": [ ... ] }`: the rulesets the repo's forge needs, each a body
`POST /repos/{owner}/{repo}/rulesets` takes. DeepBuild never applies them (#46); the tests put them on the fixture
forge as maya, its admin, the way you, or #1341's link, would. Together they must: require `deepbuild/verdict` on the
default branch from the gate's app (`integration_id`), refuse the agents' credential a merge, a push to the default
branch and a push of a `deep/approved/` tag, and let a person through by the forge's own bypass (AC5). The CLI reads
`DEEP_HUB_PLANT` as the hub does.

### 3. The record

- `forge.refused`, one per call the forge refused a session's credential, naming the session (the event's `session`,
  or its ID anywhere in the event) with `data.action` one of `post-status`, `merge`, `push-default-branch`,
  `push-approved-tag` (AC2). The calls are made by a command's children, which no hook sees; what the forge answered is
  in the output of the Bash call that was running, as #1330's `sandbox.refused` is read from one. The forge's answers
  are GitHub's: a REST refusal's body names the endpoint in `documentation_url`, and a push refused by a ruleset prints
  `GH013: Repository rule violations found for <ref>`.
- `ref.unguarded` (#46, unchanged) for a person's direct push to the default branch, naming the ref, the commit and the
  pusher; and no `verdict.made` PASS on that commit (AC5).

### 4. Plants (`DEEP_HUB_PLANT`)

| Plant | The wrong program | Read by |
|---|---|---|
| `rule-reads-context-alone` | `deep gate rules` requires `deepbuild/verdict` by its context alone | AC1: fails, naming the poster `deepbuild-agents[bot]` |
| `agent-credential-posts-statuses` | a session's credential that can post a status | AC2: fails, naming `post-status` |
| `agent-credential-merges` | a session's credential that can merge the pull request | AC2: fails, naming `merge` |
| `agent-credential-pushes-default-branch` | a session's credential that can push the default branch | AC2: fails, naming `push-default-branch` |
| `agent-credential-pushes-approved-tags` | a session's credential that can push a `deep/approved/` tag | AC2: fails, naming `push-approved-tag` |
| `passes-gate-credential` | a hub that passes the gate's credential to a session's environment | AC3: fails, naming the variable |

How each AC2 plant widens the credential (its permissions, or what the printed rulesets let it bypass) is the
implementation's. A hub that doesn't list a plant refuses to start; that reads BLOCKED.

## The fixture forge (`forge.ts`)

The forge is the boundary this repo doesn't own, so it is stood in for: real HTTP on 127.0.0.1, wrapping #46's fixture
forge, which keeps the bare repos and answers #46's reads (`/activity`, `/compare`, commits, pull requests). What it
enforces follows GitHub's documentation:

- **Apps and installation tokens**
  ([create an installation access token](https://docs.github.com/en/rest/apps/apps#create-an-installation-access-token-for-an-app),
  [authenticating as an app](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app)):
  a JWT is RS256, issued by the app's ID, expiring at most 10 minutes out. A token gets the app's permissions unless the
  request narrows them, never more (422), and works for an hour.
  [`DELETE /installation/token`](https://docs.github.com/en/rest/apps/installations#revoke-an-installation-access-token)
  revokes the token it is called with; a revoked or expired token answers 401 `Bad credentials`.
- **Permissions** ([permissions required for GitHub Apps](https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps)):
  a status needs `statuses: write`, a merge and a push `contents: write`, a fetch `contents: read`. A refusal is 403
  `Resource not accessible by integration`, with `documentation_url`. maya, a person, is the repo's admin.
- **Rulesets** ([available rules](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets),
  [create a repository ruleset](https://docs.github.com/en/rest/repos/rules#create-a-repository-ruleset)): only
  `active` ones, matched by `target` and `conditions.ref_name` (`~DEFAULT_BRANCH`, `~ALL`, `*`, `**`). Enforced rule
  types: `creation`, `update` (only bypass actors may update the ref; a merge of a pull request is an update of its
  base), `deletion`, `non_fast_forward`, `pull_request`, and `required_status_checks`: the newest status with the
  context, from the app its `integration_id` names when it names one ("If the status is set by any other person or
  integration, merging won't be allowed"), must be success. Other rule types are kept and not enforced. Bypass actors:
  `RepositoryRole` 5 (admin) and `OrganizationAdmin` are maya, `Integration` is the app by ID; `bypass_mode`
  `pull_request` bypasses only a merge of a pull request.
- **Pushes**: git over HTTP (`git http-backend`), with the token as a bearer header or basic auth. A pre-receive hook
  asks the forge about each ref change, and a change a ruleset refuses fails the push as GitHub's does:
  `error: GH013: Repository rule violations found for <ref>.` with each violation, printed by git as `remote:` lines
  (git's own last line then says `pre-receive hook declined`, where GitHub's says `push declined due to repository
  rule violations`). Every push is logged with its actor (the person's login, or `<slug>[bot]`), as #46's
  `/activity` reads it.
- **Merges**: `PUT /repos/{o}/{r}/pulls/{n}/merge`, 405 with `Repository rule violations found` when a ruleset refuses
  it, else a real merge commit.
- **`mergeable_state`** of `GET /pulls/{n}`: `dirty` or `unknown` as #46's forge computes them; else `blocked` while a
  required status check (or a required review) of a ruleset on the base is unmet, `clean` once none is. It doesn't
  count bypass or `update`, which decide who may merge; AC2 reads those through the merge call itself. GitHub's own
  documentation doesn't say how `update` shows here; the live run reads the rule's own response instead.

The forge keeps every token and JWT it saw, every status with its poster, and every attempt to change something with
who made it and its answer. The tests read those.

## The world (`helpers.ts`)

maya's checkout of `acme/shop`, cloned over HTTP: `main` at one commit, `feature` one ahead, pull request #1 of it.
The gate's app may read and post statuses. The agents' app is installed with more than a session needs, `statuses:
write` included, so how narrow a session's credential is is the hub's doing. The hub runs with `GH_TOKEN` set to
maya's own token, `DEEP_HUB_TEST_FORGE` at the forge, `DEEP_HUB_TEST_KEYCHAIN`, `DEEP_HUB_TEST_CONFIRM` and
`DEEP_HUB_TEST_VERDICT=1`. A run is approved with `deep start approve` for issue 1325, Claude Code, naming the host
127.0.0.1, and answered yes with `deep inbox answer` (#1330's surface).

**The gate's PASS** (AC1, AC3): a session in your terminal in maya's checkout (#342's agent process, real deep-hook)
claims the pull request's head with `deep_claim` (its PreToolUse, then `deep mcp` as the agent's own child), and a PASS
is planted on that claim with `test.verdict`; #46's poster then posts the status, as whoever the hub posts as.

### The stand-in agent

`fixtures/claude.mjs` is #1330's Claude Code stand-in, copied: it reads argv and settings as Claude Code does, runs
DeepBuild's hooks, and enforces the sandbox settings the hub launches it with through Seatbelt, the shipped facts'
walls included. This copy logs its whole environment, reaches a loopback host the approval names (standing for Claude
Code's proxy letting an allowed host through), and takes two tags: `[standin:bash:<base64url>]` runs that command as
one Bash call, and `[standin:exit]` ends the session after the turn (SessionEnd, then exit).

- `fixtures/forge-calls.mjs`, AC2 and AC4: real `git push` and `curl` with `GH_TOKEN`, as children of one Bash call.
- `fixtures/scan.mjs`, AC3: walks what the session can read, inside its sandbox, given only SHA-256 digests of the
  gate's secrets.

## How each criterion is read

- **AC1** (`statuses.test.ts`): the rulesets from `deep gate rules` are on the forge. A `deepbuild/verdict` success
  from a token of the agents' app (one that can post statuses: AC1 reads the rule, AC2 the credential) leaves pull
  request #1 `blocked`. Then the gate's PASS: its status must come from the gate's app, and the pull request reads
  `clean`. The plant fails at the first step, naming `deepbuild-agents[bot]`.
- **AC2** (`refusals.test.ts`): the rulesets are on; the pull request is green from the gate (a status the world posts
  with a token of the gate's app) and `clean`, so nothing but the credential holds the merge back. A session under
  the run runs `forge-calls.mjs`: its `GH_TOKEN` must be a token of the agents' app; it pushes a branch (it may); then
  it posts a status, pushes `deep/approved/1325-<x>`, pushes the head to `main` (a fast-forward) and merges #1. The
  forge must have refused each of the four, made with that credential, and the record must hold a `forge.refused`
  for each, naming the session, within 60 s. Each plant fails naming its call.
- **AC3** (`gate-secret.test.ts`): the gate posts first (its status must be the gate app's), so the hub has used its
  credential. Then a session under the run, in its sandbox, scans the test home, `/tmp` and its `TMPDIR` (those two to
  depth 4). Its environment, its arguments and every file it read must hold none of: the gate app's key (64-character
  stretches of its PKCS#1 and PKCS#8 base64), any installation token of the gate's app, any JWT of it. The plant fails
  naming the variable, which must be one of the session's.
- **AC4** (`session-end.test.ts`): a session pushes a branch with its credential (it worked), then ends. The forge
  must take the credential no more within 60 s of the stand-in's end, by the forge's own revoke or expiry time, and a
  call with it then answers 401.
- **AC5** (`person-push.test.ts`): the rulesets are on and a session in your terminal works in the repo. maya commits
  on `main` and pushes it straight to the forge: it must go through (the forge's bypass). Within 90 s the record holds
  `ref.unguarded` for `refs/heads/main` and that commit, with pusher `maya`. In the 30 s after, no `verdict.made` PASS
  names the commit and it holds no green `deepbuild/verdict`.

### The live run (the issue's Proof)

`live.test.ts` is skipped unless these name a live test repo and credentials:

| Variable | What |
|---|---|
| `DEEPBUILD_1325_LIVE_REPO` | `owner/name` of a test repo whose rules are already on (#1324's forge step) |
| `DEEPBUILD_1325_LIVE_TOKEN` | your own token for it: reads, the proof branch, one pull request |
| `DEEPBUILD_1325_LIVE_GATE_APP_ID`, `DEEPBUILD_1325_LIVE_GATE_KEY` | the gate's app: its ID and a PEM file |
| `DEEPBUILD_1325_LIVE_AGENTS_APP_ID`, `DEEPBUILD_1325_LIVE_AGENTS_KEY` | the agents' app: its ID and a PEM file |

It reads the rule's own response (`GET /repos/{o}/{r}/rules/branches/{default}`: `deepbuild/verdict` from the gate's
app), pushes a proof branch and opens one pull request as you, starts one stand-in session under a run against the real
repo (no model), and checks that GitHub refused each of its four calls and left the default branch, the tags and the
statuses as they were. It never changes rules, never creates a repo or an app, and deletes its branch and closes its
pull request at the end. Never in hosted CI.

## Values the issue leaves open, and what these tests chose

1. **What a gate identity is**: a GitHub App, its key in the Keychain, named in your settings. Chosen as the only
   forge identity GitHub lets a program hold that a ruleset's status check can name as a source.
2. **A session's credential**: an installation token of a second app, as `GH_TOKEN`. GitHub's installation tokens are
   the only short-lived credential an API mints, and the only one revoked by API.
3. **Who refuses the merge and the pushes**: GitHub can't narrow a token by ref, so the rulesets refuse them, and the
   credential's permissions refuse the status. Both are DeepBuild's: the token it mints, the rules it prints.
4. **"Mergeable"** in AC1 is the pull request's `mergeable_state`, as #46's live proof reads it.
5. **AC1's agent status** is posted with a token of the agents' app that can post statuses, minted by the world as the
   app's owner, since a correct session credential can't post one (AC2) and the rule could then never be seen.
6. **"Recorded"** in AC2 is a new event kind, `forge.refused`.
7. **"No claim reads PASS from it"** in AC5 is read as: no PASS verdict on the pushed commit and no green status on
   it. A claim built on top of it is the gate's to judge and isn't read.
8. **The session's end** is the agent's own: SessionEnd, then its process exits.

## Known limits

- The stand-in plays Claude Code's sandbox and proxy as its header says; the live run is the check on the real agent.
- AC3's scan finds the key, tokens and JWTs in the forms named above; a credential re-encoded another way (hex, a JWK,
  base64 of the whole PEM) isn't found. Files over 4 MB are skipped, and `/tmp` and `TMPDIR` only to depth 4.
- The fixture forge enforces the rule types listed above; a ruleset of another type is kept and not enforced.
- Opening a PR and commenting with a session's credential (Scope) are in no criterion and not read.
- The live run has never been run by this job.
