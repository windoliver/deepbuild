// AC6 #2032.94551e97: "Over 6 s with 4 moving lights and 200 moving occluder segments, the frames at 1 s, 3 s and 5 s have
// the same pixel hash by seeking and by playing. An open path with `occlude: true` is refused at check, and a group of
// 4,097 segments is refused with `segments: 4097, cap: 4096`. A planted check that accepts either fails"
//
// This file holds the criterion's first sentence; ac6-refusals.test.ts holds the rest.
// A 320 × 180 document with a 6 s transport. Its group `lamps` holds ambient 0.2 and 4 point lights in three roles, each
// light's `at` keyed linearly over the 6 s (channels `items/lamps/params/light/lights/<k>/at/<0|1>`); `floor`, a white
// rect over the whole document; and eight closed white paths `rock-a` to `rock-h` with `occlude: true`, each of 25
// corners (200 segments in all), each moved by its position, keyed linearly over the 6 s (channels
// `items/<rock>/at/pos/<0|1>`). Frames at 30 fps: 1 s, 3 s and 5 s are frames 30, 90 and 150, each a pixel hash from
// `deep-gpu run`'s `film2d` with `from` and `hash` (Metal). A play is one process from frame 0 in order; a seek is a
// fresh process opened at that frame with nothing drawn before it (README: Readings).
//   - The measure sees shadows: each played frame hashes apart from the same frame of the same document with `occlude`
//     taken off every path, sought.
//   - The lights and the occluders move: the three played frames hash apart from one another.
//   - Each sought frame hashes as the played one does; a failure names the frame.
// Wrong programs: the base (`occlude` isn't read: the frames hash as with `occlude` off), occluders kept from the
// frame before, shadows built up frame by frame, an outline read at the path's rest position.
import { describe, expect, it } from 'vitest';
import {
  AC, blob, distinctCorners, doc, film, group, keyed, light, outline, rect, requireMetal, segments, useBin, useDir, WHITE, withoutOcclude,
  type JsonObject, type Light, type Poly,
} from './helpers.ts';

const ID = AC[6];
const gpu = useBin('deep-gpu');
const dir = useDir();
const FPS = 30;
const SEEKS = [30, 90, 150];
const SPAN = 6;
const ROLES = [WHITE, 'accent', 'focus', WHITE];
/** Light k crosses the floor over the 6 s. */
const LAMPS: { x: [number, number][]; y: [number, number][] }[] = Array.from({ length: 4 }, (_, k) => ({
  x: [[0, 30 + 80 * k], [SPAN, 290 - 80 * k]],
  y: [[0, 20 + 45 * k], [SPAN, 160 - 45 * k]],
}));
/** Rock k, an outline round its own origin, drifts from one cell of a 4 × 2 grid toward the next. */
const ROCKS: { id: string; poly: Poly; x: [number, number][]; y: [number, number][] }[] = Array.from({ length: 8 }, (_, k) => ({
  id: `rock-${String.fromCharCode(97 + k)}`,
  poly: blob(0, 0, 25, 14, 6000 + k),
  x: [[0, 40 + 80 * (k % 4)], [SPAN, 60 + 80 * ((k + 1) % 4)]],
  y: [[0, 50 + 80 * Math.floor(k / 4)], [SPAN, 110 - 60 * Math.floor(k / 4)]],
}));
const channels: JsonObject = {};
LAMPS.forEach((l, k) => {
  channels[`lamp-${k}-x`] = keyed(`items/lamps/params/light/lights/${k}/at/0`, l.x);
  channels[`lamp-${k}-y`] = keyed(`items/lamps/params/light/lights/${k}/at/1`, l.y);
});
ROCKS.forEach((r) => {
  channels[`${r.id}-x`] = keyed(`items/${r.id}/at/pos/0`, r.x);
  channels[`${r.id}-y`] = keyed(`items/${r.id}/at/pos/1`, r.y);
});
const fixture = doc('shadow-drift', [320, 180], [
  group('lamps', 'a0', { ambient: 0.2, lights: LAMPS.map((l, k) => light({ at: [l.x[0]![1], l.y[0]![1]], energy: 0.6, range: 220 } satisfies Light, ROLES[k])) }),
  rect('floor', 'a1', [0, 0, 320, 180], 'lamps'),
  ...ROCKS.map((r, k) => outline(r.id, `b${k}`, r.poly, 'lamps', { occlude: true }, { at: { pos: [r.x[0]![1], r.y[0]![1], 0] } })),
], { transport: { span: `${SPAN}s` }, channels });
const plain = withoutOcclude(fixture);

/** Frame `n`'s pixel hash by a seek: a fresh process opened at it. */
const sought = (d: JsonObject, n: number): string | undefined => film(gpu(), dir(), d, { fps: FPS, from: n, frames: 1 }).get(n)?.hash;

describe(`${ID} moving lights and occluders: seeking equals playing`, () => {
  it(`${ID} the frames at 1 s, 3 s and 5 s have the same pixel hash by seeking and by playing`, () => {
    expect([LAMPS.length, ROCKS.length, segments(ROCKS.map((r) => r.poly)), distinctCorners(ROCKS.map((r) => r.poly))], '4 moving lights and 200 moving occluder segments').toEqual([4, 8, 200, true]);
    requireMetal();
    const play = film(gpu(), dir(), fixture, { fps: FPS, from: 0, frames: SEEKS[SEEKS.length - 1]! + 1 });
    const played = SEEKS.map((n) => play.get(n)?.hash);
    const seeks = SEEKS.map((n) => sought(fixture, n));
    const unshadowed = SEEKS.map((n) => sought(plain, n));
    console.log(`${ID}: played ${SEEKS.map((n, i) => `${n}: ${String(played[i]).slice(0, 12)}`).join(', ')}; sought ${SEEKS.map((n, i) => `${n}: ${String(seeks[i]).slice(0, 12)}`).join(', ')}; with occlude off ${SEEKS.map((n, i) => `${n}: ${String(unshadowed[i]).slice(0, 12)}`).join(', ')}`);
    const failures = [
      ...SEEKS.flatMap((n, i) => (played[i] !== undefined && played[i] !== unshadowed[i] ? [] : [`frame ${n}: the occluders cast no shadow: the played frame hashes ${String(played[i]).slice(0, 16)}, as it does with occlude off`])),
      ...(new Set(played).size === SEEKS.length ? [] : [`the lights and the occluders don't move: the played frames ${SEEKS.join(', ')} hash ${played.map((h) => String(h).slice(0, 16)).join(', ')}`]),
      ...SEEKS.flatMap((n, i) => (seeks[i] !== undefined && seeks[i] === played[i] ? [] : [`frame ${n}: the seek's pixel hash ${String(seeks[i]).slice(0, 16)} isn't the play's ${String(played[i]).slice(0, 16)}`])),
    ];
    expect(failures, failures.join('\n')).toEqual([]);
  });
});
