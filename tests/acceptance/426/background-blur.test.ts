// AC3 #426.c90d2152: With `background_blur: 0.5`, the background pixels equal the prefiltered cube's roughness 0.5 mip in
// their direction within 1 code value, and every pixel an opaque product covers at every MSAA sample equals the frame at
// blur 0 byte for byte; a planted blur that also feeds the environment's lighting changes the product's pixels and fails.
//
// The HDR (helpers: STEP) is two flat levels split at the horizon: the upper half [0.75, 0.5, 0.25], the lower [0.125, 0.25, 0.5]
// (mantissas ÷ 256, exact). The camera is at the origin looking along −Z (fov 60, 480 × 360, so ±23° of elevation), a chrome-like ball
// (metallic 1, roughness 0.35, radius 0.6) at (0, 0, −3). Tone map none at exposure scale 1.
// 1. The background at blur 0.5. A prefilter of a two-level horizon depends only on the elevation δ of the direction: the lobe's
//    share above the horizon is w(δ), and the pixel is lower + (upper − lower)·w(δ). Judged against two references:
//    (a) a GGX split-sum prefilter by quadrature (helpers: upperShare; n = v = r, α = roughness², weight D(h)·(n·l)) at
//        roughness 0.5, every background pixel (ID target empty, 4 px clear of the ball) within 1 code (README: Assumed
//        surfaces 4 says what this assumes of the cube's filter);
//    (b) a reference that doesn't depend on the filter's weights: the horizon splits the lobe in two equal halves and mirrors
//        it, so the pixel at elevation +δ and the one at −δ (the rows y and 359 − y) sum, in the linear target, to upper + lower
//        within 1/255, and the row pair nearest the horizon reads their mean;
//    and the blur happened: at blur 0 the pixel 3° above the horizon is the upper color within 1 code, and at 0.5 it is at least 4
//    codes from it. Every failure names its pixel.
// 2. The product. The frame at blur 0.5 and the frame at blur 0: every pixel the ball covers fully (the ID target says ball on it and
//    on every pixel within 2 px; no pixel is read from the rim, where some MSAA samples show the background) is byte-equal in the final
//    and the linear targets, at least 8,000 pixels; the background moved (at least 1,000 pixels by 2 codes), so the equality is
//    not an identical frame. Planted: a blur that also feeds the lighting, drawn here by a real program, the same document
//    lit and shown with the HDR pre-blurred on the CPU at roughness 0.5 (helpers: blurredStepPixel, its rows the lobe's mix); the
//    same judge on its ball pixels fails naming a pixel, and at least 1,000 of the ball's pixels differ.
// Wrong programs: no blur, or blur at another roughness (the references differ by more than 1 code at the horizon); a background
// that lies in the wrong direction; a blur that relights the product; a product that blurs with its background.
import { describe, expect, it } from 'vitest';
import {
  AC, BLUR_CAM, BLUR_ROUGHNESS, BLUR_SIZE, STEP, blurDoc, blurredStepPixel, codeOff, codes, failsNamingPixels, frameAt, framesOf, judgePixel, mant, nearItem, none, px, rayAt, readIds,
  readLinear, readPng, requireMetal, runGpu, shareTable, stepPixel, useDir, useGpu, view3dCall, within, writeHdr, writeJson, type Image, type Rgb,
} from './helpers.ts';

const bin = useGpu();
const dir = useDir();
const [W, H] = BLUR_SIZE;
const UPPER = mant(STEP.upper); const LOWER = mant(STEP.lower);
const elevation = (x: number, y: number): number => (Math.asin(rayAt(BLUR_CAM, x + 0.5, y + 0.5)[1]) * 180) / Math.PI;

function draw(out: string, hdr: { sha: string; path: string }, docs: { name: string; doc: ReturnType<typeof blurDoc> }[]) {
  const replies = runGpu(bin(), out, docs.map((d) => view3dCall({ doc: writeJson(out, d.name, d.doc), size: BLUR_SIZE, targets: ['final', 'linear', 'ids'], assets: { [hdr.sha]: hdr.path } })));
  return docs.map((d, i) => {
    const f = frameAt(framesOf(replies[i]!, d.name), 0, d.name);
    return { img: readPng(out, f.final, d.name), lin: readLinear(out, f, BLUR_SIZE, d.name), ids: readIds(out, f, d.name) };
  });
}

describe(`${AC[3]} the blurred background reads the prefiltered cube; the product in front of it is the frame at blur 0`, () => {
  it(`${AC[3]} at background_blur 0.5 the background pixels equal the roughness 0.5 prefilter within 1 code, and mirror about the horizon`, () => {
    requireMetal();
    const out = dir();
    const hdr = writeHdr(out, [720, 360], stepPixel);
    const [blurred, sharp] = draw(out, hdr, [{ name: 'blur-05', doc: blurDoc(hdr.sha, BLUR_ROUGHNESS) }, { name: 'blur-0', doc: blurDoc(hdr.sha, 0) }]) as [ReturnType<typeof draw>[number], ReturnType<typeof draw>[number]];
    const share = shareTable(BLUR_ROUGHNESS);
    const wantAt = (x: number, y: number): Rgb => {
      const w = share(elevation(x, y));
      return codes([0, 1, 2].map((k) => LOWER[k]! + (UPPER[k]! - LOWER[k]!) * w) as Rgb);
    };
    const against: string[] = []; const mirror: string[] = []; let judged = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (blurred.ids.at(x, y) !== null || nearItem(blurred.ids, x, y, 4)) continue;
      judged++;
      const f = judgePixel(x, y, `at blur 0.5, elevation ${elevation(x, y).toFixed(2)}°`, px(blurred.img, x, y), wantAt(x, y));
      if (f) against.push(f);
      const y2 = H - 1 - y;
      if (y < H / 2 && blurred.ids.at(x, y2) === null && !nearItem(blurred.ids, x, y2, 4)) {
        const a = blurred.lin.at(x, y); const b = blurred.lin.at(x, y2);
        const off = Math.max(...[0, 1, 2].map((k) => Math.abs(a[k]! + b[k]! - (UPPER[k]! + LOWER[k]!)))) * 255;
        if (off > 1) mirror.push(`(${x}, ${y}) and (${x}, ${y2}) sum ${[0, 1, 2].map((k) => (a[k]! + b[k]!).toFixed(4)).join(', ')}, upper + lower is ${[0, 1, 2].map((k) => (UPPER[k]! + LOWER[k]!).toFixed(4)).join(', ')} (${off.toFixed(2)} off, in 1/255 of linear)`);
      }
    }
    expect(judged, 'at least 100,000 background pixels are judged').toBeGreaterThanOrEqual(100_000);
    const both = [mirror.length ? `the blurred background does not mirror about the horizon (${mirror.length} row pairs):\n  ${mirror.slice(0, 10).join('\n  ')}` : '', against.length ? `the blurred background does not equal the roughness 0.5 prefilter (${against.length} pixels of ${judged}):\n  ${against.slice(0, 10).join('\n  ')}` : ''].filter((m) => m);
    expect(both, both.join('\n')).toEqual([]);
    // The blur happened: 3° above the horizon, row where elevation first exceeds 3°.
    let y3 = 0; while (elevation(10, y3) > 3) y3++;
    expect(judgePixel(10, y3, 'blur 0, 3° above the horizon', px(sharp.img, 10, y3), codes(UPPER)), 'at blur 0 the background 3° above the horizon is the upper color').toBeNull();
    expect(codeOff(px(blurred.img, 10, y3), codes(UPPER)), 'at blur 0.5 it is at least 4 codes from the upper color').toBeGreaterThanOrEqual(4);
  }, 1_800_000);

  it(`${AC[3]} every pixel the product covers is byte-equal to the frame at blur 0; the planted blur that relights the product fails naming a pixel`, () => {
    requireMetal();
    const out = dir();
    const hdr = writeHdr(out, [720, 360], stepPixel);
    const soft = writeHdr(out, [720, 360], blurredStepPixel(BLUR_ROUGHNESS));
    const [blurred, sharp] = draw(out, hdr, [{ name: 'blur-05', doc: blurDoc(hdr.sha, BLUR_ROUGHNESS) }, { name: 'blur-0', doc: blurDoc(hdr.sha, 0) }]) as [ReturnType<typeof draw>[number], ReturnType<typeof draw>[number]];
    // The planted program: the lighting and the background both from the pre-blurred HDR (the wrong program's output), in its own asset.
    const planted = runGpu(bin(), out, [view3dCall({ doc: writeJson(out, 'planted', blurDoc(soft.sha, 0)), size: BLUR_SIZE, targets: ['final', 'linear', 'ids'], assets: { [soft.sha]: soft.path } })]);
    const pf = frameAt(framesOf(planted[0]!, 'the planted blur'), 0, 'the planted blur');
    const plantedImg = readPng(out, pf.final, 'the planted blur');
    const same = (a: Image, b: Image, x: number, y: number): boolean => [0, 1, 2, 3].every((i) => a.rgba[(y * W + x) * 4 + i] === b.rgba[(y * W + x) * 4 + i]);
    const problems: string[] = []; const plantedProblems: string[] = []; let ball = 0; let moved = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!within(blurred.ids, x, y, 'product', 2)) continue;
      ball++;
      const a = blurred.lin.at(x, y); const b = sharp.lin.at(x, y);
      if (!same(blurred.img, sharp.img, x, y) || a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2]) problems.push(`(${x}, ${y}) at blur 0.5 reads ${px(blurred.img, x, y).join(', ')} (linear ${a.map((v) => v.toFixed(5)).join(', ')}), at blur 0 ${px(sharp.img, x, y).join(', ')} (linear ${b.map((v) => v.toFixed(5)).join(', ')})`);
      if (!same(plantedImg, sharp.img, x, y)) plantedProblems.push(`(${x}, ${y}) with lighting from the blurred environment reads ${px(plantedImg, x, y).join(', ')}, at blur 0 ${px(sharp.img, x, y).join(', ')}`);
      if (codeOff(px(blurred.img, x, y), px(sharp.img, x, y)) > 0) moved++;
    }
    expect(ball, 'the ball covers at least 8,000 pixels, each with every pixel within 2 px on the ball').toBeGreaterThanOrEqual(8000);
    none(problems, 'every pixel the product covers is byte-equal at blur 0.5 and blur 0');
    expect(moved).toBe(0);
    let bg = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (blurred.ids.at(x, y) === null && !nearItem(blurred.ids, x, y, 4) && codeOff(px(blurred.img, x, y), px(sharp.img, x, y)) >= 2) bg++;
    expect(bg, 'the background moved with the blur: at least 1,000 pixels by 2 codes').toBeGreaterThanOrEqual(1000);
    expect(plantedProblems.length, 'the planted blur relights the product: at least 1,000 ball pixels change').toBeGreaterThanOrEqual(1000);
    failsNamingPixels(plantedProblems, 'the planted blur that also feeds the environment\'s lighting');
  }, 1_800_000);
});
