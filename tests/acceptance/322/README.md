# Acceptance tests for #322: the done gate's core reads

The bootstrap `done.yaml`, each task's acceptance criteria through `work.item@1`, project trust, and Closes or Part of.

Written first, blind, by a job that never saw an implementation of #322. Sources:

- **The issue**: its text as of 2026-11-03T10:04:15Z (`updatedAt`): Scope, Fields, the 15 checkbox criteria, Proof and
  Depends on.
- **The design**, `docs/technical-design.md`:
  - [How runs become one of five verdicts]: the table and its precedence, Proof depth, Coverage claim by claim, Whose
    checks count, Where not just what, Protection.
  - Building blocks: Work source (`work.item@1`, each author's role from the provider's membership record), and the
    `deep.registerSource` row (a reader that marks every author a collaborator).
  - [The contract (kernel)]: Ask-task, Definition of done, Claim, Check, Verdict.
  - [What done means, fixed at the start]: When, Who drafts it (a requirement quotes its criterion in full; each
    requirement keeps its author's role from the work source, never from the text), Locked, Timing and cost (a claim
    before the lock waits within the hold, BLOCKED cause plan window while the drafting job waits at your reserve, the
    repo's spec checks run meanwhile), Solved or not (a threshold without a unit), At the claim (Closes only when every
    requirement passed, else Part of), Done means switched on (an agent can't close an issue by hand).
  - [An agent says it's done]: Every stop is judged, The verdict in the chat.
  - Tasks close themselves: "an agent that writes 'usage limit reached' still gets its send-back".
  - [First-party extensions that ship on by default]: the done-gate row (its floor: the validity gate, the hash check,
    whose checks count, the base-commit run, the `.deepbuild/` guard and project trust) and the spec-draft row (trust
    is one decision the core holds, reused from Claude Code's workspace trust and Codex's trusted projects; a repo
    trusted in neither never runs), and the `.deepbuild/done.yaml` example that follows.
  - [Threats, and what stops each one]: Hostile text in what DeepBuild reads.
  - [How we know version 0 works]: the seeded false "done" cases, the work.item kit's broken fakes, Dogfooding.
- **The closed dependencies**, for the base behaviour they landed: #29 (the gate runner and the floor), #30 (command
  checks, tests-run counts), #31 (base-commit runs), #303 (ask-tasks, `DEEP_HUB_TEST_DRAFTS`, `DEEP_HUB_TEST_WORK`, the
  lock by hash, the outside-text ask), #25 (the Stop hold), #317 (the `.deepbuild/` guard entries), #44 and #348
  (project trust, the decision in the record), #364 (work sources, `work.item@1`) and #874 (stand-ins).
- **The base commit**: `69803b94` (origin/main). The base code read: `packages/hub/src/` (`ask-tasks.ts`,
  `gate-runner.ts`, `core.ts`: `runClaim`, `runApproved`, `laneOf`, `judged`, `invalid`, `checksOf`, `windows.report`;
  `server.ts`: the `DEEP_HUB_TEST_*` settings; `plant.ts`; `hookmap.ts`; `forge.ts`: `isPrCreate` and the `Closes #n`
  reader; `session-facts.ts`: `done.yaml` and `~/.claude.json`; `verdict-chat.ts`; `codes.ts`), `packages/gate/src/`
  (`floor.ts`, `claim.ts`), `packages/verdicts/src/` (`engine.ts`, `line.ts`), `packages/runner/src/runner.ts` (the
  window readings and the reserve), `packages/extension-host/src/trust.ts`, the schemas `work.item@1`,
  `definition.locked@4`, `claim.made@3`, `verdict.made@1`, `agent.stop@5`, `run.started@2`, `run.finished@1`,
  `adapters/claude-code.facts.json` and the corpus, `crates/deep-hook/default-rules.json`, `scripts/proof-change.mjs`
  (the criterion IDs) and `scripts/proof.mjs` (the trace lane).
- **Sibling suites, for their conventions**: tests/acceptance/303 (this suite's template: the world, the hub as a
  process, sessions through deep-hook, `deep inbox answer`, the plants), 29, 317, 874 and 875.

The implementing agent does not edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job.

## How to run

With Node 24.22 (`.node-version`) first on `PATH` and the Rust toolchain:

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # the hub and the deep CLI the tests start
cargo build --locked -q -p deep-hook     # target/debug/deep-hook, which every hook runs
npx vitest run --root tests/acceptance/322 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/322/tsconfig.json
```

- Each test starts hubs of its own, so the folder belongs on `scripts/lanes.mjs`'s one-at-a-time list (`alone`),
  beside #303's. The implementer adds it.
- Every test makes its folders under `/tmp/dh322-*` (a Unix socket path must fit in 104 bytes on macOS), sets `HOME`
  to `<tmp>/h` for every process it starts, and never touches the real `~/.deepbuild`, `~/.claude` or `~/.codex`.
  AC9's session works in this checkout (its cwd), with its home still the test's.
- It stops only processes it started, by PID (`helpers.ts`, `cleanup`, `stopHub`), never by name or port.
- No network, no model, no `claude` binary, no `gh` call. A child never inherits this process's billing keys, forge
  tokens (`GH_TOKEN`, `GITHUB_TOKEN`) or its `DEEP_*`, `GIT_*`, `XDG_*` or `CLAUDE*` settings. The GitHub API's answers
  are recorded (below).
- Each test takes one to eight minutes on a correct hub; most of the time is stop holds (60 s by default) and the
  fast-lane checks. The whole suite is under an hour.

## The surface under test

The tests reach DeepBuild only through these:

- **deep-hook** (`target/debug/deep-hook`), run as Claude Code runs our hook entry: `deep-hook claude-code <event>`,
  the hook's JSON on stdin, `HOME` the test's. Payloads and transcripts are shaped like the corpus's
  (`adapters/corpus/claude-code`). Every transcript entry carries the newest version the facts cover, so no session is
  watch-only for its version. A Stop's reply is read from deep-hook's stdout (`decision: block` with its `reason`, and
  `systemMessage`, the line the chat shows) or, at exit 2, from its stderr (`replyText`); a PreToolUse refusal the
  same way (`decision`).
- **`deep hub run`** with its test settings: `DEEP_HUB_PLANT`, `DEEP_HUB_TEST_CONFIRM`, `DEEP_HUB_TEST_STOP_HOLD_MS`,
  `DEEP_HUB_TEST_DRAFTS` and `DEEP_HUB_TEST_WORK`, which the base has, and one new one, `DEEP_HUB_TEST_GITHUB` (below).
  Each test passes the three fixture files to every hub it starts.
- **The socket**, as the cli role with the control token: `events.read`; `evidence.read` (AC12); and `windows.report`
  (AC13), the base's RPC the CLI and the status line report the account's plan windows through.
- **The record** through `events.read`: `user.ask`, `task.created`, `definition.locked`, `ask.created`, `agent.stop`,
  `claim.made`, `run.started`/`run.finished`, `verdict.made`, `*.proposed`, each as the base's catalogue has it, and the
  kinds this suite leaves open (below).
- **`deep inbox answer <ask> <option>`** (#24): your answer on the trusted path, the OS confirmation stubbed `confirmed`
  (`DEEP_HUB_TEST_CONFIRM`), as #303's suite stubs it.
- **The project's trust decision** as #348 landed it: `openTrust` of the extension host's public entry
  (`packages/extension-host/src/index.ts`) over the record at `<home>/.deepbuild/ledger.db` opened through
  `packages/record/src/index.ts`'s `openRecord`, the way the app's card records your answer (a `decision.created` by
  the core, key `sha256("project trust\n<real path>")`, answer `trusted`). The test records it with no hub on the
  record, before the first hub starts. And Claude Code's workspace trust: `~/.claude.json`'s
  `projects[<repo>].hasTrustDialogAccepted: true`, as Claude Code writes it.
- **The contracts package's public entry**, `packages/contracts/src/index.ts`: `listSchemas` and `validate` (AC14).
- **This checkout's test files** (AC9): the tag `#322.<hash>` each test name here carries.

### Playing Claude Code

As in #303's suite: each session has its own long-lived process, `fixtures/agent.mjs`, which runs every deep-hook of
that session as its child, so the hub binds the session to it and `deep inbox answer`, run by the test process, is
outside every session's process tree. The test runs a call only when deep-hook's PreToolUse allows it (exit 0 with
no deny), then writes the call's result to the transcript and fires PostToolUse. A prompt you typed is a transcript
entry with `turnOrigin: human` and its UserPromptSubmit; a stop is the assistant's last words and the Stop hook with
`last_assistant_message`.

### The world

`<tmp>/repo`, one commit on `main`, the folder every session works in:

- `src/auth.js`: `checkToken` (`token.exp > 0`) and `rejectsExpired: false`. `FIX` makes the unit test pass
  (`token.exp > Date.now() / 1000`); `FLAG` makes the drafted checks pass (`rejectsExpired: true`).
- `tests/unit.test.js`: a node:test test, `checkToken rejects an expired token`, failing at the base commit.
- `.deepbuild/done.yaml`, the repo's spec: `claims: { done: { checks: [unit] } }`, `checks: { unit: { type: command,
  run: "node --test tests/unit.test.js", min_tests: 1 } }`, the design's example cut to one check the hermetic
  runner traces and counts.
- `.deepbuild/checks/expired-token.sh`: the drafted check R1 names (as #303's), failing until `FLAG`.
- `.deepbuild/checks/expired-status.sh` and `.deepbuild/checks/expired-token.expected` (`401`): a drafted check that
  compares with an expected output it references (AC12).

`<home>/.deepbuild/config.json` holds your ask settings (#319's shape) and, for AC13, `plan: { reserve_pct: 10 }`.
`<home>/.claude.json` names the account (`oauthAccount.accountUuid`, which the runner reads as the account the
sessions run on) and, when a test asks, the workspace trust.

### The definitions the kernel is handed (`DEEP_HUB_TEST_DRAFTS`)

#303's fixture, unchanged in shape: `{ "drafts": [ { "ask" | "issue", "requirements": [...], "deliverables",
"budget", "waives"? } ] }`, each requirement with the issue's Fields (`id, text, source_line, refuted_by, check,
depth, oracle, near_misses`) and the design's `on_base` and `asserts`. Two things this suite adds:

- `references` (AC12): the expected outputs a requirement's check references, repo-relative paths. "The definition's
  hash covers each drafted check's bytes and each expected output it references": the lock keeps each one's bytes by
  digest as it keeps the check's, the hash covers them, and the claim's run gets the approved bytes at that path.
- **No draft for an item** (AC3, AC9, AC11): a task opened from a work item with no draft handed gets its definition
  from the item's reading, one requirement per acceptance criterion, in the reading's order, quoting it in full,
  authored by the item's author. The issue's Scope: the gate "reads … the task's acceptance criteria … from its work
  source's `work.item@1` readings". A draft handed for the item is what a drafting job would hand and is used as #303
  uses it.

### The test work source (`DEEP_HUB_TEST_WORK`)

#303's fixture, unchanged: `{ "readings": [ <work.item@1 reading with body as text> ] }`; a comment is a reading of
its own (`<item>.c<n>`, linked `<item link>#comment-<n>`). This suite's readings live at `https://work.test/…`, a
source that isn't GitHub, and their `criteria` are read (AC3). The session starts from an item by its link in the
prompt, `Fix <link>`.

### New: the recorded GitHub answers (`DEEP_HUB_TEST_GITHUB`)

The GitHub issues source reads the issue, its comments and the repo's collaborators through the API. The design: "the
done gate use[s] recordings, never live calls". The recording is a JSON file named by `DEEP_HUB_TEST_GITHUB`, which
only tests set, holding each request's recorded answer:

```json
{ "answers": [
  { "path": "/repos/acme/shop", "status": 200, "body": { "full_name": "acme/shop", "owner": { "login": "maya", "type": "User" }, … } },
  { "path": "/repos/acme/shop/issues/7", "status": 200, "body": { "number": 7, "title": "…", "body": "…\n### Acceptance criteria\n- [ ] …", "user": { "login": "maya", "type": "User" }, "updated_at": "…", … } },
  { "path": "/repos/acme/shop/issues/7/comments", "status": 200, "body": [ { "id": 1001, "body": "…", "user": { "login": "drive-by", "type": "User" }, "html_url": "https://github.com/acme/shop/issues/7#issuecomment-1001", "updated_at": "…" } ] },
  { "path": "/repos/acme/shop/collaborators", "page": 1, "status": 200,
    "headers": { "Link": "<https://api.github.com/repos/acme/shop/collaborators?per_page=100&page=2>; rel=\"next\"" },
    "body": [ { "login": "maya", "type": "User", "role_name": "admin", "permissions": { "admin": true, "push": true, "pull": true } } ] },
  { "path": "/repos/acme/shop/collaborators", "page": 2, "status": 500, "body": { "message": "Server Error" } }
] }
```

- A request is matched by its method (`GET`; `method` may be left out), its path without the query string, and its
  `page` query parameter (absent means 1; `per_page` and any other parameter are ignored). The matched entry's
  `status`, `headers` (`Link` for paging, as GitHub sends it; `Content-Type` is `application/json` when left out) and
  JSON `body` are the answer. A request no entry matches answers `404` with `{"message":"Not Found"}`. Nothing is
  fetched from the network, whatever `GH_TOKEN` or `gh` would allow; the tests pass no token.
- The file is read at each request, so a test can rewrite it between two sessions (AC15: the second read's page 2
  fails). Each session's read is its own; a role is never taken from an earlier read.
- Shapes follow the REST API: an issue's `user.type` and a comment's are `User` or `Bot` (an app's account, such as
  `octo-app[bot]`); a collaborator entry has `login`, `type`, `role_name` (`admin`, `write`, `read`) and
  `permissions`. The repo's owner is `maya`, `admin` on the list.
- The reading the source gives: the issue is `work.item@1` with `source_id` `acme/shop#7`, `link` its `html_url`,
  `criteria` the `- [ ]` lines under `### Acceptance criteria` of its body (this repo's own convention, which
  `scripts/proof-change.mjs` reads), `authors` its author with the role the collaborators give: `owner` for the repo's
  owner (admin), `collaborator` for a listed account, `outside` for one not listed; a comment is a reading of its own,
  `source_id` `acme/shop#7.c<comment id>`, `link` the comment's `html_url`, `criteria: []`, its author the same way.
  A `Bot` account's author also carries `automated: true`, and its text counts as outside whatever its membership.
  The handed drafts name these source ids in `source_line` (`acme/shop#7#L4`, `acme/shop#7.c1001#L2`).
- A read cut short (a page of the collaborators that fails) gives no role: the author's role reading is INCONCLUSIVE,
  their text waits as outside text does, and no role comes from an older list.

### The plan window (`windows.report`, AC13)

The base's RPC, which the CLI and the status line call: `{ agent: 'claude-code', account: <accountUuid>, rate_limits:
{ five_hour: { used_percentage, resets_at } } }` (`resets_at` in Unix seconds). The test reports the account's
five-hour window 95% used with your reserve at 10% (`plan.reserve_pct`), and later 0% used with a later reset, since a
reading replaces an older one only with a later reset. While the window is at the reserve the drafting of a task's
definition waits (design: "Each drafting job … waits when the plan window is down to your reserve"), so the handed
definition must not lock until the reset, and a claim meanwhile shows BLOCKED, cause plan window, after the repo's
spec checks have run.

### What the tests read in the record

- **A task**: as #303: the prompt's `user.ask` names it in `tasks`, and a `task.created` under the session's thread
  has that `task_ref`; a session started from a work item holds one task under its thread (`itemTask`).
- **A locked definition**: a `definition.locked` whose `task_ref` is the task's; its `requirements` with `id`, `text`,
  `check`, `author: {handle, role}` and, for an automated author, `automated: true`; a check's approved bytes by digest
  (a 64-hex SHA-256 somewhere in the requirement's record, as the base's `check_sha256`), and an expected output's the
  same way (AC12).
- **A claim**: a `claim.made` after the stop whose `task_ref` is the task's. The claim's handle is `claim:<event id>`
  of any event after the stop naming the task (`claimHandles`), as #303's suite reads it.
- **A claim's runs**: each `run.started` after the stop whose `claim` is one of those handles, with the `run.finished`
  whose `run` is the same; the check it ran is `check`: `unit` for the spec's, the file's path (or `R1`) for a
  drafted one (`runOf`).
- **A claim's verdict**: each `verdict.made` whose `claim` (or subject) is one of those handles, with its `outcome` and
  `reasons`; the cause `plan window` is looked for in the verdict's data and in the stop's reply.
- **The stop's send-back**: deep-hook's Stop reply, a block with its reason (`replyText`); `decision` says whether the
  stop was let through.
- **A refused call**: deep-hook's PreToolUse reply, a deny with its reason.
- **An ask**: `ask.created` after a log position; your answer takes the option that keeps what the definition holds
  (keep, include, add, accept, approve, lock, yes), else the recommended, else the first (#303's rule).
- **A proposal**: an event of a kind ending in `.proposed` whose data names the file (the base's `learn.proposed`).
- **Why a drafted check wasn't kept** (AC7): an event after the task's creation, of any kind but `user.ask` and
  `task.created`, whose data names the handed path and `.deepbuild/`.
- **The lint's flags** (AC11): the kind is left open. An event after the task's creation whose data names the
  criterion's text and each part it lacks by its word: `observable`; `threshold` or `unit`; `wrong case` (or `must
  fail`, `negative case`); `depth`. Words are read from the event's string values other than a requirement record's
  own fields (`depth`, `oracle`, `on_base`, `check`, `id`, `source_line`, `refuted_by`, `text`, `asserts`,
  `near_misses`) and the criteria's own texts, so a requirement at unit depth never reads as a flag for the unit, and
  the second criterion's text was written without any of the words. A list of the lacking parts as strings in a field
  of the event, or a sentence naming them, both read.
- **Closes or Part of** (AC2, AC9): the agent's `gh pr create … --body "Closes #n"` at PreToolUse, with the hub up,
  while a requirement of the issue's task is unproven, is refused with a reason naming `Part of` and the unproven
  requirement (its `id`, its text, or for AC9 the criterion's `#322.<hash>` ID); the same call with `Part of #n` is
  allowed. No forge is reached: the call's effect is nothing and its response names no pull request.

## Wrong programs

Each is code the implementer writes, selected with `DEEP_HUB_PLANT=<name>` on `deep hub run`. A plant the base doesn't
list stops the hub from starting (`plantOf` throws), so its test fails BLOCKED, never passes. Each wrong-program test
runs its criterion's scenario on the planted hub and requires it to fail with a message naming what the issue says it
names. `failureOf` rethrows BLOCKED and INCONCLUSIVE, so neither counts as the plant's failure.

| Name | Criterion | What the plant does | How the test fails on it |
|---|---|---|---|
| `criteria-from-github-api` | AC3 | the gate reads a task's criteria from the GitHub API itself, never from the item's `work.item@1` reading, so a test source's item gets none | no definition from the criteria, or one without them; the test requires the failure to name a criterion or the definition |
| `role-from-comment-text` | AC4 | the reader takes a comment author's role from the comment's text ("— the repo owner" makes them owner) | the signed comment's definition locks with no ask, or waives R2, or drive-by isn't marked outside; the failure names `drive-by` |
| `every-author-collaborator` | AC4 | the reader marks every author a collaborator (the design's broken fake) | drive-by's waiver counts, or the definition locks with no ask; the failure names `drive-by` |
| `app-membership-as-collaborator` | AC14 | the reader takes an app account's membership as collaborator, so its "skip the e2e test" waives R2 | R2 is waived or the definition locks with no ask; the failure names `octo-app[bot]` |
| `spec-only-judges-early-claim` | AC10 | a claim made before its definition locks is judged on the repo's spec alone | the stop replies PASS on the fixture (spec green, definition waiting); the failure names `PASS` |
| `lint-number-only` | AC11 | the criteria lint only looks for a number, so 'under 5' passes as a threshold with its unit | the 'under 5' criterion isn't flagged for its unit; the failure names `under 5` |
| `runs-disk-bytes` | AC12 | the claim's checks run the files as they are on disk, not the approved bytes kept by digest (the base lists it, from #303); its lock still keeps the check and the expected output by digest | R1's run doesn't fail: the rewritten `exit 0` is recorded `uncounted`, and the check against the rewritten expected output `passed`; the failure, "the claim's checks still run the approved bytes", names the file |
| `hash-check-paths` | AC12 | the definition's hash leaves out each drafted check's bytes and the expected outputs it references (the base lists it, from #303) | after the rewrite the claim's recomputed hash (`claim.made` `hash`) equals the locked one; the failure, "the definition's hash covers <file>'s bytes", names the file |
| `lock-before-any-check` | AC13 | the gate waits for the definition's lock before running any check, the repo's spec included | stop 1's FAIL on the unit check is held back; the failure names `unit` |

The issue names no wrong program for AC1, AC2, AC5, AC6, AC7, AC8, AC9 and AC15. The base is theirs
(`BASE-FAILURE.txt`): it runs no spec check from `done.yaml` at a claim, reads no `criteria`, has no GitHub source,
no trust reading at the gate, no Closes/Part of mapping, no lint, and keeps no expected output by digest.

## Criteria to tests

Each `describe` and test name starts with its criterion's number and ID, `#322.<first 8 hex of SHA-256 of the
criterion's text>`: trimmed, whitespace collapsed, `- [ ] ` dropped, as `scripts/proof-change.mjs` computes it. Every
failure message starts with them too.

| ID | Criterion (short) | Test file | What the test does |
|---|---|---|---|
| AC1 `#322.6e5671a4` | an untrusted repo's spec commands never run | `trust.test.ts` (2) | control: trust recorded as #348 records it, the spec's `unit` runs on the claim; then no decision and no agent trust: no run of `unit`, no PASS; and Claude Code's workspace trust alone runs it |
| AC2 `#322.91ab2030` | an unproven criterion keeps the PR at "Part of" | `closes.test.ts` (1) | the test source's issue, R2 (the e2e test) with no check; `gh pr create … "Closes #7"` refused naming Part of and R2; `"Part of #7"` allowed |
| AC3 `#322.05b69f95` | a test source's criteria reach the definition; a GitHub-API reader fails | `source.test.ts` (2) | item-9 at work.test with two criteria, no draft: the lock quotes each, authored maya/owner; the wrong program `criteria-from-github-api` |
| AC4 `#322.fe8625c3` | the GitHub source reads roles from the collaborators; text-role and all-collaborator readers fail naming the author | `github.test.ts` (3) | recorded issue 7, drive-by's comment, collaborators [maya]; one ask, no lock without it, R2 stays, R3 drive-by/outside, R1 and R2 maya/owner; the wrong programs `role-from-comment-text` (signed comment) and `every-author-collaborator` |
| AC5 `#322.141e3358` | the repo's spec plus the task's definition, in one stated order | `combine.test.ts` (1) | two worlds: unit green and R1 red, then the reverse; both checks run on each claim, FAIL by the precedence naming the failing one, the same run order in both |
| AC6 `#322.409cdea1` | "usage limit reached" with no rate-limit record is judged and sent back | `usage.test.ts` (1) | no draft, the spec's unit check failing; the stop's words; `agent.stop` claim: true with no plan-window cause; a claim; sent back naming unit |
| AC7 `#322.e30870fe` | drafted checks kept under `.deepbuild/`, behind its guard | `guard.test.ts` (1) | a draft whose check is `tests/checks/outside.sh` doesn't lock at that path, the record naming it and `.deepbuild/`; Edit and Write of `.deepbuild/checks/expired-token.sh` refused naming deep_propose, like `done.yaml`; `src/auth.js` allowed |
| AC8 `#322.867415e9` | the send-back names the missing proof precisely | `sendback.test.ts` (1) | unit green, R1's check failing; the block reason names R1 (or its text) and the check's file, never just "tests failed" |
| AC9 `#322.5c042dfa` | in this repo, coverage from tagged tests; an untagged criterion keeps Part of; no hand mapping or ask | `coverage.test.ts` (1) | the session in this checkout; item windoliver/deepbuild#322 with AC1's and AC9's texts and a planted one; the lock's checks name tagged test files under tests/acceptance/322/, the planted one has none, no ask; `gh pr create … "Closes #322"` refused naming Part of and the planted ID |
| AC10 `#322.4f122abc` | a claim before the lock waits within the hold, then stays pending; a spec-only judge gives PASS | `early-claim.test.ts` (2) | the outside-text ask holds the lock; hold 8 s; the stop makes a claim, lasts the hold, never PASS; your answer locks it and R1's check runs; the wrong program `spec-only-judges-early-claim` |
| AC11 `#322.264334fa` | each criterion linted for its four parts; 'the export is fast' all four, 'under 5' the unit alone; a number-only lint fails | `lint.test.ts` (2) | item-11's two criteria, no draft; the flags in the record; the wrong program `lint-number-only` |
| AC12 `#322.0cd8cc47` | approved bytes by digest, the hash covering checks and the expected outputs they reference; a disk-bytes gate fails | `approved-redraft.test.ts` (6) | blind redraft (`AC12-REDRAFT.md`, #1750): R1's check `expired-status.sh` and the `expired-token.expected` it references; a `node -e` program that finds the file by its content rewrites the check to `exit 0`, or in a second arm the expected output to `200`, a write deep-hook doesn't match; the lock keeps both by digest (`evidence.read`), the claim's run of R1 fails from the approved bytes, the claim's recomputed hash differs from the lock's, a proposal names the file; a control with FLAG; the wrong programs `runs-disk-bytes` and `hash-check-paths` on each rewrite. The first draft `approved.test.ts` was removed with the owner's approval |
| AC13 `#322.9af33c69` | window at the reserve: spec checks run, FAIL goes back, else BLOCKED plan window, never PASS; after the reset the lock and the judgement | `window.test.ts` (2) | `windows.report` 95% used, reserve 10%; stop 1 sent back naming unit with no lock; stop 2 BLOCKED plan window, no PASS; the window reset, the lock, stop 3's run of R1's check; the wrong program `lock-before-any-check` |
| AC14 `#322.3d2ab46d` | an app account with write access: automated, the requirement stays; membership-as-collaborator fails naming the author | `github.test.ts` (2) | the newest work.item schema takes `automated`; octo-app[bot] (Bot, write) comments; one ask; R2 stays; R3's author octo-app[bot] with automated: true; the wrong program `app-membership-as-collaborator` |
| AC15 `#322.43590a58` | paged collaborators with a failing second page: no role from an earlier list; the text waits on one ask | `github.test.ts` (1) | a complete two-page read, sam on page 2, waives R2 with no ask (control); the file rewritten so page 2 fails; a session on issue 8: one ask, R2 stays, sam's R3 not collaborator or owner |

## What this suite could not encode

- **Where the GitHub source lives and how it registers** (`deep.registerSource`, a stream of `work.item@1` readings):
  only what its readings make the definition say is read. No `reading.recorded` or `source.called` event is asserted.
- **`issue_rev` for a GitHub issue**, and the exact `source_id` of a comment, are this suite's convention
  (`acme/shop#7`, `acme/shop#7.c<id>`), named in the handed drafts' `source_line`; the implementer may read them
  differently only by changing the drafts' lines, which the README says.
- **"One stated order"** (AC5): the order is asserted to be the same on two claims, not what it is or where it is
  stated.
- **The verdict's mapping to Closes or Part of in the record** (AC2, AC9): only the refusal of a `gh pr create` that
  says Closes while a requirement is unproven, and the allowed Part of, are asserted; a PR body DeepBuild writes
  through the forge needs the network. "Lists what's left" is read in the refusal's reason.
- **Watch-only for an untrusted repo** (AC1): read as no spec run and no PASS; no row or line says "watch-only".
- **The drafting job itself** (its plan usage, waiting at the reserve): the handed draft stands in for its output,
  and "waits at your reserve" is read as the lock not landing while the window is reported at the reserve.
- **Codex's trusted projects** (`~/.codex/config.toml`'s `[projects]` `trust_level = "trusted"`): only Claude Code's
  workspace trust is driven; the untrusted world has neither.
- **The role reading INCONCLUSIVE** (AC15): `definition.locked@4`'s author role is `you | owner | collaborator |
  outside`, so the test accepts any role but collaborator and owner for sam.
- **The plan's proof section**, "flags placeholder text", "still open" lists and the spec-draft ask in a repo with no
  spec are Scope with no criterion; nothing here tests them.
- **AC7's first clause** is read as: no definition locks with a drafted check at a path outside `.deepbuild/`, and
  the record says why. The issue states where drafted checks are kept, not what a draft naming a path elsewhere gets;
  a gate that moves such a check under `.deepbuild/` instead would pass the second half and fail the first's "the
  record names the path".

## Files

- `helpers.ts`: temp worlds (a home, the repo with its spec, unit test and drafted checks, the drafts, work-source
  and GitHub files), the project's trust decision, the hub as a process, `events.read`, `windows.report`, sessions,
  payloads and transcripts, deep-hook runs and their decisions (`decision`, `replyText`), the record readers
  (`expectTask`, `itemTask`, `lockedFor`, `claimsOf`, `runsOf`, `taskVerdicts`, `proposalsNaming`, `asksRaised`),
  `deep inbox answer`, and `verdict`, `failureOf`, `Inconclusive`.
- `work.ts`: the work items the sessions start from: the test source's readings and drafts, the recorded GitHub
  answers (`githubAnswers`) and the drafts for the GitHub issues.
- `fixtures/agent.mjs`: each session's Claude Code stand-in, the parent of that session's deep-hook runs.
- `trust.test.ts` (AC1), `closes.test.ts` (AC2), `source.test.ts` (AC3), `github.test.ts` (AC4, AC14, AC15),
  `combine.test.ts` (AC5), `usage.test.ts` (AC6), `guard.test.ts` (AC7), `sendback.test.ts` (AC8),
  `coverage.test.ts` (AC9), `early-claim.test.ts` (AC10), `lint.test.ts` (AC11), `approved-redraft.test.ts` (AC12),
  `window.test.ts` (AC13).
- `tsconfig.json`: the root's strict options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run on the base commit, trimmed to each test's failing assertion.

[How runs become one of five verdicts]: ../../../docs/technical-design.md
[The contract (kernel)]: ../../../docs/technical-design.md
[What done means, fixed at the start]: ../../../docs/technical-design.md
[An agent says it's done]: ../../../docs/technical-design.md
[First-party extensions that ship on by default]: ../../../docs/technical-design.md
[Threats, and what stops each one]: ../../../docs/technical-design.md
[How we know version 0 works]: ../../../docs/technical-design.md

## Redraft

**2026-11-03: AC7's `guard.test.ts` redrafted blind.** The first draft's first assertion built its failure message from an
entry that is undefined whenever the assertion holds (a `TypeError` on every correct program), so the criterion went to a
fresh run of the blind job with the same inputs (the issue, the design, the base commit and this suite's helpers), which
rewrote only `guard.test.ts`. Its two halves are unchanged in substance: no lock with a drafted check outside
`.deepbuild/` and the record naming the path, then the guard's refusals naming `deep_propose`. It fails on the base at
the first assertion; `BASE-FAILURE.txt` keeps the first draft's run.

