// AC1, first half: a label in depth shapes to the same glyph runs as the same text in a 2D writer layer,
// and draws from the core's glyph atlas rather than a raster of its own.
// fixtures/depth-3d.json holds four labels in screen size under a still orthographic camera (AVATAR at
// 13 px twice, Tower Yard at 24 px, AVATAR in the mono role); fixtures/depth-2d.json holds the same four
// texts as text items in a 2D writer layer. The 2D runs come from `deep-canvas-render raster` (the 2D
// writer layer as Vello CPU draws it, every platform); the 3D runs from `deep-gpu run --backend noop`'s
// view3d call with `labels: true` (scene3d's labels as the GPU layer's frame takes them, no GPU). Every
// glyph's face, size, ID, grapheme and position must be the same f32 for f32. The planted program
// `label_mask` (the base's path: each label shaped once at a fixed em and rasterized as one mask) fails
// both checks. At the base, `raster` reports no texts and view3d no labels.

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  LOOK_2D, REPO, RENDER_BIN, accepted, arr, fixture, fixturePath, glyphsOf, int, nextF32, obj, readGrayPng, runGpu, runProblems, str,
  useBinaries, type Glyph,
} from './helpers.ts';

useBinaries('deep-canvas-render', 'deep-gpu');

let out = '';
beforeEach(() => { out = mkdtempSync(join(tmpdir(), 'deep-381-depth-')); });
afterEach(() => { if (out) rmSync(out, { recursive: true, force: true }); out = ''; });

const DOC_2D = fixture('depth-2d.json');
const DOC_3D = fixture('depth-3d.json');
const LOOK_3D = fixture('look3d.json');
const SIZE = DOC_3D['size'] as [number, number];
/** Each label's text, font role and size, as both fixtures hold them. */
const LABELS: Record<string, { text: string; font: string; size: number }> = Object.fromEntries(
  Object.entries(obj(DOC_3D['items'], 'depth-3d items')).filter(([, v]) => obj(v, 'item')['kind'] === 'mark.text@1').map(([id, v]) => {
    const p = obj(obj(v, id)['params'], `${id}.params`);
    return [id, { text: p['text'] as string, font: p['font'] as string, size: p['size'] as number }];
  }),
);

/** The 2D writer layer's texts, as `raster` draws them. */
function flatRuns(): Map<string, Glyph[]> {
  const [answer] = accepted(RENDER_BIN, ['raster'], [{ out: join(out, 'flat.png'), doc: DOC_2D, look: LOOK_2D }]);
  const texts = obj(answer!['texts'], 'raster: texts');
  return new Map(Object.keys(LABELS).map((id) => [id, glyphsOf(obj(texts[id], `raster: texts.${id}`)['glyphs'], `raster: texts.${id}.glyphs`)]));
}

interface Depth { labels: Map<string, Glyph[]>; pages: Map<number, string> }

/** The labels in depth at frame 0, as view3d reports them, with the atlas pages it wrote. */
function depthRuns(planted?: string): Depth {
  const [reply] = runGpu(out, [{ call: 'view3d', doc: fixturePath('depth-3d.json'), look: LOOK_3D, size: SIZE, labels: true }], planted ? { planted } : {});
  expect(reply!['code'], `view3d was answered, not refused: ${JSON.stringify(reply).slice(0, 1500)}`).toBeUndefined();
  const frame = obj(arr(reply!['frames'], 'view3d: frames')[0], 'view3d: frames[0]');
  const labels = new Map<string, Glyph[]>();
  for (const [i, v] of arr(frame['labels'], 'view3d: frames[0].labels').entries()) {
    const l = obj(v, `labels[${i}]`);
    labels.set(str(l['item'], `labels[${i}].item`), glyphsOf(l['glyphs'], `labels[${i}].glyphs`));
  }
  const pages = new Map<number, string>();
  for (const [i, v] of arr(frame['pages'] ?? [], 'view3d: frames[0].pages').entries()) {
    const p = obj(v, `pages[${i}]`);
    pages.set(int(p['page'], `pages[${i}].page`), join(out, `${str(p['png'], `pages[${i}].png`)}.png`));
  }
  return { labels, pages };
}

/** Each label in depth against its 2D twin; a problem names the label and the first glyph that differs. */
function depthProblems(flat: Map<string, Glyph[]>, depth: Map<string, Glyph[]>): string[] {
  return Object.keys(LABELS).flatMap((id) => {
    const d = depth.get(id);
    return d ? runProblems(flat.get(id)!, d, `label ${id}`) : [`label ${id} is not among the labels in depth`];
  });
}

/** What shows a label isn't drawn from the core's atlas: a glyph with no placement, a placement outside its page or with no ink, one glyph key on two places, or two keys on one. */
function atlasProblems(depth: Depth): string[] {
  const problems: string[] = [];
  const pages = new Map<number, ReturnType<typeof readGrayPng>>();
  for (const [page, file] of depth.pages) {
    if (!existsSync(file)) { problems.push(`atlas page ${page} was not written (${file})`); continue; }
    const png = readGrayPng(file);
    if (png.width !== 1024 || png.height !== 1024) problems.push(`atlas page ${page} is ${png.width} × ${png.height}, not 1,024 × 1,024`);
    pages.set(page, png);
  }
  for (const id of Object.keys(LABELS)) if (!depth.labels.has(id)) problems.push(`label ${id} is not among the labels in depth`);
  const byKey = new Map<string, string>();
  const byPlace = new Map<string, string>();
  for (const [id, glyphs] of depth.labels) {
    const { text, size } = LABELS[id] ?? { text: '', size: 0 };
    const chars = [...text];
    for (const [i, g] of glyphs.entries()) {
      const at = `label ${id} glyph ${i} ('${chars[g.grapheme] ?? '?'}')`;
      if (/\s/.test(chars[g.grapheme] ?? '')) continue;
      if (!g.atlas) { problems.push(`${at} has no atlas placement`); continue; }
      const a = g.atlas;
      // Raster sizes come in steps of about 12%: a 13 px label isn't rasterized at a fixed em and scaled.
      if (Math.abs(a.raster / size - 1) > 0.13) problems.push(`${at} is rasterized at ${a.raster} px for a ${size} px label, more than one 12% step away`);
      const png = pages.get(a.page);
      if (!png) { problems.push(`${at} is placed on page ${a.page}, which the frame doesn't list`); continue; }
      if (a.w < 1 || a.h < 1 || a.x < 0 || a.y < 0 || a.x + a.w > png.width || a.y + a.h > png.height) { problems.push(`${at} is placed outside its page: ${JSON.stringify(a)}`); continue; }
      let ink = 0;
      for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) ink = Math.max(ink, png.data[y * png.width + x]!);
      if (ink === 0) problems.push(`${at}'s placement holds no ink: ${JSON.stringify(a)}`);
      const key = `${g.font}|${g.id}|${Math.fround(a.raster)}`;
      const place = `${a.page}|${a.x}|${a.y}|${a.w}|${a.h}`;
      const placed = byKey.get(key);
      if (placed !== undefined && placed !== place) problems.push(`${at}: glyph ${g.id} of ${g.font} at ${a.raster} px sits at two places in the atlas (${placed} and ${place})`);
      byKey.set(key, place);
      const owner = byPlace.get(place);
      if (owner !== undefined && owner !== key) problems.push(`${at}: two glyphs share one atlas place ${place}`);
      byPlace.set(place, key);
    }
  }
  // Distinct places of distinct keys never overlap on a page.
  const rects = [...byPlace.keys()].map((p) => p.split('|').map(Number) as [number, number, number, number, number]);
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    const [pa, xa, ya, wa, ha] = rects[i]!; const [pb, xb, yb, wb, hb] = rects[j]!;
    if (pa === pb && xa < xb + wb && xb < xa + wa && ya < yb + hb && yb < ya + ha) problems.push(`atlas places ${rects[i]!.join('|')} and ${rects[j]!.join('|')} overlap`);
  }
  return problems;
}

describe('AC1 a label in depth shapes to the same glyph runs as the same text in a 2D writer layer', () => {
  it('AC1 each label in depth has the glyph run of its 2D twin: the same faces, sizes, glyph IDs, graphemes and positions, f32 for f32', () => {
    const flat = flatRuns();
    // The 2D side is a real run: a glyph per character of these texts, in the role's face, at the item's size.
    for (const [id, { text, size }] of Object.entries(LABELS)) {
      const glyphs = flat.get(id)!;
      expect(glyphs.length, `raster: ${id} ("${text}") draws one glyph per character`).toBe([...text].length);
      expect(glyphs.every((g) => g.size === size), `raster: ${id} is shaped at ${size} px`).toBe(true);
      expect(glyphs.map((g) => g.grapheme), `raster: ${id}'s glyphs follow its graphemes`).toEqual([...text].map((_, i) => i));
      expect(new Set(glyphs.map((g) => g.x)).size, `raster: ${id}'s glyphs sit at ${glyphs.length} places`).toBe(glyphs.length);
      for (const g of glyphs) expect(existsSync(join(REPO, g.font)), `raster: ${id}'s face ${g.font} is a bundled font file`).toBe(true);
    }
    expect(flat.get('avatar-mono')![0]!.font, 'the mono role is another face than the body role').not.toBe(flat.get('avatar-13')![0]!.font);
    const depth = depthRuns();
    expect([...depth.labels.keys()].sort(), 'view3d lists every label in depth at frame 0').toEqual(Object.keys(LABELS).sort());
    expect(depthProblems(flat, depth.labels), 'each label in depth against the same text in the 2D writer layer').toEqual([]);
    // The check's twin: one glyph one f32 step to the right fails it, naming the label and the glyph.
    const nudged = new Map(depth.labels);
    const avatar = depth.labels.get('avatar-13')!.map((g) => ({ ...g }));
    avatar[1]!.x = nextF32(avatar[1]!.x);
    nudged.set('avatar-13', avatar);
    expect(depthProblems(flat, nudged).join('\n'), 'a run one f32 step off fails, naming the label and the glyph').toMatch(/label avatar-13: glyph 1 \(grapheme 1\) sits at/);
  }, 1_800_000);

  it('AC1 each label in depth draws from the core\'s glyph atlas: every visible glyph has its own place on a 1,024² page, with ink, one place per face, glyph and raster size, rasterized within one 12% step of the label\'s size', () => {
    const depth = depthRuns();
    expect(depth.labels.size, 'view3d lists the labels in depth').toBe(Object.keys(LABELS).length);
    expect(depth.pages.size, 'the frame lists the atlas pages its labels sample').toBeGreaterThan(0);
    expect(atlasProblems(depth), 'the labels\' atlas placements').toEqual([]);
    // AVATAR's A, V, T and R are four glyphs: a label drawn from one mask of its own has one place, not four.
    const places = new Set(depth.labels.get('avatar-13')!.map((g) => JSON.stringify(g.atlas)));
    expect(places.size, 'AVATAR at 13 px samples four atlas places, one per distinct glyph').toBe(4);
    // The same text at the same size, twice in one frame, samples the same places.
    expect(depth.labels.get('avatar-13-again')!.map((g) => g.atlas), 'the second AVATAR at 13 px samples the first one\'s places').toEqual(depth.labels.get('avatar-13')!.map((g) => g.atlas));
  }, 1_800_000);

  it('AC1 the planted label_mask, which shapes each label once at a fixed em and draws it from one mask of its own, fails both checks', () => {
    const flat = flatRuns();
    const planted = depthRuns('label_mask');
    const runs = depthProblems(flat, planted.labels);
    for (const id of Object.keys(LABELS)) {
      expect(runs.some((p) => p.startsWith(`label ${id}`)), `the planted label ${id} fails the run comparison, named:\n${runs.join('\n')}`).toBe(true);
    }
    expect(atlasProblems(planted).length, 'the planted labels fail the atlas check').toBeGreaterThan(0);
  }, 1_800_000);
});
