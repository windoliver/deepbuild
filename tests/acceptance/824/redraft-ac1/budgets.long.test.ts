// AC1 #824.5d5b3077: over 5,000 cycles after warm-up, the hub's retained heap grows under 1 MB and its resident memory
// under 10 MB, compared with the merge base, on the reference Mac.
//
// Runs `node benchmarks/hub-churn.mjs --home <temp> --merge-base` once (default 5,000 cycles) and decides from its
// readings, never from its verdict alone. README.md says why growth is read this way.
//
// - Growth of one side = the larger of (last - cycle 0) and (median pairwise slope x cycles). The issue's per-1,000-cycle
//   reading is the slope x 1,000; the limits over 5,000 cycles are 200 kB and 2 MB per 1,000.
// - This side's growth must be under the limit outright, and under it above the merge base's growth when that has readings.
// - The benchmark's verdict must agree: PASS with exit 0, and no PASS on readings over the limit.
// - The home's record must hold the cycles the readings claim.
// Off a fit reference Mac, before or after the run, it skips as INCONCLUSIVE; it never passes there.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { availableParallelism, loadavg } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const BENCH = join(REPO, 'benchmarks/hub-churn.mjs');
const BENCH_IN_REPO = 'benchmarks/hub-churn.mjs';
const CYCLES = 5000;
const WARMUP = 100;
const EVERY = 100;
const HEAP_LIMIT = 1_000_000; // the issue's 1 MB, in decimal bytes
const RSS_LIMIT = 10_000_000; // the issue's 10 MB, in decimal bytes
const FOUR_HOURS = 4 * 3_600_000;

interface Reading { cycle: number; heapBytes: number; rssBytes: number }
type Field = 'heapBytes' | 'rssBytes';

const mb = (bytes: number): string => `${(bytes / 1e6).toFixed(3)} MB`;

// ---- The reference Mac, as tests/acceptance/104 and 401.
const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
];
const sh = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
function environmentProblem(): string | null {
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  let model: string, chip: string, gib: number, batt: string, power: string, therm: string;
  try {
    model = sh('sysctl', '-n', 'hw.model');
    chip = sh('sysctl', '-n', 'machdep.cpu.brand_string');
    gib = Math.round(Number(sh('sysctl', '-n', 'hw.memsize')) / 2 ** 30);
    batt = sh('pmset', '-g', 'batt');
    power = sh('pmset', '-g');
    therm = sh('pmset', '-g', 'therm');
  } catch (e) {
    return `cannot read the machine: ${String(e)}`;
  }
  if (!REFERENCE_MACS.some((m) => m.model === model && m.chip === chip && m.gib === gib)) return `not a reference Mac: ${model} / ${chip} / ${gib} GiB`;
  if (!/'AC Power'/.test(batt)) return `not on mains power: ${batt.split('\n')[0]}`;
  const lpm = /^\s*lowpowermode\s+(\d)/m.exec(power);
  if (!lpm) return 'Low Power Mode state unknown (no lowpowermode line in pmset -g)';
  if (lpm[1] !== '0') return 'Low Power Mode is on';
  const limited = [...therm.matchAll(/_Limit\s*=\s*(\d+)/g)].some((m) => Number(m[1]) < 100);
  if (limited || !/No thermal warning level/.test(therm)) return `thermal state not nominal: ${therm.replace(/\s+/g, ' ')}`;
  const [one] = loadavg();
  if (one! > availableParallelism()) return `loaded past its core count: 1-minute load ${one!.toFixed(1)} on ${availableParallelism()} cores`;
  return null;
}

// ---- Reading growth.
/** What's wrong with one side's readings as a 5,000-cycle run read every 100 cycles from a real hub. Empty when sound. */
function shapeProblems(side: string, readings: unknown): string[] {
  if (!Array.isArray(readings)) return [`${side}: readings is not a list`];
  const list = readings as Reading[];
  const out: string[] = [];
  const expected = CYCLES / EVERY + 1;
  if (list.length !== expected) out.push(`${side}: ${list.length} readings, not ${expected} (cycle 0 and every ${EVERY} to ${CYCLES})`);
  list.forEach((r, i) => {
    if (r?.cycle !== i * EVERY) out.push(`${side}: reading ${i} is at cycle ${String(r?.cycle)}, not ${i * EVERY}`);
    if (!Number.isSafeInteger(r?.heapBytes) || r.heapBytes < 1e6) out.push(`${side}: cycle ${String(r?.cycle)} heapBytes ${String(r?.heapBytes)} isn't a Node hub's retained heap in bytes`);
    if (!Number.isSafeInteger(r?.rssBytes) || r.rssBytes < 1e7) out.push(`${side}: cycle ${String(r?.cycle)} rssBytes ${String(r?.rssBytes)} isn't a Node hub's resident memory in bytes`);
    else if (r.rssBytes < r.heapBytes) out.push(`${side}: cycle ${r.cycle} resident ${r.rssBytes} is below its heap ${r.heapBytes}`);
  });
  if (list.length > 1 && new Set(list.map((r) => r?.rssBytes)).size === 1) out.push(`${side}: every resident reading is the same; a live process's aren't`);
  return out;
}

/** Cycle 0 to the last reading. */
const endpoint = (list: Reading[], field: Field): number => list[list.length - 1]![field] - list[0]![field];
/** Bytes per cycle: the median slope over every pair of readings (Theil-Sen), so one odd reading can't move it. */
function slope(list: Reading[], field: Field): number {
  const slopes: number[] = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) slopes.push((list[j]![field] - list[i]![field]) / (list[j]!.cycle - list[i]!.cycle));
  }
  slopes.sort((a, b) => a - b);
  const mid = slopes.length >> 1;
  return slopes.length % 2 ? slopes[mid]! : (slopes[mid - 1]! + slopes[mid]!) / 2;
}
/** The larger of the two: the slope sees a leak behind an inflated cycle 0, the endpoint sees a late step the slope averages down. */
const growth = (list: Reading[], field: Field): number => Math.max(endpoint(list, field), slope(list, field) * CYCLES);
const describeSide = (list: Reading[], field: Field): string =>
  `${mb(slope(list, field) * 1000)} per 1,000 cycles, ${mb(endpoint(list, field))} cycle 0 to ${CYCLES}, growth ${mb(growth(list, field))}`;

// ---- The record: the cycles happened on a real hub (invariant 1: the JSON's own word is no evidence of them).
async function recordProblems(home: string): Promise<string[]> {
  const ledger = join(home, '.deepbuild', 'ledger.db');
  if (!existsSync(ledger)) return [`no record at --home's .deepbuild/ledger.db, so nothing shows a hub ran these cycles`];
  const { openRecord } = await import('../../../../packages/record/src/index.ts');
  const record = await openRecord({ path: ledger, now: Date.now });
  try {
    const rows = (await record.raw(`SELECT kind, COUNT(*) AS n FROM events WHERE kind IN ('session.start', 'session.end', 'tool.before', 'ask.answered', 'promise.woken') GROUP BY kind`)) as { kind: string; n: number | bigint }[];
    const counts = new Map(rows.map((r) => [r.kind, Number(r.n)]));
    const all = WARMUP + CYCLES;
    const need: [string, number][] = [['session.start', all], ['session.end', all], ['tool.before', all * 10], ['ask.answered', all], ['promise.woken', all]];
    return need.flatMap(([kind, n]) => ((counts.get(kind) ?? 0) >= n ? [] : [`the record holds ${counts.get(kind) ?? 0} ${kind} events, fewer than the ${n} ${WARMUP} + ${CYCLES} cycles make`]));
  } finally {
    await record.close();
  }
}

function runBench(home: string): Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BENCH, '--home', home, '--merge-base'], { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.setEncoding('utf8').on('data', (c: string) => { stdout += c; });
    child.stderr.setEncoding('utf8').on('data', (c: string) => { stderr = (stderr + c).slice(-4000); });
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, FOUR_HOURS);
    child.on('error', reject);
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr, timedOut }); });
  });
}

describe('AC1 #824.5d5b3077 the hub stays flat over 5,000 cycles of churn', () => {
  it('AC1 #824.5d5b3077 over 5,000 cycles after warm-up, retained heap grows under 1 MB and resident memory under 10 MB, also above the merge base, and the benchmark says PASS only then', async (ctx) => {
    expect(existsSync(BENCH), 'BLOCKED: benchmarks/hub-churn.mjs does not exist, so nothing measured the churn').toBe(true);
    const before = environmentProblem();
    if (before) ctx.skip(`INCONCLUSIVE (not a result): ${before}`);

    const home = mkdtempSync('/private/tmp/dh824-');
    try {
      const run = await runBench(home);
      expect(run.timedOut, `INCONCLUSIVE: the benchmark didn't finish within four hours\n${run.stderr}`).toBe(false);

      const lines = run.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
      const verdictLine = lines[lines.length - 1] ?? '';
      const verdict = /^(PASS|FAIL|BLOCKED)\b/.exec(verdictLine)?.[1];
      const context = `exit ${String(run.code)}, verdict line: ${verdictLine || '(none)'}\nstderr tail: ${run.stderr}`;
      expect(verdict, `the last line is not PASS, FAIL or BLOCKED; ${context}`).toBeDefined();
      // Nothing that can't be measured passes.
      if (verdict === 'BLOCKED') expect.fail(`BLOCKED: the benchmark could not measure; ${context}`);
      const parsed = lines.flatMap((l) => {
        try {
          const o = JSON.parse(l) as { bench?: unknown };
          return o?.bench === 'hub-churn' ? [o] : [];
        } catch {
          return [];
        }
      }) as Record<string, unknown>[];
      expect(parsed.length, `one JSON line with bench "hub-churn"; ${context}`).toBe(1);
      const report = parsed[0]!;

      const problems: string[] = [];
      for (const [key, want] of [['cycles', CYCLES], ['warmup', WARMUP], ['every', EVERY]] as const) {
        if (report[key] !== want) problems.push(`${key} is ${String(report[key])}, not ${want}`);
      }
      const shape = shapeProblems('this side', report.readings);
      problems.push(...shape);

      // The merge base: readings judged by the same rule, or a first measurement only where it really has no benchmark.
      const base = report.mergeBase as { commit?: unknown; readings?: unknown; initial?: unknown } | undefined;
      const mergeBase = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
      let baseReadings: Reading[] | null = null;
      if (!base) problems.push('no mergeBase in the report');
      else {
        if (base.commit !== mergeBase) problems.push(`mergeBase.commit is ${String(base.commit)}, not the merge base ${mergeBase}`);
        if (base.readings !== undefined && base.initial !== undefined) problems.push('mergeBase has both readings and initial');
        else if (base.readings !== undefined) {
          const s = shapeProblems('merge base', base.readings);
          problems.push(...s);
          if (!s.length) baseReadings = base.readings as Reading[];
        } else if (typeof base.initial === 'string' && base.initial.trim()) {
          let present = true;
          try {
            execFileSync('git', ['cat-file', '-e', `${mergeBase}:${BENCH_IN_REPO}`], { cwd: REPO, stdio: 'ignore' });
          } catch {
            present = false;
          }
          if (present) problems.push(`mergeBase says initial ("${base.initial}") but ${mergeBase} has ${BENCH_IN_REPO}: it must carry readings`);
        } else problems.push('mergeBase has neither readings nor a reason in initial');
      }

      // The issue's numbers, this side outright and above the merge base.
      if (!shape.length) {
        const list = report.readings as Reading[];
        for (const [name, field, limit] of [['retained heap', 'heapBytes', HEAP_LIMIT], ['resident memory', 'rssBytes', RSS_LIMIT]] as const) {
          const mine = growth(list, field);
          console.log(`${name} this side: ${describeSide(list, field)}`);
          if (mine >= limit) problems.push(`${name} grew ${mb(mine)} over ${CYCLES} cycles, not under ${mb(limit)} (${describeSide(list, field)})`);
          if (baseReadings) {
            const theirs = growth(baseReadings, field);
            console.log(`${name} merge base ${mergeBase}: ${describeSide(baseReadings, field)}`);
            if (mine - theirs >= limit) problems.push(`${name} grew ${mb(mine - theirs)} more than the merge base's ${mb(theirs)}, not under ${mb(limit)}`);
          } else console.log(`${name} merge base ${mergeBase}: first measurement: ${String(base?.initial)}`);
        }
      }
      problems.push(...await recordProblems(home));

      // A run on a machine that stopped being fit is no result either way.
      const after = environmentProblem();
      if (after) {
        console.log(`readings not counted: ${problems.join('\n') || 'none over'}`);
        ctx.skip(`INCONCLUSIVE (not a result): ${after}`);
      }

      if (verdict === 'PASS' && run.code !== 0) problems.push(`the benchmark says PASS but exits ${String(run.code)}`);
      if (verdict !== 'PASS' && run.code === 0) problems.push(`the benchmark says ${verdict} but exits 0`);
      if (verdict === 'FAIL') problems.push(`the benchmark itself fails: ${verdictLine}`);
      if (verdict === 'PASS' && problems.length) problems.push(`and the benchmark said PASS on this: ${verdictLine}`);
      expect(problems, `AC1 #824.5d5b3077 FAIL\n${problems.join('\n')}`).toEqual([]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, FOUR_HOURS + 300_000);
});
