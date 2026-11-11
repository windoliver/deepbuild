// The level criteria: AC5 (live against canonical at every level) and AC7 (a resize keeps its level).
//
// Two pictures of the suite's kind (README: The pictures): picture 0, a JPEG, and picture 1, a PNG, both 1024 × 640.
// At the base `live` doesn't exist (`deep-canvas-render` prints its usage and exits 2) and `raster` answers no `levels`.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, GROUND, LOOK, PERIOD, board, decodePng, freshStore, imageItem, live, makePictures, one, scratch, short, useRender,
  type Asset, type Box, type Frame, type Image, type JsonObject, type Live,
} from './helpers.ts';

const bin = useRender();
const dir = scratch('levels');
const SOURCES = join(dir, 'sources');
const [JPEG, PNG] = makePictures(SOURCES, 2) as [Asset, Asset];
/** A fresh store for each test, holding the two pictures and nothing a run kept. */
const store = (name: string): string => freshStore(SOURCES, join(dir, name), [JPEG, PNG]);

// ---------------------------------------------------------------------------------------------------
// AC5: each picture drawn `fit: fill` at three quarters of level k's size for k = 0 … 6 (768 × 480 down to 12 × 7.5),
// so level k, the smallest at or above the drawn size, is the one each asks for; and each once as a 120 u cover tile,
// the grid's (level 2). The settled live frame (`live`, its settle phase's last frame) against the canonical render
// (`raster`, Vello CPU), pixel by pixel inside each picture's box less a 1 px edge.

const KS = [0, 1, 2, 3, 4, 5, 6];
const SIZE: [number, number] = [1568, 1024];
interface Placed { id: string; box: Box; level: number }

function placed(): Placed[] {
  const out: Placed[] = [];
  for (const [col, prefix] of [[0, 'j'], [1, 'n']] as const) {
    const x = 8 + col * (768 + 16);
    let y = 8;
    for (const k of KS) {
      const [w, h] = [768 / 2 ** k, 480 / 2 ** k];
      out.push({ id: `${prefix}${k}`, box: [x, y, w, h], level: k });
      if (k === 1) out.push({ id: `${prefix}c`, box: [x + w + 16, y, 120, 120], level: 2 });
      y += h + 8;
    }
  }
  return out;
}
const PLACED = placed();

function levelsDoc(): JsonObject {
  const items: JsonObject = {};
  PLACED.forEach((p, i) => { items[p.id] = imageItem(p.id, i, p.id.startsWith('j') ? JPEG : PNG, p.box, p.id.endsWith('c') ? 'cover' : 'fill'); });
  return board('levels-1486', SIZE, items);
}

/** Each pixel inside `box` less a 1 px edge, as [x, y]. */
function interior([bx, by, bw, bh]: Box): [number, number][] {
  const out: [number, number][] = [];
  for (let y = Math.ceil(by) + 1; y < Math.floor(by + bh) - 1; y++) for (let x = Math.ceil(bx) + 1; x < Math.floor(bx + bw) - 1; x++) out.push([x, y]);
  return out;
}
const at = (im: Image, x: number, y: number): [number, number, number] => {
  const o = (y * im.width + x) * 4;
  return [im.rgba[o]!, im.rgba[o + 1]!, im.rgba[o + 2]!];
};

describe(`${AC[5]} at every level, the settled live frame's image pixels equal the canonical render's within 2 levels per channel`, () => {
  it(`${AC[5]} a JPEG and a PNG at levels 0 to 6 and as a cover tile: the settled live frame and the canonical render each draw every picture at its level, and every pixel inside each picture is within 2 levels per channel of the other's`, () => {
    const b = bin();
    const doc = levelsDoc();
    const s = store('ac5-store');
    const liveOut = join(dir, 'live.png');
    const canonOut = join(dir, 'canonical.png');
    const r: Live = live(b, { doc, view: { zoom: 1, rect: [0, 0, ...SIZE] }, store: s, captures: [{ phase: 'settle', frame: 'last', out: liveOut }] }, 'AC5 live');
    const settled: Frame = r.frames.filter((f) => f.phase === 'settle').at(-1)!;
    expect(settled.settling, 'AC5: the live frame captured is settled').toBe(false);
    const canonical = one(b, 'raster', { doc, look: LOOK, view: { zoom: 1 }, store: s, out: canonOut });
    expect(canonical['ok'], `AC5: raster draws the document: ${short(canonical, 1000)}`).toBe(true);
    const canonLevels = canonical['levels'];
    expect(typeof canonLevels === 'object' && canonLevels !== null && !Array.isArray(canonLevels), `AC5: raster answers each picture's level (README: Surfaces), got ${short(canonLevels)}`).toBe(true);
    const asked = PLACED.map((p) => ({ id: p.id, want: p.level, live: settled.levels.get(p.id) ?? null, canonical: (canonLevels as JsonObject)[p.id] ?? null }));
    expect(asked.filter((a) => a.live?.asked !== a.want || a.live?.drawn !== a.want || a.canonical !== a.want), 'AC5: each picture drawn at its level, the smallest at or above its drawn size, live and canonical').toEqual([]);

    const liveImage = decodePng(readFileSync(liveOut));
    const canonImage = decodePng(readFileSync(canonOut));
    expect([liveImage.width, liveImage.height], 'AC5: the live frame is the document at zoom 1').toEqual(SIZE);
    expect([canonImage.width, canonImage.height], 'AC5: the canonical render is the document at zoom 1').toEqual(SIZE);
    const colors = new Set<number>();
    const problems: string[] = [];
    for (const p of PLACED) {
      const px = interior(p.box);
      let off = 0; let worst = 0; let where = '';
      let drawn = false;
      for (const [x, y] of px) {
        const a = at(liveImage, x, y); const c = at(canonImage, x, y);
        colors.add((a[0] << 16) | (a[1] << 8) | a[2]);
        if (a.some((v, i) => Math.abs(v - GROUND[i]!) > 30)) drawn = true;
        const d = Math.max(...a.map((v, i) => Math.abs(v - c[i]!)));
        if (d > 2) off++;
        if (d > worst) { worst = d; where = `(${x}, ${y}): live ${JSON.stringify(a)}, canonical ${JSON.stringify(c)}`; }
      }
      if (!drawn) problems.push(`${p.id} (level ${p.level}): the live frame shows no picture in its box`);
      if (off) problems.push(`${p.id} (level ${p.level}): ${off} of ${px.length} pixels differ by more than 2 levels; the worst by ${worst} at ${where}`);
    }
    expect(colors.size, 'AC5: the pictures drawn hold at least 32 colors, so equal frames are not two blanks').toBeGreaterThanOrEqual(32);
    expect(problems, 'AC5: the settled live frame against the canonical render').toEqual([]);
  }, 1_800_000);
});

// ---------------------------------------------------------------------------------------------------
// AC7: picture 0 drawn `fit: fill` at 230 × 143.75 u (0.9 of level 2's 256 × 160, so level 2 is asked for), opened and
// settled, then scaled 1% of that size a frame by `at.scale` channels, 20 frames through 1.2× (276 × 172.5, 1.08 of
// level 2: within the 0.5× to 1.25× it keeps, though past level 2's size, where "the smallest level at or above" would
// ask for level 1). Each move frame's time is one frame later on the document's clock.

describe(`${AC[7]} moving an image's box 1% a frame through a 1.2× resize makes no new decode`, () => {
  it(`${AC[7]} a picture at level 2 resized 1% a frame to 1.2× over 20 frames: every frame asks for and draws level 2, and no decode starts while it moves, by the job list`, () => {
    const channel = (axis: number): JsonObject => ({
      target: `items/photo/at/scale/${axis}`, type: 'f32',
      keys: { k0: { t: '0s', value: 1, interp: 'linear' }, k1: { t: '1s', value: 1.6, interp: 'linear' } },
    });
    const doc = board('resize-1486', [600, 400], { photo: imageItem('photo', 0, JPEG, [100, 100, 230, 143.75], 'fill', { at: { pos: [0, 0, 0], scale: [1, 1, 1] } }) }, {
      transport: { span: '1s' }, channels: { sx: channel(0), sy: channel(1) },
    });
    const moves = Array.from({ length: 20 }, (_, k) => ({ at: [0, 0] as [number, number], t: (k + 1) * PERIOD }));
    const r = live(bin(), { doc, view: { zoom: 1, rect: [0, 0, 600, 400] }, store: store('ac7-store'), moves }, 'AC7');
    const opened = r.frames.filter((f) => f.phase === 'open').at(-1)!;
    expect(opened.settling, 'AC7: the picture settles before it moves').toBe(false);
    expect(opened.levels.get('photo'), 'AC7: at 230 × 143.75 the picture asks for and draws level 2').toEqual({ asked: 2, drawn: 2 });
    const moving = r.frames.filter((f) => f.phase === 'move');
    expect(moving.filter((f) => f.levels.get('photo')?.asked !== 2 || f.levels.get('photo')?.drawn !== 2).map((f) => `frame ${f.frame}: ${JSON.stringify(f.levels.get('photo'))}`), 'AC7: through the resize it keeps level 2').toEqual([]);
    const first = moving[0]!.frame;
    const decodes = r.jobs.filter((j) => j.kind === 'decode');
    expect(decodes.length, 'AC7: the job list holds the decode that made level 2').toBeGreaterThan(0);
    expect(decodes.filter((j) => j.frame >= first).map((j) => `level ${j.level} at frame ${j.frame}`), 'AC7: no decode starts while the picture moves or after').toEqual([]);
  }, 1_800_000);
});
