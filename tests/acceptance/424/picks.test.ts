// AC4 #424.69a7a811: Picks name what draws, by stable ID: in a fixture whose instancer trees holds 1,000 elements with
// ids 5,000 to 5,999, a click on element 5,742 names trees#5742 from a pose that culls none (a pick after the GPU cull
// is #201's); and a click where element 5,743 is hidden by the hidden column, on a child of a group whose visible is
// false, on an item at adjust opacity 0, through the hole of a leaf card in alpha_mode mask, or past a cutaway's plane
// names the item the color pass drew at that pixel; a planted object-ID pass that writes an element's draw position
// names another element at the first pose and fails, and one that ignores the mask names the leaf through its hole and
// fails, each naming the pixel.
//
// The fixture: an orthographic view from +Z, 20 px/m, 960 × 640, every item unlit so each draws its own color. An
// `instance@1` `trees` of one prototype (a 0.6 m box) holds 1,000 elements in a 40 × 25 grid on a 1 m pitch, row i at
// column i mod 40 and line ⌊i ÷ 40⌋, its `ids` column 5,000 + (7,919 i mod 1,000): a permutation, so an element's row,
// its stable ID and its place in any ID-sorted draw differ. Its `hidden` column holds 5,743. The whole grid is in view,
// so nothing is culled. Above it, before a green ground: `grp_box`, the child of a `group@1` with `visible: false`;
// `ghost` at adjust opacity 0; `leaf`, a 1 m card in alpha_mode mask whose base color map (made here, 64² RGBA) has a
// hole at its centre (alpha 0 where u is within 0.25 of a whole number and v's fraction is in 0.25 to 0.75); and
// `cut_box`, whose +X half a view cutaway removes (three planes in intersect mode, reaching nothing else).
//
// Clicks (`view3d`'s `clicks`, answered per frame as `{at, pick}`) at pixel centres. Each must name the expected item
// and the final target there must show that item's own color within 2 codes (what the color pass drew): elements
// 5,742, 5,000, 5,999 and 5,123 name `trees#<id>`; 5,743's place, the group's child, the ghost, the leaf's hole and the
// cut half name `ground`; the leaf's solid part names `leaf`; `cut_box`'s kept half names `cut_box`.
// `--planted ids_by_draw_position` fails naming 5,742's pixel; `--planted ids_ignore_mask` fails naming the hole's.
import { describe, expect, it } from 'vitest';
import {
  AC, DARK_SKY, box, code8, codeOff, cutawayParams, encodeRgbaPng, failsNaming, frameAt, framesOf, material, ortho, orthoProject, px, readPng,
  requireMetal, runGpu, sessionDoc, sha256, unlit, useDir, useGpu, view3dCall, writeJson,
  type GpuPlanted, type JsonObject, type Rgb, type V3,
} from './helpers.ts';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const bin = useGpu();
const dir = useDir();
const SIZE: [number, number] = [960, 640];
const VIEW = 48;
const TARGET: V3 = [0, 0, 0];
const COLORS: Record<string, Rgb> = {
  ground: [0.2, 0.6, 0.2], tree: [0.6, 0.3, 0.1], grp_box: [0.9, 0.1, 0.1], ghost: [0.9, 0.9, 0.1], leaf: [0.2, 0.3, 0.9], cut_box: [0.1, 0.9, 0.9],
};
const ID = (i: number): number => 5000 + ((i * 7919) % 1000);
const rowOf = (id: number): number => { for (let i = 0; i < 1000; i++) if (ID(i) === id) return i; throw Error(`no row holds ${id}`); };
const elementPos = (i: number): V3 => [-19.5 + (i % 40), -14 + Math.floor(i / 40), 0.5];
const CUT_X = 10;

function maskPng(): Buffer {
  const n = 64; const rgba = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const u = (x + 0.5) / n; const v = (y + 0.5) / n;
    const hole = Math.min(u, 1 - u) < 0.25 && v > 0.25 && v < 0.75;
    rgba.set([255, 255, 255, hole ? 0 : 255], (y * n + x) * 4);
  }
  return encodeRgbaPng(n, n, rgba);
}

function fixture(out: string): { doc: string; assets: Record<string, string> } {
  const png = maskPng(); const sha = sha256(png);
  writeFileSync(join(out, `${sha}.png`), png);
  const ids = Array.from({ length: 1000 }, (_, i) => ID(i));
  const items: Record<string, JsonObject> = {
    cam: ortho(TARGET, VIEW), sky: DARK_SKY,
    ground_mat: unlit(COLORS['ground']!), tree_mat: unlit(COLORS['tree']!), grp_mat: unlit(COLORS['grp_box']!), ghost_mat: unlit(COLORS['ghost']!), cut_mat: unlit(COLORS['cut_box']!),
    leaf_mat: material({ base_color: [...COLORS['leaf']!, 1], unlit: true, alpha_mode: 'mask', alpha_cutoff: 0.5, maps: { base_color: sha } }),
    ground: box([60, 40, 0.2], [0, 0, -1], { material: 'ground_mat' }),
    tree: box([0.6, 0.6, 0.6], [0, 0, 0], { material: 'tree_mat' }),
    trees: { kind: 'instance@1', params: { of: ['tree'], ids, pos: ids.map((_, i) => [elementPos(i)[0], elementPos(i)[1], 0]), hidden: [5743] }, at: { pos: [0, 0, 0.5] } },
    grp: { kind: 'group@1', params: {}, at: { pos: [-15, 12.5, 0.5] }, visible: false },
    grp_box: box([1, 1, 1], [0, 0, 0], { material: 'grp_mat', parent: 'grp' }),
    ghost: box([1, 1, 1], [-8, 12.5, 0.5], { material: 'ghost_mat', adjust: { opacity: 0 } }),
    leaf: { kind: 'slab@1', params: { size: [1, 1, 0.02], uv0: { planar: { axis: 'z' } }, uv_scale: 1 }, at: { pos: [3, 12, 0.5] }, material: 'leaf_mat' },
    cut_box: box([1, 1, 1], [CUT_X, 12.5, 0.5], { material: 'cut_mat' }),
  };
  return { doc: writeJson(out, 'picks', sessionDoc('picks', SIZE, items)), assets: { [sha]: join(out, `${sha}.png`) } };
}
/** The cutaway that removes `cut_box`'s +X half and reaches nothing else: x > 10, y > 11.5 and z > 0.2 together. */
const CUT = cutawayParams([{ normal: [1, 0, 0], offset: CUT_X }, { normal: [0, 1, 0], offset: 11.5 }, { normal: [0, 0, 1], offset: 0.2 }], { mode: 'intersect' });

interface Case { what: string; world: [number, number]; want: string; color: Rgb }
const element = (id: number): Case => { const p = elementPos(rowOf(id)); return { what: `element ${id}`, world: [p[0], p[1]], want: `trees#${id}`, color: COLORS['tree']! }; };
const ELEMENTS: Case[] = [5742, 5000, 5999, 5123].map(element);
const DRAWN: Case[] = [
  { ...element(5743), what: 'element 5743, hidden by the hidden column', want: 'ground', color: COLORS['ground']! },
  { what: 'the child of a group whose visible is false', world: [-15, 12.5], want: 'ground', color: COLORS['ground']! },
  { what: 'the item at adjust opacity 0', world: [-8, 12.5], want: 'ground', color: COLORS['ground']! },
  { what: 'the hole of the leaf card in alpha_mode mask', world: [3, 12.5], want: 'ground', color: COLORS['ground']! },
  { what: 'the leaf card\'s solid part', world: [3.4, 12.5], want: 'leaf', color: COLORS['leaf']! },
  { what: 'cut_box past the cutaway\'s plane', world: [CUT_X + 0.25, 12.5], want: 'ground', color: COLORS['ground']! },
  { what: 'cut_box short of the cutaway\'s plane', world: [CUT_X - 0.25, 12.5], want: 'cut_box', color: COLORS['cut_box']! },
];
const pixelOf = (c: Case): [number, number] => { const [sx, sy] = orthoProject(TARGET, VIEW, SIZE, [c.world[0], c.world[1], 0]); return [Math.floor(sx), Math.floor(sy)]; };

/** The clicks' answers held to each case; each failure names its pixel. */
function pick(out: string, cases: Case[], planted?: GpuPlanted): string[] {
  const { doc, assets } = fixture(out);
  const clicks = cases.map((c) => { const [x, y] = pixelOf(c); return { frame: 0, at: [x + 0.5, y + 0.5] as [number, number] }; });
  const [reply] = runGpu(bin(), out, [view3dCall({ doc, size: SIZE, targets: ['final'], assets, clicks, cutaway: CUT })], planted);
  const f = frameAt(framesOf(reply!, 'the picks'), 0, 'the picks');
  const final = readPng(out, f.final, 'the picks');
  expect(f.clicks.length, 'each click is answered').toBe(cases.length);
  const failures: string[] = [];
  cases.forEach((c, i) => {
    const [x, y] = pixelOf(c); const got = f.clicks[i]!.pick;
    const want = c.color.map(code8) as Rgb; const drawn = px(final, x, y);
    if (codeOff(drawn, want) > 2) failures.push(`pixel (${x}, ${y}), ${c.what}: the color pass drew ${drawn.join(', ')} there, not ${c.want}'s ${want.join(', ')}`);
    if (got !== c.want) failures.push(`pixel (${x}, ${y}), ${c.what}: the click names ${got ?? 'nothing'}, but the color pass drew ${c.want} there`);
  });
  return failures;
}

describe(`${AC[4]} picks name what draws, by stable ID`, () => {
  it(`${AC[4]} a click on element 5742 of 1,000 names trees#5742 from a pose that culls none; a planted object-ID pass writing draw positions names another element there and fails, naming the pixel`, () => {
    requireMetal();
    const failures = pick(dir(), ELEMENTS);
    expect(failures, `the element picks:\n  ${failures.join('\n  ')}`).toEqual([]);
    const [x, y] = pixelOf(ELEMENTS[0]!);
    failsNaming(pick(dir(), ELEMENTS, 'ids_by_draw_position'), [`pixel (${x}, ${y})`], '--planted ids_by_draw_position');
  }, 1_800_000);

  it(`${AC[4]} clicks on a hidden element, a hidden group's child, an item at opacity 0, a mask's hole and past a cutaway name what the color pass drew; a planted pass ignoring the mask names the leaf through its hole and fails, naming the pixel`, () => {
    requireMetal();
    const failures = pick(dir(), DRAWN);
    expect(failures, `the picks of what draws:\n  ${failures.join('\n  ')}`).toEqual([]);
    const [x, y] = pixelOf(DRAWN[3]!);
    failsNaming(pick(dir(), DRAWN, 'ids_ignore_mask'), [`pixel (${x}, ${y})`], '--planted ids_ignore_mask');
  }, 1_800_000);
});
