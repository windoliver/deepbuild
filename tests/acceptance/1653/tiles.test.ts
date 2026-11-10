// AC2 #1653.91f150e7: The terrain floor from #467's fixture draws each cell's tile from the atlas, sampling inside its
// cell (padding kept) at every zoom from 0.5 to 4; a flipped row draws mirrored; an animated row shows frame
// ⌊t × frame_rate + phase × frames⌋ mod frames, the same seeked as played
//
// Through `deep-canvas-render check` (the terrain's choice, #467's `expansions`) and `raster` (Vello CPU, every
// platform) with `store` (the atlas by SHA-256), `view: {zoom}` and `t` in flicks. The floor is #467's fixture exactly
// (../467/helpers.ts `terrain` and `atlasPng`): 30 grass cells on pointy hexes, cell [32, 28], four solid 16 × 16 tiles
// with padding 1. Each cell's quad is placed by the design's hex layout and stacked by centre y, then centre x (Mark set:
// hex grid); every device pixel at least 1.5 px clear of every quad's edge must show the top quad's tile color exactly
// (within 1 code), so a sample that strays into a neighbouring atlas cell, or a mip level that mixes cells, shows.
// README: The surface under test; Readings.
import { describe, expect, it } from 'vitest';
import {
  AC, ANIM_COLORS, FLICKS, FLOOR, FRAMES, HASHED_CELLS, HEX_CELL, PLAIN_CELL, RATE, animDoc, atlasPng, cellShown, check,
  describeErrors, fl, flipDoc, gradientTile, hexCentre, px, putAssets, rasterLine, rasterLines, rgbOff, rowPixel,
  sameBytes, seeded, solidAtlas, terrain, terrainColor, tilesOf, useBin, useDir, type Image,
} from './helpers.ts';

const ID = AC[2];
const bin = useBin('deep-canvas-render');
const dir = useDir();

const ZOOMS = [0.5, 0.6, 0.75, 1, 1.3, 1.5, 2, 2.7, 3, 4];

describe(`${ID} atlas tiles drawn`, () => {
  it(`${ID} the terrain floor from #467's fixture draws each cell's tile from the atlas, sampling inside its cell at every zoom from 0.5 to 4`, () => {
    const store = dir();
    const [asset] = putAssets(store, [atlasPng()]);
    const floor = terrain(asset!, FLOOR);
    const { answer, errors } = check(bin(), floor, { store });
    expect(answer['ok'], `#467's floor passes the check: ${describeErrors(errors)}`).toBe(true);
    const tiles = tilesOf(answer);
    // The quads in draw order: by centre y, then centre x.
    const quads = FLOOR.map(([cx, cy]) => ({ cell: `(${cx}, ${cy})`, c: hexCentre(cx, cy), tile: tiles.get(`${cx},${cy}`)! }))
      .sort((a, b) => a.c[1] - b.c[1] || a.c[0] - b.c[0]);
    const [hw, hh] = [HEX_CELL[0] / 2, HEX_CELL[1] / 2];
    const lines = ZOOMS.map((zoom) => rasterLine(dir(), floor, 0, { store, view: { zoom } }));
    const drawn = rasterLines(bin(), lines, 'the terrain floor');
    const problems: string[] = [];
    ZOOMS.forEach((zoom, i) => {
      const im: Image = drawn[i]!.image;
      const m = 1.5 / zoom;
      const seen = new Set<string>();
      for (let y = 0; y < im.height; y++) for (let x = 0; x < im.width; x++) {
        const u = (x + 0.5) / zoom; const v = (y + 0.5) / zoom;
        if (u > 220 || v > 120) continue;
        let top: (typeof quads)[number] | undefined; let edge = false;
        for (const q of quads) {
          const dx = Math.abs(u - q.c[0]); const dy = Math.abs(v - q.c[1]);
          const outer = dx < hw + m && dy < hh + m; const inner = dx < hw - m && dy < hh - m;
          if (outer && !inner) { edge = true; break; }
          if (inner) top = q;
        }
        if (edge || !top) continue;
        seen.add(top.cell);
        const want = terrainColor(top.tile);
        const p = px(im, x, y);
        if (rgbOff(im, x, y, want) > 1 || p[3] < 254) {
          if (problems.length < 20) problems.push(`zoom ${zoom}: pixel (${x}, ${y}) shows [${p.join(', ')}], not cell ${top.cell}'s tile ${top.tile} [${want.join(', ')}, 255]`);
        }
      }
      const missing = quads.filter((q) => !seen.has(q.cell)).map((q) => q.cell);
      expect(missing, `zoom ${zoom}: every cell has pixels clear of every quad edge to judge`).toEqual([]);
    });
    expect(problems, `each cell draws its own tile from inside its atlas cell at every zoom:\n${problems.join('\n')}`).toEqual([]);
  });

  it(`${ID} a flipped row draws mirrored`, () => {
    const store = dir();
    const [asset] = putAssets(store, [gradientTile()]);
    const [plain, h, v] = rasterLines(bin(), [0, 1, 2].map((flip) => rasterLine(dir(), flipDoc(asset!, flip), 0, { store })), 'the flip rows').map((r) => r.image);
    // The quad's drawn extent in the unflipped picture; a mirror maps it onto itself.
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (let y = 0; y < plain!.height; y++) for (let x = 0; x < plain!.width; x++) if (px(plain!, x, y)[3] > 0) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    expect(x1 - x0, `the unflipped row draws a 16 u quad (drawn extent x ${x0}..${x1})`).toBeGreaterThanOrEqual(14);
    expect(y1 - y0, `the unflipped row draws a 16 u quad (drawn extent y ${y0}..${y1})`).toBeGreaterThanOrEqual(14);
    const off = (a: Image, b: Image, x: number, y: number, bx: number, by: number): number => Math.max(...px(a, x, y).map((c, k) => Math.abs(c - px(b, bx, by)[k]!)));
    let asymmetric = 0; const hProblems: string[] = []; const vProblems: string[] = [];
    for (let y = y0 + 1; y < y1; y++) for (let x = x0 + 1; x < x1; x++) {
      const mx = x0 + x1 - x; const my = y0 + y1 - y;
      asymmetric = Math.max(asymmetric, off(plain!, plain!, x, y, mx, y));
      if (off(h!, plain!, x, y, mx, y) > 2) hProblems.push(`(${x}, ${y}) shows [${px(h!, x, y).join(', ')}], the unflipped (${mx}, ${y}) [${px(plain!, mx, y).join(', ')}]`);
      if (off(v!, plain!, x, y, x, my) > 2) vProblems.push(`(${x}, ${y}) shows [${px(v!, x, y).join(', ')}], the unflipped (${x}, ${my}) [${px(plain!, x, my).join(', ')}]`);
    }
    expect(asymmetric, 'the gradient tile is not its own mirror, so a flip that does nothing shows').toBeGreaterThan(50);
    expect(hProblems.slice(0, 10), `flip 1 (h) draws the row mirrored left to right (${hProblems.length} pixels aren't)`).toEqual([]);
    expect(vProblems.slice(0, 10), `flip 2 (v) draws the row mirrored top to bottom (${vProblems.length} pixels aren't)`).toEqual([]);
  });

  it(`${ID} an animated row shows frame ⌊t × frame_rate + phase × frames⌋ mod frames, the same seeked as played`, () => {
    const store = dir();
    const [asset] = putAssets(store, [solidAtlas([16, 16], ANIM_COLORS)]);
    const anim = animDoc(asset!);
    const rand = seeded(1653);
    const nearEdge = (t: number): boolean => { const r = (t * RATE) % FLICKS; return r < FLICKS * 1e-4 || FLICKS - r < FLICKS * 1e-4; };
    const times = [...new Set([
      ...Array.from({ length: 60 }, (_, k) => fl(0.013 + 0.07 * k)),
      ...Array.from({ length: 20 }, () => Math.floor(rand() * fl(4))),
    ])].filter((t) => !nearEdge(t)).sort((a, b) => a - b);
    // The play: every time in order through one process.
    const lines = times.map((t) => rasterLine(dir(), anim, t, { store }));
    const play = rasterLines(bin(), lines, 'the animated rows').map((r) => r.image);
    const [plx, ply] = rowPixel(...PLAIN_CELL);
    const plainProblems = times.flatMap((t, i) => {
      const want = Math.floor((t * RATE) / FLICKS) % FRAMES;
      const got = cellShown(play[i]!, plx, ply);
      return got === want ? [] : [`at ${t} flicks the phase-none row shows atlas cell ${got} (pixel [${px(play[i]!, plx, ply).join(', ')}]), not frame ${want} (cell ${want})`];
    });
    expect(plainProblems.slice(0, 10), `the row with phase none shows frame ⌊t × 6⌋ mod 4 at every time (${plainProblems.length} don't)`).toEqual([]);
    // Each hashed row: some one phase in [0, 1) gives every frame it showed.
    const sequences = HASHED_CELLS.map(([cx, cy]) => {
      const [x, y] = rowPixel(cx, cy);
      const frames = play.map((im) => cellShown(im, x, y) - 4);
      const bad = frames.findIndex((f) => f < 0 || f >= FRAMES);
      expect(bad, `the hashed row at (${cx}, ${cy}) shows one of its four frames (atlas cells 4 to 7) at every time; at ${times[bad]} flicks it shows [${bad >= 0 ? px(play[bad]!, x, y).join(', ') : ''}]`).toBe(-1);
      // q = phase × frames, in [0, frames): the set of q every sample allows, as half-open intervals.
      let allowed: [number, number][] = [[0, FRAMES]];
      times.forEach((t, i) => {
        const at = (t * RATE) / FLICKS; const f = frames[i]!;
        const here: [number, number][] = [];
        for (let m = Math.floor((at - f) / FRAMES) - 1; m <= Math.floor((at - f) / FRAMES) + 2; m++) here.push([f + m * FRAMES - at, f + m * FRAMES + 1 - at]);
        allowed = allowed.flatMap(([a, b]) => here.map(([c, d]) => [Math.max(a, c), Math.min(b, d)] as [number, number])).filter(([a, b]) => b - a > 1e-9);
      });
      expect(allowed.length, `the hashed row at (${cx}, ${cy}) shows ⌊t × 6 + phase × 4⌋ mod 4 for one phase in [0, 1) at every time; its frames were ${frames.join('')}`).toBeGreaterThan(0);
      return frames.join('');
    });
    expect(new Set(sequences).size, 'the hashed phase reads the row key: four rows with four keys don\'t all show the same frames').toBeGreaterThan(1);
    // The seek: some of the times, each in a fresh process, give the played bytes.
    for (const i of [0, 7, 19, 33, 46, 58, times.length - 3, times.length - 1]) {
      const line = rasterLine(dir(), anim, times[i]!, { store });
      const [seek] = rasterLines(bin(), [line], `the animated rows sought to ${times[i]} flicks`);
      expect(sameBytes(seek!.image, play[i]!), `at ${times[i]} flicks the seek, in a fresh process, draws the played pixels`).toBe(true);
    }
  });
});
