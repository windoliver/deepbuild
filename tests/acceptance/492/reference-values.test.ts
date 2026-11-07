// AC4 #492.f704c8e6: On a fixture, OKLab color keys, shortest-angle rotation, two keys on one flick, a time remap and a
// stagger evaluate to their reference values at random times, and seeking equals playing.
//
// Through `deep-motion eval`, one document holding all five. Upstream (oracle page): linebender/color's interpolation tests
// are used as a formula, an OKLab midpoint being the per-component mix of L, a and b; Godot's test_math_funcs.cpp lerp_angle
// cases are ported as the `angle` channels `turn-*`, read at their progress: (0.24, 0.75, 0.5) → −0.005, (0.26, 0.75, 0.5) →
// 0.505, (0.72, 1.44, 0.96) → 0.4512 turns, and (−4, 4, 0.5) → −4. Its two cases that fall exactly on half a turn are a tie
// the design doesn't settle, and its extrapolating 1.04 reads past a key, so both stay out. Reference forms: the color mixes
// per component, the two keys on one flick jump right-continuously, the hold_at remap holds child 1 s for 0.5 s, and a
// stagger of lag 0.5 starts target i at i × 0.5 × d, for a total of 2 s (Placement).
import { describe, expect, it } from 'vitest';
import {
  AC, TIMEOUT, RULER, channel, clipOf, evalOk, film, fl, isObject, none, place, posOr, rect, rotOr, secs, seekPlayFailures, seededTimes, useMotion,
  type Frame, type JsonObject, type KeyList,
} from './helpers.ts';

const motion = useMotion();

const TINT: [number[], number[]] = [[0.5, 0.0625, -0.125], [0.75, 0.125, -0.0625]];
const SPAN = 3;
const GODOT: { id: string; from: number; to: number; u: number; want: number }[] = [
  { id: 'turn-1', from: 0.24, to: 0.75, u: 0.5, want: -0.005 },
  { id: 'turn-2', from: 0.26, to: 0.75, u: 0.5, want: 0.505 },
  { id: 'turn-3', from: 0.72, to: 1.44, u: 0.96, want: 0.4512 },
  { id: 'turn-4', from: -4, to: 4, u: 0.5, want: -4 },
];
const angleKeys = (from: number, to: number): KeyList => [[0, from * 360], [1, to * 360]];
const ITEMS = [rect('box', [0, 0]), rect('wheel', [0, 0]), rect('ruled', [0, 0]), rect('s0', [-1, 0]), rect('s1', [-1, 0]), rect('s2', [-1, 0]), ...GODOT.map((g) => rect(g.id, [0, 0]))];
const DOC: JsonObject = film('reference-values', ITEMS, {
  channels: {
    tint: channel('items/box/adjust/tint', [[0, TINT[0]], [SPAN, TINT[1]]], 'color', { space: 'oklab' }),
    wheel: channel('items/wheel/at/rot/2', [[0, 350], [2, 10]], 'angle', { space: 'shortest' }),
    jump: { target: 'items/box/at/pos/1', type: 'f32', keys: { a: { t: '0s', value: 0, interp: 'linear' }, b: { t: '1s', value: 4, interp: 'linear' }, c: { t: '1s', value: 9, interp: 'linear' }, d: { t: '2s', value: 1, interp: 'linear' } } },
    ...Object.fromEntries(GODOT.map((g) => [g.id, channel(`items/${g.id}/at/rot/2`, angleKeys(g.from, g.to), 'angle', { space: 'shortest' })])),
  },
  clips: { ruler: RULER, rise: clipOf('x', 'at/pos/0', [[0, 0], [1, 8]]) },
  placements: {
    ruled: place('ruler', 'ruled', { start: '0s' }),
    fan: place('rise', ['s0', 's1', 's2'], { start: '0.25s', stagger: { lag: 0.5, order: 'index' } }),
  },
  time_remaps: { hold: { target: 'ruled', map: { hold_at: { at: '1s', for: '0.5s' } } } },
}, { span: `${SPAN}s` });

const TIMES = seededTimes(492_41, 300, 0, fl(SPAN));

/** Two angles in degrees, equal on the circle. */
const onCircle = (a: number, b: number): number => { const d = (((a - b) % 360) + 540) % 360 - 180; return Math.abs(d); };
const wheelAt = (s: number): number => (s < 2 ? 350 + 10 * s : 10);
const jumpAt = (s: number): number => (s < 1 ? 4 * s : s < 2 ? 9 + (1 - 9) * (s - 1) : 1);
const ruledAt = (s: number): number => (s < 1 ? s : s < 1.5 ? 1 : s - 0.5);
function fanAt(s: number, i: number): number {
  const local = s - 0.25 - i * 0.5;
  return local >= 0 && local < 1 ? 8 * local : -1;
}
function tintOf(f: Frame): number[] {
  const box = f.items['box']; const adjust = isObject(box) ? box['adjust'] : undefined;
  const tint = isObject(adjust) ? adjust['tint'] : undefined;
  return Array.isArray(tint) ? tint.map((v) => (typeof v === 'number' ? v : NaN)) : [NaN, NaN, NaN];
}

describe(`${AC[4]} the five kinds of value on one fixture`, () => {
  it(`${AC[4]} OKLab color keys, shortest-angle rotation, two keys on one flick, a time remap and a stagger read their reference values at 300 random times`, () => {
    const a = evalOk(motion.bin(), { doc: DOC, times: TIMES }, 'the fixture');
    const failures: string[] = [];
    for (const f of a.frames) {
      const s = secs(f.t); const u = s / SPAN;
      tintOf(f).forEach((got, k) => {
        const want = TINT[0][k]! + (TINT[1][k]! - TINT[0][k]!) * u;
        if (!(Math.abs(got - want) <= 1e-9)) failures.push(`tint[${k}] at ${f.t} flicks reads ${got}, not ${want}`);
      });
      if (!(onCircle(rotOr(f, 'wheel', 2), wheelAt(s)) <= 1e-9)) failures.push(`the wheel at ${f.t} flicks reads ${rotOr(f, 'wheel', 2)}°, not ${wheelAt(s)}° the short way round`);
      if (!(Math.abs(posOr(f, 'box', 1) - jumpAt(s)) <= 1e-9)) failures.push(`the jump channel at ${f.t} flicks reads ${posOr(f, 'box', 1)}, not ${jumpAt(s)}`);
      if (!(Math.abs(posOr(f, 'ruled', 0) - ruledAt(s)) <= 1e-8)) failures.push(`the remapped placement at ${f.t} flicks reads ${posOr(f, 'ruled', 0)}, not ${ruledAt(s)}`);
      for (const i of [0, 1, 2]) {
        const got = posOr(f, `s${i}`, 0);
        if (!(Math.abs(got - fanAt(s, i)) <= 1e-9)) failures.push(`stagger target ${i} at ${f.t} flicks reads ${got}, not ${fanAt(s, i)}`);
      }
    }
    none(failures, 'the fixture against its reference values');
    // The flick itself, with its neighbour: two keys on one flick, right-continuous.
    const edge = evalOk(motion.bin(), { doc: DOC, times: [fl(1) - 1, fl(1)] }, 'the jump');
    expect(Math.abs(posOr(edge.frames[0]!, 'box', 1) - 4), 'one flick before the jump').toBeLessThanOrEqual(1e-6);
    expect(posOr(edge.frames[1]!, 'box', 1), 'on the flick, the later key').toBe(9);
    // Godot's lerp_angle cases, each at its own progress.
    const godot = GODOT.map((g) => { const f = evalOk(motion.bin(), { doc: DOC, times: [fl(g.u)] }, g.id).frames[0]!; return { g, got: rotOr(f, g.id, 2) }; });
    none(godot.filter(({ g, got }) => !(onCircle(got, g.want * 360) <= 1e-9)).map(({ g, got }) => `lerp_angle(${g.from}, ${g.to}, ${g.u}) reads ${got / 360} turns, not ${g.want}`), 'Godot\'s lerp_angle cases');
  }, TIMEOUT);

  it(`${AC[4]} seeking equals playing, bit for bit, at the same random times`, () => {
    none(seekPlayFailures(motion.bin(), { doc: DOC, times: TIMES.slice(0, 80) }, 'the fixture'), 'seek against play');
  }, TIMEOUT);
});
