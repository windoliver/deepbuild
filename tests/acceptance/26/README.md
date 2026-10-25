# Acceptance tests for #26: MCP server: ask, wait, open items, status and search

Written first, blind, from issue #26 (its text as of October 24, 2026: Scope, the 16 acceptance criteria, Proof, References, Depends on, "Added Oct 9" and "Done when"), `docs/technical-design.md` (One hub per user, a tiny hook client, and extensions in-process, with the deep mcp row; Privacy; Reading by reference; Extension API, with the MCP tools row; Building blocks; Socket roles and contract versions, with Contracts that can't drift; How runs become one of five verdicts, with Predictions first and Open items as records; the done.yaml example; Numbers version 0 has to hold; How we know version 0 works) and the base commit `6173ee0` (`origin/main`: the hub of #16 with its `deep mcp` serving `deep_status`, `deep_claim` and `deep_evidence`, the asks core of #318 and #320, the evidence store of #15, `deep inbox` of #24, error@2, the index@1 kit). The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft by this job.

## Run

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # the tests run the built CLI, packages/cli/dist/main.js: deep hub run, deep mcp, deep inbox
npx vitest run tests/acceptance/26       # from the checkout's root
npx tsc -p tests/acceptance/26           # type-check the tests
```

Node 24.22 or newer and `git` on the `PATH` (each test makes a throwaway repo of its own in a temp folder; no test runs git on this checkout except the perf lane's `git merge-base`/`git show`). No network. Each test makes its folders under `/tmp/dh26-*` (a socket path must fit in 104 bytes on macOS), runs every process with `HOME` there, so the hub's root is `<home>/.deepbuild`, and never touches your real `~/.deepbuild`. It stops only processes it started, by PID (`helpers.ts`, `cleanup`), never by name or port. The files start real hubs side by side; the budgets file times them, so the implementer adds `tests/acceptance/26/` to the unit lane's one-at-a-time list in `scripts/lanes.mjs`, as #16's and #24's suites are (not done here: this job writes tests only). The tests import only public entries (`@deepbuild/record`, `@deepbuild/asks`, `@deepbuild/contracts`, by their `src/index.ts`) to seed the record before a hub starts and to validate error@2; no hub, CLI or `deep mcp` module.

## The surface

The tests reach the code only through: **`deep mcp`** spoken to as an MCP client speaks it (newline-delimited JSON-RPC 2.0 on stdio: `initialize`, `notifications/initialized`, `tools/list`, `tools/call`, `resources/read`), started either by the agent stand-in as its child or by this test process ("by hand"); **`deep hub run`** and its socket as `tests/acceptance/16/README.md` defines it (`events.read` on a `cli` connection, the `mcp` hello, `mcp.call`); **`deep inbox answer`** (#24) with #24's confirmation stub; files under the hub's root; **`skills/deepbuild/SKILL.md`**; **`scripts/agent-eval.mjs`**; and **`benchmarks/budgets.json`**. Every name below that the issue or the design doesn't give is this job's invention, kept as small as the tests need, and says so.

### The agent stand-in and deep-hook

`fixtures/agent.mjs` is an agent's process: its hooks are its child processes sending one `hook.request@2` line each (deep-hook's wire, as #16 and #24 hold it), with `pid` and `ppid` their own, and its one `deep mcp` (`node packages/cli/dist/main.js mcp`) is its child too. A session is a Claude Code session (`agent: "claude-code"`, its transcript under `<home>/.claude/projects/`), established by its SessionStart, UserPromptSubmit and a PreToolUse. Before a `deep_*` call where the tests need per-call binding they send the PreToolUse Claude Code fires for it: `tool_name: "mcp__deep__<tool>"`, `tool_input` the call's arguments. The shared daemon of criterion 14 is one such process establishing two sessions in two worktrees.

### Tools

`tools/list` must hold at least these eight, each named in the design's MCP tools row: `deep_ask`, `deep_wait`, `deep_open_item`, `deep_status`, `deep_search`, `deep_claim`, `deep_evidence`, `deep_run`. A tool's **value** is its result's `structuredContent`, or else the JSON in its first text block; the tests read it that way. Only the fields below are relied on; everything else in a schema or a result is the implementer's. Because the strict rule (below) makes every property required, an optional one is nullable, and **a nullable field the tests leave out must read as null**.

| Tool | Arguments the tests send | What the tests read |
|---|---|---|
| `deep_ask` | a taste call: `kind: "taste"`, `question`, `options: [{id, label}]`, `recommended`; a task only a person can do: `kind: "unblock"`, `question`, `steps: [string]`, `where`, `why`, `check` (the check that will prove it, e.g. `"unit"`; *name invented here*) | It files `ask.created` under the bound session (`kind: "unblock"` with `data.proves` the check for a task) while it waits. It waits **at least 10 s** before answering still-waiting, and returns the answer as soon as one arrives: `{ask: "ask:<id>", status: "answered", answer: "<option id>"}`; still waiting: `status: "waiting"` (with the deadline and default, not read here). A task without a check (left out or `null`) is refused, its error's `path` ending in `check`, and nothing is filed. |
| `deep_wait` | `ask: "ask:<id>"` | Waits on the ask like `deep_ask`, at least 10 s. |
| `deep_open_item` | `text` | Not an error; `open_item.opened` with that text appears in the record. |
| `deep_status` | `{}` | `session`: the bound session's ID, or null. `contradictions`: a list, anywhere in the value, of `{check, run, predicted, outcome, late?}` (the verdict engine's `Contradiction`) for the bound session's claims. |
| `deep_search` | `query` | `hits: [{source, quote}]`, every hit with a non-empty `source`: `decision:<ID of its decision.created event>` for a past decision, found by its ask's question; `wiki:<page>#<claim>` for an index@1 hit; for the project's spec a source containing `.deepbuild/done.yaml`. |
| `deep_claim` | claim.made@1's data (`task_ref`, `attempt`, `commit`, `scope`) and `predictions: [{check, expects: "passed"\|"failed"}]` (the verdict engine's `Prediction`, without `at`, which the hub stamps) | `claim: "claim:<id>"` (or the base's `event`, read as `claim:<event>`); `claim.made` under the bound session. |
| `deep_evidence` | `path` | `{sha256}`; `evidence.stored` with `data.origin: "agent"`; the file at `evidence/<2 hex>/<62 hex>`. |
| `deep_run` | `check`, and `claim` (a handle from `deep_claim`) | `{run: "run:<id>"}`; `run.started` and `run.finished` for that run. A check the session's spec doesn't name is refused, `path` ending in `check`, `actual` the name sent. |

The checks are the session's worktree's `.deepbuild/done.yaml` (`checks:` as the design's example writes them; the tests' commands are `false`); the asks block there declares the deadlines and defaults the ask rules leave open.

**Errors.** Every tool error is a tool result with `isError: true` whose value validates against `error@2` (never a JSON-RPC error), with `actual` the refused value, scrubbed as evidence is and cut at 8,192 characters after the scrub. With the hub unreachable the code is `unavailable`. A tool called with a field its schema doesn't list (`deep26_unlisted`) is refused, bound or not.

**Descriptions** each say what the tool's result does not prove (matched by `does not prove`, `doesn't prove`, `do not prove`, `don't prove` or `never proves`).

### `deep://codes/<code>`

An MCP resource, read with `resources/read` by a `deep mcp` that has made no tool call. `contents[0]` has `uri` equal to the one asked and `text` a JSON object `{code, meaning, planted, clean, fix}`: `code` the code, `meaning` and `fix` non-empty strings, `planted` the entry that raises the code alone and `clean` its twin, any JSON, present and different from each other (the field names are invented here; the design names the four parts).

### The skill

The skill is `skills/deepbuild/SKILL.md` in the checkout (beside the design's `skills/deepbuild-canvas/SKILL.md`; *path chosen here*), generated with the tool descriptions from the Building blocks table. `tools.test.ts` reads the table from `docs/technical-design.md` as it stands and holds both to it with `drift()` (`helpers.ts`), text compared without backticks or bold, whitespace collapsed, case ignored:

- every listed tool is named in the "Agents, through MCP" cell of at least one row, and its description contains each such row's **Never** cell;
- the skill contains, for every row naming a listed tool, the row's **Block** and its **Never** cell; names every listed tool; names no `deep_*` tool the list lacks;
- the skill names no tool parameter: no property name of any tool's input schema in a code span, before `:` or `=`, or in double quotes, and none containing `_`, a digit or a capital at all.

The same test feeds `drift()` a table whose Never cells changed and a skill naming `deep_frobnicate`, and expects each reported, so the check can fail.

### Strict schemas ("Done when")

Every tool's `inputSchema` must sit in the intersection of the design's closed node list (Contracts that can't drift: an object with listed properties and no others, an array of one item schema, a string with optional pattern, enum or listed format, an integer or number, a boolean, a constant, null only beside one other type) and the strict tool-schema subsets of the model APIs Claude Code and Codex call (Anthropic's strict tool use, OpenAI's strict function calling). Concretely (`strictProblems()`): the root is `{"type": "object"}`; every object has `properties`, `additionalProperties: false`, and **every property in `required`** (OpenAI's rule; an optional field is `["<type>", "null"]`); arrays have one `items` schema and `minItems` only 0 or 1; strings may carry `enum`, `pattern` (no lookaround, backreference or `\b`) and `format` only from date-time, date, time, duration, email, hostname, ipv4, ipv6, uuid; `const` and `enum` as typed; the annotations `description` and `title`. Anything else fails, naming the tool and the JSON Pointer: `anyOf`, `oneOf`, `allOf`, `not`, `if`, `$ref`, `$defs`, `patternProperties`, a map (`additionalProperties` a schema), `minLength`/`maxLength`, `minimum`/`maximum`, `default`, `$schema`. Lengths and ranges are left to the hub, which refuses with error@2: Anthropic's strict mode refuses them, and the design's union by a constant field is a `oneOf` neither API takes in a tool. The design's own node list allows more; the stricter intersection is what keeps a client from dropping the tools.

### Allowlist and shell input

"Allowlisted" is read as: every listed tool is one the design's MCP tools row names (`designTools()`), none twice, and an unlisted name (`deep_shell`, `deep_answer`, `ask.answer`) is refused by `tools/call` and by the hub's `mcp.call`, doing nothing. "No free-form shell input": no input property named `command`, `cmd`, `shell`, `script`, `argv`, `args`, `exec`, `bash`, `sh`, `program` or `run`, and every tool called with a shell payload in every string field creates no marker file.

### Seams (test-only settings)

Read from the environment of `deep hub run`; only tests set them.

| Variable | What it does |
|---|---|
| `DEEP_HUB_TEST_CONFIRM=<file>` | #24's stub for the OS confirmation; always `confirmed` here, so `deep inbox answer` run by you counts. |
| `DEEP_HUB_TEST_INDEX=<absolute path of an ES module>` | *Invented here.* The module's default export, called with no arguments, returns the index@1 fill (`IndexFill` in `packages/conformance/src/slots/wiki-index.ts`: `slot`, `revision`, `rebuild`, `upsert`, `search`, `dropSource`) the hub uses as the wiki's index in place of its own, for `deep_search`. The test's fill holds fixed claims that survive the hub's rebuilds. |
| `DEEP_HUB_PLANT=<name>` | A planted wrong program, below. The tests set it in the environment of `deep hub run` **and** of every `deep mcp` they start (the agent stand-in's and by hand), so a plant may live on either side. |

### Wrong programs

The implementer adds these names to the plant list; an unknown name makes the hub refuse to start, so its test fails BLOCKED.

| Name | What the plant does | Criterion | How the test fails on it |
|---|---|---|---|
| `evidence-checks-path-first` | `deep_evidence` checks the path is inside the working folder before resolving links, then reads it | 10 | the link is stored; the message names `the link notes.txt` |
| `binds-first-stamp` | binds a call that several unspent stamps match to the first | 14 | the claim is filed under B; the message names both session IDs |
| `unbound-reads-all` | serves a call bound to no session `deep_search` over everything | 15 | the session's open item comes back; the message names it |
| `errors-without-actual` | tool errors leave out `actual` | 16 | error@2 validation fails; the message names `deep_run` |
| `errors-unscrubbed` | tool errors carry the refused value unscrubbed | 16 | the token is in the error; the message names `deep_run` |

### The manual evaluation's scorer

Real Claude Code and Codex sessions are run by hand on the maintainer's plan, never in CI. Each run is recorded as one JSON file and scored by

```sh
node scripts/agent-eval.mjs score <run.json>
```

which prints one JSON line `{"outcome": "PASS"|"FAIL", "reasons": [{"code", "detail"}]}` and exits 0 for PASS, 1 for FAIL, 3 when the file can't be scored (the design's exit-code table). *The command, the format and the codes are invented here.* A recorded run (`fixtures/eval/run.json`, whose `@SKILL` and `@TOOLS` the test fills with the skill file and the live `tools/list`):

```
v: 1, run, agent, repo
prompt                      the prompt the session was given
skill: {loaded, text}       whether the session loaded the skill, and the bytes it loaded (null if none)
tools: [tool]               the tools/list the session's deep mcp served
calls: [{tool, arguments, result}]   every deep_* call in order, result as MCP returned it
manifest: {first_tool, claims: [{id, expected}]}   the closed claim manifest
answer: {claims: [{id, value, evidence}]}          the session's claims, each citing a handle
```

The scorer passes a run only with `reasons` empty, and fails it with each of: `skill_not_loaded` (not loaded, or no text); `skill_tools_mismatch` (the skill names a `deep_*` tool not in `tools`, or a listed tool it doesn't name); `evidence_not_delivered` (a claim cites a handle no call result in this run holds); `claim_mismatch` (a value not the manifest's expected one); `claim_not_in_manifest`; `wrong_first_tool` (the first call isn't `manifest.first_tool`); `repeated_call` (two calls with the same tool and the same arguments); `expected_in_prompt` (an expected value in the prompt).

### The perf lane

"Compared with the merge base" is the perf lane's (`scripts/benchmark.mjs`, `benchmarks/budgets.json`), as #16 and #24 left it. The implementer adds a task **`deep-mcp-30d`**: a command, run from the checkout's root, that drives `deep mcp` against a hub holding 30 days of record and exits 0, valid by `validateBudgets` against the merge base's file, with an `initialReason` naming #26. Its margin and limits are the implementer's; the 100 ms, 300 ms and 80 MB are judged in `budgets.test.ts`.

## Criteria, tests and wrong programs

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed and the leading `- [ ] ` dropped (the command in `tests/acceptance/48/README.md`). Each test name starts with its ID; the "Done when" sentence has none and is tagged `#26.done-when`.

| # | ID | Tests | Wrong programs it fails on | On the base |
|---|---|---|---|---|
| 1 | `#26.16520b7d` | `ask`: one. You answer with `deep inbox answer` while `deep_ask` waits; it returns `answered` with your option, the ask filed under the agent's session | a `deep_ask` that returns before the answer, or doesn't file under the session | FAIL: no tool `deep_ask` |
| 2 | `#26.644467d9` | `ask`: one. A task with its check left out or null is refused naming `check` and files nothing; the twin naming `unit` is filed as `unblock` with `proves: "unit"` | a hub that files a task without a check | FAIL: no tool `deep_ask` |
| 3 | `#26.01e00356` | `ask`: one. A decision saved from your answer is found by its ask's question, cited `decision:<id>` | a search over asks only, or with no source | FAIL: no tool `deep_search` |
| 4 | `#26.281a87e3` | `tools`: one. No tool named, or taking a field, for answering, deciding or overruling; every tool called with an open ask's and a decision's handle answers and decides nothing | an answering tool; a tool that closes an ask | FAIL: the issue's tools aren't listed |
| 5 | `#26.1ca7aee5` | `binding`: one. Two agents' asks filed each under its own session; a `deep mcp` started by hand searches and its claim is refused, nothing filed | a hub binding a parentless process to a session | FAIL: no tool `deep_ask` |
| 6 | `#26.11e88ca6` | `binding`: one. Claims after SessionEnd are refused, before and after a new session starts in the worktree; the new session's process binds to it | a binding kept past SessionEnd; a successor inheriting it | PASS: #16's hub already does this; regression protection |
| 7 | `#26.8a0223bc` | `errors`: one. Every listed tool refuses an unlisted field with error@2, bound and unbound; every description says what it does not prove | a JSON-RPC error or a bare string for a refusal; a description without the sentence | FAIL: the issue's tools aren't listed |
| 8 | `#26.730e54de` | `outage`: one. A waiting `deep_wait` and `deep_status` answer `unavailable` within a second of the hub stopping; the tool list holds; after a restart and the call's PreToolUse, `deep_status` succeeds for the session from the same `deep mcp` process | a success while down; a slow answer; a changed tool list; a server that must be restarted | FAIL: no tool `deep_wait` |
| 9 | `#26.2d751e6d` | `tools`: one. `drift()` against the table, the live list and the skill, and against a drifted table and skill | descriptions or a skill not from the table, or naming parameters | FAIL: the issue's tools aren't listed (and no skill) |
| 10 | `#26.2ba61e05` | `evidence`: two | plant `evidence-checks-path-first` (fails naming the link) | FAIL: the base *is* the wrong program, storing the link's target; plant FAIL: unknown plant |
| 11 | `#26.131a6956` | `budgets`: two. The perf lane's task; on the reference Mac, 30 days seeded (`seedMonth`), five runs after a warm-up of 40 status and 40 open-item calls and 20 searches each, p95 judged by the design's timing rule, and the agent's `deep mcp` RSS. Off a reference Mac (Mac15,7 or Mac15,12), on battery, Low Power Mode on or unknown, or with a thermal warning, skipped as INCONCLUSIVE, never passed | a slow call, a heavy server, no perf task | FAIL: no task `deep-mcp-30d`; timing skipped INCONCLUSIVE here (battery) |
| 12 | `#26.e335d28b` | `tools`: one | a tool the design doesn't name; an unlisted name served; a shell field; a payload that runs | FAIL: the issue's tools aren't listed |
| 13 | `#26.4c0cfacd` | `scorer`: ten, the clean run and one mutant per rule | a scorer that passes any of the mutants | FAIL: no skill, no scorer |
| 14 | `#26.bf6dc81a` | `binding`: two | plant `binds-first-stamp` (fails naming both sessions) | the run PASSES: #16's hub already binds per call; plant FAIL: unknown plant |
| 15 | `#26.943c5a8d` | `search`: two | plant `unbound-reads-all` (fails naming the open item) | FAIL: no tool `deep_open_item`; plant FAIL: unknown plant |
| 16 | `#26.c1ac84d7` | `errors`: three | plants `errors-without-actual`, `errors-unscrubbed` (each fails naming `deep_run`) | FAIL: no tool `deep_run`; plants FAIL: unknown plant |
| Done when | `#26.done-when` | `tools`: the strict check (with planted schemas it must refuse); `contradiction`: a claim predicting `unit` passes and `lint` fails, both runs failing, shows unit's run in `deep_status`'s `contradictions` and not lint's | a permissive schema; no contradiction, or one for an agreeing prediction | FAIL: the issue's tools aren't listed; no tool `deep_run` |

No implementation was run: the passing side of each failing test, and each plant's failure, are unverified until it exists. The machinery was exercised on the base where it reaches (the agent stand-in, hub restarts, the strict check, `drift()`, the scrub forms, the index fill module and the 30-day seed). `BASE-FAILURE.txt` holds the base run.

## Readings where the issue leaves a choice

- **"Runs deep-hook by hand" (criterion 14)** is a hook request whose parent is the shared daemon, carrying B's session, transcript and folder: a shell that execs its last command leaves deep-hook a child of the daemon, so the hub can't tell it from B's own hook. That is the case the rule "a call more than one unspent event matches binds to none" exists for; a hook run through a shell that stays between is unverified and stamps nothing (#16 AC17), which binding by process already covers. A protocol stand-in carries it, as in #16 and #24, rather than the Rust binary.
- **A new session in the same worktree (criterion 6)** is a new agent process there. A session ID rotated inside the same process (`/clear`) is "bound again" by the design, which is not this criterion's case and isn't tested.
- **Once the hub is back (criterion 8)**, the agent's next call comes after the PreToolUse Claude Code fires for it, which is how a running session reaches a restarted hub; the agent's session isn't restarted and its `deep mcp` is the same process.
- **The scrub-list value (criterion 16)** is the hub's control token, a value it holds (Privacy: "its own tokens"), as #16's AC19 read it. "Cut at 8,192" is tested with the token straddling the cut: no 12-character prefix of it may survive.
- **The planted entry and clean twin (criterion 16)** are tested for presence and difference, not run: a code's page is generic, and its twin may name a check this test's repo lacks.
- **The project's spec for an unbound call (criterion 15).** The hand-started `deep mcp` runs in the session's worktree; whether the hub finds the spec from the `deep mcp`'s folder or from projects in the record, it is that worktree's `.deepbuild/done.yaml`.
- **The server's memory (criterion 11)** is the agent's `deep mcp` process ("the server" is the MCP server); the hub's own budgets are #16's.
- **"Generated from the table" (criterion 9)** is held as containment of each row's Never cell (and, for the skill, its block), the part of the table that says "what it never does", which the design says the skill carries; the wording around it is free.
- **Strict** is the intersection described above, not the design's whole node list (see Strict schemas).
- **Skill hygiene beyond the criteria** (pinned to the installed version, each agent checked to load it) is the scorer's `skill_not_loaded` and `skill_tools_mismatch` only; the version pin isn't tested.

## Files

- `helpers.ts`: temp homes and cleanup by PID, worktrees with their spec, the record seeded through the record and asks core (and `seedMonth`), the hub with its seams, the socket and `events.read`, the MCP client (`McpProcess`, the `Agent` stand-in), tool outcomes and `errorOf`, `sampleArgs`, `strictProblems`, the Building blocks table and `drift()`, the scrub forms, the index@1 fill writer, the budget rule.
- `fixtures/agent.mjs`: the agent stand-in and its hook client. `fixtures/eval/run.json`: the recorded run the scorer is fed.
- `ask.test.ts` (1, 2, 3), `binding.test.ts` (5, 6, 14), `tools.test.ts` (4, 9, 12, Done when: strict), `errors.test.ts` (7, 16), `outage.test.ts` (8), `evidence.test.ts` (10), `budgets.test.ts` (11), `scorer.test.ts` (13), `search.test.ts` (15), `contradiction.test.ts` (Done when: contradiction).
- `tsconfig.json`: type-checks the suite under the root's strict options with `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the base run.
