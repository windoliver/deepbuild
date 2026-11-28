# Acceptance tests for #2198: three refusals an agent reads say the right thing

Written first, blind, by a job that never saw an implementation of #2198; none existed. Written from the issue (its body,
Scope, the five acceptance criteria, What happens today and Proof; it has no comments), the design sections it links, and the
base commit `58b4a8cb2` ("Merge pull request #3070 …"). The implementing agent doesn't edit these files (AGENTS.md, Proof); a
dispute goes to a blind redraft of this job (design: Dogfooding).

## What was read

- The design (`node scripts/design-section.mjs --issue 2198`): in `docs/technical-design.md`, Socket roles and contract
  versions (one role per credential: a `deep mcp` bound to its session), and An ask, and your answer getting back (every ask
  ends: its deadline and default come from settings drafted at setup, `done.yaml`'s `asks:` block). Dogfooding, for the blind
  job's rules.
- At the base: `packages/hub/src/mcp-operations.ts` (`mcpCall`, `forAgent`, `askFor`, `claim`, `deepEnv`),
  `packages/hub/src/hub-shared.ts` (`asRefused`: every asks-core field refusal becomes code `type` at `/params/<field>`),
  `packages/hub/src/tools.ts` (the `deep_ask`, `deep_claim` and `deep_env` schemas; `commit` is "by its full SHA" with pattern
  `^[0-9a-f]{40}$`), `packages/asks/src/index.ts` (`settingsFor`, `fill`'s missing-deadline refusal with `field: 'deadline'`,
  `doneYamlAsks`'s unreadable-line refusal with `field: 'asks'`).
- The suites whose helpers this one imports unchanged: `tests/acceptance/26` (temporary home and worktree, `deep hub run`, the
  Claude Code agent stand-in whose hooks and `deep mcp` are its children, `agentWorld`, `callTool`, `claimArgs`, `events`,
  `cleanup` by PID), and `tests/acceptance/331/fixtures/server.mjs` (the dev server an environment block brings up, used by its
  path). `tests/acceptance/2896`, `806` and `331` were read for how a live hub, session binding and `deep_env` are driven.

## Run them

```sh
npm ci && npm run build --workspaces          # the hub, deep mcp and the CLI the tests run
cargo build -q -p deep-hook                   # the hook client the hub expects beside it
node node_modules/vitest/vitest.mjs run --root tests/acceptance/2198 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/2198/tsconfig.json
```

Every hub runs in a temporary home under `/tmp/dh26-*` (#26's `makeHome`, `HOME` there), with no `config.json`, so no ask
settings of yours: the dev hub the issue describes. The real `~/.deepbuild` and `~/.claude` are never touched. Every process is
stopped by its PID (#26's `cleanup`). Each test starts its own hub, so the files run one at a time; the implementer adds
`tests/acceptance/2198/` to the one-at-a-time list in `scripts/lanes.mjs` if the lane needs it. With `--root` here Vitest writes
`node_modules/.vite` in this folder; delete it before committing.

## Surface

Only what the issue's Proof names: a live hub (`deep hub run`), and a session's own `deep mcp` (`node packages/cli/dist/main.js
mcp`, the agent stand-in's child, so its calls bind to that session by its process), spoken to over stdio with `initialize` and
`tools/call` as an agent's MCP client would. A refusal is read as the tool result's value (`structuredContent`, else the text
block's JSON) with `isError: true`; the twins' success as `isError: false`. The ask's filing is read back from the record
(`events.read`).

## Readings

- **"Not under the call's arguments"** (AC1, AC2): the refusal's `path` is not `/params` or anything under it. The base's
  `/params/deadline` and `/params/asks` are under `/params`, where every argument of an `mcp.call` lives (`/params/arguments/…`),
  so an agent reads them as its own argument. Any other path, `""` included, passes.
- **"Its remediation says the person declares the deadline"** (AC1): the remediation mentions the deadline, and one of its
  sentences holds a word naming the person (`you`, `person`, `people`, `owner` or `human`, as a whole word) and a form of
  "declare". The base's "no deadline for taste asks is declared in your settings or the repo's done.yaml" fails it: it is
  passive and names nobody who declares ("your" is not "you"). Wording such as "You declare a deadline for taste asks in …" or
  "Only a person can declare asks.deadline.taste …" passes. Kept loose on purpose: the issue gives no wording.
- **"Names the file and line"** (AC2): the refusal, any of its fields, holds `done.yaml` and the number of the line that doesn't
  parse, as `line 8` or `done.yaml:8`.
- **"An asks block that doesn't parse"** (AC2): the fixture's `asks:` block has a deadline line whose flow map is never closed
  (`  deadline: { taste: 3d, authority: 1d, unblock: 2d`, line 8). No YAML reader takes it, and the asks core's reader refuses
  it naming that line. The issue says this case was read from the code, not run; here it is run.
- **"A hub with no deadline declared for taste asks"** (AC1): no `config.json` in the hub's home, and a done.yaml whose `asks:`
  block declares every other kind's deadline and every default, but no `taste` deadline.
- **"Is an error"** (AC3): the tool result's `isError` is `true` (never a JSON-RPC error).
- **"Holds 'by its full SHA'"** (AC4): the remediation contains that exact string. The commit is the worktree's own commit cut
  to seven characters.
- **The twins** (AC5): the taste ask, raised in a repo whose done.yaml declares `taste: 3d`, comes back with no error and an
  `ask:` handle, and the record holds its `ask.created` under the session; the stack, from an environment block running #331's
  dev server on a leased port `web`, comes back with no error and `status: "ready"` (and is taken down after); the claim at the
  worktree's 40-character commit comes back with no error and a `claim:` handle.

## Criteria

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed, the leading `- [ ] `
dropped (as `scripts/proof-change.mjs` `criterionId`). Each test's name starts with its tag.

| # | ID | Criterion | File | On the base |
|---|---|---|---|---|
| AC1 | `#2198.c3a8010e` | A missing setting isn't the agent's argument | `setting.test.ts` | FAIL: path `/params/deadline` |
| AC2 | `#2198.21ecccc1` | The same for asks settings that can't be read | `unreadable.test.ts` | FAIL: path `/params/asks` |
| AC3 | `#2198.4ded8bb8` | A blocked stack is an error | `stack.test.ts` | FAIL: `isError` false, `{"status":"BLOCKED",…}` |
| AC4 | `#2198.4047e008` | A form is said in words | `form.test.ts` | FAIL: "Give commit in the form ^[0-9a-f]{40}$." |
| AC5 | `#2198.2cf7dbf9` | A twin of each still passes | `twins.test.ts` (three tests) | PASS |

The base run is in `BASE-FAILURE.txt`, home paths shown as `~`. The issue's other proof, `packages/hub/test/codes.test.ts`
still passing, is that suite's own and is not repeated here.
