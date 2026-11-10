# Acceptance tests for #1923: paid job calls made once, and joins of a running job

Written first, blind, by a job that never saw an implementation of #1923; none exists at the base (`d51be2c3`), which
has #1922's job API. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind
redraft of this job (design: Dogfooding).

## What was read

- Issue #1923 (`gh issue view 1923`): Scope, the two criteria, Proof. Its parent #410 and its dependency #1922 for
  context. The IDs are computed from its checkbox text.
- `docs/technical-design.md`: Building blocks (the Job row: `deep_job` "returns its outputs by hash with a receipt",
  never "count as a verdict"; every outside call through a grant the supervisor enforces), the MCP tools row
  ("`deep_job` ... a paid call still asks"), the Ask shape (`kind: ... | unblock | ...`), Tasks only you can do (an
  unblock "says what to do and where ... and which check will prove it's done"; "a step that needs a sign-in or a key
  names a provider"), Fault injection ("the hub killed mid-run"), and the Runner block (a call to a provider over plain
  http on loopback only). `AGENTS.md`.
- `docs/canvas-primitives.md`: Asset job semantics (keyed by hash(tool@version, params, input hashes); a rerun with the
  same key is a cache hit) and, at the generation job, "A paid call is never made twice: the tool records its
  submission key before the request leaves and the provider's task ID when it answers, and a second job with the same
  key joins the first", with made_by holding "the provider's task IDs" and "each stage of a multi-stage job records its
  task, so a retry resumes from the last stage that finished".
- At the base, for surfaces and conventions only: `packages/hub/src/jobs.ts` (#1922's `deep_job` run: its key, its
  replies `done`, `held`, `refused`, `failed`, the authority ask and `job.rule`), `packages/extension-host/src/host.ts`
  (`runTool`: the tool run through the supervisor in the platform sandbox, stdin `{params, inputs}`, a read-only
  grant), `packages/extension-host/src/job-kinds.ts`, `packages/contracts/src/manifest.ts` (`job_tools`, a library
  source's `host`), `packages/supervisor/src/types.ts` (`Grant.hosts`, `Grant.write`, `guarded`), `packages/hub/src/
  core.ts` (`deep_job` needs no session; the hub's `jobs/` folder left to runs' own grants; `job.rule`),
  `packages/hub/src/mcp.ts` (`deep mcp` drops every notification), `packages/hub/src/plant.ts` (`DEEP_HUB_PLANT`),
  `packages/hub/src/libraries.ts` and `install.ts` (#1731: a manifest-named host that the install grants),
  `scripts/proof-change.mjs` (`criterionId`), `scripts/proof-runs.mjs` (twins). The suite `1922` is the template:
  layout, README, helpers (the hub, the cli role, the record and `deep mcp` are copied from it), BASE-FAILURE.

## Criteria and files

Each `describe` title is the criterion's ID and its text. The ID is `#1923.` and the first 8 hex digits of SHA-256 of
the checkbox's text after `- [ ] `, trimmed, white space collapsed (`scripts/proof-change.mjs`'s `criterionId`).

| AC | ID | File | Tests |
|---|---|---|---|
| AC1 | `#1923.404a0625` | `retry.test.ts` | the key before the request, the task ID after the answer; the hub killed between the two; the retry makes no second call, BLOCKED, one unblock ask naming the provider and the key; the planted tool `hosted-resubmit@1.0.0` |
| AC2 | `#1923.d2c84e1d` | `join.test.ts` | a second deep_job with the same key joins and starts no call; cancelling it leaves the job running for the first; planted runners `job-second-call`, `job-joiner-cancels-job` |

No `twins.json`: every test here fails on the base (the surfaces don't exist there; `BASE-FAILURE.txt`), and the
planted programs are a fixture tool and hub plants this suite selects itself.

## Run them

macOS, the repo's Node (24.22.0) first on `PATH`:

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:$PATH"
npm ci                                           # once
npm run build --workspaces                       # the tests run packages/cli/dist/main.js
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -p deep-hook    # the hub won't start without it
NO_COLOR=1 npx vitest run tests/acceptance/1923 --testTimeout=600000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/1923/tsconfig.json
```

- **One at a time:** every test starts its own hub, which runs the test plug-in and the tool's processes through the
  supervisor, and AC1 kills and restarts its hub, so the implementer adds `tests/acceptance/1923/` to `alone` in
  `scripts/lanes.mjs` (not done here: this job writes tests only). The supervisor's sandbox needs a shell that may
  start it (in Claude Code, the Bash tool with its sandbox off).
- **Needs:** `ps`.
- **Safety:** every folder is under `/tmp/dh1923-*`, removed after its file; every hub, `deep` command and `deep mcp`
  runs with `HOME` in its world's temp folder and without the caller's `DEEP_*`, `CLAUDE*`, `CODEX*`, `NODE_OPTIONS`;
  every process this suite starts is stopped by its PID, and a PID is dropped once its process exits, so a reused PID
  is never signalled; the hub AC1 kills is one this suite started, killed by its PID. Nothing is stopped by name or
  port. The provider listens on 127.0.0.1 and nothing leaves it. No model is called and nothing is paid: the "paid"
  tool declares a cost and calls the test's own server.
- **The proof** (the issue's Proof line) is written to `$TMPDIR/deep-1923-proof/`, rewritten each run: the
  submissions the provider got (each with its key and whether the journal held it when it arrived), the journal lines
  (the key, then the task ID), the replies, the asks, and each planted program's failures.

## The world (`helpers.ts`)

One world per test: a temp home; **a real hub** (`deep hub run`) with `DEEP_HUB_TEST_CONFIRM` (the OS confirming you,
stubbed, as #1922's suite does) and, for a planted runner, `DEEP_HUB_PLANT`; **the test provider** (below); **a
project folder** holding the inputs, the working folder of **a `deep mcp`** spoken to as an agent's MCP client does
(`initialize`, then `tools/call`), and in AC2 two more `deep mcp`s, each another agent's; and **the hub's socket as
the cli role** for `events.read` and `job.rule`. The test plug-in is installed with `deep install <folder>` as you,
and **your standing rule** for its paid tool (`job.rule {tool, usd: 0.02}`, #1922) lets its calls run with no
authority ask, so a retry or a second request can reach the provider unless the hub stops it.

## The surface under test (readings where the issue leaves a choice)

The issue and the design name the submission key, the provider's task ID, the hub kill, the retry, `BLOCKED`, the
unblock ask, the joining request and its cancellation. Where they leave a name or shape open, this job picked the
smallest surface the design, #1922's `deep_job` and the base code imply; each choice is listed here so the
implementer builds to it.

1. **The test job kind and its paid tool.** One test plug-in, `test/hosted@1.0.0` (`fixtures/hosted`), registers
   through #1922's API the kind `test.hosted` (params `{case: "upper"}`, one text input `text`, one text output `text`,
   the key `["tool", "params", "inputs"]`, no output checks, one qualification fixture `fx-hello`: "hello" to "HELLO")
   and its one tool, the paid test job tool `hosted-upper@1.0.0` (`run: {dir: "tool", entry: "hosted.mjs"}`,
   `cost: {usd: 0.02}`). The tool makes nothing itself: it asks the provider, which writes the text in upper case.
   deep_job's arguments are #1922's: `{op: "run", kind: "test.hosted", tool, params: "{\"case\":\"upper\"}", inputs:
   [{name: "text", path}]}`.
2. **A tool that calls a provider names it in its manifest:** its `job_tools` entry gains `provider`, the one host it
   calls, `"<host>:<port>"` (here `127.0.0.1:<the test provider's port>`), and the manifest's `access.words` holds
   `hosts`, as #1731's library sources name their host. The install grants that host to that tool's process alone.
3. **The grant.** The runner starts such a tool as #1922 does (through the supervisor, in the platform sandbox, `node
   <dir>/<entry>`, stdin and stdout as #1922's), with its grant widened by exactly two things: connecting to its
   provider's host (`Grant.hosts: ["127.0.0.1:<port>"]`), and writing its call journal (the file, or the folder that
   holds it). The tool reaches no other host.
4. **How the tool learns its provider and its key:** on stdin. The JSON object #1922 gives a tool,
   `{params, inputs}`, gains `call: {provider, key, journal}` on every run of a tool whose manifest entry names a
   provider, qualification runs included: `provider` the host as the manifest names it, `key` the run's submission
   key, `journal` the absolute path of the call journal for that key. For a deep_job run the submission key is the
   job's key, the `key` its receipt names (#1922's hash of tool@version, the canonical params and the input hashes), so
   a second deep_job with the same tool, params and input bytes has the same key. The fixture tool makes no call
   without `call` (it exits 2).
5. **The call journal** is a file under the hub's `jobs/` folder (`~/.deepbuild/jobs/...`, the folder the hub
   already leaves to runs' own grants), one per key, the same path for every run with that key. The tool appends JSON
   lines and syncs each to disk: `{"key": K, "provider": P}` before its request leaves the machine, and
   `{"key": K, "provider": P, "task": T}` when the provider answers with its task ID `T`. The tool never reads it; the
   hub reads it and keeps it (it doesn't delete or rewrite those lines), and writes nothing in it before the tool
   runs: what the hub finds there is the tool's record. "Recorded" in the criterion is read as such a line being in a
   file under `jobs/` (the test reads every file there).
6. **The provider and the request.** The provider is a local HTTP server the test starts on 127.0.0.1 (`openProvider`),
   a hosted model's stand-in. The tool's request is `POST http://<provider>/tasks` with the header
   `Idempotency-Key: <K>` and the body `{"text": "<the input>"}`; the answer is `{"task": "task-<n>", "text": "<the text
   in upper case>"}`. The provider counts every submission it gets, whatever its key, and never dedupes, so "makes no
   second call" is counted at the provider, never taken from the tool's or the hub's word. For each submission, at the
   moment it arrives (the earliest the test sees a request leave the machine), it reads the journal: "before the
   request leaves" is read as a line `{key: K, provider: P}` with no task already there. It answers at once, or holds
   the answer until the test releases it.
7. **The hub kill.** The provider holds the answer to the run on "xyz"; once that submission has arrived, the test
   kills the hub with SIGKILL by its PID, waits for it to exit, and starts `deep hub run` again in the same home with
   the same environment. The tool process the dead hub started is left to the new hub (its supervisor reaps what a
   crashed hub left; the provider never answers that request). The retry is the same deep_job call through the same
   `deep mcp`, once the new hub lists the kind with its tool.
8. **What a retry reads.** A key whose journal holds a submission line and no task line made a call whose fate the
   hub can't know: a retry with that key makes no call, and replies `{status: "BLOCKED", ask:
   "ask:<id>"}` (other fields free) with no outputs, every time, naming the same ask. That ask is one `ask.created` in
   the record, `kind: "unblock"`, whose data names the provider by its host as the manifest names it
   (`127.0.0.1:<port>`) and the key in full. A key whose journal holds no submission line made no call (the tool records
   before it sends), so a retry with it runs the tool again: the hub doesn't block on a run it merely lost.
9. **The in-flight join.** A deep_job run keeps its request open until its job ends, as #1922's does. A second run
   with the same key while that job runs waits on it, starts no tool and no call, and is answered with the job's
   outputs and a receipt naming the job's key with `joined: true`. Joiners come through other `deep mcp`s (each
   another agent's), so the hub joins across connections.
10. **Cancelling the joining request** is MCP's own: the joiner's client sends `notifications/cancelled` with
    `{requestId: <that request's id>, reason}` to its `deep mcp`. That request then gets no done reply (no reply, or
    one that isn't `status: "done"`), and the job runs on: the tool's request to the provider stays open, and the
    first request and any other joiner are answered with the outputs once the provider answers.
11. **Call counts** are the provider's: the submissions whose text is the job's input, from just before the job's
    first call until 1 s after its last reply. Waits for what must not happen (a second call, an early reply, a
    dropped request) are 3 s each.

## Plants

| Plant | Criterion | The wrong program | Read as failed when |
|---|---|---|---|
| `hosted-resubmit@1.0.0` (a tool, `fixtures/tool/resubmit.mjs`) | AC1 | the tool records its submission key only once the provider answers, beside the task ID; after a hub kill between the request and the answer nothing is recorded, so the retry submits again | the judge sees a second submission of "xyz" at the provider and fails, naming the second call (and the key) |
| `job-second-call` (`DEEP_HUB_PLANT`) | AC2 | the runner runs the tool again for a request whose key's job is running, as if none were | the judge sees more than one submission for the key and fails, naming the key and the second call |
| `job-joiner-cancels-job` (`DEEP_HUB_PLANT`) | AC2 | when a joining request is cancelled, the runner cancels the job it joined | the judge sees the tool's request to the provider dropped, or the first request answered before the provider, and fails "cancelling the joining request ...", naming the key |

The hub plants are the implementer's, selected with `DEEP_HUB_PLANT` as `src/plant.ts` selects #1922's `job-key-*`;
each gets only the join wrong, and the rest of the hub is as it ships. At the base each name is refused ("names no
planted program"), so those tests fail there.

## How each criterion is read

- **AC1** (`retry.test.ts`, `judgeRetry`): in a world with `hosted-upper@1.0.0` and your rule, deep_job on "abc":
  one submission at the provider, carrying a key `K1` that the journal held, with the provider's host, when it
  arrived; the run done with "ABC" by hash, its receipt's `key` equal to `K1`; the journal then holds
  `{key: K1, provider, task}` with the task the provider answered. Then deep_job on "xyz" with the provider holding its
  answer: its submission's key `K2` journaled when it arrived; the hub SIGKILLed and started again; the same deep_job
  twice: no second submission of "xyz" (counted 1 s after the second reply), each reply `status: "BLOCKED"` with no
  output and the same `ask`, the record gaining exactly one unblock ask from just before the kill through the second
  retry (one the new hub raises as it starts counts), whose handle the replies name and whose words name the
  provider's host and `K2`. The planted tool `hosted-resubmit@1.0.0` in the same judge
  must give a failure naming the second call.
- **AC2** (`join.test.ts`, `judgeJoin`): in a world with `hosted-upper@1.0.0` and your rule, and `deep mcp`s A, B
  and C: A's deep_job on "abc" reaches the provider, which holds it (key `K`); B's same deep_job is unanswered 3 s on;
  B's request is cancelled (`notifications/cancelled`), and 3 s on the provider still holds the tool's request open
  and A is unanswered; C's same deep_job is unanswered 3 s on. The provider answers: A is done with "ABC" by hash, C is
  done with "ABC" by hash and a receipt whose `key` is `K` and `joined` is `true`, B has no done reply 1 s after, and
  the provider got one submission of "abc" in all. Each failure names `K`. `job-second-call` must give a failure
  naming `K` and "second call"; `job-joiner-cancels-job` one starting "cancelling the joining request" and naming `K`.

## Known limits

- "Before the request leaves the machine" is read when the request reaches the provider on 127.0.0.1, the earliest
  the test can see it; a tool that records after connecting but before sending its bytes would pass. The fixture tool
  records before it connects.
- The journal's lines are the fixture tool's. AC1's first clause reads the hub's part through them: the hub gave the
  tool its key, its provider and a journal path under `jobs/`, and granted it both. Whether the hub reads the journal
  is read through the retry: a hub that doesn't makes a second call.
- A retry after a kill once the provider answered (a task ID recorded, no output kept) isn't read: no criterion names
  it. Neither is a call cut by a full disk or an expired token (Fault injection).
- The unblock ask's other fields (what to do, the check that proves it done, its price) aren't read beyond its kind
  and its naming the provider and the key; its schema is the asks core's.
- Process counts aren't read: "makes no second call" and "starts no call" are counted at the provider.
- The timing windows (3 s) assume the tool's process starts within them on an idle Mac; a slower start can only hide
  a wrong program's second call until the final count, which still sees it.
