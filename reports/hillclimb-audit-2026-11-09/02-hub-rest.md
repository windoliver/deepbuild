# 02 — hub (rest) and the decision packages

Scope: `packages/hub/src` except core/server/wire/hookmap/settle/holds/waits/rules/guards/scope/paths/status and the worker/parser files; `packages/asks`, `verdicts`, `gate`, `leases`, `budget`, `resolver-decisions`. Read-only: nothing was built or run except one `ps` call to check its output for several PIDs.

Coverage, stated plainly. Read in full or nearly: `gate-runner.ts`, `shared-runs.ts`, `heavy.ts`, `runs.ts` (start/launch/finish/recover), `leases/src/index.ts`, `gate/src/checkouts.ts`, `gate/src/own.ts` (top), `asks/src/index.ts` (settings, public methods, show/open/rides, cards, forgetEnded, sync, apply's cases, settle; about half the file), `codex-settings.ts` (records, relations, trust), `codex-loops.ts` (readings), `open-items.ts` (atClaim, newestList, answered), `channels.ts` (tick/pass/due), `libraries.ts` (search), `budget` (sync). Scanned by grep only (SQL, timers, sync I/O, long-lived maps, duplicate helpers): `agents.ts`, `ask-tasks.ts`, `products.ts`, `wiki-build.ts`, `siblings.ts`, `starts.ts`, `stacks.ts`, `setup.ts`, `doctor.ts`, `acceptance.ts`, `staging.ts`, `workspaces.ts`, `questions.ts`, `service.ts`, `canvas.ts`, `numbers.ts`, `forge.ts`, `tools.ts`, `memory.ts`, `claude-settings.ts`, the MCP files, `verdicts`, `gate/{scheduler,exec,floor,size,open}.ts`, `resolver-decisions`. A "keep" on a grep-only file means "nothing found by those scans", not "proven optimal".

Findings are ranked by gain over risk.

---

## F1 — `deep lease` waiters make the hub's core spawn `sysctl` synchronously four times a second each  (CONFIRMED)

**Where**: `packages/hub/src/heavy.ts:37-57` (`memoryPressure`), called at `heavy.ts:240` (`HeavyQueue.attempt`), reached from `HeavyQueue.wait` (`heavy.ts:200-222`), which the core runs for every `lease.wait` request (`core.ts:5686`). The CLI polls it every `POLL_MS = 250` ms while it waits (`heavy.ts:405`, loop at `468-484`).

**What**: on macOS every poll of every waiting `deep lease` runs `execFileSync('/usr/sbin/sysctl', ['-n', 'kern.memorystatus_vm_pressure_level'], { timeout: 2000 })` on the core worker thread. `execFileSync` blocks that thread for the child's whole life. With W commands queued that is 4·W blocking process spawns a second, exactly when the machine is busiest (a queue exists because slots are full). A spawn that the scheduler starves holds the core, and every hook reply behind it, for up to the 2 s timeout.

**Change**: keep the OS reading for one second; leave the test file path and the `o.pressure` override untouched.

```ts
// heavy.ts, above memoryPressure
/** The OS's own reading, kept a second: every waiting `deep lease` asks four times a second, and each read is a process. */
let osRead: { at: number; level: Pressure } | undefined;
const OS_READ_MS = 1000;
```
```ts
    if (process.platform === 'darwin') {
      if (osRead && Date.now() - osRead.at < OS_READ_MS) return osRead.level;
      let level: Pressure = 'normal';
      try {
        const n = Number(execFileSync('/usr/sbin/sysctl', ['-n', 'kern.memorystatus_vm_pressure_level'], { encoding: 'utf8', timeout: 2000 }).trim());
        level = n >= 4 ? 'critical' : n >= 2 ? 'warn' : 'normal';
      } catch { /* no reading: nothing to wait for */ }
      osRead = { at: Date.now(), level };
      return level;
    }
```

**Why it is safe**: `memoryPressure` has one caller (`heavy.ts:240`; repo-wide grep finds no other, tests included). Tests drive it through `DEEP_TEST_MEMORY_PRESSURE_FILE` or `HeavyOptions.pressure`, both of which return before the cached branch. What changes: a change of the kernel's pressure level is seen up to 1 s later (at most four polls of one waiter), and a failed read is also kept for that second instead of being retried on the next poll.

**Gain**: sync spawns on the core thread drop from 4·W per second to at most 1 per second. Each avoided spawn is one fork/exec/wait during which no hook is served. Unmeasured in wall time; the count is exact.

**Proof plan**: `tests/acceptance/1015/*` (queue, memory pressure, waiter order) and `tests/acceptance/1017/*` (disk floor) pin the behavior through the file override. To measure without wall time: count `execFileSync` calls from `memoryPressure` for N `wait()` calls on a queue of W waiters (before: N; after: ≤ ceil(elapsed s)).

**Risk**: low. ~10 changed lines.

---

## F2 — the lease table spawns one `ps` per session-held lease every second  (CONFIRMED)

**Where**: `packages/leases/src/index.ts:338-359` (`tick`), `361-376` (`ended`), `144-150` (`startOf`). The core ticks it every 1000 ms (`core.ts:1006`). Leases carry an agent only from `HeavyQueue.attempt` (`heavy.ts:262-268`): every granted `deep lease` holds `cpu.slot` plus one lease per kind it named, all under the same session and agent PID.

**What**: for each held lease whose holder is `session:*`, has an `agent`, and whose session has not ended, `ended()` runs `/bin/ps -o lstart= -p <pid>`. A `deep lease gpu:shared browser -- …` holds three leases, so three identical `ps` spawns a second for one PID, for the whole build. Ticks are sequential inside (`await this.ended(h)`) but `setInterval` does not wait for the last tick, so slow `ps` calls under load overlap.

**Change**: one read of the process table per PID per tick.

```ts
  async tick(): Promise<void> {
    await this.sync();
    const now = this.options.now();
    // One read of the process table per agent a tick: a leased command holds several leases under one agent.
    const starts = new Map<number, ReturnType<typeof startOf>>();
    for (const h of [...this.held.values()]) {
      …
      const end = await this.ended(h, starts);
```
```ts
  private async ended(h: Held, starts: Map<number, ReturnType<typeof startOf>>): Promise<string | undefined> {
    …
    if (this.ends.has(holder) || !h.agent) return this.ends.get(holder);
    let read = starts.get(h.agent.pid);
    if (!read) starts.set(h.agent.pid, read = startOf(h.agent.pid));
    const start = await read;
```

**Why it is safe**: `ended` has one caller (`tick`). Leases that share a PID get the same answer they would get from two reads milliseconds apart; each still compares it with its own recorded `start`, so the reused-PID case decides per lease as before. `packages/leases/test/liveness.test.ts` holds two leases on one PID with different recorded starts in one tick and expects one kept and one released: unchanged, since the comparison is per lease. A failed read (`undefined`) still ends no holder.

A single `ps -p a,b,c` for all PIDs would cut it to one spawn a tick, but I do not recommend it: on this Mac `ps -o pid=,lstart= -p 1,$$,999999` prints nothing and exits 1 ("process id too large"), which the current rule would read as "all gone". Not worth the hazard.

**Gain**: spawns per tick go from (session-held leases) to (distinct agent PIDs among them); for one leased command with k extra kinds, from 1+k to 1 per second. Unmeasured in CPU; exact in spawn count.

**Proof plan**: `packages/leases/test/liveness.test.ts` (all four `ps fails with …` cases), `tests/acceptance/237/life.test.ts` (AC5, AC10 PID reuse). Count `execFile('/bin/ps')` calls per tick with three leases on one agent: 3 before, 1 after.

**Risk**: low. ~6 changed lines.

---

## F3 — a stop whose tree did not change still builds and throws away a full checkout  (CONFIRMED by reading; stop-path change)

**Where**: `packages/hub/src/gate-runner.ts:581-599` (snapshot, then checkout, unconditionally), `600-610` (claim), `652-661` (the carry that then runs nothing), `725` + `1147-1153` (`cleanup` gives the checkout back). The checkout itself: `packages/gate/src/checkouts.ts:410-424` (`checkout`), `313-349` (`cloneIn`), `363-397` (`materialize`); `shared-runs.ts:69-82` (`namesOf` walks the new checkout).

**What**: `stop()` takes the cheap path (no snapshot, no checkout) only when the core says `same` (no tool call but reads since the last claim, `core.ts:7277`, set false by any non-read tool call at `core.ts:1746`). After any turn that ran a command but changed no file (ran the tests, looked at git, answered a question) the runner snapshots, then makes a whole checkout: `git rev-parse` ×2, two `git ls-files` walks, `check-ignore`/`ls-files` per dependency folder, `cp -cR node_modules` (and `.venv`), `chmod -R` over the clone, `read-tree`, `ls-tree -r -l`, `checkout-index -a` of every tracked file, then `namesOf` walks it. Only after that does it compare the tree with the last claim's (`610`, `654-661`), carry every check, start no run, and remove the checkout. The gate package's own reference path already checks out only when something will run (`checkouts.ts:556`, `if (toDo.length)`).

**Change**: decide after the snapshot, with the same expressions the carry uses, whether anything can run; skip the checkout when nothing can.

```ts
    else if (r.checks.length || r.joins) {
      try {
        installs = installsOf(r.cwd);
        ({ commit: snapshot, tree } = await this.o.checkouts().snapshot(r.cwd, budget));
        tree = stated(tree);
        // The last claim's tree again, with every check ended on a claim of that tree: the results carry below and
        // nothing runs (#82), so it takes no checkout, as a stop with no work since its claim takes none.
        const before = (this.claims.get(r.session) ?? []).filter((c) => c.claim !== r.claim);
        const carries = !r.joins && tree !== undefined && before.at(-1)?.tree === tree && this.o.plant !== 'empty-commit-run-alone'
          && r.checks.every((c) => before.some((o) => o.tree === tree && ended(o.entries.get(c.check))));
        if (!carries) {
          checkout = (await this.o.checkouts().checkout({ worktree: r.cwd, commit: snapshot, dependencies: DEPENDENCIES, runs: [r.claim], budget })).dir;
          if (r.state) await hold(checkout, r.state.files);
        }
      } catch (error) { … unchanged … }
    }
```

**Why it is safe**:
- `carries` is exactly the condition under which lines 609-661 produce `changed === false`, `same` non-empty and `toRun === []`: same list (`claims.get(session)` minus this claim; no `await` lies between the peek and line 602 when the checkout is skipped), same `ended`, same plant exclusion. `tree` is already `stated(tree)`, so a workspace's state digests are part of the comparison.
- With `checkout === null` the rest of `stop()` already works: that is the existing `r.same` path (`held = null`, `facts = null`, `names = ''`, `cleanup` returns on a null checkout, and `checkoutOf` makes one later if a slow run, a base run or `rerun` ever needs it).
- `startsAtClaim` (line 601) is passed only under the plant `env-starts-at-every-claim` (`core.ts:808`); its test (`tests/acceptance/580/lanes.test.ts` AC8) changes the lockfile, so the tree differs and the checkout is still made.
- The checkouts service's planted queue (`snapshots-one-at-a-time`) is released by `checkout`; the hub never passes that plant (`core.ts:1079` forwards only `git-inherits-env` and `stand-in-always`).
- The same narrow race the `r.same` path already has stays: if `rerun()` resets an older entry during `await changes` (line 608), `toRun` is non-empty with no checkout and that check ends `missing` (BLOCKED). Not new.

What changes, observably: `readyAt` is earlier, so `stop.held`'s `snapshot_start` is smaller for such stops; a checkout that would have gone over the 8 s budget can no longer turn such a claim INCONCLUSIVE (the snapshot still can); no `c-*` folder is made and removed.

**Gain**: per unchanged-tree stop, all of the checkout's work goes: O(tracked files) writes, O(files under node_modules/.venv) clone + chmod + later unlink, about a dozen git spawns and one recursive walk. This is the largest single avoidable cost I found in the area, on the path the stop-hold budget measures. Unmeasured in ms.

**Proof plan**: `tests/acceptance/82/nowork.test.ts`, `82/judged.test.ts`, `82/pending.test.ts`; `tests/acceptance/33/retry.test.ts` (the `empty-commit-run-alone` plant must still be caught); `tests/acceptance/45/*`; `packages/hub/test/gate-stop.test.ts`, `gate-runner.test.ts`, `shared-runs-hub.test.ts`. Measure by counting `Checkouts.checkout` calls across two stops on one tree with a non-read tool call between: 2 before, 1 after.

**Risk**: medium (the stop path). ~8 changed lines.

Side note, not part of the change: `installs = installsOf(r.cwd)` is a floating promise until `stemOf` awaits it. `installsOf` can reject (`JSON.parse` of a package's `package.json` inside a `.then` fulfilment handler, `shared-runs.ts:61`, only for an install with no lock record). On the over-budget return and on any all-carried stop nothing ever awaits it, so that rejection is unhandled in the core worker. Pre-existing; worth a `.catch` when someone touches this.

---

## F4 — the asks core decodes every event in the log, at start and on every sync  (CONFIRMED; gain unmeasured)

**Where**: `packages/asks/src/index.ts:1752-1759` (`sync`: `record.read({ after, limit: PAGE })`, no `kinds`), `1804-2078` (`apply`), `1808` and `2086-2089` (`logged`). `openAsks` (`2535-2537`) starts at cursor 0.

**What**: every other fold over the log reads only its kinds, so the rest are "scanned once and never decoded" (`record/src/index.ts:152-166`; used by `leases/src/index.ts:180`, `budget/src/index.ts:452`, `runner/src/runner.ts:162`, `supervisor/src/supervisor.ts:154`, `resolver-decisions/src/index.ts:100`). The asks core is the outlier in my area: at hub start it reads the whole record from position 0, 1,000 rows a page, building an `Event` (row copy + `JSON.parse` of `data`) for every event of every kind, and it does so again for everything new on each `sync()`, which runs several times inside every `raise`, `answer`, `tick`, `card`, `needsYou`, `holds` and `inbox`. `apply` acts on 27 kinds. The one thing that reads other kinds is line 1808, which keeps the newest `ts` of any core-written event, and that value is read exactly once, in the first `settle()`.

**Change**:
1. A constant with apply's cases, and a filtered read that moves the cursor past what it skipped (as `readSince` does):

```ts
/** The kinds `apply` folds; the rest of the log is scanned, never decoded. */
const FOLDED = ['session.start', 'agent.stop', 'session.continued', 'session.end', 'task.closed', 'ask.created', 'plan.proposed',
  'decision.created', 'decision.revoked', 'decision.overruled', 'decision.judged', 'decision.applied', 'ask.answered', 'ask.defaulted',
  'ask.escalated', 'ask.cancelled', 'ask.superseded', 'ask.moot', 'default.undone', 'deadline.moved', 'ask.batched', 'ask.later',
  'tool.before', 'user.ask', 'verdict.made', 'claim.made', 'tool.after'] as const;
```
```ts
  private async sync(): Promise<void> {
    const [row] = (await this.options.record.raw('SELECT max(log_pos) AS head FROM events')) as { head: number | bigint | null }[];
    const head = Number(row?.head ?? 0);
    for (;;) {
      const page = await this.options.record.read({ after: this.cursor, limit: PAGE, kinds: FOLDED });
      for (const event of page) await this.apply(event);
      if (page.length) this.cursor = page[page.length - 1]!.log_pos;
      if (page.length < PAGE) { this.cursor = Math.max(this.cursor, head); return; }
    }
  }
```
2. Delete line 1808 and the `logged` field; in `settle()` read the value where it is used:

```ts
    if (!this.opened) {
      this.opened = true;
      // Only a running hub appends as the core; a crash's hub.stopped carries the time of the start that found it.
      const [last] = (await this.options.record.raw("SELECT max(ts) AS ts FROM events WHERE writer = 'core' AND NOT (kind = 'hub.stopped' AND json_extract(data, '$.reason') IS 'crashed')")) as { ts: number | bigint | null }[];
      if (last?.ts !== null && last?.ts !== undefined) await this.moveAway(Number(last.ts), this.options.now());
    }
```
`IS 'crashed'`, not `=`: a `hub.stopped` with no `reason` must count, as it does in JS today; with `=` SQL's NULL would drop it.

**Why it is safe**: the 27 names are apply's `case` labels, extracted mechanically; the switch has no `default` and nothing follows it. `apply` is reached only from `sync`. `logged` is read only at 2088. The SQL sees the same events the open-time sync applied (plus anything appended in the same call before it, which the old code would also have applied). `record.read` filters in SQL (`record/src/index.ts:706-711`). Calls are serialized by `exclusive`, so no two syncs overlap. What could differ: nothing in asks' state; the open now does one sequential scan of `events` for `max(ts)` (no index on `writer`) instead of decoding every row.

**Gain**: every event outside the 27 kinds stops crossing into JS: no row object, no `JSON.parse`, no `Event`. `tool.before`, `tool.after` and `user.ask` stay, so the saving is the rest of the log (session state and attention, usage, readings, runs, processes, leases, stacks, holds, transcripts' own kinds). I could not measure the share: this machine has no record to count. Applies to hub start (whole log) and to each sync.

**Proof plan**: `tests/acceptance/318/*`, `319/*`, `85/*`, `824/*`, `908/{asleep,down}.test.ts` (the `moveAway` at open), `packages/asks/test/{asks,block,continues,timing}.test.ts`. Measure by counting rows `record.read` returns to the asks core over a recorded log (`contracts/corpus.json` or any acceptance record): before = all events, after = events of the 27 kinds.

**Risk**: medium (central read loop). ~15 changed lines.

---

## F5 — every claim reads, decodes and splits the whole transcript to find one line  (CONFIRMED)

**Where**: `packages/hub/src/open-items.ts:256-276` (`newestList`), called at `open-items.ts:109` from `atClaim`, which the core runs for every claim at a stop (`core.ts:7286`). Same shape, forward: `packages/hub/src/codex-loops.ts:109-150` (`codexReadings`).

**What**: `readFile(transcript, 'utf8')` then `text.split('\n')`, then `raw.includes(facts.tool)` on every line, to return the input of the *last* task-list call. A session's transcript is tens of MB and grows all session; this costs a full UTF-8 decode to a JS string (two bytes a character as soon as one non-Latin-1 character appears), an array holding every line, and a scan from the start, on every stop. Transient heap is 2–4× the file, inside a process whose budget is 150 MB resident.

**Change** (`open-items.ts`): read bytes, walk lines from the end, decode only a line that names the tool, and return at the first line that assigns.

```ts
async function newestList(facts: TaskListFacts, transcript: string): Promise<unknown> {
  let bytes: Buffer;
  try { bytes = await readFile(transcript); } catch { return undefined; }
  const tool = Buffer.from(facts.tool);
  // Newest first: the last line that holds a call of the tool is the list.
  for (let end = bytes.length; end > 0;) {
    const start = bytes.lastIndexOf(10, end - 1) + 1;
    const raw = bytes.subarray(start, end);
    end = start - 1;
    if (!raw.includes(tool)) continue;
    let line: unknown;
    try { line = JSON.parse(raw.toString('utf8')); } catch { continue; }
    if (!isObj(line)) continue;
    let found = false;
    let newest: unknown;
    if (isObj(line.message) && Array.isArray(line.message.content)) {
      for (const part of line.message.content) if (isObj(part) && part.type === 'tool_use' && part.name === facts.tool) { newest = part.input; found = true; }
    }
    const p = line.payload;
    if (line.type === 'response_item' && isObj(p) && p.type === 'function_call' && p.name === facts.tool && typeof p.arguments === 'string') {
      try { newest = JSON.parse(p.arguments); found = true; } catch { /* a call that doesn't parse lists nothing */ }
    }
    if (found) return newest;
  }
  return undefined;
}
```
For `codexReadings` keep the forward order and its `break`; replace `text.split('\n')` with a walk over `bytes.indexOf(10, from)` and test the four needles (`session_meta`, `token_count`, `goal`, `task_started`) on the bytes before decoding a line.

**Why it is safe**: the forward loop's result is the value assigned by the last line that assigns; the reverse walk returns the value assigned by the first such line from the end, with the same within-line order (last matching `tool_use` part, then the Codex branch over it). `found` is tracked apart from the value because `part.input` may be `undefined`. Byte search equals string search here: the needles are ASCII, and in UTF-8 an ASCII byte never occurs inside a multi-byte character, so `\n` splitting and `includes` give the same lines and the same matches; an invalid sequence decodes to U+FFFD per line exactly as it does in the whole text. `newestList` has one caller.

**Gain**: no whole-file string, no line array: heap goes from 2–4× the file to the matching lines only (the bytes are off-heap, 1×). CPU goes from decode + split + scan of the whole file to a byte scan that usually ends in the file's tail. Unmeasured; proportional to transcript size, per stop.

**Proof plan**: `tests/acceptance/323/todos.test.ts` (task lists from both agents), `tests/acceptance/82/*` open-item cases; for Codex `packages/hub/test/loop-transcript.test.ts`, `codex-hub.test.ts`, `tests/acceptance/965/*`, `39/*`. Measure with `process.memoryUsage().heapUsed` around one call on a 50 MB fixture, or count bytes decoded.

**Risk**: low for `newestList` (~20 lines), low-medium for `codexReadings` (~10 lines, forward semantics unchanged).

---

## F6 — the gate runner keeps every run's full stdout and stderr in memory for the hub's life  (CONFIRMED)

**Where**: `packages/hub/src/gate-runner.ts:197` (`records`, never deleted from: five `set` sites, no `delete`), `214-223` (`recorded`), `861-865` (`outputOf`, the only reader of the text).

**What**: `recorded()` stores the command check kind's whole record, whose `output.stdout`/`output.stderr` are the run's complete scrubbed output with no cap (`checks-command/src/index.ts:358-360`). The store already holds both by digest (`runs.ts:380-391`, written before `recorded` is called). The verdict engine reads only `output.sha256` (`gate/src/claim.ts:135-136`). The text is read in one place, which shows its last 2,000 characters.

**Change**: keep what `outputOf` shows, not the output.

```ts
/** What a send-back shows of a run's output: its error output first, cut to its last 2,000 characters. */
const shown = (o: RecordedRun['output']): string => [o.stderr, o.stdout].filter((t) => t.trim()).join('\n').slice(-2000);
```
```ts
  recorded<R extends RecordedRun>(run: string, record: R): R {
    … plant branch unchanged …
    // The store holds the output by its digests; the runner keeps only what a send-back shows of it.
    this.records.set(run, { ...record, output: { stdout: shown(record.output), stderr: '', sha256: record.output.sha256 } });
    return record;
  }
```
```ts
  outputOf(claim: string, check: string): string {
    const run = this.claimOf(claim)?.entries.get(check)?.runs.at(-1);
    return (run ? this.records.get(run) : undefined)?.output.stdout ?? '';
  }
```

**Why it is safe**: callers of the stored records: `claimVerdict` (digests only), `keptAll` (digests), `withheld` (blanks the text), `baseOf`/`headOf`/`reached`/`ownOf` (outcome, failures, read), `outputOf`. `recorded`'s return value goes back to `runs.ts:392`, which uses outcome, failures, evidence, mask and counts, and has already written the text to the store; it still gets the full record. The other `records.set` sites store empty output, for which the old and new `outputOf` both give `''`. One exact-equality note: for a run whose stderr and stdout are both blank the old code returned `''`, and so does the new.

**Gain**: per run, frees its whole output (kilobytes to megabytes; a string from `Buffer.toString` costs 1–2 bytes a character) and keeps at most 2,000 characters. The map itself still grows by one small record per run; that is not changed here.

**Proof plan**: any test that reads a send-back's quoted output: `tests/acceptance/323/*` ("the command your final message tells you to run … fails:\n<output>", `core.ts:4690`), `packages/hub/test/gate-runner.test.ts`. Measure retained size by `JSON.stringify(record).length` summed over `records` after N runs.

**Risk**: low. ~8 changed lines.

---

## F7 — at start every kept key's file list is held twice, each with its own copies of the path strings  (CONFIRMED)

**Where**: `packages/hub/src/gate-runner.ts:240-248` (`kept`), `packages/hub/src/shared-runs.ts:117-129` (`add`), `150-160` (`keptRecord`, `read: [...d.key.paths]`). Fed by `core.ts:959-960` (every `run.finished` that has a key, all time, parsed in one `map`).

**What**: a key's `paths` is every file outside installs that the run read (often hundreds to thousands). Each row's paths come out of its own `JSON.parse`, so 1,000 runs of one check hold 1,000 copies of the same strings, and `keptRecord` adds a second array per run. Nothing bounds this by age: it grows with the record. Roughly (60–80 B a string + 16 B of array slots) × paths × kept runs.

**Change**: intern the strings once and let the record share the key's array.

```ts
  kept(rows: …): void {
    // One copy of each path, however many runs read it: each row's strings came from its own parse.
    const names = new Map<string, string>();
    for (const r of rows) r.key.paths = r.key.paths.map((p) => names.get(p) ?? (names.set(p, p), p));
    … rest unchanged …
```
```ts
// shared-runs.ts keptRecord
    run, outcome: …, read: d.key.base ? [] : d.key.paths, …
```

**Why it is safe**: strings are immutable; the map is local and dropped after the pass. Sharing the array between `Group.paths` and the record's `read`: every reader treats both as read-only (`headOf(e)?.read.filter`, the `for…of` in `reached`, `ownChanges(changes, read: readonly string[])` which builds its own `Set`, `keyPaths` which copies, `SharedRuns.add` which stores the reference and joins it). I found no `sort`, `push` or `splice` on either.

**Gain**: retained memory per kept run falls from about (strings + two arrays) to one array of pointers: for 500 paths, roughly 45 KB to 4 KB a run; 3,000 kept runs, roughly 135 MB to 12 MB. Estimates from V8's string and array layouts, not measured. The transient at `core.ts:959-960` (all rows and all parses alive at once) is the core's and stays; it is worth the same treatment there (parse and hand over row by row).

**Proof plan**: `packages/hub/test/shared-runs.test.ts`, `shared-runs-hub.test.ts`, `tests/acceptance/1018/*` (carry after a restart). Count distinct string identities in `SharedRuns` after `kept()` on a record with N runs of one check: N×P before, P after.

**Risk**: low. ~4 changed lines.

---

## F8 — loading Needs you spawns the same `git` commands once per card  (CONFIRMED)

**Where**: `packages/asks/src/index.ts:1688-1702` (`changed`), called from `cardOf` (`1660`) for each ask in `needsYou` (`920-927`), under the core's one lock (`exclusive`, `636-644`).

**What**: each shown ask pinned to a commit runs `git rev-parse HEAD` in its session's worktree and, when HEAD moved, `git diff --name-only` and a full `git diff` (16 MiB buffer). Several asks from one session at one commit (a fold starts at five) each run the same two or three commands and build the same diff text. While they run, every other asks call (`raise`, `answer`, `holds`, the tick) waits.

**Change**: share the read within one call. Add a per-call map beside `read`, cleared where `read` is.

```ts
  /** What changed since a pinned commit, read in this call, by worktree and commit: each call runs git once for each. */
  private readonly diffs = new Map<string, Promise<Card['changed']>>();
  // in exclusive(): this.read.clear(); this.diffs.clear();
```
```ts
  private changed(ask: Ask): Promise<Card['changed']> {
    const pin = ask.data.pinned_to as Obj;
    const worktree = this.sessions.get(ask.session)?.worktree;
    if (pin.kind !== 'commit' || worktree === undefined) return Promise.resolve(null);
    const from = pin.ref as string;
    const key = `${worktree}\0${from}`;
    let read = this.diffs.get(key);
    if (!read) this.diffs.set(key, read = (async () => { … the existing try/catch body … })());
    return read.then((c) => (c ? { ...c, files: [...c.files] } : null));
  }
```

**Why it is safe**: `changed` has one caller (`cardOf`). Within one call the cards' git commands already run concurrently, so they read the same HEAD unless it moves mid-call; sharing removes that mid-call difference and nothing else. Each card still gets its own object and `files` array. The map lives for one `exclusive` call, so there is nothing to invalidate.

**Gain**: git spawns per Needs-you load go from up to 3 × (asks pinned to commits) to up to 3 × (distinct worktree and commit pairs); the lock is held for less. Unmeasured.

**Proof plan**: `tests/acceptance/318/*` and `319/*` cases that read a card's `changed` after a commit; `packages/asks/test/asks.test.ts`. Count `execFile('git')` calls for `needsYou()` with five asks of one session at one commit and a moved HEAD: 15 before, 3 after.

**Risk**: low. ~12 changed lines.

---

## F9 — small exact duplicates inside `gate-runner.ts`  (CONFIRMED)

**Where and change**:
- `gate-runner.ts:923, 928, 939, 1042`: `[...this.claims.values()].flat().find((x) => x.claim === claim)` four times; `claimOf` (`547-550`) is the same lookup without building an array. Replace each with `this.claimOf(claim)` (`e.claim` at 1042). Line 939 runs every 100 ms while a Codex stop is held for slow checks (`slowEnded`, called from `core.ts:4740`).
- `gate-runner.ts:492, 972, 1144, 1169`: `` `session:${x.replace(/[^0-9A-Za-z]/g, '')}` `` four times; `sessionOf` (`177`) is that expression. Use it.
- `gate-runner.ts:1148`: `[...this.queue.values()].includes(e)` inside `.some` builds the array once per entry. Hoist: `const queued = new Set(this.queue.values());` then `queued.has(e)`, as `verdictOf` already does at `484`.

**Why it is safe**: same order of search (map insertion order, then list order, is what `flat()` gives), same strings, same membership test. No caller changes.

**Gain**: three fewer copies of two helpers; one array of every claim the hub has seen no longer built per 100 ms poll and per pump step (`claims` is never pruned, so that array grows for the hub's life). Small.

**Proof plan**: `packages/hub/test/gate-runner.test.ts`, `gate-queue.test.ts`, `gate-stop.test.ts`; `tests/acceptance/965/*`, `907/*`.

**Risk**: low. ~10 changed lines.

---

## F10 — `ownChanges` recompiles its regexes for every changed file on every verdict read  (PLAUSIBLE)

**Where**: `packages/gate/src/own.ts:37-50`, called by `GateRunner.ownChanged` (`gate-runner.ts:438-442`) for every entry on every `verdictOf` (`481-516`), which `standing`, `slowStanding`, `needsOf` and `judged` each call (five to ten times a stop, and again as each run ends).

**What**: for each changed path, `named()` spreads `configs` into an array and, for each config whose folder prefixes the path, compiles two `RegExp`s and scans the config's text. That part depends only on `changes`, which is fixed for a claim; only the `reads` test varies between calls.

**Change**: remember the read-independent part per `changes` object.

```ts
/** For each claim's changes, the files the test tool loads by its own rules: a config, or one a config names. */
const loadedBy = new WeakMap<object, Set<string>>();
…
  let loaded = loadedBy.get(changes);
  if (!loaded) loadedBy.set(changes, loaded = new Set(changed.filter((path) => LOADED_BY_TOOL.test(path) || named(path))));
  return changed.filter((path) => (reads.has(path) && ownRead(path)) || (plant !== 'own-files-test-folders-only' && (loaded.has(path) || script(path))));
```

**Why it is safe, and the check I could not do**: the result is the same as long as nobody mutates a `changes` object between calls. In the hub it is built once by `changesOf` and replaced whole on a join (`gate-runner.ts:608, 619`). I did not read every acceptance suite that calls `ownChanges` directly; one that mutates and re-passes the same object would see the old answer. Check: `grep -rn "ownChanges(" tests packages` and read each call.

**Gain**: regex compiles per stop fall from (verdict reads × entries × changed × matching configs × 2) to (changed × matching configs × 2). Small for a ten-file change, tens of ms for a branch that changed hundreds of files. Unmeasured.

**Proof plan**: `tests/acceptance/33/*` (whose checks count), `875/*`. Count `RegExp` constructions with a wrapped global in a fast test.

**Risk**: low-medium. ~5 changed lines.

---

## F11 — `modified()` re-reads and re-parses two files once per hook entry  (CONFIRMED, small)

**Where**: `packages/hub/src/codex-settings.ts:319-325` (`modified`), `310-315` (`entriesFor`), `309` (`recordedHome`). Reached from `hub.health` (`core.ts:5801`) and `deep doctor` (`doctor.ts:300`).

**What**: for each of the twelve recorded entries, `entriesFor(root, event)` calls `recordedHome(root)` (read + parse `codex-hooks.json`) and then reads and parses `hooks.json`: 24 reads and parses where 2 would do. `stopTimeoutS` (`327-334`) reads the record twice.

**Change**: read once and index by event.

```ts
export function modified(root: string): string[] {
  const file = join(recordedHome(root), 'hooks.json');
  const hooks = existsSync(file) ? readJson(file)?.hooks : undefined;
  const at = (event: string): Obj[] => (isObj(hooks) && Array.isArray(hooks[event]) ? hooks[event] as unknown[] : []).flatMap((g) => (isObj(g) && Array.isArray(g.hooks) ? g.hooks.filter(isObj) : []));
  return recorded(root).flatMap(({ event, command, entry }) => { const found = at(event).find((h) => h.command === command); … unchanged … });
}
```
(or give `entriesFor` an optional pre-read `hooks` argument and use it from both).

**Why it is safe**: same files, same parse, read at one instant instead of twelve. **Gain**: 22 fewer sync reads and parses per health or doctor call; on demand only. **Proof plan**: `packages/hub/test/codex-files.test.ts`, `codex-hub.test.ts`. **Risk**: low. ~6 lines.

---

## Noted, not proposed as edits

- **Partial grants churn the record** (`heavy.ts:264-276`). A waiter that names two kinds, with the first free and the second held, appends `lease.acquired` then `lease.released` on every 250 ms poll: eight durable events a second for as long as it waits, and its brief hold of `cpu.slot` can make another waiter's attempt read "pool full". Fixing it needs an all-or-none entry on the lease table (a new API) or a pre-check that repeats the table's rules outside it. Not behavior-preserving as an edit; worth an issue.
- **`GateRunner.claims` and `records` are never pruned** (`gate-runner.ts:188, 197`). Pruning would change behavior: `rejudge` (`427-431`) re-reads every claim that shares a key, and an old claim's verdict can still be read. F6 and F7 remove most of the bytes; the entry counts stay.
- **`Libraries.answers`** (`libraries.ts:92, 167`) is a cache with no bound, one entry per distinct query. Its purpose is the offline answer, so a bound would turn "stale rows" into "no rows" for an evicted query. Small in practice.
- **Four walks of one worktree per stop**: `git ls-files -o --exclude-standard` runs in `open-items.ts:144`, `gate-runner.ts:162`, `checkouts.ts:293` and `checkouts.ts:314`. They differ in `cwd` (session folder vs repo top) and in which index is in force, so they are not safely one call. F3 removes the last one for unchanged trees.
- **Queries that scan a kind and extract JSON per row** (the `events_kind` index is the only help): `ask-tasks.ts:656, 706` (count of `claim.made` by task), `gate-runner.ts:554-556` (two queries per check without a declared `expected_ms`, the first a scan of `runs`, which has no secondary index). Each is per claim, not per hook; any fix is an index in `packages/record`, outside this area.
- **One-line helpers repeated across `hub/src`**: `isObj` ×27, `letters` ×11, `sql` ×5, "the environment without `GIT_*`" ×6 (`gate-runner.ts:160`, `shared-runs.ts:44`, `open-items.ts:58`, `session-facts.ts:132`, `release.ts:28`, `siblings.ts:567`; note `@deepbuild/gate`'s `gitEnv` clears a narrower list, so it is not a drop-in), `sha256` ×8 where `sha256Hex` from contracts exists. A hub-internal module would have callers today, but the edit touches about thirty files, some outside this area, for no runtime gain. Lead's call.
- **`asks/src/index.ts` split**: one concern has no `this`: the settings reader (`DRAFTED`, `draftAskSettings`, `over`, `readJson`, `doneYamlAsks`, `yamlScalar`, `UNITS`, `duration`; lines 303-432, about 130 lines), with the interface `settingsFor` already uses. It has one back-reference, `AskRefused` (`doneYamlAsks` throws it, line 371), so it can move to `src/settings.ts` only if `AskRefused` (lines 181-193) moves to its own small file that both import and `index.ts` re-exports. Everything else (decisions, stops and blocks, showing and batches, deadlines) reads and writes `AsksCore`'s private maps inside one `exclusive` section and would need the whole owner passed in: leave it.
- **For the core's owner**: `core.ts:959-960` parses every keyed `run.finished` of all time into one array at start; `core.ts:2494` and `7771` read whole transcripts as strings like F5.

---

## Dispositions

| Package / file group | Disposition |
|---|---|
| `packages/leases` | F2 |
| `packages/asks` | F4, F8; split note (settings reader only, with `AskRefused` moved) |
| `packages/gate` | F10 (`own.ts`); `checkouts.ts` keep (its reference path already checks out lazily); `scheduler.ts` keep: the virtual-clock model, must stay independent of the hub's runner; `exec`, `floor`, `size`, `open`, `claim`, `head`, `stack`: grep-scanned, keep |
| `packages/verdicts` | keep (pure engine on tens of runs a claim; grep-scanned, not profiled) |
| `packages/budget` | keep (folds by kind through `readSince`; maps hold one small entry per budget or paid run) |
| `packages/resolver-decisions` | keep (reads by kind; indexed `decisions.scope`) |
| hub `gate-runner.ts`, `shared-runs.ts` | F3, F6, F7, F9 |
| hub `heavy.ts` | F1; partial-grant note |
| hub `open-items.ts`, `codex-loops.ts` | F5 |
| hub `codex-settings.ts` | F11 |
| hub `runs.ts` | keep (journal written whole per change is by design, #996) |
| hub `channels.ts`, `siblings.ts`, `products.ts`, `stacks.ts` timers | keep: the 250 ms channel tick returns at once with no channel configured; the 2 s merge poll reads two small files a repo; the others run only while something waits |
| hub `libraries.ts` | keep; unbounded offline cache noted |
| hub `claude-settings.ts`, `mods.ts`, `mcp-servers.ts` | keep (`mcp-servers.ts` already caches by mtime; the rest are read from the core, whose call rate is the core's) |
| hub `agents.ts`, `ask-tasks.ts`, `wiki-build.ts`, `starts.ts`, `setup.ts`, `doctor.ts`, `acceptance.ts`, `staging.ts`, `workspaces.ts`, `questions.ts`, `service.ts`, `canvas.ts`, `numbers.ts`, `forge.ts`, `tools.ts`, `memory.ts`, MCP files, commands | keep on a grep scan (SQL, timers, sync I/O, maps); not read line by line |
| hub `plant.ts` | read for context only; no change proposed |
