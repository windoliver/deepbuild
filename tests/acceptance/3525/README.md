# Acceptance tests for #3525: the catalogue is listed as a read

Written first, blind, at base `b134dd38f` (origin/main) by a job that saw only issue #3525 (body, Scope, eight
criteria, Proof; no comments), `docs/technical-design.md` (the sections the issue links), `AGENTS.md` and the repo at
that commit. No implementation of #3525 existed and none was read. The implementer doesn't edit these files (AGENTS.md,
Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

Read at the base, for surfaces only: `packages/hub/src/tools.ts` (`SCHEMAS`, `check`, `toolList`),
`packages/hub/src/hub-canvas.ts` (`kinds`, `assets`), `packages/hub/src/libraries.ts` (fetch, authority ask, standing
rule, offline BLOCKED), `scripts/skill.mjs` (`HINTS`, `packages/hub/annotations.json`), `adapters/claude-code.facts.json`
(`mods.holdsWhen`), `benchmarks/budgets.json`, and the suites reused below (`26`, `806`, `1731`, `2897`, `2898`).

## Run

```sh
npm ci && npm run build --workspaces                                   # deep mcp, deep hub run (packages/cli/dist)
CARGO_INCREMENTAL=0 cargo build -p deep-hook                           # the hub won't start without it
CARGO_INCREMENTAL=0 cargo build --bin deep-show                        # the canvas core every deep_kinds lookup reaches
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/3525 --no-file-parallelism --testTimeout=900000
node node_modules/typescript/bin/tsc -p tests/acceptance/3525/tsconfig.json
```

Each file but `budgets.test.ts` starts real hubs (`deep hub run`) in temp homes (`/tmp/dh806-*`, `/tmp/dh26-*`,
`/tmp/dh1731-*`), with `HOME` there; #1731's files start its sandboxed test fill through the supervisor (in Claude Code,
a Bash tool with its sandbox off) and its library over HTTPS on `127.0.0.1` (needs `openssl`). Everything is stopped by
PID. Nothing leaves 127.0.0.1. No test is timed. `lane.json` runs the folder alone (`binary`: the hubs run deep-hook,
and the lookups deep-show, from `target/`).

## Surfaces

- **`deep mcp`** over its stdio by raw JSON-RPC lines (#2898's `Raw`; `helpers.ts` `deepMcp`), started by hand in a
  world's home; for AC6, the `deep mcp` that is a child of #806's Claude Code stand-in, bound to its session by hooks.
- **The fixture hub with a library source**: #1731's world (`onWorld`): a real hub, its fixture library "Shelf" over
  HTTPS under a test CA, its test fill `ext.shelf.library` installed and turned on, and the hub's socket as the cli
  role. The library serves #1731's catalog; the one model every test here fetches is `oak-chair` (CC-BY-4.0). "A library
  you haven't allowed" is a fresh world; "one you have" is a world with `library.rule` for it and the model's license.
- **The record**: `events.read` (cli role). "No new asset, ask, job, evidence or revision, no process started" is no
  new event of #2898's `NAMED` kinds (`ask.created`, `job.*`, `run.started`, `evidence.stored`/`put`, `doc.patched`,
  `process.starting`/`tracked`, and the rest of that list) nor of any `asset.*` / `library.*` kind.
- **The store**: every file under the hub's `evidence/` folder; and the hub's own asset list, `libraries.json`'s `assets`.
- **The generated table**: `packages/hub/annotations.json`, and #2898's `generatedBesideTools` (scripts/skill.mjs in a
  scratch copy: what it writes beside `tools.json` equals the checkout's).

## The new form

The issue drafts the fetch as "a job, run through `deep_job`", and says the fetch itself is what it is today. The call
these tests make is

```json
{"name": "deep_job", "arguments": {"op": "fetch", "library": "ext.shelf.library", "id": "oak-chair"}}
```

a form of `deep_job` (its `op` gains `fetch`) taking the base `deep_kinds` fetch's fields (`library` and `id`, or
`pack` and `asset`) and answering as it did: `{status: "held", ask}` while it waits on your answer, then `{status:
"fetched", asset: {sha256, ...}}`, `{status: "refused", reason}`, or a reply saying BLOCKED. Fields it doesn't need are
left out (a nullable field left out reads as null). AC4 requires only that the refusal's remediation names `deep_job`
and `fetch`.

## Criteria, tests and wrong programs

IDs are `criterionId` of each checkbox's text (`scripts/proof-change.mjs`); each test's title holds its ID. No test uses
subtests.

| ID | Criterion (short) | Test | Expected | Planted wrong program (for twins) | On the base (`BASE-FAILURE.txt`) |
|---|---|---|---|---|---|
| `#3525.2c40eb3b` | deep_kinds listed readOnlyHint, idempotentHint true = the table | `listed.test.ts` | deep_kinds lists readOnlyHint true, idempotentHint true, openWorldHint true, destructiveHint false; equal to `annotations.json`'s row, which equals what skill.mjs generates | the base itself (`HINTS` `'O'`) | fails: `deep mcp lists deep_kinds readOnlyHint false, not true` (and idempotentHint) |
| `#3525.aacef461` | every form changes nothing; planted deep_kinds still taking fetch | `lookups.test.ts` | each op the listed schema takes, called once (README: Forms), leaves no named event, store file or hub asset; list, word, read and field answer | `still-fetch` (`fixtures/plant.mjs`): the change's `deep mcp` listing deep_kinds' op with `fetch` and the base's fetch fields back, sending a deep_kinds fetch on as the new form; the check must fail on `op: fetch`, naming `oak-chair` | fails on `deep_kinds {"op":"fetch",...}`: it brought in `oak-chair` (evidence, store files, the hub's asset) |
| `#3525.743a5489` | new form: same hash, one ask / none, BLOCKED offline | `fetch.test.ts` | not allowed: `held`, exactly one authority ask naming `ext.shelf.library`; after your yes `fetched` with `sha256` = `fixtures/base.json`'s (`2beb0c37…`), stored, still one ask; under `library.rule`: `fetched`, same hash, no ask; library closed: BLOCKED, nothing stored | a form that fetches with no ask: the test runs the not-allowed judge on the ruled world's real no-ask fetch and it must fail naming the library. Twin to build: a hub whose `deep_job` fetch skips the authority ask | fails: `deep_job {op: fetch, library, id}` is refused `unlisted_field` at `/params/arguments/library` (deep_job's schema lists only op, kind, tool, params, inputs) instead of held |
| `#3525.f70e088e` | deep_kinds op fetch refused enum at /params/arguments/op, remediation names tool and form; planted empty listing | `refused.test.ts` | a tool error of error@2's shape, `code: enum`, `path: /params/arguments/op`, remediation naming `deep_job` and `fetch` (not "Give one of ..." nor a deep_kinds value); `op: "zzz"` is refused the same way; op no longer lists fetch | `empty`: the change's `deep mcp` answering the deep_kinds fetch with `{rows: []}`; must fail naming the call (`deep_kinds {...} (request <id>) was answered, not refused`) | fails: the call is answered (`held` on an authority ask), not refused |
| `#3525.db140e2e` | plan-mode stand-in: list, field, read, word all answer | `plan.test.ts` | the stand-in (holds any call whose tool isn't listed `readOnlyHint: true`, as the facts' `plan` case says) holds none of the four; each answers without error | the base itself | fails: all four held, the first named: `deep_kinds {"op":"list"}` |
| `#3525.92738dfb` | four lookups together during a held deep_wait answer as alone; planted mixer | `together.test.ts` | deep_kinds listed read-only; with `deep_wait` held on the session's open ask, list, field, read and word sent in one write each answer before the wait ends with the bytes each gave alone | `mix`: the change's `deep mcp` swapping the replies of two deep_kinds calls of different ops; must fail naming both request IDs | fails: deep_kinds isn't listed read-only (`readOnlyHint` false), so no client sends its lookups side by side |
| `#3525.c47e9430` | tokens: entry falls by the fetch fields' tokens, whole list no larger; planted copy-and-leave | `tokens.test.ts` | by o200k_base (gpt-tokenizer 4.0.0), the listed deep_kinds entry (JSON) at most the base's minus the tokens of the base's `library`, `id`, `pack`, `asset` properties; the sum over every tool no more than the base's | `leave`: the change's `deep mcp` listing the base's fetch fields back in deep_kinds (copied to their new place and left); must fail naming both counts | fails: the entry is the base's count, over its bound by the fields' tokens |
| `#3525.cc2bc99a` | budgets: deep-mcp-30d no worse than the base | `budgets.test.ts` | `benchmarks/budgets.json`'s `deep-mcp-30d` keeps the base's command, margin at most 0.5, no limit raised; the measurement is the local preflight's perf lane on the reference Mac | twin `budgets-widened`: a budgets.json whose deep-mcp-30d margin is 1 | passes on the base by definition (as #2897's AC8 test); the instruction and peak judgement is the preflight's, not run here |

## Forms

"Each form deep_kinds' schema takes" is one call per value of its listed `op` (the field that picks a form), with the
fields `helpers.ts` `FORMS` gives that value, kept to the fields the listed schema holds: `list`; `word` box; `search`
box; `read` guide start; `gallery`; `sheet`; `step_ceilings`; `field` mark.box@1; `closure` camera@1.projection;
`bindings` for a document the hub doesn't hold (its refusal changes nothing too); `assets` chair; and, where a schema
still lists it, `fetch` library ext.shelf.library id oak-chair. A value `FORMS` doesn't know is a failure, named.

## The record and the store

AC2's world is under your standing rule for the library's CC0 and CC-BY rows, so a fetch there brings the model in with
no ask, and the check can name what a fetch brought in. The search's thumbnails are fetched and kept once before the
calls, by the same `assets` call the forms make (#1731: a search keeps its rows' thumbnails by hash, fetched once; the issue keeps `assets` a lookup that reaches
the library), so "the store holds no new file" is read after that one search, and the `assets` call repeats it.

## The merge base's bytes

`fixtures/base.json` holds, from `b134dd38f`: `deep mcp`'s `tools/list` (16 tools) and the hash the base's `deep_kinds`
fetch gave `oak-chair` under a standing rule. `capture.test.ts` wrote it and runs only with `CAPTURE_3525=1` on a
checkout of the base; it carries no tag.

## Planted programs

`fixtures/plant.mjs` is loaded into a real `deep mcp` with `node --import`, chosen by `PLANT_3525` (JSON). It changes
only the lines between the server and its client (what it reads, through a wrap of `fs.read` on fd 0, which is how
`deep mcp` reads its stdin; what it writes, through `process.stdout.write`): `still-fetch` (tools/list gives deep_kinds' op `fetch` and the fields
back; a deep_kinds fetch is sent on as `deep_job {op: fetch, ...}`), `empty` (a deep_kinds fetch answered `{rows: []}`),
`mix` (two waiting deep_kinds replies of different ops go out swapped; a lone one after 1.5 s unchanged), `leave` (the
fields listed back in deep_kinds). So each plant is the change's own server with one wrong thing in it. Each plant was checked on the base with a
scratch test (since deleted): `empty` answered a deep_kinds fetch `{rows: []}`, `still-fetch` listed `fetch` and sent
the call on to deep_job (refused there, as the base's deep_job lists only op, kind, tool, params, inputs), `mix` swapped
two deep_kinds replies of different ops sent together, and `leave` listed the given field in deep_kinds. Twins not built
here: a hub whose deep_job fetch skips the authority ask (AC3), and `budgets-widened` (AC8).

## Open points not guessed

- The new form's name and fields beyond `op: "fetch"` with `library` and `id` (README: The new form). If the change
  puts the fetch elsewhere (a `deep_job` `run` of a fetch kind, say), AC3's call and AC4's remediation check are the
  points a blind redraft would revisit; the issue names only "a job, run through `deep_job`".
- Whether the hub records the lookups at all: only the kinds the criteria name are read.
- The Building blocks row's wording: no criterion reads it.
- AC8's instruction and peak judgement needs the reference Mac's preflight; the test here reads only the task's entry.

## Base run

`BASE-FAILURE.txt`: the run on `b134dd38f`, without `deep-show` built (disk; the lookups' answers are read only after
the assertion each criterion's base failure stops at), home paths redacted to `~`.
