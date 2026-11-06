// AC3 #446.42931fc0: An unshadowed lamp whose receivers are its room lights nothing outside that room. Blind redraft.
//
// Two rooms in plan, side by side, seen from +Z at 32 px/m under a black sky: room A x ∈ [−8, 0], room B x ∈ [0, 8], each
// 8 m square with a floor (top at z = 0), four walls 3 m tall and a table, in a yard (top at z = −0.1) that fills the rest
// of the frame. Every item shares one matte of ρ = 0.3 and the two tables share one mesh, so only the instance can tell
// the rooms apart. The lamps hang at z = 2.6, under the wall tops, so those tops face away from every lamp and read 0 in
// every program: each room's floor is ringed by dark pixels, no lit pixel can bleed across a silhouette, and every pixel
// outside room A is judged, with no margin. The walls cast nothing (`shadow: false`), so only `receivers` keeps light in.
//
// Two fixtures, the same 800 lm in all, by the design's model (I = lm ÷ 4π, the fade (1 − (d ÷ range)⁴)² clamped at 0,
// ρ I cos θ ÷ (π d²)), worked pixel by pixel on the CPU before this was committed, walls' tops at 0:
//
//                                         floor_a min   table_a min   floor_b min   table_b min   yard min
//   One lamp, 800 lm, range auto 35.7 m     0.074         0.171         0.0075        0.0081       0.0036
//   Eleven lamps, 72.7 lm each, range 36    0.093         0.316         0.0082        0.0093       0.0038
//
// `range` is left auto on the one lamp, the design's default, which reaches the whole frame. On the eleven it's set: a
// 72.7 lm lamp's auto range is 10.8 m, which leaves part of the yard outside every lamp, and a pixel no light reaches
// proves nothing. `receivers` is the collection `room_a` on the one lamp, and on the eleven the list `a_shell`, `a_furniture`
// (floor and walls; the table), so a list is a union: taking its first name alone leaves table_a dark. Eleven is past the
// eight above which culling goes by screen tile and depth slice. `room_b` is a collection no lamp names, so being in some
// collection earns nothing.
//
// Asserted, for each fixture: every pixel outside room A (at least 50,000, of which floor_b at least 50,000) under 1e-5
// on the linear target; and room A demonstrably lit, away from silhouettes: at least 50,000 pixels of floor_a and 500 of
// table_a, each at 0.03 or more, under half of either fixture's dimmest. The wrong program is the same document without
// `receivers`, whose lamps light floor_b and the yard through the walls: by the table above at least 360 times the bound
// on every such pixel, so it must fail, naming both.
import { describe, expect, it } from 'vitest';
import {
  AC, DARK_SKY, box, failsNaming, matte, none, only, ortho, point, readIds, readLinear, requireMetal, runGpu, sessionDoc, useDir, useGpu, view3dCall, within, writeJson,
  type JsonObject, type JsonValue,
} from '../helpers.ts';

const ID = AC[3];
const bin = useGpu();
const dir = useDir();
const SIZE: [number, number] = [640, 480];
const LEAK = 1e-5;
const LIT = 0.03;
const LAMP_Z = 2.6;
const POWER = 800;

function room(name: 'a' | 'b', cx: number): Record<string, JsonObject> {
  const grey = { material: 'grey' };
  return {
    [`floor_${name}`]: box([8, 8, 0.1], [cx, 0, -0.05], grey),
    [`wall_${name}_n`]: box([8, 0.2, 3], [cx, 3.9, 1.5], grey),
    [`wall_${name}_s`]: box([8, 0.2, 3], [cx, -3.9, 1.5], grey),
    [`wall_${name}_w`]: box([0.2, 8, 3], [cx - 3.9, 0, 1.5], grey),
    [`wall_${name}_e`]: box([0.2, 8, 3], [cx + 3.9, 0, 1.5], grey),
    [`table_${name}`]: box([1.4, 0.8, 0.75], [cx + 2, -2, 0.375], grey),
  };
}
const ROOM_A = room('a', -4);
const ROOM_B = room('b', 4);
const IN_ROOM_A = new Set(Object.keys(ROOM_A));
const COLLECTIONS: JsonObject = {
  room_a: { members: Object.keys(ROOM_A) },
  a_shell: { members: Object.keys(ROOM_A).filter((id) => id !== 'table_a') },
  a_furniture: { members: ['table_a'] },
  room_b: { members: Object.keys(ROOM_B) },
};
/** The lit items and how many pixels of each, away from its silhouette, must show it. */
const MUST_LIGHT: Record<string, number> = { floor_a: 50_000, table_a: 500 };

const aimed = (receivers?: JsonValue): JsonObject => (receivers === undefined ? {} : { receivers });
const oneLamp = (receivers?: JsonValue): Record<string, JsonObject> => ({ lamp: point(POWER, [-4, 0, LAMP_Z], { shadow: false, ...aimed(receivers) }) });
const elevenLamps = (receivers?: JsonValue): Record<string, JsonObject> => Object.fromEntries(Array.from({ length: 11 }, (_, i) => [
  `lamp_${String(i).padStart(2, '0')}`,
  point(POWER / 11, [-7 + 0.6 * i, ((i % 3) - 1) * 2.5, LAMP_Z], { shadow: false, range: 36, ...aimed(receivers) }),
]));

function problems(name: string, lamps: Record<string, JsonObject>): string[] {
  const out = dir();
  const doc = sessionDoc(name, SIZE, {
    cam: ortho([0, 0, 0], 20), sky: DARK_SKY, grey: matte(0.3),
    yard: box([24, 18, 0.1], [0, 0, -0.15], { material: 'grey' }),
    ...ROOM_A, ...ROOM_B, ...lamps,
  }, { collections: COLLECTIONS });
  const [reply] = runGpu(bin(), out, [view3dCall({ doc: writeJson(out, name, doc), size: SIZE, targets: ['linear', 'ids'] })]);
  const f = only(reply!, name);
  const l = readLinear(out, f, SIZE, name); const ids = readIds(out, f, name);
  const dark = new Map<string, { px: number; over: number; worst: number }>();
  const lit = new Map<string, { px: number; under: number; dimmest: number }>();
  let outside = 0;
  for (let y = 0; y < SIZE[1]; y++) for (let x = 0; x < SIZE[0]; x++) {
    const id = ids.at(x, y) ?? 'nothing';
    const v = l.at(x, y);
    if (!IN_ROOM_A.has(id)) {
      outside++;
      const s = dark.get(id) ?? { px: 0, over: 0, worst: 0 };
      s.px++;
      if (!(v < LEAK)) { s.over++; s.worst = Math.max(s.worst, v); }
      dark.set(id, s);
    } else if (id in MUST_LIGHT && within(ids, x, y, id, 2)) {
      const s = lit.get(id) ?? { px: 0, under: 0, dimmest: Infinity };
      s.px++;
      if (!(v >= LIT)) { s.under++; s.dimmest = Math.min(s.dimmest, v); }
      lit.set(id, s);
    }
  }
  expect(outside, `${name}: at least 50,000 pixels lie outside room A`).toBeGreaterThanOrEqual(50_000);
  expect(dark.get('floor_b')?.px ?? 0, `${name}: at least 50,000 pixels show floor_b`).toBeGreaterThanOrEqual(50_000);
  const found: string[] = [];
  for (const [id, s] of dark) if (s.over > 0) found.push(`${id}: ${s.over} of ${s.px} pixels read ${LEAK} or more, the worst ${s.worst}`);
  for (const [id, least] of Object.entries(MUST_LIGHT)) {
    const s = lit.get(id);
    if (s === undefined || s.px < least) found.push(`${id}: ${s?.px ?? 0} pixels show it, want at least ${least}`);
    else if (s.under > 0) found.push(`${id}: ${s.under} of ${s.px} pixels read under ${LIT}, the dimmest ${s.dimmest}`);
  }
  return found;
}

describe(`${ID} a lamp's receivers keep its light in its room`, () => {
  it(`${ID} one lamp and eleven, receivers a collection and a list: nothing outside room A reads 1e-5 and room A is lit; without receivers fails naming floor_b`, () => {
    requireMetal();
    none(problems('one-lamp', oneLamp('room_a')), 'one lamp whose receivers are room A');
    none(problems('eleven-lamps', elevenLamps(['a_shell', 'a_furniture'])), 'eleven lamps whose receivers are room A\'s two collections');
    failsNaming(problems('one-lamp-everywhere', oneLamp()), ['floor_b', 'yard'], 'one lamp without receivers');
    failsNaming(problems('eleven-lamps-everywhere', elevenLamps()), ['floor_b', 'yard'], 'eleven lamps without receivers');
  }, 1_800_000);
});
