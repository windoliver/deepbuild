// AC4 #167.662f5a55: "A scale whose domain follows the periods spans [0, 30] at 2000 and [0, 40] at 2001, and its tick
// at 40 is at opacity 0 at 2000 and fully shown at 2001"
//
// AC1's bars on a y scale with `domain: "periods"` and the defaults (nice on, zero always true for bars), with an axis
// over it. `geometry` of the scale answers its `domain` at t and of the axis its `ticks`, `{value, opacity}`, listed
// over every period's domain. The oracle page ports d3-scale 83555bd759 test/linear-test.js: its nice rule and 1-2-5
// steps, computed here, give the issue's spans. Following the periods and fading by opacity are ours: "ticks enter and
// leave by opacity", so across the frames tick 40 passes through a value between 0 and 1 and never falls back.
import { describe, expect, it } from 'vitest';
import { AC, LOOK, TIMEOUT, arr, fl, frames60, geometryAt, growingDoc, niceDomain, num, obj, passes, useRender, type JsonValue } from './helpers.ts';

const render = useRender();
const ID = AC[4];
const doc = growingDoc();

const domainOf = (a: JsonValue | undefined, what: string): number[] => arr(obj(a, what)['domain'], `${what}: domain`).map((v) => num(v, `${what}: domain`));
interface Tick { value: number; opacity: number }
const ticksOf = (a: JsonValue | undefined, what: string): Tick[] => arr(obj(a, what)['ticks'], `${what}: ticks`).map((t, i) => {
  const o = obj(t, `${what}: ticks[${i}]`);
  return { value: num(o['value'], `${what}: ticks[${i}].value`), opacity: num(o['opacity'], `${what}: ticks[${i}].opacity`) };
});
const tick40 = (ticks: Tick[], what: string): Tick => {
  const found = ticks.filter((t) => t.value === 40);
  expect(found.length, `${what}: the axis lists its tick at 40 once: ${JSON.stringify(ticks)}`).toBe(1);
  return found[0]!;
};

describe(`${ID} a scale's domain follows the periods and its ticks enter by opacity`, () => {
  it(`${ID} (domain) the scale spans [0, 30] at 2000 and [0, 40] at 2001`, () => {
    expect([niceDomain([0, 30], 10), niceDomain([0, 40], 10)], 'd3\'s nice rule leaves both spans alone').toEqual([[0, 30], [0, 40]]);
    const bin = render();
    passes(bin, doc, LOOK, 'the chart');
    const [at0, at1] = geometryAt(bin, doc, 'grows', [0, fl(1)], LOOK);
    expect(domainOf(at0, 'the scale at 2000'), 'the domain at 2000').toEqual([0, 30]);
    expect(domainOf(at1, 'the scale at 2001'), 'the domain at 2001').toEqual([0, 40]);
  }, TIMEOUT);

  it(`${ID} (ticks) the tick at 40 is at opacity 0 at 2000, fully shown at 2001, and enters by opacity`, () => {
    const ticks = geometryAt(render(), doc, 'axis', frames60(1), LOOK).map((a, i) => ticksOf(a, `the axis, frame ${i}`));
    const forty = ticks.map((t, i) => tick40(t, `frame ${i}`).opacity);
    expect(forty[0], 'the tick at 40 at 2000').toBe(0);
    expect(forty.at(-1), 'the tick at 40 at 2001').toBe(1);
    expect(forty.filter((o) => o > 0 && o < 1).length, `the tick enters by opacity, not at one frame: ${forty.join(' ')}`).toBeGreaterThan(0);
    forty.slice(1).forEach((o, i) => expect(o, `the tick never fades back, frame ${i + 1}`).toBeGreaterThanOrEqual(forty[i]! - 1e-6));
    for (const [what, list] of [['2000', ticks[0]!], ['2001', ticks.at(-1)!]] as const) {
      const shown = list.filter((t) => t.opacity === 1).map((t) => t.value).sort((a, b) => a - b);
      expect(shown.length, `${what}: the axis shows ticks`).toBeGreaterThan(1);
      const step = shown[1]! - shown[0]!;
      expect(step / 10 ** Math.floor(Math.log10(step)), `${what}: ticks fall on 1, 2 and 5 × 10^k: ${shown.join(' ')}`).toSatisfy((m: number) => [1, 2, 5].includes(m));
      expect(shown.every((v) => v % step === 0), `${what}: every tick is on the step: ${shown.join(' ')}`).toBe(true);
    }
  }, TIMEOUT);
});
