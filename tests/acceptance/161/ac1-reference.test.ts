// AC1 #161.66726728: Each fx@1 operator matches its CPU reference within one 10-bit code value per channel on 99.9% of
// pixels on the same machine, on a fixture per category, and a planted change to one operator fails its fixture.
//
// The CPU reference of a graph is the step graph's f64 interpreter (design: Compile, validate and cache). #431's
// `check_operator` with `reference: {"size": [w, h]}` draws one operator once on this GPU and once through that
// interpreter and answers two `.f32` files. Each of the pack's 70 graphs goes through it as `pack.json` holds it, at its
// defaults, with one change made here: every input that reads the pass's own target is bound to its category's picture
// (fixtures.ts), a 128 × 72 px PNG named in the call's `assets`, since the harness's own target is blank. slice_shift,
// which is in none of the issue's lists, runs on distort's picture.
//
// Per operator: both sides drawn (16 texels or more that aren't (0, 0, 0, 0) on each); the GPU's output changes its
// picture (16 texels or more are over two codes from the picture, so an operator that does nothing isn't held to
// nothing); and at most 9 of the 9,216 texels (0.1%) have a channel over one code from the reference, with no 16 × 16
// window holding more than 4 of them (README: Readings). The reference is held to be an oracle by the issue's own
// numbers before anything is judged against it: `fx.invert@1`'s CPU side reads (0.2, 1, 1, 1) on the patch of
// premultiplied (0.8, 0, 0, 1) and (a − r, a, a, a) on the patch of (0.2, 0, 0, 64/255), criteria 9's and 8's answers.
//
// Wrong programs: the base (the pack holds 17 of the 70), and `--planted fx_levels_gpu_off_by_two`, under which the GPU
// run of `fx.levels@1` alone writes red two codes high: the color fixture fails, naming that operator and no other.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, ALL, CATEGORIES, CATEGORY_NAMES, ONE, TIMEOUT, at, buildLine, categoryOf, checkCall, codes, encodePng, floatsOf, fx, isObject, listProblems, off, opId, overAsset,
  packOperators, requireGpu, runGpu, sha256, shown, useBin, useDir, type Category, type Floats, type JsonObject, type Planted,
} from './helpers.ts';
import { FIXTURE_SIZE, PATCH_OPAQUE, PATCH_QUARTER, picture } from './fixtures.ts';

const ID = AC[1];
const gpu = useBin('deep-gpu');
const dir = useDir();
const [W, H] = FIXTURE_SIZE;
const TEXELS = W * H;
/** 0.1% of 9,216 texels. */
const ALLOWED = Math.floor(TEXELS / 1000);
/** No 16 × 16 window holds more than this many of them (README: Readings). */
const WINDOW = { side: 16, most: 4 };

interface Side { gpu: Floats; cpu: Floats }
/** Every listed operator drawn both ways over its category's picture: the two sides, or why there are none. */
function references(ids: readonly string[], planted?: Planted): Map<string, Side | string> {
  const out = dir();
  const assets: JsonObject = {};
  const shaOf = new Map<Category, string>();
  for (const c of CATEGORY_NAMES) {
    const png = encodePng(W, H, picture(c));
    const sha = sha256(png);
    const path = join(out, `${sha}.texture.png`);
    writeFileSync(path, png);
    assets[sha] = path; shaOf.set(c, sha);
  }
  const operators = packOperators();
  const calls = ids.map((id) => checkCall(overAsset(operators[id]!, shaOf.get(categoryOf(id))!), { assets, reference: { size: [W, H] } }));
  const ran = runGpu(gpu().bin, out, calls, planted);
  const read = new Map<string, Side | string>();
  ids.forEach((id, i) => {
    if (ran.problem) { read.set(id, ran.problem); return; }
    const reply = ran.replies[i]!;
    if (reply['code'] === 'unsupported_platform') { read.set(id, 'INCONCLUSIVE: unsupported_platform'); return; }
    if (reply['outcome'] !== 'accepted') { read.set(id, `the operator check answers ${shown(reply['outcome'])}: ${shown(reply['issues'] ?? reply, 400)}`); return; }
    const ref = isObject(reply['reference']) ? reply['reference'] : {};
    const g = floatsOf(out, ref['gpu'], FIXTURE_SIZE); const c = floatsOf(out, ref['cpu'], FIXTURE_SIZE);
    read.set(id, typeof g === 'string' ? `reference.gpu: ${g}` : typeof c === 'string' ? `reference.cpu: ${c}` : { gpu: g, cpu: c });
  });
  return read;
}

const drawn = (im: Floats): number => { let n = 0; for (let i = 0; i < TEXELS; i++) if (im.data[i * 4] !== 0 || im.data[i * 4 + 1] !== 0 || im.data[i * 4 + 2] !== 0 || im.data[i * 4 + 3] !== 0) n++; return n; };
/** What is wrong with one operator's two sides, each line starting with its ID. */
function problems(id: string, side: Side | string): string[] {
  if (typeof side === 'string') return [`${id}: ${side}`];
  const found: string[] = [];
  if (drawn(side.gpu) < 16 || drawn(side.cpu) < 16) found.push(`${id}: a side drew nothing: ${drawn(side.gpu)} texels on the GPU and ${drawn(side.cpu)} on the CPU aren't (0, 0, 0, 0)`);
  const source = picture(categoryOf(id));
  let changed = 0; let first = ''; const misses: [number, number][] = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const g = fx(side.gpu, x, y); const c = fx(side.cpu, x, y);
    const o = (y * W + x) * 4;
    if (off(g, [source[o]! / 255, source[o + 1]! / 255, source[o + 2]! / 255, source[o + 3]! / 255]) > 2) changed++;
    if (off(g, c) > ONE) { misses.push([x, y]); first ||= `first (${x}, ${y}): GPU ${at(g)}, CPU ${at(c)}`; }
  }
  if (changed < 16) found.push(`${id}: at its defaults it changes ${changed} texels of its fixture by more than two codes; an operator that changes nothing can't be told from one that does nothing`);
  if (misses.length > ALLOWED) found.push(`${id} (${categoryOf(id)}): ${misses.length} of ${TEXELS} texels are more than one 10-bit code from its CPU reference, past ${ALLOWED} (0.1%); ${first}`);
  else for (const [x0, y0] of misses) {
    const near = misses.filter(([x, y]) => x >= x0 && x < x0 + WINDOW.side && y >= y0 && y < y0 + WINDOW.side).length;
    if (near > WINDOW.most) { found.push(`${id} (${categoryOf(id)}): ${near} texels more than one code from the reference sit in the ${WINDOW.side} × ${WINDOW.side} window at (${x0}, ${y0}); ${first}`); break; }
  }
  return found;
}

describe(`${ID} each fx@1 operator against its CPU reference, on a fixture per category`, () => {
  it(`${ID} all 70 operators, each on its category's fixture at its defaults: both sides drawn, the picture changed, and within one 10-bit code of the CPU reference on 99.9% of 9,216 texels`, () => {
    // The fixtures are what the header says: premultiplied, and each holds texels for its operators to change.
    for (const c of CATEGORY_NAMES) {
      const p = picture(c); let over = 0; const seen = new Set<number>();
      for (let i = 0; i < TEXELS; i++) { if (p[i * 4]! > p[i * 4 + 3]! || p[i * 4 + 1]! > p[i * 4 + 3]! || p[i * 4 + 2]! > p[i * 4 + 3]!) over++; seen.add(p[i * 4]! + 256 * p[i * 4 + 1]!); }
      expect(over, `the ${c} fixture is premultiplied: no channel above its alpha`).toBe(0);
      expect(seen.size, `the ${c} fixture holds many colors`).toBeGreaterThan(200);
    }
    expect(CATEGORY_NAMES.reduce((n, c) => n + CATEGORIES[c].length, 0), 'the issue\'s ten lists hold 69 names').toBe(69);
    expect(listProblems(packOperators()), 'packs/fx-1.0.0 holds the issue\'s 69 operators and fx.slice_shift@1, each by its ID').toEqual([]);
    requireGpu();
    expect(gpu().error, buildLine('deep-gpu')).toBe('');
    const read = references(ALL);

    // The reference is an oracle only once it reproduces the issue's own numbers (design: the parity suite's rules).
    const invert = read.get(opId('invert'))!;
    const oracle: string[] = [];
    if (typeof invert === 'string') oracle.push(`fx.invert@1: ${invert}`);
    else {
      const centre = (p: { box: readonly [number, number, number, number] }): [number, number] => [p.box[0] + p.box[2] / 2, p.box[1] + p.box[3] / 2];
      const opaque = fx(invert.cpu, ...centre(PATCH_OPAQUE));
      if (off(opaque, [0.2, 1, 1, 1]) > ONE) oracle.push(`fx.invert@1's CPU reference reads ${at(opaque)} on premultiplied (0.8, 0, 0, 1), not (0.2, 1, 1, 1)`);
      const [r, , , a] = PATCH_QUARTER.texel.map((v) => v / 255) as [number, number, number, number];
      const quarter = fx(invert.cpu, ...centre(PATCH_QUARTER));
      if (off(quarter, [a - r, a, a, a]) > ONE) oracle.push(`fx.invert@1's CPU reference reads ${at(quarter)} on premultiplied ${at([r, 0, 0, a])}, not ${at([a - r, a, a, a])}`);
      expect(codes(a - r, 0.05) < 1.1 && codes(a, 0.25) < 1.1, 'that texel\'s answer is the issue\'s (0.05, 0.25, 0.25, 0.25) to the 8-bit fixture\'s step').toBe(true);
    }
    expect(oracle, 'the CPU reference reproduces the issue\'s numbers for invert').toEqual([]);

    const found = ALL.flatMap((id) => problems(id, read.get(id)!));
    expect(found, `${found.length} findings over the 70 operators:\n  ${found.slice(0, 40).join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  it(`${ID} planted: the GPU run of fx.levels@1 two codes high in red (--planted fx_levels_gpu_off_by_two) fails the color fixture, naming that operator and no other`, () => {
    const color = CATEGORIES.color.map(opId);
    expect(color.filter((id) => !(id in packOperators())), 'the pack holds the color list\'s 14 operators').toEqual([]);
    requireGpu();
    expect(gpu().error, buildLine('deep-gpu')).toBe('');
    const read = references(color, 'fx_levels_gpu_off_by_two');
    const found = color.flatMap((id) => problems(id, read.get(id)!));
    expect(found.length, 'the planted change fails the color fixture, but the check found nothing wrong').toBeGreaterThan(0);
    expect(found.filter((f) => !f.startsWith(`${opId('levels')} (color): `)), 'every failure is fx.levels@1\'s, past one 10-bit code of its reference').toEqual([]);
  }, TIMEOUT);
});
