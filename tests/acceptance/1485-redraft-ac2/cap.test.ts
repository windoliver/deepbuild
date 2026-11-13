// #1485 AC2, blind redraft: "Four 2,000 × 2,000 linear images (64,000,000 B) draw, and a fifth (80,000,000 B in all)
// is refused. A planted cap that counts only copies draws it and fails."
//
// The design's budget counts what a frame draws at the levels it draws, a level being the smallest power-of-two box
// reduction at or above the drawn size (Image `image@1`). So each picture here is drawn at its own size, 2,000 × 2,000
// device px (a 2,000 × 2,000 u box at zoom 1): its level is the whole picture, 2,000 × 2,000 × 4 = 16,000,000 B, and the
// criterion's sums hold as written. Four are 64,000,000 B, within the 64 MB of drawn levels a document holds; five are
// 80,000,000 B, past it.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, test, type TestContext } from 'vitest';
import {
  type Box, decodePng, flatPng, GROUND, type JsonObject, LOOK, near, one, onlyOnMacos, pixel, put, RENDER_BUILD, type Rgb,
  scratch, short, skipUnsupported, useBuild,
} from './helpers.ts';

const SIDE = 2_000;
/** One picture's drawn level in bytes: 2,000 × 2,000 straight RGBA. */
const LEVEL = SIDE * SIDE * 4;
const PLANT = 'cap_counts_copies_only';

interface Picture { id: string; color: Rgb; box: Box; asset: string }
/** Five pictures of one color each, side by side, each box its picture's own size. */
const PICTURES: Picture[] = ([
  [200, 40, 40], [40, 160, 60], [230, 200, 40], [150, 60, 180], [240, 140, 20],
] as Rgb[]).map((color, i) => ({ id: `p${i + 1}`, color, box: [i * SIDE, 0, SIDE, SIDE], asset: '' }));
const BOARD: [number, number] = [PICTURES.length * SIDE, SIDE];

const bin = useBuild(RENDER_BUILD, 'deep-canvas-render', 'debug');
const store = scratch('store');
const outs = scratch('out');

beforeAll(() => {
  for (const p of PICTURES) p.asset = put(store, flatPng(SIDE, SIDE, p.color));
}, 600_000);

/** A board holding `pictures` in one writer layer, in draw order, each `sampling: linear` and filling its box. */
function board(pictures: Picture[]): JsonObject {
  const items: JsonObject = {};
  pictures.forEach((p, i) => {
    items[p.id] = {
      id: p.id, kind: 'image@1', layer: 'main', name: p.id, order: `a${i}`,
      params: { asset: p.asset, box: p.box, fit: 'fill', sampling: 'linear', alt: `Picture ${p.id}, one flat color` },
    };
  });
  return {
    format: 1, id: 'cap-1485-ac2', profile: 'board', title: 'Pictures', description: 'Linear images inside the 64 MB budget.',
    size: BOARD, layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } }, items,
  };
}

const center = (b: Box): [number, number] => [b[0] + b[2] / 2, b[1] + b[3] / 2];

type Surface = 'raster' | 'render';

function draw(surface: Surface, pictures: Picture[], name: string, planted?: string): { answer: JsonObject; out: string } {
  const out = join(outs, `${surface}-${name}-${planted ?? 'honest'}.png`);
  const answer = one(bin(), surface, {
    doc: board(pictures), look: LOOK, view: { zoom: 1 }, store, out, ...(planted ? { planted } : {}),
  });
  return { answer, out };
}

/** The criterion's check on one surface: every way the drawing misses it, and whether the fifth picture showed. */
interface Judged { failures: string[]; fifthShown: boolean }

function judge(ctx: TestContext, surface: Surface, planted?: string): Judged {
  const failures: string[] = [];
  const four = draw(surface, PICTURES.slice(0, 4), 'four', planted);
  skipUnsupported(ctx, four.answer, surface);
  if (four.answer['ok'] !== true) {
    failures.push(`four 2,000 × 2,000 linear images (${4 * LEVEL} B) draw; ${surface} refused them: ${short(four.answer)}`);
  } else {
    const shot = decodePng(readFileSync(four.out));
    if (shot.width !== BOARD[0] || shot.height !== BOARD[1]) {
      failures.push(`the four images' frame is ${BOARD[0]} × ${BOARD[1]} px at zoom 1; ${surface} wrote ${shot.width} × ${shot.height}`);
    } else {
      for (const p of PICTURES.slice(0, 4)) {
        const [x, y] = center(p.box);
        const seen = pixel(shot, x, y);
        if (!near(seen, p.color)) failures.push(`${p.id} draws its color ${JSON.stringify(p.color)} at its box's center (${x}, ${y}); ${surface} shows ${JSON.stringify(seen)}`);
      }
      const [x, y] = center(PICTURES[4]!.box);
      const seen = pixel(shot, x, y);
      if (!near(seen, GROUND)) failures.push(`the empty fifth box shows the ground at (${x}, ${y}); ${surface} shows ${JSON.stringify(seen)}`);
    }
  }

  const five = draw(surface, PICTURES, 'five', planted);
  const path = typeof five.answer['path'] === 'string' ? five.answer['path'] : '';
  const refused = five.answer['ok'] === false && five.answer['code'] === 'over_budget' && /^items\/p5\/params\/asset(?![\w/])/.test(path);
  if (!refused) {
    failures.push(`a fifth image (${5 * LEVEL} B in all) is refused over_budget naming items/p5/params/asset; ${surface} answered ${short(five.answer)}`);
  }
  let fifthShown = false;
  if (five.answer['ok'] === true && existsSync(five.out)) {
    const shot = decodePng(readFileSync(five.out));
    const [x, y] = center(PICTURES[4]!.box);
    fifthShown = x < shot.width && y < shot.height && near(pixel(shot, x, y), PICTURES[4]!.color);
  }
  return { failures, fifthShown };
}

describe.each<Surface>(['raster', 'render'])('#1485 AC2 on %s', (surface) => {
  test(`four 2,000 × 2,000 linear images (${4 * LEVEL} B) draw, and a fifth (${5 * LEVEL} B in all) is refused`, (ctx) => {
    if (surface === 'render') onlyOnMacos(ctx, 'render');
    const { failures } = judge(ctx, surface);
    expect(failures, `${surface}: the criterion's misses`).toEqual([]);
  });

  test(`planted ${PLANT}: the cap counts only copies, draws the fifth, and the check fails`, (ctx) => {
    if (surface === 'render') onlyOnMacos(ctx, 'render');
    const { failures, fifthShown } = judge(ctx, surface, PLANT);
    expect(fifthShown, `${surface}, planted ${PLANT}: the plant draws the fifth image, its color at p5's center`).toBe(true);
    expect(failures.length, `${surface}, planted ${PLANT}: the check fails on the fifth image alone; misses: ${JSON.stringify(failures)}`).toBe(1);
    expect(failures[0], `${surface}, planted ${PLANT}: the miss names the fifth image's refusal`).toMatch(/fifth image .*items\/p5\/params\/asset/);
  });
});
