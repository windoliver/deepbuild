# Acceptance tests for #1108: replays that touch nothing

Written first, blind, from issue #1108 (its text as of November 4, 2026: Scope, the four acceptance criteria, Proof and
Depends on #304, #20, #112; it has no comments), the design sections it rests on (The learned layer; Threats, and what
stops each one; Building blocks' Replay and a clock, for tests; Platform modules' sandbox; How we know version 0
works), `AGENTS.md`, the base commit's `packages/config-eval/` (launcher, eval, archive and their tests),
`tests/acceptance/112/`, `packages/gate/src/open.ts` (`errorShape`), `packages/hub/src/setup.ts` and
`packages/supervisor/` (the bubblewrap backend), at base commit `e2e6e1cc` (main), by a job that never saw an
implementation of #1108. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind
redraft of this job.

Run them:

```sh
npm run build --workspaces              # the packages export dist/
node node_modules/vitest/vitest.mjs run tests/acceptance/1108
node node_modules/typescript/bin/tsc -p tests/acceptance/1108/tsconfig.json   # type check
```

Nothing calls a model, spends plan usage, needs the internet or a sign-in. Every test drives the **real default
launcher** (`runEval` with no `launcher`, as `packages/config-eval/test/launcher.test.ts` does). The real Claude Code
and its model are the boundary this repo doesn't own, so `claude` on the agent's PATH is a stand-in
(`fake-claude.mjs`, below) that does with its config what Claude Code does. Fixture servers listen on 127.0.0.1 only.
Temp folders are `dh1108-*` under the system temp folder, removed after each test with the servers; nothing is killed.

## The surface under test

The issue names `packages/config-eval/src/launcher.ts`, `runEval`, the replay's record and the report. The surface is
#112's, extended in `packages/config-eval/src/index.ts` (`@deepbuild/config-eval`); names here are this job's.

```ts
/** One outside call the original session made, with its result, as its transcript holds them. */
export interface RecordedCall {
  tool: string;      // Claude Code's tool name: 'Bash', or 'mcp__<server>__<tool>'
  input: unknown;    // the tool_use's input, as the session sent it
  result: string;    // the tool_result's text (a string, or its text blocks joined)
  error?: boolean;   // the tool_result was an error
}
export interface ReplayTask {
  id: string; at: number; repo: string; commit: string; prompt: string;   // as in #112
  recording?: RecordedCall[];   // the session's outside calls; present only when it made one
}
/** One outside call a replayed agent made, as the replay recorded it. */
export interface ReplayCall {
  task: string; side: 'base' | 'change'; repeat: number;
  tool: string;      // as in RecordedCall
  input: unknown;    // as the agent sent it
  answered: boolean; // true: it got the recorded result; false: the not-in-the-recording error
}
export interface EvalReport {
  // ...#112's fields: plan, hash, runs, after, before, held, usage
  calls: ReplayCall[];                                 // every outside call of every run (the replay's record)
  diverged: { task: string; calls: ReplayCall[] }[];   // each pair either side of which made a call the recording
                                                       // can't answer, with those calls; [] when none did
}
export function runEval(options: EvalOptions): Promise<EvalReport>;   // unchanged signature
export function archivedTasks(reader, read, checkout?): Promise<{ tasks: ReplayTask[]; skipped: ... }>;  // fills `recording`
```

`defaultLauncher(plan, env, deadlines)` keeps its signature; how it hands the recording to its runs (`AgentRun`,
`AgentResult` or otherwise) is the implementer's, since the tests reach it only through `runEval`. `recording` is
optional so `archivedTasks`' existing test, which compares sessions without outside calls by `toEqual`, still holds.

## Readings where the issue and design leave a choice

- **The stand-in Claude Code** (`fake-claude.mjs`) is what makes "loads your MCP servers", "your settings' allow rules
  readable" and "a call reaching the network" observable without the real CLI. It reads what Claude Code reads: its
  config home is `$CLAUDE_CONFIG_DIR`, else `$HOME/.claude`; its global config `$CLAUDE_CONFIG_DIR/.claude.json`, else
  `$HOME/.claude.json`; settings from `--setting-sources` (user, project, local by default) plus every `--settings`,
  with their `env`, permission rules, `defaultMode` and PreToolUse/PostToolUse command hooks (a deny, an allow, exit 2,
  `updatedInput`); MCP servers from every `--mcp-config`, plus, without `--strict-mcp-config`, the global config's user
  and local servers (and `.mcp.json` when settings enable it), over stdio or streamable HTTP, `${VAR}` expanded. In
  print mode a tool runs only if a hook allows it, a rule allows it or the mode bypasses permissions, else it gets
  Claude Code's not-granted error. Bash runs `bash -c` in its folder with its environment. It writes its transcript
  under its config home and its stream-json on stdout, as Claude Code does. Its sign-in is `ANTHROPIC_API_KEY`,
  `CLAUDE_CODE_OAUTH_TOKEN` or the config home's `.credentials.json`; with none it ends "Not logged in".
- **The model endpoint** is `ANTHROPIC_BASE_URL` in the eval's environment (a loopback fixture here); unset, the
  stand-in refuses to run rather than call a real API. At the end of each run the stand-in sends its model one request
  carrying everything it saw (its arguments, environment, settings, MCP servers, each call with its result, the files it
  could read, its connect attempts), as a model request carries tool results. That request is how the tests read a run;
  the model fixture answers 401 to any sign-in but the user's, and a run whose request never arrives fails.
- **What the stand-in does** is scripted per task by the task's words (the plan-window probe and any other prompt are
  answered at once). A step may be limited to the variant whose `CLAUDE.md` holds given words, so one side of a pair can
  make a call the other doesn't. `{{now}}` in a step's input becomes the time of the call and `{{tmp}}` a fresh
  `/tmp/build-<hex>` path.
- **Your home** (`<box>/you`, the eval's `HOME`) holds what a real one does: a model sign-in in
  `.claude/.credentials.json`; `.claude/settings.json` with allow rules (one of them, `Bash(./scripts/deploy-staging.sh:*)`,
  no launcher would write for itself) and a plug-in; `.claude.json` with a `chat` MCP server (HTTP, with a bearer token)
  and a `tracker` server; and gh's `hosts.yml` with a forge token, which is also `GH_TOKEN` in the environment. `gh` on
  PATH is a stand-in that sends its call to a loopback "forge" fixture, so a gh call that isn't answered from the
  recording reaches "the network".
- **An outside call** in these tests is an MCP tool call or a gh command; which other shell commands count (`git push`,
  `curl`) is the implementer's, since the sandbox refuses the rest anyway. **The recording** of an archived task holds
  its session's outside calls with their results (AC1 reads one through `archivedTasks` from a real record and evidence
  store); the other tests hand the eval tasks with `recording` set.
- **Answered from the recording** means the agent's call gets the recorded result as a result, not an error: the text
  the agent sees equals the recorded result (trimmed). **Not in the recording** means the agent gets an error (an MCP
  result with `isError`, a failed command, or a hook's denial) whose text matches `/not in the recording/i`. How the
  replay answers (a stand-in MCP server per recorded server, a PreToolUse hook, a gh on PATH) is the implementer's.
- **Equal by tool and normalized input.** Every string in an input normalizes as `errorShape` normalizes error text:
  a temp path (`/tmp/…`, `/private/var/folders/…`) becomes `<tmp>`, `pid 123` becomes `pid <n>`, a timestamp `<time>`.
  AC4's replayed post differs from the recorded one only in its ISO time and its `/tmp/build-<hex>` folder, and gets the
  recorded result; a post about another build gets "not in the recording".
- **Diverged.** A pair either side of which made a call the recording couldn't answer is in `report.diverged` with that
  call, and stays in `after.n` as a failed pair (`after.tasks[i].failed: true`), as #112 keeps failed pairs; a pair whose
  calls were all answered doesn't diverge.
- **None of your MCP servers.** The agent loads no server of yours: no server config carrying your chat server's URL or
  token under any name, and no `tracker`. A stand-in named `chat` that answers from the recording is the replay's own.
  DeepBuild's own hook and MCP entries may be in the throwaway home; the tests neither require nor forbid them.
- **No credential but the model sign-in.** The agent reaches its model with your sign-in, and nothing it can read
  holds your forge token, your chat token, your allow rule or your plug-in: not a file under its `HOME` or config home,
  not your `settings.json`, `.claude.json` or gh `hosts.yml` by their own paths, not a settings value or MCP config it
  was handed, not an environment variable. Each failure names the file (or variable, or server).
- **The sandbox, observed on Linux and macOS.** Each replayed agent, and a process it starts, tries a TCP connect to
  `192.0.2.1:443` (TEST-NET-1, RFC 5737: never a real host). The replay's sandbox must refuse it, which the platform
  sandboxes report as `EPERM` or `EACCES` at once (the supervisor's suite reads a refusal the same way); with no sandbox
  it hangs until the probe's 2 s are up, and a missing route (`ENETUNREACH`) is not a refusal. The model endpoint must
  stay reachable. On Linux the supervisor's bubblewrap backend (Landlock and a seccomp filter, no root) can do this: its
  grant names loopback ports, so the model endpoint, a loopback fixture here, is granted by port, and an outside model
  host needs a loopback way out such as the run's egress filter (#1106). On macOS, Seatbelt refuses the same connect
  with `EPERM`. The stand-in, its interpreter (`bin/node`, a hard link or copy of the node running the tests) and `gh`
  all sit in the one folder PATH names for them, so a sandbox that lets the agent run its own CLI needs only that folder.
- **What a live run would add.** The real Claude Code on your plan, signed in through the throwaway home (on macOS the
  sign-in is in the Keychain, so the home then holds a way to it rather than a file), its model at
  `api.anthropic.com:443` reached through the sandbox's one way out, and a refused connect to a real host such as
  `github.com:443`. These tests don't run one; the Proof's three failures are shown on the base by this suite.
- **20 tasks** (AC3) replay with one repeat a side, so 40 runs; the measure is `tokens` only, so no judge runs. The
  other tests use one to three tasks.

## Criteria to tests

| ID | Criterion (short) | Test | The wrong program, and how it fails |
|---|---|---|---|
| AC1 `#1108.13e6be53` | a release note posted through a chat MCP tool replays with no message sent | `chat.test.ts` | a launcher that loads your MCP servers sends the post: the chat fixture's request count, naming your server `chat` at its URL, and `tracker` loaded; no recording: the live answer, not the recorded one; no record: `report.calls` missing |
| AC2 `#1108.00f85bd0` | `gh pr create`, never called by the original, gets "not in the recording"; recorded; the pair reads diverged and stays in the denominator | `diverged.test.ts` | a call let through reaches the forge fixture (or, sandboxed, fails with a connect error, not "not in the recording"); an eval that drops the pair fails `after.n` 3 and the failed-pair list; one that keeps it whole fails `failed: true`; no record fails `report.calls` and `diverged` |
| AC3 `#1108.2ddbed50` | a 20-task replay finishes in a sandbox denying every host but the model endpoint and loopback; no credential but the model sign-in | `sandbox.test.ts` | no sandbox: the connect to 192.0.2.1:443 isn't refused; a launcher leaving your settings, `.claude.json`, gh `hosts.yml` or `GH_TOKEN` readable fails naming each; a sandbox that blocks the model endpoint or drops the sign-in fails the 40 runs and the sign-in check |
| AC4 `#1108.b3120abf` | a call equal to a recorded one but for a timestamp and a temporary path gets the recorded result | `normalize.test.ts` | a matcher comparing raw input returns "not in the recording" for build 512 (and reads that pair diverged); one that ignores input answers build 513 |
| Proof | the chat post with zero requests, the diverged `gh pr create` pair, the sandbox's denied hosts, each failing first on the current launcher | all four, `BASE-FAILURE.txt` | |

### Checked against a throwaway right program

The suite was run against a right program written in a scratch worktree of the base outside this checkout and deleted
afterwards; it was never in the repo. It ran the agent with a throwaway `CLAUDE_CONFIG_DIR` and `HOME` holding a copy of
the sign-in, `--strict-mcp-config` with one stdio stand-in per recorded server, `--setting-sources user` with a
PreToolUse hook answering gh from the recording (`updatedInput` for a match, a denial otherwise), an environment of
`PATH`, `HOME`, `CLAUDE_CONFIG_DIR` and `ANTHROPIC_BASE_URL` only, all inside the supervisor's bubblewrap backend
granting the CLI's folder, the node install, the config home, the checkout and the model endpoint's port. All four
tests passed (23 s at a load average near 180). Each of its mutants failed the tests named:

| Mutant | Tests that failed |
|---|---|
| your `.claude.json` copied in, no `--strict-mcp-config` | AC1 (`tracker` loaded), AC3 (`.claude.json`'s chat token readable) |
| your `.claude.json` copied in, no sandbox (run on AC1 and AC2 only) | AC1 (`tracker` loaded) |
| no sandbox | AC3 (outside connect not refused; your three files readable by path) |
| your settings copied into the throwaway home | AC3 (allow rule and plug-in readable) |
| `GH_TOKEN` passed on | AC3 (`GH_TOKEN` holds your forge token) |
| a diverged pair dropped from the comparison | AC2 (n, failed pair), AC4 (n) |
| a diverged pair kept as whole | AC2 (failed pair) |
| a matcher comparing raw input | AC4 (both build-512 runs, the record, diverged) |
| gh not intercepted, sandboxed (run on AC1 and AC2 only) | AC2 (connect `EACCES`, not "not in the recording"; no record; not diverged) |
| gh not intercepted, no sandbox (run on AC1 and AC2 only) | AC2 (the forge fixture got the calls, live results) |

In the right program a recorded server's stand-in takes its name, so a launcher that also loads your `chat` server
doesn't reach it there; the base launcher, which has no stand-in, sends the post (`BASE-FAILURE.txt`).

## Files

- `helpers.ts`: criterion IDs; the surface's types; the world (a fixture repo, your home, the stand-in CLI and gh on
  PATH, the loopback model, chat and forge fixtures, plans and tasks); `archivedTasksOf`, which archives a transcript in
  a real record over a real evidence store and reads its tasks back through `archivedTasks`.
- `fake-claude.mjs`: the stand-in Claude Code. `chat.test.ts` (AC1), `diverged.test.ts` (AC2), `sandbox.test.ts`
  (AC3), `normalize.test.ts` (AC4).
- `tsconfig.json`: as `tests/acceptance/112`. `BASE-FAILURE.txt`: the run on the base commit.

No fixture holds a secret or personal data: the tokens, sign-in, hosts, repo and channel IDs are made up and match no
token pattern.
