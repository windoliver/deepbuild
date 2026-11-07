// AC3 #149.92bebcd4: A stroke at pressure 0.3 covers only the tooth's peaks: its coverage equals smoothstep(tooth − 0.7)
// within 1/255 at sampled pixels, on the same machine.
//
// The design's rule is coverage = smoothstep(tooth − (1 − pressure)); at pressure 0.3 that is the criterion's
// smoothstep(tooth − 0.7). The one-argument form reads smoothstep(0, 1, x) = t²(3 − 2t), t = clamp(x, 0, 1) (README:
// Readings). The tooth is this test's own image, through the design's `tooth.from`, so the reference knows every tooth
// value without reading the renderer: 8 × 8 px patches of 256 gray levels, in bit-reversed order so neighbours differ.
// One wide stroke crosses them, and a stroke layer's alpha, in f32, is its coverage. Patches' inner 4 × 4 pixels are
// sampled, so no filter at a patch's edge decides a pixel.
//
// Wrong programs: a linear ramp (0.3 at tooth 1, against smoothstep's 0.216); a hard threshold; the tooth read at
// (1 − tooth), or at an offset; pressure ignored; a stroke that doesn't read the tooth at all.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AC, alphaAt, encodeGrayPng, figure, layerFloats, layersCall, look, mark, none, requireMetal, runGpu, sha256, useDir, useGpu } from './helpers.ts';

const ID = AC[3];
const bin = useGpu();
const dir = useDir();
const [W, H] = [256, 128] as const;
const PATCH = 8;
const reverse8 = (v: number): number => { let r = 0; for (let i = 0; i < 8; i++) if (v & (1 << i)) r |= 1 << (7 - i); return r; };
const toothCode = (i: number, j: number): number => reverse8((j * 32 + i) & 255);
const smoothstep = (x: number): number => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };

describe(`${ID} a light stroke catches only the tooth's peaks`, () => {
  it(`${ID} at pressure 0.3 the stroke's coverage is smoothstep(tooth − 0.7) within 1/255`, () => {
    requireMetal();
    const out = dir();
    const png = encodeGrayPng(W, H, (x, y) => toothCode(Math.floor(x / PATCH), Math.floor(y / PATCH)));
    const hash = sha256(png);
    const file = join(out, 'tooth.png');
    writeFileSync(file, png);
    const lk = look({
      id: 'pressure-149',
      ground: { kind: 'paper', params: { role: 'paper', seed: 'document', tooth: { kind: 'cold_press', from: hash, scale: 1, depth: 1, seed: 1 }, anchor: 'world', zoom: 'crossfade_octaves' } },
      lines: { line: { kind: 'exact', width: 2 }, light: { kind: 'exact', width: 96, pressure: 0.3 } },
    });
    const doc = figure('pressure-149', [W, H], { swipe: mark('swipe', 'path@1', 'a0', { d: 'M -8 64 L 264 64', paint: { stroke: { role: 'ink', line: 'light' } } }) });
    const [reply] = runGpu(bin(), out, [layersCall(doc, lk, { assets: { [hash]: file } })]);
    const layer = layerFloats(out, reply!, 'main', [W, H], 'the stroke');
    const failures: string[] = [];
    let sampled = 0; let peaks = 0;
    // Rows 2 to 13 of patches lie inside the stroke, y 16 to 112.
    for (let j = 2; j < 14; j++) for (let i = 0; i < W / PATCH; i++) {
      const tooth = toothCode(i, j) / 255;
      const want = smoothstep(tooth - 0.7);
      if (want > 0.02) peaks++;
      for (let y = j * PATCH + 2; y < (j + 1) * PATCH - 2; y++) for (let x = i * PATCH + 2; x < (i + 1) * PATCH - 2; x++) {
        const got = alphaAt(layer, x, y);
        sampled++;
        if (Math.abs(got - want) > 1 / 255) failures.push(`pixel (${x}, ${y}): tooth ${tooth.toFixed(3)} wants coverage ${want.toFixed(4)}, the stroke has ${got.toFixed(4)}`);
      }
    }
    console.log(`${ID}: ${sampled} pixels sampled across ${(H / PATCH - 4) * (W / PATCH)} patches, ${peaks} of them peaks`);
    expect(peaks, 'the figure holds peaks for the stroke to catch, and valleys it must miss').toBeGreaterThan(40);
    none(failures, 'coverage off the design\'s formula');
  });
});
