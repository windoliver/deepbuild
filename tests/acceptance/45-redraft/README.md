# #45 Readings: blind redraft for two criteria

Written from the issue, `docs/technical-design.md` and the base commit 244a3455 only.

## Criteria, in full

- AC6: "A session started with `ANTHROPIC_API_KEY` set shows as billing an API key, and its tokens leave the plan windows unchanged"
- AC11: "`deep_search` returns readings, such as a task's spend, each with its source and as-of time"

Tested here, as this job was scoped: AC6's "shows as billing an API key", with the design's "as true or false and never a value" as "the key's value is stored nowhere" (Plan usage, Billing mode). AC6's plan windows are not tested here. AC11 for a task's spend, from a session's search through a real hub over MCP. Other readings are not tested here.

## Surfaces chosen

The issue and design leave these open. Each test asserts only what they state.

**AC6, where a session shows its billing: `deep status`.** The design names no surface for "says so". It gives "each session row" as where windows show, and `deep status` is the base's session row a person can read without the app. Any wording holding "API key" passes, on the row or on a deeper line under it. A session started without a key is the twin: its row must not claim one, though "no API key" is allowed. An implementation showing billing elsewhere only would fail this test, and that is a dispute for this job's redraft.

**AC6, what "stored nowhere" covers.** Every file under the test's folder (hub root, database and WAL, spool, transcripts, worktree), in the forms `tests/acceptance/26/helpers.ts` `forms()` lists, plus everything the hook, the hub and `deep status` printed.

**AC6, the hook's environment.** `CLAUDECODE=1` is set, as Claude Code sets it, and any other billing key inherited from the test process is removed, so only the named key differs between the two sessions.

**AC11, the query: `spend`.** The issue's word. The tool's one argument is `query`. The design doesn't name a query syntax.

**AC11, what the hit looks like.** No name or shape is stated for a reading's hit. The test finds the hit by the task's handle or its title anywhere in it. It looks for the amount as `0.75` in the hit's JSON, whatever the field or currency mark. The source is any non-empty string at a key `source`, at any depth; that key is the name in the base's `Hit`, the Building blocks row's word, and `reading.recorded@1`. The as-of time is at a key `as_of`, `as-of`, `as of` or `asOf`, at any depth, as ms or a date string; `reading.recorded@1` calls it `as_of`.

**AC11, the as-of value.** The design doesn't say whether it is the source's last entry or when the reading was computed. Either passes: not before the last usage counted, not after the call.

**AC11, how spend reaches a task.** The design says tokens are "summed per session, claim and issue", and doesn't define a task's sum when a session has several tasks. So the fixture's session has one task, asked for by its one `user.ask`, and all its usage comes after that. Another session's task spends 9 USD, which must not join the sum. Whether that other task shows in this session's search is not asserted.

**AC11, the seed.** `session.start@3`, `task.created@1`, `user.ask@1` and `turn.usage@1`, each checked with `validate` from `packages/contracts` before `record.append`. `turn.usage@1`'s subject takes only letters and digits, so the session's ID has no hyphens, where AC6's real-shaped UUIDs do. The reported cost is the schema's `basis: reported`. The hub starts after the seed, and the session resumes through hooks (`SessionStart` with `source: resume`, then `PreToolUse`), with no new prompt, so nothing it spends is left out of the fixture. Writers are `hook` for what hooks append, as the fixtures of `turn.usage@1` show, and `core` for the task.

## Running

```
npx vitest run --config vitest.config.ts tests/acceptance/45-redraft/
```

Needs `npm run build --workspaces` and `cargo build -p deep-hook`. Base output: `BASE-FAILURE.txt`.
