// AC2: four 2,000 × 2,000 linear images (64,000,000 B) draw, and a fifth (80,000,000 B in all) is refused. A planted
// cap that counts only copies draws it and fails.
//
// Five distinct assets, each a 2,000 × 2,000 PNG of one color (16,000,000 B of RGBA decoded), `sampling: linear`, drawn
// small in one board: the cap counts what a document holds decoded, not its drawn size. Four fit under 64 MiB
// (67,108,864 B); the fifth makes 80,000,000 B and is refused, naming its asset field (Image `image@1`: "refused
// before anything is allocated, naming the asset"). Through `deep-canvas-render raster` (Vello CPU, every platform)
// and, on macOS, `render` (GPUI, the marks path, which counts only resampled copies today). "Draw" is read off the
// picture: each of the four boxes shows its image's color at its center.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, type TestContext } from 'vitest';
import {
  LOOK, RENDER_BUILD, board, decodePng, flatPng, near, one, pixel, put, scratch, short, skipUnsupported, useBuild,
  type JsonObject, type Rgb,
} from './helpers.ts';

const bin = useBuild(RENDER_BUILD, 'deep-canvas-render', 'debug');
const dir = scratch('cap');

const SIDE = 2_000;
const COLORS: Rgb[] = [[220, 60, 60], [60, 190, 90], [240, 200, 40], [150, 70, 210], [30, 30, 30]];
const ASSETS = COLORS.map((c) => put(dir, flatPng(SIDE, SIDE, c)));
const box = (i: number): [number, number, number, number] => [4 + 24 * i, 6, 20, 20];
const doc = (n: number): JsonObject =>
  board([128, 32], ASSETS.slice(0, n).map((asset, i) => ({ id: `p${i + 1}`, asset, box: box(i), sampling: 'linear' })));
const FIFTH = 'items/p5/params/asset';

type Path = 'raster' | 'render';
let counter = 0;

/** Null when four draw (each box its image's color) and the fifth is refused naming its asset field; else what's wrong. */
function capFailure(ctx: TestContext, path: Path, planted?: string): string | null {
  const plant = planted ? { planted } : {};
  const out = join(dir, `four-${path}-${(counter += 1)}.png`);
  const four = one(bin(), path, { out, doc: doc(4), look: LOOK, store: dir, ...plant });
  if (path === 'render') skipUnsupported(ctx, four, 'render');
  const wrong: string[] = [];
  if (four['ok'] !== true) {
    wrong.push(`${path} refused the four images (64,000,000 B): ${short(four, 600)}`);
  } else {
    const image = decodePng(readFileSync(out));
    COLORS.slice(0, 4).forEach((c, i) => {
      const [x, y, w, h] = box(i);
      const at = pixel(image, x + w / 2, y + h / 2);
      if (!near(at, c, 3)) wrong.push(`${path} drew ${JSON.stringify(at)} at the center of image p${i + 1}, whose color is ${JSON.stringify(c)}`);
    });
  }
  const five = one(bin(), path, { out: join(dir, `five-${path}-${(counter += 1)}.png`), doc: doc(5), look: LOOK, store: dir, ...plant });
  if (five['ok'] !== false) wrong.push(`${path} drew the fifth image (80,000,000 B in all) instead of refusing it: ${short(five, 300)}`);
  else if (!String(five['path'] ?? '').startsWith(FIFTH)) wrong.push(`${path} refused the five images naming ${short(five['path'])}, not the fifth's ${FIFTH}: ${short(five, 400)}`);
  return wrong.length ? wrong.join('; ') : null;
}

describe('AC2 four 2,000 × 2,000 linear images (64,000,000 B) draw, and a fifth (80,000,000 B in all) is refused', () => {
  it('AC2 Vello CPU raster and GPUI render draw the four and refuse the fifth, naming it', (ctx) => {
    expect(new Set(ASSETS).size, 'five distinct assets').toBe(5);
    expect(4 * SIDE * SIDE * 4, 'four decoded').toBe(64_000_000);
    expect(5 * SIDE * SIDE * 4, 'five decoded').toBe(80_000_000);
    const paths: Path[] = process.platform === 'darwin' ? ['raster', 'render'] : ['raster'];
    const found = paths.map((path) => capFailure(ctx, path)).filter((f) => f !== null);
    expect(found, 'raster (Vello CPU) and, on macOS, render (GPUI)').toEqual([]);
  }, 900_000);

  it('AC2 planted cap_counts_copies_only draws the fifth and fails the check', (ctx) => {
    const paths: Path[] = process.platform === 'darwin' ? ['raster', 'render'] : ['raster'];
    for (const path of paths) {
      const found = capFailure(ctx, path, 'cap_counts_copies_only');
      expect(found, `${path}: the check fails on a cap that counts only copies`).not.toBeNull();
      expect(found, `${path}: it fails because the fifth image drew`).toContain(`${path} drew the fifth image`);
    }
  }, 900_000);
});
