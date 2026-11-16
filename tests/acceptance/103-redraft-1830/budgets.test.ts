// AC14: budgets, on the reference Mac in the local preflight, compared with the merge base: wiring a composition at
// install takes under 100 ms, and a reading crossing an edge adds under 1 ms.
//
// A blind redraft of tests/acceptance/103/budgets.test.ts (#1830): every timing run reads the one-minute load average
// (`os.loadavg()[0]`) at its start and at its end, and judgeLimit gets those readings as `loads`, one { start, end }
// per run in the runs' order, as the design's timing rule says (a loaded run counts neither way).
//
// Split as #365's budgets are (design: Every task carries its own budgets):
// - The merge-base comparison is the perf lane's (scripts/perf.mjs, benchmarks/budgets.json): each timing has a task
//   there (`composition-wire`, `composition-edge-read`), and the budgets are valid against the merge base's, so the
//   preflight compares this change's p50 with the merge base's on the same work.
// - The issue's numbers are judged here, five runs after a warm-up, by the repo's judgeLimit: PASS when all five are
//   within the limit, FAIL when all five are over it by more than the margin, INCONCLUSIVE otherwise, off a reference
//   Mac (mains power, Low Power Mode off, thermal state nominal), or when the load at any run's start or end is above
//   the core count or can't be read. Only PASS passes; FAIL fails; INCONCLUSIVE (or BLOCKED) prints its readings and
//   skips as INCONCLUSIVE with judgeLimit's reason, never passed. The surface is exercised first, so a base without it
//   fails before any timing. Then, as in the first draft, the test skips as INCONCLUSIVE before its timed runs when
//   this machine can't count a run now: judgeLimit, given five empty runs with the load read at each one's start and
//   end, reads anything but PASS off a fit reference Mac or under load. Past that gate, the five real runs are judged
//   with their own loads.
// - Wiring: the time `install` takes for the brief with two uses whose providers are loaded, minus the time it takes
//   for the same package with no uses (the copy, digest and manifest checks every install does). Reading: inside the
//   user's own process, the mean time of `deep.read` through its edge minus the mean time of `deep.config.get`, a
//   round trip to the hub that crosses no edge.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { describe, expect, it, type TestContext } from 'vitest';
import type { ExtensionHost } from '../../../packages/extension-host/src/index.ts';
import { act, admitted, edgesOf, ID, openHost, openWorld, piece, provides, REPO, shape, uses } from '../103/helpers.ts';

const TASKS = ['composition-wire', 'composition-edge-read'];
const WIRE_MS = 100;
const READ_MS = 1;
const PRICES = 'ext.stocks.prices@1';
const CI = 'ext.ci.status@1';
const PRICES_SHAPE = shape({ symbol: { type: 'string' }, cents: { type: 'integer' } });
const CI_SHAPE = shape({ state: { type: 'string' } });

/** The one-minute load average at a run's start and at its end. */
interface Load { start: number; end: number }
interface Verdict { status: 'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'BLOCKED'; reason?: string }
interface Benchmark {
  validateBudgets(current: unknown, base: unknown): void;
  fingerprint(): Record<string, unknown>;
  judgeLimit(input: { limit: number; runs: number[]; fingerprint: Record<string, unknown>; loads: Load[] }): Verdict;
}
const benchmark = () => import(join(REPO, 'scripts/benchmark.mjs')) as Promise<Benchmark>;
const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2; };

/** Five timed runs, each with the one-minute load read just before it starts and just after it ends. */
async function fiveRuns(run: () => Promise<number>): Promise<{ runs: number[]; loads: Load[] }> {
  const runs: number[] = [];
  const loads: Load[] = [];
  for (let i = 0; i < 5; i++) {
    const start = loadavg()[0]!;
    runs.push(await run());
    loads.push({ start, end: loadavg()[0]! });
  }
  return { runs, loads };
}

/**
 * Skips as INCONCLUSIVE before the timed runs when this machine can't count a run now: judgeLimit on five empty runs,
 * each with the one-minute load read at its start and its end, reads anything but PASS off a fit reference Mac or
 * under load.
 */
async function onReference(ctx: TestContext, what: string): Promise<void> {
  const { fingerprint, judgeLimit } = await benchmark();
  const empty = await fiveRuns(async () => 0);
  const now = judgeLimit({ limit: 1, ...empty, fingerprint: fingerprint() });
  if (now.status !== 'PASS') {
    console.log(`AC14 INCONCLUSIVE: ${what} not judged: ${now.reason}`);
    ctx.skip(`INCONCLUSIVE: ${now.reason}`);
  }
}

/** judgeLimit on the five runs and their loads: PASS passes, FAIL fails, anything else skips as INCONCLUSIVE. */
async function judged(ctx: TestContext, what: string, limit: number, { runs, loads }: { runs: number[]; loads: Load[] }): Promise<void> {
  const { fingerprint, judgeLimit } = await benchmark();
  const machine = fingerprint();
  const result = judgeLimit({ limit, runs, fingerprint: machine, loads });
  const shown = `${what}: ${runs.map((r) => r.toFixed(3)).join(', ')} against ${limit}, one-minute load at each run's start and end ${loads.map((l) => `${l.start.toFixed(1)}/${l.end.toFixed(1)}`).join(', ')}, on ${String(machine.model)} macOS ${String(machine.macosBuild)}: ${result.status}${result.reason ? ` (${result.reason})` : ''}`;
  console.log(`AC14 ${shown}`);
  expect(result.status, `FAIL ${shown}`).not.toBe('FAIL');
  if (result.status !== 'PASS') ctx.skip(`INCONCLUSIVE ${shown}`);
}

/** A host with the stocks and CI plug-ins loaded. */
async function providers(): Promise<ExtensionHost> {
  const h = await openHost(await openWorld());
  await admitted(h, await piece({ id: 'acme/stocks', spec: { outputs: [{ interface: PRICES, kind: 'reading', schema: PRICES_SHAPE, value: { symbol: 'ACME', cents: 12345 } }] }, manifest: { provides: [provides(PRICES, [PRICES_SHAPE])] } }), 'the stocks plug-in');
  await admitted(h, await piece({ id: 'acme/ci', spec: { outputs: [{ interface: CI, kind: 'reading', schema: CI_SHAPE, value: { state: 'passed' } }] }, manifest: { provides: [provides(CI, [CI_SHAPE])] } }), 'the CI plug-in');
  return h;
}
/** The brief `acme/<name>` with its two uses, or the same package with none. */
const brief = (name: string, wired: boolean) => piece({
  id: `acme/${name}`, spec: { uses: wired ? [PRICES, CI] : [], read: true, ...(wired ? { bench: { interface: PRICES } } : {}) },
  manifest: wired ? { uses: [uses(PRICES, 0, PRICES_SHAPE), uses(CI, 0, CI_SHAPE)] } : {},
});
/** `install`'s time for a package, in ms. */
async function installMs(h: ExtensionHost, dir: string): Promise<number> {
  const t = performance.now();
  await h.install({ from: dir, builtBy: null });
  return performance.now() - t;
}

describe(`${ID.ac14} budgets on the reference Mac, compared with the merge base: wiring a composition at install takes under 100 ms, and a reading crossing an edge adds under 1 ms`, () => {
  it('AC14 the perf lane has a task for each timing, and the budgets are valid against the merge base\'s', async () => {
    const { validateBudgets } = await benchmark();
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')) as { tasks: { id: string }[] };
    let baseBudgets: unknown;
    try {
      const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
      baseBudgets = JSON.parse(execFileSync('git', ['show', `${base}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
    } catch (e) {
      throw Error(`BLOCKED: no merge base to compare with (git merge-base HEAD origin/main in ${REPO}): ${(e as Error).message.split('\n')[0]}`);
    }
    validateBudgets(current, baseBudgets);
    expect(TASKS.filter((t) => !current.tasks.some((x) => x.id === t)), 'timings with no perf-lane task to compare with the merge base').toEqual([]);
  });

  it('AC14 wiring a composition at install takes under 100 ms (five runs after a warm-up)', async (ctx) => {
    const h = await providers();
    // The surface first: the wired brief's install wires its two uses.
    const first = await admitted(h, await brief('brief', true), 'the brief');
    expect((await edgesOf(h)).filter((e) => e.user === first.id).map((e) => e.provider), 'its two uses are wired').toEqual(['acme/ci', 'acme/stocks']);
    await onReference(ctx, 'wiring at install');
    // One run: three wired and three plain installs, alternated; the wiring is the median of the wired installs'
    // times less the median of the plain ones'.
    let n = 0;
    const once = async (): Promise<number> => {
      const wired: number[] = [];
      const plain: number[] = [];
      for (let i = 0; i < 3; i++) {
        const [w, p] = [await brief(`wired${n}x${i}`, true), await brief(`plain${n}x${i}`, false)];
        wired.push(await installMs(h, w));
        plain.push(await installMs(h, p));
      }
      n++;
      return Math.max(0, median(wired) - median(plain));
    };
    await once();
    await judged(ctx, 'wiring at install beyond an install with no uses (ms)', WIRE_MS, await fiveRuns(once));
  }, 600_000);

  it('AC14 a reading crossing an edge adds under 1 ms (five runs of 200 reads after a warm-up)', async (ctx) => {
    const h = await providers();
    await admitted(h, await brief('brief', true), 'the brief');
    const bench = async (): Promise<number> => {
      const r = await act(h, 'acme/brief', 'ext.brief.bench', { n: 200 });
      if (r.status !== 'done') throw Error(`the bench: ${JSON.stringify(r)}`);
      const { read_ms: read, hub_ms: hub } = r.output as { read_ms: number; hub_ms: number };
      return Math.max(0, read - hub);
    };
    // The surface first: reads through the edge give the provider's value.
    await bench();
    await onReference(ctx, 'a reading crossing an edge');
    await judged(ctx, 'a reading through an edge beyond a hub round trip (ms)', READ_MS, await fiveRuns(bench));
  }, 300_000);
});
