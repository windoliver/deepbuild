# Acceptance tests for #2896: a reply reaches the agent whole

Written first, blind, by a job that never saw an implementation of #2896; none existed. Written from the issue (its body, Scope,
the seven acceptance criteria, Proof and Runs on; it has no comments), `docs/technical-design.md`, `docs/canvas-primitives.md`
and the base commit `6a2b68d44` ("Merge pull request #2838 …"). The implementing agent doesn't edit these files (AGENTS.md,
Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). The issue's checkboxes carry no IDs, so AC1 to AC7 are
their order. Each test's name starts with `ACn #2896.<id>`, the proof trace's tag for its criterion (`scripts/proof-change.mjs`
`criterionId`: the first eight hex digits of the SHA-256 of the checkbox text, trimmed, white space collapsed; as #992's suite
does), the planted-program tests with their criterion's tag; each criterion is quoted above its test. The IDs: AC1
`#2896.b9f34dd1`, AC2 `#2896.4f78f2ef`, AC3 `#2896.bd79ba6e`, AC4 `#2896.1feb9185`, AC5 `#2896.8a6ba5bb`, AC6 `#2896.012f2f9c`,
AC7 `#2896.9f89e4e4` (no test).

## What was read

- The design: in `docs/technical-design.md`, Five ways in, all onto the same core (the MCP tools row), What each agent gives us,
  and the limits we design around (Facts as data: every field names the core rule that reads it, with a conformance case; What a
  session loads: `mcp.tools_listed`), Reading by reference (output capped per call, a cut reply says where to continue), and How we
  know version 0 works (Wrong programs, Dogfooding). In `docs/canvas-primitives.md`, Render-back.
- At the base: `crates/deep-show/src/kinds.rs` (`REPLY_CAP` 65,536, `PAGE_BUDGET`, `GUIDE_PAGE` and `SHEET_CAP` 32,768, `paged`),
  `kinds/replies.rs` (list, search, a guide's read, gallery, sheet), `query.rs` (`REPLY_CAP`, `reply_room`, `fitted`, rows and
  refs_to with `next`), `modes.rs` (a mode's readings cut by `fitted`); `packages/hub/src/mcp.ts` (`deep mcp`: the client's name from
  `initialize`, `answerWaitMs` for Codex's `tool_timeout_sec`, a result sent as a text block and `structuredContent`), `tools.ts`
  (the schemas, `missing_field` carrying the tool's schema), `plant.ts` (`DEEP_HUB_PLANT`; the hub refuses a name it doesn't
  know), `holds.ts` and `mcp-servers.ts` (`mcp.tools_listed`, recorded at a session's start for third-party servers only),
  `packages/contracts/schemas/mcp.tools_listed@1.json`; `adapters/claude-code.facts.json` and `adapters/codex.facts.json`
  (`versions`, the `tokenizer` entry, `contextOutput` and `ruleLoad` as the per-version entry precedent), `scripts/corpus.mjs`
  (`check --facts <dir>`, the adapter-facts cases), `benchmarks/budgets.json` (`deep-mcp-30d`); the suites `1415` (layout, the
  hub world, planted hubs), `806` and `26` (the hub, the stand-ins, `deep mcp` over stdio), `1514` (a facts case run through
  `corpus.mjs check`), `1801` and `412` (refs_to, the paged deep_kinds replies).

## What the base does (seen in scratch runs and in `BASE-FAILURE.txt`)

Every client gets the same 64 KB cap; nothing reads a client's limits, and the facts files hold none:

- A full page of deep_query's rows (1,000- and 10,000-row fixtures, `cap` past the page) is 57,537 characters and 21,928 tokens
  (o200k_base) as either client receives it: over both of Claude Code's limits and 2.2 times Codex's. The 10,000-row walk takes
  28 pages. deep_kinds' list is 54,188 characters, 16,971 tokens; its search 57,264 and 18,530; the sheet 39,653 and 14,008; the
  bounds mode's readings of 1,200 rects 46,623 and 21,185. refs_to of a group with 999 children, at `cap: 1000`, is 57,556 characters and 17,142 tokens (at the default cap of 200 it holds no `next`).
- The installed guides are short: the patches guide is 7,828 characters and `logic` 13,878 (5,111 tokens). No guide fills a page,
  and the hub's world file can't install one (`shape` in `packages/hub/src/canvas.ts` passes no `gallery` to the canvas core).
- Every `missing_field` refusal is under 9,000 characters: deep_drive's is the largest, 7,907 characters (the issue counts 7,685
  for its schema alone). deep_show's refusal of a revision whose 1,000 items each fail its check is cut by the canvas core (the
  rest goes to `issues_evidence`), to 8,482 characters.
- `mcp.tools_listed` is recorded only for third-party stdio servers at a session's start (our own `deep`, `deepbuild` and
  `deep-actions` are skipped), and its schema allows no field for a limit.
- `node scripts/corpus.mjs check` fails on the base already (versions with no recorded FileChanged, SubagentStart … payloads,
  versions of cursor and opencode with no set); AC1 counts only the lines a planted facts file adds to those.
- gpt-tokenizer 4.0.0 is already a root dev dependency (`package.json`), and `adapters/codex.facts.json`'s `tokenizer` names it
  (`o200k_base`). Nothing new is installed for this suite.

## Run them

```sh
npm ci && npm run build --workspaces                       # the hub, deep mcp and the CLI
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
cargo build --locked -q -p deep-show -p deep-hook          # the canvas core and the hook client the hub needs
node node_modules/vitest/vitest.mjs run --root tests/acceptance/2896 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/2896/tsconfig.json
```

Node 24, with `/usr/sbin` and `~/.cargo/bin` on PATH. Every hub runs in a temporary home under the system's temp folder (#806's
`makeHome`, `HOME` there), so the real `~/.deepbuild`, `~/.claude` and `~/.codex` are never touched; every process is stopped by
its PID (#806's `cleanup`). `facts.test.ts` runs `node scripts/corpus.mjs check --facts <dir>` on temporary copies of
`adapters/*.facts.json`. The files start hubs and walk 10,000 rows through the debug canvas core, so they run one at a time:
`scripts/lanes.mjs` needs `alone.push('tests/acceptance/2896/')`, as #1415's and #1725's READMEs asked for theirs; this README is
the instruction, and the implementer makes that edit. `walk.test.ts` is long: every deep_query page evaluates all 10,000 items
(about 4 s a page on a quiet Mac, 13 s at a load of 260), and it walks four times. A call `deep mcp` doesn't answer in 55 s (its
own wait, `ANSWER_MS`) comes back `unavailable`, which the walk reports as a failed page: under very high load, rerun the file
alone. With `--root` here Vitest writes `node_modules/.vite` in this folder; delete it before committing.

## Surface choices

Everything goes through the surfaces the issue names: `deep mcp` over stdio on a fixture hub (#806's `startHub` with its world
file, `DEEP_HUB_TEST_SHOW`), each `deep mcp` the child of an agent stand-in whose session the hub knows from its hooks (#806's
`Stand`; a Codex session's call is stamped by its PreToolUse first, #39), the two facts files, `node scripts/corpus.mjs check`
for their conformance case, and `mcp.tools_listed` read from the record (`events.read`).

### Figures

The suite holds the issue's figures as constants (`helpers.ts`): Claude Code files a text result over 50,000 characters or 25,000
tokens and cuts an error over 11,000 characters to its first and last 5,000; Codex cuts output past 10,000 tokens in the middle;
the drafted caps are 8,000 tokens for Codex, 40,000 characters and 20,000 tokens for Claude Code, and 9,000 characters for a
refusal. AC1 holds the facts files to the same figures, so a stand-in that read them from the facts would keep and cut alike.

### Counting

Tokens are counted with gpt-tokenizer 4.0.0's `o200k_base` (`countTokens`), the counter the issue's audit used and the one
`adapters/codex.facts.json` names at the base, for both stand-ins: Claude Code's facts name no tokenizer at the base, and the
audit counted Claude Code's limit with the same counter. Characters are JavaScript string length (every reply here is ASCII).
What a client receives is the result's text blocks joined; where the result also carries `structuredContent` (every deep_* result
does), the suite counts the larger of the two, since a client may hand either to its agent.

### The stand-in clients

- **Claude Code** (`claudeKeeps`): a result whose text is over 50,000 characters or 25,000 tokens is replaced by one line naming a
  file path; an error result over 11,000 characters keeps its first and last 5,000 characters with a marker between.
- **Codex** (`codexKeeps`): a result over 10,000 tokens keeps its first and last 5,000 tokens, with `…N tokens truncated…` between.
- Each names itself in `initialize` as the agent does: `claude-code` (version 2.1.308) and `codex-mcp-client` (version
  0.166.0-alpha.5.1), each in a session of its own agent kind. The third client, for AC6, names itself `acceptance-2896-client`
  from a Claude Code session: the issue has `deep mcp` know its client by name, so the name alone decides.

### The paging replies and their fixtures (AC2)

The page document (`pageDocument`): one group `g000` (a `rect@1`) with 999 child rects, 1,000 rows. The bounds document: 1,200
rects. Both are drawn as whole revisions on documents the world file minted (`DOC.page`, `DOC.bounds`) by the Claude Code
session; both clients read them (nothing in them is hidden from another session). The replies, each from both clients:

| Reply | Call | A full page |
|---|---|---|
| deep_query's rows | `{doc: page, what: rows, cap: 1000}` | carries `next` |
| deep_query's refs_to | `{doc: page, what: refs_to, target: g000, cap: 1000}` (999 rows name it as parent) | carries `next` |
| deep_kinds' list | `{op: list}` | carries `next` |
| deep_kinds' search | `{op: search, query: "a"}` | carries `next` |
| deep_kinds' sheet | `{op: sheet}` | one page by design; measured as it is |
| a guide's page | `{op: read, guide, offset}`, every page of every guide a search for `a`, `e` or `guide` hits | measured as it is: no guide fills a page (above) |
| a deep_show mode's readings | `{doc: bounds, mode: bounds}` | carries `next` |

A reply that should carry `next` and doesn't is a failure ("the fixture didn't fill a page"). `cap` is past the page on purpose: at
the default of 200 rows a page isn't full at the base (41 KB, no `next`).

### The walk (AC3, AC4)

The walk document (`walkDocument`): 100 groups `g000`…`g099`, each with 99 child rects `gNNN.cMMM`, 10,000 rows, drawn on
`DOC.walk` by the Claude Code session. The walk is deep_query `{doc, what: rows, cap: 10000, cursor}`, from no cursor, following
each page's `next` until a page has none. Each client walks it once in the same world. A page reaches a stand-in whole when the
stand-in keeps it whole and the text holds no cut marker; a walk that doesn't return 10,000 rows fails too.

### The walk's rows (AC4)

"The merge base's rows read under its cap" can't be read on a change without building the merge base, so this job recorded them
at the base commit: `fixtures/base-walk.json` holds the base's walk (Claude Code's client, the base's one cap for every client)
as the SHA-256 of its rows, one per line, each row as `[id, parent, kind, children_total]`, with their count. The test checks that
record against `walkModel()`, the rows the walk document gives in the base's order (depth first, each row after its parent,
siblings by ID: `query.rs` `rows_reply`), and names a failing row against that model: a row twice, a row missing, a row not the
base's, or the first place the order differs. The other fields of a row (`layer`, `module`, `key`) are left out of the comparison,
since a module set that changes between the blind base and a later merge base would change them without the walk changing. The
walk is "read under the Codex cap" when each of its pages is at most 8,000 tokens; a page over it fails AC4 too.

### The facts entry (AC1)

The issue names no key or shape for the limits, so `facts.ts` finds an agent's limit entry by what it holds, and any reasonable
naming passes:

- **The entry for a version** is the deepest object of the facts file that applies to it, a `versions` list holding it (as
  `ruleLoad`'s entries do) or the value under a key that is the version, and that holds the agent's result figures: Claude Code's
  50,000 and 25,000; Codex's 10,000 with a `tokens` mode (a string `tokens`, or a key naming tokens).
- **Its error limit** is a key named like `error` under the entry with a number under it.
- **What it does past them** is a string under the entry matching a file (Claude Code) or a cut (Codex: `cut`, `truncat…` or
  `middle`).
- **Each figure's source** is a string under a key named like `source` (or `readFrom`, `readAt`, `from`; never `readBy`, which in
  these files names the rule that reads an entry) on the figure's own object or an object above it inside the entry, naming
  Claude Code's MCP page (it holds `mcp`) or Codex's catalog command (`codex debug models`).

**The conformance case** is the adapter-facts cases as the preflight's corpus lane runs them, `node scripts/corpus.mjs check
--facts <dir>` (#1514's and #1296's suites run theirs so). The planted facts file is the shipped one with the agent's newest
listed version taken out of every limit entry (dropped from its `versions`, or its key deleted); the check must add a FAIL line,
against the shipped facts' own FAIL lines, that names that version.

### A client the facts don't know (AC6)

"The smallest limit in any facts file" is Codex's 10,000 tokens (8,000 with the fifth) and Claude Code's 50,000 characters (40,000)
on the other unit; the unknown client's full page of rows is held to both. "`mcp.tools_listed` says which limit applied" is read
as: the record holds an `mcp.tools_listed` event about that client's session (its `session`, or data naming the client) with a
field beside `server`, `scope`, `version`, `tools` and `held` that names the limit: a value holding 10,000 or 8,000, or naming
Codex, whose facts hold it. Which server entry and when it's recorded are the implementer's.

### The largest refusals (AC5)

The largest refusal each tool can send, as this suite can make each send one: for every tool `deep mcp` lists with a required
field, the call with every field left out, refused `missing_field` with the tool's whole schema (#1415); and deep_show's refusal of
a whole revision whose 1,000 items each have an unknown field. Each is measured as each stand-in keeps it (Claude Code's error cut
included, so a refusal over 11,000 characters arrives as about 10,000) and must be under 9,000 characters.

### Planted programs

Selected by `DEEP_HUB_PLANT`, set on the hub and on each stand-in's `deep mcp` (the variable the hub, `deep mcp` and the canvas
core all inherit), as #1415's and #806's suites select theirs. The names are this job's; the implementation adds them to
`packages/hub/src/plant.ts` (and the canvas core reads the same variable where the cap lives):

| Plant | Criterion | The wrong program | The test requires |
|---|---|---|---|
| `reply-cap-64kb` | AC3 | every client's reply cap stays 64 KB | each stand-in's walk fails at its first cut page, naming it |
| `pager-drops-edge-row` | AC4 | the pager drops the row at a page's edge | the Codex walk's rows fail against the base's, naming a row |
| `refusal-schema-12000` | AC5 | a refusal carries a 12,000-character schema | a failure naming `missing_field` and its size |
| `unknown-client-64kb` | AC6 | `deep mcp` gives an unknown client 64 KB | the unknown client's page fails, naming the client |

At the base each planted test fails at its first assertion, since the hub refuses a plant it doesn't know
(`DEEP_HUB_PLANT=… names no planted program`). AC1's wrong program is a facts file, built by the test itself.

## Criterion → test

| Criterion | Test | At the base |
|---|---|---|
| AC1 `#2896.b9f34dd1` | `facts.test.ts`: the limits per version with sources; the planted facts file | both fail: no limit entry; no case names the version |
| AC2 `#2896.4f78f2ef` | `pages.test.ts` | fails: deep_query's rows page is 57,537 characters and 21,928 tokens, and every other paging reply but the guides and Claude Code's sheet is over its cap |
| AC3 `#2896.bd79ba6e` | `walk.test.ts`: both walks whole; `reply-cap-64kb` | fails: every page is cut by Codex and filed by Claude Code; the plant is unknown |
| AC4 `#2896.1feb9185` | `walk.test.ts`: the rows against the base's; `pager-drops-edge-row` | fails: the rows equal the base's, but no page is under the Codex cap; the plant is unknown |
| AC5 `#2896.8a6ba5bb` | `refusals.test.ts`: every tool's largest refusal; `refusal-schema-12000` | the main test passes (regression protection, below); the plant is unknown |
| AC6 `#2896.012f2f9c` | `unknown.test.ts`: the unknown client's page and `mcp.tools_listed`; `unknown-client-64kb` | fails: 57,537 characters, 21,928 tokens, and no `mcp.tools_listed` names a limit; the plant is unknown |
| AC7 `#2896.9f89e4e4` | none | not checked here (below) |

## What doesn't fail on the base for the criterion's own reason

- **AC4's rows**: on the base the walk's rows are the base's by definition. The test fails there only because no page was read
  under the Codex cap. Its rows check is regression protection, proven by `pager-drops-edge-row`.
- **AC5**: the main test passes on the base. Every `missing_field` refusal is under 9,000 characters (deep_drive's 7,907 is the
  largest, as the issue says), and so is deep_show's refusal of a revision whose 1,000 items each fail its check (8,482 characters:
  the canvas core cuts its issues and puts the rest in `issues_evidence`). It is regression protection, proven only by
  `refusal-schema-12000`.
- **The walks at a high load**: in the recorded base run the load rose to about 200, and `deep mcp`'s 55 s wait ran out on page 14
  of the Codex walk and page 1 of the Claude Code walk (`unavailable`). AC3 and AC4 still fail at their assertions for the cap
  reason: each of the 13 Codex pages read (57.5k characters, 21.9k tokens each) reached the Codex stand-in cut and is over 8,000
  tokens. The timed-out pages add `unavailable` lines and the missing rows after them. The Claude Code walk read no page in that run,
  so its filed pages don't appear there; a scratch walk at the base read 25 pages through `deep mcp`, each 57.5k characters, which
  Claude Code files.

## Not checked here

- **AC7** (budgets on the reference Mac in the local preflight, against the merge base): it needs the reference Mac, a build of the
  merge base and the preflight's budget lane (`benchmarks/budgets.json`, run by the preflight), none of which this suite can run
  or stand in for, and the walk's own budget task doesn't exist yet to name. It stays open for the preflight's budget lane; a PR
  can't say `Closes #2896` on this suite alone.
- The Scope lines no criterion checks: a refusal over the limit carrying its first failing path whole and saying where the rest is
  read, and DeepBuild not raising a client's limit in a tool's `_meta` or the agent's config.
- A guide's page filled by a fixture: no guide at the base is longer than a page, and the hub's world can't install one (above).

## Files

- `helpers.ts`: the figures, counting, the stand-in clients, the hub world with its three clients, the fixtures, the walk and the
  judges. `facts.ts`: AC1's readers of the facts files and the corpus check.
- `facts.test.ts` (AC1), `pages.test.ts` (AC2), `walk.test.ts` (AC3, AC4), `refusals.test.ts` (AC5), `unknown.test.ts` (AC6).
- `fixtures/base-walk.json`: the base's 10,000-row walk, recorded at `6a2b68d44`.
- `tsconfig.json`: #1415's (the root's strict options with `noEmit` and `allowImportingTsExtensions`).
- `BASE-FAILURE.txt`: the run at the base.
