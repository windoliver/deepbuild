// AC8 #466.5255a50c: A 2.9 s dip to ink with hold 0.5 s and in_out_quad progress lays ink at weight 0.5 over the
// outgoing side at 0.6 s, draws every pixel exactly the ink role's color from 1.2 s to 1.7 s, and shows only the
// incoming side under ink after 1.7 s; a planted dip that cross-fades the two sides under ink at half weight draws
// pixels that aren't ink at 1.45 s and fails, naming the frame.
//
// A 320 × 180 film at 60 fps, 6 s, under the clean look: shot `a` [0, 3 s) frames a world of accent with a ground
// stripe, shot `b` [3 s, 6 s) one of muted with another stripe, joined by the dip `dip` (`dip: {color: "ink", hold:
// "0.5s"}`, span 2.9 s, centred on the cut, so its window is [1.55 s, 4.45 s); the criterion's times are into the dip).
// The dip holds ink for 0.5 s at the window's middle, [1.2 s, 1.7 s), and fades over the 1.2 s before and after with
// in_out_quad (Scope). Through `deep-show run` (`full`), #387's `eval` with `pixels` of the dip film, each side alone
// (the film with only that shot, over the whole span) and an ink control (a frame-filling rect in the ink role), at
// 0.6 s, every frame from 1.2 s to 1.7 s, and 1.8, 2.05, 2.3, 2.6 and 2.85 s into the dip:
//   - at 0.6 s every pixel is ½ the outgoing side + ½ ink, within one code value;
//   - from 1.2 s to 1.7 s every pixel is exactly the ink control's one color;
//   - after 1.7 s every pixel is (1 − w) × the incoming side + w × ink, w = 1 − in_out_quad((u − 1.7) ÷ 1.2), within one
//     code value: only the incoming side under ink.
// The planted `dip_cross_fades_under_ink` draws ½ ink + ½ the cross-fade of the two sides at every time in the window;
// the same judge fails, naming frame 180 (1.45 s into the dip, 3 s).
import { describe, expect, it } from 'vitest';
import {
  AC, FULL, TIMEOUT, camera2d, draw, failsNaming, film, flat, lookFrom, mixRgb, none, offBy, pixel, rect, rgbText, sameRgb, shot2d, useEvidence,
  useShow, withLook, type Image, type JsonObject, type Planted, type Rgb,
} from './helpers.ts';

const shows = useShow([FULL]);
const evidence = useEvidence();
const W0 = 1.55;
const inOutQuad = (x: number): number => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
/** The criterion's times into the dip, and their frames of the film at 60 fps. */
const LOCAL = [0.6, ...Array.from({ length: 31 }, (_, i) => 1.2 + i / 60), 1.8, 2.05, 2.3, 2.6, 2.85];
const frameOf = (u: number): number => Math.round((W0 + u) * 60);

type Variant = 'dip' | 'outgoing' | 'incoming' | 'ink';
function dipFilm(v: Variant): JsonObject {
  const worlds = [
    rect('world-a', [0, 0, 320, 180], 'accent'), rect('stripe-a', [40, 60, 80, 60], 'ground'),
    rect('world-b', [2000, 0, 320, 180], 'muted'), rect('stripe-b', [2180, 30, 60, 120], 'ground'),
  ];
  const a = (s: number, e: number): JsonObject => shot2d(s, e, [160, 90], 320);
  const b = (s: number, e: number): JsonObject => shot2d(s, e, [2160, 90], 320);
  const extra: JsonObject = v === 'dip'
    ? { shots: { a: a(0, 3), b: b(3, 6) }, transitions: { dip: { from: 'a', to: 'b', kind: 'dip', dip: { color: 'ink', hold: '0.5s' }, span: '2.9s', progress: 'in_out_quad' } } }
    : { shots: v === 'incoming' ? { b: b(0, 6) } : { a: a(0, 6) } };
  const items = v === 'ink' ? [camera2d([320, 180]), rect('all-ink', [0, 0, 320, 180], 'ink')] : [camera2d([320, 180]), ...worlds];
  const doc = film(`dip-${v}`, items, extra, { span: '6s', frame_rate: '60/1' }, [320, 180]);
  return withLook(evidence(), doc, { 'dip-clean': lookFrom('dip-clean') }, 'dip-clean');
}

/** Every pixel against what its time wants; each failure names its frame. */
function dipFailures(planted?: Planted): string[] {
  const times = LOCAL.map((u) => frameOf(u) * (705_600_000 / 60));
  const [mixed, out, inc, ink] = draw(shows.bin(FULL), evidence(), [dipFilm('dip'), dipFilm('outgoing'), dipFilm('incoming'), dipFilm('ink')], times, planted) as [Image[], Image[], Image[], Image[]];
  const inkColor = flat(ink[0]!);
  expect(inkColor, 'the ink control draws one color').not.toBeNull();
  const I = inkColor as Rgb;
  expect(sameRgb(pixel(out[0]!, 10, 10), pixel(inc[0]!, 10, 10)) || sameRgb(pixel(out[0]!, 10, 10), I), `the two sides and ink differ (${pixel(out[0]!, 10, 10)}, ${pixel(inc[0]!, 10, 10)}, ${I})`).toBe(false);
  const failures: string[] = [];
  LOCAL.forEach((u, k) => {
    const at = `frame ${frameOf(u)} (${Number(u.toFixed(4))} s into the dip)`;
    const img = mixed[k]!;
    let wrong = 0; let worst = 0; let first = '';
    for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
      const g = pixel(img, x, y);
      let want: number[]; let tol: number;
      if (u < 1.2 - 1e-9) { want = mixRgb(pixel(out[k]!, x, y), I, inOutQuad(u / 1.2)); tol = 1; }
      else if (u <= 1.7 + 1e-9) { want = I; tol = 0; }
      else { want = mixRgb(pixel(inc[k]!, x, y), I, 1 - inOutQuad((u - 1.7) / 1.2)); tol = 1; }
      const d = offBy(g, want);
      if (d > tol) { wrong++; if (d > worst) { worst = d; first = `(${x}, ${y}) is ${rgbText(g)}, not ${rgbText(want)}`; } }
    }
    if (wrong) failures.push(`${at}: ${wrong} pixels off by more than ${u >= 1.2 - 1e-9 && u <= 1.7 + 1e-9 ? 'nothing (exactly ink)' : 'one code value'}, the worst ${first}`);
  });
  return failures;
}

describe(`${AC[8]} a dip to ink that holds`, () => {
  it(`${AC[8]} ink at weight 0.5 over the outgoing side at 0.6 s, exactly ink from 1.2 s to 1.7 s, and only the incoming side under ink after`, () => {
    none(dipFailures(), 'the dip to ink');
  }, TIMEOUT);

  it(`${AC[8]} (planted) a dip that cross-fades the sides under ink at half weight draws pixels that aren't ink at 1.45 s and fails, naming the frame`, () => {
    failsNaming(dipFailures('dip_cross_fades_under_ink'), ['frame 180 ('], 'the planted dip_cross_fades_under_ink');
  }, TIMEOUT);
});
