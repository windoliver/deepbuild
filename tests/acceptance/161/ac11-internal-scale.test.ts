// AC11 #161.8ed2354e: A black-to-white vertical edge under `blur@1 {radius: 8}` has the same 10%-to-90% width at
// `internal_scale` 1 and at 0.5, within 1 px at design size. A planted blur that reads 8 as device px at 0.5 gives twice
// the width and fails, naming the scale.
//
// The live view is #379's `live` call; a session's `surface: {internal_scale, upscale, sharpen}` is #386's, and
// `capture` keeps a view's final picture at the view's size, which is the design size. The figure is 2D, 256 × 96 px:
// a group whose children are a black rectangle and a white one meeting at x = 128, 64 px high, its one pass
// `blur@1 {radius: 8}` (no `grow`: the shipped blur reaches its radius). Three sessions, one call each: the figure with
// no pass at internal scale 1; the blurred figure at 1; the blurred figure at 0.5 with a bilinear upscale and no
// sharpen, so nothing but the blur shapes the edge.
//
// The width is read on the picture: on each of the 16 rows from 40 to 55 (24 px from the rectangles' top and bottom,
// past any blur's reach), the mean of r, g and b from x = 100 (black, 28 px from the edge) to x = 156 (white) crosses
// 10% and 90% of the way between those two levels at two places, found between pixels; their distance is the row's
// width, and the figure's is the median row's. The view at 0.5 must say it drew at 0.5 (`internal_scale` in its row of
// the reply); the blur must widen the edge by 3 px or more over the figure with no pass; and the widths at 1 and at 0.5
// must be within 1 px.
//
// Wrong programs: the base, which draws a 2D session at scale 1 whatever its surface says; `--planted
// blur_radius_in_device_px`, under which `blur@1` below internal scale 1 takes `radius` as px of the scaled target:
// at 0.5 the edge is twice as wide at design size, and the judge fails, naming internal_scale 0.5.
import { describe, expect, it } from 'vitest';
import {
  AC, TIMEOUT, buildLine, document, group, liveCall, liveFrames, look1, payload, pngOf, rect, refusal, requireGpu, runGpu, sessionRow, shown, useBin, useDir, writeJson,
  type Image, type JsonObject, type JsonValue, type Planted,
} from './helpers.ts';
import { edgeWidth } from './measures.ts';

const ID = AC[11];
const gpu = useBin('deep-gpu');
const dir = useDir();
const SIZE = [256, 96] as const;
const LOOK = look1('edge-161', { black: [0, 0, 0], white: [255, 255, 255] });
const BLUR: JsonValue[] = [{ op: 'blur@1', params: { radius: 8 } }];
const edgeDoc = (id: string, passes: JsonValue[]): JsonObject => document(id, SIZE, [
  group('soft', 'a1', passes), rect('dark', 'a2', [32, 16, 96, 64], 'black', 1, { parent: 'soft' }), rect('light', 'a3', [128, 16, 96, 64], 'white', 1, { parent: 'soft' }),
]);

/** The figure's width: the median of rows 40 to 55, read from x = 100 (black) to x = 156 (white). */
const width = (im: Image): number => edgeWidth(im, Array.from({ length: 16 }, (_, k) => 40 + k), 100, 156);

interface Session { name: string; scale: number; passes: JsonValue[] }
const SESSIONS: Session[] = [{ name: 'the edge with no pass at internal_scale 1', scale: 1, passes: [] }, { name: 'the blurred edge at internal_scale 1', scale: 1, passes: BLUR }, { name: 'the blurred edge at internal_scale 0.5', scale: 0.5, passes: BLUR }];
interface Read { failures: string[]; widths: number[] }
function read(planted?: Planted): Read {
  const out = dir();
  const calls = SESSIONS.map((s, i) => liveCall(LOOK, [{ session: 's', doc: writeJson(out, `edge-${i}.json`, payload(edgeDoc(`edge-${i}`, s.passes))), size: [...SIZE], surface: { internal_scale: s.scale, upscale: 'bilinear', sharpen: 0 } }], { frames: 4, capture: [0, 1, 2, 3, 4] }));
  const ran = runGpu(gpu().bin, out, calls, planted);
  if (ran.problem) return { failures: [ran.problem], widths: [] };
  const failures: string[] = []; const widths: number[] = [];
  SESSIONS.forEach((s, i) => {
    const reply = ran.replies[i];
    const refused = refusal(reply, s.name);
    if (refused) { failures.push(refused); return; }
    if (sessionRow(reply, 's')?.['state'] !== 'live') { failures.push(`${s.name}: the session isn't live: ${shown(sessionRow(reply, 's'), 400)}`); return; }
    const shot = liveFrames(reply, 's').find((f) => typeof f.view?.['final'] === 'string');
    if (!shot) { failures.push(`${s.name}: no captured frame holds the view's final picture`); return; }
    if (shot.view!['internal_scale'] !== s.scale) failures.push(`${s.name}: the view says it drew at internal_scale ${shown(shot.view!['internal_scale'])}`);
    const png = pngOf(out, shot.view!['final']);
    if (typeof png === 'string') { failures.push(`${s.name}: ${png}`); return; }
    if (png.width !== SIZE[0] || png.height !== SIZE[1]) { failures.push(`${s.name}: the picture is ${png.width} × ${png.height}, not the design size`); return; }
    widths[i] = width(png);
    if (Number.isNaN(widths[i])) failures.push(`${s.name}: no black-to-white edge on rows 40 to 55`);
  });
  if (failures.length) return { failures, widths };
  const [sharp, full, half] = widths as [number, number, number];
  console.log(`${ID}${planted ? ` (${planted})` : ''}: 10%-to-90% widths, px at design size: ${sharp.toFixed(2)} with no pass, ${full.toFixed(2)} at internal_scale 1, ${half.toFixed(2)} at internal_scale 0.5`);
  if (!(full - sharp >= 3)) failures.push(`the blur at internal_scale 1 widens the edge from ${sharp.toFixed(2)} px to ${full.toFixed(2)} px, under 3 px more: blur@1 {radius: 8} didn't run`);
  if (!(Math.abs(half - full) <= 1)) failures.push(`at internal_scale 0.5 the edge's 10%-to-90% width is ${half.toFixed(2)} px at design size, against ${full.toFixed(2)} px at internal_scale 1: more than 1 px apart`);
  return { failures, widths };
}

describe(`${ID} a param in px is px at design size at every internal scale`, () => {
  it(`${ID} a black-to-white edge under blur@1 {radius: 8} is as wide, 10% to 90%, in a live view at internal_scale 0.5 as at 1, within 1 px at design size`, () => {
    requireGpu();
    expect(gpu().error, buildLine('deep-gpu')).toBe('');
    const { failures } = read();
    expect(failures, failures.join('\n  ')).toEqual([]);
  }, TIMEOUT);

  it(`${ID} planted: a blur that reads 8 as device px at 0.5 (--planted blur_radius_in_device_px) gives twice the width and fails, naming the scale`, () => {
    requireGpu();
    expect(gpu().error, buildLine('deep-gpu')).toBe('');
    const { failures, widths } = read('blur_radius_in_device_px');
    expect(widths.length, `the planted program draws the three views: ${failures.join('; ')}`).toBe(3);
    const [, full, half] = widths as [number, number, number];
    expect(half / full, `the planted blur is about twice as wide at 0.5: ${half.toFixed(2)} px against ${full.toFixed(2)} px`).toBeGreaterThan(1.6);
    expect(half / full, `the planted blur is about twice as wide at 0.5: ${half.toFixed(2)} px against ${full.toFixed(2)} px`).toBeLessThan(2.4);
    expect(failures.length === 1 && failures[0]!.startsWith('at internal_scale 0.5 '), `the judge fails, naming the scale, and on nothing else: ${failures.join('; ')}`).toBe(true);
  }, TIMEOUT);
});
