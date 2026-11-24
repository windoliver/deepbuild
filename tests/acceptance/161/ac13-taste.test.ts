// AC13 #161.2dcc0047: Shown to you: screenshots of one fixture per effect category, levels, curves, corner_pin and the
// slice_shift title, taken by the check run from the renderer's own output, with a recording of the slice_shift title,
// are attached to the PR and shown to you in the session. Whether they look right is one taste call, recorded; without
// it the run stays INCONCLUSIVE, never PASS, and no criterion above reads a picture to judge it.
//
// Fifteen files, all from this run's renderer, kept in DEEPBUILD_EVIDENCE_DIR (else `$TMPDIR/deep-161-evidence`), each
// named with its SHA-256 and its path printed for the PR and the session:
//   - `category-<name>.png`, ten sheets, one per effect category: a tile of one small picture for each operator of the
//     category, the operator at its defaults in the tile's group, in the issue's order, five tiles a row (so all 69
//     show); `layers`' PNG of the writer layer, byte for byte;
//   - `levels.png`, `curves.png` and `corner_pin.png`: the same picture, larger, under criterion 2's params;
//   - `slice-shift-title.png`: criterion 7's title in its second step (frame 7), `film2d`'s final PNG, byte for byte;
//   - `slice-shift-title.apng`: the title's six steps, frames 0 to 41 at 50 frames a second, as an animated PNG of
//     `film2d`'s final frames.
// The taste call is a file you record, named by DEEPBUILD_TASTE_161: {"criterion": "#161.2dcc0047", "by": "you",
// "screenshots": [sha256 × 15], "call": "looks_right" | "looks_wrong"}. With no record, or one made on other files,
// the test fails `INCONCLUSIVE:`; `looks_wrong` fails it. No other test in this suite reads these files or the call.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, CATEGORIES, CATEGORY_NAMES, TIMEOUT, buildLine, criterion, document, encodeApng, evidenceDir, group, inconclusive, isObject, item, layersCall, listProblems, named, opId, packOperators,
  rect, refusal, requireGpu, runGpu, sha256, shown, useBin, useDir, type Category, type JsonObject, type JsonValue,
} from './helpers.ts';
import { TITLE, film2d, rowsOf, titleDoc } from './title.ts';

const ID = AC[13];
const gpu = useBin('deep-gpu');
const dir = useDir();
const TILE = { w: 96, h: 64, gap: 8, columns: 5 };

/** One tile's picture at (x, y), `w` × `h`: a ramp, a bar, a block and a dot, in group `id` with `passes`. Keying's
 * tiles stand on a backing of the role green. */
function tile(id: string, x: number, y: number, w: number, h: number, passes: JsonValue[], order: string, keying: boolean): JsonObject[] {
  const child = { parent: id };
  return [
    group(id, `${order}0`, passes),
    keying ? rect(`${id}_back`, `${order}1`, [x, y, w, h], 'green', 1, child)
      : item(`${id}_back`, 'rect@1', `${order}1`, { box: [x, y, w, h], paint: { fill: { gradient: { kind: 'linear', stops: [{ at: 0, role: 'amber' }, { at: 0.5, role: 'sky' }, { at: 1, role: 'violet' }] } } } }, child),
    rect(`${id}_bar`, `${order}2`, [x + w * 0.125, y + h * 0.25, w * 0.75, h * 0.125], 'ink', 1, child),
    rect(`${id}_block`, `${order}3`, [x + w * 0.5, y + h * 0.5, w * 0.25, h * 0.375], 'plate', 1, child),
    rect(`${id}_dot`, `${order}4`, [x + w * 0.1875, y + h * 0.5625, w * 0.125, h * 0.1875], 'white', 1, child),
  ];
}
/** A category's sheet: one tile per operator, in the issue's order. */
function sheet(c: Category): { doc: JsonObject; size: [number, number] } {
  const names = CATEGORIES[c];
  const rows = Math.ceil(names.length / TILE.columns);
  const size: [number, number] = [TILE.gap + TILE.columns * (TILE.w + TILE.gap), TILE.gap + rows * (TILE.h + TILE.gap)];
  const items = names.flatMap((n, k) => tile(`t${k}`, TILE.gap + (k % TILE.columns) * (TILE.w + TILE.gap), TILE.gap + Math.floor(k / TILE.columns) * (TILE.h + TILE.gap), TILE.w, TILE.h,
    [{ op: opId(n), params: {} }], `a${String(k).padStart(2, '0')}`, c === 'keying'));
  return { doc: document(`sheet-${c}`, size, items), size };
}
/** Criterion 2's three operators, each on the tile's picture at 288 × 192. */
const SINGLES: { name: string; pass: JsonValue }[] = [
  { name: 'levels', pass: { op: opId('levels'), params: { in_black: 0.2, in_white: 0.8, out_black: 0.1, out_white: 0.9 } } },
  { name: 'curves', pass: { op: opId('curves'), params: { points: [[0, 0.05], [0.2, 0.12], [0.45, 0.5], [0.7, 0.62], [1, 0.95]] } } },
  { name: 'corner_pin', pass: { op: opId('corner_pin'), params: { quad: [[0.125, 0.25], [0.875, 0.125], [0.75, 0.875], [0.25, 0.75]] }, grow: 0 } },
];
const single = (name: string, pass: JsonValue): JsonObject => document(`single-${name}`, [320, 224], tile('shown', 16, 16, 288, 192, [pass], 'a', false));

/** The PNG bytes `layers` wrote for layer main, or why there are none. */
function layerPng(out: string, reply: JsonObject | undefined, what: string): Buffer | string {
  const refused = refusal(reply, what);
  if (refused) return refused;
  const layer = (Array.isArray(reply!['layers']) ? reply!['layers'] : []).filter(isObject).find((l) => l['layer'] === 'main');
  const side = isObject(layer?.['drawn']) && isObject(layer['drawn']['gpu_layer']) ? layer['drawn']['gpu_layer'] : undefined;
  if (!side || side['code'] !== undefined) return `${what}: the GPU layer drew no layer main: ${shown(layer ?? reply, 400)}`;
  const bytes = named(out, side['png'], 'png');
  return typeof bytes === 'string' ? `${what}: ${bytes}` : bytes;
}

describe(`${ID} one taste call on the renderer's own screenshots and recording`, () => {
  it(`${ID} a sheet per effect category, levels, curves, corner_pin, the slice_shift title and its recording, from the renderer's own output, and the recorded taste call says they look right`, () => {
    expect(listProblems(packOperators()), 'packs/fx-1.0.0 holds the issue\'s 69 operators and fx.slice_shift@1, each by its ID').toEqual([]);
    requireGpu();
    expect(gpu().error, buildLine('deep-gpu')).toBe('');
    const out = dir();
    const frames = TITLE.step_frames * TITLE.steps;
    const ran = runGpu(gpu().bin, out, [
      ...CATEGORY_NAMES.map((c) => layersCall(sheet(c).doc, { float: false })),
      ...SINGLES.map((s) => layersCall(single(s.name, s.pass), { float: false })),
      film2d(titleDoc('title-shown', true), { frames, capture: Array.from({ length: frames }, (_, n) => n) }),
    ]);
    expect(ran.problem, 'deep-gpu draws the sheets, the three figures and the title').toBe('');

    const keep = evidenceDir();
    const missing: string[] = []; const screenshots: string[] = [];
    const kept = (name: string, bytes: Buffer | string): void => {
      if (typeof bytes === 'string') { missing.push(bytes); return; }
      const hash = sha256(bytes); const [base, ext] = name.split('.') as [string, string];
      const file = join(keep, `${base}-${hash}.${ext}`);
      writeFileSync(file, bytes);
      console.log(`for the taste call: ${file}`);
      screenshots.push(hash);
    };
    CATEGORY_NAMES.forEach((c, i) => kept(`category-${c}.png`, layerPng(out, ran.replies[i], `the ${c} sheet`)));
    SINGLES.forEach((s, i) => kept(`${s.name}.png`, layerPng(out, ran.replies[CATEGORY_NAMES.length + i], `fx.${s.name}@1`)));
    const film = rowsOf(out, ran.replies[CATEGORY_NAMES.length + SINGLES.length], 'the slice_shift title');
    if (typeof film === 'string') missing.push(film);
    else if (film.length !== frames || film.some((r) => !r.picture || !r.final)) missing.push(`the slice_shift title: ${film.length} frames of ${frames}, each with its final picture`);
    else {
      kept('slice-shift-title.png', named(out, film[TITLE.step_frames]!.final, 'png'));
      kept('slice-shift-title.apng', encodeApng(film.map((r) => r.picture!), TITLE.fps));
    }
    expect(missing, `every picture comes from this run's renderer: ${missing.slice(0, 6).join('; ')}`).toEqual([]);
    expect(screenshots.length, 'ten sheets, three figures, the title and its recording').toBe(15);

    const path = process.env['DEEPBUILD_TASTE_161'];
    if (!path || !existsSync(path)) inconclusive(`no taste call is recorded on these files (${screenshots.join(', ')}); record yours in a file named by DEEPBUILD_TASTE_161`);
    const record = JSON.parse(readFileSync(path, 'utf8')) as { criterion?: string; by?: string; screenshots?: string[]; call?: string };
    const same = JSON.stringify([...(record.screenshots ?? [])].sort()) === JSON.stringify([...screenshots].sort());
    if (record.criterion !== criterion(13) || record.by !== 'you' || !same) inconclusive(`the recorded taste call at ${path} isn't yours on these files (${screenshots.join(', ')})`);
    expect(record.call, 'your taste call').toBe('looks_right');
  }, TIMEOUT);
});
