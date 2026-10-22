import { describe, expect, it } from 'vitest';
import { channelOf, evalFrames, ms, num, sec, useBinaries, wptCubicBezier, type JsonObject } from './helpers.ts';

useBinaries('deep-motion');

interface Handles { x1: number; y1: number; x2: number; y2: number }
interface Case { id: string; why: string; h: Handles; /** y(s) never decreases, so the value must not decrease in x */ monotone: boolean }

// Handle sets the criterion names: handles at x = 0 and x = 1 (with y inside and outside [0, 1], WPT's
// cases), a linear pair, and near-vertical handles, where |dx/ds| at the ends is far below 1e-6 and the
// solver must fall back to bisection. `monotone` marks the sets whose y(s) = 3(1-s)²s·y1 + 3(1-s)s²·y2 + s³
// has a derivative ≥ 0 on [0, 1] (checked by hand for each), so their value must not decrease in x.
const CASES: Case[] = [
  { id: 'wpt-a', why: 'WPT cubic-bezier(0.5, 1, 0.5, 0)', h: { x1: 0.5, y1: 1, x2: 0.5, y2: 0 }, monotone: true },
  { id: 'wpt-b', why: 'WPT cubic-bezier(0, 1.5, 1, 1.5): handles at x = 0 and 1, y above 1', h: { x1: 0, y1: 1.5, x2: 1, y2: 1.5 }, monotone: false },
  { id: 'wpt-c', why: 'WPT cubic-bezier(0, -0.5, 1, -0.5): handles at x = 0 and 1, y below 0', h: { x1: 0, y1: -0.5, x2: 1, y2: -0.5 }, monotone: false },
  { id: 'ends', why: 'handles at x = 0 and x = 1: dx/ds = 0 at both ends', h: { x1: 0, y1: 1, x2: 1, y2: 0 }, monotone: true },
  { id: 'linear', why: 'a linear pair: the curve is y = x', h: { x1: 0.25, y1: 0.25, x2: 0.75, y2: 0.75 }, monotone: true },
  { id: 'vertical', why: 'near-vertical handles at x = 1e-9 and 1 - 1e-9', h: { x1: 1e-9, y1: 0.9, x2: 1 - 1e-9, y2: 0.1 }, monotone: true },
];

/**
 * Blender's test_fcurve_extreme_handles (tests/python/bl_animation_fcurves.py at 0a18557098): an F-curve
 * from (frame 1, 0) to (frame 10, 1) whose handles reach past the neighbouring keys, and its stored value at
 * each frame. Blender is GPL: only these expected values are restated here, as data; none of its code is.
 * Blender clamps such handles to the segment, which leaves them at x = 1 and x = 0 with flat y: this job
 * found that cubic-bezier(1, 0, 0, 1) over the segment reproduces all ten stored values to within 1.1e-7,
 * the precision of Blender's f32 evaluation. Frame k sits at k - 1 seconds here.
 */
const BLENDER = { h: { x1: 1, y1: 0, x2: 0, y2: 1 }, values: [0, 0.004713400732725859, 0.022335870191454887, 0.06331237405538559, 0.16721539199352264, 0.8327845335006714, 0.9366875886917114, 0.9776642322540283, 0.9952865839004517, 1] };
/** Blender's values come from f32 arithmetic; this is f32's resolution near 1 with room for its rounding. */
const BLENDER_TOLERANCE = 2e-7;
/** WPT's tolerance: 0.02 px on a 100 px animation ("Precision of major rendering engines' layout systems"). */
const WPT_EPSILON = 0.02;

function doc(): JsonObject {
  const items: JsonObject = {};
  const channels: JsonObject = {};
  const add = (id: string, h: Handles, end: string, to: number): void => {
    items[id] = { id, kind: 'rect@1', layer: 'main', name: id, order: 'a0', params: { box: [0, 0, 10, 10], paint: { fill: { role: 'accent' } } } };
    channels[id] = {
      target: `items/${id}/at/pos/0`, type: 'f32',
      keys: { k0: { t: '0s', value: 0, interp: { bezier: { ...h } } }, k1: { t: end, value: to, interp: 'linear' } },
    };
  };
  for (const c of CASES) add(c.id, c.h, '1s', 100);
  add('blender', BLENDER.h, '9s', 1);
  return {
    format: 1, id: 'bezier-391', profile: 'film', title: 'Bezier timing', description: 'One channel per handle set.', size: [320, 180],
    layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } }, items, channels,
  };
}

// 1001 times across the first second (every 1 ms), and the whole seconds Blender's frames sit at.
const DENSE = Array.from({ length: 1001 }, (_, k) => ms(k));
const SECONDS = Array.from({ length: 9 }, (_, k) => sec(k + 1));
const TIMES = [...DENSE, ...SECONDS];
let frames: JsonObject[] | null = null;
const run = (): JsonObject[] => (frames ??= evalFrames(doc(), TIMES));
const value = (i: number, id: string): number => num(channelOf(run()[i]!, id)['value'], `channels.${id}.value at t=${TIMES[i]}`);
const iterations = (i: number, id: string): number => num(channelOf(run()[i]!, id)['iterations'], `channels.${id}.iterations at t=${TIMES[i]}`);

describe('AC3 Bézier timing with handles at x = 0 and x = 1, a linear pair and near-vertical handles stays finite and monotonic in x with a fixed iteration count in f64', () => {
  it('AC3 every sample of every handle set is finite, and the segment ends on its keys', () => {
    const bad: string[] = [];
    for (const id of [...CASES.map((c) => c.id), 'blender']) {
      TIMES.forEach((t, i) => { const v = value(i, id); if (!Number.isFinite(v)) bad.push(`${id} at t=${t}: ${v}`); });
    }
    expect(bad, 'non-finite Bézier values').toEqual([]);
    for (const c of CASES) {
      expect(value(0, c.id), `${c.id}: at its first key the value is the key's, 0`).toBe(0);
      expect(value(1000, c.id), `${c.id}: at its last key (1 s) the value is the key's, 100`).toBe(100);
    }
  });

  it('AC3 WPT\'s cubic-bezier cases, ported: our channel matches testcommon.js\'s bisection reference within WPT\'s 0.02 at its sample times', () => {
    // css/css-easing/cubic-bezier-timing-functions-output.html samples a 1000 ms animation at these times.
    const wptTimes = [0, 10, 230, 240, 300, 700, 750, 770, 990, 1000];
    const misses: string[] = [];
    for (const c of CASES) {
      const reference = wptCubicBezier(c.h.x1, c.h.y1, c.h.x2, c.h.y2);
      for (const m of wptTimes) {
        const want = reference(m / 1000) * 100;
        const got = value(m, c.id);
        if (!(Math.abs(got - want) <= WPT_EPSILON)) misses.push(`${c.why} at ${m} ms: ${got}, the reference gives ${want}`);
      }
    }
    expect(misses, 'Bézier values outside WPT\'s epsilon').toEqual([]);
  });

  it('AC3 Blender\'s extreme handles, ported: finite, increasing, and its stored value at each frame', () => {
    const got = [value(0, 'blender'), ...SECONDS.map((_, k) => value(DENSE.length + k, 'blender'))];
    const misses = got.flatMap((v, k) => (Math.abs(v - BLENDER.values[k]!) <= BLENDER_TOLERANCE ? [] : [`frame ${k + 1}: ${v}, Blender stores ${BLENDER.values[k]}`]));
    expect(misses, 'values off Blender\'s stored ones').toEqual([]);
    for (let k = 1; k < got.length; k++) expect(got[k]! > got[k - 1]!, `frame ${k + 1} (${got[k]}) is above frame ${k} (${got[k - 1]})`).toBe(true);
  });

  it('AC3 monotonic in x: for every handle set whose y never falls, no later sample is lower than an earlier one', () => {
    const falls: string[] = [];
    for (const c of CASES.filter((c) => c.monotone)) {
      for (let i = 1; i < DENSE.length; i++) {
        if (value(i, c.id) < value(i - 1, c.id)) falls.push(`${c.why}: ${value(i - 1, c.id)} at ${i - 1} ms, then ${value(i, c.id)} at ${i} ms`);
      }
    }
    for (let i = 1; i < DENSE.length; i++) if (value(i, 'blender') < value(i - 1, 'blender')) falls.push(`blender at ${i} ms`);
    expect(falls, 'the value fell while x grew').toEqual([]);
  });

  it('AC3 a fixed iteration count: every sample inside a Bézier segment reports the same positive solver count, near-vertical handles included', () => {
    // The design's solver runs a fixed number of steps with no early exit, falling back to bisection where
    // |dx/ds| < 1e-6; a solver that stops when it converges reports fewer steps on easy samples.
    const counts = new Map<number, string>();
    for (const id of [...CASES.map((c) => c.id), 'blender']) {
      const last = id === 'blender' ? sec(9) : sec(1);
      TIMES.forEach((t, i) => {
        if (t <= 0 || t >= last) return; // inside the segment only: at a key the key's own value shows
        const n = iterations(i, id);
        if (!counts.has(n)) counts.set(n, `${id} at t=${t}`);
      });
    }
    const seen = [...counts.entries()].map(([n, where]) => `${n} (first at ${where})`);
    expect(counts.size, `one iteration count for every interior sample; seen ${seen.join(', ')}`).toBe(1);
    expect([...counts.keys()][0]! > 0, 'the count is positive').toBe(true);
    // Outside a Bézier segment nothing is solved.
    expect(iterations(1000, 'linear'), 'at the last key (a linear segment) no Bézier step runs').toBe(0);
  });
});
