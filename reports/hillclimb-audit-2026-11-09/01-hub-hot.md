# 01 — Hub event-intake hot path and its storage

Scope read: `packages/hub/src/{server,core,core-worker,parser,hookmap,wire,settle,spool,children,children-worker,rules,waits,status,paths,session-facts}.ts` (core.ts: the hook path, timers, state maps, stream, rules, transcript and evidence blocks), `packages/record/src/{index,storage,projections,lifecycle}.ts` and the transcript caches of `learned.ts`, `packages/evidence/src/{scrub,patterns}.ts` and the store's entry points. `holds.ts`, `guards.ts`, `scope.ts` were grepped for sync I/O and spawns only (they are gate-time, not per hook).

Nothing was built, run or timed. Counts come from three throwaway scripts in the scratchpad (`walk01.mjs`, `eqp02.mjs`, `eqp05.mjs`/`eqp06.mjs`): directory entries visited, and SQLite rows stepped on a synthetic in-memory table with the record's own DDL (SQLite 3.53.4, the repo's better-sqlite3).

One thing I checked and dropped: `core.ts:968` (`MAX(log_pos) … WHERE kind IN ('agent.stop','verdict.made')`, run every second) looks like a range scan but is not. SQLite steps 2 rows (one reverse seek per IN value, then `Goto`), counted in `eqp02.mjs`. Not a finding.

Ranked by gain over risk.

---

## F1 — `tails` (per-session usage readers) is never freed — CONFIRMED

**Where**: `packages/hub/src/core.ts:457` (declared), `:2489-2490` (the only writes), `:5540` (the list `forgetEnded` clears). `packages/readings/src/usage.ts:50-56,115-117` (what one holds).

**What**: every Claude Code session that stops gets a `UsageTail`, kept in `this.tails` for the life of the hub. Each holds a `Counter` with a `Set` of every assistant message ID in the transcript and its subagents' files, a `Map` of every turn, and a per-file offset map. No line deletes from `tails` (a scripted count over the file: set=1, delete=0, clear=0, and it is not in the `forgetEnded` list). `forgetEnded` already drops seven sibling maps for a session it forgets (`lastMessage, counters, typedAt, projects, tasted, idleSent, completions`).

**Change**: add it to that list.
```ts
// core.ts:5540
for (const kept of [this.lastMessage, this.counters, this.typedAt, this.projects, this.tasted, this.idleSent, this.completions, this.tails]) kept.delete(id);
```

**Why it is safe**: `tails` has one reader, `recordUsage` (`:2486`), which does `this.tails.get(session) ?? new UsageTail()`. A forgotten session that stops again (resumed after 64 newer sessions ended) gets a fresh reader that reads its files from offset 0. `UsageTail.read` returns only `totals`, `cost` and the top model; those are a fold over the files' lines with message-ID dedupe, so reading in one pass or in increments gives the same result for an append-only transcript. What differs: one full re-read for that session, and a transcript rewritten in place between the two reads would count differently (Claude Code appends; a compaction starts a new file).

**Gain**: one `UsageTail` per stopped Claude Code session stops accumulating. Size is about one ID string and Set slot per assistant message (roughly 70–100 bytes each), so 100–300 KB for a session of a few thousand messages; at 30 sessions a day a hub up for a month holds tens to low hundreds of MB it never reads again. Unmeasured. Sessions the hub never verified also get a tail and are not in `endedOrder`; this change does not free those.

**Proof plan**: `tests/acceptance/45/*` (turn.usage) pins the output. Gain: heap snapshot count of `UsageTail` instances after N session ends (N−64 expected to go).

**Risk**: low. 1 line.

---

## F2 — `askingNow` walks a live session's whole history per undelivered ask; a partial index makes it one seek — CONFIRMED

**Where**: `packages/hub/src/core.ts:3104-3109` (the query), called through `askingSoon` from about 25 sites (every `ask.*`, `delivery.*`, `session.start`, `session.end` append at `:914`, every prompt at `:2580`, each stop-rule flip at `:1750`). Same predicate at `packages/hub/src/answers.ts:56`. Index DDL at `packages/record/src/index.ts:223-224`.

**What**: for each ask that is open, later or answered-and-not-delivered, the query runs
`(SELECT kind = 'session.end' AND unverified = 0 FROM events WHERE session_id = a.session_id AND kind IN ('session.start','session.end') ORDER BY log_pos DESC LIMIT 1)`.
The planner uses `events_session (session_id, log_pos)` and steps backward until it meets a start or an end. An ended session stops at its first row. A live session has no end, so it steps back to its `session.start`: every event of the session, each a table fetch because `kind` is not in that index. Asks for permission prompts are answered and never "delivered" (`this.prompts`, filtered in JS after the SQL), so a long live session keeps several such asks for good.

Counted on a synthetic record (300 sessions, 200k events, one live session of 20,000 events holding 3 undelivered asks, 1,000 undelivered asks of ended sessions): **61,003 event rows stepped per call**. With the index below: **1,003**, same rows returned, and the index holds 599 of 199,999 events. The planner picks it with and without `ANALYZE`.

**Change**: one line in the record's DDL.
```sql
CREATE INDEX IF NOT EXISTS events_session_bounds ON events (session_id, log_pos) WHERE kind IN ('session.start', 'session.end');
```

**Why it is safe**: an index changes no result. SQLite uses a partial index only when the query's WHERE holds the index's WHERE term, which these two queries do verbatim; other queries keep their plans. Projections, `PROJECTIONS`, `SCHEMA_VERSION` and the rebuild are untouched (`events` is not a projection). Write cost: one extra index entry for two events per session. An existing record builds it once at its next open (`db.exec(DDL)`, one scan of `events` on the core worker before `started`). `packages/record/test/record.test.ts:352` compares `sqlite_schema` before and after a refused open, which still matches. An older binary reading the file maintains the index like any other.

**Gain**: per `askingNow`, from O(events of each live session with an undelivered ask) to O(1) per ask. The call runs several times per turn on the core thread, which also serves held hook replies. Still O(asks) + O(deliveries) per call (table scan plus the NOT IN list); that part is unchanged.

**Proof plan**: `tests/acceptance/824/*` (asking set, churned sessions), `tests/acceptance/18/**` and `19/**` (a stop held only with an ask). Measure with the scratch script's method: a counting SQL function ahead of the `kind` test, rows stepped before and after.

**Risk**: low to medium (a schema object added to every record). 1 line.

---

## F3 — The event loop walks the repo's folder tree inside the hook handler — problem CONFIRMED, fix PLAUSIBLE

**Applied after this write-up, in this PR, with F4.** The read is `scopedAt` in `rules.ts`, called from `parser.ts` outside `parseLine`, so `hookmap.ts` and `spool.ts` are untouched and a hook replayed from the spool file does no read. `packages/hub/test/rules-hot-path.test.ts` fails on the code before it (6 `fs.readdirSync` from `Hub.rulesAt`). One claim below is wrong: other sessions' acknowledgements still wait, since the one small-line parser does the walk and their lines are parsed after it. What no longer waits is the rest of the event loop.

**Where**: `packages/hub/src/server.ts:764` (called before the acknowledgement at `:803-804`), `:964-988` (`rulesAt`); `packages/hub/src/rules.ts:225-231` (`cachedRuleFiles`, 3 s), `:134-151` (`readRuleFiles`), `:107-126` (`repoFiles`: recursive `readdirSync`, up to 50,000 entries), `:70-76` (`repoRoot`), `:241` (`readHeld`).

**What**: on every `PreToolUse` of a Claude Code or Codex session whose input names `file_path`, `notebook_path` or `path` inside a git repo (Read, Edit, Write, Grep, Glob, NotebookEdit), `rulesAt` runs on the hub's main thread. When the repo's rule-file list is older than 3 s it re-walks the tree synchronously, then reads each rule file. In this checkout one refresh is **3,371 `readdirSync` calls over 13,083 entries** plus 2 file reads (`walk01.mjs`, same skip rules as `repoFiles`). Every other session's hook waits behind it, and deep-hook gives up on an acknowledgement after about 20 ms.

This breaks two things the design states: the Hot path row (`docs/technical-design.md:2502`, the event loop never "scans folders") and #16's AC14 ("a preload that records `child_process` calls, directory reads and process listing on the hub's main thread finds none"). `tests/acceptance/16/hotpath-ac14-redraft.test.ts:27-36` sends only `Bash` calls, whose input has no path, so `callPaths` is empty and the walk never runs under the test.

**Change** (needs its own issue; it touches #344's delivery and #16's criterion): do the reading where lines are already parsed off the loop.
- `hookmap.ts`/`parser.ts`: for a `PreToolUse` with a call, compute in the parser worker what `rulesAt` computes from the file system: `repoRoot`, `callPaths`, the 3 s `cachedRuleFiles` (the cache lives in the worker), `readHeld`, the scoped rules that cover the call's paths (`scope !== 'all'`, `native !== own`, `covers`), and the `before` list for a rule-file edit. Put only those on `HookMeta` (usually nothing).
- `server.ts`: keep the per-session `rulesHeard` filter, the `blocked` and `watchOnly` tests and the `meta.rules` it posts to the core. No `fs` call is left in `rulesAt`.
- `spool.ts` replays through `parseLine` on the core thread and must not do this read (a replayed hook gets no notice): pass a flag only the socket parser sets.

**Why it should be safe**: the reply to the hook still waits for the same read, so it carries the same notice. The list is still at most 3 s old. `rulesHeard` stays in one place. What can differ: the two parser workers (small and big lines) each hold a cache, so a rule file edited through a tool call invalidates one of them and the other is up to 3 s stale (lines over 1 MiB only); and a `watchOnly` session's rule-file edit now also drops the cache, which only makes it fresher. The hook that triggers the walk is still late; the gain is that the main thread and every other session's acknowledgement no longer wait. Marked PLAUSIBLE because I could not run #344's and #16's suites.

**Gain**: removes up to 50,000 directory entries of synchronous reads from the event loop per 3 s per active repo. Unmeasured in time; the count is above.

**Proof plan**: #16 AC14's preload with one `Read` call added to the plan must record a directory read on today's main and none after (that is a new test for the new issue, not an edit of the existing one). `tests/acceptance/344/deliver.test.ts` (AC9 scoped notice, once, again after compact) and `proposal.test.ts` (AC4 removed rule line) pin behavior.

**Risk**: medium. About 80 lines across `hookmap.ts`, `parser.ts`, `server.ts`, `wire.ts`, `spool.ts`.

---

## F4 — `rulesAt` rebuilds every rule (one SHA-256 each) and re-reads the held file on each call — CONFIRMED

**Applied after this write-up, in this PR, with F3**: the memo lives in the parser worker (`scopedAt`), keyed by the cached file list and the held file's inode, size and time. Over 100 `Read` hooks: 2,100 `createHash` calls on the main thread before, none after, and 21 per refresh in the worker.

**Where**: `packages/hub/src/server.ts:981`; `packages/hub/src/rules.ts:154-183` (`rulesOf`), `:44` (`ruleId`: `sha256`), `:47-48` (`tokensOf`), `:51-65` (`globMatches`: `new RegExp` per glob part per call), `:241` (`readHeld`).

**What**: independent of F3 and appliable now. Each `PreToolUse` with a path calls `rulesOf({ files, typed: [], held: readHeld(dir), guards: [] })`: a `readFileSync` + `JSON.parse` of `rules-held.json` (or a failed open), then per rule bullet a SHA-256, three regex replaces and a tokenizing regex. The inputs change only when the 3 s file list is replaced or the held file is rewritten. `globMatches` compiles a `RegExp` per scoped rule per path per call; the same function runs per event row in `reachOf` (`rules.ts:269`).

**Change**:
```ts
// rules.ts — export the path, cache compiled globs
export const heldFile = (dir: string): string => join(dir, 'rules-held.json');
const GLOBS = new Map<string, RegExp[]>();
function globMatches(glob: string, path: string): boolean {
  let res = GLOBS.get(glob);
  if (!res) {
    res = glob.split(',').map((g) => g.trim()).filter(Boolean).map((g) => { /* the existing loop that builds `re` */ return new RegExp(`^${re}$`); });
    if (GLOBS.size >= 1024) GLOBS.clear();
    GLOBS.set(glob, res);
  }
  const p = path.replace(/^\.\//, '');
  return res.some((re) => re.test(p));
}

// server.ts — built once per file list and held file, not per call
private rulesBuilt = new WeakMap<RuleFile[], { held: string; rules: Rule[] }>();
private rulesOfFiles(files: RuleFile[]): Rule[] {
  const held = fileKey(heldFile(this.root.dir));
  let built = this.rulesBuilt.get(files);
  if (!built || built.held !== held) this.rulesBuilt.set(files, built = { held, rules: rulesOf({ files, typed: [], held: readHeld(this.root.dir), guards: [] }) });
  return built.rules;
}
// :981
const notices = blocked ? [] : noticesFor(this.rulesOfFiles(files), paths, meta.agent, heard);
```

**Why it is safe**: `rulesOf` is a pure function of its argument. `cachedRuleFiles` returns the same array until it re-reads or `rulesAt` deletes the entry (`:976`), so the `WeakMap` key changes exactly when the files do. `saveHeld` writes a temp file and renames it (`rules.ts:237`), so the held file's inode and mtime change with its content, which `fileKey` (`server.ts:196`) reads. `noticesFor` filters and only mutates `heard`; nothing writes to a `Rule`. The compiled regexes have no `g` or `y` flag, so `test` keeps no state. If F3 lands, the same memo moves to the parser with it.

**Gain**: per `PreToolUse` with a path, on the event loop: from one file read and parse plus R hashes and R×P regex compiles to one `statSync`. R is 21 in this repo; it grows with nested rule files. Unmeasured.

**Proof plan**: `tests/acceptance/344/deliver.test.ts` AC9, `proposal.test.ts` AC4, `reach.test.ts` AC10 (the glob matcher through `reachOf`). Count `createHash` calls on the main thread over 100 `Read` hooks: 100×R before, R after.

**Risk**: low. About 20 lines.

---

## F5 — `sessionStates` writes the touched session IDs into its SQL, so no state pass reuses a statement — cost CONFIRMED, fix needs one decision

**Where**: `packages/hub/src/status.ts:57` (`of`), used in 8 queries at `:64-89` and `:157`; called from `packages/hub/src/core.ts:2777` 200 ms after appends (`:2758-2765`); the statement cache at `packages/record/src/index.ts:273-282,774-787` (`READS_KEPT = 256`, least recently used out).

**What**: with `only` set, each of the 8 queries carries `IN ('id1', 'id2', …)` as text. A pass whose touched set differs from earlier ones prepares 8 new statements and evicts 8 others. With one active session the text repeats; with K sessions there are up to 2^K − 1 sets, so from about five concurrently active sessions the 256 slots are mostly state-pass statements used once, and the core's other reads get recompiled.

**Change**: bind the list as one JSON parameter.
```ts
const ids = only ? [JSON.stringify([...only])] : [];
const of = (column: string) => (only ? ` AND ${column} IN (SELECT value FROM json_each(?))` : '');
// each query: query(`…${of('session_id')}…`, ids)
```
Checked in `eqp01.mjs`: with `INDEXED BY events_session` the bound form plans as `SEARCH events USING INDEX events_session (session_id=?)`, as the inline form does, and returns the same rows; an empty list returns none.

**The decision**: `query` is typed `(sql: string) => Promise<unknown[]>` and `packages/hub/test/session-states.test.ts:141` passes `(sql) => record.raw(sql)` with `only` set. A bound parameter that lambda drops makes better-sqlite3 throw. Either `sessionStates` keeps the inline text when `query.length < 2` and binds otherwise (no test changes; `core.ts:2777` and `:5828` pass `(sql, params) => this.record.raw(sql, params)`, `status.ts:369` passes `(sql, params = []) => db.prepare(sql).all(...params)`), or the test's lambda forwards its second argument, which is an edit to a test and needs approval.

**Why it is safe**: same predicate, same index, same rows. `readsLogged` (`core.ts:7891`) already logs bound values after the SQL.

**Gain**: 8 statement compiles per state pass avoided (at most 5 passes a second under load) and the cache stops churning. Unmeasured.

**Proof plan**: `packages/hub/test/session-states.test.ts` (all six cases; line 141 compares `only` with the full read), `tests/acceptance/992/*`. Count `db.prepare` calls over 100 passes with 6 sessions touched in random subsets.

**Risk**: low to medium. About 15 lines.

---

## F6 — The once-a-second ask check compiles a new statement every second — CONFIRMED

**Where**: `packages/hub/src/core.ts:973`.

**What**: `` `… AND (deadline <= ${this.now()} OR kind = 'unblock') LIMIT 1` `` runs each second that no stop or verdict landed, which is every idle second. The clock is in the text, so each run is a new statement and one eviction from the 256-slot cache; an idle hub turns the whole cache over every 256 s.

**Change**:
```ts
return (await this.record.raw(`SELECT 1 FROM asks WHERE status IN ('open', 'later') AND (deadline <= ? OR kind = 'unblock') LIMIT 1`, [this.now()])).length > 0;
```

**Why it is safe**: same comparison on an INTEGER column with an integer bound; `raw` binds parameters (`index.ts:786`). No test reads this SQL's text (`DEEP_HUB_TEST_READS` readers in `tests/acceptance/823` filter by ask or run ID).

**Gain**: one prepare and one finalize a second on an idle hub, and statements used less than once in four minutes stay compiled. Small.

**Proof plan**: `tests/acceptance/908/*` and `/318/*` (defaults at deadline). Count prepares over 60 idle seconds: 60 before, 1 after.

**Risk**: low. 1 line.

---

## F7 — The minute state pass re-reads every session in history — PLAUSIBLE

**Where**: `packages/hub/src/core.ts:1036` (`this.touched = 'all'` every 60 s), `:2771-2788`; `packages/hub/src/status.ts:64-89,157`.

**What**: with `only` unset, one pass reads every `sessions` row, every open ask, every `session.gone`, every `promise.*` and `session.end` event (parsed in JS), every `session.reading` event three times with `json_extract` + `LIKE`, and every `agent.stop` with `json_extract`. Events are never retained away, so this grows with history and runs on an idle hub once a minute, synchronously on the core thread. The pass exists for states that change with time alone. Reading `status.ts:98-112`, only four recorded states have a clock in their test: `needs you/waiting`, `working/working`, `finished/finished`, `finished/interrupted` (the first by 5 minutes, the rest by 24 hours). After a day a session is `quiet/quiet` and stays so until an event of its own.

**Change**:
```ts
// core.ts:1036
this.every('states', 60_000, async () => {
  if (this.touched !== 'all') for (const [id, state] of this.states) if (state !== 'quiet/quiet') this.touched.add(id);
  this.stateSoon();
});
```
The first pass after start stays `'all'` (`:703`), as does a pass after a failed one (`:2785`) and any pass after an append with no session (`:911`).

**Why it might not be safe**: the full pass is also the net under an event of session A that changes session B's reading without touching B. I found none (asks are raised under their own session; an answer from the app or CLI has no session and already forces `'all'`), but I did not trace every appender in `packages/asks`, `leases` and `supervisor`. Keeping every non-quiet session in the pass, not only the four clocked states, bounds the exposure to sessions already quiet.

**Gain**: per idle minute, from O(all history) to O(sessions seen in the last day), through `events_session`. Estimated, not measured.

**Proof plan**: `packages/hub/test/session-states.test.ts` ("a permission prompt with no hook for 5 minutes reads quiet", and the `only` against full comparison at line 121), `tests/acceptance/992/*`, `/990/status.test.ts`. I found no existing test of the 24-hour quiet step through the hub's minute pass, so that needs a failing check written first. A count of rows stepped per pass on a record with 1,000 quiet sessions and 5 live ones.

**Risk**: medium. About 5 lines.

---

## F8 — `turn_events` and the per-event `turns` write serve only `record.session()`, which no shipped code calls — PLAUSIBLE, owner's call

**Where**: `packages/record/src/projections.ts:70-71` (tables), `:663-665,713-714` (two upserts per session event), `packages/record/src/index.ts:722-732` (the one reader). Hub opens with `commitEach: true` (`packages/hub/src/core.ts:903`).

**What**: a hook `tool.before` with one path runs 7 statements in its commit: the ID check, the `events` insert, two on `sessions`, `turn_events`, `turns`, `session_files`. `turn_events` gets one row per session event (the largest projection by rows) and `turns` is rewritten per event for `last_seq`/`last_id`, which only order `turn_events`. The only reader is `SqliteRecord.session()` (a full scan: `turn_events` has no index on `session_id`), and a grep of `packages/*/src` and `crates` finds no caller; it is called from `packages/record/test`, `packages/budget/test` and `tests/acceptance/{14,86,159,315,318,990}`. Because the hub commits each event alone, each of these rows is also its own WAL frames.

**Change (sketch, not appliable as is)**: keep `turns` (recovery reads `stopped`, `index.ts:401`; "clock went back" reads `stop_seq`) but write it only when a turn opens, stops or is numbered; drop `turn_events` and `last_seq`/`last_id`; have `session()` fold the session's events in `log_pos` order through the same `turn()` logic on demand. `Projector.ensure` sees the changed columns and rebuilds once.

**Why it is risky**: it rewrites a projection that #14's acceptance tests (`turns.test.ts`, `property.test.ts`) read through `session()`, and a record rebuilds at its next open. A smaller variant, `WITHOUT ROWID` on `turn_events`, `turns` and `session_files` (one B-tree per upsert instead of two; new and rebuilt records only), is also unmeasured.

**Gain**: 2 of about 7 statements and roughly 2–3 of about 10 dirtied pages per session event; one row of about 150 bytes per event off the 1 GB record budget. Estimated from the DDL, not measured.

**Proof plan**: `tests/acceptance/14/turns.test.ts` and `tests/acceptance/14/property.test.ts`. Count statements run per appended `tool.before` (a wrapper on `db.prepare(...).run`) and `PRAGMA page_count` after 100k events.

**Risk**: high. 60–100 lines.

---

## F9 — A hook line is copied three times on its way to the parser — PLAUSIBLE, small

**Where**: `packages/hub/src/server.ts:671-674` (`Buffer.from(parts[0])` or `Buffer.concat`), `:286-292` (`postMessage` with no transfer list), `packages/hub/src/parser.ts:11-15`.

**What**: a line under 1 MiB is copied out of the socket chunk on the event loop, serialized by `postMessage` (second copy, also on the loop), and materialized in the worker (third). `Buffer.from` and `Buffer.concat` take lines under 4 KiB from Node's 8 KiB pool, and structured clone copies the whole backing `ArrayBuffer`.

**Change**: allocate the copy unpooled and transfer it: `const copy = Buffer.allocUnsafeSlow(size)`, fill from `parts`, `worker.postMessage({ n, chunks: [copy], first }, [copy.buffer])`.

**Why it needs care**: the `log-raw-command` plant (`server.ts:675-678`) re-reads `chunks` after the parse; a transferred buffer is detached, so the plant must copy first or the pool must not transfer under that plant. `parserInline` reads `chunks` in place and is unaffected.

**Gain**: two of three copies of every hook line, both off the event loop's time. Up to 2 MiB of memcpy for the largest small line; tens of bytes to a few KiB typically. Unmeasured.

**Proof plan**: `tests/acceptance/16/hotpath-ac19-redraft.test.ts` and the plant's own test; count bytes copied per line.

**Risk**: low to medium. About 10 lines.

---

## F10 — The command history on the event loop is bounded by entries, not bytes — PLAUSIBLE, small

**Where**: `packages/hub/src/waits.ts:16-17,51-53,56-66`; fed from `packages/hub/src/server.ts:559,771` with `draft.data.command`.

**What**: `History` keeps 2,000 commands, each keyed by its whole text. The command is the parser's scrubbed copy, not cut (the record cuts at 8,192 when it appends), so a heredoc of 100 KB is a 100 KB key, and `historyKey` runs `trim().replace(/\s+/g, ' ')` over it on the event loop at both hooks of the call.

**Change (needs a decision)**: key on the first 8,192 characters, the same cut the record applies, which also makes a live key equal the one `waitsState` restores from the record after a restart. Observable: two commands that differ only past 8,192 characters would share an expected time.

**Gain**: worst case from 2,000 × command size to 2,000 × 8 KiB on the main heap. Typical commands are far smaller.

**Risk**: low; it changes one expected-time estimate in an edge case, so not applied without a yes.

---

## Observations with no edit proposed

- **Per-claim and per-run maps in `core.ts` are never pruned**: `claimRequirements`, `claimScopes`, `paidChecks`, `lanes`, `told`, `kindChecks`, `watchOnlyClaims`, `unresolvedTargets`, `expected`, `verdictsMade` (scripted count: no `delete` or `clear`). A few KB per claim for the hub's lifetime. Pruning needs to know when `gate.rerun` can no longer ask for a claim; I did not trace that.
- **Parsed transcript lines are held per session**: `session.entries` keeps up to 5,000 parsed lines of the current turn and `session.prompts` 256 prompt lines (`core.ts:230-232,5317-5321`), for every live session and the 64 newest ended ones (`ENDED_KEPT`). The adapters read them at a stop (`:1976`), so slimming them means knowing every field the facts read. Unmeasured; likely the largest live-session memory after F1.
- **The record keeps two parsed-transcript caches of 32 MiB of source bytes each** (`learned.ts:457-529`), and parses every archived copy as it lands (`index.ts:519-522`) to hold #1098 AC5's 20 ms. The bound is in source bytes, the newest is kept whatever its size, and the parse is synchronous on the core thread. Worth a reading against the 150 MB row.
- **The design says batched WAL writes; the hub commits each event alone** (`core.ts:901-903`, since #16). The record's batch path (`index.ts:600-630`) runs only under tests, scripts and benchmarks. Deliberate for fault injection; it is why per-event pages (F8) matter, and `wal_autocheckpoint` is at its default of 1,000 pages with `fullfsync` on.
- **One `ps` per watched session per 30 s** (`core.ts:2701-2708`, `children.ts:49-52`): 30 idle sessions is one spawn a second from the children thread. A single `ps -o pid=,lstart= -p a,b,c` per tick would do; exit status with some PIDs gone differs by platform, so not specified here.
- **Git HEAD is read twice per verified hook**: `siblings.hook → placed → headOf` (`siblings.ts:327`) and `follow → commits → headOf` (`core.ts:2832`), 5–7 async file reads each, off the acknowledgement's path.
- **`meta` is cloned to the core twice for a held hook**: once in `op: 'hook'` and again in `hook-reply`, `tool-gate` or `permission` (`server.ts:808,901,926,1055`). `meta.printed` and `meta.ran.stdout` can be the same 64 KiB twice (`hookmap.ts:342-352`); the loop reads neither.
- **The event-loop thread imports `memory.ts` and `heavy.ts` for two one-line pure helpers** (`reaches`, `heavyDenial`; `server.ts:22,26`), which pulls in `@deepbuild/archive` and `products.ts`. No built output here, so no heap number.

## core.ts: concerns that could leave with a narrow interface

The last audit's two do not hold today. Spool replay is already out (`spool.ts`, #1687); what stays in `core.ts` is `replayLate` (`:1484-1513`), which is the queue's own ordering. Evidence attachment is `stored`, `keep`, `attach`, `paste` (`:7215-7218,7643-7684`): about 45 lines with no state of their own, so moving them moves lines only.

Two that do qualify:

1. **Your rules (#344)**, `core.ts:4109-4304` (about 195 lines): `filesOf, typedRules, heldRules, allRules, startSet, ruleStateOf, delivered, startRules, saveTyped, promptRules, ruleHook, holdRemoved, syncRules, ruleGuards, ruleLessons, removeRule, sessionRules`. Own state (`ruleState`, `ruleFiles`), own lifetime (per session, dropped at `SessionEnd`, `:1452`). It reaches the rest of the class through `record` (raw, keep, startSlice), `root.dir`, `now`, `connection`, `append`, one read of the routes' folders, `wikiBuild.writeRules` and `propose`; the class reaches it at 8 sites. Same shape as `holds.ts`, `stacks.ts` and `spool.ts`.
2. **Transcript reading and cursors**, `core.ts:5262-5416` (about 155 lines): `readTranscript` and `endTurn` use nothing of the class but `options.plant` and could be free functions over a `Session` today; `judge`, `saveCursors`, `writeCursors` need the cursor map, the save timer, the transcripts file, `appendReading`, `queue` and whether a replay is pending.

The promises block (`:2146-2287`) has its own state too but touches routes, sessions, live, asks and attention and is touched from 9 places; it does not have a narrow interface.

## Dispositions

| Package / file | Disposition |
|---|---|
| `packages/hub/src/core.ts` | F1, F6, F7; consumer of F2 and F5; observations; two seams named |
| `packages/hub/src/server.ts` | F3, F4, F9 |
| `packages/hub/src/rules.ts` | F3, F4 |
| `packages/hub/src/hookmap.ts`, `parser.ts` | keep as is; receive F3's read if it lands |
| `packages/hub/src/status.ts` | F5 (F7's reasoning reads it) |
| `packages/hub/src/waits.ts` | F10; otherwise keep |
| `packages/hub/src/core-worker.ts`, `settle.ts`, `children.ts`, `children-worker.ts`, `spool.ts`, `wire.ts`, `paths.ts`, `session-facts.ts` | keep |
| `packages/hub/src/holds.ts`, `guards.ts`, `scope.ts` | keep (gate-time; grepped for sync I/O and spawns only, not read line by line) |
| `packages/record` | F2 (one index), F8 (owner's call); statements are prepared and cached, lifecycle gate does no SQL for hook kinds; otherwise keep |
| `packages/evidence` | keep: the scrubber is a one-pass bitmap prefilter with cached tables and rules compiled once per thread |
