# Acceptance tests for #1515: a working session searches past sessions

Written first, blind, from issue #1515 (its text as of November 8, 2026: the problem statement, Scope, the 8
acceptance criteria, Proof and Depends on), `docs/technical-design.md` and the base commit `f1e8736e` (`origin/main`).
No search, archive or find code was read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a
dispute goes to a blind redraft by this job.

## What this job read

- issue #1515, as the job's brief quoted it.
- `docs/technical-design.md`: Reading by reference (handles, `deep find`, the cap); the `archive` and `wiki` rows of
  the first-party extensions (the `archive` row already names the index, `deep find --file <path>`, and each hit's
  handle, agent, date, whose words, history mark, changed files and reverted or rejected task); the MCP tools row;
  the Building blocks rows for Event and Index; "A project is identified by its repo root and remote URL".
- `AGENTS.md`.
- Other acceptance suites, for conventions and helpers: `884` (shape, README, a fixture written before the hub
  starts), `26` (the hub, `deep mcp`, the agent stand-in `fixtures/agent.mjs`, its `Agent` and binding, `events.read`,
  the budget judge and reference-Mac gate), `355` (seeding sessions with archived transcripts through the record and
  the evidence store), `20` (the archive's events, `transcript.archived@2`, budgets against the merge base), `63`
  (`deep find`/`deep read` and `--json`'s `{hits: [{handle, context}], next?}`), `48` (criterion IDs), `237` (budgets),
  `16` (Codex hook payloads, `mulberry32`), `352` (Codex rollout lines), `124`'s November 6 redraft note and `806`'s
  `Stand` (a Codex `deep mcp` binds only by each call's PreToolUse), `1337`'s README (events carry `project`).
- Public entries and data: `packages/record/src/index.ts` (`openRecord`, `Connection`, `RecordStore`),
  `packages/evidence/src/index.ts` (`openEvidenceStore`, `Writer.put`), the event schemas in
  `packages/contracts/schemas` (`session.start@1`, `session.end@1`, `tool.before@3`, `tool.after@3`, `commit.made@1`,
  `transcript.archived@2`, `task.*`), `adapters/codex.facts.json` (`versions`, the `mcp__` prefix), the CLI's usage
  lines (`deep find <query> [--slice [<cursor>]] [--json] [--root <folder>]`), `scripts/lanes.mjs` (the `alone` list)
  and `benchmarks/budgets.json`.

## Run

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # the tests run the built CLI: deep hub run, deep mcp, deep find
cargo build -p deep-hook                 # the hub refuses to start without target/debug/deep-hook
npx vitest run --root tests/acceptance/1515 --no-file-parallelism
npx tsc -p tests/acceptance/1515         # type-check the tests
```

- **`--no-file-parallelism`:** each file runs a hub on its own fixture, and the budgets must run with nothing beside
  them. The suite starts real hubs, so the implementer adds `tests/acceptance/1515/` to the unit lane's one-at-a-time
  list (`alone` in `scripts/lanes.mjs`), as #26's and #884's are. Not done here: this job writes tests only.
- **Safety:** every folder is under `/tmp/dh1515-*`; `HOME` is a temp folder for the test and every child, and
  `CLAUDE*`, `CODEX*`, `DEEP_*` and `AI_AGENT` are removed first, so no real `~/.deepbuild`, `~/.claude` or `~/.codex`
  is read; no network; processes are stopped by PID only (26's `cleanup` and `stopHub`), never by name or port.
- **Time:** about two and a half minutes on the base, most of it the 60 s wait below.

## The surface

- **`deep_search`**, called as an MCP client calls it, on the `deep mcp` of a **Codex session** working in repo A's
  (or B's) folder. The session is the agent stand-in of #26 (`fixtures/agent.mjs`, imported, not copied) sending
  Codex's hooks (`agent: "codex"`, payloads as #16's `payload` shapes Codex's: `model`, `turn_id`, its rollout under
  `~/.codex/sessions/`, carrying the newest Codex version its facts cover), with its `deep mcp` a child of the same
  process and started in that folder. Its SessionStart, a prompt and a shell call establish it; every `deep_*` call is
  preceded by the PreToolUse Codex fires for it (`tool_name: "mcp__deep__<tool>"`, `tool_input` the arguments), since
  a Codex `deep mcp` binds only by each call's stamp. `deep_status` must name the session, or the test is BLOCKED.
  The argument is `{query}`; the value keeps #26's `hits: [{source, quote}]`.
- **`deep find`**, the built CLI run by you in repo A's folder: `deep find <query> --json --root <root>` and
  `deep find --file <path> --json --root <root>`, every page followed with `--slice <next>`. `--json` prints #63's
  `{hits: [{handle, context}], next?}`.
- **The hub**, `deep hub run`, with `HOME` the fixture's home and no seams set.

### A hit from a past session

A `deep_search` hit whose `source` is a `session:` handle is a past-session hit. The fields the tests read:

| Field | Value | Read by |
|---|---|---|
| `source` | the message's handle, `session:<id>#<message>`; a Claude Code message is its entry's `uuid`, a tool result the result's entry | AC1, AC2, AC4, AC5, AC6 |
| `quote` | the text (#26) | AC6 |
| `agent` | the session's agent as the record names it: `"claude-code"` or `"codex"` | AC1 |
| `from` | whose words: `"you"`, `"agent"` or `"outside"` (a fetch's, a search's, a browser or MCP result) | AC5 |
| `changed` | a list, one element (a string or an object) for each file the hit names that changed since its session at the branch head, each naming the file by its repo path (`src/retry.ts`); absent or empty when none did | AC4 |

A `deep find` hit's `handle` is a message handle, or a session handle for `--file`; its session is what's before `#`.

## The fixture

`helpers.ts` writes one record into the hub's own home (`<home>/.deepbuild/ledger.db` and `evidence/`) with no hub
running, through `@deepbuild/record` and `@deepbuild/evidence`, as the hooks, the core and the archive record it:

- **Two repos of their own** under the temp folder, `shop` (A) and `blog` (B), git with dated commits. Repo A: C0
  before every session (`src/retry.ts`, `src/backoff.ts`, `src/pool.ts`); C1, ten minutes into session S1, changes
  `src/retry.ts`; C2, ten minutes into S2, changes `src/backoff.ts`; C3, about four days after the last session and made
  by no session, changes `src/retry.ts` again and is `main`'s head.
- **The repos' projects** are the hub's own: before seeding, a hub on a scratch home sees a Codex session start in
  each repo, and `events.read` gives each `session.start`'s `project`. The fixture's sessions carry those projects on
  their connections and the repo's folder as their `worktree`.
- **500 sessions**: 300 of repo A, 200 of repo B, every fifth a Codex session, one every 30 minutes from 12 days ago.
  IDs are fixed (`sa010c` is repo A's session 10, Claude Code; `x` ends a Codex one), so handles are the same on
  every run. Each holds 40 messages of 60 seeded filler words (about 400 characters; `lantern` in about 3% of them), a
  Read and an Edit of a `src/mod<n>.ts`; about 8 MB of transcripts. Per session: `session.start@1`, a
  `tool.before@3`/`tool.after@3` pair per read and edit with the path resolved, `commit.made@1` for S1 and S2,
  `session.end@1`, and the transcript (Claude Code JSONL, or a Codex rollout) stored as evidence and linked by
  `transcript.archived@2` with the source's size and hash.
- **The named sessions** (all of repo A unless said):

| Name | Session | Agent | What it adds |
|---|---|---|---|
| E1 | `sa010c` | Claude Code | a Bash result (`#merr`) holding `PoolTimeoutError: connection pool exhausted after 30000ms` |
| BE1 | `sb010c` (repo B) | Claude Code | the same Bash result (`#merr`) |
| C1 | `sa011c` | Claude Code | the agent's message `#mword` with `plovertide` |
| X1 | `sa014x` | Codex | the agent's message with `plovertide` |
| F1 | `sa012c` | Claude Code | your message `#myou`, a WebFetch result `#mfetch` and the agent's message `#magent`, each with `quillfeather` |
| T1 | `sa013c` | Claude Code | its Read is of `src/retry.ts` |
| T2 | `sa019x` | Codex | its edit (`apply_patch`) is of `src/retry.ts` |
| N1 | `sa015c` | Claude Code | your message naming `src/retry.ts`; no tool call touches it |
| S1 | `sa280c` | Claude Code | edits `src/retry.ts`, commits C1; the agent's message `#mnote`: `wobblecap: patched the jitter in src/retry.ts …` |
| S2 | `sa281c` | Claude Code | edits `src/backoff.ts`, commits C2; the agent's message `#mnote`: `wobblecap: tuned the delay in src/backoff.ts …` |
| G1–G5 | `sa020c`–`sa024x` | both | criterion 8's words: `retryWithBackoffJitter`, `withBackoffJitterMs` and the near miss `withBackoffJiggle`; `επανασύνδεση`, `ανασύνδεσης` and the unaccented `ανασυνδεση`; `连接重试失败`, `重试三次` and the near miss `重新尝试` |

### Today's scan (criterion 8's oracle)

`fixtures/today.json` holds the hits the base's `deep find` returned on this fixture, made on November 8, 2026 at
`f1e8736e` with nothing changed under `packages/`:

```sh
DH1515_GOLDEN=write npx vitest run --root tests/acceptance/1515 golden.test.ts
```

`golden.test.ts` builds the same fixture, runs `deep find <query> --json --root <root>` (every page) for each query and
writes the handles. It refuses to run anywhere but the base commit with `packages/` unchanged, and every other run
skips it, so it can't record an implementation's answers. A golden was chosen over building the merge base inside the
test: the fixture's handles are fixed, so the base's answer is a fixed list, and building the base in a temp copy
would take minutes per run and an `npm ci` the suite can't make without the network. Today's scan returned:
`thBackoffJit` → `sa020c#mg1`, `sa024x#l33`; `ανασύνδ` → `sa021c#mg1`, `sa024x#l34`; `重试` → `sa022c#mg1`,
`sa023c#mg1` (the near misses aren't among them).

## Criteria, tests and wrong programs

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, whitespace collapsed and the leading
`- [ ] ` dropped (the command in `tests/acceptance/48/README.md`). The wrong programs are argued from the fixture,
not planted: this job didn't read the hub, so it can't build a twin of it. Each test's message names what failed.

| # | ID | Test | Wrong programs it fails on | On the base |
|---|---|---|---|---|
| 1 | `#1515.50f29297` | `search.test.ts` AC1: from a Codex session of A, `deep_search` for the error string returns `session:sa010c#merr` with `agent: "claude-code"`; `plovertide` returns C1's hit as `claude-code` and X1's as `codex` | a search that skips transcripts (nothing comes back); a hit with no handle or the session's handle only; an agent field fixed to one agent, or the caller's | FAIL: in 60 s `deep_search` never returned `session:sa010c#merr` |
| 2 | `#1515.82f04bac` | AC2: the same call from a Codex session of B returns no hit of a repo A session, and does return BE1's `#merr` | a search that crosses repos (fails naming the A session); one scoped by nothing but returning empty (fails on BE1's hit) | FAIL: the shared wait of AC1 |
| 3 | `#1515.c41b7667` | AC3: `deep find --file src/retry.ts` lists exactly T1, T2 and S1 | a text match on the path (lists N1, named); one reading the transcript's tool inputs only, or Claude Code's only (misses T2, a Codex `apply_patch`); one listing nothing | FAIL: the base's `deep find` takes no `--file` (usage error, exit 2) |
| 4 | `#1515.c5a02456` | AC4: `wobblecap` returns S1's and S2's notes; S1's `changed` names `src/retry.ts`, S2's doesn't name `src/backoff.ts` | a hit that never says a file changed; one that says so of every file, or of files changed by the session's own commit (S2's C2) | FAIL: the shared wait of AC1 |
| 5 | `#1515.c84a0fbf` | AC5: `quillfeather` returns F1's three messages: `#mfetch` `from: "outside"`, `#myou` `"you"`, `#magent` `"agent"` | whose words read off the entry's role (a tool result's entry is `user`, so the page reads as yours); a fixed value | FAIL: the shared wait of AC1 |
| 6 | `#1515.adbdb642` | AC6: hits before, then the hub stopped, every `archive_*` table of `ledger.db` dropped, the hub started, and the same hits in the same order: `deep_search` for the error string, `quillfeather` and `lantern` (hundreds of hits), `deep find --file src/retry.ts`, `lantern` and `ανασύνδ` (first page) | an index that is a source of truth (not rebuilt: hits gone); a rebuild that orders ties by insertion; an index kept outside `archive_*` tables (fails naming the reading) | FAIL: the shared wait of AC1 |
| 7 | `#1515.c1a2b880` | `budgets.test.ts`: a #1515 perf-lane task valid against the merge base that runs; on a reference Mac, `deep_search` p95 under 100 ms, and `deep find` under 100 ms beyond the CLI's own start | a find that reads each transcript on each call (the base's scan read 2,885 ms and 9,821 ms beyond its start in two runs here, the second on a loaded machine); a search that skips transcripts (the timed tests first need E1's hit) | FAIL: no #1515 task; `deep_search` returns no E1 hit. The find timing is INCONCLUSIVE off a reference Mac (this machine is a Mac17,10 M5 Max), its reading logged |
| 8 | `#1515.03d88b61` | AC8: `deep find` for `thBackoffJit`, `ανασύνδ` and `重试` returns the same handles as today's scan (`fixtures/today.json`) | an index that matches whole words only (FTS5's default tokenizer keeps `retryWithBackoffJitter`, `επανασύνδεση` and `连接重试失败` one token each, so each query finds nothing; the message names the query); one folding accents (finds the unaccented near miss); one splitting Han text by a dictionary (`重新尝试` stays out today) | PASS: the base is the oracle; regression protection |

The Proof's "the timing against the merge base, the first case shown failing there" is `BASE-FAILURE.txt`: criterion 1
fails at the base, and the base's find reading is logged there. No implementation was run: the passing side of every
criterion but 8 is unverified until one exists.

## Readings where the issue leaves a choice

- **The hit's fields** are the table above. `from` and `changed` are this job's names; the issue fixes only their
  meaning. `changed` is matched by the file's path appearing anywhere in an element, so its wording is free. Date and
  the history mark are named by the issue but read by no criterion; this job reads them as `date` and `history: true`
  and doesn't test them.
- **"Names a file"** (AC4) is read both ways at once: S1's and S2's messages name the file each edited, and their
  tool events touched it. "Since that session" is from the session's own commit (`commit.made`) to the branch head;
  git's commit dates agree with the record's times, so a reading by time gives the same answer.
- **"Touched that file"** (AC3) is a read or an edit in the record's tool events, its path resolved inside the
  session's worktree. `--file src/retry.ts` is relative; the CLI runs in repo A's folder, and repo B has no session
  touching a file of that name, so a path read against the folder or against each session's worktree agrees.
- **A bound call reads its own repo's sessions** (AC2): the repo is the hub's project, discovered as above, so the
  test doesn't depend on how the hub derives it. Claims' scopes (the issue's exception) aren't in the fixture.
- **"Deleting the index"** (AC6) needs a name the issue doesn't give: the index is every table of `ledger.db` whose
  name starts with `archive_` (an FTS5 virtual table and its shadow tables, and any state the index keeps). The test
  drops them with the hub stopped, virtual tables first, and fails if there are none. "Rebuilding" is the hub's, on
  its start or on the next search.
- **Waiting for the index:** before its first `deep_search` assertion, and after the rebuild, the suite waits at most
  60 s for the error string to return E1's hit, so a hub that indexes after its start isn't failed for that. `deep
  find` tests wait the same way for `deep find` to return it.
- **"The same hits as today's scan"** (AC8) is the same set of handles; their order isn't compared there (AC6 compares
  order). Codex messages' handles (`#l<n>`) are whatever today's scan prints, and are pinned only through this.
- **The budgets** (AC7): "a search" is both surfaces. `deep_search` is timed from the request written to the reply
  read in the Codex session's own agent process (#26's `ms`), p95 of 20 calls; `deep find`'s time is its wall time
  less `deep --version`'s, each the median of five, so the CLI's own start isn't counted against the 100 ms. Five runs
  after a warm-up, judged by 26's `judge`, only on a reference Mac (26's `environmentProblem`); anywhere else skipped as
  INCONCLUSIVE. "Compared with the merge base" is the perf lane's: a task whose `initialReason` names #1515, valid by
  `scripts/benchmark.mjs`'s `validateBudgets` against the merge base's `benchmarks/budgets.json`, that exits 0.
- **The error string** is searched whole, punctuation and all, as an agent pastes it.

## Scope the tests leave alone

Scope items with no checkbox criterion; a PR should say how it proves what it claims of them:

- `deep_search` taking a file path (only `deep find --file` is tested);
- reaching another repo's sessions as a claim's scope allows;
- each hit's date and history mark, and that a hit is never a check result;
- a session whose task was reverted or closed as rejected, marked so on its hits;
- tool replies under #63's cap with the rest by cursor (AC3 and AC8 follow `next` but don't check the cap);
- the index being the hub's own table and not a fill of `index@1`.

## Files

- `helpers.ts`: the environment, temp folders, criterion IDs, the dated git repos, the fixture's sessions and their
  transcripts, the seeding through the record and evidence store, the Codex session on #26's stand-in, project
  discovery, the world, `deep find` as a process, and the index's tables read and dropped.
- `search.test.ts`: criteria 1 to 6 and 8 on one fixture and one hub; AC6 runs last, since it restarts the hub.
- `budgets.test.ts`: criterion 7, on a fixture of its own.
- `golden.test.ts`: writes `fixtures/today.json` at the base only; skipped in every other run.
- `fixtures/today.json`: today's scan.
- `tsconfig.json`: the root options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run on the base commit.
