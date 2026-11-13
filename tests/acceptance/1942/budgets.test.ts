// AC3 #1942.b3fd8575: budgets, on the reference Mac in the local preflight, compared with the merge base: a host's facts
// refresh in under 5 s over SSH, and a remote run streams its output with under 500 ms lag.
//
// Split as #1098's and #1515's budgets are (design: Every task carries its own budgets):
// - "In the local preflight, compared with the merge base" is the perf lane's (scripts/benchmark.mjs over
//   benchmarks/budgets.json): the first test holds the lane to a task whose initialReason names #1942, valid by the
//   lane's own rule. This suite runs no git, so it can't read the merge base's budgets; the lane compares them.
// - The issue's numbers are judged here, by the repo's rule (scripts/benchmark.mjs's judgeLimit: five readings after a
//   warm-up; PASS when all five are within the limit, FAIL when all five are over it by more than the margin, else
//   INCONCLUSIVE, and INCONCLUSIVE off a reference Mac, on battery, or with the load above the cores at a reading's
//   start or end). The work runs first, so a missing surface fails whatever the machine; a reading that can't count
//   prints and the test skips as INCONCLUSIVE. It never passes by skipping.
//   * Facts: host.facts {refresh: true} on dh-ubuntu, from the call to its reply, after a listener of the test's was
//     opened on the host, which each refreshed `listening` fact must hold, with every fact read during the call; then
//     a read without refresh keeps each fact's as_of (README, Facts).
//   * Lag: a run on dh-ubuntu writes `dh1942 lag <i> <host ns>` every 100 ms; `deep run follow` reads it; a line's lag
//     is when it reached this process less when the host wrote it, on this Mac's clock (the host's clock offset read
//     over SSH, README, How lag is measured). After a 2 s warm-up, five windows of 20 lines each; a window's reading is
//     its worst line.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test, type TestContext } from 'vitest';
import { AC, benchmark, CORES, follow, LAG_MS, lagOf, loadNow, must, mustBeOnHost, openWorld, proof, readLines, redact, REPO, sleep, stampedLines, startRemote, type Line } from './helpers.ts';

const FACTS = ['system', 'gpus', 'drivers', 'disk', 'listening'] as const;
const FACTS_LIMIT_MS = 5000;

async function judged(ctx: TestContext, what: string, limit: number, runs: number[], loads: { start: number; end: number }[]): Promise<void> {
  const { fingerprint, judgeLimit } = await benchmark();
  const machine = fingerprint();
  const result = judgeLimit({ limit, runs, fingerprint: machine, loads });
  const shown = `${what} (ms): ${runs.map((r) => r.toFixed(0)).join(', ')} against ${limit} on ${String(machine.model)} macOS ${String(machine.macosBuild)}, load ${loads.map((l) => `${l.start.toFixed(1)}-${l.end.toFixed(1)}`).join(' ')} on ${CORES} cores: ${result.status}${result.reason ? ` (${result.reason})` : ''}`;
  console.log(`AC3 ${shown}`);
  proof(undefined, `ac3-${what.replace(/\W+/g, '-')}.json`, { runs, loads, limit, result, machine });
  if (result.status === 'BLOCKED') throw Error(`BLOCKED ${shown}`);
  expect(result.status, `FAIL ${shown}`).not.toBe('FAIL');
  if (result.status === 'INCONCLUSIVE') ctx.skip(`INCONCLUSIVE ${shown}`);
}

/** Every object under `value` that has the key. */
function withKey(value: unknown, key: string): Line[] {
  if (Array.isArray(value)) return value.flatMap((v) => withKey(v, key));
  if (typeof value !== 'object' || value === null) return [];
  return [...(key in value ? [value as Line] : []), ...Object.values(value).flatMap((v) => withKey(v, key))];
}

describe(AC[3], () => {
  test('the perf lane has a #1942 task, a first measurement, valid by the lane\'s rule', async () => {
    const { validateBudgets } = await benchmark();
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')) as { tasks: { id: string; initialReason?: string }[] };
    validateBudgets(current, undefined);
    expect(current.tasks.filter((t) => /#1942\b/.test(String(t.initialReason))).map((t) => t.id), 'benchmarks/budgets.json has a task whose initialReason names issue #1942').not.toEqual([]);
  });

  test('on the reference Mac, a host\'s facts refresh over SSH in under 5 s, each fact read during the call, kept with its age', async (ctx) => {
    const w = await openWorld('deep-ubuntu');
    const h = w.host;
    // A listener of the test's on the host, on a port the host picks: what `listening` must hold once refreshed.
    await h.must(`cd "${h.folder}" || exit 1; setsid nohup python3 -c "import socket,time; s=socket.socket(); s.bind(('127.0.0.1', 0)); s.listen(); open('listen.port.tmp','w').write(str(s.getsockname()[1])); __import__('os').rename('listen.port.tmp','listen.port'); time.sleep(900)" >/dev/null 2>&1 < /dev/null & echo $! >> pids`);
    let port = 0;
    for (const deadline = Date.now() + 20_000; !port && Date.now() < deadline; await sleep(250)) port = Number((await h.lines('listen.port'))[0] ?? 0);
    expect(port, 'the test\'s listener is up on the host').toBeGreaterThan(0);
    const kernel = (await h.must('uname -r')).trim();
    const avail = (await h.must('df -B1 --output=avail,size,used "$HOME" | tail -n 1')).trim().split(/\s+/).map(Number);
    const free = [avail[0]!, avail[1]! - avail[2]!];
    const once = async (): Promise<{ ms: number; problems: string[]; facts: Line }> => {
      const t0 = Date.now();
      const p0 = performance.now();
      const reply = await must(w, 'host.facts', { host: w.alias, refresh: true }, 120_000);
      const ms = performance.now() - p0;
      const t1 = Date.now();
      const facts = (reply.facts ?? {}) as Line;
      const problems: string[] = [];
      for (const name of FACTS) {
        const f = facts[name] as Line | undefined;
        if (!f || !('value' in f)) { problems.push(`no ${name} fact`); continue; }
        if (typeof f.as_of !== 'number' || f.as_of < t0 - 250 || f.as_of > t1 + 250) problems.push(`the ${name} fact's as_of ${JSON.stringify(f.as_of)} isn't during the refresh (${t0} to ${t1})`);
      }
      if (!JSON.stringify(facts.system?.value ?? null).includes(kernel)) problems.push(`the system fact doesn't hold the host's kernel release ${kernel}`);
      if (!Array.isArray(facts.gpus?.value) || facts.gpus.value.length !== 0) problems.push(`the gpus fact isn't the empty list this VM has: ${JSON.stringify(facts.gpus?.value ?? null).slice(0, 200)}`);
      if (!withKey(facts.listening?.value, 'port').some((x) => Number(x.port) === port)) problems.push(`the listening fact doesn't hold the port ${port} a process listens on now: ${JSON.stringify(facts.listening?.value ?? null).slice(0, 400)}`);
      const frees = withKey(facts.disk?.value, 'free_bytes').map((x) => Number(x.free_bytes));
      if (!frees.some((n) => free.some((d) => Math.abs(n - d) <= Math.max(d * 0.05, 1 << 30)))) problems.push(`the disk fact names no free_bytes near the ${free[0]} bytes free for your home there: ${JSON.stringify(facts.disk?.value ?? null).slice(0, 300)}`);
      return { ms, problems, facts };
    };
    const warm = await once();
    expect(warm.problems.map((p) => redact(p, h.ssh)), `${w.alias}'s facts, refreshed over SSH, are the host's, read now`).toEqual([]);
    const runs: number[] = [];
    const loads: { start: number; end: number }[] = [];
    let last = warm;
    for (let i = 0; i < 5; i++) {
      // A second apart, so a fact kept from the refresh before can't pass for one read during this call.
      await sleep(1000);
      const start = loadNow();
      last = await once();
      loads.push({ start, end: loadNow() });
      expect(last.problems.map((p) => redact(p, h.ssh)), `refresh ${i + 1}: the facts are read now`).toEqual([]);
      runs.push(last.ms);
    }
    await sleep(3000);
    const kept = await must(w, 'host.facts', { host: w.alias, refresh: false });
    const ages = FACTS.map((name) => ({ name, as_of: kept.facts?.[name]?.as_of, refreshed: last.facts[name]?.as_of }));
    expect(ages.filter((a) => a.as_of !== a.refreshed), 'a read without refresh gives each fact as last read, with its as_of, so its age shows (3 s on)').toEqual([]);
    await judged(ctx, `${w.alias} facts refresh over SSH`, FACTS_LIMIT_MS, runs, loads);
  }, 600_000);

  test('on the reference Mac, a remote run\'s output reaches `deep run follow` within 500 ms of the host writing it', async (ctx) => {
    const w = await openWorld('deep-ubuntu', { approve: true });
    const run = await startRemote(w, 'lag', stampedLines(w.host.folder, 'lag', 150, 100));
    await mustBeOnHost(w, run);
    const f = follow(w, run);
    // The load average every half second, for each reading's start and end.
    const loadAt: { at: number; load: number }[] = [];
    const sampler = setInterval(() => loadAt.push({ at: Date.now(), load: loadNow() }), 500);
    const loadNear = (at: number): number => loadAt.reduce((best, s) => (Math.abs(s.at - at) < Math.abs(best.at - at) ? s : best), { at: 0, load: loadNow() }).load;
    try {
      await readLines(f, 1, /^dh1942 lag /, 90_000, run);
      const before = await w.host.offset();
      const attached = Date.now();
      await readLines(f, 150, /^dh1942 lag /, 120_000, run);
      const after = await w.host.offset();
      const offset = (before.offset + after.offset) / 2;
      const lines = f.lines.filter((l) => l.text.startsWith('dh1942 lag ')).map((l) => ({ l, x: lagOf(l, offset)! }));
      const start = lines.find(({ x }) => x.written >= attached + 2000)?.x.index;
      expect(start, 'the run wrote lines more than 2 s after the follower read its first').toBeDefined();
      const runs: number[] = [];
      const loads: { start: number; end: number }[] = [];
      for (let k = 0; k < 5; k++) {
        const window = lines.filter(({ x }) => x.index >= start! + 20 * k && x.index < start! + 20 * (k + 1));
        expect(window.map(({ x }) => x.index), `window ${k + 1} has its 20 lines, in order, none lost or repeated`).toEqual(Array.from({ length: 20 }, (_, i) => start! + 20 * k + i));
        runs.push(Math.max(...window.map(({ x }) => x.lag)));
        loads.push({ start: loadNear(window[0]!.l.at), end: loadNear(window[19]!.l.at) });
      }
      proof(w, 'ac3-lag-run.json', { run, host: w.alias, clock: { before, after }, windows: runs });
      await judged(ctx, `${w.alias} remote run output lag, worst line per window`, LAG_MS, runs, loads);
    } finally {
      clearInterval(sampler);
      f.stop();
    }
  }, 600_000);
});
