# Acceptance tests for #2897: a client that loads tools by search finds DeepBuild's

Written blind at base `6a2b68d44` from issue #2897, `docs/technical-design.md` (Five ways in, What each agent gives us,
Building blocks, Numbers version 0 has to hold, How we know version 0 works), AGENTS.md, and the code the issue names
at the base: `packages/hub/src/mcp.ts`, `packages/hub/src/tools.ts`, `packages/hub/tools.json`,
`crates/deep-hook/src/actions.rs`, `packages/reading/src/tools.mts`, `scripts/skill.mjs`, `skills/deepbuild/SKILL.md`,
`adapters/*.facts.json`, `adapters/corpus/` and `scripts/corpus.mjs`, `packages/hub/src/setup.ts`,
`packages/hub/src/session-facts.ts`, `benchmarks/budgets.json`, `scripts/proof-change.mjs` and `scripts/proof-runs.mjs`.
Nothing of #2897 exists at the base. The implementer doesn't edit these files; a dispute goes to a blind redraft.

## Run

```sh
npm run build --workspaces          # packages/cli/dist (deep mcp, deep hub run), packages/reading/dist/tools.mjs
cargo build -p deep-hook            # deep-actions as `deep setup` writes it, and the hub's start
cargo build --locked -p deep-show   # AC6: the canvas core the hub runs deep_show on
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/2897 --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/2897/tsconfig.json
```

Node 24 (the hub's `engines`). AC1, AC2, AC3, AC5 and AC8 take about a second; AC7 waits 61 seconds between its two
starts; AC4 and AC6 start a hub. A test that can't start what it needs stops with `BLOCKED: ... isn't built: <command>`
before its assertion. No test times anything, so none belongs in `scripts/lanes.mjs`'s `timed` list. On the base each
test but AC8 fails (`BASE-FAILURE.txt`): this checkout had no `target/`, so AC1, AC3, AC4 and AC7 stopped BLOCKED on
deep-hook there, and a second run with deep-hook's entry pointed at `deep mcp actions` shows AC1, AC3 and AC7 failing at
their assertions, each naming every server. AC8's wrong program is a twin (below).

## Surfaces

- **The four servers**, each started fresh over stdio in an empty home of its own (`HOME`), so no hub is reachable and
  `deep mcp` lists this build's tools: `deep` (`node packages/cli/dist/main.js mcp`), `deep-actions` as the hub serves
  it (`... mcp actions`), `deep-actions` as `deep setup` writes it (`target/{debug,release}/deep-hook mcp actions`, the
  newer), and `deepbuild-reading` (`node packages/reading/dist/tools.mjs <socket>`). Each is sent `initialize` as
  Claude Code names itself (`clientInfo: { name: "claude-code", version: <newest version claude-code.facts.json lists> }`),
  `notifications/initialized` and `tools/list`.
- **The generated text**: every string `scripts/skill.mjs`'s `generate()` returns, at any depth.
- **The mark**: `_meta: { "anthropic/alwaysLoad": true }` on a tool, as the issue reads it on Claude Code's page.
- **The pinned tokenizer**: gpt-tokenizer 4.0.0's `o200k_base` (`adapters/codex.facts.json` `tokenizer`); a value is
  counted as its JSON. By it, at the base: `deep_status` 244, the six a gated task calls 1,571, the eleven non-canvas
  tools 2,890, the skill 3,735 and its description 53, as the issue counts them.
- **Facts**: `adapters/claude-code.facts.json`, its `versions` and the entry for how it loads an MCP server's tools.
- **The corpus**: `adapters/corpus/claude-code/<version>/<scenario>/events.jsonl`, one hook payload per line.
- **The record**: a Claude Code session bound to a real hub by its hooks (#806's stand-in, #26's MCP client and
  `events.read`, #1725's red box and call), with `deep setup`'s `deepbuild` entry in the home's `~/.claude.json`.
- **Budgets**: `benchmarks/budgets.json`'s `deep-mcp-30d`.

## Criteria, tests and wrong programs

IDs are `criterionId` of each checkbox's text (`scripts/proof-change.mjs`).

| ID | Criterion (short) | Test | Wrong program it fails on |
|---|---|---|---|
| `#2897.a00d5d1a` | Each server's `initialize` holds `instructions` equal to the generated text, ≤ 1,000 characters; `deep`'s name `deep_status` first; on the base the test fails naming the server | `ac1-instructions`: each of the four servers' instructions is a string `generate()` returns, 1 to 1,000 characters, and deep's has a sentence naming `deep_status` with begin, first or start; each failure line starts with the server | The base: no server sends any (each named). A server whose text isn't generated, is over 1,000 characters, or (deep) doesn't name `deep_status` first |
| `#2897.ece39ddf` | In `deep`'s `tools/list` exactly the stated set carries the mark, no canvas tool does; a planted list marking every tool fails naming its tokens, 8,349 on the base | `ac2-marks`: the marked set is exactly `[deep_status]`, no canvas tool marked; deep's own list with every tool marked, through the same check, fails naming the tokens of its marked tools, at least the base's whole list | The base (nothing marked). The planted list (in the test) |
| `#2897.95956be1` | What a client that loads by search holds at the start is ≤ 800 tokens; a planted 4,000-character instructions text fails naming its size | `ac3-start-tokens`: for `deepbuild` and `deep-actions` (deep-hook), as setup writes them, the tokens of every `mcp__<server>__<tool>` name (one per line), each server's instructions, each marked tool whole and the skill's description; each part the issue drafts must be there (deep's instructions, a marked tool), and the total ≤ 800; deep's instructions replaced by 4,000 characters fail, naming `4000 characters` | The base (no instructions, no mark). The planted text (in the test) |
| `#2897.1171f907` | The record says which way the client loaded the tools; #2688's first criterion reads that count; a planted count charging the whole list to a search client fails naming the client and both counts | `ac4-record-count`: within 30 s of the session's start, one of the session's events holds the way "search" and both token counts, one ≤ 800, one ≥ the base's whole list; the count read for the session is the search one; the planted charge of the whole count fails naming `claude-code` and both counts | The base (no such event). The planted count (in the test) |
| `#2897.a24a3c11` | The corpus gains a scenario with DeepBuild's server on each listed Claude Code version: first `deep_status` with no search before it, every other tool searched before its first call, no schema refusal; a planted server's recording fails naming the call | `ac5-corpus`: on each version `claude-code.facts.json` lists, some scenario's hooks call DeepBuild's `deep_status`; in each, no ToolSearch before the first `deep_status` names it, every other DeepBuild tool's first call has an earlier ToolSearch result matching it, and no DeepBuild result holds `schema_needed`, `missing_field` or `InputValidationError`; the scenario with a search for `deep_status` laid before its first call fails, naming that ToolSearch call | The base (no scenario on any version). The planted recording (in the test) |
| `#2897.8fdcb433` | To a client whose facts say it loads by search, no tool listed with an empty schema, and a valid `deep_show` runs first time; a planted one-line-entry server fails naming `schema_needed` | `ac6-full-schema`: Claude Code's facts carry, for each listed version, an entry with its versions and a source that says "search", names 4096 and `anthropic/alwaysLoad`; its session's deep mcp lists no tool without properties, and its first `deep_show` (#1725's red box) is neither refused as a call nor as a document; `twins/one-line-server.mjs.txt` through the same check fails naming `schema_needed` | The base (no such facts entry). The planted server |
| `#2897.ec26a425` | Two sessions a minute apart get byte-identical `instructions` and tool lists, each tool's name, description and schema the base's bytes; a planted clock time fails naming it | `ac7-same-bytes`: each of the four servers started twice, 61 s apart: both starts receive instructions, the same both times, the same tool list, and each tool's name, description and input schema equal `base-tools.json`; deep's text with each start's clock time in it fails, naming the second time | The base (no instructions). The planted text (in the test). A change to any listed tool's bytes |
| `#2897.cc2bc99a` | `deep-mcp-30d` retires no more instructions and peaks no higher than the base, on the reference Mac in the local preflight | `ac8-budgets`: `deep-mcp-30d` is still in `budgets.json` with the base's command (`node benchmarks/mcp.mjs`), a margin no wider than 0.5 and no limit raised | Twin `budgets-widened` (`twins.json`): the base's budgets.json with the task's margin 1 |

## How the plants work

- **In-test plants** (AC2, AC3, AC4, AC5, AC7) are what the change's own output becomes with the one thing the issue
  names planted in it, run through the same check as the real output, and the test asserts the check's failure names
  what the issue says: the tokens a fully marked list loads; the size of a 4,000-character instructions text; the client
  and both counts; the ToolSearch call before `deep_status` (the recorded session with `select:<deep_status>` laid
  before its first call, as a server with no marks makes the agent search); the clock time.
- **The planted server** (AC6): `twins/one-line-server.mjs.txt`, laid in a scratch folder as a `.mjs` file and started
  over stdio. It lists each of deep's tools at the base with its first sentence and `{ "type": "object" }` as its schema
  (#1105's one-line entries) and refuses every call as error@2 with `schema_needed`.
- **The twin** (AC8): `twins/budgets-widened/benchmarks/budgets.json`, laid over the change by the before lane; it is
  the base's file with `deep-mcp-30d`'s margin 1.
- Plants are stored with a `.txt` suffix or under `twins/`, so no lane or typecheck reads them in place.

## The base

`base-tools.json` is each server's `tools/list` at `6a2b68d44` (name, description, input schema), read as the tests read
it; deep-hook's `deep-actions` list is `crates/deep-hook/src/actions.json`'s, the same bytes as `deep mcp actions`'s.
By the pinned tokenizer deep's whole list is **8,429** tokens there (each tool's JSON summed; 8,431 as one array), not the
issue's 8,349, which it took at `55fd5b84a`: `fde312a3d` (#2777) grew the canvas tools' schemas since (the canvas five are
5,539 here against the issue's 5,455; the other eleven are 2,890 in both). AC2 asserts the figure the planted check
names against the base's whole list as `base-tools.json` holds it, not the literal 8,349.

## Open questions, and what this draft assumed

1. **The load-mark set.** The issue drafts `deep_status` alone and names the six a gated task always calls as the
   other candidate, and says it states the final set before code moves. Assumed: `deep_status` alone (`MARKED` in
   helpers.ts). The six alone are 1,571 tokens, over AC3's 800, so AC3 holds only with the drafted set.
2. **Which four servers.** The issue names three files (`mcp.ts`, `actions.rs`, `tools.mts`); `mcp.ts` serves both `deep`
   and `deep-actions`. Assumed: `deep`, `deep-actions` from `deep mcp actions`, `deep-actions` from `deep-hook mcp
   actions`, and `deepbuild-reading`.
3. **The facts entry's shape.** The scope says each adapter's facts say, per listed version, whole or by search, what
   loads at the start, where `instructions` are cut and the mark, each naming where it was read, but names no keys.
   Assumed: an object anywhere in `claude-code.facts.json` with a `versions` list holding the version and a `source`
   string, holding the value `search` (or `by search`), and the values 4096 and `anthropic/alwaysLoad` within it.
4. **Where the record holds the way and the counts, and #2688's reader.** The issue names no event kind or field, and
   #2688's criteria and tests don't exist at the base. Assumed: some event of the session whose data holds the value
   `search` and, under keys containing `token`, both counts as integers; the "reader" is the check in the test (a search
   client is charged its search count). This is the criterion most likely to need the early question.
5. **How a server knows its client loads by search.** Assumed: from `initialize`'s `clientInfo.name` `claude-code`, or
   from the hook-bound session's agent; the tests give both.
6. **The generated text's place.** Assumed: `generate()` in `scripts/skill.mjs` returns each server's instructions
   somewhere in its value, as it returns the skill and the descriptions.
7. **Names counted at the start.** The issue counts "149 of names"; the form isn't stated. Assumed: `mcp__<config
   name>__<tool>` for each tool of `deepbuild` and `deep-actions`, one per line (167 tokens at the base).
8. **"No search before it" (AC5).** Read as no ToolSearch that loads `deep_status` (its `select:` query or its matches)
   before its first call; a search for another tool before it doesn't fail.
9. **"Runs on its first call" (AC6).** Read as answered without a refusal, as a call or as a document (`outcome` not
   `refused`).
10. **"The merge base's bytes" (AC7).** Held against `base-tools.json` at `6a2b68d44`. If main changes a tool before the
   change merges, the golden goes to a blind redraft.

## Not covered here

- **AC5's recordings** are made by a live run (`scripts/corpus.mjs record`, on each Claude Code version the facts list,
  on your own sign-in), as the corpus's other scenarios are. This suite reads what the corpus keeps; it fails until
  each version has one. A recording from a planted server with no marks is simulated in the test from the real one.
- **AC8's measurement** is the local preflight's perf lane on a reference Mac (instructions retired and peak memory
  against the merge base, `scripts/benchmark.mjs`); this suite checks only what `budgets.json` sets for it.
- `deep setup` never marking the whole server to load up front, Codex's own tool search, and #1105's one-line entries to
  a client that loads every schema at the start are in the scope but in no criterion.
