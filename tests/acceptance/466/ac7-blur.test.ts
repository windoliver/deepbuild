// AC7 #466.e1124907: With the look's quantize at 12 Hz, a 24 fps export, motion blur on at a 180° shutter and a box
// moving at 240 u/s, frames 2m and 2m + 1 are byte-identical and each shows one blur; a planted blur that quantizes
// each sample shows two half-opacity copies on even frames and fails, naming the frame.
//
// A 320 × 180 film, 1 s at 24 fps: on the white ground an ink box 12 × 40 u whose x is keyed linearly from 20 to 260 u
// over the second (240 u/s, a declared move), under the clean look with `time.quantize_hz: 12`, one sub-sample a frame
// (`samples: {live: 1, export: 1}`) and `motion_blur: {scope: "declared_moves", method: "samples", shutter_angle: 180,
// phase: "centred", samples: 8}` (#419's look field). So frame k's time quantizes to m ÷ 12 (m = ⌊k ÷ 2⌋), where the box
// stands at x = 20 + 20m, and its shutter of 1/48 s sweeps it 5 u: one blur, 5 px of ramp each side. Exported as PNG
// frames (#501's `export`, png_seq) through `deep-show run` (`full`):
//   - frames 2m and 2m + 1 are the same bytes, and their receipt hashes equal, for m = 0 to 11, while frame 2m + 2
//     differs (the box moves);
//   - on the box's middle row each of frames 2 to 21 shows one blur: in linear light, the box's coverage of each pixel
//     makes exactly one run above 2%, reaching full coverage, with 4 to 14 partly covered pixels, its centre within
//     1 px of the box's centre at m ÷ 12.
// The planted `blur_quantizes_samples` quantizes each sample's own time: on frame 2m half the samples fall to
// (m − 1) ÷ 12, so the box draws twice at half opacity, 20 u apart, and the same judge fails, naming frame 4.
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { pngFrames, receiptOf, useTemp } from '../501/helpers.ts';
import {
  AC, DOC, FRAME24, FULL, TIMEOUT, camera2d, decodePng, failsNaming, film, fl, linear, lookFrom, none, pixel, present, presented, rect, show1, sOf,
  useEvidence, useShow, withLook, type JsonObject, type Planted,
} from './helpers.ts';

const shows = useShow([FULL]);
const evidence = useEvidence();
const temp = useTemp();
const ROW = 90;
/** The clean look's ink (#1b1d22), its green code in linear light: the box's full coverage. */
const INK = linear(0x1d);

function blurFilm(): JsonObject {
  const doc = film('blur', [camera2d([320, 180]), rect('back', [0, 0, 320, 180], 'ground'), rect('box', [0, 70, 12, 40], 'ink')], {
    channels: { slide: { target: 'items/box/at/pos/0', type: 'f32', keys: { k0: { t: '0s', value: 20, interp: 'linear' }, k1: { t: '1s', value: 260, interp: 'linear' } } } },
  }, { span: '1s', frame_rate: '24/1' }, [320, 180]);
  const clean = lookFrom('blur-quantized');
  const look = {
    ...clean, time: { ...(clean['time'] as JsonObject), quantize_hz: 12 }, samples: { live: 1, export: 1, at_rest: 'none' }, vary: ['pixel'],
    motion_blur: { scope: 'declared_moves', method: 'samples', shutter_angle: 180, phase: 'centred', samples: 8, adaptive: true, exclude: [] },
  };
  return withLook(evidence(), doc, { 'blur-quantized': look }, 'blur-quantized');
}

/** What is wrong with the exported frames: each failure names its frame. */
function blurFailures(planted?: Planted): string[] {
  const out = join(temp(), 'frames');
  const replies = show1(shows.bin(FULL), evidence(), [
    present(DOC.a, blurFilm()),
    { call: 'export', doc: DOC.a, out, video: { codec: 'png_seq' }, frame_rate: [24, 1], range: [0, fl(1)] },
  ], planted);
  presented(replies[0]!, 'the blur film');
  const hashes = receiptOf(replies[1]!, 'the blur film\'s export').frame_hashes;
  const frames = pngFrames(out, 'the blur film\'s export');
  const failures: string[] = [];
  if (frames.length !== 24 || hashes.length !== 24) return [`the export wrote ${frames.length} frames and ${hashes.length} hashes, not 24`];
  for (let m = 0; m < 12; m++) {
    if (!frames[2 * m]!.equals(frames[2 * m + 1]!) || hashes[2 * m] !== hashes[2 * m + 1]) failures.push(`frames ${2 * m} and ${2 * m + 1}, one quantized time, are not the same bytes`);
    if (m < 11 && frames[2 * m]!.equals(frames[2 * m + 2]!)) failures.push(`frames ${2 * m} and ${2 * m + 2} are the same: the box doesn't move`);
  }
  for (let k = 2; k <= 21; k++) {
    const img = decodePng(frames[k]!);
    const at = `frame ${k} (${sOf(k * FRAME24)})`;
    const ground = linear(pixel(img, 300, 10)[1]);
    const darkest = Math.min(...[...Array(img.width).keys()].map((x) => linear(pixel(img, x, ROW)[1])));
    if (!(ground - darkest > 0.5)) { failures.push(`${at}: no box on row ${ROW}`); continue; }
    const cover = [...Array(img.width).keys()].map((x) => Math.min(1, Math.max(0, (ground - linear(pixel(img, x, ROW)[1])) / (ground - INK))));
    const runs: [number, number][] = [];
    cover.forEach((c, x) => { if (c > 0.02) { const last = runs[runs.length - 1]; if (last && last[1] === x - 1) last[1] = x; else runs.push([x, x]); } });
    const partial = cover.filter((c) => c > 0.02 && c < 0.98).length;
    const peak = Math.max(...cover);
    const centre = cover.reduce((s, c, x) => s + c * (x + 0.5), 0) / cover.reduce((s, c) => s + c, 0);
    const want = 20 + 20 * Math.floor(k / 2) + 6;
    if (runs.length !== 1) failures.push(`${at}: ${runs.length} separate copies of the box on row ${ROW} (${runs.map(([a, b]) => `${a}–${b}`).join(', ')}), not one blur`);
    if (peak < 0.98) failures.push(`${at}: the box covers at most ${(peak * 100).toFixed(1)}% of any pixel: it draws at partial opacity`);
    if (partial < 4 || partial > 14) failures.push(`${at}: ${partial} partly covered pixels, not one blur of a 5 u sweep (4 to 14)`);
    if (!(Math.abs(centre - want) <= 1)) failures.push(`${at}: the blur's centre is at ${centre.toFixed(2)} px, not the box's ${want} at ${Math.floor(k / 2)}/12 s`);
  }
  return failures;
}

describe(`${AC[7]} motion blur over quantized time: one blur per held drawing`, () => {
  it(`${AC[7]} frames 2m and 2m + 1 are the same bytes, and each frame shows one blur of the box at its quantized time`, () => {
    none(blurFailures(), 'the blurred, quantized export');
  }, TIMEOUT);

  it(`${AC[7]} (planted) a blur that quantizes each sample draws two half-opacity copies on even frames and fails, naming the frame`, () => {
    failsNaming(blurFailures('blur_quantizes_samples'), ['frame 4 ('], 'the planted blur_quantizes_samples');
  }, TIMEOUT);
});
