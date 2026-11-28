# #3460 acceptance: a search that finds nothing says why

Written blind from the issue (#3460 as `gh issue view 3460` printed it on 2026-11-26: its report, Runs on, Scope, ten
checkbox criteria and Proof; its one comment changes nothing), the design (Reading by reference; First-party extensions
that ship on by default; The learned layer; Dogfooding), `AGENTS.md` and the base `b134dd38f` (origin/main). No
implementation was seen. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind
redraft of this job.

At the base I read, for their surfaces: `packages/hub/src/search.ts` (`search`, its word rule, `NO_WORDS`, the order
of a reply), `tools.ts` and `mcp-operations.ts` (`deep_search`, its binding and scopes), `reply-fit.ts` (a client's
cap), `packages/reading/src/slices.ts` and `index.ts` (`deep find`), `scripts/proof-change.mjs` (criterion IDs),
`scripts/proof-runs.mjs` (`twins.json`), `scripts/lanes-lists.mjs` and `scripts/alone-lint.mjs` (`lane.json`), and the
suites `26`, `355`, `884`, `1515`, `2896`, `3440` and `3481` for their helpers and conventions.

## Run

Node 24, the checkout built (`npm ci && npm run build --workspaces`) and deep-hook built (`cargo build -p deep-hook`:
the hub runs it from `target/`).

```sh
npx vitest run tests/acceptance/3460 --no-file-parallelism
npx tsc -p tests/acceptance/3460          # type-check the tests
```

About 70 s on the base. The suite imports the helpers of `tests/acceptance/26`, `355` and `1515` rather than copying
them, as #884's suite does, so it runs the way they do: folders under `/tmp/dh355-*`, `/tmp/dh26-*` and
`/tmp/dh1515-*`, `HOME` a temp folder for the test and every child (the real `~/.deepbuild` is never touched), no
network, no model, and processes stopped by PID only (26's `cleanup`), never by name or port. Five of the six files
start real hubs; `find.test.ts` starts none.

## Requirement, check, proof

IDs are `#3460.` and the first 8 hex digits of SHA-256 of each criterion's text, trimmed and whitespace collapsed, as
`scripts/proof-change.mjs` reads the issue. Every tagged test carries its ID in its title; none has subtests.

| Criterion | Test | Passes when | Wrong program | On the base |
|---|---|---|---|---|
| `#3460.67d53f5f` `api ports` over the one claim about ports: no hit, a note naming `ports` and not `api` | `note.test.ts` AC1 | "api port" finds `wiki:repos/api#port` (the twin query). "api ports" returns `hits: []` and `note` is exactly `No source this call may read holds these words: ports.` | the merge base | FAIL: no note; the message names the query |
| `#3460.74f4978c` `port redis`, each word held by its own claim: no hit, a note saying no one source holds every word, naming no word | `note.test.ts` AC2 | "port" and "redis" each find their claim. "port redis" returns `hits: []`, the note names neither word in its list, and is exactly `Each word is held by a source this call may read, but no one source holds them all.` | the merge base; twin `note-names-held-word` (fails naming the word and the claim that holds it) | FAIL: no note |
| `#3460.8dffa8bf` `ports` held only by a claim scoped to another session: a call bound to this session is told nothing holds `ports` | `scope.test.ts` | Session B's "api port" finds `wiki:repos/api#port`. Its "ports" returns `hits: []` and the note is exactly `No source this call may read holds these words: ports.` | the merge base; twin `note-counts-every-scope` (fails naming the claim) | FAIL: no note |
| `#3460.fd277010` 40 words no source holds: the note names the first 16 and says 24 were left unread, under the client's cap | `note.test.ts` AC4 | `hits: []`; the note's list is the query's first 16 words in order; the note is exactly the list's sentence followed by ` The search read the query's first 16 words and left 24 unread.`; the reply's `result`, as JSON, is at most 8,000 characters | the merge base | FAIL: no note |
| `#3460.c0d74b68` no word: today's note, word for word; hits: no note | `note.test.ts` AC5 | `?! … — ,.;:()` returns `hits: []` and the note `The query had no words to search for: a word is a run of letters or digits.`; "api port" and "redis" have hits and their replies have no `note` key | twin `note-beside-hits` | PASS |
| `#3460.deebb776` `deep find "port api"`: one sentence, exits as today, `--json` with empty `hits` and the note | `find.test.ts`, first | exit 0; stdout is exactly `Nothing in the record holds "port api" as one run of characters.` and a newline; with `--json`, stdout parses to exactly `{"hits":[],"note":"<that sentence>"}` | the merge base | FAIL: today's sentence |
| `#3460.deebb776` `deep find port` prints the merge base's bytes | `find.test.ts`, second | `deep find port` and `deep find port --json` print the base's bytes (three hits, below); `deep find ports` prints today's `Nothing in the record holds "ports".` | twin `find-sentence-for-one-word` | PASS |
| `#3460.7cd4a1ff` the reading | `reading.test.ts` | `node scripts/search-reading.mjs tests/acceptance/3460/fixtures/reading.json` exits 0; each trap query is named as not found under its search and form; stdout is exactly the lines below, built from the test's own asking of both searches; a second run prints the same bytes | the merge base (no reading); twin `reading-counts-any-hit` (fails naming the query) | FAIL: the script is missing |
| `#3460.6ad8cdef` 25 claims and one decision of yours holding `billing`: the decision is the first hit of the first page; the claims keep their order | `order.test.ts` | Over all pages the hits are the 25 claims and the decision, each once; the claims are in the order c01 to c25; the first page holds 20 hits, the decision first, then c01 to c19 | the merge base | FAIL: the decision is hit 26 of 26 |
| `#3460.e44187b3` every query of #26's, #884's and #1515's suites that finds a hit returns the merge base's set | `hits.test.ts`, three tests | Each suite's fixture is rebuilt and each query asked again, every page; each set equals the merge base's; a failure lists each query's hits gained and lost | twins `hits-hold-any-word` (#884's and #1515's tests) and `decisions-first-drops-own` (#26's) | PASS |
| `#3460.e5ebcbe5` budgets | none | | | not tested (below) |

`BASE-FAILURE.txt` has each test's result on the base. `twins.json` names the twins; `twins/README.md` says what each
breaks. The Proof's three (the first, third and eighth criteria failing on the merge base and passing after) are AC1,
`scope.test.ts` and `order.test.ts`.

## Surfaces

What exists at the base and is used as it is:

- **`deep_search`** through **`deep mcp`**: started by hand in a folder no session works in, so bound to no session
  (`note`, `order`, `reading`, `hits`), or the agent stand-in's own, bound to its session by its hooks (`scope`,
  `hits`). Its value: `hits: [{source, quote, …}]`, `more`, `next`, and `note`.
- **`deep find <query> [--json] --root <root>`**, the built CLI run by you with no hub running.
- The shipped wiki (`openWiki` of `@deepbuild/wiki`, as #355's and #884's suites drive it) and `@deepbuild/record`, to
  write the fixture into the hub's own ledger before the hub starts.

What the implementer builds, exactly. The tests pin these words; a change of wording is a blind redraft.

- **An empty `deep_search` reply's `note`**, when the query has words and the reply has no hit. The words are the
  query's, by the search's own word rule, in the query's order, as the search lowercases them; only the first 16 are
  read:
  - a word read that no source the call may read holds:
    `No source this call may read holds these words: <word>, <word>.` (each such word, joined by `, `; words that are
    held are not named);
  - every word read is held by some source the call may read:
    `Each word is held by a source this call may read, but no one source holds them all.`;
  - a query of more than 16 words: either sentence, then one space and
    `The search read the query's first 16 words and left <n> unread.`
  A query with no word keeps `The query had no words to search for: a word is a run of letters or digits.`, and a reply
  with hits has no `note` key.
- **`deep find`'s sentence** for a query of two or more words that finds nothing:
  `Nothing in the record holds <the query, as JSON.stringify writes it> as one run of characters.` on stdout, exit 0;
  with `--json`, `{"hits":[],"note":"<the same sentence>"}`. A one-word query that finds nothing prints today's
  sentence, and a query with hits prints today's bytes, with no `note`.
- **Your decisions first**: in a `deep_search` reply, each matching decision comes before the wiki's claims; the rest
  keeps today's order.
- **The reading**: `scripts/search-reading.mjs`, run as `node scripts/search-reading.mjs <fixture.json>` from the
  checkout's root, beside `scripts/hands-reading.mjs` and `scripts/drive-reading.mjs`. It takes a fixture of the shape
  of `fixtures/reading.json`: `claims: [{page, id, text}]` and `queries: [{form, query, claim}]`, `form` one of `words`,
  `form`, `question`, `claim` a handle `wiki:<page>#<id>`. In a temp home of its own, with no model and no network, it
  has the shipped wiki learn the claims at scope `all` (each resting on a decision of yours that holds its text, as
  `learn` in `helpers.ts` does), asks every query through `deep_search` (a `deep mcp` bound to no session, every page)
  and through `deep find`, and counts a query as found only when the reply holds the claim it is tied to. It prints,
  for each search (`deep_search`, then `deep find`) and each form (`words`, `form`, `question`), one line and then one
  line for each query not found, in the fixture's order, and nothing else; it exits 0 whatever it counts, stops what
  it started by PID and removes its temp home:

  ```text
  <search>, <form>: <found> of <asked> found; by words in the query, <n>: <found> of <asked>, <n>: <found> of <asked>
    not found: <the query, as JSON.stringify writes it>, tied to <claim>
  ```

  A query's length `<n>` is its count of words by `deep_search`'s word rule, the lengths ascending. On this fixture,
  by the merge base's two rules (taken through the real searches on the base), it prints 36 lines that start:

  ```text
  deep_search, words: 6 of 6 found; by words in the query, 2: 2 of 2, 3: 3 of 3, 4: 1 of 1
  deep_search, form: 0 of 6 found; by words in the query, 1: 0 of 1, 2: 0 of 3, 3: 0 of 2
    not found: "api ports", tied to wiki:repos/api#port
  ```

  and go on with `deep_search, question: 0 of 6 found`, `deep find, words: 1 of 6 found` ("release branch"),
  `deep find, form: 0 of 6 found` and `deep find, question: 0 of 6 found`. The test doesn't hold these numbers: it
  holds the reading to what the two searches return when the test asks them.

## The fixture

- **`note.test.ts` and `find.test.ts`** (one record each, the same content): the shipped wiki learns, at scope `all`,
  `wiki:repos/api#port` "`` `api` starts on port 3000 ``", the one claim about ports, and `wiki:setup#cache` "The cache
  is redis 7". On the base `deep find port` prints three hits, each with the claim's text as its context: the decision
  the claim rests on, `wiki:questions/api/start#port` (the wiki's own question page for the repo) and
  `wiki:repos/api#port`.
- **`scope.test.ts`**: the same `api` claim, and `wiki:repos/web#preview-ports` "web previews listen on ports 5173 and
  5174", learned in session A of repo `web` at `session:<A>`. Session B works in repo `api`.
- **`order.test.ts`**: `wiki:notes/billing#c01` to `#c25`, "Plan NN billing runs on day N of the month", learned in
  that order, and one decision saved from the choice ask "Move billing to monthly invoices?".
- **`fixtures/reading.json`**: six claims and eighteen queries. Traps: "web preview port" (tied to
  `wiki:repos/web#previews`; both searches return `wiki:repos/web#preview-port`) and "previews" (tied to
  `wiki:repos/web#preview-port`; both return `wiki:repos/web#previews`).

## The merge base's hits

- **#884** (`search.test.ts` there): its three wiki claims and three decisions, rebuilt here; its seven queries that
  find a hit (`billing`, `缓存`, `缓存 billing`, `column`, `Größe`, `Lounge`, `café`), each with its set written in
  `hits.test.ts` (a decision by its name, since its ID is minted per run).
- **#26** (`search.test.ts` there): its fixture with a fixed term; the term from the session's own call (the wiki's
  stand-in, the spec, the open item, the verdict, the decision) and from a call bound to no session (the wiki's
  stand-in, the spec, the decision), each hit named by the marker its text holds.
- **#1515**: its 500-session fixture (`makeWorld` there, fixed handles); six `deep_search` queries from a Codex session
  of repo A or B and six `deep find` commands, every page. Their sets are `fixtures/base-hits.json`, written on
  `b134dd38f` by the last test of `hits.test.ts`, which runs only with `DH3460_GOLDEN=write`, on that commit, with
  `packages/` unchanged, as #1515's own oracle is written. The implementer never runs it.

All three pass on the base, so the pins are the base's. "Any leftover delta is listed": a failure names each query
whose set moved with the hits it gained and lost; a delta the owner accepts moves through this suite's blind redraft.

## Not named by the issue, so assumed

- **The notes' wording** is this job's; the issue names what each says. A test first asks for what the criterion
  names (the word in the list, or not in it), then for the sentence word for word.
- **"Names" a word**: the word is in the list of the first sentence. The second sentence names no word.
- **"Under its client's cap (#2896)"**: the suite's client is one the facts don't know, held to the smallest figure
  any facts file holds, a fifth under: 8,000 tokens and 40,000 characters. The reply's `result` as JSON is held to
  8,000 characters, and a token is at least a character. The 40 words are ten letters each; what a note does with
  words long enough to pass the cap on their own isn't asked.
- **"A query of 40 words that no source holds"**: forty distinct words, none in the record.
- **"Exits as today"**: 0. **"One sentence"**: the whole of stdout but its newline.
- **"`deep find port`, which finds the claim … byte for byte"**: stdout of the plain command and of `--json`, written
  out from the fixture's handles as the base prints them. A one-word query that finds nothing is held to today's
  sentence too, since the Scope gives the new one to "a query of two or more words".
- **"A decision of yours"**: a `decision.created` saved from your answer to a choice ask, found by its question, as
  #26's and #884's suites find one; the call is bound to no session.
- **"Keep their order among themselves"**: the order the merge base returns them in, which is the order they were
  learned in (asserted before the decision's place, so the base run proves it).
- **"The first page"**: the reply to a call with no cursor, 20 hits as today.
- **"Every query in #26's … suites"**: the queries of each suite's search tests that find a hit. Left out: #26's
  budget queries over its 30-day record (`budgets.test.ts`), `ask.test.ts`'s search for a decision by its question
  (a decision found by its question is in the fixture here) and `binding.test.ts`'s, which asserts no hit; #1515's
  `file`-narrowed calls beyond `deep find --file src/retry.ts`.
- **The reading's surface, fixture and line format** are this job's; the issue names what it gives. "By query length"
  is by words. "No threshold": it exits 0 whatever it counts, and no test holds a count to a number.

## Not covered here

- **`#3460.e5ebcbe5`, the budgets**, has no test. It is taken on the reference Mac in the local preflight, and it
  counts reads of the record and of the index, which no surface at the base reports: `deep_search`'s reply, `deep mcp`
  and the hub's socket give no count of reads, and the perf lane's `deep-mcp-30d` task times a search and doesn't
  count them. A test here could only time a call or read the implementation's own lines. The criterion stays open
  until the owner says how it is taken.
- "With no network" is not enforced: the reading is run with a temp `HOME`, and nothing watches its sockets.
- An `index@1` fill in place of the default index: the notes are tested on the shipped index only.
- A note on a reply past a cursor, and a word in a script written without spaces.
- The passing side of every test that fails on the base is unverified until an implementation exists; the reading's
  test alone was run to a pass and to its named failure, on a stand-in (`BASE-FAILURE.txt`).
- Linux wasn't run; nothing here is macOS-only.

## Lanes

`lane.json` runs the folder alone (`binary`): its files start real hubs, which run deep-hook from `target/`, as the
suites it imports from do on the one-at-a-time list.

## Files

- `note.test.ts` (AC1, AC2, AC4, AC5), `scope.test.ts` (AC3), `find.test.ts` (AC6, two tests), `reading.test.ts`
  (AC7), `order.test.ts` (AC8), `hits.test.ts` (AC9, three tests, and the gated writer of its golden).
- `helpers.ts`: the criterion IDs, the notes and sentences word for word, the fixture's claims, `learn`, `search`,
  `everySource`, `find`.
- `fixtures/reading.json`, `fixtures/base-hits.json`.
- `twins.json`, `twins/README.md`, `lane.json`, `tsconfig.json`, `BASE-FAILURE.txt`.

No fixture holds a secret or personal data; every path is a temp folder's.
