// AC6 #2386.b3f6fe16: 10,000 rows with `draw` from one atlas draw in one instanced draw for their atlas. Each fixture
// of #1653 and #536 keeps its pixel hash. Budgets, on the reference Mac in the local preflight, compared with the merge
// base: the 10,000 rows add under 0.1 ms a frame over the same set without `draw` (drafted, a target to be measured)
// (this file carries the second clause: "Each fixture of #1653 and #536 keeps its pixel hash")
//
// The fixtures are the atlas documents #1653's and #536's suites draw, built by those suites' own helpers (read only):
// #1653's terrain floor (#467's 30-cell hex floor) at zooms 1 and 2.7, its animated rows at 0 and 0.3 s, its isometric
// fixture, and its flipped rows (the redraft's two rows of a four-color tile, the right one flipped h, then v, built
// here from the same fields, since that document lives in its test file); #536's terrain fixture and its tile sheet at
// zoom 2, and its 6 × 6 pointy odd hex board. None writes `draw` or `anchor`. Each is drawn by `deep-canvas-render
// raster` (Vello CPU, every platform; the call those suites draw with), and its pixel hash, the SHA-256 of its width,
// height and RGBA bytes, is compared with the one the merge base draws, held in base-hashes.json (README: The hashes).
// The comparison is shown not to be vacuous: no picture is blank, and the isometric fixture given a `draw` hashes
// differently, so the hash sees what this issue moves.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ANIM_COLORS, FLOOR, animDoc, atlasPng as floorAtlas, atlasSet, doc as figure1653, fl, isoAtlas, isoDoc, terrain,
} from '../1653/helpers.ts';
import { CELL, GRID, atlasPng as terrainAtlas, doc as figure536, terrainDoc, tileSheet } from '../536/helpers.ts';
import {
  AC, REPO, TIMEOUT, drawnExtent, encodeRgbaPng, none, obj, pixelHash, putAssets, rasterLine, rasterLines, solidAtlas, useBin, useTemp, type JsonObject,
  type Rgb,
} from './helpers.ts';

const ID = AC[6];
const bin = useBin('deep-canvas-render');
const temp = useTemp();
/** Each fixture's pixel hash as the merge base draws it (README: The hashes). */
const BASE = JSON.parse(readFileSync(join(REPO, 'tests', 'acceptance', '2386', 'base-hashes.json'), 'utf8')) as Record<string, string>;

/** The flip redraft's atlas: two 16 × 16 cells, cell 0 one color, cell 1 four quadrants of four colors. */
const QUADRANTS: Record<'tl' | 'tr' | 'bl' | 'br', Rgb> = { tl: [220, 40, 40], tr: [40, 180, 60], bl: [40, 60, 220], br: [230, 200, 30] };
const flipAtlas = (): Buffer => encodeRgbaPng(32, 16, (x, y) => (x < 16 ? [120, 60, 20, 255] : [...QUADRANTS[y < 8 ? (x < 24 ? 'tl' : 'tr') : (x < 24 ? 'bl' : 'br')], 255]));
/** Its document: two rows of tile 1 on a square grid of 40 u cells, at (1, 1) and (3, 1), the right one flipped. */
const flipDoc = (asset: string, flip: number): JsonObject =>
  figure1653('atlas-flip', [240, 120], [atlasSet('tiles', 'a1', asset, [16, 16], { shape: 'square', cell: [40, 40] }, [{ cx: 1, cy: 1, tile: 1, flip: 0 }, { cx: 3, cy: 1, tile: 1, flip }])]);
/** #536's 6 × 6 atlas hex board, pointy odd, every row tile 0. */
const hexBoard = (asset: string): JsonObject =>
  figure536('board-pointy-odd', [240, 200], [atlasSet('board', 'a1', asset, [16, 16], { shape: 'hex', cell: CELL, hex: { orient: 'pointy', offset: 'odd' } }, GRID.map(([cx, cy]) => ({ cx, cy, tile: 0 })))]);

interface Fixture { name: string; atlas: () => Buffer; doc: (asset: string) => JsonObject; t?: number; zoom?: number }
const FIXTURES: Fixture[] = [
  { name: '#1653 terrain floor, zoom 1', atlas: floorAtlas, doc: (a) => terrain(a, FLOOR) },
  { name: '#1653 terrain floor, zoom 2.7', atlas: floorAtlas, doc: (a) => terrain(a, FLOOR), zoom: 2.7 },
  { name: '#1653 animated rows, 0 s', atlas: () => solidAtlas([16, 16], ANIM_COLORS), doc: animDoc },
  { name: '#1653 animated rows, 0.3 s', atlas: () => solidAtlas([16, 16], ANIM_COLORS), doc: animDoc, t: fl(0.3) },
  { name: '#1653 isometric fixture', atlas: isoAtlas, doc: isoDoc },
  { name: '#1653 flipped rows, h', atlas: flipAtlas, doc: (a) => flipDoc(a, 1) },
  { name: '#1653 flipped rows, v', atlas: flipAtlas, doc: (a) => flipDoc(a, 2) },
  { name: '#536 terrain fixture, zoom 2', atlas: terrainAtlas, doc: (a) => terrainDoc('terrain', a), zoom: 2 },
  { name: '#536 tile sheet, zoom 2', atlas: terrainAtlas, doc: tileSheet, zoom: 2 },
  { name: '#536 hex board, pointy odd', atlas: () => solidAtlas([16, 16], [[200, 120, 40]]), doc: hexBoard },
];
const ISO = FIXTURES.findIndex((f) => f.name === '#1653 isometric fixture');
/** The isometric fixture with the issue's fields on its set: every tile drawn 32 × 32 u from its anchor. */
function isoWithDraw(asset: string): JsonObject {
  const d = JSON.parse(JSON.stringify(isoDoc(asset))) as JsonObject;
  const atlas = obj(obj(obj(obj(d['items'], 'items')['iso'], 'items.iso')['params'], 'iso params')['atlas'], 'iso atlas');
  atlas['draw'] = [32, 32];
  atlas['anchor'] = [0.5, 0.75];
  return d;
}

describe(`${ID} no pixel of a set without draw or anchor changes`, () => {
  it(`${ID} each fixture of #1653 and #536 keeps its pixel hash`, () => {
    const store = temp();
    const out = temp();
    const asset = (png: Buffer): string => putAssets(store, [png])[0]!;
    const lines = FIXTURES.map((f) => rasterLine(out, f.doc(asset(f.atlas())), f.t ?? 0, { store, view: { zoom: f.zoom ?? 1 } }));
    lines.push(rasterLine(out, isoWithDraw(asset(isoAtlas())), 0, { store, view: { zoom: 1 } }));
    const drawn = rasterLines(bin(), lines, 'the fixtures of #1653 and #536').map((r) => r.image);
    const hashes = FIXTURES.map((_, i) => pixelHash(drawn[i]!));
    console.log(`${ID}: each fixture's pixel hash in this run:\n${FIXTURES.map((f, i) => `  ${JSON.stringify(f.name)}: ${JSON.stringify(hashes[i])}`).join(',\n')}`);
    expect(FIXTURES.filter((_, i) => drawnExtent(drawn[i]!) === null).map((f) => f.name), 'every fixture draws something: no picture is blank').toEqual([]);
    none(FIXTURES.flatMap((f, i) => (BASE[f.name] === hashes[i] ? [] : [`${f.name}: its pixels hash ${hashes[i]}; at the merge base ${BASE[f.name] ?? 'no hash is held for it'}`])), 'each fixture keeps the pixel hash the merge base draws');
    expect(pixelHash(drawn[FIXTURES.length]!), 'the hash sees what this issue moves: the isometric fixture with draw [32, 32] and anchor [0.5, 0.75] draws other pixels than the fixture without them').not.toBe(hashes[ISO]);
  }, TIMEOUT);
});
