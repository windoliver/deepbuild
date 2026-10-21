# AC6 blind redraft: every projection rebuilds from the catalogue's events

Test: `ac6-redraft.test.ts`, one `describe` ("AC6 every projection rebuilds from the catalogue's events") with
one `it` ("AC6 the record lists the issue's projections, each is a table, and after every catalogued kind's
fixtures each equals its rebuild").

## What I read

- Issue #14's body (`gh issue view 14 --repo windoliver/deepbuild`): Scope, Fields, Acceptance criteria, Proof,
  "Added Oct 9" and "Done when".
- `docs/technical-design.md` at base `b82d234`: "One event log, with tables built from it" (its schema and the
  projection columns, and the paragraph after them), "Evidence", "Privacy", the Event primitive, and the
  Dogfooding bullet.
- Base files: `packages/contracts/src/{index,catalogue,schemas}.ts`, the fixture and schema listings, and the
  `Evidence`/`openEvidenceStore` surface of `packages/evidence/src/index.ts`.
- `tests/acceptance/14/README.md` and `tests/acceptance/14/helpers.ts` (not edited).
- A throwaway probe (in my scratchpad, outside the repo) that printed the base catalogue: each entry's schema,
  kind, version, `x-feeds`, fixture count, the fixtures' writers, versions and whether they carry `seq`, and
  whether fixture IDs are unique.

Nothing under `packages/record`, no other branch, worktree or PR.

## What the base catalogue says, and how the test draws fixtures

- `catalogue()` has 65 entries, **one per event-kind schema, not one per kind**: `agent.stop` appears twice,
  as `agent.stop@1` (1 fixture, `v: 1`) and `agent.stop@2` (11 fixtures, `v: 2`). The helpers' `kindSchema(kind)`
  takes the first entry for a kind, so it would never reach `agent.stop@2`. The test therefore iterates the
  entries and draws `fixtures(entry.schema)`, keeping each fixture's own `v`, and asserts each fixture's
  `kind` and `v` match its entry.
- 14 published schemas are not in the catalogue (no `x-feeds`: `verdict@1`, `check@1`, `hook.*`, `adapter.*`,
  `access@1`, `error@1`, `guard@1`, `permission.answer@1`). They aren't event kinds, so they're not appended.
- **Every one of the 106 fixtures carries the same ID** (`01K74FKZVK8Q2X5R7M3N9P4T6W`), and most share `ts`
  and `seq`. Appending them as published would be one event plus 105 `conflict` refusals. So each fixture gets
  a fresh ULID from the test clock (one second apart), `ts` at that time, and a fresh `seq` where the fixture
  has one; its `v`, `kind`, `subject` and `data` are kept as published.
- Writers: each fixture goes through a connection whose writer is the fixture's own `writer` (which its schema
  allows), with its `actor` and `scope` (all `you`). `turn.usage@1` has fixtures from both `hook` and `core`;
  each goes through its own. Hook connections carry the session the hook fixtures name
  (`01K74G1Z3X5V7T9R1P3N5M7K9H`) and agent `claude-code`. The core-only kinds' fixtures are all `core`.
- The two evidence-store kinds: per the README ("Events the record must accept that the base doesn't
  publish"), `evidence.stored@1` and `evidence.removed@1` through a `core` connection, built with the helpers'
  `evidenceStored`/`evidenceRemoved` from `Evidence` records that the real `@deepbuild/evidence` store returned
  for two puts (one by DeepBuild, one by you). One file is recorded stored, the other stored then removed.
  If the implementer adds those two schemas to the catalogue as the README asks, their fixtures are appended by
  the catalogue loop too.

## Assertions, the sentence each comes from, and the wrong program each catches

| # | Assertion | Source sentence | Wrong program it catches |
|---|---|---|---|
| 1 | `PROJECTIONS` contains each of the 19 issue projections, each name once | Issue Scope: "Projections: sessions, commits, claims, checks, runs, verdicts, asks, decisions, leases … definitions … and attempts"; "More projections: tasks, open items, notices, readings, plans, dry merges, and each session's changed files"; "the `evidence` projection" (names per README) | A record that leaves a projection out |
| 2 | Every fixture of every catalogued schema (both `agent.stop` versions included) and both evidence kinds append, each `existing: false`; a refusal fails the test, naming schema, fixture index and writer | AC6: "Every projection rebuilds from the catalogue's events"; design: "Each event kind carries a schema version" | A record that refuses a published kind or version, such as one that validates `agent.stop` v1 against v2 or knows only a kind's latest version |
| 3 | The log (`read` paged by `log_pos`) holds exactly the appended IDs, in `log_pos` order | Issue: "The `events` table is the source of truth" | A record that acknowledges an append it doesn't keep |
| 4 | For every name in `PROJECTIONS`, `table(name)` answers that name, a non-empty primary key of column names, every row has each key column, and rows are strictly ascending by key in SQLite's order for stored values (NULL < numbers < text by UTF-8 bytes < blobs) | AC3 / design: "compared row by row in primary-key order with values as stored"; README: "`table` returns a projection as stored, rows in primary-key order" | A projection with no primary key, or one read back in insertion order or with duplicate keys |
| 5 | Each issue projection that some catalogued kind feeds (by `x-feeds`, plus `evidence.stored` → `evidence`) has rows | AC6 and the catalogue's `x-feeds` | A projection the record lists but never fills from the log (an empty table rebuilds to an empty table, so 7 alone would miss it) |
| 6 | `claims` has one row per appended `claim.made` ID; `asks` has one row per appended `ask.created` ID (6); `evidence` has the row of the hash recorded stored and not removed | README's table: claims `id` is "the `claim.made` event's ID", asks `id` is "the `ask.created` event's ID", evidence keyed by `hash`; issue: "the `evidence` projection (hash, kind, …) is built from them" | A projection that keys or merges rows by something other than its creating event, or ignores the evidence store's events |
| 7 | Clock advanced one day, `rebuild()`, every listed projection still passes 4, and `firstTableDifference(live, rebuilt)` is undefined (row by row, values as stored, named by table, row and column) | Issue: "Every other table is a projection the hub can rebuild by replaying it"; design: "A projection is a function of the events alone, in `log_pos` order. It reads no clock …" | A projection not rebuilt from the log (empty or different after rebuild), and one that reads the clock, such as a lease's stale state or an ask's default from `now()` |
| 8 | After `rebuild()` the log is the same `log_pos:id` list as before | Issue: "`events` table is the source of truth"; README: `rebuild` "drops every projection and replays the log" | A rebuild that appends, drops or renumbers events |

## What I left out, and why

- **Non-empty `commits`, `checks` and `attempts`.** No catalogued kind at base lists them in `x-feeds`, so no
  fixture is known to create a row there. The test still checks they are listed, are keyed tables in key order,
  and equal their rebuild.
- **Per-row values and counts beyond the README's keys** (for example how many `verdicts` or `leases` rows):
  the published fixtures share handles and keys (all `verdict.made` fixtures, all lease fixtures), so the count
  depends on readings the issue doesn't fix. The rebuild comparison covers their values.
- **That the removed hash leaves `evidence`.** That is AC28's criterion; here removal only has to replay the same.
- **Ordering fixtures so creators precede updaters.** Fixture subjects point at the fixtures' own handles, not
  at the fresh IDs, so no ordering would make them resolve; they are appended in catalogue order.
- **The README's `testStorage()`.** No crash or sync trace is needed; the record uses its default storage in a
  temp folder.
- **Kinds the catalogue doesn't have** beyond the two evidence kinds the README names.

## Discrepancy noted

The issue's Scope says the evidence store "appends `evidence.put`" and evidence.removed; the base catalogue
already publishes `evidence.put@1` (writer `app`, feeds `evidence`), while the README asks for
`evidence.stored@1` and `evidence.removed@1` from `core`. The test appends `evidence.put@1`'s fixture through
the catalogue loop and the README's two kinds as instructed, so it holds both readings.

## Type check

Against a declaration-only copy of the README's surface outside the repo, under the root `tsconfig.json`'s
strict options plus `allowImportingTsExtensions`/`noEmit`, the test file type-checks with no errors.

## Run on the base

Node v24.22.0, `npm ci`, then
`npx vitest run tests/acceptance/14/ac6-redraft.test.ts --reporter=json --outputFile=.vitest-ac6.json`
(exit 1). From the JSON: 1 failed suite, 0 tests collected.

```
tests/acceptance/14/ac6-redraft.test.ts  failed
Cannot find module '../../../packages/record/src/index.ts' imported from
  .../tests/acceptance/14/ac6-redraft.test.ts
```

The failing import is line 11 of `ac6-redraft.test.ts`
(`import { openRecord, PROJECTIONS } from '../../../packages/record/src/index.ts';`): the base has no
`packages/record`, which is the expected reason.
