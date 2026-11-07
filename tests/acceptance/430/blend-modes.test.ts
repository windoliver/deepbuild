// AC3 #430.09804d01: Each of the eleven GPU-layer blend modes matches its CPU reference within one 10-bit code value on
// 99.9% of pixels on the same machine, and a dancing dissolve reached by seeking equals the played frame by pixel hash.
//
// The figure is #385's after Vello's mix scene (helpers.ts: mixDoc): a ramp and a group around a five-stop gradient at
// alpha 0.86. The reference (reference.ts) takes the inputs the renderer composites, which `layers` answers with
// `float: true` (README), and which the test first holds to independent draws of the same figure with no group and of
// the group alone. A code value is 1/1023: an output rounded to 8 bits misses it, so the GPU layer has to keep the
// blend's result at 10 bits or more. Every pixel off a formula's discontinuity is also held to 2 codes (the ceiling the
// technical design's tolerance rule asks for: a continuous formula on equal inputs has no way to stray further, so a
// small defect can't hide in the 0.1%).
//
// Upstream (README: The oracle page): Blender's .blend files and stored references need Blender, so its formulas'
// published forms stand in; they aren't run against our output, and the page's Blender row stays open.
//
// Seeking and playing are `film2d` (#417's) with `from` and `hash` (README), a fresh process each. At the base the
// check refuses every one of these `blend` names and `layers` has no `float`.
import { describe, expect, it } from 'vitest';
import {
  AC, FILM_LOOK, LOOK, MIX, SOURCE_BOX, answered, danceDoc, failsNaming, flickOf, floatsOf, fx, hashAt, inBox, layerOf, layersCall, mixBackdropDoc, mixDoc, mixSourceDoc, none, readLayers,
  requireMetal, runGpu, useDir, useGpu, type BlendInput, type Floats, type JsonObject, type Planted,
} from './helpers.ts';
import { ELEVEN, FORMULA_MODES, STATED, blend, eleven, itemSeed, keeps, lum, mode as formula, over, type Eleven, type Rgb, type Rgba } from './reference.ts';

const ID = AC[3];
const bin = useGpu();
const dir = useDir();
const [W, H] = MIX.size;
const SEED = itemSeed(MIX.seed, MIX.group);
const code10 = (v: number): number => Math.round(v * 1023);
const codes = (a: readonly number[], b: readonly number[]): number => Math.max(...a.map((v, i) => Math.abs(code10(v) - code10(b[i]!))));
const SHARE = 0.999;

const pick = (name: Eleven, b: readonly number[], s: readonly number[], x: number, y: number, frame?: number): Rgba =>
  eleven(name, b, s, keeps(SEED, x, y, MIX.opacity, frame));
/** Whether a pixel sits on a formula's discontinuity: nudging the source in the seventh digit jumps the answer. */
function onATie(name: Eleven, b: readonly number[], s: readonly number[], x: number, y: number): boolean {
  if (name === 'dissolve') return false;
  const base = pick(name, b, s, x, y);
  return [1e-5, -1e-5].some((d) => codes(base, pick(name, b, [s[0]! + d, s[1]! + d, s[2]! + d, s[3]!], x, y)) > 2);
}

interface Compared { share: number; ceiling: { x: number; y: number; codes: number } | null; worst: string }
function compare(name: Eleven, output: Floats, input: BlendInput, frame?: number): Compared {
  let within = 0; let ceiling: Compared['ceiling'] = null; let worst = '';
  let most = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const b = fx(input.backdrop, x, y); const s = fx(input.source, x, y);
    const want = pick(name, b, s, x, y, frame); const got = fx(output, x, y);
    const c = codes(got, want);
    if (c <= 1) within++;
    if (c > most) { most = c; worst = `(${x}, ${y}) is ${JSON.stringify(got.map((v) => +v.toFixed(4)))}, not ${JSON.stringify(want.map((v) => +v.toFixed(4)))}, on backdrop ${JSON.stringify(b.map((v) => +v.toFixed(4)))} and source ${JSON.stringify(s.map((v) => +v.toFixed(4)))}`; }
    if (c > 2 && (!ceiling || c > ceiling.codes) && !onATie(name, b, s, x, y)) ceiling = { x, y, codes: c };
  }
  return { share: within / (W * H), ceiling, worst };
}

interface Drawn { outputs: Map<Eleven, { output: Floats; input: BlendInput }>; alone: Floats; source: Floats }
function draw(planted?: Planted): Drawn {
  const out = dir();
  const replies = runGpu(bin(), out, [...ELEVEN.map((m) => layersCall(mixDoc(m), LOOK, { float: true })), layersCall(mixBackdropDoc(), LOOK, { float: true }), layersCall(mixSourceDoc(), LOOK, { float: true })], planted);
  const outputs = new Map<Eleven, { output: Floats; input: BlendInput }>();
  ELEVEN.forEach((m, i) => {
    const main = layerOf(readLayers(out, replies[i]!, MIX.size, `the group in ${m}`), 'main', m);
    expect(main.path, `${m}: a 2D writer layer with one of the eleven moves to the GPU layer`).toBe('gpu_layer');
    expect(main.inputs.map((e) => [e.group, e.mode]), `${m}: one blended group, in ${m}`).toEqual([[MIX.group, m]]);
    outputs.set(m, { output: floatsOf(main, m), input: main.inputs[0]! });
  });
  const alone = floatsOf(layerOf(readLayers(out, replies[ELEVEN.length]!, MIX.size, 'the ramp alone'), 'main', 'the ramp alone'), 'the ramp alone');
  const source = floatsOf(layerOf(readLayers(out, replies[ELEVEN.length + 1]!, MIX.size, 'the group alone'), 'main', 'the group alone'), 'the group alone');
  return { outputs, alone, source };
}
const EIGHT = 1.01 / 255;
function inputProblems(d: Drawn): string[] {
  const found: string[] = [];
  for (const [m, { input }] of d.outputs) {
    let back = 0; let src = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (Math.max(...fx(input.backdrop, x, y).map((v, i) => Math.abs(v - fx(d.alone, x, y)[i]!))) > EIGHT) back++;
      if (Math.max(...fx(input.source, x, y).map((v, i) => Math.abs(v - fx(d.source, x, y)[i]!))) > EIGHT) src++;
    }
    if (back > 0) found.push(`${m}: the backdrop input is off the figure drawn with no group on ${back} pixels`);
    if (src > 0) found.push(`${m}: the source input is off the group drawn alone on ${src} pixels`);
  }
  return found;
}
function modeProblems(d: Drawn): string[] {
  const found: string[] = [];
  for (const [m, { output, input }] of d.outputs) {
    const r = compare(m, output, input);
    if (r.share < SHARE) found.push(`${m}: ${(r.share * 100).toFixed(3)}% of pixels within one 10-bit code of its reference, under 99.9%; worst ${r.worst}`);
    else if (r.ceiling) found.push(`${m}: past the 2-code ceiling at (${r.ceiling.x}, ${r.ceiling.y}): ${r.ceiling.codes} codes`);
  }
  return found;
}
/** Whether the fixture tells two modes apart: they differ past one code on at least 10% of its pixels. */
function apart(input: BlendInput, a: Eleven | 'normal', b: Eleven): number {
  let n = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const bg = fx(input.backdrop, x, y); const s = fx(input.source, x, y);
    const pa = a === 'normal' ? over(s, bg) : pick(a, bg, s, x, y);
    if (codes(pa, pick(b, bg, s, x, y)) > 1) n++;
  }
  return n / (W * H);
}

describe(`${ID} the eleven modes and the dancing dissolve`, () => {
  it(`${ID} each of the eleven within one 10-bit code value of its CPU reference on 99.9% of pixels, on inputs held to independent draws`, () => {
    // The reference reproduces the formulas' stated numbers and their published identities before it judges anything.
    for (const [m, b, s, want] of STATED) expect(formula(m, [b, b, b], [s, s, s])[0], `${m}(${b}, ${s})`).toBeCloseTo(want, 12);
    for (let i = 1; i < 16; i++) for (let j = 1; j < 16; j++) {
      const b = i / 16; const s = j / 16; const v = (m: (typeof FORMULA_MODES)[number]): number => formula(m, [b, b, b], [s, s, s])[0];
      expect(v('hard_mix'), `hard mix is vivid light thresholded (${b}, ${s})`).toBe(v('vivid_light') < 0.5 ? 0 : 1);
    }
    const dark: Rgb = [0.2, 0.2, 0.2]; const light: Rgb = [0.9, 0.1, 0.8];
    expect(lum(dark) < lum(light), 'the Lum the two color modes compare').toBe(true);
    expect(formula('darker_color', light, dark), 'darker color keeps the whole darker color').toEqual(dark);
    expect(formula('lighter_color', light, dark), 'lighter color keeps the whole lighter color').toEqual(light);
    expect(blend('subtract', [0.25, 0.25, 0.25, 0.5], [0.3, 0.3, 0.3, 0.6])[3], 'the general form\'s alpha').toBeCloseTo(0.8, 12);

    requireMetal();
    const d = draw();
    none(inputProblems(d), 'the inputs the renderer composites');
    // The figure tells every mode from normal and from every other mode.
    const input = d.outputs.get('divide')!.input;
    const blind: string[] = [];
    for (const [i, a] of ELEVEN.entries()) {
      if (apart(input, 'normal', a) < 0.1) blind.push(`${a} from normal`);
      for (const b of ELEVEN.slice(i + 1)) if (apart(input, a, b) < 0.1) blind.push(`${a} from ${b}`);
    }
    none(blind, 'the fixture tells these apart on under 10% of its pixels');
    let kept = 0; let inside = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (inBox(SOURCE_BOX, x, y)) { inside++; if (keeps(SEED, x, y, MIX.opacity)) kept++; }
    expect(Math.abs(kept / inside - MIX.opacity), 'the reference\'s dissolve keeps the group\'s opacity of its pixels').toBeLessThan(0.02);
    none(modeProblems(d), 'each mode against its reference');
  }, 1_800_000);

  it(`${ID} a dancing dissolve sought in a fresh process equals the played frame by pixel hash; its pixels are the reference's at ⌊t × frame_rate⌋; with dancing off it holds still`, () => {
    requireMetal();
    const out = dir();
    const film = (doc: JsonObject, from: number, frames: number): JsonObject => ({ call: 'film2d', doc, look: FILM_LOOK, fps: 60, from, frames, hash: true });
    const dance = danceDoc(true);
    const [played] = runGpu(bin(), out, [film(dance, 0, 91)]);
    const [again] = runGpu(bin(), out, [film(dance, 0, 91)]);
    const [sought] = runGpu(bin(), out, [film(dance, 90, 1)]);
    expect(hashAt(sought!, 90, 'sought to 90'), 'the seek to frame 90 equals the play to frame 90').toBe(hashAt(played!, 90, 'played'));
    expect(hashAt(again!, 90, 'played again'), 'two plays agree at frame 90').toBe(hashAt(played!, 90, 'played'));
    expect(hashAt(played!, 30, 'played'), 'the dissolve dances: frame 30 isn\'t frame 90').not.toBe(hashAt(played!, 90, 'played'));
    expect(hashAt(played!, 90, 'played'), 'the dissolve dances: frame 89 isn\'t frame 90').not.toBe(hashAt(played!, 89, 'played'));

    const [still] = runGpu(bin(), out, [film(danceDoc(false), 0, 91)]);
    expect(hashAt(still!, 30, 'the still dissolve'), 'with dancing off, playback moves nothing').toBe(hashAt(still!, 90, 'the still dissolve'));

    // Half way through frame 90: ⌊t × frame_rate⌋ is 90, not the session's count and not t itself.
    const [mid] = runGpu(bin(), out, [layersCall(dance, FILM_LOOK, { float: true, t: flickOf(90.5) })]);
    const main = layerOf(readLayers(out, answered(mid!, 'frame 90.5'), MIX.size, 'frame 90.5'), 'main', 'frame 90.5');
    expect(main.inputs.length, 'one dissolved group').toBe(1);
    const r = compare('dissolve', floatsOf(main, 'frame 90.5'), main.inputs[0]!, 90);
    expect(r.share, `the dancing dissolve at frame 90 against its reference: worst ${r.worst}`).toBeGreaterThanOrEqual(SHARE);
  }, 1_800_000);

  it(`${ID} planted: a wrong formula fails naming its mode, and a dissolve that reads playback state differs from the play when sought`, () => {
    requireMetal();
    const d = draw('vivid_light_as_linear_light');
    failsNaming(modeProblems(d), ['vivid_light'], 'vivid_light_as_linear_light');
    const out = dir();
    const dance = danceDoc(true);
    const call = (from: number, frames: number): JsonObject => ({ call: 'film2d', doc: dance, look: FILM_LOOK, fps: 60, from, frames, hash: true });
    const [played] = runGpu(bin(), out, [call(0, 91)], 'dissolve_reads_playback');
    const [sought] = runGpu(bin(), out, [call(90, 1)], 'dissolve_reads_playback');
    expect(hashAt(sought!, 90, 'sought under the plant'), 'a dissolve that reads playback state can\'t equal the play when sought').not.toBe(hashAt(played!, 90, 'played under the plant'));
  }, 1_800_000);
});
