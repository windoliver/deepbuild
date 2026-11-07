// AC2 #496.7f7f12df: Each range shape (square, ramp, ramp down, triangle, round, smooth) with ease high and low matches
// the Lottie range-selector formulas its oracle page names, at each unit of a 10-unit text with start 20% and end 70%,
// within 1e-6, the expected amounts listed in the fixture's sidecar from that source; a planted triangle that peaks at
// the range's start fails, and a noise selector at 2 Hz gives the same amounts per unit whether a film is played or
// seeked.
//
// #496 has no oracle page (doneright/oracles/issues/496.md doesn't exist), so the formulas are lottie-web's
// TextSelectorProperty.js at a pinned commit (README: The surface under test, Choices). fixtures/range-shapes.film is
// the 10-unit text; fixtures/range-shapes.expected.json, its sidecar, lists each shape × ease case's amount per unit,
// written by lottie-reference.mjs from those formulas. The amounts are read from `texts.word.coverage`, the animator's
// selection per unit before its props, in f64. The noise film is drawn frame by frame at 60 fps in one process (played)
// and at the same times in a seeded order in a fresh process (seeked); each frame's amounts must be the same bits, and
// a guard asks that they move over time and differ across units, so a constant can't pass.
import { describe, expect, it } from 'vitest';
import {
  AC, LOOK, TIMEOUT, clone, coverageOf, drawn, failsNaming, film, fixture, frames60, none, raster, run, shuffled, textItem, textOf, useRender,
  type JsonObject, type JsonValue,
} from './helpers.ts';

const render = useRender();

interface Case { shape: string; ease: { high: number; low: number }; amounts: number[] }
const SIDECAR = fixture('range-shapes.expected.json');
const CASES = (SIDECAR['cases'] as JsonValue[]).map((c) => c as unknown as Case);
const FILM = fixture('range-shapes.film');

const docOf = (c: Case): JsonObject => {
  const doc = clone(FILM);
  const animator = ((((doc['items'] as JsonObject)['word'] as JsonObject)['params'] as JsonObject)['animators'] as JsonObject[])[0]!;
  animator['shape'] = c.shape;
  animator['ease'] = { high: c.ease.high, low: c.ease.low };
  return doc;
};

/** Every case drawn at t = 0 in one process; each case's amounts against the sidecar's, within 1e-6. */
function shapeFailures(cases: Case[], planted?: string): string[] {
  const b = render;
  const png = `${b.out()}/shape.png`;
  const answers = drawn(run(b.bin(), 'raster', cases.map((c) => ({ out: png, doc: docOf(c), look: LOOK, t: 0, ...(planted ? { planted } : {}) }))), 'the range shapes');
  const failures: string[] = [];
  answers.forEach((a, k) => {
    const c = cases[k]!;
    const at = `${c.shape}, ease high ${c.ease.high} low ${c.ease.low}`;
    const got = coverageOf(textOf(a, 'word', at), 0, at);
    if (got.length !== c.amounts.length) { failures.push(`${at}: ${got.length} units, not ${c.amounts.length}`); return; }
    c.amounts.forEach((want, i) => { if (!(Math.abs(got[i]! - want) <= 1e-6)) failures.push(`${at}: unit ${i} has amount ${got[i]}, Lottie's is ${want}`); });
  });
  return failures;
}

describe(`${AC[2]} range shapes against Lottie's formulas, a planted triangle, and a noise selector played and seeked`, () => {
  it(`${AC[2]} each of the six shapes with four eases (high and low) gives Lottie's amount at each of the 10 units, start 20%, end 70%, within 1e-6`, () => {
    expect(CASES.length, 'the sidecar lists six shapes with four eases each').toBe(24);
    expect(new Set(CASES.map((c) => c.shape)), 'the sidecar covers every shape').toEqual(new Set(['square', 'ramp', 'ramp_down', 'triangle', 'round', 'smooth']));
    none(shapeFailures(CASES), 'the amounts per unit match the sidecar');
  }, TIMEOUT);

  it(`${AC[2]} a planted triangle that peaks at the range's start fails the same comparison`, () => {
    failsNaming(shapeFailures(CASES.filter((c) => c.shape === 'triangle'), 'triangle_peaks_at_start'), ['triangle'], 'triangle_peaks_at_start');
  }, TIMEOUT);

  it(`${AC[2]} a noise selector at 2 Hz gives each unit the same amount at every 60 fps frame of 2 s whether the film is played or seeked`, () => {
    const b = render;
    const noisy = film('noise', [textItem('word', {
      text: 'ABCDEFGHIJ', size: 48,
      animators: [{
        units: 'grapheme', range: { from: 0, to: 1 }, shape: 'square', mode: 'add', props: { y: 24 },
        selectors: [{ noise: { min: 0, max: 1, frequency: 2, seed: 7 }, mode: 'multiply' }],
      }],
    })], {}, '2s');
    const times = frames60(2);
    const played = drawn(raster(b, noisy, times.map((t) => ({ t }))), 'the noise film played').map((a, k) => coverageOf(textOf(a, 'word', `played frame ${k}`), 0, `played frame ${k}`));
    const order = shuffled(times.map((_, k) => k), 496);
    const seeked = drawn(raster(b, noisy, order.map((k) => ({ t: times[k]! }))), 'the noise film seeked');
    const failures: string[] = [];
    seeked.forEach((a, j) => {
      const k = order[j]!;
      const got = coverageOf(textOf(a, 'word', `seeked frame ${k}`), 0, `seeked frame ${k}`);
      const want = played[k]!;
      if (got.length !== want.length || got.some((v, i) => !Object.is(v, want[i]))) failures.push(`frame ${k} (${times[k]} flicks): seeked ${JSON.stringify(got)}, played ${JSON.stringify(want)}`);
    });
    none(failures, 'seeking gives the amounts playing does, bit for bit');
    const units = played[0]!.length;
    expect(units, 'the noise selector covers the 10 units').toBe(10);
    const moves = Array.from({ length: units }, (_, i) => Math.max(...played.map((f) => f[i]!)) - Math.min(...played.map((f) => f[i]!)));
    expect(Math.max(...moves), 'the noise moves each unit over time (a constant passes nothing)').toBeGreaterThan(1e-3);
    expect(played.some((f) => Math.max(...f) - Math.min(...f) > 1e-3), 'the units differ from each other in some frame').toBe(true);
  }, TIMEOUT);
});
