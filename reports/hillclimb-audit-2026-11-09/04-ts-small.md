# 04 — contract, check and edge packages (TypeScript)

Read-only audit at 6a6d6b4f. Nothing in the repo was edited, built or run. Two count scripts ran in the scratchpad
(`ts-small/lower2.mjs`, `ts-small/graph.mjs`); their numbers are quoted where used. No wall time was measured: every
gain below is a count or a complexity argument, and says "unmeasured" where it is one.

Ranked by gain over risk.

---

## F1. `deep find` lowercases every archived message one character at a time, with a regex per character — CONFIRMED

**Where**
- `packages/reading/src/slices.ts:50` (`lowerOf`: `ch.toLowerCase().replace(/ς/g, 'σ')`, called per character)
- `packages/reading/src/slices.ts:55-67` (`matchAt`: builds `lower` by `+=` and pushes one `origin` entry per UTF-16 unit)
- `packages/reading/src/slices.ts:216` (`holds` = `matchAt(text, needle) >= 0`), `:220` (`context` calls `matchAt` again), `:227-243` (every message of every archived session, every findable evidence text, every wiki claim line)

**What**
`find` runs `matchAt` over the whole archive on every call (`deep find`, and the reading job's `find` tool,
`packages/reading/src/index.ts:166`). Per character it does a `toLowerCase`, a regex replace, a string append and an
array push; a 100 KB message allocates a 100,000-entry `origin` array to answer a yes/no question, and a hit pays the
whole pass twice (`holds`, then `context`). Paging (`--slice h5`) recomputes every hit from scratch.

**Change** (in `find`, `slices.ts:209-243`; `matchAt` itself stays, used once per hit)
```ts
// The whole text lowercased as matchAt lowercases it a character at a time: a final sigma is a sigma.
const lowered = (text: string): string => text.toLowerCase().replace(/ς/g, 'σ');
// Where the needle is, or -1: the origin map is built only for a text that holds it.
const at = (text: string): number => (lowered(text).includes(needle) ? matchAt(text, needle) : -1);
const context = (text: string, found: number): string => {
  const start = Math.max(0, found - 80);
  const end = Math.min(text.length, found + needle.length + 80);
  ...unchanged...
};
```
and each of the three hit sites becomes `const found = at(m.text); if (found >= 0) hits.push({ handle, context: context(m.text, found) })`.
`holds` goes away. `context`'s `Math.max(0, matchAt(...))` becomes the `found` already known to be `>= 0`.

**Why it is safe**
- `lowered(text)` equals `matchAt`'s `lower` for every text iff per-character lowercasing equals whole-string
  lowercasing once ς is folded to σ. The only context-sensitive, language-neutral lowercase mapping in Unicode is
  Final_Sigma (Σ→ς at a word's end); folding ς→σ on both sides removes it. `String.prototype.toLowerCase` applies no
  language-specific rule.
- Counted, not assumed (`ts-small/lower2.mjs`, Node v24.22.2, Unicode 18.0): every non-surrogate code point alone and
  in 7 contexts around a capital sigma, 8,896,512 strings: **0 differ**; lone surrogates beside cased letters: 0
  differ; 200,000 random strings over a case-heavy alphabet (Σ σ ς İ I U+0307 ß ẞ U+0345 soft hyphen, apostrophes,
  surrogates): **0 differ**. Exactly one code point (İ) lowercases to more than one unit, which is why `matchAt`
  keeps its `origin` map; that part is unchanged.
- The index a hit reports still comes from `matchAt`, so context text is byte-identical.
- `needle` is built as before.

**Gain**
Per non-matching text: from one JS iteration per character (toLowerCase + regex replace + append + push, ~4
allocations a character) to two native passes and no array. Per hit: one `matchAt` instead of two. Unmeasured;
by operation count roughly two orders of magnitude on the scan, which is all of `find` except reading the transcripts.

**Proof plan**
`packages/reading/test/slicer.test.ts`: "find returns the message, decision, evidence and wiki handles holding the
words, ignoring case…" (:46), "a find hit's context holds the match even where lowercasing changes the text's length"
(:111, İ×300), "…where the whole text and its characters lowercase differently" (:188, ΟΔΟΣ/οδος), "a find hit's
context never starts or ends inside a surrogate pair" (:320), the two paging tests (:147, :299); `tests/acceptance/63`.
Gain without wall time: count `lowerOf` calls for one `find` over a fixture (before: 2 per character of every text;
after: 1 per character of each hit's text only).

**Risk** low to medium (rests on a Unicode property, backed by the count above). ~12 changed lines.

---

## F2. Command checks read a whole program file to look at its first line — CONFIRMED

**Where**
- `packages/checks-command/src/shell.ts:73` (`traced`): `readFileSync(at, 'latin1').slice(0, 200).split('\n')[0]`
- `packages/checks-command/src/index.ts:123` (`interpreterOf`): the same expression

**What**
`traced()` runs for every program a check's command names (`untraced`, `index.ts:275`, every run) and for every child
the tracer recorded (`hiddenChild`, `index.ts:416-423`). Only `node` returns before the read. Every other program is
read whole into a one-byte string to test `startsWith('#!')`: a Python interpreter per Python child, and for a
command the tracers can't see into (`cargo`, `go`, `uv`, `bun`, `deno`, `docker`, `git`) the entire binary, tens of
MB, synchronously in the process that runs the check, once per run before it answers `uncounted`.

**Change** — one helper in `shell.ts`, used at both sites (two callers today):
```ts
import { closeSync, existsSync, openSync, readFileSync, readSync, realpathSync } from 'node:fs';

/** A file's first line as its first 200 bytes hold it, read as latin1: a `#!` line, or how a binary starts. */
export function firstLine(path: string): string {
  const fd = openSync(path, 'r');
  try {
    const head = Buffer.alloc(200);
    return head.toString('latin1', 0, readSync(fd, head, 0, 200, 0)).split('\n')[0] ?? '';
  } finally {
    closeSync(fd);
  }
}
```
`shell.ts:73` → `head = firstLine(at);` (inside the existing `try`); `index.ts:123` → `const head = firstLine(path);`
(inside the existing `try`), importing `firstLine` from `./shell.js`.

**Why it is safe**
latin1 is one byte per character, so `.slice(0, 200)` of the whole file is exactly its first 200 bytes. Both sites
already sit in a `try` whose `catch` gives `''` / `null`: a missing file throws from `openSync`, a directory from
`readSync` (EISDIR), as `readFileSync` did; the `finally` closes the descriptor. `pnpmShim` (`shell.ts:118`) still reads
its shim whole, which it needs (it matches the full text) and only for a `#!/bin/sh` head.

**Gain**
Bytes read per classified program: file size → 200. For an untraced binary that is 10–100 MB of read plus a
same-sized string, per run, gone. Unmeasured in time.

**Proof plan**
`packages/checks-command/test/regressions.test.ts` (the untraced-program, pnpm-shim, venv and stand-in cases, e.g.
:973 "reaches its stand-in by name, traced…", :978 "(wrong program) without the stand-in, the run is uncounted…");
`tests/acceptance/30`. Count: bytes read through `fs.readSync`/`readFileSync` for one `untraced('cargo test', …)`.

**Risk** low. ~12 changed lines.

---

## F3. A session's readings are refolded with five sorts and three scans that are quadratic in its length — CONFIRMED

**Where** `packages/readings/src/record.ts`
- `:211`, `:227`, `:230`, `:231`: `foldSession` calls `heldTime(list)`, `budgetCost(list)`, `staleRuns(list)`,
  `loopHolds(list)`; each starts with `bySession(events)` (`:30-37`), which re-sorts (`inOrder`, `:26`, two wrapper
  arrays) and re-groups a list `update` (`:380`) just sorted and grouped, running `canon` (`:21`, two regex replaces)
  on every event again.
- `:55`: per `stop.held`, `asks.filter((a) => a.ts <= began).at(-1)` — stops × asks.
- `:212-214`, `:219`: per turn, `held.stops.filter(...)` then `list.filter(...)` over the whole session — turns × (stops + events).
- `:307-311`: per typed ask, two `list.filter(...).at(-1)` over the whole session — asks × 2 × events.

**What**
`update` refolds a whole session whenever one new event of it lands (`Numbers.fold`, `packages/hub/src/numbers.ts:82`,
on each `numbers.read` and `deep_search`). For a session of N folded events, A asks, S holds, T turns the fold costs
5 sorts + 4N `canon` calls + S·A + T·(S+N) + 2·A·N closure calls. With N=5,000, A=T=300, S=600 that is ~4.9 M
closure calls plus 20,000 `canon` calls per refold; all of it can be O(N).

**Change**
1. Pre-grouped entry points, so `foldSession` skips the four re-sorts (exported signatures unchanged):
```ts
export function heldTime(events: RecordEvent[], options: { budget_ms: number }) { return heldIn(bySession(events), options); }
function heldIn(grouped: Map<string, RecordEvent[]>, options: { budget_ms: number }) {
  ...body as today, with `for (const [session, list] of grouped)`...
}
// the same split for budgetCost → costIn, staleRuns → staleIn, loopHolds → loopsIn
```
   and in `foldSession`: `const one = new Map([[session, list]]);` then `heldIn(one, { budget_ms: BUDGET_MS })`,
   `costIn(one)`, `staleIn(one)`, `loopsIn(one)`.
2. `:55` — asks are in `ts` order, so the last at or before `began` is a binary search:
```ts
/** The last of `sorted` (by ts) at or before `ts`. */
const lastAtOrBefore = (sorted: readonly RecordEvent[], ts: number): RecordEvent | undefined => {
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (sorted[mid]!.ts <= ts) lo = mid + 1; else hi = mid; }
  return sorted[lo - 1];
};
...
const turn = lastAtOrBefore(asks, began)?.id ?? `none:${session}`;
```
3. `:212-220` — one pass instead of a scan per turn:
```ts
// Each stop's newest hold, whichever turn it fell in; a turn's is the newest among its stops'.
const heldAt = new Map<string, number>();
for (const s of held.stops) heldAt.set(s.stop, Math.max(heldAt.get(s.stop) ?? -Infinity, s.at));
const turnAt = new Map<string, number>();
for (const s of held.stops) turnAt.set(s.turn, Math.max(turnAt.get(s.turn) ?? -Infinity, heldAt.get(s.stop)!));
for (const t of held.turns) { const as_of = turnAt.get(t.turn)!; ...push held.turn as today... }
...
for (const s of held.sessions) { const as_of = Math.max(...heldAt.values()); ...as today... }
```
4. `:307-311` — `typed` and `list` are both in `ts` order, so one forward pointer:
```ts
let j = 0;
let stop: RecordEvent | undefined;
let before: RecordEvent | undefined;
for (const a of typed) {
  for (; j < list.length && list[j]!.ts < a.ts; j++) { const e = list[j]!; if (e.kind === ended) stop = e; else if (e.kind === 'user.ask') before = e; }
  if (stop && (!before || before.ts < stop.ts)) { wait += a.ts - stop.ts; waited = a.ts; }
}
```

**Why it is safe**
- (1) `update` groups by `sessionOf(e)` and sorts with `inOrder` before `foldSession(s, all)`; `bySession(all)` then
  yields exactly `Map{ s → all }` (same key, and a stable sort of a sorted list is the list). Events with no session
  never reach a session list (`update` sends them to `across`).
- (2) `asks` is a filter of an `inOrder` list, so `{a.ts <= began}` is a prefix and `filter(...).at(-1)` is its last
  element; a NaN `began` gives `undefined` both ways.
- (3) `held.stops` has one entry per `stop.held` event with `stop: String(e.data.stop)` and `at: e.ts`, so
  `lastHold(S)` (max `ts` of holds whose stop id is in S) is `max(heldAt[id] for id in S)`. The original matches by
  stop id across turns (a stop id shared by two turns counts for both); `heldAt` keeps that. `Math.max` is sticky on
  NaN both ways.
- (4) events with `ts < a.ts` are a prefix of `list`; `typed` ascends, so the pointer never has to go back. `ended`
  is `'turn.usage'` or `'agent.stop'`, never `'user.ask'`, so the `else if` loses nothing.
- All four assume a finite `ts`, which `inOrder`'s comparator already needs to be an order (the record's `ts` is an
  integer column; `Numbers.fold` copies it).
- Left alone on purpose: `budgetCost`'s `list.find` per budgeted check and `staleRuns`' filters per stale run (both
  bounded by rare events), `foldAcross` (linear).

**Gain**
Per refold of the example session: ~4.9 M closure calls → ~N; 5 sorts and 5N `canon` → 1 sort and N. Unmeasured in
time. `benchmarks/readings.mjs` (600 sessions × 30 events) will show only the sort/`canon` part; the quadratic part
needs one long session.

**Proof plan**
`packages/readings/test/scope.test.ts`, `test/loops.test.ts`; `tests/acceptance/45/held.test.ts`,
`lifecycle.test.ts`, `usage.test.ts`, `budgets.test.ts`, `cache.test.ts`, `panel.test.ts`, `search.test.ts`;
`tests/acceptance/45-redraft/lifecycle.test.ts`; `tests/acceptance/965`. Property worth one scratch run (not a new
checked-in test): `readingsOf(recompute(events))` deep-equal before/after on a generated 5,000-event session with
tied timestamps. Gain by count: wrap `canon` and the three predicates with counters on that session.

**Risk** medium (four edits in a fold with many acceptance tests). ~45 changed lines.

---

## F4. The hub's core worker loads the whole conformance package for three small symbols — CONFIRMED (graph), time unmeasured

**Where**
- `packages/checks-numbers/src/kit.ts:9`, `packages/checks-work/src/kit.ts:13`, `packages/checks-review/src/kit.ts:9`, `packages/proof/src/kit.ts:10`: `import { fail, Finding } from '@deepbuild/conformance'`
- `packages/checks-numbers/src/run.ts:6`, `packages/checks-work/src/run.ts:6`: `import { isCheckResult, … } from '@deepbuild/conformance'`
- reached from `packages/hub/src/kinds.ts:9-11` ← `packages/hub/src/core.ts:82` ← `core-worker.ts`
- the symbols live in `packages/conformance/src/slot-types.ts:55-59` and `packages/conformance/src/result.ts` (15 lines), neither of which has a runtime import outside those two files

**What**
Every other importer in the hub's graph takes only types from conformance, or loads it lazily
(`packages/extension-host/src/host.ts:1523`, `:2079`, `:3721`), and `checks-command/src/index.ts:85-89` says outright
that the hub never needs the kits. These six value imports pull the entry in anyway. Static value-import graph from
`packages/hub/src/core.ts` (`ts-small/graph.mjs`, source bytes): 238 files / 4,088 KB, of which conformance is
**30 files / 290 KB** (12.6 % of files, 7.1 % of bytes): all eleven slot kits, the fake agent, the generator, the
adapter kit. `checks-numbers`' own entry is 4 files / 18 KB and drags 50 files / 447 KB.

**Change**
1. `packages/conformance/package.json`: a second entry.
```json
"exports": {
  ".": { "types": "./src/index.ts", "development": "./src/index.ts", "default": "./dist/index.js" },
  "./result": { "types": "./src/result.ts", "development": "./src/result.ts", "default": "./dist/result.js" }
}
```
2. `packages/conformance/src/result.ts`: add `export { fail, Finding } from './slot-types.js';`
3. The six imports above take the three values from `'@deepbuild/conformance/result'`; their `import type` lines stay
   on the main entry (erased). `host.ts:3721` can take `isCheckResult` from the same subpath (optional).

**Why it is safe**
`Finding` is one class in one module (`slot-types.ts`) whichever entry reaches it, so the runner's `instanceof
Finding` (`slot-runner.ts`) still holds. The `.` entry keeps its three conditions, so
`import.meta.resolve('@deepbuild/conformance')` (`checks-command/src/index.ts:89`) and every existing import resolve
as before. No behavior, event or error text changes.
**To check before applying** (could not run here): `scripts/repo-rules.mjs` / `repo-rules.json` keep an allowlist of
cross-package imports with a "why" each; the new specifier may need its line, and the package-modularity lane (#1775)
may want the subpath named in conformance's README card.

**Gain**
30 fewer modules (290 KB of source) read, parsed and top-level-evaluated in the core worker at every hub start, and
their module records and top-level kit data not held for the hub's life, unless a slot-filling package is installed
in that run. Unmeasured in ms and MB.

**Proof plan**
Count: `process.moduleLoadList`-style check is not needed; in a hub test, assert no loaded ESM URL contains
`/conformance/src/slots/` after `Core` starts (or run `ts-small/graph.mjs` on `core.ts` before/after: conformance
30f → 2f). Behavior: `tests/acceptance/87`, `/68`, `/685`, `/314` (the kits' own suites) and the hub suites that run
numbers/work/review checks.

**Risk** low to medium (new subpath export; repo-rules allowlist). ~10 changed lines.

---

## F5. `unheld` rescans every reported test once per control — CONFIRMED

**Where** `packages/checks-command/src/controls.ts:99-111`, called at `packages/checks-command/src/index.ts:384`.

**What**
For each control (one per Vitest/node:test file in the checkout) it runs `ran.some(…)`, `ran.find((t) =>
t.test.includes(c.name))` and `failures.find(…includes…)` over all results: files × tests string scans, on the
thread that ran the check, on every unfiltered run (six times in `runAddedTests`). 300 files × 6,000 tests is ~1.8 M
predicate calls. Same shape as the `goTest` fix of Oct 24.

**Change**
```ts
export function unheld(controls: Control[], ran: Ran[], failures: Failure[], filesRan: Set<string>): string | null {
  // One pass: the files with a test of the check's own, and the controls the report shows.
  const tested = new Set<string | null>();
  const shown: Ran[] = [];
  for (const t of ran) { if (isControl(t.test)) shown.push(t); else tested.add(t.file); }
  const failed = failures.filter((x) => isControl(x.test));
  for (const c of controls) {
    if (!filesRan.has(c.file) || !tested.has(c.file)) continue;
    const r = shown.find((t) => t.test.includes(c.name));
    const f = failed.find((x) => x.test.includes(c.name));
    ...rest unchanged...
```

**Why it is safe**
`c.name` starts with `CONTROL` (`controls.ts:72`), so any test whose name includes `c.name` satisfies `isControl`;
filtering to those first keeps the same first match in the same order. `tested.has(c.file)` is `ran.some((t) =>
t.file === c.file && !isControl(t.test))` (Set equality is `===` for strings and `null`). Messages and return order
are untouched.

**Gain** files × tests → tests + files × controls-reported. Unmeasured in time.

**Proof plan** `tests/acceptance/33/reporting.test.ts` (AC14: a rewrite installed on import is INVALID by the run's
controls, #1099's rule), `packages/checks-command/test/regressions.test.ts`, `tests/acceptance/30`. I found no unit
test that calls `unheld` directly, so the three refusal messages (missing, reported passed, failed elsewhere) are
pinned only through whole runs; say so if the lane wants more. Count the predicate calls on a synthetic 300 × 20 report.

**Risk** low. ~8 changed lines.

---

## F6. `goTest` re-reads `go.mod` for every test — CONFIRMED

**Where** `packages/checks-command/src/report.ts:167-173` (`packageDir` reads and regex-matches `go.mod`), called at `:199` inside `for (const e of leaves)`.

**What** One synchronous `readFileSync(go.mod)` plus a regex per leaf test, though the answer depends only on the
package. 3,000 tests in 40 packages is 3,000 reads where 40 (or 1) would do.

**Change** in `goTest`, before the loop:
```ts
// A package's folder is the same for each of its tests.
const dirs = new Map<string, string | null>();
const dirOf = (pkg: string): string | null => { let d = dirs.get(pkg); if (d === undefined) dirs.set(pkg, (d = packageDir(checkout, pkg))); return d; };
```
and `:199` → `const dir = dirOf(e.Package as string);`

**Why it is safe** `packageDir` is a pure function of `(checkout, pkg, go.mod)` and nothing writes `go.mod` inside
this synchronous function (the run has ended and its processes are stopped: `await stopping`, `index.ts:362`).
`null` is cached as a value, `undefined` means not yet asked.

**Gain** reads of `go.mod`: tests → packages. Unmeasured in time.

**Proof plan** `packages/checks-command/test/regressions.test.ts:854` "a go test run is placed from its report and
fails, but its pass is never counted…"; `tests/acceptance/30`. Count `readFileSync` calls on a report with 100 tests
in 2 packages (100 → 2).

**Risk** low. 3 changed lines.

---

## F7. Validation turns every fixed scalar into canonical text through a deep-copy path — CONFIRMED

**Where** `packages/contracts/src/validate.ts:26-32` (`sameJson`), `:55-58` (const check), `:77` (union tag lookup);
the path it takes: `canonical.ts:9-24` (`canonicalText` → `plainJson` → `readJson`), `json.ts:29-66`.

**What**
Counted over `packages/contracts/schemas`: 795 `const` nodes in 258 schemas, **all 795 scalars**; each of the 213
event schemas fixes 2–3 root fields (avg 2.67: `kind`, `v`, …). So every `validate` of an event (once per append,
`packages/record/src/index.ts:483`) runs `canonicalText` 2–3 times on a string or number: a `try`, a `readJson`
(two objects, a closure, a surrogate regex on strings), a `JSON.stringify`, a string compare, to learn what `===`
says. The union check does the same for each tagged union's tag (45 `oneOf` nodes).

**Change**
```ts
if ('const' in schema) {
  const fixed = schema.const!;
  const want = canonicalText(fixed);   // still refuses a const that isn't JSON, when the schema compiles
  // A scalar is the same JSON only as the same value (every published const is one): no copy, no text.
  if (fixed === null || typeof fixed !== 'object') return (value, at, out) => { if (value !== fixed) out.push(issue('const', at, value)); };
  return (value, at, out) => { if (!sameJson(value, want)) out.push(issue('const', at, value)); };
}
```
and at `:77`: `const named = value[tag]!; try { branch = byTag.get(typeof named === 'string' ? JSON.stringify(named) : canonicalText(named)); } catch { … }`

**Why it is safe**
A check only ever sees the plain copy `readJson` made (`validate.ts:257-259`): finite numbers, well-formed strings,
booleans, null. For such scalars `canonicalText(v)` is `JSON.stringify(v)`, which is injective except `-0`/`0`, both
`"0"`, and `-0 === 0` too; a string never equals a number either way. So `value !== fixed` is exactly
`canonicalText(value) !== want`. The compile-time `canonicalText(fixed)` is kept so a schema whose const isn't JSON
still throws where it does today. Issue code, path and `actual` are unchanged. `seqTransform` (`:199`), which may see
an unvalidated value, is left as it is.

**Gain** Per event validated: 2–3 `canonicalText` calls (≥ 3 allocations each) → 0. Small against the 20 µs
budget (`tests/acceptance/311/redraft-ac12/budgets.test.ts`); unmeasured.

Two neighbours, **PLAUSIBLE**, not proposed without a measurement:
- `json.ts:30`: `copy` creates the `refuse` closure once per JSON node; hoisting it to a module function taking
  `stop` removes one allocation a node unless V8 already elides it.
- `validate.ts:283`: `encode` re-copies the copy it just validated (`canonicalText(json!)` → `plainJson` again).
  `encode`/`decode` have no caller outside tests, so this is not on any hot path.

**Proof plan** `packages/contracts/test/contracts.test.ts`, `test/events.test.ts`; `tests/acceptance/311` (every
fixture, the const and union refusals, the per-call budget); `benchmarks/contracts.mjs`. Count `readJson` calls per
`validate` of one fixture (before: 1 + consts + union tags; after: 1).

**Risk** low. ~6 changed lines.

---

## F8. Every `deep` command loads the facts engine and zlib, which two commands use — CONFIRMED (graph), time unmeasured

**Where** `packages/cli/src/main.ts:5` (`import { gzipSync } from 'node:zlib'`, used only at `:152` in
`debugBundle`), `:8` (`import { replaySession } from '../../../adapters/index.mjs'`, used only at `:57` in `explain`).

**What** The CLI's README says to keep heavy imports lazy, and `main.ts` does for every workspace package. These two
static imports are the exception: `ts-small/graph.mjs` on `main.ts` gives 2 files / 45 KB, of which
`adapters/index.mjs` is 17 KB (38 %), parsed on every `deep inbox`, `deep mcp`, `deep lease`, `deep --version`.

**Change**
- drop both imports;
- `debugBundle` (`:129`): `const { gzipSync } = await import('node:zlib');`
- `explain` (`:47`) becomes `async function explain(session: string, json: boolean): Promise<number>`, with
  `const { replaySession } = await import('../../../adapters/index.mjs');` after the `session.json` check, and
  `:305` becomes `process.exitCode = await explain(args[1], args.includes('--json'));`

**Why it is safe** The module is top-level-await ESM already; both functions are called once, from the dispatch
chain. Output and exit codes are the same. `tests/facts-entry.test.mjs` still finds the CLI naming the folder by path.

**Gain** One module (17 KB) and one built-in fewer per CLI start. Unmeasured; against a 19 ms Node start it is at
most a few percent. Listed because it is two lines of the package's own stated rule.

**Proof plan** `packages/cli/test/cli.test.ts` (explain, debug bundle, help, version); `tests/acceptance/19`,
`/24` (the startup budget). Count: `ts-small/graph.mjs` on `main.ts` (2 files → 1).

**Risk** low. ~6 changed lines.

---

## F9. `Buyer.sync` reads and decodes the whole log to find card rules — CONFIRMED (latent: no caller outside tests yet)

**Where** `packages/buying/src/index.ts:181-194`; the helper it should use: `packages/record/src/index.ts:157-166` (`readSince`).

**What** The first `buy()` pages through every event of every kind from position 0, `JSON.parse`-ing each
(`toEvent`), to keep the `card_rule.set` ones; later buys do the same for everything appended since. `readSince`
exists for exactly this ("every fold that follows the log with a cursor reads it this way") and uses the
`events_kind (kind, log_pos)` index. `@deepbuild/buying` has no importer outside its own tests and
`tests/acceptance/69`, so nothing pays this today.

**Change**
```ts
import { asCore, readSince, ulid, type Connection, type RecordStore } from '@deepbuild/record';
...
private async sync(): Promise<void> {
  this.cursor = await readSince(this.o.record, this.cursor, ['card_rule.set'], (e) => {
    if (e.writer === 'core' && isObj(e.data)) this.rules.set(e.id, { seller: String(e.data.seller), max_usd: Number(e.data.max_usd), card: String(e.data.card) });
  });
}
```
and drop `PAGE` (`:58`) and the `Event` type import, both then unused.

**Why it is safe** The rule map is built from the same events in the same order; only `card_rule.set` was ever
read. The cursor is private; `readSince` returns `max(last read, head at start)`, so nothing is skipped.

**Gain** First buy: all events decoded → only card rules. Unmeasured; zero in production until buying is wired in.

**Proof plan** `tests/acceptance/69`, `packages/buying/test/card-numbers.test.ts`.

**Risk** low. ~8 changed lines.

---

## F10. Journey screens are copied up to six times a step to paint masks, and compared pixel by pixel when identical — CONFIRMED

**Where**
- `packages/checks-journey/src/png.ts:75-83` (`paintMasks` always copies), `:89-105` (`comparePixels`)
- `packages/checks-journey/src/index.ts:623` (`baseDisagreement(paintMasks(a, all), paintMasks(b, all), [])`), `:651`
- `packages/checks-journey/src/screens.ts:58-62` (`baseDisagreement` paints again with the masks it is given)

**What** Per screen step: `:623` paints both base renders, then `baseDisagreement` copies both again with `[]`;
`:651` paints the head and the first base a third time. Six full-frame copies (3.7 MB each at 1280×720) where three
are needed, and none when the spec has no masks. Then the usual case, two identical frames, walks 3.7 M bytes in JS.

**Change**
- `png.ts:75`: first line `if (!masks.length) return image;`
- `index.ts:623`: `baseDisagreement(bs[0].image, bs[1].image, all)`
- `png.ts:90`, after the size check:
  `if ((options.tolerance ?? 0) >= 0 && head.data.length === base.data.length && Buffer.compare(head.data, base.data) === 0) return { same: true };`

**Why it is safe** All four `paintMasks` results go straight into `comparePixels`, which only reads. Painting with
`all` inside `baseDisagreement` is what `:623` did by hand. Byte-equal data means `differing === 0`, which is
`same` whenever the tolerance is not negative (the planted comparator passes 16).

**Gain** Per step: 6 frame copies → 3 (0 without masks); an identical pair by `memcmp` instead of a JS loop.
Unmeasured; small beside a Playwright run.

**Proof plan** `packages/checks-journey/test/png.test.ts`, `test/units.test.ts`; `tests/acceptance/37` (masks, the
planted `tolerates-16-pixels`, unstable base).

**Risk** low. 3 changed lines.

---

## F11. `seededBy` computes `path.relative` for every entry of the checkout — CONFIRMED (small)

**Where** `packages/checks-command/src/seeded.ts:36-46`.

**What** When a run's setup writes a table, the whole checkout is walked and each entry's path is made relative with
`relative(checkout, path).split(sep).join('/')`, though the walk already knows it.

**Change**
```ts
const walk = (dir: string, prefix: string): void => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const path = join(dir, entry.name);
    const rel = prefix + entry.name;
    if (entry.isDirectory()) { if (!OWN_FOLDERS.test(`${rel}/`)) walk(path, `${rel}/`); }
    else if (entry.isFile() && SOURCE.test(entry.name) && !ownFile(rel)) for (const name of written(textOf(path))) app.add(name);
  }
};
walk(checkout, '');
```
(`relative` and `sep` imports go.)

**Why it is safe** A directory entry's name holds no separator, so the prefix joined with `/` is what `relative`
then `split(sep).join('/')` produced.

**Gain** One `path.relative` per entry saved. Unmeasured, small.
Not proposed: stopping the walk once every seeded name is found in app code. It would change one edge: an unreadable
folder later in the walk today throws and leaves the run `uncounted`.

**Proof plan** `tests/acceptance/30` (stand-ins), `packages/checks-command/test/regressions.test.ts`.

**Risk** low. ~5 changed lines.

---

## F12. `canonicalModel` is exported and nothing imports it — CONFIRMED

**Where** `packages/checks-review/src/index.ts:18`.

**What** Repo-wide grep (packages, scripts, benchmarks, tests, tests/acceptance, packs, skills, crates): the name
appears only in `checks-review/src/models.ts` (its definition and two uses) and this re-export.

**Change** `export { independence, reviewBudget, reviewJobRun } from './models.js';`

**Why it is safe** No importer. `models.ts` keeps using it. **Gain** one export fewer. **Proof plan** typecheck.
**Risk** low. 1 line.

---

## F13. The OTLP receiver lists and sorts a log's attributes it then doesn't use — CONFIRMED (latent: nothing starts the receiver yet)

**Where** `packages/otlp/src/index.ts:99-101`.

**What** `all` is filled by a `for…in` over the log's attributes (own and the resource's) for every `api_request`
log; it is read only when the log has no `request_id`.

**Change**
```ts
let key = requestId;
if (key === null) {
  const all: Array<[string, Scalar]> = [];
  for (const name in log.attrs) all.push([name, log.attrs[name]!]);
  key = JSON.stringify([log.timeMs, all.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))]);
}
```

**Why it is safe** `text()` gives a string or `null`, and `??` took the fallback only for `null`.
**Gain** one array and a prototype-chain enumeration per priced request. Unmeasured, small.
**Proof plan** `packages/otlp/test/receiver.test.ts`, `tests/acceptance/42` (retry in another attribute order).
**Risk** low. 5 lines.

The decoder itself (`wire.ts`) is already read-in-place with prototype attributes; `fields()` creates two helper
closures per message (`:20`, `:31`), which V8 can elide once hot. Not proposed without a measurement.

---

## Asked about, and not a finding

**`@deepbuild/contracts`' entry.** It loads 17 files / 106 KB of source (`ts-small/graph.mjs`). Nothing heavy runs at
import: one `readdirSync` of `schemas/` (266 names), one read of `error@1.json`, and 252 lazy schema entries; schema
files are read and compiled on first use. What is eager and unused by the hook path is tooling: `lint.ts`,
`codegen-ts.ts`, `codegen-rust.ts`, `pattern.ts` = 4 files / 46.7 KB (44 % of the entry's bytes), called only by
`generate.ts`, `scripts/conformance-lint.mjs`, `conformance/src/generator.ts` (`compilePattern`) and acceptance
tests; plus `manifest.ts` (12 KB), which only the extension host calls. Importers that would benefit from a slimmer
entry: the hub's parser workers (`packages/hub/src/hookmap.ts`: contracts is 106 of its 328 KB, loaded once per
worker), and any `deep` command that reaches `@deepbuild/hub` or `@deepbuild/reading`. `deep mcp`, `deep mcp-exec`
and `deep lease` do not load contracts at all (their static graphs are 8–10 hub files). A subpath would touch dozens
of import sites (I did not count them) to save the parse of ~47 KB per process. I do not recommend it without a
measured start-up delta.

**Runtime reporters, channels, pi, paseo.** Their repeated protocol code is deliberate (each ships alone).

**`runNumbers` / `runWork`** (`checks-numbers/src/run.ts`, `checks-work/src/run.ts`) are the same 30 lines but for the
failure's name and the stdin payload. A shared helper has two callers but no home that both may import without
adding an export to conformance; left as a note.

## Seen outside this area (for the owning agents; PLAUSIBLE, not traced to the end)

- `packages/hub/src/core.ts:457`, `:2489-2490`: `tails: Map<string, UsageTail>` gains an entry per Claude Code
  session and nothing deletes one; each holds every message id of its session (`readings/src/usage.ts:51`).
- `packages/hub/src/numbers.ts:130`: `search` calls `recompute(events)` over every folded event on each
  `deep_search`; for `{ everyone: true }` that is `this.state`, already folded.
- `packages/hub/src/hookmap.ts:267`, `:308`: a `tool.after` hook is mapped twice (as itself, then as `PreToolUse`),
  and `adapters/index.mjs:13-26` rebuilds its field table and (`:72`) a `RegExp` on each.
- `packages/asks/src/index.ts:1754`: the same all-kinds `record.read` loop as F9.
- `packages/extension-host/src/host.ts:1524`, `:2080`: `slotKits().find(…)` builds all eleven kits to pick one.
- `packages/github/src/delivery.ts:90-100`: a repo's `pushes`, `trees` and `told` grow for the hub's life.

## Dispositions

| Package | Disposition |
|---|---|
| `packages/contracts` (handwritten) | F7. Entry import: no change recommended (see above). `recordHash`, `lint`, codegen: test- or generate-only but pinned by acceptance suites: keep. |
| `packages/conformance` | F4 (a `./result` entry). Kits and runner: install-time and preflight only, already memoized (`plantedEntries`, `codeFamilies`): keep. |
| `packages/checks-command` | F2, F5, F6, F11. `vitest()`, `nodeTest()`, `unrun()`, `listSource()`: linear or cached already: keep. Runtime reporters: keep. |
| `packages/checks-journey` | F10. PNG codec and driver: keep. |
| `packages/checks-numbers` | F4 (import site). `run.ts` twin of checks-work's: note only. |
| `packages/checks-review` | F4 (import site), F12. |
| `packages/checks-work` | F4 (import site). |
| `packages/cli` | F8. |
| `packages/adapters` + `adapters/index.mjs` | Keep. `isObject` is defined in both `src/index.ts:26` and `src/shipped.ts:10` (one line each); the engine's per-hook table rebuild is a few µs: note only. |
| `packages/config-eval` | Keep: script-driven, dominated by model runs. |
| `packages/github` | Keep: network-bound; unbounded per-repo maps noted above. |
| `packages/otlp` | F13 (latent). Decoder: keep. |
| `packages/paseo` | Keep (ships alone). |
| `packages/pi` | Keep (ships alone); one config read and one `stat` per tool call is by design (a rebuilt deep-hook is noticed). |
| `packages/proof` | F4 (import site). Runners block on the checker by design: keep. |
| `packages/reading` | F1. Reading job and slices: keep. |
| `packages/readings` | F3. `usage.ts`, `baseline.ts`, `panel.ts`, `classify.ts`, `lifecycle.ts`: keep. |
| `packages/wiki` | Keep. `write()` rewrites every page on each learn; skipping unchanged pages would stop their mtimes moving, an observable change, so not proposed. |
| `packages/channels/*` | Keep (deliberate repetition). |
| `packages/buying` | F9 (latent). |
