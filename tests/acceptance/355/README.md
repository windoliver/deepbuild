# Acceptance tests for #355: wiki claims and pages, outside content kept out of the slice, and the index slot

Written first, blind, by a job that never saw an implementation of #355. On October 26, 2026 it read:

- issue #355: its Scope, its 9 checkbox criteria, its Proof and Depends on; #54 and #5 for scope boundaries only
- `docs/technical-design.md`: the `wiki` row of First-party extensions that ship on by default; The learned layer;
  Reading by reference; Threats, and what stops each one (hostile text, agents switching off what watches them,
  callers posing as others); Extension API (`deep.registerIndex`) and the MCP tools row; Building blocks; the Hub
  slots table under Composition; Socket roles and contract versions
- `AGENTS.md`
- the acceptance suites of #62, #26, #349, #348, #316, #14 and #47 for their surfaces and conventions
- the packages they reach, through their public entries: `record` (the learned layer, `startSlice`, `rollBack`),
  `hub` (`search.ts`, `core.ts`, `tools.ts`, `paths.ts`), `conformance` (the `index@1` kit in `slots/wiki-index.ts`,
  `runKit`), `extension-host` (kits at install, `openTrust`), `evidence`, `contracts` (handles, `learn.*` schemas,
  `extension-api.json`, `hub-slots.json`, the manifest), `deep-hook`'s `default-rules.json`
- the base commit `14561af` (origin/main)

The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

## How to run

```sh
fnm exec --using=24 npm ci                              # once, if node_modules is missing
fnm exec --using=24 npm run build --workspaces          # the hub, deep mcp and the CLI run from packages/*/dist
cargo build --locked -q -p deep-hook                    # optional warm-up; propose.test.ts builds it (target/debug)
fnm exec --using=24 node node_modules/vitest/vitest.mjs run --root tests/acceptance/355 --no-file-parallelism
fnm exec --using=24 node node_modules/typescript/bin/tsc -p tests/acceptance/355/tsconfig.json
```

- Node 24.22 and `git` on the `PATH`; Rust for the deep-hook build. No network: the one HTTP server listens on
  127.0.0.1, to see that nothing fetches a link.
- Every folder is under `/tmp/dh355-*`. `HOME` is a temp folder for the test process and every child, so nothing
  touches the real `~/.deepbuild`; cargo alone is spawned with your real `HOME`, to find its toolchain. Processes are
  stopped by PID only, through tests/acceptance/26's `cleanup`, never by name or port.
- `--no-file-parallelism`: the files start real hubs. The implementer adds `tests/acceptance/355/` to the unit
  lane's one-at-a-time list in `scripts/lanes.mjs`, as #26's suite is (not done here: this job writes tests only).
- The suite imports tests/acceptance/26's helpers (the hub, `deep mcp`, the agent stand-in and its hooks, `deep`
  commands) and tests/acceptance/316's (the deep-hook build and its hook runner), as #34's suite imports #16's.

## The surface under test

The issue names `deep.registerIndex`, `index@1`, `deep_search`, `deep_propose`, the start slice, `dropSource` and
`?token=` links, but no module for the wiki. This job adds the smallest surface the tests need and says which names
it invented. Everything else (the FTS5 tables, the event kinds claims are recorded as, how the hub finds the
claim records) is the implementer's.

### `@deepbuild/wiki`: the wiki's writer (`packages/wiki/src/index.ts`, *invented*)

The wiki is a first-party extension (the design's extension table), and no existing package is its; the core
never imports an extension, so it gets a package of its own, as `checks-command` and `env-local` have. The tests
load it lazily, so the suite loads at the base.

```ts
import type { Connection, RecordStore } from '@deepbuild/record';

/** How a claim was known: from you, from your decision, from a repo file at a commit in a project you trust, inferred by an agent, or from outside content. */
export type Known = 'you' | 'decision' | 'repo' | 'inferred' | 'outside';
/** One thing a claim rests on: the exact quote, and where it is. */
export type Source =
  | { at: string; quote: string }                                   // session:<id>#<message>, decision:<id> (ev:<sha256> too, unused here)
  | { repo: string; path: string; commit: string; quote: string };  // a repo file at a commit; `repo` is the checkout's folder
export interface Candidate {
  page: string;          // 'repos/api' → <folder>/repos/api.md
  id: string;            // the claim's ID on its page; the claim's handle is wiki:<page>#<id>
  text: string;          // the line
  sources: Source[];
  scope: string;         // session:<id> | repo:<project> | all (README: Readings, scopes)
  supersedes?: string;   // wiki:<page>#<id> of the claim this one replaces
}
export interface Learned {
  written: string[];                             // the handles written
  dropped: { claim: string; reason: string }[];  // the reason names the source whose quote isn't there
}
export interface Wiki {
  /** Checks each candidate and records the ones that hold as claims in the learned layer, then rewrites the pages. */
  learn(candidates: Candidate[]): Promise<Learned>;
  /** Rewrites every page from the claim records (after a rollback, say). */
  write(): Promise<void>;
  /** Promotes a claim on your answer, saved as a decision; refused unless `connection` is yours (writer app or cli). Resolves with `decision:<id>`. */
  promote(connection: Connection, claim: string): Promise<string>;
}
export function openWiki(o: { record: RecordStore; folder: string; now: () => number; plant?: 'quote-present-only' }): Wiki | Promise<Wiki>;
```

The tests open the hub's own ledger (`<home>/.deepbuild/ledger.db`, with its evidence store at `evidence/`) while no
hub runs, seed it through `@deepbuild/record` (sessions, archived transcripts, decisions) and
`@deepbuild/extension-host`'s `openTrust` (your trust in the api repo), write with `openWiki({ folder:
'<home>/.deepbuild/wiki' })`, close it, and then start the hub on that home.

### Pages (*the line format is invented*)

Pages are `<home>/.deepbuild/wiki/<page>.md`. `index.md` and `log.md` at the top aren't read for claims. On every
other page, each non-blank line is a heading (`#…`), a claim line, or the page's last non-blank line (the generated
line that says what the page doesn't establish). A claim line is one line:

```
- <text> <!-- deep:claim {"id": "<id>", "known": "<Known>", "proof": <n>, "sources": [<Source>, …]} -->
```

The JSON may hold more fields (the file hash, the message's role, when it was true, a state); the tests read `id`,
`known`, `proof` (the number of distinct sources that agree) and `sources` (the candidate's shape: `at` and
`quote`, or `repo`, `path`, `commit` and `quote`). Pages are the source of truth: everything a second index needs is
on them.

### `deep_search` (#26's tool, new fields on a wiki hit)

A wiki hit keeps #26's `source: "wiki:<page>#<claim>"` and `quote` (the claim's line as its page shows it), and
gains, read by the hub from the claim records, never from the index: `outside` (boolean: the claim rests only on
outside content), `known`, `proof`, and `sources` (as on the page). The hub drops a hit whose claim is outside the
calling session's scope, superseded or rolled back.

### `deep_propose` (a new tool of `deep mcp`; *its argument names are invented*)

Arguments, in #26's strict subset: `target` (`wiki:<page>#<claim>` here), `change` (the change in words: here the
line it proposes) and `evidence` (`[{at, quote}]` or null). A bound call records `learn.proposed` with that
`target` and `applied_by: null`, applies nothing, changes no page, and raises an ask for you that `deep inbox` lists
open, its question holding the proposed change's words. Like every tool, it's described from the design's table
(tools.json and the skill, which #26's `tools.test.ts` holds to it).

### `deep.registerIndex(name, index)` and `index@1` at install

`index` is index@1's fill (`IndexFill` in `packages/conformance/src/slots/wiki-index.ts`). A package registers one
from its code and declares `"replaces": ["index@1"]` in its manifest (*invented*: an index fills a one-fill slot,
so a package's index replaces the shipped one, named by its interface). Its install runs index@1's kit on what it
registers, where it will run, as #349's install runs check.kind@1's on a check kind; a FAIL refuses the install,
the error naming the first failing kit case (`cart-totals`, `release-notes` or `seeded-<n>`), and
`Installed.kits` carries `{ slot: 'index@1', fill: <name>, verdict }`.

### Seams

| Seam | What it does |
|---|---|
| `DEEP_HUB_TEST_INDEX=<module>` | #26's: the module's default export returns the index@1 fill the hub uses for the wiki in place of the default; the hub rebuilds it from the pages. The tests point it at the second index (the reference fill) and at planted indexes. |
| `DEEP_HUB_PLANT=trusts-index` | *Invented here*, a planted wrong program the implementer adds to the hub's plant list (set for `deep hub run` and every `deep mcp`, as #26's are). |
| `openWiki({ plant: 'quote-present-only' })` | *Invented here*, the writer's planted wrong program, as `@deepbuild/asks` takes `plant`. |

## Readings where the issue and the design leave a choice

- **Claims are learned changes.** "What the wiki learns is in the learned layer: each change is an event with its
  evidence and scope, and can be rolled back." So a claim is applied, scoped, superseded and rolled back as #62's
  learned changes are: the AC8 rollback is `record.rollBack(you, { since })`, and a claim's scope follows the
  layer's rules for how it was learned.
- **Scopes the tests use** are only those the layer's rules give for the evidence: `session:<A>` for a claim from
  session A's own messages; `repo:api` for a claim learned at install from api's sessions or a file of the api repo
  (its checkout is the worktree api's `session.start` names); `all` for a claim learned at install from your words
  in sessions of two repos, api and web.
- **A call bound to no session** reads what belongs to no session: wiki claims at `repo:` and `all` scope, never a
  session-scoped one (Socket roles; #26 already serves an unbound call the wiki). AC3, AC5, AC4's second half and
  Proof search that way; AC8 searches from session B's own `deep mcp`, so it is bound to B.
- **Proof count** is the number of distinct sources that agree; one cited twice counts once.
- **Known**: your message is `you`; your decision `decision`; a file at a commit of a project you trust `repo`; a
  fetch's result `outside`. A claim stating a key (a port here) that its quote doesn't hold is `inferred`, whatever
  its source; the twin whose port is in the quote is `repo`.
- **A quote is at its source** when, after NFC, collapsing whitespace and taking each link without its query
  string, it is a substring of the message's text, the decision's answer, or the file at that commit (not the
  working tree: one fixture claim's quote is only at a later commit). Links are stored without query strings, so a
  stored quote holding a link is compared that way.
- **"Stored without its query"**: the link appears on its page without `?…`, and neither the token nor `?token` is
  in any file of the wiki or in the ledger's files (claims, sources, links, index). The archived transcript in the
  evidence store keeps what was said; it isn't the wiki's store. **"Never fetched"**: the link points at the test's
  own server on 127.0.0.1, which must see no request through the writer, both hubs and the searches.
- **The 20 queries** are words every hit must hold (deep_search's own description). Each must find, on the default
  index, exactly the written claims whose line holds every word (one finds none: a dropped claim's word), and the
  second index rebuilt from the pages must give the same pages and quotes.
- **An agent's write to a page** is its Write tool call, which the real deep-hook denies with the shipped guard
  entries as `rules.json` (`no-deepbuild-home-write`, #316). The base already denies it, so that half is
  regression protection.
- **Who promoted it**: your promotion is a `decision.created` whose `actor` is the promoting connection's (`you`);
  an agent's (`mcp:<session>`) promotion is refused, and nothing reaches the slice.
- **The start slice** is #62's `startSlice(session)`, read from the record; it holds the repo page's claims from
  you (the twin), never a claim resting only on outside content until your decision promotes it.

## Criteria to tests

Each test's name starts with its ID. A test marked `(wrong program)` runs the criterion's scenario against the
planted program the criterion names and expects it to fail, naming the claim.

| ID | Criterion (short) | Test | The wrong program, and how it fails |
|---|---|---|---|
| AC1 | every line resolves to its source and quote; a claim whose quote is missing is never written | `pages.test.ts` AC1 | a writer that checks no quote writes `wiki:repos/api#retries` (its quote isn't in its message); one reading the working tree writes `wiki:repos/api#hourly` (its quote is only at a later commit); a page with a line that isn't a claim, or a claim line without sources, fails naming `<page>.md:<line>` |
| AC2 | an agent's write to a page is refused; its `deep_propose` lands in the inbox | `propose.test.ts` AC2 | a deep-hook that lets the Write through; a proposal applied, changing the page, or missing from `deep inbox` |
| AC3 | the 20 queries: a second index rebuilt from the pages returns the same pages and quotes as the default; a `?token=` link stored without its query, never fetched | `pages.test.ts` AC3 (2) | a page reader that loses a claim or its text makes the second index differ, naming the query; a writer keeping the query leaves `opensesame` on the page or in the ledger; any fetch shows on the server |
| AC4 | a planted index keeping a dropped source's claim, or returning a hit with no source, fails `index@1` at install naming the case; a planted index marking a fetched README's hit inside still has it shown outside | `install.test.ts` AC4 (3), `outside.test.ts` AC4 (2) | test packages `keeps-dropped-source` and `sourceless-hit` must be refused naming a kit case (at the base both install); the planted index `marks-readme-inside` with the hub plant `trusts-index` shows the hit inside and fails naming `wiki:repos/api#setup` |
| AC5 | a fetched README saying setup needs `curl … \| sh` is outside content, never in the start slice, `deep_search` marks it outside | `outside.test.ts` AC5 | a writer that takes a fetched result as first-hand records it `you` or `repo`; a slice that holds every repo-page claim holds it |
| AC6 | after you promote it, it enters the start slice and its decision shows who promoted it | `outside.test.ts` AC6 | an agent's promotion accepted; a promotion that saves no decision, or doesn't reach the slice |
| AC7 | each claim shows how many sources agree | `pages.test.ts` AC7 | a count of citations gives 4 for the claim citing one message twice; a hit without its count |
| AC8 | in session B of api, a session-scoped claim of session A of web, a superseded and a rolled-back claim never come back; a planted index returning them still has them dropped; a hub trusting the index fails naming the claim | `scope.test.ts` AC8 (3) | the planted index `returns-dropped-claims` with the hub plant `trusts-index` returns them, failing naming `wiki:repos/web#heron-preview` (or the superseded or rolled-back claim's handle) |
| AC9 | '`api` starts on port 3000' citing a real quote saying 3001 is inferred, never known from the file; a writer checking only the quote writes it known and fails naming the claim | `inferred.test.ts` AC9 (2) | the writer plant `quote-present-only` writes `wiki:repos/api#port-guess` as `repo` and fails naming it |
| Proof | pages from fixture claims, a deep_search hit with its source, a second index rebuilt from the pages giving the same hit | `pages.test.ts` Proof | no hit for `wiki:setup#deploy-gate`, a hit without sources or with a source that doesn't hold its quote, or a different hit from the second index |

## Planted programs

The implementer adds:

| Plant | Where | What it does | Test |
|---|---|---|---|
| `trusts-index` | the hub, `DEEP_HUB_PLANT` | serves each wiki hit as the index gives it: its `outside`, `known`, `sources` and `proof` from the hit when the index sets them, and drops nothing for scope, supersession or rollback | `outside.test.ts` and `scope.test.ts`, each `(wrong program)` |
| `quote-present-only` | `openWiki({ plant })` | checks only that each quote is at its source, never that the claim's exact keys are in its quote, so a claim whose key isn't there is written with its source's `known` | `inferred.test.ts` `(wrong program)` |

The tests bring these themselves (they aren't the implementer's to add):

| Planted | Where | What it does |
|---|---|---|
| `keeps-dropped-source`, `sourceless-hit` | `fixtures/index-package` (its `index.json`) | an index registered with `deep.registerIndex` that keeps a dropped source's claims, or returns hits with an empty source; a scratch run holds both to index@1's kit (both FAIL at `cart-totals`) and the sound one (PASS) |
| `marks-readme-inside` | `writePlantedIndex` in `helpers.ts` | an index that answers with the README's claim marked `outside: false`, `known: 'repo'`, citing the repo's README |
| `returns-dropped-claims` | `writePlantedIndex` | an index that keeps every heron claim through every rebuild, the session-scoped, superseded and rolled-back ones included |

## What touches other suites

- **#26's `search.test.ts`** expects an unbound `deep_search` to return its index fill's claim `wiki:repos/shop#c1`,
  which has no claim record. This suite doesn't decide what the hub does with a hit whose claim has no record;
  keeping that frozen test green is the implementer's to show.
- **#26's `tools.test.ts`** holds every listed tool to the design's table, so `deep_propose` needs its description
  in `tools.json` and the skill.
- **#349's slot-list and slot-table tests**: `deep.registerIndex` needs its entry in `extension-api.json` and its
  row in `hub-slots.json` (interface `index@1`, fills `one`, the kit's planted fills).

## Files

- `helpers.ts`: temp folders and cleanup, the clock, git repos, connections, sessions with archived transcripts,
  decisions and trust, the wiki surface (lazy), quote resolution, page and claim-line reads, the hub and an unbound
  `deep mcp`, the second and planted index modules, the counting server, the deep-hook build.
- `fixtures/corpus.json`: the fixture claims and the 20 fixture queries. `fixtures/index-package/`: the test index
  package (`index.ts.fixture` is renamed when copied, so neither Vitest nor `tsc` picks it up).
- `pages.test.ts` (AC1, AC3, AC7, Proof), `propose.test.ts` (AC2), `install.test.ts` (AC4), `outside.test.ts` (AC4,
  AC5, AC6), `scope.test.ts` (AC8), `inferred.test.ts` (AC9).
- `tsconfig.json`: the root options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run on the base commit, where every test fails.

No fixture holds a secret or personal data: the IDs, hashes, hosts (`*.example.invalid`), ports and the token
(`opensesame`) are made up.
