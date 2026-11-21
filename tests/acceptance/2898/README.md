# Acceptance tests for #2898: every MCP tool lists a title and its four hints

Written first, blind, at base `6a2b68d44` (origin/main) by a job that saw only issue #2898 (body, Scope, the drafted
table, eight checkbox criteria, Proof; no comments), `docs/technical-design.md` (Dogfooding; How we know version 0
works), `AGENTS.md` and the repo at that commit. No implementation of #2898 existed and none was read. The implementer
doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

Read at the base, for surfaces only: `packages/hub/src/tools.ts` (`toolList`, `actionToolList`), `packages/hub/src/mcp.ts`
(`deep mcp`, `deep mcp actions`), `packages/hub/tools.json`, `scripts/skill.mjs`, `scripts/actions-server.mjs`,
`crates/deep-hook/src/actions.rs`, `packages/reading/src/tools.mts` and `index.ts` (the reading job's socket),
`packages/hub/src/{mcp-operations,stop-judging,hub-shared,hub-canvas,jobs,libraries}.ts` (what records what; the stop
rule's `READS`), `adapters/*.facts.json`, `benchmarks/budgets.json`, `scripts/proof-runs.mjs` (twins), and the suites
reused below.

## Run

```sh
npm ci && npm run build --workspaces          # the CLI (deep mcp, deep mcp actions) and packages/reading/dist/tools.mjs
cargo build -p deep-hook --bin deep-show      # deep-hook mcp actions; the hub's canvas core (the fixture's document)
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/2898 --no-file-parallelism --testTimeout=900000
node node_modules/typescript/bin/tsc -p tests/acceptance/2898/tsconfig.json
```

Each file starts real hubs (`deep hub run`) under `/tmp/dh806-*` / `/tmp/dh26-*` (and #1922's and #1731's worlds under
their own folders), with `HOME` there, and stops what it started by PID. The files start hubs, sandboxed plug-ins and
jobs, and hold `deep_wait` calls of 40 s, so they run one at a time: the implementer adds `tests/acceptance/2898/` to
`alone` in `scripts/lanes.mjs` (not done here: this job writes tests only). No test is timed. Nothing leaves 127.0.0.1.
After a change, rebuild what the servers run: the workspaces, `crates/deep-hook/src/actions.json`
(`scripts/actions-server.mjs`) and `deep-hook`.

## Surfaces

- **The four servers**, each spoken to over its stdio by raw JSON-RPC lines (`helpers.ts` `Raw`, `SERVERS`): `deep
  mcp`; `deep mcp actions` in both its forms, `node packages/cli/dist/main.js mcp actions` and `deep-hook mcp actions`
  (the newer of `target/{release,debug}/deep-hook`); and the reading tools as a reading job runs them, `node
  packages/reading/dist/tools.mjs <socket>`, built from `packages/reading/src/tools.mts`. 16 + 2 + 2 + 2 = 22 tools.
- **The fixture hub**: #806's hub and world file (a document on the main panel), sessions bound by their hooks through
  #806's agent stand-ins, whose MCP server is their child; each session has an open ask seeded before the hub starts
  (#26's seed); before any call is judged the first session draws #1725's red box (a revision) and makes a claim.
- **The reading job's socket**: a reading job serves it from `packages/reading` through `serve`, which isn't exported;
  here it is served the same way (`POST /call`, read and find) from the package's public `openSlicer` on the hub's root.
- **The record**: `events.read` on the hub's socket as the cli role. "No new ask, claim, open item, revision, job,
  evidence or proposal, and no process started" is read as no new event of the kinds in `helpers.ts` `NAMED`:
  `ask.created`, `claim.made`, `open_item.opened`, `doc.patched`, `job.*`/`run.started`, `evidence.stored`/`put`,
  `learn.proposed`/`plan.proposed`/`suggestion.filed`, `process.starting`/`tracked` (how #1922 counts processes), and
  `action.entered`/`reported`. Calls are made one at a time, so each event is the call's.
- **A turn** (AC6): Claude Code's transcript entry for a typed prompt (`origin.kind: human`, `promptSource: typed`),
  UserPromptSubmit, PreToolUse, the call on the session's own `deep mcp`, PostToolUse, Stop; the hub's `agent.stop`
  `data.claim` says whether the turn was an answer (`false`) or not.
- **The generated table**: `scripts/skill.mjs` run in a scratch copy of `scripts/`, `docs/`, `skills/`,
  `packages/hub` and `craft.json`, with every file of `packages/hub`'s own (but `package.json`) removed first: the
  files it writes there besides `tools.json` are the table.

## Criteria, tests and wrong programs

IDs are `criterionId` of each checkbox's text (`scripts/proof-change.mjs`). Each test fails on the base at an assertion
(`BASE-FAILURE.txt`), except AC7's, which the base passes by definition and whose wrong program is a twin.

| ID | Criterion (short) | Test | Wrong program |
|---|---|---|---|
| `#2898.a28b2035` | four servers list annotations, 22 entries | `listed.test.ts` | the base: no tool has annotations; fails naming each server and its first tool |
| `#2898.195c199f` | listing = generated table; both actions forms same bytes; planted tools.ts | `table.test.ts` | the base (no hint matches the table; skill.mjs writes nothing beside tools.json); the planted tools.ts, built by the test: the change's `deep mcp` with `deep_status` listed `destructiveHint: true`; the drift check must list exactly that tool and hint |
| `#2898.dee08b24` | read-only tools change nothing; planted deep_query; planted table | `reads.test.ts` | the base (nothing listed read-only); a planted `deep_query` (the change's `deep mcp`, each `deep_query` also sending `deep_open_item`) must fail naming `deep_query` and `open_item.opened`; a planted table listing `deep_kinds` read-only (#1731's library world, the change's `deep mcp` with that hint) must fail on `deep_kinds`' `fetch`, naming the asset's id |
| `#2898.4e085daf` | idempotent tools called twice add nothing; planted deep_job | `repeats.test.ts` | the base (nothing listed idempotent); the planted `deep_job`: #1922's job world on the hub plant `job-second-call`, which runs the tool again for a second call while the first runs; must fail naming the job (kind, tool, input) with its `process.starting` |
| `#2898.f7f325a2` | reads sent together during a held deep_wait answer as alone; planted mixer | `together.test.ts` | the base (the three aren't listed read-only, so no client sends them side by side); the planted server swapping the replies of `deep_status` and `deep_search` must fail naming both request IDs |
| `#2898.927923eb` | planted server listing deep_show read-only changes nothing the hub holds | `ownkind.test.ts` | the base (deep mcp states no `readOnlyHint` for `deep_show`, so there is no hint to plant against); a hub that reads its own hint reads the deep_show turn as an answer, and the test fails naming the call (`toolu_…`) |
| `#2898.c0392358` | names, descriptions, schemas byte-equal to the base's | `bytes.test.ts` | `twins/description-reworded` (`twins.json`): `packages/hub/tools.json` with `deep_status`'s description reworded |
| `#2898.cc2bc99a` | budgets: `deep-mcp-30d` no worse than the base | none | proven by the local preflight's budget lane on a reference Mac (`benchmarks/budgets.json`'s existing `deep-mcp-30d` task against the merge base), not by a test this job wrote |

## How the plants work

`fixtures/plant.mjs` is loaded into a real `deep mcp` with `node --import`, chosen by `PLANT_2898` (JSON). It changes
only what the server writes to its client (`hint`: one tool's hint in `tools/list`; `mix`: two waiting replies go out
swapped, a lone one after 1.5 s unchanged) or adds one line to what it reads (`records`: each call of a tool also sends
a `deep_open_item` call whose reply is swallowed). So each plant is the change's own server with one wrong thing in it,
whatever way the change builds its listing. The planted `deep_job` is the hub's own plant `job-second-call`. The
twin is the before lane's: laid over the change, it replaces `packages/hub/tools.json`.

## The merge base's bytes

`fixtures/base.json` holds, from the base: each server's tools as `tools/list` gave them (name, description, input
schema), and the kind the hub gave each of its own tools (`mcp__deep__*`, `mcp__deep-actions__*`) in a PreToolUse's
`tool.before` (`deep_query` `read`, from the facts; every other `mcp`). `capture.test.ts` wrote it and runs only with
`CAPTURE_2898=1` on a checkout of the base; it carries no tag.

## Forms

"Every form its schema takes" (AC3): one call per value of the field that picks a form (`deep_query`'s `what`,
null included; `deep_kinds`' `op`), and for the others the optional fields that change what is read (`deep_search`
with and without `file`; `read`/`find` with and without `slice`; `find_actions` with `query` null and set). A selector
value the schema lists and `helpers.ts` `forms` doesn't is a failure. AC4 calls each idempotent tool's first form;
`call_action` on #1879's hello plug-in's read action, each call stamped by its PreToolUse; `deep_job` on #1922's kind.
"Called twice" is: two calls with the same input, the second sent while the first is pending (the retry of a pending
call the issue names), then once more after both answered. "Adds nothing the first didn't": the pair adds no more of
any named kind than one call alone with a fresh input of the same shape adds, and the third adds none.

## Open points not guessed

- Each tool's `title` wording: only that it is a non-empty string of at most 40 characters.
- The generated table's file name and shape: only that `scripts/skill.mjs` writes it beside `packages/hub/tools.json`
  and that the checkout holds it as generated. "The listing equals the generated table" is held through the issue's
  drafted table, which the issue states is the final one.
- Where the hints live in code: the plants act on what a server writes, not on `tools.ts`.
- Whether the change records reads at all: only the kinds the criteria name are read.
- The reading job's socket: served from `openSlicer`, not from the unexported `serve`.
- AC6's "a hub that reads its own hint": that plant is the implementer's code path and isn't built here; the test's
  assertion on the deep_show turn is what it fails.
- AC8 has no test here (the budget lane judges it), so a PR that closes the issue needs that lane's PASS.

## Checked beyond the base run

No sample implementation was written. To check that each test's later steps work once the first assertion holds,
copies of `reads`, `repeats`, `together` and `ownkind` with their listing preconditions removed (the tools taken from
the table instead of the listing) were run on the base and deleted: all four passed, so on the base's servers every
read-only form leaves the record as it was, each idempotent pair adds nothing (`call_action` on the hello action,
`deep_job` joining its running job), the three reads answer as alone during a held `deep_wait`, the deep_query-only
turn is an answer and the deep_show turn is not, the kinds equal `fixtures/base.json`; and each plant failed as the
criterion says (`open_item.opened` named for the planted `deep_query`, the asset's id for the planted table's `fetch`,
`process.starting` for `job-second-call`, both request IDs for the mixer). `bytes.test.ts` was run with the twin's
`tools.json` laid in place and failed naming `deep_status`'s description; the checkout was restored.
