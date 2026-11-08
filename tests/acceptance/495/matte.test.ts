// AC3 #495.a46e8949: A mid-grey (sRGB 0.5) luma matte covers 0.214 in linear light and 0.5 with luma: encoded, within 1/255,
// and seeking to a frame of it equals playing.
//
// Through `deep-gpu run`. Item kind `matte@1` (README: Choices 4) with params {source, mode: "luma", luma?, applies_to}: a
// white 40 x 40 rect `tgt` under a matte whose hidden source rect `msrc` (the same box) is filled mid-grey (128, 128, 128).
// The `layers` PNG is straight alpha, so the alpha of tgt's centre is its coverage: 0.214 (linear, the default, and
// `luma: "linear"`) and 0.5 (`luma: "encoded"`), each within 1/255 and each from the exact formula too. A second source,
// (200, 100, 50), tells Rec. 709 weights from others: encoded Y = 0.2126 r + 0.7152 g + 0.0722 b on encoded values, linear Y
// the same weights on linear values. The hidden source leaves no grey in the target's colour (still white at its centre).
// Then a source bar sliding over a 64 x 64 film, both modes, is drawn 30 frames in order and each frame again alone, in a
// seeded random order, with `from`: the pixel hashes must be equal, and the two modes must draw differently.
// Wrong programs: luma taken on encoded values in both modes (0.5 where 0.214 is due) or on linear in both; plain mean or
// Rec. 601 weights (the rust source); the source drawn (grey in the target); a matte that keeps last frame's coverage.
import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, filmCall, film, hashAt, item, layerImage, layersCall, linear, none, pixel, rect, runGpu, seeded, useDir, useGpu, type JsonObject } from './helpers.ts';

const gpu = useGpu();
const dir = useDir();

const lin = (c: number): number => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const W = [0.2126, 0.7152, 0.0722] as const;
const luma = (rgb: number[], f: (c: number) => number): number => W[0] * f(rgb[0]!) + W[1] * f(rgb[1]!) + W[2] * f(rgb[2]!);

function matteDoc(role: string, lumaMode: string | null): JsonObject {
  return film(`matte-${role}-${lumaMode ?? 'default'}`, [40, 40], [
    rect('tgt', 'a0', [0, 0, 40, 40], 'white'),
    rect('msrc', 'a1', [0, 0, 40, 40], role, { visible: false }),
    item('m', 'matte@1', 'a2', { source: 'msrc', mode: 'luma', ...(lumaMode ? { luma: lumaMode } : {}), applies_to: 'tgt' }),
  ]);
}
const coverage = (out: string, role: string, lumaMode: string | null): { alpha: number; r: number } => {
  const [reply] = runGpu(gpu(), out, [layersCall(matteDoc(role, lumaMode), 0)]);
  const [r, , , a] = pixel(layerImage(out, reply!, `the ${role} matte, luma ${lumaMode ?? 'unset'}`), 20, 20);
  return { alpha: a / 255, r };
};

describe(`${AC[3]} a luma matte takes luma in linear light or encoded, and seeking equals playing`, () => {
  it(`${AC[3]} a mid-grey source covers 0.214 in linear light and 0.5 encoded within 1/255; (200, 100, 50) covers by Rec. 709 weights in each space; the source stays hidden`, () => {
    const failures: string[] = [];
    const cases: [string, number[], string | null, number][] = [
      ['grey', [128, 128, 128], null, 0.214], ['grey', [128, 128, 128], 'linear', 0.214], ['grey', [128, 128, 128], 'encoded', 0.5],
      ['grey', [128, 128, 128], 'linear', luma([128, 128, 128], lin)], ['grey', [128, 128, 128], 'encoded', luma([128, 128, 128], (c) => c / 255)],
      ['rust', [200, 100, 50], 'linear', luma([200, 100, 50], lin)], ['rust', [200, 100, 50], 'encoded', luma([200, 100, 50], (c) => c / 255)],
    ];
    for (const [role, , mode, want] of cases) {
      const got = coverage(dir(), role, mode);
      if (Math.abs(got.alpha - want) > 1 / 255) failures.push(`${role}, luma ${mode ?? 'unset'}: covers ${got.alpha.toFixed(4)}, not ${want.toFixed(4)}`);
      if (got.r < 250) failures.push(`${role}, luma ${mode ?? 'unset'}: the hidden source shows through, red channel ${got.r}`);
    }
    none(failures, 'the matte coverage');
  }, TIMEOUT);

  it(`${AC[3]} 30 frames of a moving matte drawn alone in random order hash as the play does, in both modes, and the modes differ`, () => {
    const N = 30;
    const doc = (mode: string): JsonObject => film(`slide-${mode}`, [64, 64], [
      rect('tgt', 'a0', [0, 0, 64, 64], 'accent'),
      rect('msrc', 'a1', [0, 0, 24, 64], 'ink', { visible: false }),
      item('m', 'matte@1', 'a2', { source: 'msrc', mode: 'luma', luma: mode, applies_to: 'tgt' }),
    ], { channels: { sx: linear('items/msrc/at/pos/0', [[0, 0], [0.5, 40]]) } }, '1s');
    const rand = seeded(495);
    const order = Array.from({ length: N }, (_, k) => k).sort(() => rand() - 0.5);
    const failures: string[] = []; const plays: string[][] = [];
    for (const mode of ['linear', 'encoded']) {
      const replies = runGpu(gpu(), dir(), [filmCall(doc(mode), 0, N), ...order.map((k) => filmCall(doc(mode), k, 1))]);
      const played = Array.from({ length: N }, (_, k) => hashAt(replies[0]!, k, `the ${mode} play`));
      plays.push(played);
      order.forEach((k, i) => { const h = hashAt(replies[i + 1]!, k, `the ${mode} seek to ${k}`); if (h !== played[k]) failures.push(`${mode}: frame ${k} drawn alone hashes ${h}, the play's ${played[k]}`); });
      expect(new Set(played).size, `the ${mode} matte's frames differ as the source slides`).toBeGreaterThan(10);
    }
    none(failures, 'the seeks');
    expect(plays[0]!.filter((h, k) => h !== plays[1]![k]).length, 'linear and encoded mattes draw different frames').toBeGreaterThan(10);
  }, TIMEOUT);
});
