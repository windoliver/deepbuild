// Criterion 4: "Budgets, on the reference Mac in the local preflight, compared with the merge base: rewriting a 1 MB
// program takes under 200 ms once at check; a flock step takes under 0.5 ms of CPU with the metering; a checkpoint of
// a 4 MiB memory under 2 ms; a save of a 4 MiB memory reads back whole in under 50 ms off the UI thread; and a piece
// without logic gains no work per frame"
//
// Every leg is pinned to the reference Mac: on any other host each test fails BLOCKED, before it measures. On a Mac,
// each limit is judged by the repo's own rule for a timing budget (scripts/benchmark.mjs: judgeLimit, five readings
// after a warm-up, on one of the reference Macs on mains power, Low Power Mode off, thermal state nominal, load under
// the core count); anything but PASS fails the test, naming the judge's reason. Readings come through `deep-logic`
// (README: deep-logic, Budget readings): the first `check` of a 1 MB program in a fresh process, timed from outside;
// the flock's simulate-phase CPU a step in a live view (#532's `view` and `frame`); a checkpoint's `ns`; a save's
// `write_ns` and `on_ui_thread`; and the frames of a view of a piece without logic.
import { availableParallelism, loadavg } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { AC, REPO, TIMEOUT, bakeCall, bakeOf, checkCall, layoutFor, live, logicBin, num, onReferenceMacOnly, piece, prebuild, run, savesDir, str, yours, type JsonObject, type JsonValue } from './helpers.ts';
import { FLOCK_WRITES, big, flock, hoard, layoutProbe } from './programs.ts';

prebuild(() => { if (process.platform === 'darwin') logicBin(); });

interface Judged { status: string; reason?: string }
type Judge = (a: { limit: number; runs: number[]; fingerprint: JsonValue; loads: { start: number; end: number }[] }) => Judged;
/** The repo's budget judge and the machine it ran on (scripts/benchmark.mjs). */
async function judge(limit: number, reading: () => Promise<number> | number, what: string): Promise<void> {
  const bench = await import(join(REPO, 'scripts', 'benchmark.mjs')) as { fingerprint: () => JsonValue; judgeLimit: Judge };
  await reading(); // warm-up, not judged
  const runs: number[] = []; const loads: { start: number; end: number }[] = [];
  for (let i = 0; i < 5; i++) { const start = loadavg()[0]!; runs.push(await reading()); loads.push({ start, end: loadavg()[0]! }); }
  const verdict = bench.judgeLimit({ limit, runs, fingerprint: bench.fingerprint(), loads });
  expect(verdict.status, `${what}: ${verdict.status} under ${limit} (runs ${JSON.stringify(runs)}, ${availableParallelism()} cores): ${verdict.reason ?? ''}`).toBe('PASS');
}

const FLOCK_TRACK = [yours('wind', 30, 0.2), yours('wind', 300, -0.4)];
function flockPiece(): JsonObject {
  const l = layoutFor(layoutProbe(), ['wind'], FLOCK_WRITES);
  return piece({ seed: 532_01, class: 'figure', controls: ['wind'], items: { flock: { program: flock(l), reads: ['wind'], writes: FLOCK_WRITES } } });
}
const hoard4 = (saveAt: number[]): JsonObject => piece({ seed: 534_04, items: { hoard: { program: hoard(64, saveAt), writes: { request: { type: 'i32' } }, budget: { memory: 4 }, saves: { slots: 1, request: 'request' } } } });

describe(`${AC[4]} the budgets on the reference Mac`, () => {
  it(`${AC[4]} rewriting a 1 MB program takes under 200 ms, once at check`, async () => {
    onReferenceMacOnly('criterion 4\'s rewrite budget');
    const program = big();
    expect(program.bytes.length, 'the program is at least 1 MB').toBeGreaterThanOrEqual(1_000_000);
    const p = piece({ seed: 534_41, items: { big: { program, writes: { v: { type: 'i32' } } } } });
    await judge(200, async () => {
      const l = live();
      try {
        await l.call({ call: 'about' });
        const t0 = performance.now();
        const reply = await l.call(checkCall(p));
        const ms = performance.now() - t0;
        expect(reply['ok'], 'the 1 MB program is admitted').toBe(true);
        return ms;
      } finally { l.signal('SIGKILL'); }
    }, 'the first check of a 1 MB program, in ms');
  }, TIMEOUT);

  it(`${AC[4]} a flock step takes under 0.5 ms of CPU with the metering`, async () => {
    onReferenceMacOnly('criterion 4\'s flock step budget');
    const p = flockPiece();
    await judge(0.5, async () => {
      const l = live();
      try {
        const v = await l.call({ call: 'view', piece: p, track: FLOCK_TRACK as unknown as JsonValue, span: 30 });
        const session = str(v['session'], 'view.session');
        let f = await l.call({ call: 'frame', session, seek: 10 });
        let ns = 0; let steps = 0;
        for (let n = 0; n < 10_000; n++) { ns += num(f['eval_ns'], 'eval_ns'); steps += num(f['steps'], 'steps'); if (f['stale'] !== true) break; f = await l.call({ call: 'frame', session }); }
        expect(steps, 'the seek to 10 s ran its 601 steps').toBe(601);
        return ns / steps / 1e6;
      } finally { l.signal('SIGKILL'); }
    }, 'the flock\'s simulate-phase CPU a step, in ms');
  }, TIMEOUT);

  it(`${AC[4]} a checkpoint of a 4 MiB memory takes under 2 ms`, async () => {
    onReferenceMacOnly('criterion 4\'s checkpoint budget');
    await judge(2, () => {
      const b = bakeOf(run([bakeCall(hoard4([]), { steps: 600 })])[0]!, 'the bake of a 4 MiB memory');
      const ns = (b.checkpoints['hoard'] ?? []).map((c) => c.ns);
      expect(ns.length > 0 && ns.every((x) => x !== null), 'each checkpoint reports the CPU time it took (ns)').toBe(true);
      return Math.max(...(ns as number[])) / 1e6;
    }, 'the slowest checkpoint of a 4 MiB memory, in ms');
  }, TIMEOUT);

  it(`${AC[4]} a save of a 4 MiB memory reads back whole in under 50 ms, off the UI thread`, async () => {
    onReferenceMacOnly('criterion 4\'s save budget');
    await judge(50, () => {
      const b = bakeOf(run([bakeCall(hoard4([9]), { steps: 10, saves_dir: savesDir() })])[0]!, 'the bake that saves a 4 MiB memory');
      const [s] = b.saves;
      expect(s?.on_ui_thread, 'the save is written off the UI thread').toBe(false);
      expect(s?.write_ns, 'and reports the time until it read back whole (write_ns)').not.toBeNull();
      return s!.write_ns! / 1e6;
    }, 'a 4 MiB save until it read back whole, in ms');
  }, TIMEOUT);

  it(`${AC[4]} a piece without logic gains no work per frame`, async () => {
    onReferenceMacOnly('criterion 4\'s no-logic frame budget');
    const l = live();
    try {
      const v = await l.call({ call: 'view', piece: piece({ seed: 534_42, items: {} }), track: [], span: 10 });
      const session = str(v['session'], 'view of a piece without logic');
      for (let n = 0; n < 120; n++) {
        const f = await l.call({ call: 'frame', session, ...(n === 0 ? { seek: 5 } : {}) });
        expect([f['steps'], f['eval_ns']], `frame ${n + 1}: the logic module does no work for a piece without logic`).toEqual([0, 0]);
      }
    } finally { l.signal('SIGKILL'); }
  }, TIMEOUT);
});
