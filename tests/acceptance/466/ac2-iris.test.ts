// AC2 #466.95cafa31: An iris on an item moving along a path stays centred on its anchor within 0.5 px at 1,000 random
// times.
//
// Through `deep-motion eval` (#391's JSON lines, as #493 left them). A 480 × 270 film (1 u = 1 px: the 2D camera frames
// the whole page) whose `walker`, a circle centred on its own origin, follows the polyline (60, 200) → (260, 60) →
// (420, 220) by arc length (the base's `follow_path` constraint, its fraction a data value keyed 0 → 1 over 4 s). Shots `a`
// [0, 2 s) and `b` [2 s, 4 s) both frame the page; the iris `ir`, 2 s centred on the cut, so its window is [1 s, 3 s),
// centres on `walker`, its radius keyed by a channel. At 1,000 seeded whole-flick times in the window each frame
// reports the iris it draws (`transitions.ir.iris.center`, px); the centre must lie within 0.5 px of the walker's place
// on the path at that time, computed here by arc length. The planted `iris_center_at_window_start` centres the iris
// where the walker stood at the window's first flick, and the same judge fails, naming the transition.
import { describe, it } from 'vitest';
import {
  AC, TIMEOUT, arr, camera2d, evalOk, failsNaming, film, fl, none, num, obj, rect, seededTimes, shot2d, sOf, useMotion, type JsonObject, type Planted,
} from './helpers.ts';

const motion = useMotion();
const PATH: [number, number][] = [[60, 200], [260, 60], [420, 220]];
const SPAN = 4;

/** Where the walker is at `s` seconds: the point a fraction s ÷ 4 of the path's length along it. */
function along(s: number): [number, number] {
  const lens = PATH.slice(1).map((p, i) => Math.hypot(p[0] - PATH[i]![0], p[1] - PATH[i]![1]));
  let d = (Math.min(Math.max(s / SPAN, 0), 1)) * lens.reduce((a, b) => a + b, 0);
  for (let i = 0; i < lens.length; i++) {
    if (d <= lens[i]! || i === lens.length - 1) {
      const u = d / lens[i]!; const a = PATH[i]!; const b = PATH[i + 1]!;
      return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
    }
    d -= lens[i]!;
  }
  return PATH[PATH.length - 1]!;
}

function irisFilm(): JsonObject {
  const walker: JsonObject = { id: 'walker', kind: 'circle@1', name: 'Walker', order: 'c1', params: { center: [0, 0], r: 12, paint: { fill: { role: 'accent' } } }, at: { pos: [PATH[0]![0], PATH[0]![1], 0] } };
  const keys = (list: [number, number][]): JsonObject => Object.fromEntries(list.map(([t, value], i) => [`k${i}`, { t: `${t}s`, value, interp: 'linear' }]));
  return film('iris', [camera2d([480, 270]), rect('back', [0, 0, 480, 270], 'ground'), walker], {
    data: { along: 0 },
    channels: {
      along: { target: 'data/along', type: 'f32', keys: keys([[0, 0], [SPAN, 1]]) },
      closing: { target: 'transitions/ir/iris/radius', type: 'f32', keys: keys([[1, 300], [2, 40], [3, 300]]) },
    },
    constraints: { go: { owner: 'walker', kind: 'follow_path', path: PATH, fraction: { data: 'along' } } },
    shots: { a: shot2d(0, 2, [240, 135], 480), b: shot2d(2, 4, [240, 135], 480) },
    transitions: { ir: { from: 'a', to: 'b', kind: 'iris', iris: { center: 'walker', radius: 300, hold_at: 0.5 }, span: '2s', progress: 'linear' } },
  }, { span: `${SPAN}s` });
}

/** Each sampled time where the iris's centre is more than 0.5 px from the walker, naming the transition. */
function irisFailures(planted?: Planted): string[] {
  const times = seededTimes(466, 1000, fl(1), fl(3));
  const a = evalOk(motion.bin(), { doc: irisFilm(), times, ...(planted ? { planted } : {}) }, planted ? `the iris film (planted ${planted})` : 'the iris film');
  const failures: string[] = [];
  for (const f of a.frames) {
    const what = `transition ir at ${f.t} flicks (${sOf(f.t)})`;
    const ir = obj(obj(f.raw['transitions'], `${what}: transitions`)['ir'], `${what}: transitions.ir`);
    const c = arr(obj(ir['iris'], `${what}: iris`)['center'], `${what}: iris.center`).map((v, i) => num(v, `${what}: iris.center[${i}]`));
    num(obj(ir['iris'], `${what}: iris`)['radius'], `${what}: iris.radius`);
    const want = along(f.t / 705_600_000);
    const d = Math.hypot(c[0]! - want[0], c[1]! - want[1]);
    if (!(d <= 0.5)) failures.push(`${what}: the iris is centred at (${c[0]!.toFixed(3)}, ${c[1]!.toFixed(3)}) px, ${d.toFixed(3)} px from the walker's (${want[0].toFixed(3)}, ${want[1].toFixed(3)})`);
  }
  return failures;
}

describe(`${AC[2]} an iris follows the item it centres on`, () => {
  it(`${AC[2]} at 1,000 seeded times in its window the iris is centred within 0.5 px of the walker moving along its path`, () => {
    none(irisFailures(), 'the iris centred on the walker');
  }, TIMEOUT);

  it(`${AC[2]} (planted) an iris centred where the walker stood at the window's start fails, naming the transition`, () => {
    failsNaming(irisFailures('iris_center_at_window_start'), ['transition ir'], 'the planted iris_center_at_window_start');
  }, TIMEOUT);
});
