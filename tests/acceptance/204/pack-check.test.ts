// AC4 #204.9195397b: "A pack preset with a feedback edge and no delay is refused at pack check, naming the edge; one
// naming a node outside the list is refused, naming the node; and one whose cost at defaults is twice its estimate is
// refused, naming the preset"
//
// AC10 #204.f87a60ba: "A fixture preset whose delay feedback gain has range [0, 1.05] and default 0.5 passes at its
// default and is refused at its maximum, naming the preset, the param, 1.05 and the first sample over 4.0; with the
// range cut to [0, 0.95] it passes the whole sweep"
//
// Through `install_pack` (#306), which runs the pack check once per version (Synth `synth@1`, As built: "Pack check",
// refusing at `presets/<name>@<major>`). Each wrong preset is its pack's only preset, so a refusal can only be its own;
// the same three presets made right install from one pack, so a check that refuses everything fails. A refusal is
// read from the reply's issues: an issue whose path is under `presets/<name>@1`, whose text (its path, `actual` and
// `what`, as JSON) names what the criterion says it names.
//
// AC10's preset `ring@1`: a 1 kHz square gated by an envelope that opens at 1 and falls to 0 over 10 ms, summed with
// its own echo, a 50 ms delay (2,400 samples) through the gain `regen`. At regen 1.05 the n-th echo is 1.05^n times the
// burst, whose largest sample is its first; 1.05^28 = 3.92 and 1.05^29 = 4.12, so the first sample over 4.0 is the
// 29th echo's first, sample 29 × 2,400 = 69,600 (69,601 if the envelope's first sample is its rising edge). At 0.95
// the echoes only fall, so the sweep's renders stay at 1.
import { describe, expect, it } from 'vitest';
import {
  AC, TIMEOUT, biquad, delay, env, gain, installCall, installOf, installed, mix, osc, runShow, show, useShow, useTemp, writePack, type JsonObject, type Preset,
} from './helpers.ts';

const bin = useShow();
const temp = useTemp();

/** A sine summed with itself through a gain of 0.5: a cycle sum → loop → sum with no delay. Cost: 4 + 2 + 1. */
const HOWL: Preset = {
  nodes: { tone: osc('sine', 220), sum: mix(), loop: gain(0.5) },
  edges: [['tone', 'sum', 'in'], ['sum', 'loop', 'in'], ['loop', 'sum', 'in']],
  out: 'sum', params: {}, cost: 7,
};
/** The same cycle through a 10 ms delay (480 samples, more than a block). Cost: 4 + 2 + 3 + 1. */
const HOWL_FIXED: Preset = {
  nodes: { tone: osc('sine', 220), sum: mix(), echo: delay(0.01, 0, 1), loop: gain(0.5) },
  edges: [['tone', 'sum', 'in'], ['sum', 'echo', 'in'], ['echo', 'loop', 'in'], ['loop', 'sum', 'in']],
  out: 'sum', params: {}, cost: 10,
};
/** A node outside the closed list. */
const WOBBLE: Preset = {
  nodes: { tone: osc('sine', 220), grains: { kind: 'granular', size: 0.05 }, level: gain(0.5) },
  edges: [['tone', 'grains', 'in'], ['grains', 'level', 'in']],
  out: 'level', params: {}, cost: 10,
};
const WOBBLE_FIXED: Preset = { ...WOBBLE, nodes: { tone: osc('sine', 220), grains: biquad('lowpass', 2000, 0.707), level: gain(0.5) } };
/** A saw through four lowpasses: 4 + 4 × 5 = 24 at defaults, stated as 12. */
const HEAVY: Preset = {
  nodes: { tone: osc('saw', 110), f1: biquad('lowpass', 4000, 0.707), f2: biquad('lowpass', 3000, 0.707), f3: biquad('lowpass', 2000, 0.707), f4: biquad('lowpass', 1500, 0.707) },
  edges: [['tone', 'f1', 'in'], ['f1', 'f2', 'in'], ['f2', 'f3', 'in'], ['f3', 'f4', 'in']],
  out: 'f4', params: {}, cost: 12,
};
const HEAVY_FIXED: Preset = { ...HEAVY, cost: 24 };

/** AC10's preset, with `regen`'s range. Cost: osc 4 + env 2 + gain 1 + mix 2 + delay 3 + gain 1. */
const ring = (high: number): Preset => ({
  nodes: { tone: osc('square', 1000), burst: env(0, 0, 0.01, 0, 0), hit: gain(0), sum: mix(), echo: delay(0.05, 0, 1), loop: gain('regen') },
  edges: [['tone', 'hit', 'in'], ['burst', 'hit', 'gain'], ['hit', 'sum', 'in'], ['sum', 'echo', 'in'], ['echo', 'loop', 'in'], ['loop', 'sum', 'in']],
  out: 'sum',
  params: { regen: { unit: 'fraction', range: [0, high], default: 0.5 } },
  cost: 13,
});

/** Installs each pack in one scenario; their replies. */
function install(packs: { name: string; presets: Record<string, Preset> }[], what: string): JsonObject[] {
  const root = temp();
  const fixtures = packs.map((p) => writePack(root, p.name, p.presets));
  return runShow(bin(), { evidence: temp(), calls: fixtures.map((p) => installCall(p)) }, what);
}
/** The issues of a refused install under `presets/<preset>`, as text. */
function refusals(reply: JsonObject | undefined, preset: string, what: string): string[] {
  const r = installOf(reply, what);
  expect(r.outcome, `${what}: the pack check refuses it; got ${show(reply, 1500)}`).toBe('refused');
  const mine = r.issues.filter((i) => typeof i['path'] === 'string' && (i['path'] === `presets/${preset}` || i['path'].startsWith(`presets/${preset}/`)));
  expect(mine.length > 0, `${what}: an issue sits at presets/${preset}; got ${show(r.issues, 1500)}`).toBe(true);
  return mine.map((i) => JSON.stringify({ path: i['path'], actual: i['actual'] ?? null, what: i['what'] ?? null }));
}
const edgeNamed = (text: string, edges: { index: number; edge: [string, string, string] }[]): boolean =>
  edges.some(({ index, edge }) => text.includes(JSON.stringify(edge)) || text.includes(`presets/howl@1/edges/${index}`));

describe(`${AC[4]} the pack check refuses a feedback edge with no delay, a node outside the list and a cost over its estimate`, () => {
  it(`${AC[4]} \`howl@1\` (sum → loop → sum, no delay) is refused naming an edge of the cycle, \`wobble@1\` naming the node \`grains\`, \`heavy@1\` (24 at defaults against 12) naming the preset; the three made right install`, () => {
    const [howl, wobble, heavy, fixed] = install([
      { name: 'howl', presets: { howl: HOWL } },
      { name: 'wobble', presets: { wobble: WOBBLE } },
      { name: 'heavy', presets: { heavy: HEAVY } },
      { name: 'fixed', presets: { howl: HOWL_FIXED, wobble: WOBBLE_FIXED, heavy: HEAVY_FIXED } },
    ], 'four packs offered');
    const f: string[] = [];
    const cycle = [{ index: 1, edge: ['sum', 'loop', 'in'] as [string, string, string] }, { index: 2, edge: ['loop', 'sum', 'in'] as [string, string, string] }];
    const h = refusals(howl, 'howl@1', 'the pack howl');
    if (!h.some((t) => edgeNamed(t, cycle))) f.push(`howl@1 is refused without naming an edge of its cycle, [sum, loop, in] or [loop, sum, in]: ${h.join(' ')}`);
    const w = refusals(wobble, 'wobble@1', 'the pack wobble');
    if (!w.some((t) => t.includes('grains'))) f.push(`wobble@1 is refused without naming the node \`grains\`: ${w.join(' ')}`);
    const c = refusals(heavy, 'heavy@1', 'the pack heavy');
    if (!c.some((t) => t.includes('heavy@1') && (/cost/i.test(t) || (/\b24\b/.test(t) && /\b12\b/.test(t))))) f.push(`heavy@1 is refused without naming the preset and its cost (24 at defaults against its estimate of 12): ${c.join(' ')}`);
    installed(fixed, 'the pack fixed (the three presets made right)');
    expect(f, 'each wrong preset is refused at pack check, naming what is wrong').toEqual([]);
  }, TIMEOUT);
});

describe(`${AC[10]} the pack check's sweep refuses a render over 4.0, naming the preset, the param, the value and the first sample`, () => {
  it(`${AC[10]} \`ring@1\` with regen in [0, 1.05], default 0.5, passes at its default and is refused at 1.05, naming the preset, \`regen\`, 1.05 and sample 69,600; cut to [0, 0.95] it passes the whole sweep`, () => {
    const [hot, safe] = install([{ name: 'regenhot', presets: { ring: ring(1.05) } }, { name: 'regensafe', presets: { ring: ring(0.95) } }], 'the ring preset at two ranges');
    const t = refusals(hot, 'ring@1', 'the pack regenhot');
    const f: string[] = [];
    const named = t.find((x) => x.includes('regen') && x.includes('1.05'));
    if (!named) f.push(`ring@1 is refused without naming the param \`regen\` at 1.05 (the default 0.5 must pass, so the refused render is the maximum's): ${t.join(' ')}`);
    else {
      if (!/\b6960[01]\b/.test(named)) f.push(`ring@1's refusal doesn't name the first sample over 4.0, sample 69,600 (or 69,601): ${named}`);
      if (/"all"/.test(named)) f.push(`ring@1's refusal names a seeded point (all), not the maximum of \`regen\`: ${named}`);
    }
    if (!t.some((x) => x.includes('ring@1'))) f.push(`ring@1's refusal doesn't name the preset: ${t.join(' ')}`);
    installed(safe, 'the pack regensafe (regen cut to [0, 0.95])');
    expect(f, 'the sweep refuses ring@1 at regen 1.05, naming the preset, the param, the value and the first sample').toEqual([]);
  }, TIMEOUT);
});
