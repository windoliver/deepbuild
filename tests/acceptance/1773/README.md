# Acceptance tests for #1773: DeepBuild's own `deepbuild` server and tools, as two hub checks know `deep`

Written first, blind, by a job that never saw an implementation of #1773; none exists at the base (2a69a293). The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding).

## What was read

- Issue #1773 (`gh issue view 1773`): its two findings, Scope, the three criteria, Proof and References. The IDs are
  computed from its checkbox text.
- `AGENTS.md`; `docs/technical-design.md` as the brief points to it (the four invariants, Dogfooding).
- At the base, for surfaces and conventions only: `packages/hub/src/waits.ts` (`Waits.hook`, the skip at
  `before()`, `KIND_EXPECTED_MS.mcp` = 60 s, `ANNOUNCE_MS`, the lines), `packages/hub/src/server.ts` (how hooks reach
  the waits, the timer, `overran`, the ticker and FileChanged, the `line` op), `packages/hub/src/core.ts` (`overrun`
  and `line` record `call.overrun` and `session.reading`), `packages/hub/src/hookmap.ts` (a hook line's fields),
  `packages/hub/src/mcp-servers.ts` (`toolLists`, `listOf`), `packages/hub/src/setup.ts` (the `deepbuild` entry it
  writes into `~/.claude.json`: `{type: 'stdio', command: <node>, args: [<cli>, 'mcp']}`), the tests
  `packages/hub/test/waits.test.ts`, `waits-hub.test.ts`, `hub.ts` and `codex-hub.test.ts` (hook lines and payloads),
  the suites `1731`, `1338`, `364` and `85` (layout, README, BASE-FAILURE, own copies of hub helpers), and
  `scripts/proof-change.mjs` (`criterionId`).

## Criteria and files

Each `describe` title is the criterion's ID and its text. The ID is `#1773.` and the first 8 hex digits of SHA-256 of
the checkbox's text after `- [ ] `, trimmed, white space collapsed (`scripts/proof-change.mjs`'s `criterionId`).

| AC | ID | File | Tests | Base |
|---|---|---|---|---|
| AC1 | `#1773.3ccc73f7` | `waits.test.ts` | a Claude Code `mcp__deepbuild__deep_claim` past its expected time, beside its third-party twin | fails |
| AC2 | `#1773.6dc4e7a9` | `lists.test.ts` | `toolLists` with `deepbuild` as `deep setup` writes it, beside `forge` | fails |
| AC3 | `#1773.6bec8743` | `same.test.ts` | a Codex `mcp__deep__deep_claim` past its expected time, beside its twin; `toolLists` with a `deep` server | passes |

`helpers.ts` holds the world; `fixtures/server.mjs` is the fixture stdio MCP server; `BASE-FAILURE.txt` is the run at
the base.

## How each is shown

**AC1 (`waits.test.ts`), through a real hub** (`deep hub run` in a temp home) with Claude Code's hook lines written on
its socket as deep-hook writes them (no deep-hook process, no model). Two Claude Code sessions each start a turn and
start one MCP call at the same moment: ours, `mcp__deepbuild__deep_claim`, and the twin, the third-party
`mcp__forge__list_issues`. With no history an MCP call's expected time is a minute, so both run past it in real time
(about 63 s). Then each session's ticker is read with Claude Code's FileChanged hook, each call ends with PostToolUse,
and each tool is called again. The criterion's three parts, each read from what the hub records and replies:

- **never recorded as `call.overrun`**: the record holds no `call.overrun` event in our session;
- **never named in a "still waiting" reading**: none of our session's readings (`session_readings`) names the tool or
  its call ID, none says "still waiting", and the FileChanged and PostToolUse replies show no such line;
- **never added to the timing history**: its next PreToolUse is not announced. A history of a run over a minute makes
  the hub announce the next run ("waiting on `<tool>` · about 1 min expected", `ANNOUNCE_MS`), as the twin's is.

The twin gets the overrun, the still-waiting reading and the announcement in the same run, so the absence of each for
deep_claim is the program's doing and not the harness's. At the base, deep_claim gets all of them too.

**AC2 (`lists.test.ts`), `toolLists` called directly** (imported from `packages/hub/src/mcp-servers.ts`; the hub's
public entry doesn't export it, and suite 124 imports `tools.ts` the same way) with HOME set to a fixture home whose
`~/.claude.json` has, under `mcpServers`, `deepbuild` as `deep setup` writes it (`type: stdio`, `command` the running
Node, `args` `[<home>/deepbuild/packages/cli/dist/main.js, 'mcp']`) and `forge`, a third-party stdio server. Each
command is a copy of `fixtures/server.mjs`, a real stdio MCP server that answers `initialize` and `tools/list` and
leaves a mark beside itself when anything starts it. The test asks for: a list for `forge` alone, with its tools; the
`forge` mark (it was started); no `deepbuild` mark (it was never started).

**AC3 (`same.test.ts`)**: the same two shapes for the name `deep`. A Codex session's `mcp__deep__deep_claim` (Codex
hook lines, a rollout under `~/.codex/sessions`) past its expected time beside a Codex twin `mcp__forge__list_issues`:
no `call.overrun`, no reading naming it or its call, no overrun line and no announcement, while the twin has its
overrun reading and announcement. And `toolLists` with a `deep` server (`node <cli> mcp`) beside `forge`: `forge`
alone listed, `deep` never started. pi isn't driven; the hub's waits see Codex and pi tool names the same way.

## What these don't cover

- `deep-actions`, the second entry `deep setup` writes beside `deepbuild`, is left out of AC2's fixture: the issue
  names only `deepbuild`, so whether `toolLists` lists `deep-actions` isn't judged here.
- A hub restarted while our call runs: the restored waits (`core.ts`'s `waitsState`) read open calls and history from
  the record for every tool, `mcp__deep__` included, today. The issue's criteria don't name the restart path, and AC3
  ("as today") would fail at the base through it, so no test restarts the hub.
- Session binding (`hookmap.ts`, #1632 / #1739) is out of the issue's scope.

## Run them

Linux or macOS, Node 24.22.0 first on `PATH`:

```sh
npm ci                                           # once
npm run build --workspaces                       # the tests run packages/cli/dist/main.js (deep hub run)
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -p deep-hook
NO_COLOR=1 node node_modules/vitest/vitest.mjs run tests/acceptance/1773
node node_modules/typescript/bin/tsc -p tests/acceptance/1773/tsconfig.json
```

- **Time:** `waits.test.ts` and `same.test.ts` each wait a real minute (the MCP kind's expected time; the waits run on
  the hub's own clock, which `test.clock` doesn't step), so the suite takes about 70 s with files side by side.
- **Safety:** every folder is under `/tmp/dh1773-*`, removed after its file; each hub runs with `HOME` in its temp
  home and without the caller's `DEEP_*`, `CLAUDE*`, `CODEX*` and `NODE_OPTIONS`; `toolLists` runs with `HOME` set to
  its fixture home and put back after; every process is one the suite started, stopped by its PID (the fixture
  servers by `toolLists` itself). Nothing listens on a port, nothing leaves the machine, and no model is called.
