// #464.dc7d4ab3: "A pixel look gives the same indices on two GPUs, read back from an exact operator, never shows an
// index outside its palette, and a protected role keeps its index under every table"
// #464.2b45c184: "In a 320 × 180 indexed look, a stroke 1 target pixel wide from (10.5, 20.5) to (90.5, 60.5) covers
// exactly one target pixel in each column from 10 to 90, 81 in all, and a filled circle of radius 6 centered on the
// corner at (100, 100) covers exactly the 112 pixels whose centers lie within 6 of it, with the same indices on two GPUs;
// a planted rasterizer that writes any pixel with partial coverage adds pixels at the edge and fails, naming the first"
//
// Every indexed look here is 320 × 180 at scale 4: the document and the frame are 1280 × 720 and a target pixel is 4 ×
// 4 document px, so target coordinates are document coordinates ÷ 4 (README: Readings). `film2d` with `targets:
// ["indices"]` writes the index target as read back (u16 per target pixel), and its reply's `indexed` names the
// operator it was read back from and that operator's computed class. Index i is the look's palette[i]. The two-GPU half
// compares this GPU's index hashes with a record from a GPU of another family (DEEPBUILD_SECOND_GPU_464); with one GPU
// it fails BLOCKED with that one ask. Planted: `partial_coverage`, a rasterizer that writes any target pixel a mark
// covers in part.
import { describe, expect, it } from 'vitest';
import {
  AC, type Indices, type JsonObject, type Planted, TARGET, circle, doc2d, failsNaming, film2d, frameAt, FRAME_SIZE, indexedLook, indexedOf, item, line, none, readIndices,
  rect, requireGpu, runGpu, sameOnTwoGpus, tbox, useBins, useOut,
} from './helpers.ts';

const bins = useBins(['deep-gpu']);
const out = useOut();

// ---------------------------------------------------------------------------------------------------
// #464.2b45c184: the stroke and the circle

const WIRE = 1; const COIN = 2;
function strokeAndCircle(planted?: Planted): { problems: string[]; hash: string } {
  requireGpu();
  const doc = doc2d('grid-464', FRAME_SIZE, [
    line('wire', 'a0', [10.5 * 4, 20.5 * 4], [90.5 * 4, 60.5 * 4], 4, 'wire'),
    circle('coin', 'a1', [100 * 4, 100 * 4], 6 * 4, 'coin'),
  ]);
  const look = indexedLook('grid-464', { wire: '#d9482b', coin: '#c98f2b' }, ['wire', 'coin']);
  const [r] = runGpu(bins.bin('deep-gpu'), out(), [film2d(doc, look, { frames: 1, capture: [0], targets: ['indices'] })], planted);
  const idx = readIndices(out(), frameAt(r!, 0, 'the grid'), TARGET, 'the grid');
  return { problems: [...strokeFailures(idx), ...circleFailures(idx)], hash: idx.hash };
}
function strokeFailures(idx: Indices): string[] {
  const problems: string[] = []; let total = 0;
  for (let y = 0; y < idx.height; y++) for (let x = 0; x < idx.width; x++) {
    if (idx.at(x, y) !== WIRE) continue;
    total++;
    const want = 20.5 + (x - 10) * 0.5;
    if (x < 10 || x > 90) problems.push(`the stroke covers pixel (${x}, ${y}), outside columns 10 to 90`);
    else if (Math.abs(y + 0.5 - want) > 0.5) problems.push(`the stroke covers pixel (${x}, ${y}), off the line (y ${want.toFixed(1)} at its column)`);
  }
  for (let x = 10; x <= 90; x++) {
    let n = 0; for (let y = 0; y < idx.height; y++) if (idx.at(x, y) === WIRE) n++;
    if (n !== 1) problems.push(`the stroke covers ${n} target pixels in column ${x}, not exactly one`);
  }
  if (total !== 81) problems.push(`the stroke covers ${total} target pixels, not 81`);
  return problems;
}
function circleFailures(idx: Indices): string[] {
  const problems: string[] = []; let total = 0;
  for (let y = 0; y < idx.height; y++) for (let x = 0; x < idx.width; x++) {
    const inside = (x + 0.5 - 100) ** 2 + (y + 0.5 - 100) ** 2 <= 36;
    const drawn = idx.at(x, y) === COIN;
    if (drawn) total++;
    if (drawn && !inside) problems.push(`the circle covers pixel (${x}, ${y}), whose center lies ${Math.hypot(x + 0.5 - 100, y + 0.5 - 100).toFixed(3)} from (100, 100)`);
    if (!drawn && inside) problems.push(`the circle misses pixel (${x}, ${y}), whose center lies within 6 of (100, 100)`);
  }
  if (total !== 112) problems.push(`the circle covers ${total} target pixels, not 112`);
  return problems;
}

describe(`${AC[6]} binary coverage on the index target: a one-pixel stroke and a circle`, () => {
  it(`${AC[6]} the stroke covers one target pixel in each column 10 to 90, 81 in all, and the circle exactly the 112 pixels whose centers lie within 6 of (100, 100)`, () => {
    const { problems } = strokeAndCircle();
    none(problems, `${AC[6]} the grid`);
  });
  it(`${AC[6]} a planted rasterizer that writes partly covered pixels adds pixels at the edge and fails, naming the first`, () => {
    failsNaming(strokeAndCircle('partial_coverage').problems, [/covers pixel \(\d+, \d+\)/], `${AC[6]} the planted partial_coverage`);
  });
  it(`${AC[6]} the stroke and the circle give the same indices on two GPUs`, () => {
    const { hash } = strokeAndCircle();
    sameOnTwoGpus('grid', { grid: hash }, `${AC[6]} the stroke and the circle`);
  });
});

// ---------------------------------------------------------------------------------------------------
// #464.dc7d4ab3: indices from an exact operator, inside the palette, the protected role under every table

const PALETTE = ['body', 'trim', 'guard', 'flashbody', 'flashtrim', 'ice'];
const COLORS = { body: '#2c3e7b', trim: '#5f7f3b', guard: '#e3e4e6', flashbody: '#ffd9a0', flashtrim: '#fff4e0', ice: '#a8d8ff' };
const index = (role: string): number => ['ground', ...PALETTE].indexOf(role);
const GROUPS: [string, string, number][] = [['plain', 'none', 20], ['flashed', 'flash', 120], ['frozen', 'frozen', 220]];

function tablesFixture(): JsonObject[] {
  return GROUPS.flatMap(([g, table, x], k) => [
    item(g, 'group@1', `b${k}`, {}, { table }),
    rect(`${g}-body`, 'a0', tbox(x, 40, 40, 30), 'body', { parent: g }),
    rect(`${g}-trim`, 'a1', tbox(x, 80, 40, 10), 'trim', { parent: g }),
    rect(`${g}-guard`, 'a2', tbox(x, 100, 40, 20), 'guard', { parent: g }),
  ]);
}

describe(`${AC[3]} a pixel look's indices: exact, inside the palette, protected under every table`, () => {
  function draw(): { reply: JsonObject; idx: Indices } {
    requireGpu();
    const look = indexedLook('tables-464', COLORS, PALETTE, {
      tables: { flash: { body: 'flashbody', trim: 'flashtrim' }, frozen: { body: 'ice', trim: 'ice' } }, protected: ['guard'],
    });
    const [r] = runGpu(bins.bin('deep-gpu'), out(), [film2d(doc2d('tables-464', FRAME_SIZE, tablesFixture()), look, { frames: 1, capture: [0], targets: ['indices'] })]);
    return { reply: r!, idx: readIndices(out(), frameAt(r!, 0, 'the tables fixture'), TARGET, 'the tables fixture') };
  }
  it(`${AC[3]} the index target is read back from an exact operator, holds no index outside the palette, and the protected role keeps its index under every table`, () => {
    const { reply, idx } = draw();
    const rec = indexedOf(reply, 'the tables fixture');
    expect(rec.cls, `the index target is read back from an exact operator (${rec.operator})`).toBe('exact');
    expect(rec.palette, 'the reply\'s palette is the look\'s, in index order').toEqual(['ground', ...PALETTE]);
    const problems: string[] = [];
    let outside = 0;
    for (let y = 0; y < idx.height; y++) for (let x = 0; x < idx.width; x++) if (idx.at(x, y) > PALETTE.length) { outside++; if (outside === 1) problems.push(`pixel (${x}, ${y}) holds index ${idx.at(x, y)}, outside the palette's ${PALETTE.length + 1}`); }
    const at = (x: number, y: number): number => idx.at(x + 20, y + 10);
    for (const [g, table, x] of GROUPS) {
      if (idx.at(x + 20, 110) !== index('guard')) problems.push(`under table ${table}, the protected role guard (${g}-guard) holds index ${idx.at(x + 20, 110)}, not its own ${index('guard')}`);
    }
    // The tables are applied, so the protected role's index is kept by the rule, not by a table nobody reads.
    const want: Record<string, [string, string]> = { none: ['body', 'trim'], flash: ['flashbody', 'flashtrim'], frozen: ['ice', 'ice'] };
    for (const [g, table, x] of GROUPS) {
      const [b, t] = want[table]!;
      if (at(x, 45) !== index(b)) problems.push(`${g}-body under table ${table} holds index ${at(x, 45)}, not ${b}'s ${index(b)}`);
      if (at(x, 75) !== index(t)) problems.push(`${g}-trim under table ${table} holds index ${at(x, 75)}, not ${t}'s ${index(t)}`);
    }
    none(problems, `${AC[3]} the indices`);
  });
  it(`${AC[3]} the pixel look gives the same indices on two GPUs`, () => {
    const { idx } = draw();
    sameOnTwoGpus('tables', { tables: idx.hash }, `${AC[3]} the pixel look`);
  });
});
