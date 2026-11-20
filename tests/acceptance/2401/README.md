# Acceptance tests for #2401: what a headless Claude Code job costs a plan window under its default label and under DeepBuild's own name

Written first by a job that never saw an implementation. It worked from issue #2401 (its Scope, five acceptance criteria and Proof line: "The 40 runs' records, the reading, the two tool lists and the row under Decided"), the design sections the issue links, and the base commit `b4a2049e8`. No other branch or worktree was read, and nothing under `spikes/2401/` or `docs/spikes/2401/` was read. Per AGENTS.md (Proof), the implementing agent doesn't edit these files. A dispute goes to a blind redraft of this job (design: Dogfooding).

The issue is a research spike, so these tests check no product code. They hold the four criteria to what the spike leaves behind: its record, its write-up, its row under Decided, and the owner's taste call. The runs spend plan usage, and the issue says they run once, by hand. So nothing here runs Claude Code. The record is the evidence. The tests never take the record's word for anything they can recompute (invariant 1): which runs are kept, the left-out count, both readings, their ratio, the decision the rule gives, and both tool lists.

## What was read

- The issue, live with `gh issue view 2401 --repo windoliver/deepbuild` (no comments).
- `docs/technical-design.md`: Plan usage, per account and per task; What each agent gives us, and the limits we design around; Decisions and Decided; Dogfooding. AGENTS.md.
- At the base, for names and patterns only:
  - `adapters/claude-code.facts.json`: `launch.readOnlyJob.args`, the job's command line (`-p --output-format stream-json --verbose --model haiku …`), and `usage.tokens`, the token kinds.
  - `packages/runner/src/runner.ts` and `agents.ts`: how the runner reads a window today. It takes a stream entry's `rate_limit_info` (`rateLimitType` `five_hour` or `seven_day`, `utilization` × 100, `resetsAt`) or `rate_limits.{five_hour,seven_day}.used_percentage`. It also reads the account ID from `oauthAccount.accountUuid`, which must never reach the record.
  - `tests/acceptance/2435/` and `spikes/2435/record.mjs`: the layout of a spike suite and its record.
  - `tests/acceptance/573/`: a spike recorded with hashes in place of private data.
  - `tests/acceptance/502/taste.test.ts` and `tests/acceptance/1550/` (README "The taste call", `TASTE.json`): how a taste call is recorded.
  - #1115's rule (`tests/acceptance/1115/`): a failure message starting `BLOCKED`, `INVALID` or `INCONCLUSIVE` is that state, never PASS.
  - `scripts/closed-sweep.mjs`: `criterionId`, for the criterion tags in test names.

## The surfaces (my choice: the issue names none)

```
spikes/2401/record.json    the committed record: 40 runs, the reading, the tool lists, the decision (shape below)
spikes/2401/record.mjs     the script that ran the 40 runs and wrote the record (the tests don't run or read it)
spikes/2401/README.md      the write-up: the human report the taste call is on; it states how many runs were left out
docs/technical-design.md   one row in the table under "### Decided" (the issue's own surface)
tests/acceptance/2401/TASTE.json   the owner's taste call, the one file added to this folder after this draft
```

Each run's raw stream stays outside the repo, as #573's private evidence does. The record pins it by `stream_sha256` and keeps two entries from it, trimmed as below.

### `spikes/2401/record.json`

```jsonc
{
  "issue": 2401,
  "host": { "model": "Mac15,12", "os": "macOS", "os_build": "27.2 (26B8119)" },  // a reference Mac (Mac15,7 | Mac15,12 | Mac17,10)
  "accounts": 1,                       // how many distinct accounts the runs ran under; never the account ID itself
  "claude_code_version": "2.1.308",    // every run's first entry names this version
  "job": {
    "args": ["-p", "--output-format", "stream-json", "--verbose", "--model", "haiku", "…"],
      // starts with adapters/claude-code.facts.json launch.readOnlyJob.args, in order (the --model value may differ);
      // any flags after them (the review check's --tools, --mcp-config…) are the job's own
    "prompt_sha256": "<64 hex>"        // the one fixed prompt, given on stdin
  },
  "own_use": {                         // fixed before the first run: what "the run's own use" is
    "max_pct_per_mtok": 10,            // the most window percent per million tokens a run's own tokens can move the 5-hour window
    "basis": "…",                      // why that ceiling, in words
    "fixed_at": "2026-11-20T08:00:00Z" // at or before runs[0].started_at
  },
  "runs": [                            // exactly 40, n = 1..40 in the order run, labels alternating, 20 each
    {
      "n": 1,
      "label": "default",              // "default" | "deepbuild"
      "entrypoint": null,              // CLAUDE_CODE_ENTRYPOINT as set for the run: null (unset) under default, "deepbuild" under deepbuild
      "account": 1,                    // the one account, by number
      "api_key_set": false,            // no API key variable (facts' billing.apiKeyVariables) was set: the run billed the plan
      "started_at": "2026-11-20T09:00:00Z", "ended_at": "2026-11-20T09:01:00Z",  // one run at a time
      "first_entry": {                 // the stream's first entry, system init; at least these keys, never cwd or session_id
        "type": "system", "subtype": "init", "model": "claude-haiku-…", "claude_code_version": "2.1.308",
        "tools": ["Read", "Grep", "Glob"]
      },
      "result_entry": {                // the stream's result entry; at least these keys, never session_id
        "type": "result", "subtype": "success", "is_error": false,
        "usage": { "input_tokens": 0, "output_tokens": 0, "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0 }
      },
      "stream_sha256": "<64 hex>",     // SHA-256 of the run's whole raw stream, kept outside the repo; distinct per run
      "tokens": { "input": 0, "output": 0, "cache_creation": 0, "cache_read": 0 },  // = result_entry.usage, by kind
      "window": {                      // as the runner reads it today; a reading is null when unknown, never 0
        "five_hour": { "before": { "used_percent": 41.0, "resets_at": 1795000000 }, "after": { "used_percent": 41.6, "resets_at": 1795000000 } },
        "seven_day": { "before": { "used_percent": 30.0, "resets_at": 1795500000 }, "after": null }
      },
      "kept": true,                    // see "Kept and left out"
      "left_out_because": null         // a string when kept is false
    }
  ],
  "left_out": 0,                       // the number of runs with kept false
  "reading": {
    "date": "2026-11-20",              // the reading's day
    "five_hour": {
      "status": "MEASURED",            // or "INCONCLUSIVE"
      "default":   { "runs": [1, 3], "pct_per_mtok": 3.6, "range": [3.5, 3.7] },  // the kept runs behind it, by n
      "deepbuild": { "runs": [2, 4], "pct_per_mtok": 2.0, "range": [1.9, 2.1] },
      "ratio": 1.8,                    // default ÷ deepbuild; null or absent when INCONCLUSIVE
      "ranges_apart": true             // null when INCONCLUSIVE
    },
    "seven_day": { "…": "the same shape" },
    "outcome": "offered and off"       // "not set" | "offered and off": the rule on the 5-hour reading
  },
  "tools": {
    "default":   ["Read", "Grep", "Glob"],   // the tool list under each label, from the runs' first entries
    "deepbuild": ["Read", "Grep", "Glob"],
    "differences": []                        // or [{ "tool": "TodoWrite", "under": "deepbuild", "flag": "--disallowedTools TodoWrite" }]
  },
  "decision": "offered and off",       // the row's: "not set" | "offered and off" | "on by default"
  "maker_statement": null              // with "on by default": the URL of the maker's statement the row links
}
```

Other fields (method, samples, notes, load, more stream keys) are allowed and not read. Percents are 0 to 100 (the runner's `utilization` × 100). `resets_at` is in epoch seconds, or null.

### Kept and left out (AC1)

A run's tokens are all four kinds added together. Its 5-hour change is `after.used_percent − before.used_percent`. That change can be read only when both readings are known and name the same `resets_at`. A run is kept only when all of these hold:

- its result entry is `subtype: "success"` with `is_error: false`;
- its 5-hour change can be read and isn't negative;
- the change is no more than its own use, which is its tokens ÷ 1,000,000 × `own_use.max_pct_per_mtok`.

Otherwise it is left out. That covers a window that moved by more than the run's own use, and a window that reset, fell or wasn't read. The record says why in `left_out_because`, and `left_out` gives the count. The write-up gives the count in a sentence that contains the words "left out". When the count is 0, writing "none" or "no" counts.

### The reading (AC2)

The tests recompute both windows' readings from the kept runs. For a label:

- `runs` is its kept runs, in order.
- `pct_per_mtok` is the sum of their changes ÷ (the sum of their tokens ÷ 1,000,000).
- `range` is the lowest and the highest per-run change ÷ (tokens ÷ 1,000,000).

The weekly reading uses the 5-hour reading's kept runs whose weekly change can be read and isn't negative. When either label has fewer than 15 runs, or deepbuild's rate is 0, the status is `INCONCLUSIVE` and there's no ratio. Otherwise `ratio` is default ÷ deepbuild. `ranges_apart` is true when one label's lowest rate is above the other's highest. Recorded numbers must agree with the recomputed ones to a relative 1e-3.

The rule from the issue's Scope, written before the runs, is applied to the 5-hour reading:

- INCONCLUSIVE, a ratio under 1.25, or overlapping ranges gives `not set`.
- A ratio of 1.25 or more with the ranges apart gives `offered and off`.

A record whose reading is right but reads INCONCLUSIVE still fails AC2. Its message starts `INCONCLUSIVE`, because a reading that couldn't conclude measures nothing (invariant 2). The row then reads "not set", and the measurement runs again.

### The row under Decided (AC4)

The row is the one row in the table under `### Decided` whose text names `CLAUDE_CODE_ENTRYPOINT`, `#2401` or `issues/2401`. It must meet all of these:

- It has three non-empty cells.
- Its Decision cell (the second) starts with `Not set`, `Offered and off` or `On by default`, after any `**`.
- That word is the record's `decision`.
- It gives `reading.date`, written either as `2026-11-20` or as `November 20, 2026` (or `Nov 20 2026`, `20 November 2026`).
- It gives `claude_code_version` exactly.
- If the row says "on by default" anywhere, it also holds a Markdown link to a page on `anthropic.com`, `claude.com` or `claude.ai`, or one of their subdomains.
- `Not set` and `Offered and off` must be what the rule gives.
- `On by default` needs the rule to give `offered and off`, and the record's `maker_statement` must be one of the row's maker links.

## How to run

```sh
node --test --test-concurrency=1 'tests/acceptance/2401/*.test.mjs'
```

The suite needs Node 24, the repo's version, and nothing else: no network, no Claude Code, no plan usage. It runs in well under a second. Quote the glob, so that Node expands it rather than the shell.

## Criteria, tests and wrong programs

| Criterion | Test (file) | Wrong program it fails on (each checked in a scratch tree, below) |
|---|---|---|
| AC1 `#2401.ed54ac04`: the 40 runs on the record, each with label, tokens, window before and after, version | `ac1-runs.test.mjs`, first test | 39 runs. Runs 3 and 4 swapped, so not interleaved. A run whose entrypoint is another client's name (`cline`). A second model. Tokens that aren't the result entry's usage. A weekly reading of `0` in place of a reading or null |
| AC1: a run whose window moved by more than its own use is left out, and the write-up says how many | `ac1-runs.test.mjs`, second test | A run that nothing leaves out, marked left out. `left_out` 2 when the runs give 0. A write-up that doesn't give the count. `own_use.fixed_at` after the first run |
| AC1 (AGENTS.md: no personal data in evidence) | `ac1-runs.test.mjs`, third test | A UUID (the shape of an account or session ID) on the record |
| AC2 `#2401.fb765468`: rate per label with range, their ratio; under 15 kept on a side INCONCLUSIVE, no ratio | `ac2-reading.test.mjs` | A ratio 20% off. A range 50% off. No weekly reading. 14 kept default runs read MEASURED with a ratio. The outcome reading `not set` when the rule gives `offered and off`. A right INCONCLUSIVE reading (fails `INCONCLUSIVE: …`) |
| AC3 `#2401.96860f79`: the tool lists the same, or each difference listed by tool with the flag that removes it | `ac3-tools.test.mjs` | A tool offered only under deepbuild with no difference listed. A difference whose flag is `remove it` |
| AC4 `#2401.76fa3238`: a row under Decided with the reading's date and version, reading not set or offered and off; on by default only beside the maker's link | `ac4-decided.test.mjs` | No row. A version of `2.1.3`. The next day's date. `Not set` when the rule gives `offered and off`, both in the row and in the record. `On by default` with no maker link. The record's `decision` differing from the row |
| AC5 `#2401.4cfdbe12`: one taste call on the write-up, by you | `ac5-taste.test.mjs` | No `TASTE.json` (`INCONCLUSIVE`). A call on an older record (`INCONCLUSIVE`). `looks_wrong` (FAIL) |

A record from a Mac that isn't a reference Mac fails every test as `INVALID`. A missing record fails every test as `BLOCKED`. A missing write-up fails as `BLOCKED` in the tests that read it.

### How I checked the tests can fail and pass

At the base, all 7 fail, each on `BLOCKED: the record of the 40 runs is not at spikes/2401/record.json` (`BASE-FAILURE.txt`).

I made no live runs. To check the tests themselves, I built scratch trees outside this checkout. Each held only this folder, the base's adapter facts, and the base's design with a row added. A generator wrote a synthetic record to the shape above, a write-up and a `TASTE.json`. Its kept set and readings were computed separately from `helpers.mjs`.

On the shape as given, all 7 passed. They also passed on four correct variants:

- a ratio of 1.1, which reads `not set`;
- a run that someone else's use moved by 3 points, left out;
- a tool offered only under deepbuild and listed with `--disallowedTools`;
- `On by default` beside a docs.claude.com link.

Then 30 wrong programs each failed the test named beside them in the table. Five also failed other tests, for causes of their own:

- The non-reference Mac fails all 7 as `INVALID`.
- The `0` weekly reading fails all 5 tests that read runs.
- 39 runs also changes the kept runs behind the reading, so AC2 fails too.
- Swapping the labels of runs 3 and 4 also moves the kept runs and the outcome, so AC2 and AC4 fail as well as AC1.
- 14 kept default runs read MEASURED also leave the row's `Offered and off` against a rule that gives `not set`, so AC4 fails too.

None of the scratch trees is kept.

**Not run green:** no real record exists. Whether real streams from Claude Code 2.1.308 carry `tools`, `model` and `claude_code_version` in the init entry, and usage in the result entry, as the shape assumes is unproven until the spike runs.

## The taste call

The implementing agent shows the owner the write-up (`spikes/2401/README.md`), the record, and the row, in the session, with the SHA-256s that `ac5-taste.test.mjs` prints. The owner's answer goes in `tests/acceptance/2401/TASTE.json`, in #1550's form:

```json
{"issue": 2401, "criterion": "#2401.4cfdbe12", "verdict": "looks_right" | "looks_wrong", "who": string, "when": "ISO 8601 time",
 "files": {"spikes/2401/README.md": sha256, "spikes/2401/record.json": sha256}, "note"?: string}
```

The test reads the call as follows:

- No `TASTE.json`: INCONCLUSIVE.
- A call that names no one or no time: INCONCLUSIVE.
- A call whose `files` aren't exactly these two files' SHA-256s: INCONCLUSIVE.
- `looks_wrong`: fails.
- `looks_right` on exactly these files: passes.

This job wrote no `TASTE.json`.

## Not covered here

- The truth of the record's runs beyond its own consistency. Tokens, windows and tool lists are read from the record. The raw streams that `stream_sha256` pins aren't in the repo, so whether the runs happened as recorded is for review of that evidence.
- That nothing else used the account. The left-out rule catches a run whose window moved by more than its own use. It can't see a move smaller than that.
- Scope lines that aren't criteria:
  - the preference's card and its wording (#1998);
  - the doctor item;
  - the route reading as its own in #1796;
  - "no job ever carries another client's name", beyond the entrypoint check on each run.
- `spikes/2401/record.mjs`: not run, since it spends plan usage.

## Assumptions a redraft may revisit

- I picked the paths, every field name, and the status words `MEASURED` and `INCONCLUSIVE`.
- "The run's own use" is its tokens at a ceiling of window percent per million tokens, fixed and stated before the first run. The issue gives no way to know a run's own use apart from the rate being measured. A declared ceiling, applied the same way to every run, is the least circular rule I found.
- "Window percent per million tokens" counts all four token kinds. Both labels run the same job, so the mix is the same on both sides.
- A label's rate is pooled over its kept runs. Its range runs from the lowest per-run rate to the highest. The ratio is default ÷ deepbuild, so 1.8 means the default label moves the window 1.8 times as fast, as the issue reads it.
- "Interleaved" means strictly alternating, one run at a time.
- One model and one Claude Code version for all 40 runs.
- The rule decides on the 5-hour window. The weekly reading is recorded and checked, but it may read INCONCLUSIVE without failing.
- The row is found by the text it holds, and its Decision cell starts with the decision's words. "On by default" anywhere in the row needs a maker link. A link to the Claude Code issue thread doesn't count as the maker's statement.
- "The write-up" is `spikes/2401/README.md`, and the taste call is on it and the record.
- The run's Claude Code version needn't be one the adapter facts cover. The issue doesn't ask for that.
