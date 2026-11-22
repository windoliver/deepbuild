# Acceptance tests for #1880: a reading job given to Codex runs, or is refused before it launches

Written first, blind, by a job that saw no implementation of a fix (none exists). It read:

- issue #1880 (Scope, 3 acceptance criteria, Proof, Depends on #63)
- `docs/technical-design.md` through `node scripts/design-section.mjs --issue 1880`: Reading by reference, and What each
  agent gives us, and the limits we design around (DeepBuild's own jobs: the binary resolved on the login PATH, its
  version recorded on the job, the job recorded before it starts and its process ID recorded before the prompt)
- `AGENTS.md`
- merged surfaces, to learn what to drive and what to read: `packages/hub/test/wiki.test.ts` and `packages/hub/test/hub.ts`
  (a wiki build on a real hub with Claude Code and Codex history in a temp HOME), `tests/acceptance/63` (the fake
  reader) and `tests/acceptance/356` (its install on the login PATH, plan windows through `windows.report`), the runner's
  public types (`JobRecord`, `Blocked`), `adapters/codex.facts.json` (launch, signIn, versions), and
  `tests/agent-name-branches.test.mjs`
- base commit `2eaaeb0e6693410db653a43377ec32dde1cc63ab`

The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job.

## How to run

```sh
npm ci; npm run build --workspaces
cargo build --locked -q -p deep-hook
systemd-run --user --scope -p MemoryMax=24G -p MemorySwapMax=2G env CARGO_BUILD_JOBS=2 \
  /var/tmp/deep40/node/bin/node node_modules/vitest/vitest.mjs run --root tests/acceptance/1880 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/1880/tsconfig.json
```

- Runs on Linux and macOS. On Linux the runner's bubblewrap sandbox reads only system folders, the login PATH and the
  program's own folder, so the node the hub runs on must sit in one of them (this machine's copy at
  `/var/tmp/deep40/node`); the hub's PATH and its recorded `runner.login_path` are `<tmp>/bin`, that node's folder and
  the system's.
- Without a built CLI or `target/debug/deep-hook` the tests are skipped with a `BLOCKED:` reason, never passed.
- Folders are under `/tmp/dh1880-*`, removed after the run. HOME is `<tmp>/h` for the hub and every child. No network,
  no model call. The hub is stopped by its PID (SIGTERM, then SIGKILL after 30 s); nothing is stopped by name or port.
- `--no-file-parallelism`: each test starts a real hub.

## The surface under test

1. **The wiki build** (#356): `wiki.build` on the hub's control socket, with one session in a git repo whose user
   messages say something worth a reading (`remember: the api always needs a token.`). The hub is `deep hub run` from
   the built CLI; `config.json` holds only `runner.login_path`, as `deep setup` records it, so the build picks the
   reading's agent itself.
2. **Sign-in, as each agent keeps it**: Codex by `~/.codex/auth.json` (made-up tokens) and `codex login status` exiting
   0, the facts' signIn; Claude Code by `~/.claude.json` (an `oauthAccount`) and `~/.claude/.credentials.json`.
3. **The runner's jobs** (`job.list`, `job.output`): kind `read`, `agent`, `state`, `refused`, `blocked`, `pid`,
   `start`, `ran`, `result`, and what the process printed.
4. **The ledger's `reading.finished` events** (#63), read from `<root>/ledger.db` on a read-only connection: `runs`,
   `state`, `invalid`. Every event's data is also scanned for something that reads BLOCKED.
5. **The fake agents**, first on the login PATH:
   - `fixtures/fake-codex.pl` as `codex`: `--version` answers the newest stable version `codex.facts.json` covers,
     `login status` exits 0, and `exec ... -` (the facts' read-only job launch, prompt on stdin) prints `codex exec
     --json` lines (thread.started, one `agent_message` holding a reading.answer@1 with no findings, turn.completed
     with usage). First it prints a line no real Codex prints, `{"type":"fake.codex","argv":[...]}`, so a job's output
     shows that the fake ran as that job's process. It also logs each call to `<tmp>/codex-calls.jsonl` when the call is
     allowed to write there. A call inside the runner's sandbox isn't, so that log shows only calls made outside a job.
   - `tests/acceptance/63/fixtures/fake-reader.pl` as `claude`, used in place: its `start` report carries the argv it
     was launched with.

## The tests

- **AC1** (`codex-reading.test.ts`, first test): Codex is the only agent signed in, and the history is a Codex session.
  The test fails if any read job runs on another agent, or if a job is refused, lost or ended on a failed turn, or a
  reading ended with an `invalid` reason, or the build returned an error. A failure that names `a Codex job takes no
  sub-agents` is checked first, so on the merge base the failure shows that text. Then it passes on either outcome:
  - **a recorded result**: a read job reached state `finished` with a `pid`, its `result` recorded and its output
    carrying the fake's `exec` line, and a `reading.finished` that names that job in `runs` has state `finished` and no
    `invalid`;
  - **BLOCKED before any process of the job starts**: something on record reads BLOCKED (`status` or `state` is
    `BLOCKED`, on a job record, inside one such as its `blocked`, or in any ledger event's data) with a non-empty
    reason (`why`, `reason`, `invalid` or `cause`). No read job has a `pid`, `start` or `ran`, no job printed the fake's
    line, and the fake's log has no `exec` call.
- **AC2** (second test): Claude Code is signed in and its plan window is reported (`windows.report`, 5% used), and the
  history is a Claude Code session. Every read job runs on `claude-code` and ends `finished`. Its launch, as the fake
  reports it, carries `--agents` with a `reader` entry and `Task` in `--tools`. Each `reading.finished` that names those
  jobs has state `finished` and no `invalid`. The issue's own proof for this criterion is that #63's suites pass
  unchanged, which is checked by running `tests/acceptance/63`. This test doesn't repeat them: it checks the same claim
  through the wiki build path this issue changes.
- **AC3** is proven by running `tests/agent-name-branches.test.mjs` with `tests/agent-name-branches.json` unchanged.
  No test here duplicates it.

## Readings where the issue leaves a choice

- **"Before any process starts"** means before any process of the job, that is, before the agent's launch (`codex exec`)
  that the runner records as the job's `pid`, `start` and `ran`. Two probes don't count as a process of the job: the
  hub's sign-in check (`codex login status`, which is how the build knows Codex is signed in, so the picker needs it)
  and the runner's version check (`codex --version`). The design runs the version check before a job starts and records
  its result on the job. On the merge base the version check does run before the launch throws.
- **"A recorded result"** is the reading's result, not only the job's: the job ran to its final result (`result` on the
  job record), and the reading that submitted it ended on that result (`reading.finished`, state `finished`, no
  `invalid`). A reading that ends `invalid: the job gave no final answer` while Codex's answer sits in the job record
  hasn't ended with a result. A planted twin that only stops the throw (runner `confine` ignoring the sub-agents) ends
  exactly that way and fails AC1. Twins that also read Codex's `agent_message` as the answer, or that read BLOCKED
  before submitting, pass. This is the strictest choice the criterion's words allow. A dispute goes to the blind redraft.
- **"Reads BLOCKED naming the reason"**: the issue doesn't name where. Any record the hub keeps counts: a runner job's
  `blocked` (its `why` or `cause`), a `reading.finished` whose state is `BLOCKED`, or any other event that reads BLOCKED
  with a reason. A refusal (`state: 'refused'`) is not BLOCKED (invariant 2). The reason's words aren't pinned, so a
  BLOCKED reason may say that Codex takes no sub-agent. Only a failed or refused job, or a failed reading, may not.
- **"Codex the only signed-in agent"**: no Claude Code sign-in files in HOME and no `claude` on the login PATH. The
  Codex `auth.json` has no `tokens.account_id`, so the runner reads the account as planless and no plan window holds
  the job. On the merge base that lets the job reach its launch, where it throws. With an account and no window
  reading, the job would wait at the gate and never reach the refusal the issue names.
- **History**: one Codex rollout (`~/.codex/sessions/...`, shaped as `packages/hub/test/wiki.test.ts` writes it) for
  AC1, and one Claude Code project transcript for AC2. Nothing pins which messages the build reads, only that it starts
  a read job. On the merge base it starts one for each.
- **The fake's answer** has no findings, so the build writes no claim from it and the tests pin no page. Pages are #356's.

## Main-side breaks found (not #1880's, reported to the caller)

- **Every reading fails on Linux at the base**: `@deepbuild/reading`'s `nodeReads()` runs `realpathSync` on each
  `process.report` shared object, and on Linux that list includes the relative name `linux-vdso.so.1`. The reading then
  ends `the reading failed: ENOENT ... lstat '<cwd>/linux-vdso.so.1'` before any job is submitted. On the unchanged base
  both tests fail that way (BASE-FAILURE.txt, run A). Run B is a scratch copy of the base with only that filter made
  absolute-only. There AC1 fails with `a Codex job takes no sub-agents` and AC2 passes. These tests can't pass on Linux
  until that is fixed on main.
- **`tests/agent-name-branches.test.mjs` fails at the base** (both of its tests): its list in
  `tests/agent-name-branches.json` names `core.ts` and `server.ts` counts that the code no longer has, and misses
  branches in `answer-delivery.ts`, `session-state.ts` and other files. Until main fixes that, AC3 can't be proven with
  the list unchanged.
- Seen while probing (not asserted): the reading submits `model: 'opus'`, and the runner passes it to Codex as `-m opus`.
