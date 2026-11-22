# #2897 AC6, blind redraft

## What was read

- The issue text of #2897 (its Scope, criteria and its description of #1105's one-line entries), AGENTS.md, and
  docs/technical-design.md's Dogfooding, Criteria to tests and Wrong programs sections and those the issue links.
- From the first suite, `tests/acceptance/2897/`: README.md's "Surfaces" section, `helpers.ts`, `world.ts`,
  `base-tools.json` and `twins/one-line-server.mjs.txt`. Not its `ac6-full-schema.test.ts`, nor anything else.
- At the base 6a2b68d44, by `git show`: `adapters/claude-code.facts.json`, and the tests `world.ts` imports
  (`tests/acceptance/1725`, `806`, `26`), unchanged from the base in this tree.

## The criterion

`#2897.8fdcb433`: "To a client whose facts say it loads by search, no tool is listed with an empty schema, and a
`deep_show` with valid arguments runs on its first call. A planted server that lists one-line entries to that client
fails, naming `schema_needed`".

## Reading "empty schema"

The issue names one source for an empty schema: #1105's Nov 8 amendment, which gives the canvas tools "one-line entries
with an empty schema, a `schema_needed` refusal and a `tools/list_changed`", so that the agent must fetch the schema
before a call can run. And it says what replaces it for this client: "A client that loads by search is listed the full
schema, so one search is enough". So an empty schema is a listed schema that withholds the arguments the tool takes.

The base's tools, read as they really are (`base-tools.json`): fifteen of deep's sixteen tools name their arguments
under `properties`. `deep_status` takes none, and lists `{"type":"object","properties":{},"required":[],
"additionalProperties":false}`: a full schema that says "no arguments", which the issue's own plan keeps (AC7 holds every
input schema to the base's bytes). A test that called every schema without properties "empty" would fail a correct
program on `deep_status`, so this test does not read it that way.

The reading drafted here: a listed schema is empty when it names none of the arguments the tool takes, and what a tool
takes is its full schema as its server lists it at the merge base. So:

- a tool missing an input schema, or with one that isn't an object, is empty;
- a tool whose base schema names arguments is empty when its listed schema names none (the one-line entry,
  `{ "type": "object" }`);
- a tool the base lists with no arguments (`deep_status`) is not empty for listing none;
- a tool the base doesn't list is empty when its schema neither names an argument nor closes itself
  (`additionalProperties: false`).

A partly cut schema (some arguments named, others dropped) is not "empty" by this reading; AC7 holds schemas to the
base's bytes.

## The test

`ac6-full-schema.test.ts`, two cases, both titled `AC6 #2897.8fdcb433 ...`:

One test, the file's only one tagged `AC6 #2897.8fdcb433` (the `describe` carries no tag). The plant is part of the
criterion's own text, so it is folded in as a precondition rather than a test of its own: a plant self-check alone
passes on the base as well as on the change, so it has no failing wrong program.

1. **Precondition, the plant.** The first suite's `twins/one-line-server.mjs.txt`, laid in a scratch folder with every
   `BASE_TOOLS` set to `base-tools.json`, is started over stdio, sent `initialize` as Claude Code and `tools/list`, then
   the same `deep_show` call as below. The check must name `schema_needed` and name deep_show listed with an empty
   schema, or the test fails there. A plant that dies or never answers ends in the first suite's `Mcp.request`
   `BLOCKED` error, naming why.
2. **The change.** Collects every failure, then asserts there are none:
   - `adapters/claude-code.facts.json` holds an entry that says Claude Code, at the newest version its facts list, loads
     an MCP server's tools by search (`searchEntry` of the first suite's helpers: an object whose `versions` holds the
     version, with a `source` naming where it was read, holding "search" as a value). That is "a client whose facts say
     it loads by search".
   - Each of the four servers (README Surfaces of the first suite), started fresh and sent `initialize` as Claude Code
     names itself, lists no tool with an empty schema; and so does the session's `deep mcp` bound to a real hub
     (`world.ts`'s `claudeWorld`).
   - That session's first `tools/call` is a `deep_show` of a red box (#1725's `redBox`) on the world's document, its
     arguments sent as deep_show's full schema at the base types them (#1725's `argsFor`), stamped as its agent stamps
     it. It runs: answered, not refused as a call (`isError`) nor as a document (`outcome: "refused"`). A refusal is
     named with its code.

## Wrong programs it fails on

- **The merge base 6a2b68d44**: its Claude Code facts hold no entry saying the client loads by search (checked by
  `git show`: the only objects with a `versions` list holding 2.1.308 are the root, with no `source`, and
  `contextOutput` and `ruleLoad.entries[0]`, holding no "search"). The test fails at its final assertion, naming the
  facts; the coordinator observed this with the base's facts file. Its lists and its `deep_show` are expected to pass.
- **#1105's one-line entries listed to Claude Code** (the plant): fifteen of deep's tools listed with an empty schema,
  and the first `deep_show` refused with `schema_needed`. The precondition proves the check names both.
- A server that lists full schemas but refuses the first `deep_show` until a schema is fetched: fails, naming the code.
- Facts that say Claude Code loads by search while the server still gives it one-line entries: fails on the listing.

## Open questions and what was assumed

1. **What "empty schema" means** (above). Assumed: names none of the arguments the tool takes, judged against the base's
   full schema; `deep_status`'s no-argument schema is not empty.
2. **The shape of the facts entry.** The issue says the facts say, per listed version, "whole at the start or by search"
   and that "each line names where it was read". Assumed the first suite's `searchEntry` shape (`versions`, `source`,
   a "search" value), shared surface rather than a new guess.
3. **Which client is "a client whose facts say it loads by search".** Assumed Claude Code at the newest version its facts
   list, as the first suite's `claudeClient()` names it; Codex's tool search is "Not read" in the issue.
4. **Which servers.** "No tool is listed" is read as every DeepBuild server's tools to that client: the four servers of
   the first suite's Surfaces, plus the hub-bound `deep mcp`. An unbuilt server is `BLOCKED`, never a pass.
5. **"Runs on its first call".** Assumed: the session's first `tools/call` is the `deep_show`, and it is neither an error
   result nor a refused document. Presenting the document is not required by this criterion.

## How to run

```sh
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:/usr/local/bin:/usr/sbin:/sbin:$HOME/.cargo/bin:/usr/bin:/bin
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/2897-redraft-ac6 --testTimeout=600000
```

Needs the build (`npm run build --workspaces`, `cargo build -p deep-hook`); an unbuilt server is `BLOCKED`.

## What was run

Once, with the command above, in this tree, whose dist, target and facts are the implementing work's, so it is not a
base run. Case 1 passed. Case 2 was `BLOCKED`: the plant was laid with `String.replace`, which replaced only the first
`BASE_TOOLS` (in the twin's header comment), so the server died reading `'BASE_TOOLS'`. Fixed to `replaceAll`. A
second run by the coordinator then crashed case 2 in `outcomeOf` with an undefined reply: the test read the first
suite's `Mcp.request` as answering `{ reply, ms }`, where it answers `{ raw, message }`. Fixed to pass `message`; a
planted server that dies or never answers now ends in that `request`'s `BLOCKED` error, naming why. Case 2 was then run
alone (`-t 'planted server'`, load 336) and passed: the check named `schema_needed` and deep_show's empty schema on the
plant. The coordinator then ran both cases on the base's facts: case 1 failed at its assertion naming the missing facts
entry, and case 2 passed there too, so it had no failing wrong program. The plant was folded into the one tagged test
as a precondition, and the whole file was run once more (load 279): 1 test, passed. I made no base run myself; the base's
failure stands on the coordinator's run and the facts above.
