# 03 — process and plug-in machinery (extension-host, supervisor, runner, env-local, workspaces, sources, archive)

Read-only audit at main 6a6d6b4f. Nothing was built, run or timed; counts come from reading the code and one counting script (`scratchpad/a03/count.mjs`, comparator calls only). Paths are relative to the repo root. Ranked by gain over risk.

Two things the brief asked about turned out fine and are not findings:

- **JSON-RPC framing for sandboxed extensions is linear.** `packages/extension-host/runtime/deep.mjs:318-334` holds a line's chunks in a list and joins once per line, with a 16 MiB frame cap and a 256 in-flight cap. No re-parsing: one `JSON.parse` per line. (F10 removes one copy per single-chunk line; that is all.)
- **Per-load state is freed on unload** (`host.ts:2341-2367`): handlers, routes, the HTTP listener, adapter fills, resolver, leases, the run and the folder copy. What stays is keyed by package or source and bounded by what is installed (`loadResults`, `storeItems`, `Sources.cache`, `SeriesStore.latest`); freeing those would change what `loadResult`, `deep.store.get` and live bound values answer, or race an in-flight `deep.store.put`, so I do not propose it.

---

## F1 — `Sources.recorded` keeps every source call's whole answer for the hub's life (library files included)  · CONFIRMED

**Where**: `packages/extension-host/src/sources.ts:272` (`recorded`), `:521` (push), `:288-290` (`recording()`); producers `:327`, `:393`, `:484`; hub callers `packages/hub/src/libraries.ts:148,176,196,285`.

**What**: every live call pushes `{ source, request, answer: structuredClone(answer) }` and nothing ever removes one. `recording()` has no production caller (repo-wide grep: only `tests/acceptance/364/replay.test.ts:34`, `tests/acceptance/366/ac1-build.live.test.ts:92`, `packages/extension-host/test/sources.test.ts:258`). In the hub the array only grows: each polled read and work/library call keeps up to 1 MiB of body, and `libraryFile` (hub `libraries.ts:176,285`) keeps the whole downloaded asset as a base64 string (cap `FILE` = 512 MiB, `sources.ts:78`). A few fetched assets put the hub past its 150 MB budget permanently. `structuredClone` also makes a second copy of that string at push time.

**Change** (two steps):

1. Behavior-preserving, do now. The answer is already a fresh object from `scrubAnswer` with string headers and a string body, so a shallow copy isolates it as well as a deep one:
   ```ts
   // sources.ts:521
   - this.recorded.push({ source: source.name, request: stripped, answer: structuredClone(answer) });
   + this.recorded.push({ source: source.name, request: stripped, answer: 'error' in answer ? { error: answer.error } : { status: answer.status, headers: { ...answer.headers }, body: answer.body } });
   ```
2. The leak itself needs one observable change, so it is the owner's call: bound the recording to its newest calls, e.g.
   ```ts
   /** The recording keeps its newest calls, up to this many bytes of answers. */
   const RECORDED_BYTES = 16 * 1024 * 1024;
   private readonly sizes: number[] = [];
   private kept = 0;
   // after the push, with `bytes` as already computed at :516
   this.sizes.push(bytes); this.kept += bytes;
   while (this.kept > RECORDED_BYTES && this.recorded.length) { this.recorded.shift(); this.kept -= this.sizes.shift()!; }
   ```
   **Observable**: `recording()` (and `ExtensionHost.recording()`, doc at `host.ts:340`) returns the newest calls, not every call; a replay of a cut recording answers `no recorded call answers …` for a dropped call, never wrong bytes. A single answer over the cap is not kept.

**Why safe**: step 1: `answer` is `{ error }` or `{ status, headers, body }` (`:517-519`); headers come from `scrubAll` (`:532-534`), a fresh object of strings; strings are immutable; `recording()` deep-clones on the way out anyway. Replay (`:502-508`) never pushes. Step 2: the three callers of `recording()` make under ten small calls.

**Gain**: step 1 removes one serialize+deserialize of every answer body (up to hundreds of MB for a library file) and its transient duplicate. Step 2 turns unbounded growth into ≤16 MiB. Unmeasured; sizes follow from the caps.

**Proof plan**: `packages/extension-host/test/sources.test.ts` (recording holds no secret; replay), `tests/acceptance/364/replay.test.ts`, `tests/acceptance/1731/*`. Measure: `process.memoryUsage().heapUsed + external` after N `libraryFile` calls of a fixed size, before and after; it should stop growing with N.

**Risk**: step 1 low, 1 line. Step 2 low-medium, ~8 lines plus two doc comments.

---

## F2 — Every hook pays O(all jobs in the record): `runner.list()` copies them all and `whose` runs `path.relative` on each  · CONFIRMED (cross-area: runner + hub)

**Where**: `packages/runner/src/runner.ts:325-327` (`list`), `:173-177` (every `job.recorded` in the log becomes a `Job` at open), `packages/hub/src/core.ts:5423-5435` (`whose`), called at `core.ts:1573` for every hook line the hub takes in (bar a replayed line it already holds); `isUnder` at `core.ts:186-189`.

**What**: `whose` runs once per hook. It calls `runner.list()`, which spreads every job record the runner has ever seen (`[...this.jobs.values()].map((j) => ({ ...j.rec }))`); the runner loads every `job.recorded` since log position 0 at open and never forgets one. Then `whose` does three linear `find`s, the middle one calling `relative(dir, path)` per job. Cost per hook is J object copies plus up to J `relative` calls, J growing with the record. This sits on event intake (target 5,000 events a second) and on the hub's loop between hook replies.

**Change**:

1. Hub, exact and behavior-preserving (`core.ts:5429`):
   ```ts
   + // A folder holds only paths that start with it: `relative` runs for those alone, not once per job per hook.
   + const cwd = meta.cwd ? resolve(meta.cwd) : undefined;
   - const there = jobs.find((j) => meta.cwd && (meta.cwd === j.folder || isUnder(meta.cwd, j.folder)));
   + const there = jobs.find((j) => meta.cwd && (meta.cwd === j.folder || (cwd!.startsWith(j.folder) && isUnder(meta.cwd, j.folder))));
   ```
2. To drop the J copies too, the runner needs one narrow method with this one caller (a new member of `Runner` in `packages/runner/src/types.ts`), e.g. `near(session, cwd): Promise<JobRecord[]>` returning, in list order, copies of only the jobs whose `session` equals it or whose folder is a prefix of `resolve(cwd)`; `whose` then runs its three `find`s on that. A subsequence that contains every job matching any of the three predicates gives the same first match for each.

**Why safe**: step 1: `isUnder(p, d)` true means `relative(d, p)` is non-empty, not `..`-prefixed and not absolute, so `resolve(p)` starts with `resolve(d) + sep`; `j.folder` is `join(realpathSync(jobs), id)` (`runner.ts:275`), absolute and normalized, so `resolve(j.folder) === j.folder`. The prefix test is only a necessary condition; `isUnder` still decides. `resolve` is already imported in `core.ts:12`. Step 2 changes a public interface (one new method, one caller); `list()` stays as it is.

**Gain**: step 1 removes up to J `relative` calls per hook (each resolves and normalizes two paths), leaving J string prefix tests. Step 2 removes J object allocations per hook. Unmeasured; J is every job the record holds.

**Proof plan**: `tests/acceptance/159/*` (a job's hooks are the job's; a session in a job's folder is read as held or as its own). Count, not time: wrap `relative` or count `isUnder` calls per hook with 1,000 seeded `job.recorded` events; expect J before, about 0 after.

**Risk**: step 1 low, 2 lines. Step 2 low-medium, ~12 lines across two packages.

---

## F3 — The runner keeps every ended job's stdout and prompt for the hub's life  · CONFIRMED (the prompt part is behavior-preserving; the stdout part changes one observable)

**Where**: `packages/runner/src/runner.ts:125` (`jobs`), `:789` (`job.stdout += text`), `:328-330` (`output`), `:994-1005` (`finish`), `:176` (a recovered job's blank spec).

**What**: `this.jobs` never drops a job. Each keeps its whole stream-json stdout (tens of KB to MBs) and its `spec` (the prompt, which for `deep.runner.run` holds each input's content, `packages/extension-host/src/jobs.ts:29-40`). `output()` is read right after a job ends (`packages/hub/src/acceptance.ts:283`, `packages/reading/src/index.ts:287`) and by the `job.output` API.

**Change**:

1. Behavior-preserving: after a job ends nothing reads its spec but `spec.agent` and `spec.kind` (`read`/`event` at `:797,864`, `confirm` at `:983,988`). In `finish` after `job.end(r)`:
   ```ts
   + // Its prompt and grants are read only before it starts: an ended job keeps what a recovered one has (fold).
   + job.spec = { kind: job.spec.kind, agent: job.spec.agent, prompt: '' };
   ```
2. Owner's call (observable): keep stdout for the newest ended jobs only, as the supervisor keeps 64 cleaned runs (#824). In `finish`: push the job on a list; past 64, set the oldest's `stdout = ''`. **Observable**: `output(job)` of a job that ended more than 64 jobs ago answers `''` in the same hub process, as it already does after a restart (`:176`, `:257`).

**Why safe**: step 1: every other `job.spec.*` read is guarded by `rec.state === 'waiting'` (`pumpOnce :378`) or runs inside `launch`/`gate` before `finish`; `finish` is the only end (`refuse`, `confirm`, `cancel` call it). Do not clear `seen`, `pending` or `decoder`: a late stdout chunk can arrive after `finish` (the supervisor drains pipes for a second, `supervisor.ts:606`) and `read` uses them.

**Gain**: step 1 frees each ended job's prompt (bytes of the prompt, per job). Step 2 bounds stdout at 64 jobs' worth instead of every job since start. Unmeasured.

**Proof plan**: `packages/runner/test/runner.test.ts`, `tests/acceptance/159/*`, `tests/acceptance/1328/*`. Measure: heap after 200 fake jobs with a 1 MB prompt, before and after.

**Risk**: step 1 low, 1 line. Step 2 low-medium, ~5 lines.

---

## F4 — `Host.requests` keeps every action call's request ID and result forever  · CONFIRMED (fix changes one observable)

**Where**: `packages/extension-host/src/host.ts:3495` (map), `:3498-3510` (`callAction`), `:3516-3529` (`entered`); hub caller `packages/hub/src/core.ts:6856` passes a request ID on every agent call.

**What**: one entry per `(writer, request)` with the settled `ActionResult` (the action's whole output), never evicted.

**Change**: keep the newest settled ones; an older ID then answers as after a restart, which `entered` already defines.
```ts
+ /** How many settled request IDs answer from memory; an older one answers as after a restart (`entered`). */
+ const REQUESTS_KEPT = 1024;
- private readonly requests = new Map<string, { digest: string; result: Promise<ActionResult> }>();
+ private readonly requests = new Map<string, { digest: string; result: Promise<ActionResult>; settled: boolean }>();
  ...
- this.requests.set(key, { digest, result });
+ const kept = { digest, result, settled: false };
+ this.requests.set(key, kept);
+ void result.then(() => undefined, () => undefined).then(() => {
+   kept.settled = true;
+   for (const [old, r] of this.requests) { if (this.requests.size <= REQUESTS_KEPT || !r.settled) break; this.requests.delete(old); }
+ });
```
**Observable**: a retry of an ID more than 1,024 calls old: a change or send answers `{ status: 'done', output: null }` or its recorded refusal (from `action.entered`/`action.reported`), not the first output; a read runs again.

**Why safe**: an entry still running is never evicted (the loop stops at the first unsettled), so no call runs twice concurrently. Same-ID-other-input is still refused from the record for a change or send.

**Gain**: bounded at 1,024 results instead of one per agent action call since start. Unmeasured.

**Proof plan**: `tests/acceptance/363/*` (retry, same ID with other input, changed/reported), `packages/extension-host/test/host.test.ts`.

**Risk**: low-medium, ~8 lines.

---

## F5 — `walk()` in the warm stack allocates two Buffers per sort comparison, three times per check run  · CONFIRMED

**Where**: `packages/env-local/src/warm.ts:90`; callers `keysOf` (`:129`), `treeDigest` (`:98`), `built` (`:406`). `keysOf` runs at `packages/hub/src/stacks.ts:172`, again inside `WarmStack.serve` (`warm.ts:447`), and in `expectedStart` (`stacks.ts:248`).

**What**: `out.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))`. On this repo's own checkout (9,844 files after the skip list) a walk-order sort makes 63,255 comparisons, so 126,510 Buffer allocations in one synchronous sort on the hub's loop, per walk.

**Change**:
```ts
- return out.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
+ // Each path's bytes once: encoding both sides in the comparator makes two buffers per comparison.
+ return out.map((path) => ({ path, bytes: Buffer.from(path) })).sort((a, b) => Buffer.compare(a.bytes, b.bytes)).map((e) => e.path);
```
**Why safe**: same comparator on the same bytes; paths are unique, so stability does not matter. The counting script checked the two orders equal on this checkout. (Plain string order is not a substitute: UTF-16 and UTF-8 order differ above U+FFFF.)

**Gain**: 126,510 → 9,844 Buffer allocations per walk here (12.9× fewer), growing as n·log n vs n.

**Proof plan**: `tests/acceptance/580/*` (keys hold, change with their inputs), `packages/env-local/src/index.test.ts`. Count: `node scratchpad/a03/count.mjs <repo>` prints both counts and the order check.

**Risk**: low, 1 line.

---

## F6 — A supervisor opened on a long record keeps every past run in memory, and filters them ten times a second, until its first cleanup  · PLAUSIBLE

**Where**: `packages/supervisor/src/supervisor.ts:189-291` (`open` folds every run since position 0), `:843-849` (`forgetCleaned`, called only from `cleanupOnce :834`), `:654` (`scanOnce` spreads and filters `this.runs` every 100 ms).

**What**: `open` rebuilds a `Run` (a Map, a Set, two arrays) for every `process.starting` in the record. They are trimmed to the newest 64 only when some run is next cleaned. A hub that restarts and sits idle holds all of them and walks them at 10 Hz.

**Change**: after the crash-reap loop (`:288-291`), before `watchDenials`:
```ts
+ // What the record's past runs left in memory goes now, as it would at the first cleanup (#824).
+ this.forgetCleaned();
```
**Why safe**: it is the same trim the first cleanup does. For a forgotten run `status` and `cleanup` answer from the record (`recorded`, `:735-740`), `wait` rejects with the same text, and unfinished or lingering runs are kept (`:844`). What differs only until that first cleanup: `signal(run)` on a long-cleaned run throws instead of doing nothing, and `start` would accept a reused run ID (IDs are fresh ULIDs).

**Check I could not do**: run `packages/supervisor/src/supervisor.test.ts`, `tests/acceptance/236/*`, `tests/acceptance/824/*` to confirm none signals or restarts a pre-restart cleaned run before any cleanup.

**Gain**: memory and per-scan work drop from every run in the record to at most 64 plus live ones, from the moment the hub opens. Unmeasured.

**Risk**: low, 1 line.

---

## F7 — While any sandboxed run is alive the hub spawns two processes every 100 ms  · PLAUSIBLE (no small safe step; one sound design given)

**Where**: `packages/supervisor/src/supervisor.ts:25` (`SCAN_MS = 100`), `:295-297` (timer), `:651-668` (`scanOnce`), `packages/supervisor/src/procs.ts:93-101` (`scan`: helper spawn), `:63-73` (`table`: `ps` spawn), `packages/supervisor/native/helper.c:45-66` (one `sandbox_check` per process on the machine, per scan).

**What**: a loaded sandboxed extension, a hosted terminal's host, a warm stack's lease shell (`warm.ts:207`) and a `deep env up` stack are each a live run for hours. For as long as one exists, every scan runs the helper and then, because that run's own process is always found, `ps -p …` as well: up to 20 spawns a second (72,000 an hour) on the hub's loop, each scan also touching every process on the machine. The design's idle budget is 0.5% of a core.

**Change**: none that is small and exact. The interval and the start-time proof are the design's (`by ID and start time`). A sound reduction that keeps both: have the helper print each process's raw start time (macOS: `pbi_start_tvsec`/`pbi_start_tvusec`, already in the struct at `helper.c:59-61`; Linux: field 22 of the `stat` line it already reads at `helper-linux.c:98`), and let `scanOnce` skip `ps` when the scan's lines, plus the current time-zone offset, equal the last scan whose `ps` pass finished without a new `track`. `procs.ts:scan` reads only the first two fields, so a fifth is compatible. The time-zone term matters: `lstart` is a local-time string, and today a zone change is healed by the next scan re-tracking; a memo without it would leave `provable` (`:687`) refusing the run's own processes.

**Why not now**: two C helpers (one cannot be tested on this Mac) and a proof that guards what the supervisor may kill. Medium risk; needs `packages/supervisor/src/suite.ts` and `tests/acceptance/236/*` on both platforms.

**Gain**: halves steady-state spawns (helper only). Anything further (a longer interval once a run is quiet) changes how soon a fork is tracked and is the owner's call. Unmeasured.

**Proof plan**: count spawns, not time: wrap `scan` and `table` with counters, hold one sandboxed `sleep 30` run for 10 s; expect about 100 + 100 now, 100 + 1 with the memo.

**Risk**: medium, ~25 lines in three files.

---

## F8 — Each Claude Code job with a deadline reads the Keychain twice (two `security` processes)  · PLAUSIBLE

**Where**: `packages/runner/src/runner.ts:428-436` (`outlives` → `parts.expires`), `:724` (`launch` → `parts.token`), `packages/runner/src/agents.ts:106-119` (both parse the same item), `packages/hub/src/keychain.ts:10-17` (each read is an `execFile('/usr/bin/security', …)`).

**What**: `gate` and `launch` run back to back in one pump pass (`:380-391`); both read `Claude Code-credentials`. One of the two spawns is redundant. This is on the job-start path the Oct 24 pass cut to 135 ms; the benchmark does not see it because it runs without a keychain.

**Change**: one read per gate attempt, shared with its launch.
```ts
// Job
+ /** This gate's Keychain reads by service: its launch hands on the token its gate read. */
+ keychain?: (service: string) => Promise<string | undefined>;
// gate(), first lines
+ const keychain = this.o.keychain;
+ if (keychain) { const read = new Map<string, Promise<string | undefined>>(); job.keychain = (service) => read.get(service) ?? read.set(service, keychain(service)).get(service)!; }
// outlives(): this.o.keychain → job.keychain (two places)
// launch() :724: this.o.keychain → job.keychain (two places)
```
**Why safe**: still "read fresh for each job" (`types.ts`): the memo lives for one gate attempt. The token's own expiry test (`agents.ts:111`) still runs at launch on the same value. Both callers already swallow a rejection. **What could differ**: a sign-in that changes in the milliseconds between gate and launch is seen at the next job.

**Check I could not do**: `packages/runner/test/runner.test.ts` (token handed on; expired sign-in hands none) and `tests/acceptance/159/*`; their keychain stubs are static, so I expect no change.

**Gain**: one process spawn fewer per such job. Unmeasured.

**Risk**: low, ~6 lines.

---

## F9 — `keysOf` walks and hashes the checkout twice per warm-stack run  · PLAUSIBLE (cross-area: env-local + hub)

**Where**: `packages/hub/src/stacks.ts:172` and `packages/env-local/src/warm.ts:447`; `keysOf` at `warm.ts:127-137` (a full walk, then every Dockerfile, manifest and lockfile, and every path matching `migrat` or `seed`, read and hashed).

**Change**: pass the keys the hub just computed.
```ts
// warm.ts:445
- async serve(r: { run: string; folder: string; worktree: string; fresh?: boolean; base?: boolean; began: number }): …
+ async serve(r: { run: string; folder: string; worktree: string; keys: Keys; fresh?: boolean; base?: boolean; began: number }): …
- const keys = await keysOf(r.folder);
+ const { keys } = r;
// stacks.ts:190
- const serving = await w.stack.serve({ run: r.run, folder: r.folder, worktree: r.worktree, began, …
+ const serving = await w.stack.serve({ run: r.run, folder: r.folder, worktree: r.worktree, keys, began, …
```
**Why safe**: one caller (`new WarmStack` only at `core.ts:843`). **What could differ**: today the stack's keys are read after the wait for a slot and `stack.open`; with the change they are the ones the hub compared with `servicesKey`. They differ only if the run's checkout changes in between.

**Check I could not do**: whether a run's checkout can change between `stacks.ts:172` and `:190`; `tests/acceptance/580/*`.

**Gain**: one walk plus one read-and-hash of every keyed file fewer per run (with F5, 9,844 `readdir` entries here).

**Risk**: low-medium, 3 lines in two packages.

---

## F10 — Framing copies: one needless copy per JSON-RPC line, and a terminal link that re-copies a frame per chunk  · CONFIRMED

**Where**: `packages/extension-host/runtime/deep.mjs:323-324`; `packages/extension-host/src/terminals.ts:294,302-307`.

**What**: (a) `peer` does `Buffer.concat(held)` even when the line arrived in one chunk, which is the usual case: one allocation and copy per message on both sides. (b) The terminal link does `buf = Buffer.concat([buf, data])` on every chunk, so a frame of k chunks is copied k(k+1)/2 chunk-sizes. Frames are the `S` screen answers: screen plus 1,000 scrollback rows (`native/pty.c:31`), typically 100–300 KB (2–5 chunks), at most a few MB at 1,000 columns.

**Change**:
```js
// deep.mjs:324
- const line = Buffer.concat(held).toString('utf8');
+ const line = (held.length === 1 ? held[0] : Buffer.concat(held)).toString('utf8');
```
```ts
// terminals.ts, in link()
  let buf: Buffer = Buffer.alloc(0);
+ /** Chunks of a frame not yet whole: joined once, when its head says all of it is here. */
+ let parts: Buffer[] = [];
+ let held = 0;
  socket.on('data', (data: Buffer) => {
-   buf = buf.length ? Buffer.concat([buf, data]) : data;
+   parts.push(data);
+   held += data.length;
+   const have = buf.length + held;
+   if (have < 5 || (buf.length >= 5 && have < 5 + buf.readUInt32LE(1))) return;
+   buf = buf.length ? Buffer.concat([buf, ...parts], have) : parts.length === 1 ? data : Buffer.concat(parts, have);
+   parts = [];
+   held = 0;
    while (buf.length >= 5 && …) { /* unchanged */ }
```
**Why safe**: (a) same bytes decoded; a multi-byte character split across chunks still goes through `concat`. (b) the loop sees the same byte sequence; the join is only deferred until a whole frame can be there. A frame is copied at most twice (once when its 5-byte head completes, once when it is whole).

**Gain**: (a) one Buffer allocation and copy fewer per message. (b) bytes copied per frame go from O(k²) to O(k) chunk-sizes; small for typical tabs, large only for very wide ones.

**Proof plan**: `packages/extension-host/test/host.test.ts`, `tests/acceptance/348/*` (wire), `tests/acceptance/989/*` and `/104/*` (tab, resize, read). Count `Buffer.concat` calls per `tab()`.

**Risk**: low; 1 line and ~8 lines.

---

## F11 — `SeriesStore.names` has no bound  · PLAUSIBLE

**Where**: `packages/extension-host/src/series.ts:175` (map), `:197` and `:294` (the two sets).

**What**: one decoded `Map<name, index>` (up to 10,000 entries) per distinct set of names, for the hub's life. A series source whose names change from call to call adds one per call (while-shown cadence is 10 s at the fastest). The plug-in controls the growth.

**Change**: keep the newest, bounded by names in all.
```ts
+ /** Decoded names files kept: the newest, up to this many names in all. */
+ const NAMES_KEPT = 100_000;
+ private namesHeld = 0;
+ private keepNames(sha: string, index: Map<string, number>): void {
+   this.namesHeld += index.size - (this.names.get(sha)?.size ?? 0);
+   this.names.delete(sha);
+   this.names.set(sha, index);
+   for (const [old, m] of this.names) { if (this.namesHeld <= NAMES_KEPT || old === sha) break; this.names.delete(old); this.namesHeld -= m.size; }
+ }
// :197 and :294: this.names.set(x, y) → this.keepNames(x, y)
```
**Why safe**: it is a decode cache; a miss re-reads the names file from evidence and checks its hash (`indexOf :288-296`). Leave `namesPut` alone: dropping an entry there would re-store the file early. **What could differ**: if a names file has been removed from evidence, an evicted set reads `its names file … is gone` where the cache would still have answered, as it would after a restart.

**Gain**: bounded at about 100,000 names instead of growing with every new set. Unmeasured.

**Proof plan**: `packages/extension-host/test/series.test.ts`, `tests/acceptance/262/*`.

**Risk**: low, ~9 lines.

Related, not proposed as an edit: `landed` (`:172`) holds every batch of a source once a pinned value was read, and `at()` reads, hashes and decodes a whole batch into a 10,000-entry Map to return one value (`:314-323`). Neither is on a path the hub calls today (`boundValues` has no hub caller).

---

## F12 — Archive: three small per-copy and per-pass costs  · CONFIRMED

**Where**: `packages/archive/src/index.ts:250`, `:277`, `:337`.

**Change**:
```ts
// :250 — Buffer.from(buffer) copies the whole prefix before decoding it
- … text.slice(grew ? Buffer.from(raw.subarray(0, before.size)).toString('utf8').length : 0) …
+ … text.slice(grew ? raw.subarray(0, before.size).toString('utf8').length : 0) …
// :277 — the cursor in the SQL text makes a new statement every pass and evicts one of the record's 256 kept statements
- await record.raw(`SELECT agent, max(ts) AS ts FROM events WHERE log_pos > ${cursor} AND writer = 'hook' AND agent IS NOT NULL GROUP BY agent`)
+ await record.raw("SELECT agent, max(ts) AS ts FROM events WHERE log_pos > ? AND writer = 'hook' AND agent IS NOT NULL GROUP BY agent", [cursor])
// :337 — letters(id) once, not once per transcript on disk
- for (const source of await sources(options)) if (letters(source.session) === letters(id)) await copy(source);
+ const wanted = letters(id);
+ for (const source of await sources(options)) if (letters(source.session) === wanted) await copy(source);
```
**Why safe**: `raw` is a Buffer (`readFile`), so `subarray(...).toString('utf8')` decodes the same bytes. `record.raw` takes bound numbers (`packages/record/src/index.ts:774`); `cursor` is a number. `letters` is pure.

**Gain**: one copy of up to the transcript's size fewer per grown transcript; one prepared statement reused instead of one compiled per pass; one regex replace fewer per transcript per session end.

**Proof plan**: `tests/acceptance/20/*`, `packages/archive/test/*`.

**Risk**: low, 4 lines.

Not proposed: `keep` hashes the copy read back although `evidence.read` already checks it (`:224-225`). That second hash is the archive's own check of a store it does not trust by word; it stays.

---

## F13 — `diffOf` is quadratic in items  · CONFIRMED

**Where**: `packages/workspaces/src/index.ts:42-51`.

**What**: for each ID it runs `now.find` and `then.find`. For the git source an item is a file, so n files cost n² ID compares.

**Change**:
```ts
+ const first = (items: readonly StateItem[]): Map<string, StateItem> => { const m = new Map<string, StateItem>(); for (const i of items) if (!m.has(i.id)) m.set(i.id, i); return m; };
+ const [was, is] = [first(then), first(now)];
  for (const id of ids) {
-   const item = now.find((i) => i.id === id) ?? { id, value: null };
-   const diff = await source.compare(item, then.find((i) => i.id === id)?.value ?? null);
+   const item = is.get(id) ?? { id, value: null };
+   const diff = await source.compare(item, was.get(id)?.value ?? null);
```
**Why safe**: first match wins in both, as `find` does.

**Gain**: n² → n lookups; small for today's small workspaces.

**Proof plan**: `tests/acceptance/67/*`.

**Risk**: low, 4 lines.

---

## F14 — The host's 250 ms timer reads `notices.json` from disk on every tick  · CONFIRMED (tiny)

**Where**: `packages/extension-host/src/host.ts:497` (`TIMER_MS`), `:1818-1821` (`shownTick`), `:1089-1092` (`read`: `existsSync` + `readFileSync` + `JSON.parse`).

**Change**: read it only when a while-shown source exists.
```ts
- const standIn = new Map<string, number>();
- for (const n of Object.values(this.read<SavedNotice>('notices.json'))) if (n.every !== null) standIn.set(…);
+ let standIn: Map<string, number> | undefined;
  …
      if (source.variant !== 'polled' || !source.whileShown) continue;
+     if (!standIn) { standIn = new Map(); for (const n of Object.values(this.read<SavedNotice>('notices.json'))) if (n.every !== null) standIn.set(n.source, Math.min(standIn.get(n.source) ?? Infinity, n.every)); }
```
**Why safe**: `standIn` is used only inside that branch. **What differs**: a corrupt `notices.json` today throws out of every tick, stalling schedules too; after the change only when a while-shown source is loaded.

**Gain**: four sync file reads a second fewer in a hub with no while-shown source. Also true but not edited: `Schedules.tick` reads `work-sources.json` once or twice per live schedule per tick through `ready` (`host.ts:959`, `work.ts:203-208`).

**Proof plan**: `tests/acceptance/262/*` (while-shown cadence, notice stand-in), `packages/extension-host/test/schedules.test.ts`.

**Risk**: low, 3 lines.

---

## F15 — A sandboxed load captures up to 64 chunks of output that nothing can read  · CONFIRMED

**Where**: `packages/extension-host/src/host.ts:2283-2284` (`output`, `keep`), `:2290` (`output: { stdout: keep, stderr: keep }`), `:2296` (`ext.released ? … output.join('') … : ''`), `:2103` (`released: released && place === 'hub'`), `:2254-2262` (`sandboxed` runs only when `place !== 'hub'`).

**What**: `ext.released` is false for every sandboxed load, so the one reader of `output` is unreachable; the closure still holds up to 64 chunks (64 KiB each at most) for the life of the load.

**Change**: delete `output` and `keep`, drop `output: { stdout: keep, stderr: keep }` from the start spec, and make `:2296` `` `it exited (${exit.code ?? exit.signal}) before it connected` ``.

**Why safe**: the supervisor consumes and hashes the pipes whether or not a spec gives callbacks (`supervisor.ts:604-605`), so the run's evidence digests and back-pressure are unchanged; the error text is what it is today for every sandboxed load.

**Gain**: up to 4 MiB per sandboxed extension in the worst case, usually a few lines; 4 lines of dead code go.

**Proof plan**: `tests/acceptance/348/*` (a package that exits before connecting is refused with that text), `packages/extension-host/test/host.test.ts`.

**Risk**: low, −4 lines.

---

## The open structural findings of `reports/package-modularity-audit.md`, for these packages

| Audit finding | A small, behavior-preserving step now? |
|---|---|
| extension-host: extract HTTP ingress framing and body limits | **No.** The ingress is `turnOn`/`serve`/`turnOff`, 55 lines (`host.ts:3893-3956`), with one piece of state (`ext.server`) and `node:http` already loaded lazily. Pulling the body loop out moves about 12 lines with one caller and removes no dependency. Leave it until a second ingress exists. |
| Duplicated probe lifecycles outside host@1 (checks-numbers, checks-work, proof) | **No, from this side.** The host already hands host@1 to a hub-bound kind (`host.ts:3700-3707`); the hub opens the host with `release: []`, so no kind is hub-bound. Moving the probes onto `ctx.host.start` puts them in the sandbox under a grant, which changes what they can read: a behavior change that needs its own failing-first tests. |
| Environment replacement (hub builds stacks from env-local) | **No.** `envLocal` (environment@1, `stack.ts:788-812`) and `WarmStack` are different surfaces; the wiring is `hub/src/core.ts:842-843`. Nothing in env-local can change without the contract the audit says is missing. F9 narrows the hub↔warm-stack call by one walk and is independent of this. |
| runner: extract result decoding | **No.** `read`/`event`/`codexEvent`/`piEvent` (`runner.ts:787-901`) write a dozen fields of `Job` and call `settle`, `facts` and the plant: an extraction would pass the whole job and runner in. |
| supervisor: split CA generation from request mediation in `egress.ts` | **No.** `egress.ts` already loads only for a run that holds a stand-in credential (`supervisor.ts:546-548`). |

## Dispositions

| Package | Disposition |
|---|---|
| `packages/extension-host` | F1, F4, F10, F11, F14, F15. `schedules.ts`, `sends.ts`, `work.ts`, `compose.ts`, `replies.ts`, `digest.ts`, `kit.ts`, `jobs.ts`: keep. Noted, not proposed: `deep.record.query` builds every matching event into one array before it crosses the wire (`host.ts:3163-3187`), which needs an API change to bound; `host.runs()` and `Sends.rows()` scan a kind's whole history per call, but the hub calls neither on a timer. |
| `packages/supervisor` | F6, F7. `seatbelt.ts`, `bubblewrap.ts`, `egress.ts`, `timer.ts`: keep. The denial-stream warm-up before a start after an idle minute (`supervisor.ts:572`) costs a canary spawn and a wait, by design. |
| `packages/runner` | F2 (with the hub), F3, F8. `agents.ts`, `egress.ts`: keep. The idle tick is two cheap indexed reads a second; not worth changing. |
| `packages/env-local` | F5, F9. `stack.ts`: keep; `lsof` runs once per candidate port at `env up`, never on a timer. Warm-stack bookkeeping is bounded (`KEPT = 2` templates, installs and images; `serving`, `composed` and `seeds` are deleted at a run's end). |
| `packages/workspaces` | F13. Otherwise keep. |
| `packages/sources` | Keep. Gmail's `item` spends one provider call on `/profile` per item read (`gmail/index.ts:74`); caching it changes the recorded call sequence, so it is not proposed. |
| `packages/archive` | F12. Otherwise keep; the first `quiet()` after a start scans every event for hook times (`index.ts:277` with cursor 0), which needs an index or a projection, not a small edit. |
