// #1518.bf377712: "Budget, drafted, on the reference Mac in the local preflight: expanding 200 cuts takes under 100 ms,
// without the transcriber's own time"
//
// A 2 min recording of 401 tone words with every odd word left out: 200 cuts, 201 strips (README: Fixtures). Each run is
// a fresh deep-show presenting it with `include: [timing]`, whose reply's `timing.cut_ms` is the time the check spent
// placing and expanding cuts, the recording's decode left out (design); no transcriber runs. Six runs, the first a
// warm-up; the five after it are judged against 100 ms by the perf lane's `judgeLimit` (scripts/benchmark.mjs), with the
// load at each run's start and end: counted only on a reference Mac on mains power, Low Power Mode off, thermal state
// nominal and unloaded, and INCONCLUSIVE anywhere else, never a pass. On any machine a run whose reply has no
// `timing.cut_ms`, or whose row isn't 200 cuts, fails.
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, FULL, RATE, REPO, TIMEOUT, cutRow, inconclusive, isObject, keepAllBut, presentWith, presented, proof, runShow, scenario, show, soundFilm,
  stageWav, toneTake, useShow, useTemp,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const LIMIT = 100;

interface Benchmark {
  fingerprint(): Record<string, unknown>;
  judgeLimit(input: { limit: number; runs: number[]; fingerprint: Record<string, unknown>; loads: { start: number; end: number }[] }): { status: 'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'BLOCKED'; reason?: string };
}
const benchmark = () => import(join(REPO, 'scripts', 'benchmark.mjs')) as Promise<Benchmark>;

describe(`${AC[8]} budget: expanding 200 cuts takes under 100 ms on the reference Mac, without the transcriber`, () => {
  it(`${AC[8]} timing.cut_ms of a 200-cut expansion, five runs after a warm-up, is under 100 ms on the reference Mac (judgeLimit; INCONCLUSIVE elsewhere)`, async () => {
    const bin = shows.bin(FULL);
    const evidence = temp();
    const take = toneTake(401);
    const removed = Array.from({ length: 200 }, (_, k) => 2 * k + 1);
    const s = stageWav(evidence, take);
    const doc = soundFilm(s.sha, [s.record], keepAllBut(401, removed), Math.ceil(take.samples.length / RATE));
    const runs: number[] = [];
    const loads: { start: number; end: number }[] = [];
    for (let i = 0; i < 6; i++) {
      const what = i === 0 ? 'the warm-up' : `run ${i}`;
      const start = loadavg()[0]!;
      const [reply] = runShow(bin, scenario(evidence, [presentWith(DOC.a, doc, true)]), what);
      const end = loadavg()[0]!;
      const row = cutRow(presented(reply, what), what);
      expect([row.removed.length, row.strips.length], `${what}: the expansion makes 200 cuts, 201 strips`).toEqual([200, 201]);
      const timing = reply!['timing'];
      const ms = isObject(timing) ? timing['cut_ms'] : undefined;
      expect(typeof ms === 'number' && Number.isFinite(ms) && ms >= 0, `${what}: deep show's reply with include: [timing] gives timing.cut_ms, the time spent placing and expanding cuts: ${show(timing ?? null)}`).toBe(true);
      if (i > 0) { runs.push(ms as number); loads.push({ start, end }); }
    }
    const { fingerprint, judgeLimit } = await benchmark();
    const machine = fingerprint();
    const result = judgeLimit({ limit: LIMIT, runs, fingerprint: machine, loads });
    const reading = `expanding 200 cuts: ${runs.map((r) => r.toFixed(2)).join(', ')} ms against ${LIMIT} ms on ${String(machine['model'])} macOS ${String(machine['macosBuild'])}: ${result.status}${result.reason ? ` (${result.reason})` : ''}`;
    console.log(`${AC[8]} ${reading}`);
    proof('ac8-budget.json', { runs, loads, machine, result });
    expect(result.status, reading).not.toBe('BLOCKED');
    expect(result.status, reading).not.toBe('FAIL');
    if (result.status === 'INCONCLUSIVE') inconclusive(reading);
  }, TIMEOUT);
});
