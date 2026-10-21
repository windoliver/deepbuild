# Acceptance tests for #48: agent test harness

These tests were drafted from issue #48 (its text as of October 18), `docs/technical-design.md` and the base commit `1de288c`. Per AGENTS.md, the implementing agent doesn't edit them. A dispute goes to a blind redraft by this job.

This is the second draft. Since the first, the coexistence and manual-evaluation criteria moved to #18 and #26, so their tests, `--plant`, `eval` and the `coexist` scenario are gone. The issue's scope now says how unpriced usage is reported and that the budgets run as a preflight lane, so the run log's cost fields changed and the lane is new.

## The surface (my choice, since none was named)

Neither the issue nor the design names a command, a run-log field or a lane name for the harness. I picked the smallest surface that fits the repo, next to the existing `scripts/*.mjs` tools: one command-line entry, run with node from the repo root.

```
node scripts/agent-harness.mjs run --scenario <held-stop|idle-wake|read-only-job>
     [--agent claude|codex]               default claude
     [--claude <path>] [--codex <path>]   binaries; default: resolved on your login shell's PATH
     [--cost-cap-usd <n>]                 cap for a priced run; default: the harness's own
     [--token-cap <n>]                    cap for an unpriced run; default: the harness's own
     [--timeout-ms <n>]                   per-session deadline; default 60000
     [--out <dir>]                        where run folders and transcripts go
node scripts/agent-harness.mjs all [--claude <path>] [--codex <path>] [--out <dir>]
node scripts/agent-harness.mjs budgets [--base <commit>] [--changed <path>]... [--budgets <file>]
     [--claude <path>] [--codex <path>] [--out <dir>]
```

- `run` starts one scripted session. `held-stop` and `idle-wake` are the October 4 scenarios. They run Claude Code in a pseudo-terminal with `--settings`, never `claude -p`. `read-only-job` starts a DeepBuild job with the read-only launch from the agent's `adapter.facts@1` file, through `codex exec` for Codex.
- `all` runs the four scripted sessions: `held-stop`, `idle-wake` and `read-only-job` on Claude Code, and `read-only-job` on Codex.
- `budgets` is the preflight's harness lane (below).
- `run` and `all` exit 0 only when every run passes.

### Run log

Stdout carries JSON lines. Lines that don't parse as a JSON object are ignored. Each run prints one object with a non-empty `run` field, whatever its outcome, including BLOCKED and a run stopped by SIGTERM:

```json
{
  "run": "<run token>",
  "scenario": "held-stop",
  "agent": "claude",
  "verdict": "PASS | FAIL | BLOCKED | INVALID | INCONCLUSIVE",
  "stop": "done | cost_cap | token_cap | timeout | interrupted | blocked",
  "reason": "<why, for anything but PASS>",
  "model": "<the model that answered, from the transcript>",
  "tokens": { "input": 10000, "cached": 0, "output": 4000, "count": "exact | estimate", "covers": "session | turn" },
  "cost": { "basis": "reported | estimated | unpriced | not captured", "usd": 0.03, "rateCard": "<name, when estimated>" },
  "cap": { "usd": 0.5 },
  "elapsedMs": 23456,
  "sessionId": "<the agent's session or thread ID>",
  "transcript": "<absolute path under --out: the run's copy of the session transcript or Codex rollout>",
  "settings": "<absolute path of the --settings file the session used, when there is one>",
  "workdir": "<absolute path of the folder the agent ran in>",
  "launch": { "argv": ["<binary path>", "<args>..."], "facts": "<path of the adapter.facts@1 file the launch came from>" },
  "processes": { "started": ["<pid>"], "lingered": ["<pid>"] },
  "evidence": {}
}
```

The cost fields follow the design's usage rules (Hooks are evidence: adapters; Plan usage, per account and per task):

- `cost.basis` is `reported` when the agent gave a price (Claude Code's status line `cost.total_cost_usd` or its `total_cost_usd`), `estimated` when the harness priced tokens from a named rate card, `unpriced` when the usage carries no price (Codex on a plan), and `not captured` when no usage was read. `cost.usd` is there only for `reported` and `estimated`. An unpriced or uncaptured run never prints `usd`, so it never reads as $0.
- `tokens` is an object of counts, or the string `"not captured"`, never zeros for missing usage. `input` excludes cached input: Codex folds cache hits into `input_tokens`, and they're taken back out. A Claude Code message repeats its usage on each content block's transcript entry, and it counts once. The counts are cumulative for the run.
- `cap` holds exactly one key. A priced run has `cap.usd` and stops at it with `stop: cost_cap`. An unpriced run has `cap.tokens`, a token cap standing in for its cost cap, compared with `input + cached + output`, and stops at it with `stop: token_cap`.
- A run whose usage is `not captured` is never PASS, since nothing held it to a cap.

`all` also prints one `{"summary": true, "verdict": "...", "runs": <n>, "elapsedMs": <n>}`.

`evidence`, per scenario:

- `held-stop`: `{ "answer": "<text the Stop hold returned>", "token": "<a nonce inside the answer>" }`
- `idle-wake`: `{ "token": "<the nonce the waiter delivered>" }`
- `read-only-job`: `{ "probe": "<absolute path inside workdir that the job was told to write>" }`

### The budgets lane

The issue says the budgets run as a lane of the local preflight whenever a change touches the harness, its hook or its launch facts. The base preflight runs the measured check lanes (`scripts/checks.mjs`), then `scripts/perf.mjs`. The harness lane can't be one of the measured checks: a whole harness of up to 10 minutes would break the checks' 5-minute budget, and its CPU would count against the merge base in perf. So my choice is:

- `scripts/preflight` runs `node scripts/agent-harness.mjs budgets` once per preflight, after the checks and apart from their time budget, as perf runs. It shows the lane's output, and a non-zero exit fails the preflight. The preflight never passes `--claude`, `--codex`, `--budgets` or `--changed`.
- The `budgets` command decides for itself whether the change touches the harness. By default the change is everything between the merge base (`git merge-base HEAD origin/main`, or `--base`) and the working tree, untracked files included. `--changed <path>` (repeatable, repo-relative) replaces that list, so a test can name a change without making one.
- A changed file touches the harness when it's the harness (`scripts/agent-harness.mjs` or a file it's built from), its hook (a repo file that a session's `--settings` hook or status line command runs) or a facts file the launch comes from. An untouched change starts no agent at all, not even `--version`.
- The limits live in `benchmarks/budgets.json` under a new top-level key, outside `tasks`, because perf measures every task 20 times on each side:
  `"harness": { "limits": { "sessionMs": 60000, "wholeMs": 600000 }, "margin": <n>, "initialReason": "<Issue #48 first measurement: ... the merge base has no harness ...>" }`.
  `--budgets <file>` reads another file of the same shape, so a test can scale the limits. The preflight never passes it.
- On a touched change it runs `all`, printing each run line, and measures each session's `elapsedMs` and the whole harness's wall time. It does the same for the merge base's harness when the base has one, with the same binaries, and compares the two. When the base has none, this is the first measurement, as #12's budgets were: `base` is `null` and the line carries the budget's `initialReason`.
- A budget counts only on the reference Mac, on mains power with Low Power Mode off and a nominal thermal state (design: Numbers version 0 has to hold). Anywhere else the result is a reading, and the status is INCONCLUSIVE.

It prints one line:

```json
{
  "lane": "harness budgets",
  "status": "PASS | INITIAL | FAIL | INCONCLUSIVE | BLOCKED | UNTOUCHED",
  "reason": "<why, for anything but PASS>",
  "baseCommit": "<40-hex merge base>",
  "touched": ["<repo-relative path>"],
  "budgets": "<path of the budgets file read>",
  "limits": { "sessionMs": 60000, "wholeMs": 600000 },
  "machine": { "model": "Mac15,7", "reference": true, "why": "<when reference is false>" },
  "current": { "wholeMs": 41234, "sessions": [{ "scenario": "held-stop", "agent": "claude", "elapsedMs": 9876 }] },
  "base": null,
  "initialReason": "<the budget's initialReason, when base is null>",
  "over": [{ "budget": "session", "scenario": "idle-wake", "agent": "claude", "elapsedMs": 61000, "limitMs": 60000 }, { "budget": "whole", "elapsedMs": 612000, "limitMs": 600000 }]
}
```

`UNTOUCHED` means the change doesn't touch the harness and nothing ran. `INITIAL` means everything was under its limit on the reference Mac and the merge base has no harness to compare with. `PASS` means everything was under its limit on the reference Mac and nothing regressed past the margin over the merge base. `FAIL` means a reading broke a limit or regressed on the reference Mac. `INCONCLUSIVE` means it ran off the reference Mac, with `over` still listing what broke a limit. `BLOCKED` means the lane couldn't measure, for example when a run failed for a reason other than its time. The exit code is 0 for `PASS`, `INITIAL` and `UNTOUCHED`, and non-zero otherwise, so an unrun or unmeasured lane never passes the preflight.

## How to run

- Fast tests start no real session and spend nothing: `node --test tests/acceptance/48/harness.test.mjs`. Each run against the fake takes seconds; the lane tests run the whole harness several times.
- Live tests start real sessions on your own sign-in and spend plan usage, so run them only by hand: `DEEP_HARNESS_LIVE=1 node --test --test-concurrency=1 tests/acceptance/48/harness.live.test.mjs`. Without that variable, each live test fails with `BLOCKED` in its message. It also fails BLOCKED when `claude` or `codex` is missing, when `claude auth status` or `codex login status` exits non-zero, when Codex isn't signed in on a ChatGPT plan, and, for the budgets test, off the reference Mac or off mains power. None of them skips.
- Don't pass the folder (`node --test tests/acceptance/48/`). Node's default pattern also matches `*.live.test.mjs`. The opt-in variable keeps that from spending anything, but those tests then fail as BLOCKED.

## The fake agent

`fixtures/fake-agent.mjs` stands in for both `claude` and `codex` in the fast tests. The tests copy it into a temporary `bin/` as both names, with a `fake.json` beside it, and pass it with `--claude` and `--codex`. It writes everything it did to `calls.jsonl` in its own folder: argv, whether stdin and stdout are TTYs, the prompt bytes on stdin, whether `CLAUDECODE` was set, the account homes it saw, its PIDs, every hook process it started, every write it tried, and its cumulative spend. It speaks only what the real CLIs give a harness:

- `--version`, `claude auth status` and `codex login status`.
- Claude Code interactively, only in a terminal (without one it exits 1, as Ink does). It reads `--settings` as a file or JSON, runs SessionStart, UserPromptSubmit, Stop and SessionEnd command hooks, and runs `async` and `asyncRewake` hooks in the background. A Stop hook that returns `decision: block` or exits 2 continues the session with the reason, up to eight times in a row. An `asyncRewake` hook that exits 2 wakes it with its stderr. Each reply quotes what started it. It runs the status line command with `cost.total_cost_usd` after every message, and exits on `/exit`, double Ctrl-C or Ctrl-D.
- Claude Code print mode (`-p`, `--output-format text|json|stream-json`), and `codex exec` (`-s`, `--full-auto`, `--dangerously-bypass-approvals-and-sandbox`, `-C`, `--json`, `-o`), each with the prompt on stdin. Asked to write an absolute path inside its folder, it tries, and the write succeeds only under a launch that allows it.
- Transcripts where the real tools put them, under `$CLAUDE_CONFIG_DIR/projects/<folder>/` and `$CODEX_HOME/sessions/YYYY/MM/DD/`. With either variable unset it writes into its own folder, never your real home.
- Usage: each Claude reply is one Haiku 4.5 message of 10,000 input and 4,000 output tokens, which is $0.03, written as two transcript entries that each repeat the usage. Each Codex reply logs a `token_count` of 10,000 input (2,000 of them cached) and 4,000 output tokens on `gpt-5.1-codex-mini`, with plan rate limits and no price.

`fake.json` sets `obey` (false: it runs the hooks but never continues on a block or a wake, and never tries a write, so a scenario can't pass against it), `ticks: null` (spend a message every 200 ms until stopped), `usage: false` (report no usage and no cost anywhere) and `linger` (leave a child in its own process group and a detached grandchild in a new session, both ignoring SIGTERM, SIGHUP and SIGINT). It reports a version taken from an `adapter.facts@1` file in the repo when there is one, so a harness that checks covered versions accepts it.

Every fast test runs the harness in an environment where it can't reach a real agent. `HOME`, `CLAUDE_CONFIG_DIR` and `CODEX_HOME` point into a scratch folder, `SHELL` is `/bin/sh`, API keys are removed, and the first `claude` and `codex` on `PATH` are tripwires that exit 97. A test fails if a tripwire ran.

## Criteria, tests and wrong programs

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, with whitespace collapsed and the leading `- [ ] ` dropped. They were computed with this command, with the issue's five criterion lines on stdin. The five remaining criteria kept their wording, so their IDs are unchanged from the first draft.

```
node -e 'for (const t of require("fs").readFileSync(0,"utf8").split("\n").filter(Boolean)) console.log(require("crypto").createHash("sha256").update(t.trim().replace(/\s+/g," ").replace(/^- \[ \] /,"")).digest("hex").slice(0,8))'
```

| ID | Criterion | Tests | Wrong program it must fail on |
|---|---|---|---|
| `#48.d82aa825` | Reproduces the October 4 results on demand: a held stop continues with an answer, and an idle session wakes | fast: `held-stop` and `idle-wake` run in a pseudo-terminal with `--settings`, never `-p`, keep the session's own transcript, and aren't PASS against a fake that never continues. Against a fake that does, `held-stop` passes with the hold's answer arriving after the first reply and the next reply carrying it, and `idle-wake` passes with an `asyncRewake` waiter after at least 1 s idle. live: the same two on real Claude Code | A harness that runs `claude -p`, or pipes stdin and stdout with no pseudo-terminal (the fake exits without a terminal). One that prints PASS without the session continuing. One that can never pass. One whose token is in the first prompt instead of arriving with the hold or the waiter |
| `#48.a0c92350` | Every run prints its cost, and a run over its cost cap stops | fast: every run line passes the cost-shape check above. Priced: $0.03 every 200 ms against a $0.05 cap stops with `stop: cost_cap` well before the 30 s deadline, and the agent is gone; an under-cap run that times out prints the fake's own total, with each message's tokens counted once; a missing binary prints BLOCKED with cost and tokens `not captured`; a session that reports no usage prints `not captured` and isn't PASS. Unpriced: a Codex job prints `basis: unpriced`, no `usd`, a `cap.tokens`, and tokens equal to the fake's with cached input taken out of input; 14,000 tokens every 200 ms against a 30,000 token cap stops with `stop: token_cap`. live: a real Claude session with a $0.0001 cap stops at it; a real Codex job with a 1-token cap stops at it; each live run's cost is within its cap | A harness that never compares cost or tokens with the cap, so the run reaches its deadline. One that prints `usd: 0` or zero tokens for a Codex run, or for usage it never read. One that has no token cap, or holds Codex to a dollar cap. One that sums usage per transcript entry (double count) or leaves cached input inside input. One that prints no cost on timeout, BLOCKED or interrupt. One that reports a capped run as PASS |
| `#48.e5ba087b` | No process outlives the harness | fast: after a run ends, and after SIGTERM to the harness mid-run, the fake's child, its detached grandchild (both ignoring SIGTERM, SIGHUP and SIGINT) and every hook process it started are gone, while a decoy with the same command line and no run token survives. Every capped run and every lane run also leaves nothing the fake started. live: every PID in `processes.started` is gone after each run | A harness that kills only its direct child, that kills only the process group (the setsid grandchild survives), that sends only SIGTERM, that leaves a background waiter running, that does no cleanup on SIGTERM, or that kills by command name (the decoy dies) |
| `#48.25de0c6b` | The harness runs a Claude Code job with the read-only launch from its facts, and a write attempt fails; the Codex job joins with the Codex adapter's launch | fast, for both agents: the agent's argv equals `launch.argv`, from the binary given. Each flag appears in the named `adapter.facts@1` file inside the repo. There's no bypass flag; Claude has `--strict-mcp-config` and `--setting-sources user`, Codex has `-s read-only`. The prompt arrives on stdin, and `CLAUDECODE` is dropped. The job tried to write `evidence.probe`, was refused, the file doesn't exist, and the run is PASS. live, for both: the job tried to write the probe (named in its transcript) and the file doesn't exist | A harness with a hard-coded launch and no facts file. One whose reported launch differs from what ran. One that adds `--dangerously-skip-permissions`, `--permission-mode acceptEdits`, `--full-auto` or `-s workspace-write` (the fake then writes the probe). One that passes the prompt in argv or inherits `CLAUDECODE`. One that passes without the write being tried |
| `#48.0f909fd3` | Budgets, on the reference Mac in the local preflight, compared with the merge base: a scripted session runs in under 60 s, and the whole harness in under 10 minutes | fast: a copy of the real preflight with stub workloads runs `agent-harness.mjs budgets` once, with none of the tests' options, apart from the checks' time budget, and fails when the lane fails. Against `--base 1de288c`, which has no harness, the lane reads the repo's 60 s and 10-minute limits, measures the four sessions under them, reports `INITIAL` with `base: null` and the budget's `initialReason`, and exits 0 (INCONCLUSIVE off the reference Mac, non-zero). With limits scaled through `--budgets`, a session limit of 1 ms puts every session in `over` and only those, and a whole limit of 1 ms puts only the whole harness there; each is FAIL on the reference Mac and INCONCLUSIVE elsewhere, never exit 0. A change of only docs is `UNTOUCHED`, exits 0 and never calls the agent binaries. A change naming the harness, its launch facts files and the hook files its settings run, beside two decoys, is touched in exactly those files, runs, and compares with `git merge-base HEAD origin/main`. live, on the reference Mac only: the lane with real agents and the repo's budgets is PASS (or INITIAL when the merge base has no harness), every session under 60 s, the whole harness under 10 minutes | A preflight that never runs the lane, runs it inside the measured checks (the 2 s check budget fails), ignores its exit code, or runs it with test options. A lane that never compares a session or the whole harness with its limit, compares with hard-coded limits, reads them from anywhere but the budgets file, says PASS on a first measurement or off the reference Mac, calls the reference Mac by its name alone, runs agents on an untouched change, or misses a changed hook or facts file |

## What depends on parts the base commit lacks

The base commit has none of the harness, the harness lane, a harness budget, `adapter.facts@1` files or the Codex adapter. At the base, every fast test fails (checked on an export of `1de288c`: 20 of 20 fail, each because `scripts/agent-harness.mjs` doesn't exist or the preflight shows no lane). Every live test fails as BLOCKED until it's opted into (7 of 7).

None of them passes on a missing part:

- `#48.25de0c6b` needs Claude Code's and Codex's `adapter.facts@1` files and the Codex adapter's launch. The run must name a facts file in the repo that holds `adapter.facts@1` and every launch flag. A missing or unnamed file fails the test with `BLOCKED` in its message.
- `#48.0f909fd3`: the fast tests prove the lane's wiring, its comparisons and its first measurement on any Mac, and its PASS-side status only on the reference Mac. The live test proves the numbers with real agents, only on the reference Mac. It spends plan usage, so the preflight's trace lane will see no run of it in the preflight. Until the maintainer runs the live file by hand and keeps its output as evidence, the criterion stays open, and the PR says `Part of #48`.
- The fast tests can only check the regression comparison when the merge base has no harness. The comparison with a base that has one, and the margin it uses, are tested only by the live test after #48 lands on main.

## Assumptions a redraft may revisit

- I picked the command names, options, `stop` values, cost and token fields, evidence fields, the lane's name, line, statuses and exit codes, the `harness` key in `benchmarks/budgets.json`, `--budgets` and `--changed` myself (see above).
- `--budgets` and `--changed` exist only so a fast test can scale the limits and name a change without spending. The preflight test checks that the preflight never passes them.
- The `budgets` command, not `preflight.mjs`, decides whether a change touches the harness. The preflight test runs a copy of `scripts/` with no git history, so a preflight that decided that itself would fail it.
- The harness's hook is a file in the repo that a hook or status line command in a session's `--settings` names. If the hook were only the deep-hook binary under `target/`, the touched-change test would fail.
- A change to a launch facts file counts as touching the launch facts, whichever field changed, because a path-level change list can't tell which.
- The token cap counts input, cached and output tokens together.
- The read-only job's prompt names the probe by its absolute path, which is how the fake finds what it's asked to write.
- The harness passes `CLAUDE_CONFIG_DIR` and `CODEX_HOME` through to the agent when they're set. The design's accounts are those homes, started with that one variable set. The fake writes its transcripts there, so a harness that drops them finds no transcript and no usage.
- The fake reports cost the way Claude Code does, through status line `cost.total_cost_usd` and transcript usage on Haiku 4.5. A harness that only types `/cost` and reads the screen would miss it. A harness may report that cost as `reported` or as `estimated` from a named rate card, since both give $0.03 a message.
- A reference Mac is recognized by its whole fingerprint, read from the machine, matching one of the design's two: `hw.model`, the chip (`machdep.cpu.brand_string`), CPU cores (`hw.physicalcpu`), memory (`hw.memsize`) and GPU cores (`system_profiler SPDisplaysDataType`), which are Mac15,7, Apple M3 Pro, 12, 36 GiB and 18, or Mac15,12, Apple M3, 8, 16 GiB and 10. A model name alone never counts, since each model also ships with other chip bins and memory sizes. The built-in display isn't read: it comes with the model, and a closed lid hides it. Mains power and Low Power Mode off come from `pmset`, and a value that can't be read counts as off-reference. The lane's `machine.model` must be the model this machine reports. The tests don't read the thermal state, which can change during a run, so on a reference Mac a lane may still call itself off-reference, but only by naming the thermal state, and it is then INCONCLUSIVE.
- Process checks read `ps` and count a PID as alive only while its command still names the test's temporary folder (or, for a hook, the longest word of its command), so a reused PID isn't counted. On this Mac, `ps` doesn't show other processes' environments. A harness therefore has to track an agent's descendants itself, not read the run token back from `ps`.
