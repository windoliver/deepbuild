# Acceptance tests for #2854: the MCP servers answer `initialize` from a held list of revisions

Drafted blind, before any implementation, from issue #2854 (its report, Scope, the table of what `2025-11-25`
changes, "Where the list, the facts and the check live" and the six acceptance criteria, read with `gh issue view`),
the design's sections the issue links (Five ways in, all onto the same core; Socket roles and contract versions,
"Contracts that can't drift", "What a minor may change" and "Version skew"; What each agent gives us), the Dogfooding
paragraph, `AGENTS.md`, and the code at the base commit `58b4a8cb2` (origin/main). No other branch, worktree, pull
request or diff was read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a
blind redraft of this job (design: Dogfooding).

**This is the redraft** made once the issue named what the first draft listed as open: the contract entry, the facts
section, the recorded request's path and the conformance check. AC4 and AC5 are rewritten to those names, and AC5's
second sentence (the cut-back list) is now tested. AC1, AC2, AC3 and AC6 are unchanged: the new section changes
nothing they assert.

At the base I read, for the surfaces: `packages/hub/src/mcp.ts` (`deep mcp` and `deep mcp actions`, started as
`deep mcp [actions]`), `crates/deep-hook/src/actions.rs` and `main.rs` (`deep-hook mcp actions`; the hub's address
from `$HOME/.deepbuild`), `packages/reading/src/tools.mts` (built to `packages/reading/dist/tools.mjs`, started as
`node tools.mjs <socket>`), `packages/contracts/README.md` and `crates/deep-contracts/README.md` (schemas under
`packages/contracts/schemas/<name>@<n>.json`, generated into `packages/contracts/src/generated/types.ts` and
`crates/deep-contracts/src/generated.rs`), `adapters/claude-code.facts.json` and `adapters/codex.facts.json`
(`schema`, `versions`, `agent`: `claude` and `codex`), `adapters/corpus/README.md` and its folders
(`adapters/corpus/claude-code/<version>/`, `adapters/corpus/codex/<version>/`), `scripts/corpus.mjs` (its `check`
command and what it reads), `benchmarks/budgets.json`, and suites `2897/` (the four servers over stdio, the budgets
test), `3067/` and `3005/` for house style.

## Run

```sh
npm ci && npm run build --workspaces     # deep mcp, deep mcp actions, the reading tools
cargo build -p deep-hook                 # deep-hook's mcp actions
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/2854 --testTimeout=600000
```

Any machine (the issue's "Runs on"). Each test starts its servers in a temp `HOME` of its own, where no hub is
reachable; every process is ended by closing its stdin, and one still running a second later is stopped by its own PID.
Nothing is stopped by name or port. A server that isn't built throws `BLOCKED: <server> isn't built: <command>`.
AC5's cut-back test copies the checkout to the OS temp folder (about 15 s and 1 GB of copy-on-write clones on APFS)
and removes the copy when it ends.

## The surface

- **The four servers**, each driven over its stdio by raw newline-delimited JSON-RPC lines, a fresh process for each
  handshake (initialize is a session's first request): `node packages/cli/dist/main.js mcp`, `... mcp actions`,
  `target/{debug,release}/deep-hook mcp actions` (the newer), and `node packages/reading/dist/tools.mjs
  <home>/no-reading-job.sock`. Read: `result.protocolVersion` of initialize, `result.tools` of tools/list, and the
  whole answer to one tools/call.
- **The contract entry** (AC4, AC5): `packages/contracts/schemas/mcp.handshake@1.json`, its
  `properties.protocolVersion` (`type: "string"`, an `enum` oldest first), and the two generated files, for the names
  `McpHandshake` (`types.ts`) and `McpHandshakeProtocolVersion` (`generated.rs`).
- **The reading tools' copy** (AC4): the quoted `YYYY-MM-DD` literals in `packages/reading/src/tools.mts`.
- **The facts** (AC5): `adapters/claude-code.facts.json` and `adapters/codex.facts.json` at `adapter.facts@9`
  (`packages/contracts/schemas/adapter.facts@9.json`), their `mcpHandshake` section
  `{readBy, conformance, entries: [{versions, revision, request}]}`, and each `request` file.
- **The conformance check** (AC5): `node scripts/corpus.mjs check`, run from the root of a copy of the checkout; its
  exit code and the lines it prints (stdout and stderr).
- **`benchmarks/budgets.json`** (AC6).

## The tests

| File | Criterion | Tests | What it asserts |
|---|---|---|---|
| `ac1-answers.test.ts` | `#2854.714225f2` | 4, one per server | initialize naming `2025-06-18` is answered `2025-06-18`, naming `2025-11-25` is answered `2025-11-25`, and naming `1900-01-01`, naming `2026-07-28` and with no `protocolVersion` each is answered `2025-11-25`. Each failure line is `<server>: initialize naming <version> is answered <answer>, not <want>` |
| `ac2-same-tools.test.ts` | `#2854.411577d9` | 4, one per server | The server holds a list (initialize naming `1900-01-01` is answered `2025-11-25`, not sent back). Then a session per held revision, in one home: its initialize is answered with that revision; its tools/list has the 2025-06-18 session's names in the same order and each tool byte for byte the same; a call to its first listed tool with `{}` is answered as the 2025-06-18 session's call is (no hub: deep's and both deep-actions' are the hub-unreachable error@2, the reading tools' the socket-unreachable text) |
| `ac3-schema-keywords.test.ts` | `#2854.aaad023c` | 4, one per server | The server holds a list (as in AC2), answers initialize naming `2025-11-25` with it, and in that session every tool's `inputSchema` uses only keywords both dialects define alike (`SAME_KEYWORDS` in `helpers.ts`, walking every subschema; `items` only as one schema). Failures read `<tool>: <keyword> at <path>`. Then the same list with a planted tool whose `items` is a list of schemas fails the same check, each line naming `planted_tuple` and `items` |
| `ac4-one-entry.test.ts` | `#2854.58c9395c` | 1 | `mcp.handshake@1.json` exists, is an object schema, and its `protocolVersion` is a string whose `enum` is exactly `["2025-06-18", "2025-11-25"]`, in that order. `types.ts` holds `McpHandshake` and `generated.rs` holds `McpHandshakeProtocolVersion`, each file holding both revisions. `packages/hub/src/mcp.ts` and `crates/deep-hook/src/actions.rs` hold no revision as a quoted literal, and `deep mcp` and deep-hook's `mcp actions` answer `1900-01-01` with the enum's last. `packages/reading/src/tools.mts`'s quoted revisions equal the enum's; that file with the newest taken out fails the same comparison with a line that starts with `packages/reading/src/tools.mts:` and says it lacks `2025-11-25` |
| `ac5-facts.test.ts` | `#2854.9225ef55` | 3: one per facts file, and the cut-back | **Per facts file**: `schema` is `adapter.facts@9` and `adapter.facts@9.json` exists; `mcpHandshake` has non-empty string `readBy` and `conformance` and a list `entries`; every covered version is in exactly one entry's `versions`; that entry's `revision` is held; its `request` is `adapters/corpus/<file>/<version>/mcp-initialize.json`, which exists, is one JSON document with `method: "initialize"`, and names the entry's revision as `params.protocolVersion`. Failure lines name the file and the version. **Cut-back**: the two files' entries name at least one revision, all in the entry's enum; a copy of the checkout is made and `node scripts/corpus.mjs check` runs there as it is; then, for each named revision, the copy's enum is set to the checkout's less that revision and the check runs again. It exits non-zero, and among the lines it prints that it didn't print before the cut, one names, as whole words, the facts' `agent` (`claude`, `codex`) of each file whose entries name that revision, one of that entry's versions, and the revision |
| `ac6-budgets.test.ts` | `#2854.1891d3ad` | 1 | `deep-mcp-30d` is still in `budgets.json` with the merge base's command (`node benchmarks/mcp.mjs`), a margin no wider than 0.5 and no limit raised |

### Which plant each test catches

The implementer writes the twins (AGENTS.md); these are the plants the criteria name and where they fail:

- **AC1**: the base itself, each server named with `1900-01-01`, `2026-07-28` and no `protocolVersion`.
- **AC2**: a server whose tools/list or tool call at `2025-11-25` differs from `2025-06-18` (a tool dropped, reordered
  or rewritten, or a call answered otherwise) fails at "`<server>`'s sessions at 2025-06-18 and 2025-11-25", naming it.
- **AC3**: a planted tool with `items` as a list, in any server's list, fails at "`<server>`'s tools' schemas", naming
  `<tool>: items at <path> is a list of schemas`. The test also runs that plant itself over each server's real list.
- **AC4**: a planted `packages/reading/src/tools.mts` whose list lacks `2025-11-25` fails at "the reading tools' copy
  equals the entry", the line naming `packages/reading/src/tools.mts`. The test also runs that plant itself, by
  taking `2025-11-25` out of the file's text.
- **AC5**: facts that lose a version's entry, name an unheld revision, or point at a missing or disagreeing request fail,
  naming the file and the version. The cut-back plant the criterion names is made by the test itself (above); a check
  that passes there, or fails without a line naming the agent, a version and the revision, fails at "the check names the
  agent, the version and the revision the cut list lacks".
- **AC6**: a `budgets.json` whose `deep-mcp-30d` margin is wider than 0.5, a limit raised, or the command changed.

## Readings where the issue leaves a choice

- **"A handshake at a held revision"** (AC2, AC3) is one the server answers with that revision because it holds it.
  A server that sends back whatever it is sent holds no revision, so these tests first show the server holds a list:
  initialize naming `1900-01-01` is answered `2025-11-25`. On the base this is where AC2 and AC3 fail. Their own
  assertions (same tools, same call; keywords alike in both dialects) hold on the base, so a twin is what proves them.
- **"Answered as it is at 2025-06-18"** (AC2): the whole JSON-RPC answer but its `id` (the same in both sessions)
  is equal, `result` or `error`.
- **"Keywords that mean the same"** (AC3) is an allow list, not a deny list: `SAME_KEYWORDS` in `helpers.ts`, with the
  reason each left-out keyword differs. `format` and the annotations are allowed; `$ref`, `definitions`/`$defs`,
  `$id`, `$schema`, `dependencies` and every 2019-09-or-later keyword are not. Property names under `properties` and
  `patternProperties` are names, not keywords. At the base every server's schemas pass it (keywords used: `type`,
  `properties`, `enum`, `description`, `items` as one schema, `required`, `additionalProperties`, `pattern`).
- **"Read the held list from one contract entry"** (AC4): the named entry holds the list; the files the issue names for
  `deep mcp`'s and deep-hook's initialize (`mcp.ts:157`, `actions.rs:382`) hold no revision literal of their own; each
  answers an unknown revision with the enum's last. How they read it (`getSchema`, the Rust enum's `ALL`) isn't
  asserted: that is how, not what. The generated files are checked for the two names and both revisions, not for their
  shape. A copy of a revision in another hub file is not looked for: the hub's MCP client to other servers
  (`packages/hub/src/mcp-servers.ts`) sends `2025-06-18` as a client and is not one of the four servers.
- **"The reading tools' copy equals it"** (AC4): the set of quoted `YYYY-MM-DD` literals in the named source file equals
  the enum. A copy spelled any other way (a computed string) isn't seen.
- **`<agent>` in the request path** (AC5) is read as the facts file's name (`claude-code`, `codex`), the name the
  corpus folders already use, not the facts' `agent` field (`claude`). **"One entry per covered version"** is read as
  each covered version being in exactly one entry; an entry may still list more than one version, but its `request`
  must then be the path for each of them, which only one version can match, so in practice each entry covers one.
- **"A line naming the agent, the version and the revision"** (AC5): one line the check prints after the cut and not
  before it holds the facts' `agent` (`claude`, `codex`) as a whole name (not inside `claude-code`), one of the
  versions the cut revision's entry covers, and the revision. Lines the check prints anyway are set aside, because at
  the base `node scripts/corpus.mjs check` already exits 1 on cases of its own (payloads missing from Claude Code's
  and Codex's sets, no recorded set for cursor, opencode and paseo); so "exits non-zero" is asserted but proves little
  by itself, and the new line is what the test turns on.
- **Which revision each covered version opens with** isn't asserted, only that it is held and that the recorded
  request names it: the issue states Claude Code 2.1.328's newest, not the covered versions'.

### How the cut-back test reaches an assertion on the base

It reads the facts' `mcpHandshake.entries` without throwing (a missing section is no entries) and first asserts the
revisions they name are not none, then that `mcp.handshake@1.json` exists (`heldList()` returns a failure line rather
than throwing). On the base the first of these fails, before any copy is made. The copy (`copyCheckout()` in
`helpers.ts`) clones every top-level entry but `.git` and cargo's `target/` (`cp -cR` on macOS,
`cp -R --reflink=auto` elsewhere), so `node_modules`' relative workspace links resolve inside the copy, and the check
reads the copy's entry whether it reads the JSON or goes through `@deepbuild/contracts`.

## Open points

None of the first draft's remain: the entry, the facts section, the request path and the check are now named and
tested. Two readings above are this job's, and the issue could pin them: `<agent>` in the request path (the facts
file's name, as the corpus folders), and the check's line naming the facts' `agent` field (`claude`), as the issue says.

## Not tested

- **AC6's measurement.** Instructions retired and peak memory are the local preflight's perf lane
  (`scripts/benchmark.mjs`, on a reference Mac), comparing the change with the merge base. `ac6-budgets.test.ts` holds
  only what a checkout shows: the task, its command and its room. It **passes on the base by its nature** (the base
  compared with itself), so a twin (a `budgets.json` with `deep-mcp-30d`'s margin wider than 0.5, as #2897's
  `budgets-widened`) is what proves it in the before lane.
- `server/discover` staying an unknown method (Scope, "Not in this task"): no criterion names it.
- The `2025-11-25` change table's rows are not tested one by one; AC2 and AC3 assert what their criteria say.

## On the base

`BASE-FAILURE.txt` is the suite's run at `58b4a8cb2` (macOS 27.2.1 arm64, 1-minute load about 46): 16 fail, 1
passes, in a few seconds. Every failure is at an assertion, for the expected reason:

- AC1 (4): each server answers `1900-01-01` and `2026-07-28` as sent and no `protocolVersion` with `2025-06-18`,
  each line naming the server and the version.
- AC2 (4) and AC3 (4): each server "holds no list of handshake revisions: initialize naming 1900-01-01 is answered
  "1900-01-01"", their precondition. A scratch copy of these two files with the precondition taken out (first draft,
  kept outside the checkout) passed all 8 at the base, so on the base these two criteria fail only for want of a list.
- AC4 (1): "the contract entry packages/contracts/schemas/mcp.handshake@1.json": it does not exist.
- AC5 (3): each facts file is `adapter.facts@8`, `adapter.facts@9.json` doesn't exist, there is no `mcpHandshake`
  section, and each covered version (3 for Claude Code, 4 for Codex) has 0 entries; the cut-back test finds no
  revision named in any entry, before copying anything.
- AC6 (1) passes (Not tested, above).

The suite's own checks were also run outside the checkout on planted right and wrong programs. For AC5, two scratch
copies of the clone got a minimal right implementation (the entry, `adapter.facts@9.json`, `mcpHandshake` entries,
request files, and a case in `scripts/corpus.mjs check` printing `<agent> <version> opens with <revision>, which
mcp.handshake@1 lacks`): all 3 AC5 tests passed; with the same case printing no revision, the cut-back test failed at
its assertion, 7 versions missing. From the first draft: a copy lacking `2025-11-25` fails naming its file; `$ref` and
`definitions` fail the keyword check, `items` as one schema and a property named `items` pass. Nothing ran on Linux.
