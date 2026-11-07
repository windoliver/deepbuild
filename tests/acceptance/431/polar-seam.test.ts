// AC5 #431.b452b8cc: sample_grad keeps a polar mapping's filtering across its seam: a ring between radii 200 and 250 px
// in a 512 × 512 view, unlit with tone map none, mapped from a 256 × 32 checker of 8-texel black and white squares by
// u = atan2(y, x) ÷ 2π + 0.5 and v by radius, so the texture is magnified everywhere, matches a CPU reference of the
// same lookup within 2 code values at every pixel along the seam, on the ring's −x side, when sample_grad takes the
// gradients of the continuous angle; a planted sample with implicit derivatives reads a level of 8 × 1 texels or
// coarser there, a gray near 188, and fails, naming the pixel.
//
// The fixture (helpers: `ringDoc`, `ringOperator`, `RING`): an unlit plane filling a 512 × 512 orthographic view, its
// material operator computing x and y from `pixel@1` about the pixel corner (256, 257), u = atan2(y, x) ÷ 2π + 0.5 and
// v = (r − 200) ÷ 50, then `sample_grad@1` of the checker (a PNG by hash, `view3d`'s `assets`) with the analytic
// gradients of the continuous angle, black outside the ring. The seam on the −x side then cuts through the 2 × 2 quads
// of rows 256 and 257, where an implicit derivative of u jumps by about 1. The CPU reference is the same lookup in f64:
// level 0, bilinear (helpers: `ringReference`); at most 0.64 texels a pixel, so level 0 is the one a magnified lookup
// reads. "Code values" are 8-bit steps of linear light, read on the linear target: tone map none makes the final
// target its sRGB encoding, whose steps near black are finer than a filter's 8-bit weights (README: Readings). The
// judged pixels are rows 255 to 258 from radius 201 to 249 px on the −x side (helpers: `seamPixels`).
// Wrong program (planted `sample_grad_implicit`): sample_grad takes the implicit derivatives of uv and ignores the
// gradients given, so the seam's quads read a level of 8 × 1 texels or coarser, where every texel is mid gray: 0.5
// linear, 188 in the final PNG. The check fails naming the pixel.
import { describe, expect, it } from 'vitest';
import {
  AC, RING, checkerRgba, frameAt, pngAt, readF32Image, readPng, requireGpu, ringDoc, ringReference, run1, seamPixels, useBin, useOut, view3dCall,
  writeJson, writePngAsset, type Planted,
} from './helpers.ts';

const bin = useBin();
const out = useOut();

interface Off { x: number; y: number; text: string; final: [number, number, number] }
function seamProblems(planted?: Planted): Off[] {
  const dir = out();
  const tex = writePngAsset(dir, RING.tex[0], RING.tex[1], checkerRgba());
  const reply = run1(bin(), dir, view3dCall({
    doc: writeJson(dir, 'ring.json', ringDoc('ring-431', tex.sha)), size: RING.size, targets: ['final', 'linear'], assets: { [tex.sha]: tex.path },
  }), planted);
  const f = frameAt(reply, 0, 'the ring');
  const linear = readF32Image(dir, f.linear, RING.size, 'the ring\'s linear target');
  const final = readPng(dir, f.final, 'the ring\'s final target');
  const seam = seamPixels();
  const refs = seam.map(([x, y]) => ringReference(x, y));
  expect(refs.some((r) => r < 0.01) && refs.some((r) => r > 0.99), 'the seam crosses black and white squares, so the reference judges something').toBe(true);
  const off: Off[] = [];
  seam.forEach(([x, y], k) => {
    const got = linear.at(x, y); const ref = refs[k]!;
    const worst = Math.max(...[0, 1, 2].map((c) => Math.abs(got[c]! - ref) * 255));
    if (worst > 2) {
      off.push({
        x, y, final: pngAt(final, x, y),
        text: `pixel (${x}, ${y}) reads (${got.slice(0, 3).map((v) => v.toFixed(3)).join(', ')}) linear, final ${pngAt(final, x, y).join('/')}, against the reference ${ref.toFixed(3)} (${worst.toFixed(1)} codes off)`,
      });
    }
  });
  console.log(`${AC[5]}${planted ? ` (${planted})` : ''}: ${seam.length} seam pixels, ${off.length} off${off.length ? `; first: ${off[0]!.text}` : ''}`);
  return off;
}

describe(`${AC[5]} sample_grad keeps a polar mapping's filtering across its seam`, () => {
  it(`${AC[5]} every pixel along the ring's −x seam matches the CPU reference of the lookup within 2 code values`, () => {
    requireGpu();
    expect(seamProblems().map((o) => o.text)).toEqual([]);
  }, 1_800_000);
  it(`${AC[5]} a planted sample with implicit derivatives (--planted sample_grad_implicit) reads a gray near 188 on the seam and fails, naming the pixel`, () => {
    requireGpu();
    const off = seamProblems('sample_grad_implicit');
    const gray = off.filter((o) => (o.y === RING.cy - 1 || o.y === RING.cy) && o.final.every((c) => Math.abs(c - 188) <= 4));
    expect(gray.length, `the check names a pixel on the seam's quads that reads a gray near 188: ${off.slice(0, 5).map((o) => o.text).join('; ')}`).toBeGreaterThan(0);
  }, 1_800_000);
});
