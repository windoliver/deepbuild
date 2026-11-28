# Acceptance tests for #1880: a reading job given to Codex runs, or is refused before it launches

Written first and blind by the acceptance-test drafting job. Nobody else edits these files (AGENTS.md, Proof). A
dispute goes to a blind redraft of this job.

## Inputs

- Issue #1880: its title, body, Scope, three acceptance criteria, Proof and Depends on (#63).
- `AGENTS.md` and `docs/technical-design.md`, Reading by reference and What each agent gives us, and the limits we
  design around (printed by `node scripts/design-section.mjs --issue 1880`).
- The base commit `654c560c1468816186f16ab34830840b96746f0c`, checked out on its own. Sources read: `packages/runner/src`
  (`agents.ts`, `runner.ts`, `types.ts`), `packages/reading/src/index.ts`, `packages/hub/src/wiki-build.ts`,
  `hub-control.ts`, `hub-shared.ts`, `sign-in.ts`, `keychain.ts`, `client.ts`, `packages/record/src/learned.ts`,
  `adapters/{claude-code,codex}.facts.json`, `tests/agent-name-branches.test.mjs`. Suites used as patterns:
  `packages/hub/test/wiki.test.ts` and `hub.ts`, `packages/runner/test/runner.test.ts`, `tests/acceptance/{39,63,356,1100,2123}`.

This job saw no fix, diff, branch, other checkout, pull request or session.

## How to run

```sh
npm ci && npm run build --workspaces      # the tests start the hub from packages/cli/dist
systemd-run --user --scope -p MemoryMax=24G -p MemorySwapMax=2G \
  /var/tmp/deep40/node/bin/node node_modules/vitest/vitest.mjs run \
  --root tests/acceptance/1880/tagged-redraft --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/1880/tagged-redraft/tsconfig.json
```

- Use `/var/tmp/deep40/node/bin/node` on this Linux box. The runner's sandbox (bubblewrap) must be able to read the hub's
  node, and the reading job's MCP tools run on it.
- `--no-file-parallelism`: two files start real hubs with sandboxed jobs.
- **The base the "unchanged" checks compare against** is the checkout's merge base with main:
  `git merge-base HEAD origin/main`, run in the repo. The proof lanes (`scripts/proof.mjs`, `scripts/affected.mjs`) set
  no variable, so a change main made since the draft (such as `tests/agent-name-branches.json` in `bd8b28b98`) isn't
  counted as this issue's. When that command fails (no `origin/main`, or no common history), the base is
  `654c560c1`, the commit these tests were drafted at. `DEEP_1880_BASE=<sha>` overrides both.
- Each test gets its own temp HOME under `$TMPDIR/dh1880-*`, removed afterwards. The hub gets your environment minus
  every `CLAUDE*`, `CODEX*`, `ANTHROPIC*`, `OPENAI*`, `DEEP_*`, `AI_AGENT` and cloud-key variable. Its PATH is the
  test's bin, then `/usr/bin:/bin`. Each hub is stopped by its own PID (SIGTERM to the child the test spawned), never
  by name or port.
- No network, no model call, no keychain: the keychain stand-in reads nothing under a temp HOME.
- `target/debug/deep-hook` isn't used: no hook is sent.

## Stand-ins

These are the only stand-ins, both at boundaries the repo doesn't own:

- `fixtures/fake-codex.pl` is installed as `codex` on the runner's login PATH (`config.json`'s `runner.login_path`).
  `--version` prints a version Codex's facts cover (the newest plain release, read from `adapters/codex.facts.json`).
  `login status` exits 0. `exec --json … -` prints `thread.started`, a `fake` line with its argv, an agent message
  `{"findings":[]}` and `turn.completed`.
- `fixtures/fake-claude.pl` is installed as `claude`. `--version` prints a covered version, `auth status` prints
  `{"loggedIn":true}`, and a headless run prints the init line, a `fake` line with its argv, and a `result` of
  `{"findings":[]}`.

Each fake's one `__VERSION__` placeholder is replaced when the test installs it (`installFake` in `helpers.ts`), and
the test reads its version from the facts. Both are Perl, as #39's and #63's fakes are, so they run inside the sandbox
with only `/usr/bin`. Sign-ins are files with made-up values: `~/.codex/auth.json` (tokens, no account ID, so the job is planless and waits on no window) and
`~/.claude.json` (an `oauthAccount` with a made-up UUID). The history is one session per test, written where each
agent keeps it, holding one user message that the wiki build's worth-reading filter keeps.

## The criteria

| Tag | File | Test |
|---|---|---|
| `#1880.28966ae3` | `codex-only.test.ts` | a wiki build with only Codex signed in ends its reading with a recorded result, or reads BLOCKED naming the reason before any process starts, and never fails with "a Codex job takes no sub-agents" |
| `#1880.964d40e3` | `claude-reader.test.ts` | a wiki build with Claude Code signed in runs its reading job on Claude Code with the reader sub-agent and the Task tool, and the job ends finished |
| `#1880.964d40e3` | `claude-reader.test.ts` | #63's suites are unchanged from the base commit |
| `#1880.f9683a09` | `agent-names.test.ts` | tests/agent-name-branches.test.mjs passes |
| `#1880.f9683a09` | `agent-names.test.ts` | tests/agent-name-branches.json is unchanged from the base commit |
| `#1880.f9683a09` | `agent-names.test.ts` | the hub, reading and runner sources hold no comparison against an agent's name the base commit didn't |

### #1880.28966ae3: the Codex-only wiki build (new behavior, must fail on the base)

This is the issue's Proof: a real hub, `wiki.build` on its socket, the runner's fixture agent, and only Codex signed
in. There is no `claude` anywhere on the login PATH, and the test checks that `/usr/bin` and `/bin` hold none. Once the
build returns, it reads `job.list` and every event (`events.read`) and asserts, in this order:

1. **The base's error never appears.** No read job's row and no `reading.finished` holds `a Codex job takes no
   sub-agents`. **On the base this fails.** The job is refused with `it couldn't start: a Codex job takes no
   sub-agents`: the runner's Codex `confine` throws at launch and the runner refuses the job with the thrown text, as
   the issue says. This is the assertion that names the criterion's merge-base behavior.
2. **One of the two outcomes holds:**
   - *A recorded result:* a `reading.finished` with `state: 'finished'` whose `runs` names a read job that is
     `agent: 'codex'` and `state: 'finished'`.
   - *BLOCKED naming the reason, before any process starts:* no `process.starting` event names any read job's run,
     and either a read job's row or the data of a `reading.*`, `job.*` or `wiki.*` event reads BLOCKED with a reason.
     That means an object holding the value `BLOCKED` beside a non-empty `why`, `reason`, `cause`, `invalid`,
     `refused` or `message`, or a string saying `BLOCKED` followed by words. The runner's own
     `blocked: { status: 'BLOCKED', cause, why }` qualifies.
3. **Every read job is on Codex.** A picker that leaves Codex out and falls back to Claude Code, which isn't signed
   in, fails here.

How this job read the criterion:

- **"Before any process starts"** is read as before the job's own process: no `process.starting` for the job's run.
  The runner's `--version` check of the binary runs under a run ID of its own and isn't counted. The sandbox gives a
  fake no place to log its calls outside its temp folder, so the record's `process.starting` events are what can be
  observed.
- **"Reads BLOCKED"** needs the word BLOCKED, as invariant 2 names it. A plain refusal such as `no claude on your
  login shell's PATH`, or a thrown error, is neither outcome.
- **"A recorded result"** is the reading's `reading.finished` with state `finished`, on a finished Codex job. The test
  doesn't require the answer to parse: on the base, `answerOf` reads only Claude Code's `result` lines, and how a
  Codex answer is read is the implementer's choice.

### #1880.964d40e3: Claude Code keeps its reader sub-agent (must not change, passes on the base)

- **Hub test.** A real hub signed in to Claude Code only, with the plan window reported at 5% through
  `windows.report`, runs `wiki.build`. Every read job must be `agent: 'claude-code'` and end `finished`, with one
  `reading.finished` of state `finished` each. The fake's `fake` line, read through `job.output`, must show:
  - `--agents` whose JSON names `reader` with a string `prompt`;
  - `--tools` listing `Task`.

  These two values are how the runner's Claude Code `confine` passes a job's sub-agents on the base
  (`packages/runner/src/agents.ts`), and the design's Reading by reference gives hand-offs to sub-agents as the way a
  reading works.
- **Unchanged test.** `git diff --name-only <base> -- tests/acceptance/63` and the untracked files under that folder
  are both empty. `<base>` is the merge base described under How to run.
- **#63's own suites** are macOS-only (their README: Seatbelt through the supervisor), so they aren't spawned from
  here. On the Mac runner run
  `node node_modules/vitest/vitest.mjs run --root tests/acceptance/63 --no-file-parallelism` and cite that run. Until
  it runs, this criterion is INCONCLUSIVE.

**Planted wrong programs these fail on:**

- A reading that drops the reader sub-agent for every agent, i.e. `packages/reading/src/index.ts` submitting without
  `subagents: { reader: READER }`, or a runner whose Claude Code `confine` stops passing `--agents`. The hub test fails
  at "was launched with --agents".
- A fix that gives Claude Code `subagents: {}` while keeping `--agents` fails at "sub-agents … toContain('reader')".
  One that drops only the Task tool fails at the `--tools` line.
- Any edit to a file under `tests/acceptance/63` fails the unchanged test.

### #1880.f9683a09: no new comparison against an agent's name (must not change)

- **The named suite.** `node --test tests/agent-name-branches.test.mjs` exits 0.
- **Its list.** `tests/agent-name-branches.json` deep-equals its copy at `<base>`, the merge base from How to run.
- **A wider scan.** The suite's own pattern runs over `packages/hub/src`, `packages/reading/src` and
  `packages/runner/src`, counted per file and expression, and no count may exceed `<base>`'s (read with
  `git archive <base>`). Why: the suite scans only `packages/hub/src`, but the criterion's own words are "no new
  comparison against an agent's name", and Scope says "which agents can take a sub-agent is read from the adapter's
  facts or caps, not from a name". The change this issue needs sits in the reading and runner packages, where
  `spec.agent === 'codex' ? {} : { reader }` would pass the suite unnoticed. One limit: moving an existing comparison
  into another scanned file counts as new there.

**Planted wrong programs these fail on:**

- `const planted = (meta: { agent: string }) => meta.agent === 'codex';` appended to `packages/hub/src/core.ts`
  fails the named suite. That is the suite's own planted twin.
- A new entry, or a raised count, in `tests/agent-name-branches.json` fails the list test.
- `subagents: spec.agent === 'codex' ? {} : { reader: READER }` in `packages/reading/src/index.ts`, or a new
  `job.spec.agent === 'codex'` in `packages/runner/src`, fails the wider scan.

## On the base

`node_modules` and every `packages/*/dist` are missing from the base checkout, and this job installs nothing, so
vitest couldn't run here. What these tests do on the base, from reading it:

- `codex-only.test.ts` should fail at assertion 1, as described above. This wasn't run.
- `claude-reader.test.ts` should pass. This wasn't run.
- The second and third `agent-names.test.ts` tests pass trivially at the base, since they compare the tree with
  itself. This wasn't run under vitest.

One check needs neither node_modules nor a build, so it did run: the named suite, inside the capped scope.
`BASE-FAILURE.txt` holds that run. **It fails on the base: both of its tests, exit 1.** The hub's agent-name branches
have since moved out of `core.ts` and `server.ts` into `answer-delivery.ts`, `session-state.ts`, `work.ts` and others,
and `agent-name-branches.json` still lists them under their old files. `scripts/known-failures.json` doesn't list it.

So `#1880.f9683a09` can't pass on this base as written: the list has to change for the suite to pass, and the
criterion says the list stays unchanged. This is a main-side break, not this issue's. Two ways forward, neither of
which this job may choose:

- main fixes the list in a PR of its own. This issue's PR then merges main, and its merge base, which the
  "unchanged" checks pick up on their own, includes that fix. The coordinator reports that main changed the list in
  `bd8b28b98`; this job hasn't seen that commit or whether it fixes the list;
- the criterion is redrafted with the user's approval.

Until one of them happens, this criterion is BLOCKED on main.
