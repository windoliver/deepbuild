# Acceptance test for #62.190a469d: the learned layer rebuilt from its events equals the incremental projection

This test was written blind from issue #62 (the abridged scope plus one criterion, as the brief quoted them), `AGENTS.md`,
`docs/technical-design.md` (The learned layer, Dogfooding) and the sources at base commit `61aa8eb06`. The job did not
see PR #652, any diff or `git log`, any other issue, or the older suite `tests/acceptance/62/`. It is independent of
that suite. The implementing agent doesn't edit this file (AGENTS.md, Proof). A dispute goes to a blind redraft of this
job (design: Dogfooding).

| Criterion | ID | File (test) |
|---|---|---|
| The layer rebuilt from its events equals the incremental projection byte for byte | `#62.190a469d` | `rebuild.test.ts`: the only test, named `#62.190a469d the layer rebuilt from its events equals the incremental projection byte for byte` |

## What the test proves, and through which surface

It is a fast-check property with fixed seed `62190469` and 150 runs (about 40 to 100 s on a loaded Mac). Each run works
through `@deepbuild/record`'s public entry (`packages/record/src/index.ts`) over a real `@deepbuild/evidence` store, and
mocks nothing. Each run:

1. Opens a record with file storage. Starts two sessions: S1 in `shop`, whose archived transcript holds your words and
   a WebFetch result, and S2 in `blog`. It keeps one evidence file through `record.keep` (`ev:` handle).
2. Appends a generated sequence through `record.append` and `record.rollBack`, which are the paths the hub, the CLI and
   `deep_propose` use. The sequence draws from:
   - `learn.applied` and `learn.widened` from `app`, `cli` and `core`, each on a learned target (`slice:`, `wiki:` with
     a `deep:claim` line and links, `step:`, `playbook:`, `ext:`), a base target or an unknown one.
   - Base changes: a rule you typed (`rule:nopush`) and a `block` guard (`guard:nocurl`). The guard holds learned steps
     at load.
   - `learn.proposed` as `deep_propose` appends it (writer `mcp:<session>`, `applied_by: null`, citing an `ask:`).
   - Scopes `session:` / `repo:` / `all`, and `applied_by` set to `you`, the local-first rule, the install rule, a
     base rule or an unapproved one.
   - Evidence: quotes that are at their handle and quotes that aren't (session messages, outside content, the `ev:`
     file), `doc:` citations of earlier changes (good and bad quotes), and `supersedes` chains.
   - Rollbacks of one change (`rollBack {change}`) and of everything since a date, newest first (`rollBack {since}`),
     from writers that may roll back (`app`, `cli`, `core`). Also writers that may not: a `hook` through `rollBack`,
     which is refused before any append, and a hand-appended `learn.rolled_back` from `hook` or `ext:lint`, which the
     layer refuses. A hand-appended `core` rollback, including one aimed at the base, is in the mix too.
   - Clock steps of up to 3 days between appends.

   The core's reading of the store lands as `learn_check.made`.
3. Reads the layer as the appends built it. That covers every row and every column of `learned_layer`,
   `learned_cites`, `wiki_claims`, `wiki_sources`, `wiki_links` and `wiki_text` (the claims' FTS index), each read with
   SQLite's `quote()` so type and bytes are kept (NULL vs `''`, `1` vs `'1'`), columns in table order, rows in
   primary-key order. It also reads what agents read at session start, `startSlice(S1|S2)`, and what a session loads,
   `loadLearned(S1|S2)`.
4. Closes the record. Moves the clock 40 days on. Opens the record again with no evidence store, because the design
   says a rebuild needs no bytes. Runs `rebuild()` and reads the same things again.
5. Compares the two reads. The first difference names the table (or reader), the row by its key, the column, and both
   values, followed by the run's ops.

The property itself never throws. The difference is asserted with `expect(...).toBeUndefined()` in the test body,
which makes a wrong program fail at an assertion in this file. An error a run throws, such as the record or the store
failing to open or an append being refused, fails the test. It never passes.

**Nothing missing passes.** After the runs, the test asserts that all 150 ran and that the runs together produced each
of these:

- rows in states applied, refused, held, rolled_back and proposed, and flagged rows
- `learn.widened` rows
- `learn_check.made` events
- `doc:` citations (`learned_cites`)
- wiki claims, including at least one superseded claim
- `supersedes` links in force
- refused rollback rows, and changes rolled back by `since`
- hook rollbacks refused by `rollBack`

## Wrong programs it catches

Three planted programs were each run in a throwaway APFS clone of the checkout. Each failed at the `expect` on the
rebuild comparison, naming the table, row and column:

| Planted program | First difference reported |
|---|---|
| The projection reads the clock (`created: Date.now()` instead of the event's `ts`) | run 1: `learned_layer` row `id=…` column `created` |
| A judgement kept outside the log: the core's store refusal written straight into `learned_layer` instead of appended as `learn_check.made` | run 2: `learned_layer` row `id=…` column `state`: incremental `'refused'`, rebuilt `'applied'` |
| The judgement reads the log beyond the event's own position: a `doc:` citation counts as gone when any `learn.rolled_back` in `events` names it | run 4: `learned_layer` row `id=…` column `state`: incremental `'rolled_back'`, rebuilt `'refused'` |

It would also catch these, though they were not planted:

- a rebuild that skips a kind
- a different column order or a NULL written as `''`
- a citation or flag kept only in memory
- a wiki claim index that isn't rebuilt
- a start slice that the rebuilt tables change

## Where the surface was a guess

- **The tables the learned layer feeds.** Taken from `projections.ts`: `learned_layer`, `learned_cites`, and the wiki
  tables `wikiClaims` rewrites on `learn.*` and `learn_check.made`. `wiki_text` is internal (not in `PROJECTIONS`), so
  it is read with `raw` rather than `table`.
- **"What agents read at session start".** Read through the public `startSlice` and `loadLearned`, compared as JSON.
- **The proposal's shape.** Copied from `deep_propose` in `packages/hub/src/mcp-operations.ts`. The hub itself is not
  started.
- **"Byte for byte".** Read as every stored value through `quote()`. FTS rowids and SQLite page layout are not
  compared.
