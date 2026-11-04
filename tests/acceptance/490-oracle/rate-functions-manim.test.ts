// Criterion 9 (Oracle lane, formula): "rush_in(10) equals 2·sigmoid10(x ÷ 2) within 1e-12 at 1,001 points;
// running_start(−0.5) dips to −0.1848 ± 1e-4 near x = 0.29, and the hard-range check takes that bound from its
// interval form; exp_decay(0.1) reads 0.6321 ± 1e-4 at 0.1; and a there_and_back pulse of 0.2 on a scale of 1 over
// 1 s reads 1.2 at 0.5 s and exactly 1 at both ends …". The Oracle page links manim-ce a6d5cc02b4's
// manim/utils/rate_functions.py (MIT) as the formula source: "rush_into is 2·smooth(t/2), running_start the
// six-degree Bernstein curve with controls 0, 0, pull, pull, 1, 1, 1, exponential_decay 1 − e^(−t/half_life), and
// there_and_back, there_and_back_with_pause and wiggle the pulse shapes. Our exp_decay divides by 1 − e^(−1/τ) so it
// ends at 1; the interval bound and the exact zero ends are ours."
//
// The eases are read through `ease(<name>, x)` in deep-show run's `fn` call at their default params (sigmoid's k 10,
// running_start's pull −0.5, exp_decay's tau 0.1); the pulse through `deep-motion eval`, as tests/acceptance/489
// reads channels. The design maps manim's names (canvas primitives, Pack: math@1): smooth → sigmoid(10),
// rush_into → rush_in(10), rush_from → rush_out, double_smooth → double_sigmoid, exponential_decay → exp_decay(0.1),
// there_and_back → pulse, there_and_back_with_pause → pulse pause, wiggle → pulse wiggle.
import { describe, expect, it } from 'vitest';
import { FLICKS, TIMEOUT, channelValues, none, runFns, unitSamples, useMotion, useShowCore, valuesOf, type JsonObject } from './helpers.ts';

const show_ = useShowCore();
const motion = useMotion();

// manim/utils/rate_functions.py (and simple_functions.sigmoid), in f64. @unit_interval clamps t to [0, 1] to 0 or
// 1 outside it; @zero reads 0 outside it.
const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));
function smooth(t: number, inflection = 10): number {
  if (t < 0) return 0; if (t > 1) return 1;
  const error = sigmoid(-inflection / 2);
  return Math.min(Math.max((sigmoid(inflection * (t - 0.5)) - error) / (1 - 2 * error), 0), 1);
}
const clampUnit = (f: (t: number) => number) => (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : f(t));
const rushInto = clampUnit((t) => 2 * smooth(t / 2));
const rushFrom = clampUnit((t) => 2 * smooth(t / 2 + 0.5) - 1);
const doubleSmooth = clampUnit((t) => (t < 0.5 ? 0.5 * smooth(2 * t) : 0.5 * (1 + smooth(2 * t - 1))));
function runningStart(t: number, pull = -0.5): number {
  if (t < 0) return 0; if (t > 1) return 1;
  const t2 = t * t; const t3 = t2 * t; const t4 = t3 * t; const t5 = t4 * t; const t6 = t5 * t;
  const mt = 1 - t; const mt2 = mt * mt; const mt3 = mt2 * mt; const mt4 = mt3 * mt;
  return 15 * t2 * mt4 * pull + 20 * t3 * mt3 * pull + 15 * t4 * mt2 + 6 * t5 * mt + t6;
}
const exponentialDecay = (t: number, halfLife = 0.1): number => 1 - Math.exp(-t / halfLife);
const zero = (f: (t: number) => number) => (t: number): number => (t < 0 || t > 1 ? 0 : f(t));
const thereAndBack = zero((t) => smooth(t < 0.5 ? 2 * t : 2 * (1 - t)));
const thereAndBackWithPause = zero((t) => {
  const pauseRatio = 1 / 3; const a = 2 / (1 - pauseRatio);
  if (t < 0.5 - pauseRatio / 2) return smooth(a * t);
  if (t < 0.5 + pauseRatio / 2) return 1;
  return smooth(a - a * t);
});
const wiggle = zero((t) => thereAndBack(t) * Math.sin(2 * Math.PI * t)); // wiggles = 2: sin(wiggles·π·t)

const SAMPLES = unitSamples(1000);
const TOL = 1e-12;
function easeAt(name: string, xs: number[]): number[] {
  const v = valuesOf(runFns(show_.bin(), [{ expr: `ease(${name}, x)`, at: xs }])[0]!, xs.length);
  expect(typeof v, `ease(${name}, x): ${String(v)}`).not.toBe('string');
  return v as number[];
}
function formulaFailures(name: string, f: (t: number) => number): string[] {
  const got = easeAt(name, SAMPLES);
  return SAMPLES.flatMap((x, i) => (Math.abs(got[i]! - f(x)) <= TOL ? [] : [`ease(${name}, ${x}) reads ${got[i]}, manim's formula ${f(x)}`]));
}

describe('criterion 9 (formula): manim-ce a6d5cc02b4 rate_functions.py against our eases', () => {
  it('criterion 9: rush_in(10) equals rush_into = 2·smooth(x ÷ 2) within 1e-12 at 1,001 points', () => {
    none(formulaFailures('rush_in', rushInto), 'rush_in against manim\'s rush_into');
  }, TIMEOUT);

  it('criterion 9: sigmoid(10), rush_out and double_sigmoid equal manim\'s smooth, rush_from and double_smooth within 1e-12 at 1,001 points', () => {
    none([...formulaFailures('sigmoid', (t) => smooth(t)), ...formulaFailures('rush_out', rushFrom), ...formulaFailures('double_sigmoid', doubleSmooth)], 'the sigmoid eases against manim');
  }, TIMEOUT);

  it('criterion 9: running_start(−0.5) equals manim\'s six-degree Bernstein curve within 1e-12 at 1,001 points and dips to −0.1848 ± 1e-4 near x = 0.29; its interval form over [0, 1] reaches down to that dip and no further than 1e-4 past it', () => {
    none(formulaFailures('running_start', (t) => runningStart(t)), 'running_start against manim');
    // The formula's dip: the least of 10⁶ + 1 samples, refined by golden-section search around it.
    let at = 0; let min = Infinity;
    for (let i = 0; i <= 1_000_000; i++) { const v = runningStart(i / 1e6); if (v < min) { min = v; at = i / 1e6; } }
    let a = at - 1e-6; let b = at + 1e-6;
    for (let k = 0; k < 100; k++) { const m1 = b - (b - a) * 0.618; const m2 = a + (b - a) * 0.618; if (runningStart(m1) < runningStart(m2)) b = m2; else a = m1; }
    at = (a + b) / 2; min = Math.min(min, runningStart(at));
    expect(Math.abs(min - -0.1848), `manim's running_start dips to ${min}`).toBeLessThanOrEqual(1e-4);
    expect(Math.abs(at - 0.29), `manim's running_start dips near 0.29 (at ${at})`).toBeLessThan(0.01);
    const [got] = easeAt('running_start', [at]);
    expect(Math.abs(got! - min), `ease(running_start) at the dip ${at} reads ${got}, manim ${min}`).toBeLessThanOrEqual(TOL);
    const [r] = runFns(show_.bin(), [{ expr: 'ease(running_start, x)', over: [[0, 1]] }]);
    expect(r && 'bounds' in r && r.bounds.length === 1, `the interval form over [0, 1] answers one bound: ${JSON.stringify(r)}`).toBe(true);
    const bound = (r as { bounds: { lo: number | null; hi: number | null; estimate: boolean }[] }).bounds[0]!;
    expect(bound.estimate, 'the bound is no estimate').toBe(false);
    expect(bound.lo !== null && bound.lo <= min && bound.lo >= -0.1848 - 1e-4, `lo ${bound.lo} holds the dip ${min} and is −0.1848 ± 1e-4`).toBe(true);
    expect(bound.hi !== null && bound.hi >= 1 && bound.hi <= 1 + 1e-4, `hi ${bound.hi} holds 1, the curve's end, within 1e-4`).toBe(true);
  }, TIMEOUT);

  it('criterion 9: exp_decay(0.1) equals (1 − e^(−x/0.1)) ÷ (1 − e^(−10)) within 1e-12 at 1,001 points, and reads 0.6321 ± 1e-4 at 0.1, as manim\'s exponential_decay(0.1) does', () => {
    none(formulaFailures('exp_decay', (t) => exponentialDecay(t) / exponentialDecay(1)), 'exp_decay against manim\'s exponential_decay renormalized');
    const [v] = easeAt('exp_decay', [0.1]);
    expect(Math.abs(exponentialDecay(0.1) - 0.6321), 'manim\'s exponential_decay(0.1)').toBeLessThanOrEqual(1e-4);
    expect(Math.abs(v! - 0.6321), `exp_decay at 0.1 reads ${v}`).toBeLessThanOrEqual(1e-4);
  }, TIMEOUT);
});

describe('criterion 9 (formula): the pulse shapes are manim\'s there_and_back, there_and_back_with_pause and wiggle', () => {
  // Each item's x scale is 1, held, with one pulse of amount 0.2 at 0 s over 1 s, its ease the default sigmoid(10)
  // (manim's smooth); the doc runs 2 s. Read at 1,001 times i × 1 ms, so u = t ÷ 1 s.
  const SHAPES: [string, string, (u: number) => number][] = [
    ['grow', 'there_and_back', thereAndBack],
    ['hold', 'pause', thereAndBackWithPause],
    ['shake', 'wiggle', wiggle],
  ];
  const items = Object.fromEntries(SHAPES.map(([id]) => [id, { id, kind: 'rect@1', name: `Rect ${id}`, order: `a${id}`, params: { box: [0, 0, 20, 20], paint: { fill: { role: 'ink' } } }, at: { pos: [100, 100, 0] } }]));
  const channels = Object.fromEntries(SHAPES.map(([id, shape]) => [id, {
    target: `items/${id}/at/scale/0`, type: 'f32', keys: { k0: { t: '0s', value: 1, interp: 'hold' } },
    modifiers: [{ pulse: { at: '0s', span: '1s', amount: 0.2, shape } }],
  }]));
  const doc: JsonObject = { format: 1, id: 'pulse-490', profile: 'film', title: '#490 pulse', description: 'The #490 Oracle-lane pulse document.', size: [640, 360], transport: { span: '2s' }, items, channels } as unknown as JsonObject;
  const TIMES = Array.from({ length: 1001 }, (_, i) => i * (FLICKS / 1000));

  for (const [id, shape, f] of SHAPES) {
    it(`criterion 9: a ${shape} pulse of 0.2 on a scale of 1 over 1 s reads 1 + 0.2 × manim's ${shape === 'pause' ? 'there_and_back_with_pause' : shape} within 1e-12 at 1,001 times, and exactly 1 at both ends`, () => {
      const got = channelValues(motion.bin(), doc, TIMES, id);
      expect(typeof got, `the channel ${id}: ${String(got)}`).not.toBe('string');
      const v = got as number[];
      const failures = TIMES.flatMap((t, i) => { const want = 1 + 0.2 * f(t / FLICKS); return Math.abs(v[i]! - want) <= TOL ? [] : [`at ${t / FLICKS} s the scale reads ${v[i]}, manim's shape gives ${want}`]; });
      none(failures, `the ${shape} pulse`);
      expect(v[0], 'exactly 1 at 0 s').toBe(1);
      expect(v[1000], 'exactly 1 at 1 s').toBe(1);
      if (shape === 'there_and_back') expect(Math.abs(v[500]! - 1.2), `1.2 at 0.5 s (reads ${v[500]})`).toBeLessThanOrEqual(TOL);
    }, TIMEOUT);
  }
});
