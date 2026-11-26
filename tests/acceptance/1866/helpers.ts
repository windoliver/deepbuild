// Shared test-side tools for #1866's benchmark tests (AC1, AC2, AC5, AC6): the criterion IDs, the churn benchmark run
// as a process, what each cycle left in the record, and a planted run judged against an unplanted one. The benchmark's
// process, its JSON line and words, the record read through events.read and the reference-Mac gate are #2650's
// (../2650/helpers.ts), imported, not copied. AC3's and AC4's worlds are their files' own, after #806's and #322's.
import { expect } from 'vitest';
import { bench, HEAP_LIMIT, HEAP_LIMIT_PER_1000, lineFrom, MINUTE, near, recorded, shown, sizesNamed, worded, type Line, type Ran } from '../2650/helpers.ts';

export { bench, cleanup, environmentProblem, HEAP_LIMIT, lineFrom, MINUTE, REPO, shown, worded, type Ran } from '../2650/helpers.ts';

// No child of these tests reaches this checkout's repository by its environment.
for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY']) delete process.env[name];

// Each ID is `#1866.` and the first 8 hex digits of the SHA-256 of the criterion's text, trimmed and white space
// collapsed (scripts/proof-change.mjs, criterionId).
export const AC1 = 'AC1 #1866.8421f6ab';
export const AC2 = 'AC2 #1866.981a4da3';
export const AC3 = 'AC3 #1866.41fcb862';
export const AC4 = 'AC4 #1866.6741c6f2';
export const AC5 = 'AC5 #1866.02eae137';
export const AC6 = 'AC6 #1866.96583dcb';

/** The warm-up the benchmark always runs, and a short run's cycles after it. */
export const WARMUP = 100;
export const CYCLES = 100;
/** What each planted entry holds, a string no other value shares (README, Defined here, 4). */
export const ENTRY_BYTES = 32_768;
/** A short benchmark run's bound, and a test's: one run is a test's longest step. */
const RUN_MS = 50 * MINUTE;
export const TEST_MS = 60 * MINUTE;
/** One short run of the benchmark, with its flags. */
export const shortRun = (args: string[] = []): Promise<Ran> => bench({ cycles: CYCLES, args, timeoutMs: RUN_MS });

// ---- What each cycle left in the record, read through events.read, never from the benchmark's word.
export interface Ev { id: string; kind: string; log_pos: number; session?: string; session_id?: string; subject?: string; data: Record<string, unknown> }
const KINDS = [
  'session.start', 'session.end', 'session.gone', 'tool.after', 'claim.made', 'run.started', 'run.finished', 'verdict.made', 'doc.patched',
  'turn.usage', 'permission.request', 'ask.created', 'ask.answered', 'decision.applied', 'commit.made',
];
/** One cycle's session, by what the record holds of it. */
export interface Cycle {
  session: string;
  /** Tool calls that edited or wrote a file and worked. */
  edits: number;
  /** Its claims: the newest verdict on each, and how many of its own runs passed. */
  claims: { claim: string; verdict: string | null; passed: number }[];
  /** Revisions it drew through deep_show. */
  shown: number;
  /** Stops whose usage was recorded. */
  usage: number;
  /** Permission prompts, and the asks they raised that were answered (by you or by a saved decision). */
  prompts: number;
  promptsAnswered: number;
  /** Plug-in actions held for your answer, each ask answered by you (a standing rule's answer holds nothing). */
  held: number;
  commits: number;
  ended: number;
  /** The processes the hub recorded gone for it. */
  gone: string[];
}
/** Each session that started, in the record's order, with what it left. */
export async function cyclesOf(r: Ran): Promise<Cycle[]> {
  const events = (await recorded(r.home, KINDS)) as unknown as Ev[];
  const sessionOf = (e: Ev): string | undefined => e.session ?? e.session_id;
  const all = (kind: string): Ev[] => events.filter((e) => e.kind === kind);
  const answered = new Set(all('ask.answered').map((e) => String(e.subject)));
  const decided = new Set(all('decision.applied').map((e) => String(e.data.ask)));
  const outcomes = new Map(all('run.finished').map((e) => [String(e.data.run), String(e.data.outcome)]));
  const passed = new Map<string, number>();
  for (const e of all('run.started')) if (outcomes.get(String(e.data.run)) === 'passed') passed.set(String(e.data.claim), (passed.get(String(e.data.claim)) ?? 0) + 1);
  const newest = new Map<string, string>();
  for (const e of all('verdict.made')) newest.set(String(e.data.claim), String(e.data.outcome));
  const effectOf = (e: Ev): string => String((e.data.subject as { effect?: unknown } | null | undefined)?.effect ?? '');
  const started = [...new Set(all('session.start').map(sessionOf).filter((s): s is string => s !== undefined))];
  const bySession = new Map<string, Ev[]>(started.map((s) => [s, []]));
  for (const e of events) bySession.get(sessionOf(e) ?? '')?.push(e);
  return started.map((session) => {
    const own = bySession.get(session)!;
    const of = (kind: string): Ev[] => own.filter((e) => e.kind === kind);
    const asks = of('ask.created');
    return {
      session,
      edits: of('tool.after').filter((e) => (e.data.kind === 'edit' || e.data.kind === 'write') && e.data.outcome === 'ok').length,
      claims: of('claim.made').map((e) => {
        const claim = `claim:${e.id}`;
        return { claim, verdict: newest.get(claim) ?? null, passed: passed.get(claim) ?? 0 };
      }),
      shown: of('doc.patched').filter((e) => e.data.writer === 'agent').length,
      usage: of('turn.usage').length,
      prompts: of('permission.request').length,
      promptsAnswered: asks.filter((e) => effectOf(e) === 'permission' && (answered.has(`ask:${e.id}`) || decided.has(`ask:${e.id}`))).length,
      held: asks.filter((e) => /^action\.(change|send)$/.test(effectOf(e)) && answered.has(`ask:${e.id}`)).length,
      commits: of('commit.made').length,
      ended: of('session.end').length,
      gone: of('session.gone').map((e) => `${String(e.data.pid)} ${String(e.data.start)}`),
    };
  });
}

/** AC1's parts of a cycle, each with what the record must hold of it. */
export const CLAIM_PARTS: Record<string, (c: Cycle) => boolean> = {
  'an edit: a tool call of kind edit or write that worked': (c) => c.edits >= 1,
  'one claim': (c) => c.claims.length === 1,
  'its claim has a run of its own that passed': (c) => c.claims.length > 0 && c.claims.every((x) => x.passed >= 1),
  'its claim is judged to PASS': (c) => c.claims.length > 0 && c.claims.every((x) => x.verdict === 'PASS'),
  'one deep_show revision recorded': (c) => c.shown === 1,
};
/** AC5's parts. */
export const SESSION_PARTS: Record<string, (c: Cycle) => boolean> = {
  'a stop that carried usage': (c) => c.usage >= 1,
  'one permission prompt': (c) => c.prompts === 1,
  'its permission prompt\'s ask answered': (c) => c.promptsAnswered === 1,
  'one held plug-in action, its ask answered by you': (c) => c.held === 1,
  'one commit': (c) => c.commits === 1,
};
/** How AC5's cycles end, and how AC6's do. */
export const ENDED: Record<string, (c: Cycle) => boolean> = { 'a SessionEnd': (c) => c.ended >= 1 };
export const KILLED: Record<string, (c: Cycle) => boolean> = {
  'no SessionEnd': (c) => c.ended === 0,
  'its process recorded gone': (c) => c.gone.length >= 1,
};
/** Every part, warm-up's cycles included: the first few sessions that lack one are named, with what they hold. */
export function expectParts(cycles: readonly Cycle[], total: number, ...parts: Record<string, (c: Cycle) => boolean>[]): void {
  expect(cycles.length, 'one session a cycle, warm-up\'s included').toBe(total);
  for (const [part, holds] of parts.flatMap((p) => Object.entries(p))) {
    const lacking = cycles.filter((c) => !holds(c));
    expect(lacking.length, `every cycle has ${part}; ${lacking.length} of ${total} don't, such as ${JSON.stringify(lacking.slice(0, 2))}`).toBe(0);
  }
}

// ---- The reading.
/** The benchmark's line for a short run: its cycles, warm-up and spacing, and the growth per 1,000 cycles the issue's reading names. */
export function readingOf(r: Ran, cycles = CYCLES): Line & { killed?: boolean } {
  const line = lineFrom(r) as Line & { killed?: boolean };
  expect([line.cycles, line.warmup, line.every], `cycles, warm-up, read every: ${shown(r)}`).toEqual([cycles, WARMUP, 100]);
  expect(Number.isFinite(line.heapGrowthBytes) && Math.abs(line.heapGrowthPer1000Bytes - (line.heapGrowthBytes * 1000) / cycles) <= 1, `the reading names the heap's growth per 1,000 cycles: ${JSON.stringify({ heapGrowthBytes: line.heapGrowthBytes, heapGrowthPer1000Bytes: line.heapGrowthPer1000Bytes })}`).toBe(true);
  return line;
}

// ---- A planted run (AC2, AC5, AC6; README, Wrong programs).
/**
 * The planted hub runs the benchmark's cycles (`args` more flags, such as `--killed`): it fails, exit non-zero, and its
 * FAIL on heap growth names the cycle count and the growth it read; and it grows by what the plant keeps, an entry a
 * cycle, over the unplanted hub on the same cycles, whose growth is the comparison and is never asserted to be under
 * the limit (a short run reads noise as growth).
 */
export async function plantedFails(plant: string, unplanted: () => Promise<Ran>, args: string[] = []): Promise<void> {
  const r = await bench({ cycles: CYCLES, plant, args, timeoutMs: RUN_MS });
  expect(worded(r, 'BLOCKED'), `a planted run is measured, never BLOCKED: a hub that doesn't know DEEP_HUB_PLANT=${plant} stops at its start`).toEqual([]);
  const line = readingOf(r);
  expect(r.code, `a planted hub fails the benchmark, exit non-zero: ${shown(r)}`).not.toBe(0);
  expect(line.heapGrowthPer1000Bytes, 'the hub\'s retained heap grows past the limit per 1,000 cycles').toBeGreaterThanOrEqual(HEAP_LIMIT_PER_1000);
  const fails = worded(r, 'FAIL');
  const fail = fails.find((l) => /\bheap\b/i.test(l));
  expect(fail, `a FAIL line on the retained heap's growth: ${fails.join(' | ') || shown(r)}`).toBeDefined();
  expect(fail, 'the line names the cycle count').toMatch(new RegExp(`\\b${CYCLES} cycles\\b`));
  const growth = [line.heapGrowthBytes, line.heapGrowthPer1000Bytes];
  expect(sizesNamed(fail!).some((n) => growth.some((g) => near(n, g))), `the line names the growth it read, ${JSON.stringify(growth)}: ${fail}`).toBe(true);

  const healthy = readingOf(await unplanted());
  const added = line.heapGrowthBytes - healthy.heapGrowthBytes;
  const kept = ENTRY_BYTES * CYCLES;
  console.log(`#1866 ${plant}: heap ${line.heapGrowthBytes} B over ${CYCLES} cycles, unplanted ${healthy.heapGrowthBytes} B, added ${added} B; an entry a cycle is ${kept} B`);
  expect(added, `${plant} keeps an entry a cycle, ${kept} B over the unplanted hub's ${healthy.heapGrowthBytes} B; a cycle that never reaches what it keeps adds nothing`).toBeGreaterThanOrEqual(kept / 2);
  expect(added, `${plant} keeps one entry a cycle, not several`).toBeLessThanOrEqual(kept * 3);
}

/** A long run judged (budgets.long.test.ts): over 5,000 cycles the retained heap grows under 1 MB, the benchmark says so, and the reading names the growth per 1,000 cycles beside the merge base's. */
export function underBudget(r: Ran, mergeBase: string): void {
  const line = readingOf(r, 5000);
  console.log(`#1866 growth${line.killed ? ', killed' : ''}: heap ${line.heapGrowthBytes} B over ${line.cycles} cycles, ${line.heapGrowthPer1000Bytes} B per 1,000; merge base ${JSON.stringify({ ...line.mergeBase, readings: undefined })}`);
  expect(line.readings.length, 'a reading right after warm-up, then one every 100 cycles').toBe(51);
  expect(line.heapGrowthBytes, `retained heap growth over 5,000 cycles, in bytes: ${shown(r)}`).toBeLessThan(HEAP_LIMIT);
  expect(r.code, `an under-budget run exits 0: ${shown(r)}`).toBe(0);
  expect(worded(r, 'FAIL'), 'an under-budget run prints no FAIL').toEqual([]);
  expect(line.mergeBase?.commit, 'the comparison names the merge base').toBe(mergeBase);
  expect(Number.isFinite(line.mergeBase?.heapGrowthPer1000Bytes), `the merge base's growth per 1,000 cycles, read through the same cycles: ${JSON.stringify(line.mergeBase)?.slice(0, 400)}`).toBe(true);
}
