# Acceptance tests for #884: deep_search finds words in any script

Written first, blind, from issue #884 (its text as of October 31, 2026: the problem statement, Scope, the 3
acceptance criteria, Proof and Depends on), `docs/technical-design.md` (Reading by reference; the MCP tools row of
the Extension API; the `wiki` row of the first-party extensions, which names the default index: SQLite FTS5 in the
ledger database, registered with `deep.registerIndex`) and the base commit `0f7fb686` (`origin/main`), through the
acceptance suites of #26 (`deep mcp`, `deep_search`, the hub and its seams) and #355 (the wiki's writer and how its
claims reach the default index). No search code was read. The implementing agent doesn't edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft by this job.

## Run

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # the tests run the built CLI: deep hub run, deep mcp
npx vitest run tests/acceptance/884      # from the checkout's root, on Node 24.22 or newer
npx tsc -p tests/acceptance/884          # type-check the tests
```

The suite imports the helpers of tests/acceptance/26 and tests/acceptance/355 rather than copying them, so it runs
the way they do: folders under `/tmp/dh355-*`, `HOME` a temp folder for the test and every child (the real
`~/.deepbuild` is never touched), no network, and processes stopped by PID only (26's `cleanup`), never by name or
port. It starts one real hub, so the implementer adds `tests/acceptance/884/` to the unit lane's one-at-a-time list
in `scripts/lanes.mjs` as #26's and #355's suites are (not done here: this job writes tests only).

## The surface

Only **`deep_search`**, called as an MCP client calls it on a **`deep mcp`** started by hand in a folder no session
works in, so the call is bound to no session (#26 criterion 15, #355's reading). Its value is #26's: `hits: [{source,
quote}]`, a wiki hit cited `wiki:<page>#<claim>`, a past decision `decision:<id>`.

### The fixture

One record, written into the hub's own home while no hub runs, then the hub (`deep hub run`) is started on it with no
seams set:

- **Wiki claims, through the shipped default index.** The shipped wiki (`openWiki` of `@deepbuild/wiki`, as #355's
  suite drives it) learns three claims at scope `all`, each resting on a decision of yours whose answer holds its
  text, each on a page of its own:
  - `wiki:notes/cache#zh1` "提示缓存失效时重新计费"
  - `wiki:notes/cache-billing#zh2` "提示缓存失效时重新计费 billing applies"
  - `wiki:notes/billing#en1` "Nightly billing applies to every invoice"

  The hub reads them from the ledger into its default index; no `DEEP_HUB_TEST_INDEX` fill stands in for it, so the
  bug is tested on the shipped path.
- **Past decisions.** A session of the repo `shop`, and three choice asks each with a decision saved from it
  (`ask.created` and `decision.created` appended through `@deepbuild/record`, as #26's `seedMonth` appends them),
  found by their questions: "Keep the größe column in the orders table?", "Keep the grosse column in the invoices
  table?", "Rename the Café screen to Lounge?".

## Criteria, tests and wrong programs

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed and the leading
`- [ ] ` dropped (the command in `tests/acceptance/48/README.md`).

| # | ID | Test | Wrong programs it fails on | On the base |
|---|---|---|---|---|
| 1 | `#884.2b9cea3f` | "缓存" finds `zh1` and `zh2` and not `en1`; "缓存 billing" finds `zh2` and neither `zh1` nor `en1`. Twin first: "billing" finds `zh2` and `en1`, so the claims are in the index | the base's a-to-z word rule (finds nothing for "缓存"); a fix that keeps Han text one word, as FTS5's default tokenizer does, so a word inside it isn't found; a mixed query that silently drops "缓存" (returns `en1`); a mixed query that needs any word, not every one (returns `zh1`) | FAIL: "缓存" finds nothing |
| 2 | `#884.3f957841` | "Größe" finds the größe decision and not the grosse one, and no hit holds "grosse"; twin: "column" finds both | a fix that folds accents or transliterates (ß to ss, NFKD with marks stripped), which finds the grosse decision; a case-sensitive match on a Unicode word rule; a word rule that splits at ß or ö only on one side | PASS: the base cuts both "Größe" and "größe" to "gr", "e", so they match by accident; regression protection for the fix |
| 2 | `#884.3f957841` | "café" finds the Café decision; twin: "Lounge" finds it | a case-sensitive match; a query decomposed (NFD) and stripped of its marks but the text not, or the other way round, so "cafe" and "café" differ | PASS: the base cuts both to "caf"; regression protection |
| 3 | `#884.9b8cbcf7` | `?! … — ,.;:() 「」` returns no hits over a record full of them, and the reply says it had no words to search for | the base, which returns `{"hits":[],"more":0}` silently; a program that treats no words as matching everything | FAIL: no hits, and nothing says why |

The Proof's "on this branch and on the merge base" is this suite run on both; `BASE-FAILURE.txt` holds the base run.
No implementation was run: the passing side of criteria 1 and 3 is unverified until one exists.

## Readings where the issue leaves a choice

- **"No words to search for" (criterion 3).** The issue names no field. Invented here: the reply (its value or any
  text block, as `JSON.stringify(result)`) matches `/\bno\b(\s+\S+){0,2}\s+words?\b/i` ("no words", "no searchable
  words", "had no words it could search for"), and `hits` is absent or empty. The reply may be a value or a tool
  error (`isError: true`); a JSON-RPC protocol error fails.
- **"Returns it only if the page also holds billing" (criterion 1)** is read with both twins: a page holding "缓存"
  but not "billing" (`zh1`) and a page holding "billing" but not "缓存" (`en1`) are both left out, since every word
  of a query must be in a hit (the issue: in a mixed query the Han letters must not vanish).
- **A page is a claim's page.** Each fixture page holds one claim, so a hit's `wiki:<page>#<claim>` names the page.
- **The decisions** are found by their asks' questions, as #26 criterion 3 finds them; their answers are option IDs.
- **Who searches.** A call bound to no session reads wiki claims at scope `all` and past decisions (#26 criterion 15),
  which is all the fixture holds; a bound session's search isn't tested here.

## Files

- `search.test.ts`: the fixture and the four tests.
- `tsconfig.json`: type-checks the suite under the root's strict options with `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the base run.
