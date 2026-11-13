// AC2 #1653.91f150e7: The terrain floor from #467's fixture draws each cell's tile from the atlas, sampling inside its
// cell (padding kept) at every zoom from 0.5 to 4; a flipped row draws mirrored; an animated row shows frame
// ⌊t × frame_rate + phase × frames⌋ mod frames, the same seeked as played
// (this file carries one clause: "a flipped row draws mirrored")
//
// An atlas tile set (`marks@1`, mark: image, `atlas`, a square `grid`) of two rows drawing the same tile, its quadrants
// four colors, is drawn by `deep-canvas-render raster` three times, changing only the right row's `flip`: 0, the h bit,
// the v bit. Where each quadrant lands is read from the unflipped picture, so the test never assumes the square grid's
// layout, the padding's treatment or the sampling filter (README: Readings).
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  type Image, type JsonObject, drawn, encodeRgbaPng, item, none, px, rasterLine, render, sha256, useBin,
} from '../467/helpers.ts';

const ID = 'AC2 #1653.91f150e7';
const bin = useBin('deep-canvas-render');

type Rgb = [number, number, number];
/** The tile's four quadrants, as the atlas holds them, and the other cell's one color. */
const Q = { tl: [220, 40, 40], tr: [40, 180, 60], bl: [40, 60, 220], br: [230, 200, 30] } as const satisfies Record<string, Rgb>;
type Quad = keyof typeof Q;
const QUADS = Object.keys(Q) as Quad[];
const DECOY: Rgb = [120, 60, 20];
/** Largest per-channel difference a drawn opaque texel may show against its atlas value. */
const TOL = 12;

/** A 32 × 16 atlas of two 16 × 16 cells in one row: cell 0 all DECOY, cell 1 the four quadrants, each to its cell's edges. */
function atlasPng(): Buffer {
  return encodeRgbaPng(32, 16, (x, y) => {
    if (x < 16) return [...DECOY, 255];
    const q: Quad = y < 8 ? (x < 24 ? 'tl' : 'tr') : (x < 24 ? 'bl' : 'br');
    return [...Q[q], 255];
  });
}

const typed = (dtype: 'i32' | 'u16' | 'u8', values: number[]): JsonObject => {
  const size = { i32: 4, u16: 2, u8: 1 }[dtype];
  const b = Buffer.alloc(values.length * size);
  values.forEach((v, i) => (dtype === 'i32' ? b.writeInt32LE(v, i * 4) : dtype === 'u16' ? b.writeUInt16LE(v, i * 2) : b.writeUInt8(v, i)));
  return { dtype, len: values.length, data: b.toString('base64') };
};

const SIZE: [number, number] = [240, 120];
/** Two rows of tile 1 on a square grid of 40 u cells, at cells (1, 1) and (3, 1); the left row is never flipped. */
function tiles(asset: string, rightFlip: number): JsonObject {
  return {
    format: 1, id: 'atlas-flip', profile: 'figure', title: '#1653 atlas flip', description: 'Two rows of one atlas tile, the right one flipped.', size: SIZE,
    budget: { class: 'figure' }, layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } },
    items: {
      tiles: item('tiles', 'marks@1', 'a1', {
        mark: 'image', n: 2,
        atlas: { asset, cell: [16, 16], padding: 1 },
        grid: { shape: 'square', cell: [40, 40] },
        columns: { cx: typed('i32', [1, 3]), cy: typed('i32', [1, 1]), tile: typed('u16', [1, 1]), flip: typed('u8', [0, rightFlip]) },
      }),
    },
  };
}

const near = (p: readonly number[], c: Rgb, tol = TOL): boolean => c.every((v, i) => Math.abs(p[i]! - v) <= tol) && p[3]! >= 255 - tol;
const name = (p: readonly number[]): string => {
  const hit = QUADS.find((q) => near(p, Q[q]));
  return hit ?? (near(p, DECOY) ? 'decoy' : `rgba(${p.join(', ')})`);
};

/** Each tile's (left, right) quadrant centres in the unflipped picture: the centroid of the pixels within TOL of each color. */
function centres(im: Image): Record<'left' | 'right', Record<Quad, [number, number]>> {
  const hits: { q: Quad; x: number; y: number }[] = [];
  for (let y = 0; y < im.height; y++) for (let x = 0; x < im.width; x++) {
    const p = px(im, x, y);
    const q = QUADS.find((k) => near(p, Q[k]));
    if (q) hits.push({ q, x, y });
  }
  expect(hits.length, 'the unflipped picture shows the tile\'s quadrant colors').toBeGreaterThan(0);
  const mid = hits.reduce((s, h) => s + h.x, 0) / hits.length;
  const out = { left: {}, right: {} } as Record<'left' | 'right', Record<Quad, [number, number]>>;
  for (const side of ['left', 'right'] as const) for (const q of QUADS) {
    const mine = hits.filter((h) => h.q === q && (side === 'left' ? h.x < mid : h.x >= mid));
    expect(mine.length, `the unflipped ${side} tile shows its ${q} quadrant over at least 20 pixels`).toBeGreaterThanOrEqual(20);
    out[side][q] = [Math.round(mine.reduce((s, h) => s + h.x, 0) / mine.length), Math.round(mine.reduce((s, h) => s + h.y, 0) / mine.length)];
  }
  return out;
}

describe(`${ID} a flipped row draws mirrored`, () => {
  it(`${ID} a row with the h bit draws its atlas cell mirrored left to right, with the v bit top to bottom, in place, and an unflipped row beside it as the atlas holds it`, () => {
    const store = mkdtempSync(join(tmpdir(), 'deep-1653-flip-store-'));
    const dir = mkdtempSync(join(tmpdir(), 'deep-1653-flip-'));
    try {
      const png = atlasPng();
      const asset = sha256(png);
      writeFileSync(join(store, asset), png);
      // flip: u8, bits h, v, transpose (Mark set: atlas tiles), read in that order from the lowest bit: h = 1, v = 2.
      const flips = { none: 0, h: 1, v: 2 } as const;
      const lines = Object.values(flips).map((f) => ({ ...rasterLine(dir, tiles(asset, f)), store }));
      const answers = render(bin(), 'raster', lines);
      const [plain, h, v] = lines.map((l, i) => drawn(l, answers[i], `flip ${Object.keys(flips)[i]}`).image) as [Image, Image, Image];

      const at = centres(plain);
      const failures: string[] = [];
      // The unflipped cell draws as the atlas holds it: its left quadrants left of its right ones, its top ones above (y down).
      for (const side of ['left', 'right'] as const) {
        const c = at[side];
        if (!(c.tl[0] < c.tr[0] && c.bl[0] < c.br[0])) failures.push(`unflipped ${side} tile: tl/bl not left of tr/br (${JSON.stringify(c)})`);
        if (!(c.tl[1] < c.bl[1] && c.tr[1] < c.br[1])) failures.push(`unflipped ${side} tile: tl/tr not above bl/br (${JSON.stringify(c)})`);
      }
      const mirror: Record<'h' | 'v', Record<Quad, Quad>> = {
        h: { tl: 'tr', tr: 'tl', bl: 'br', br: 'bl' },
        v: { tl: 'bl', tr: 'br', bl: 'tl', br: 'tr' },
      };
      for (const [bit, im] of [['h', h], ['v', v]] as const) {
        for (const q of QUADS) {
          // The left row isn't flipped: each of its quadrant centres reads what it read unflipped.
          const [lx, ly] = at.left[q];
          const left = px(im, lx, ly);
          if (!near(left, Q[q])) failures.push(`flip ${bit}: the unflipped left row at (${lx}, ${ly}) reads ${name(left)}, want ${q}`);
          // The flipped row, in its own place: where its q quadrant drew unflipped, the mirrored quadrant draws.
          const [rx, ry] = at.right[q];
          const right = px(im, rx, ry);
          const want = mirror[bit][q];
          if (!near(right, Q[want])) failures.push(`flip ${bit} (${flips[bit]}): the flipped row at (${rx}, ${ry}), where ${q} drew unflipped, reads ${name(right)}, want ${want}`);
        }
      }
      none(failures, 'the flipped row draws its cell mirrored on its own axis, in place, and the unflipped row as the atlas holds it');
    } finally {
      rmSync(store, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
