# Spike #2401: a headless job's cost to a plan window, under Claude Code's default label and under DeepBuild's name

Design: [Plan usage, per account and per task](../../docs/technical-design.md#plan-usage-per-account-and-per-task),
[What each agent gives us, and the limits we design around](../../docs/technical-design.md#what-each-agent-gives-us-and-the-limits-we-design-around),
[Decided](../../docs/technical-design.md#decided).

**Status: BLOCKED.** The 40 runs have not run, so there is no `record.json`, no reading and no row under Decided. One
probe run, below, showed that the runs as the issue specifies them can't give a reading on this account: the stream
reports one window per run, in whole percents, and a run is about ten thousand tokens. The issue needs an amendment
you approve before the runs are worth their plan usage. Nothing is set meanwhile, as the issue decided.

## The job and the script

```sh
node spikes/2401/record.mjs --claude <path> --dry      # $0: a throwaway home and an invalid token; tool lists only
node spikes/2401/record.mjs --claude <path> --probe    # one real run: what its stream carries
node spikes/2401/record.mjs --claude <path> --own-use <pct/Mtok> --basis "<words>" [--streams <dir>]
```

The last form spends plan usage. It runs one opening run (`lead`, counted under neither label), then 40 runs
alternating between the two labels, and writes `record.json` in the shape `tests/acceptance/2401/README.md` gives. Raw
streams stay in `--streams`, outside the repo; the record pins each by SHA-256.

- **The job** is the review check's: the prompt `packages/hub/src/kinds.ts` builds, over its default rubric and the
  fixed diff in [`job/diff.patch`](job/diff.patch).
- **The launch** is the runner's. It uses the facts' `launch.readOnlyJob` args, then the `--mcp-config` and `--tools Read,Grep,Glob` that
  `AGENTS['claude-code'].confine` adds for a job with no MCP server and no sub-agent. The prompt goes on stdin, and the
  working folder is an empty temp folder.
- **The environment** is the runner's `ALLOWED_ENV` plus the `TMPDIR`, `CLAUDE_CODE_TMPDIR` and
  `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` its `reach` sets. Under the default label `CLAUDE_CODE_ENTRYPOINT` is unset;
  under the other it is `deepbuild`. `CLAUDECODE` and the caller's own entrypoint are never passed on. Two differences
  from the runner: Claude Code reads its own keychain login (it needs `USER` for that) where the runner hands it the
  access token in `CLAUDE_CODE_OAUTH_TOKEN`, and there is no HTTPS forwarder.
- **The window** is read as the runner reads it (`packages/runner/src/runner.ts`): `rate_limit_event` entries whose
  `rateLimitType` is `five_hour` or `seven_day`, at `utilization × 100`. A run's `after` is its own last reading of a
  window and its `before` the previous run's. That a reading already counts the request it came with is an
  assumption: the probe saw one reading a run, which can't show it.
- **The first entry** is the stream's `system` `init` entry. Your user settings' SessionStart hooks, which
  `--setting-sources user` keeps, write `hook_started` and `hook_response` entries before it.

## What the probe found

One run under the default label on Claude Code 2.1.308 (the facts' newest covered version), on Nov 20 2026 at
05:32 UTC, on Mac15,12 at load 14.9 with other sessions on the account: [`probe.json`](probe.json).

- **Tokens:** 2 input, 1,407 output, 5,421 cache creation and 3,001 cache read, 9,831 in all, and $0.0018 at API
  prices. The answer took 5.8 s and one turn on `claude-haiku-5-5`.
- **The window:** the stream held one `rate_limit_event`, for `seven_day` only. It read status `allowed_warning`,
  utilization 0.95 and `surpassedThreshold` 0.75, resetting Tue Nov 24 08:00 UTC. Its `unifiedWindows` held only
  `seven_day` too. There was no `five_hour` reading at all, so the runner reads no 5-hour window from this account's
  jobs today.
- **The tools:** Glob, Grep and Read, the three `--tools` names.

### Why the 40 runs would read INCONCLUSIVE

The rule takes each run's change in window percent per million tokens and needs 15 kept runs per label. Three things
make that unreadable here:

1. **No 5-hour reading.** While the weekly window is in its warning band, the one reading a run gets is the weekly
   one. Every run would be left out ("its 5-hour window was not read on both sides"), and with none kept the reading is
   INCONCLUSIVE.
2. **Whole percents.** The probe's utilization was 0.95, two decimals. The probe moved neither window by a readable
   step, so a run of about 10,000 tokens reads a change of 0 or 1 point. Per-run rates would be 0 or about 100 points
   per million tokens. Their ranges would overlap under both labels whatever the true rates are, and the rule gives
   "not set" without having measured anything.
3. **The account is at 95% of its weekly window.** Forty more runs spend part of the last 5% your own work needs
   until Nov 24.

Running them now would spend about 400,000 tokens to record a reading the rule already gives. So they have not run, and 0 runs
were left out because none ran.

### What an amendment could take, for you to choose

- **Blocks instead of single runs.** Alternate blocks of runs per label, each block large enough to move the 5-hour
  window by about 10 points, so a whole-percent step is a tenth of the change. Three blocks per label is about 60
  points of one 5-hour window. It would need a week whose weekly window is out of its warning band, so the stream reports
  the 5-hour window. One block's size comes from a first block's reading.
- **Leave it to #1796.** #1796 reads routes from history as history builds up, at no extra spend. This spike's script
  and tool lists stay for when a reading is taken.

Either changes the issue's Scope ("run 20 times under each of two labels", per-run readings), which only you can
approve.

## What the label changes besides the rate

Measured at $0 with `--dry` on 2.1.308 ([`dry.json`](dry.json)), using the throwaway home and an invalid token. Every turn fails
before a model call, after the init entry. The same launch by hand on 2.1.326 gave the same lists.

| | Default (`CLAUDE_CODE_ENTRYPOINT` unset) | `CLAUDE_CODE_ENTRYPOINT=deepbuild` |
|---|---|---|
| Tools | Glob, Grep, Read | Glob, Grep, Read |
| Agents | claude, Explore, general-purpose, Plan, statusline-setup | the same and `claude-code-guide` |

The tool lists are the same. The `deepbuild` label adds the built-in `claude-code-guide` agent. A job can't reach it,
since `--tools` doesn't offer Task. The real runs read the tool lists again from every run's init entry.

## Checks

`node --test --test-concurrency=1 'tests/acceptance/2401/*.test.mjs'` stays BLOCKED until the record exists. The
script was run end to end against a stand-in binary that writes the stream shapes above with a counter for a window.
Its record passed the suite's record, reading and tool tests, and was not kept.
