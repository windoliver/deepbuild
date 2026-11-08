// #464.56dd891a: "Two separations offset 3 px overprint to the multiply of their colors within one code value in the
// overlap, and dots anchored to the plate stay on it within 0.5 px through a 5× zoom"
//
// A white 800 × 600 print with two solid rects, cyan #28aae6 and rose #e65a96, printed as two solid separations,
// rose's registered 3 px right (`offset: [3, 0]`), overprinting by multiply. In the overlap every pixel is within one
// code value of the multiply of the two inks' 8-bit sRGB values (c₁ × c₂ ÷ 255, as Vello's and resvg's multiply blend
// works on encoded values; Oracle page); the three columns the offset uncovers show cyan alone, and the three it adds
// rose alone, so the offset is 3 px and not 0. Then one cyan separation with a round halftone (angle 0, pitch 24 px)
// anchored to the plate, screening a rect at 35% coverage, through a camera zoom from 1× to 5× over one second: every
// dot whose whole spot is in the frame at 1.67× and 5× lands, mapped back through the camera onto the plate, within
// 0.5 plate px of a dot found at 1×. Wrong programs: separations not offset, overprint by knockout or in linear light,
// a screen anchored to the frame or the sheet.
import { describe, expect, it } from 'vitest';
import {
  AC, type Image, doc2d, fromHex, film2d, frameAt, hex, item, look2d, none, pixel, readFinal, rect, requireGpu, runGpu, useBins, useOut,
} from './helpers.ts';

const bins = useBins(['deep-gpu']);
const out = useOut();
const CYAN = '#28aae6';
const ROSE = '#e65a96';
const C = fromHex(CYAN); const R = fromHex(ROSE);
const SIZE: [number, number] = [800, 600];

/** Each pixel of the region within `tol` code values of `want(x, y)`; failures name the first few pixels. */
function region(img: Image, x0: number, x1: number, y0: number, y1: number, want: [number, number, number], what: string): string[] {
  const bad: string[] = []; let n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const p = pixel(img, x, y);
    const off = Math.max(...[0, 1, 2].map((c) => Math.abs(p[c]! - want[c]!)));
    if (off > 1) { n++; if (bad.length < 4) bad.push(`(${x}, ${y}) is ${hex(p)}`); }
  }
  return n ? [`${what}: ${n} pixels more than one code value from ${want.map((v) => v.toFixed(1)).join(', ')}: ${bad.join(', ')}`] : [];
}

describe(`${AC[1]} two offset separations overprint by multiply, and plate-anchored dots hold through a zoom`, () => {
  it(`${AC[1]} two solid separations, one registered 3 px right, overprint to the multiply of their colors within one code value in the overlap`, () => {
    requireGpu();
    const doc = doc2d('separations-464', SIZE, [rect('cyan-sheet', 'a0', [200, 200, 300, 200], 'cyan'), rect('rose-sheet', 'a1', [350, 250, 300, 200], 'rose')]);
    const look = look2d('separations-464', { cyan: CYAN, rose: ROSE }, {
      separations: [
        { role: 'cyan', halftone: 'solid', offset: [0, 0], order: 0, overprint: 'multiply', anchor: 'plate' },
        { role: 'rose', halftone: 'solid', offset: [3, 0], order: 1, overprint: 'multiply', anchor: 'plate' },
      ],
    });
    const [r] = runGpu(bins.bin('deep-gpu'), out(), [film2d(doc, look, { frames: 1, capture: [0] })]);
    const img = readFinal(out(), frameAt(r!, 0, 'the separations'), 'the separations');
    const multiply = [0, 1, 2].map((c) => (C[c]! * R[c]!) / 255) as [number, number, number];
    // Cyan spans x 200–500; rose, moved 3 px right, x 353–653; both y 250–400 in the overlap.
    none([
      ...region(img, 356, 497, 253, 397, multiply, `the overlap (multiply of ${hex(C)} and ${hex(R)})`),
      ...region(img, 350, 353, 260, 390, C, 'the 3 px the offset uncovers (cyan alone)'),
      ...region(img, 650, 653, 260, 390, R, 'the 3 px the offset adds (rose alone)'),
      ...region(img, 210, 340, 210, 240, C, 'cyan alone'),
      ...region(img, 510, 640, 410, 440, R, 'rose alone'),
    ], `${AC[1]} the overprint`);
  });

  it(`${AC[1]} a halftone anchored to the plate keeps every dot on the plate within 0.5 px through a 5× zoom`, () => {
    requireGpu();
    const doc = doc2d('plate-dots-464', SIZE, [
      item('cam', 'camera@1', 'a0', { projection: 'orthographic', target: [400, 300, 0], view_width: 800 }),
      item('tone', 'rect@1', 'a1', { box: [0, 0, 800, 600], paint: { fill: { role: 'cyan' }, opacity: 0.35 } }),
    ], {
      camera: 'cam',
      channels: { zoom: { target: 'items/cam/params/view_width', type: 'f32', keys: { k0: { t: '0s', value: 800, interp: 'linear' }, k1: { t: '1s', value: 160, interp: 'hold' } } } },
    });
    const look = look2d('plate-dots-464', { cyan: CYAN }, {
      separations: [{ role: 'cyan', halftone: { angle: 0, pitch: 24, spot: 'round' }, offset: [0, 0], order: 0, overprint: 'multiply', anchor: 'plate' }],
    });
    const [r] = runGpu(bins.bin('deep-gpu'), out(), [film2d(doc, look, { fps: 24, frames: 25, capture: [0, 12, 24] })]);
    const viewWidth = (n: number): number => 800 - (640 * n) / 24;
    const plate = (n: number): [number, number][] => {
      const img = readFinal(out(), frameAt(r!, n, `frame ${n}`), `frame ${n}`);
      const k = viewWidth(n) / SIZE[0];
      return dots(img).map(([x, y]) => [(x - SIZE[0] / 2) * k + 400, (y - SIZE[1] / 2) * k + 300]);
    };
    const base = plate(0);
    expect(base.length, `at 1× the 35% screen shows its dots (${base.length} found)`).toBeGreaterThanOrEqual(400);
    const problems: string[] = [];
    for (const n of [12, 24]) {
      const found = plate(n);
      expect(found.length, `frame ${n} (${(800 / viewWidth(n)).toFixed(2)}×) shows whole dots`).toBeGreaterThanOrEqual(n === 24 ? 12 : 100);
      for (const [x, y] of found) {
        const d = Math.min(...base.map(([bx, by]) => Math.hypot(bx - x, by - y)));
        if (d > 0.5) problems.push(`frame ${n} (${(800 / viewWidth(n)).toFixed(2)}×): a dot at plate (${x.toFixed(2)}, ${y.toFixed(2)}) is ${d.toFixed(2)} px from the nearest dot at 1×`);
      }
    }
    none(problems, `${AC[1]} plate-anchored dots`);
  });
});

/** The centroids of the cyan dots wholly inside the frame: connected pixels whose red falls below the paper's by half the ink's, weighted by ink. */
function dots(img: Image): [number, number][] {
  const { width: w, height: h } = img;
  const ink = (x: number, y: number): number => Math.max(0, Math.min(1, (255 - pixel(img, x, y)[0]) / (255 - C[0])));
  const seen = new Uint8Array(w * h);
  const found: [number, number][] = [];
  for (let y0 = 0; y0 < h; y0++) for (let x0 = 0; x0 < w; x0++) {
    if (seen[y0 * w + x0] || ink(x0, y0) < 0.5) continue;
    const stack = [[x0, y0]]; seen[y0 * w + x0] = 1;
    let minX = x0; let maxX = x0; let minY = y0; let maxY = y0;
    while (stack.length) {
      const [x, y] = stack.pop()!;
      minX = Math.min(minX, x!); maxX = Math.max(maxX, x!); minY = Math.min(minY, y!); maxY = Math.max(maxY, y!);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x! + dx!; const ny = y! + dy!;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h || seen[ny * w + nx] || ink(nx, ny) < 0.5) continue;
        seen[ny * w + nx] = 1; stack.push([nx, ny]);
      }
    }
    if (minX <= 1 || minY <= 1 || maxX >= w - 2 || maxY >= h - 2) continue;
    let sw = 0; let sx = 0; let sy = 0;
    for (let y = minY - 1; y <= maxY + 1; y++) for (let x = minX - 1; x <= maxX + 1; x++) { const v = ink(x, y); sw += v; sx += v * (x + 0.5); sy += v * (y + 0.5); }
    if (sw > 0) found.push([sx / sw, sy / sw]);
  }
  return found;
}
