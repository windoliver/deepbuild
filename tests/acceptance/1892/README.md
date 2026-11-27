# Acceptance tests for #1892

"A new agent adds no line to runner.ts: each agent's stream parser sits behind AgentParts."

Written first, by the blind job, from the issue's body (no comments), `AGENTS.md`, `docs/technical-design.md`
(What each agent gives us, and the limits we design around; Dogfooding; Failing on an assertion) and the base commit
8e3278862. Of the base: `packages/runner/src/{agents,runner,types,index}.ts`, `packages/runner/test/`,
`reports/package-deep-audit.md`, `tests/agent-name-branches.test.mjs`, `adapters/{claude-code,codex,pi}.facts.json`,
`packages/adapters/src/facts.ts`, `tests/acceptance/159/` (house format), and `scripts/proof-runs.mjs`
(`atAssertion`). No pull request, branch or other worktree was read.

## Criteria

| AC | ID | File | On the base |
| --- | --- | --- | --- |
| AC1: `runner.ts` compares against no agent name (count to 0) | `#1892.4c7de5fe` | `names.test.ts` (1 test) | fails at its assertion |
| AC2: a test agent registered in a test, with parts of its own, runs a job to a recorded result with no edit to `runner.ts` | `#1892.3bee48f8` | `test-agent.test.ts` (3 tests) | each fails at its assertion |
| AC3: no visible change | `#1892.6f3b1f79` | `shipped.test.ts` (14 tests) | passes; proven by a planted twin, and in part by hand (below) |

`helpers.ts` holds the world: the real record on SQLite, the real asks core, budget ledger and supervisor (platform
sandbox included), and the runner opened through its entry's `openRunner`. The one stand-in is the agent's binary, a
shell script that answers `--version` and prints a fixed stream: a boundary the repo doesn't own. No hub, no port
of a test's own, no real agent, no model call, no Rust binary. The folder needs no `lane.json`.

## How to run

```sh
export PATH="$(ls -d $HOME/.nvm/versions/node/v24* | tail -1)/bin:$PATH"
npm ci && npm run build --workspaces        # once per checkout
npx vitest run tests/acceptance/1892
```

`BASE-FAILURE.txt` is that run on the base.

## What the base holds

The issue read its sites at 6a6d6b4f and counted three comparisons. The base has four lines that name an agent in
`packages/runner/src/runner.ts`, all equalities:

- `:541` `agent === 'claude-code'`: an eval's read gives a Claude Code job a config folder of its own;
- `:963` `agent === 'claude-code'`: `CLAUDE_CONFIG_DIR` is let through to its job's environment;
- `:1069` `job.spec.agent === 'codex'`: picks Codex's parser;
- `:1136` `job.spec.agent === 'pi'`: picks pi's parser, Claude Code's being what is left.

The criterion's end state is none, so AC1 counts all four. The first two are launch policy, not stream parsing:
they belong behind `AgentParts` too, as "Launch policy already moved behind `AgentParts`" says of the rest.

## AC1: the count

`names.test.ts` reads `runner.ts` as `tests/agent-name-branches.test.mjs` reads the hub (#1689): line by line,
comment lines left out, over the same names (`claude-code`, `claude`, `codex`, `pi`, `paseo`, `cursor`, `opencode`,
`grok`) plus every name `AGENTS` holds. It counts a name written as a quoted literal, since any comparison against
a name is written with one: an equality, a `case`, an `includes`, a table keyed by name. So a `switch` on the name
does not pass where an `===` fails. At the base the two rules give the same four lines. It expects none.

## AC2: the test agent, and the shapes chosen

The issue leaves two shapes open. Each choice is the smallest that the issue, the audit and the base allow, and the
tests lean on as little of it as they can.

**Registration: an entry assigned into `AGENTS`, the table `packages/runner/src/agents.ts` already exports.**
`AGENTS.pi = { … }` in that file is how pi's parts are registered at the base, and the runner looks every agent's
parts up there (`AGENTS[spec.agent]`). So a test registers its agent with `AGENTS['its-name'] = parts` and removes
it after. That needs no new export from the runner's entry (the issue's scope) and no new function at all. The
tests import `AGENTS` and the `AgentParts` type from `packages/runner/src/agents.ts`, the file the issue names, and
`openRunner` from the entry. `Agent` stays the closed type it is: the tests cast their names.

**The stream parser: a member of `AgentParts` named `stream`, called by the runner once for each line of a job's
stdout that parses as a JSON object, with that object among its arguments.** The name is the audit's ("Runner
stream parsers behind `AgentParts.stream`", `reports/package-deep-audit.md`). The line as a parsed object is what
all three parsers take at the base (`codexEvent(job, e)`, `piEvent(job, e)`, `event(job, e)`), after `read` has
split the output and dropped what is no JSON object; keeping that split in the runner is what "calls it and holds
no parser of its own" leaves there. The tests fix nothing else: not the order or number of the arguments, not what
carries the job's reading, not the return value. An implementer is free in all of that.

The three tests, by how much of the shape each needs:

1. *Codex's parts under another name* and 2. *pi's parts under another name*: `AGENTS[name] = { ...AGENTS.codex }`
   (or `.pi`), a stand-in `codex` (or `pi`) binary printing that agent's stream, and the record must read as that
   agent's would. They need only that the parser is a member of the parts, whatever it is called. At the base the
   runner picks a parser by name, takes the unknown name for Claude Code, reads nothing, and the job ends
   `stopped` / `agent_crashed` with no result.
3. *Parts and a parser of its own*: an agent whose binary prints lines no shipped parser reads (`{"agent1892":
   "hello", …}`), with parts written in the test (no sign-in, no account, no window, no MCP flags) and its own
   `stream`. So that it depends on nothing but the member's name and the line it is handed, its parser says what
   each of its lines means in Codex's words and hands that on to `AGENTS.codex.stream`, every other argument passed
   through untouched and the return value returned. It needs the name `stream` and the parsed line among the
   arguments.

A test agent's facts are a shipped file (`codex.facts.json`, `pi.facts.json`): `readFacts` reads only names in the
repo's `adapters/` folder, and this job writes only this folder. That is why the stand-in binary is named `codex`
or `pi` and answers a version those facts cover. If the change lets a test agent bring facts of its own, these
tests don't mind.

If the implementer finds a different member name or line form is right, test 3 is the one to dispute; it goes to
this job's blind redraft, never to an edit here (AGENTS.md, Proof).

## AC3: no visible change

`shipped.test.ts` pins what a job's stream decides in its record, for each agent `AGENTS` ships parts for: Claude
Code (6 streams), Codex (3 tests, 4 streams), pi (4 streams). For each, a fixed stream through a real job must give
exactly the base's `state`, `result`, `session`, `model`, `usage`, `cost_usd`, stop cause, `refused` and `blocked`
in the job's record; the same in its `job.ended` event; and `runner.output(job)` equal to the bytes printed. The
streams cover each branch of each parser at the base: usage counted once per message, the synthetic message left
out, the model with the most output tokens, max turns, an API error by the facts' mapping, permission denials, a
crash with no result; Codex's cached tokens taken out of its input, a failed turn, a declined patch and a write the
sandbox stopped; pi's cost and usage per message, a retried error, an error's cause by the facts' words, the output
limit; and lines that are no JSON object. One more test pins the entry's exports: `openRunner` and nothing new.

These tests pass on the base and cannot fail there. The before lane therefore needs a planted wrong program for
`#1892.6f3b1f79`: a twin laid over the change (for example a parser behind `AgentParts` that drops the cached
tokens, or reads the first model listed), named in `twins.json` with its files under `twins/`. **The implementer
adds `twins.json` and `twins/`; this job wrote neither**, since a twin is laid over files that do not exist yet. A
twin never replaces a file under the test paths.

By hand or by the affected run, not by a test here:

- "the suites that cover the touched files pass unchanged against the merge base": `packages/runner/test/`
  (and the acceptance suites that start runner jobs, such as `tests/acceptance/159/`, `1328/`, `2650/`) run from
  the change with their files byte-identical to the merge base's. Which suites those are depends on the files the
  change touches, and "unchanged" is a property of the diff (`git diff <merge base> -- packages/runner/test tests/`
  shows no edit to them), so it is the affected run's and the diff's to show.
- "each package's type-check passes": `tsc` over every package. A type-check is a build step over the whole
  workspace, not a behavior a test here can drive; the type-check lane or `npm run build --workspaces` shows it.

A pull request for #1892 says `Closes` only with those two shown; trace keeps a hand-checked part open otherwise.
