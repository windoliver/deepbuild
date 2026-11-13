// AC11 #204.2ade263b: "Each node that is not a source (biquad, shaper, crush, delay, gain and mix), fed 1 s of silence
// from its reset state, writes samples that are exactly 0; a planted shaper with a bias of 0.001 fails, naming the
// node"
//
// Through `media_mix` (README: The surface under test). The pack `quiet` holds, for each of the six nodes, a preset whose
// only node is that node with no edge into it ("A node with no edge into it reads silence on `in`"), its out that
// node; and a preset `<node>_fed` where a 440 Hz sine feeds the same node, so the strips are shown to sound when fed.
// One document plays each silent preset as its own strip for 1 s, from a fresh voice (its reset state), one after
// another with 0.5 s between, then each fed one. Every master sample in a silent strip's second must be exactly 0
// (−0 counts as 0); each fed strip's second must not be silent. A failure names the node. The planted `shaper_bias`
// adds 0.001 to the shaper's output: the failure names `shaper`, and only it.
import { describe, expect, it } from 'vitest';
import {
  AC, RATE, TIMEOUT, biquad, delay, gain, mediaDoc, mix, mixes, osc, pcmOf, peak, presetOf, sampleAt, secs, synthStrip, useShow, useTemp, writePack,
  type Node, type Planted, type Preset,
} from './helpers.ts';

const bin = useShow();
const temp = useTemp();

/** Each non-source node at its fields, and its cost. */
const NODES: Record<string, { node: Node; cost: number }> = {
  biquad: { node: biquad('lowpass', 1000, 0.707), cost: 5 },
  shaper: { node: { kind: 'shaper' }, cost: 10 },
  crush: { node: { kind: 'crush', bits: 8, hold_hz: 0, mix: 1 }, cost: 2 },
  delay: { node: delay(0.01, 0, 1), cost: 3 },
  gain: { node: gain(0.5), cost: 1 },
  mix: { node: mix(), cost: 1 },
};
const NAMES = Object.keys(NODES);
const alone = (n: string): Preset => ({ nodes: { [n]: NODES[n]!.node }, edges: [], out: n, params: {}, cost: NODES[n]!.cost });
const fed = (n: string): Preset => ({ nodes: { src: osc('sine', 440), [n]: NODES[n]!.node }, edges: [['src', n, 'in']], out: n, params: {}, cost: 4 + NODES[n]!.cost });
const startOf = (k: number): number => secs(0.25 + 1.5 * k);

function render(planted?: Planted): { silent: string[]; quiet: string[] } {
  const root = temp();
  const evidence = temp();
  const presets: Record<string, Preset> = {};
  for (const n of NAMES) { presets[n] = alone(n); presets[`${n}_fed`] = fed(n); }
  const pack = writePack(root, 'quiet', presets);
  const strips: Record<string, ReturnType<typeof synthStrip>> = {};
  NAMES.forEach((n, k) => { strips[n] = synthStrip(k, { preset: presetOf(pack, n) }, startOf(k), secs(1)); });
  NAMES.forEach((n, k) => { strips[`${n}_fed`] = synthStrip(NAMES.length + k, { preset: presetOf(pack, `${n}_fed`) }, startOf(NAMES.length + k), secs(1)); });
  const end = startOf(2 * NAMES.length) + secs(0.5);
  const [m] = mixes(bin(), evidence, [pack], [{ doc: mediaDoc({ span: end, packs: [pack], strips }), segments: [{ from: 0, to: end, write: true }] }], 'each node fed silence, then fed a sine', planted);
  const p = pcmOf(evidence, m!.segments[0]!, RATE, 'the master');
  // A silent strip's second: every sample exactly 0. A fed strip's second, after its first 20 ms: not silent.
  const silent = NAMES.filter((_n, k) => {
    const a = sampleAt(startOf(k));
    for (const c of p.channels) for (let i = a; i < a + RATE; i++) if (c[i] !== 0) return true;
    return false;
  });
  const quiet = NAMES.filter((_n, k) => !(peak(p, sampleAt(startOf(NAMES.length + k) + secs(0.02)), sampleAt(startOf(NAMES.length + k) + secs(0.95))) > 0.01)).map((n) => `${n}_fed`);
  return { silent, quiet };
}

describe(`${AC[11]} a node that is not a source, fed silence from its reset state, writes exact zeros`, () => {
  it(`${AC[11]} biquad, shaper, crush, delay, gain and mix, each fed 1 s of silence from a fresh voice, write samples that are exactly 0, while each fed a sine sounds; a planted shaper with a bias of 0.001 fails, naming \`shaper\``, () => {
    const clean = render();
    expect(clean.quiet, 'each node fed a 440 Hz sine sounds, so its strip plays: the zeros are the node\'s, not a silent strip\'s').toEqual([]);
    expect(clean.silent, 'each node fed silence writes exactly 0 (the nodes listed write something else)').toEqual([]);

    // Wrong program: the shaper adds a bias of 0.001.
    const w = render('shaper_bias');
    expect(w.silent, 'planted shaper_bias fails, naming the node `shaper` and no other').toEqual(['shaper']);
  }, TIMEOUT);
});
