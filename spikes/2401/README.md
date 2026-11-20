# Spike #2401: a headless job's cost to a plan window, under Claude Code's default label and under DeepBuild's name

Design: [Plan usage, per account and per task](../../docs/technical-design.md#plan-usage-per-account-and-per-task),
[What each agent gives us, and the limits we design around](../../docs/technical-design.md#what-each-agent-gives-us-and-the-limits-we-design-around),
[Decided](../../docs/technical-design.md#decided).

**Status: BLOCKED.** The 40 runs haven't run, so there is no `record.json`, no reading and no row under Decided.
Nothing is set meanwhile, as the issue decided. The one probe run, below, carried no 5-hour reading, and the account
is at 95% of its weekly window. The runs are held until you decide how to take them.

## The job and the script

```sh
node spikes/2401/record.mjs --claude <path> --dry      # $0: a throwaway home and an invalid token; tool lists only
node spikes/2401/record.mjs --claude <path> --probe    # one real run: what its stream carries
node spikes/2401/record.mjs --claude <path> --own-use <pct/Mtok> --basis "<words>" [--streams <dir>]
```

The last form spends plan usage. It makes one opening run (`lead`, under neither label), then 40 runs alternating
between the labels. It writes `record.json` in the shape `tests/acceptance/2401/README.md` gives. Raw streams go to
`--streams`, which must be outside the checkout, and the record pins each one by SHA-256.

- **The job** is the review check's. Its prompt is the one `packages/hub/src/kinds.ts` builds, over that file's
  default rubric and the fixed diff in [`job/diff.patch`](job/diff.patch).
- **The launch** is the runner's. It uses the facts' `launch.readOnlyJob` args, then the `--mcp-config` and
  `--tools Read,Grep,Glob` that `AGENTS['claude-code'].confine` adds for a job with no MCP server and no sub-agent. The
  prompt goes on stdin, the working folder is an empty temp folder, and a run still going after 5 minutes is stopped.
- **The environment** is the runner's `ALLOWED_ENV` and `CLAUDE_CONFIG_DIR`, plus the `TMPDIR`, `CLAUDE_CODE_TMPDIR`
  and `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` its `reach` sets. Under the default label `CLAUDE_CODE_ENTRYPOINT` is
  unset; under the other it is `deepbuild`. `CLAUDECODE` and the caller's own entrypoint are never passed on.

  It differs from the runner's job in four ways:
  - Claude Code reads its own keychain login, for which it needs `USER`. The runner hands it the access token in
    `CLAUDE_CODE_OAUTH_TOKEN` instead.
  - `PATH` is the system's, not your login `PATH`.
  - There is no HTTPS forwarder.
  - There is no supervisor sandbox.
- **The window** is read the way the runner reads an eval job's stream (`evaluationProcess` in
  `packages/runner/src/runner.ts`): from `rate_limit_event` entries whose `rateLimitType` is `five_hour` or `seven_day`,
  at `utilization × 100`. The runner's path for a review job reads no window from its stream at all; Claude Code's
  windows reach the hub from the status line.

  A run's `after` is its own last reading of a window, and its `before` is the previous run's last reading of it.
  Whether a reading already counts the request it came with is assumed, not shown.
- **The first entry** is the stream's `system` `init` entry. Your user settings' SessionStart hooks, which
  `--setting-sources user` keeps, write `hook_started` and `hook_response` entries before it.
- **A key** counts as set when one of the facts' billing variables is in the run's environment, or when the init entry's
  `apiKeySource` isn't `none`.

## What the probe found

[`probe.json`](probe.json) records one run under the default label:

- Claude Code 2.1.308, the newest version the facts cover.
- Nov 20 2026 at 05:32 UTC, on Mac15,12 at load 14.9.
- The diff's hunk header was corrected afterwards, so later runs' prompt differs from the probe's by that one line.
- The run predates `--probe` writing `ran_at`, `host_model` and `load_1m`. Those three fields come from the shell
  that ran it.

What the run carried:

- **Tokens:** 9,831 in all: 2 input, 1,407 output, 5,421 cache creation and 3,001 cache read. At API prices that is
  $0.0018. The run took 5.8 s and one turn on `claude-haiku-5-5`.
- **The window:** one `rate_limit_event`, for `seven_day` only.
  - It read status `allowed_warning`, utilization 0.95 and `surpassedThreshold` 0.75.
  - It resets Tue Nov 24 08:00 UTC.
  - Its `unifiedWindows` also held only `seven_day`.
  - The run carried no `five_hour` reading.
- **The tools:** Glob, Grep and Read, the three names `--tools` gives.

### What this means for the 40 runs

The rule takes each run's change in window percent per million tokens, and it needs 15 kept runs per label. A run
missing a 5-hour reading on either side is left out. This is what one run shows, and what it leaves open:

1. **No 5-hour reading in the one run.** If every run carried only the weekly reading, every run would be left out,
   and the reading would be INCONCLUSIVE. The probe can't say whether the 5-hour reading is missing because the weekly
   window is in its warning band. That is a guess, and so is the idea that it comes back once the weekly window resets.
2. **The step size is unknown.** One reading, 0.95, can't show how finely utilization moves. Say it moves in whole
   percents. A run of about 10,000 tokens would then read 0 or 1 point, the per-run ranges would overlap under both
   labels, and the rule would give "not set" without measuring a rate. Two or three probes in a row would show the
   step.
3. **The account is at 95% of its weekly window.** Forty runs and a lead come to about 400,000 tokens, spent from the
   last 5% of the weekly window, which your own work needs until Nov 24.

### What you can choose

- **Probe again first.** Run two or three probes back to back to see the step and which windows a run carries. After
  the weekly reset, also see whether the 5-hour reading comes back. Then run the 40 as the issue gives them, if the
  probes say a run can be read.
- **Blocks instead of single runs.** Alternate blocks of runs per label, each block large enough to move the 5-hour
  window by about 10 points. Three blocks per label is about 60 points of one 5-hour window. This changes the issue's
  Scope ("run 20 times under each of two labels"), so it needs your approval as an amendment.
- **Leave it to #1796.** #1796 reads routes from history as history builds up, at no extra spend.

## What the label changes besides the rate

[`dry.json`](dry.json) holds this, measured at $0 on 2.1.308 with `--dry`. That run used a throwaway home with no user
settings or plugins, and an invalid token that fails every turn before a model call, after the init entry.

| | Default (`CLAUDE_CODE_ENTRYPOINT` unset) | `CLAUDE_CODE_ENTRYPOINT=deepbuild` |
|---|---|---|
| Tools | Glob, Grep, Read | Glob, Grep, Read |
| Agents | claude, Explore, general-purpose, Plan, statusline-setup | the same and `claude-code-guide` |

The tool lists are the same. The `deepbuild` label adds the built-in `claude-code-guide` agent. A job can't reach it,
because `--tools` doesn't offer Task. Under your own home, the probe's agents also list your plugins' agents. The real
runs read the tool lists again from every run's init entry.

## Checks

`node --test --test-concurrency=1 'tests/acceptance/2401/*.test.mjs'` stays BLOCKED until the record exists.
