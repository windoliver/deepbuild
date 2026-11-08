// #464.43c8684e: "Print wear: `flicker: ±5%` keeps each frame's mean linear luminance within [0.95, 1.05] of the unworn
// frame's and passes the flicker check; a planted flicker seeded from wall time fails, naming the frame"
//
// A flat grey 320 × 180 frame (#767676) under `print_wear: {flicker: "5%", rate: 24}`, played 48 frames at 24 fps with
// every frame's `linear` target: each frame's mean Rec. 709 luminance over the unworn frame's lies in [0.95, 1.05], and
// the flicker shows (some frame off the unworn mean by more than 0.5%). `film2d` with `flicker: true` runs the flicker
// check (canvas primitives: Flicker check, film.flicker) over the frames it played and answers `flicker: {verdict}`,
// PASS. Every value is drawn from hash(the frame index at its rate, the document seed), so a second play in the same
// process and frames 7, 23 and 41 opened cold have the first play's pixel hashes; a failure names the frame. Planted:
// `flicker_wall_time`, the flicker's gain seeded from the wall clock.
import { describe, expect, it } from 'vitest';
import {
  AC, type Planted, failsNaming, film2d, flat, frameAt, framesOf, look2d, lumaAt, none, obj, readLinear, requireGpu, runGpu, shown, useBins, useOut,
} from './helpers.ts';

const bins = useBins(['deep-gpu']);
const out = useOut();
const SIZE: [number, number] = [320, 180];
const DOC = flat('grey-wear-464', SIZE, 'grey');
const WORN = look2d('wear-464', { grey: '#767676' }, { finish: [{ print_wear: { flicker: '5%', rate: 24 } }] });
const UNWORN = look2d('wear-none-464', { grey: '#767676' }, { finish: [] });
const FRAMES = [...Array(48).keys()];
const SEEKS = [7, 23, 41];

function worn(planted?: Planted): { problems: string[]; means: number[]; flicker: string } {
  requireGpu();
  const replies = runGpu(bins.bin('deep-gpu'), out(), [
    film2d(DOC, UNWORN, { frames: 1, capture: [0], targets: ['linear'] }),
    film2d(DOC, WORN, { fps: 24, frames: 48, capture: FRAMES, targets: ['linear'], flicker: true }),
    film2d(DOC, WORN, { fps: 24, frames: 48 }),
    ...SEEKS.map((from) => film2d(DOC, WORN, { fps: 24, from, frames: 1 })),
  ], planted);
  const mean = (r: (typeof replies)[number], n: number, what: string): number => {
    const im = readLinear(out(), frameAt(r, n, what), SIZE, what); let s = 0;
    for (let y = 0; y < im.height; y++) for (let x = 0; x < im.width; x++) s += lumaAt(im, x, y);
    return s / (im.width * im.height);
  };
  const unworn = mean(replies[0]!, 0, 'unworn');
  const means = FRAMES.map((n) => mean(replies[1]!, n, `worn frame ${n}`) / unworn);
  const first = framesOf(replies[1]!, 'the first play'); const second = framesOf(replies[2]!, 'the second play');
  const problems: string[] = [];
  means.forEach((m, n) => { if (m < 0.95 || m > 1.05) problems.push(`frame ${n}'s mean linear luminance is ${m.toFixed(4)} of the unworn frame's, outside [0.95, 1.05]`); });
  FRAMES.forEach((n) => { if (second[n]?.pixel_hash !== first[n]!.pixel_hash) problems.push(`frame ${n} played a second time differs from the first play`); });
  SEEKS.forEach((n, k) => { if (frameAt(replies[3 + k]!, n, `frame ${n} seeked`).pixel_hash !== first[n]!.pixel_hash) problems.push(`frame ${n} opened cold differs from frame ${n} played`); });
  const f = obj(replies[1]!['flicker'], `the flicker check's answer: ${shown(replies[1])}`);
  return { problems, means, flicker: String(f['verdict']) };
}

describe(`${AC[13]} print wear's flicker: within ±5% of linear luminance, through the flicker check, from the frame index`, () => {
  it(`${AC[13]} flicker ±5% keeps each frame's mean linear luminance within [0.95, 1.05] of the unworn frame's and passes the flicker check`, () => {
    const { problems, means, flicker } = worn();
    none(problems, `${AC[13]} the worn print`);
    expect(Math.max(...means.map((m) => Math.abs(m - 1))), `the flicker shows: some frame's mean is more than 0.5% off the unworn frame's (${means.map((m) => m.toFixed(4)).join(', ')})`).toBeGreaterThan(0.005);
    expect(flicker, 'the flicker check passes the worn frames').toBe('PASS');
  });
  it(`${AC[13]} a planted flicker seeded from wall time fails, naming the frame`, () => {
    failsNaming(worn('flicker_wall_time').problems, [/frame \d+/], `${AC[13]} the planted flicker_wall_time`);
  });
});
