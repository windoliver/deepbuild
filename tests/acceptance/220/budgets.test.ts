// AC4 #220.e4f3b85e: "Budgets, on the reference Mac in the local preflight: a 40-glyph formula typesets in under 50 ms
// warm and 1 s cold, and its SVG is under 64 KB"
//
// The formula: the 20 letters a to t joined by 19 plus signs, one letter squared: 40 glyphs, as the probe must count
// them. Its SVG: deep_job's output for it, under 65,536 bytes. The times (README: The surface under test, 5): the tool's
// own process, `node <run.dir>/<run.entry>` from the plug-in's own registration, fed one request a line. Cold is from
// starting a fresh process to its first answer, its load included; warm is from writing a second request (another
// 40-glyph formula, the square on another letter, so no answer can be a cached one) to its answer, in the same process.
// One untimed process first, then five timed ones; each answer must be a 40-glyph SVG. The perf lane's judgeLimit
// (scripts/benchmark.mjs) judges the five warm times against 50 ms and the five cold ones against 1,000 ms: FAIL fails,
// and anything but PASS (off a reference Mac, on battery, loaded) is INCONCLUSIVE, never a pass.
import { describe, expect, it } from 'vitest';
import {
  AC, TIMEOUT, ToolProcess, answerOutputs, inconclusive, judgeLimit, load, mustHavePlugin, mustTypeset, openWorld, paramsOf, proof, request,
  toolFiles, useBuilds, type Line,
} from './helpers.ts';

const built = useBuilds({ show: false });
const LETTERS = 'abcdefghijklmnopqrst'.split('');
/** A 40-glyph formula: 20 letters and 19 plus signs, the k-th letter squared (its 2 the 40th glyph). */
const formula = (k: number): string => LETTERS.map((l, i) => (i === k ? `${l}^2` : l)).join(' + ');
const RUNS = 5;

describe(`${AC[4]} a 40-glyph formula typesets in under 50 ms warm and 1 s cold, and its SVG is under 64 KB`, () => {
  it(`${AC[4]} the 40-glyph formula's SVG, through deep_job, is under 64 KB`, async () => {
    mustHavePlugin();
    built.hub();
    const w = await openWorld();
    const t = await mustTypeset(w, paramsOf([formula(0)]), `the 40-glyph formula ${formula(0)}`);
    proof('ac4-40-glyphs.svg', t.svg);
    expect(t.probe['glyphs'], `the probe counts the formula's 40 glyphs: ${JSON.stringify(t.probe).slice(0, 600)}`).toBe(40);
    expect(t.svg.length, 'its SVG is under 64 KB (65,536 bytes)').toBeLessThan(65_536);
  }, TIMEOUT);

  it(`${AC[4]} the 40-glyph formula typesets in under 50 ms warm and 1 s cold, judged by the perf lane on the reference Mac`, async () => {
    mustHavePlugin();
    const files = await toolFiles();
    const answered = (answer: Line, k: number, what: string): void => {
      const out = answerOutputs(answer, what);
      expect(out.svg.toString('utf8').includes('<svg'), `${what}: the answer is an SVG`).toBe(true);
      expect(out.probe['glyphs'], `${what}: the probe counts the 40 glyphs of ${formula(k)}`).toBe(40);
    };
    /** One fresh process: its first typeset (cold, from its start) and a later one (warm, from its request). */
    const one = async (k: number): Promise<{ cold: number; warm: number; load: { start: number; end: number } }> => {
      const start = load();
      const p = ToolProcess.start(files);
      p.send(request(paramsOf([formula(0)])));
      const first = await p.answer(0, 'the cold typeset');
      const sent = p.send(request(paramsOf([formula(k)])));
      const second = await p.answer(1, 'the warm typeset');
      const end = load();
      answered(first.answer, 0, 'the cold typeset');
      answered(second.answer, k, 'the warm typeset');
      expect(await p.end(), 'the tool exits 0 at the end of its input').toBe(0);
      return { cold: first.at - p.started, warm: second.at - sent, load: { start, end } };
    };
    await one(1);
    const runs: { cold: number; warm: number; load: { start: number; end: number } }[] = [];
    for (let k = 1; k <= RUNS; k++) runs.push(await one(k));
    const loads = runs.map((r) => r.load);
    const warm = runs.map((r) => r.warm);
    const cold = runs.map((r) => r.cold);
    proof('ac4-times.json', { warm, cold, loads });
    console.log(`#220 a 40-glyph formula: warm ms ${warm.map((x) => x.toFixed(2)).join(', ')}; cold ms ${cold.map((x) => x.toFixed(1)).join(', ')}`);
    if (process.platform !== 'darwin') inconclusive(`the budgets are judged on the reference Mac; this is ${process.platform}`);
    const verdicts = { warm: await judgeLimit(50, warm, loads), cold: await judgeLimit(1000, cold, loads) };
    expect(verdicts.warm['status'], `warm against 50 ms: ${JSON.stringify(verdicts.warm)}`).not.toBe('FAIL');
    expect(verdicts.cold['status'], `cold against 1 s: ${JSON.stringify(verdicts.cold)}`).not.toBe('FAIL');
    const open = Object.entries(verdicts).filter(([, v]) => v['status'] !== 'PASS').map(([name, v]) => `${name}: ${JSON.stringify(v)}`);
    if (open.length) inconclusive(`the perf lane can't judge the times here now: ${open.join('; ')}`);
  }, TIMEOUT);
});
