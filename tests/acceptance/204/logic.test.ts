// AC3 #204.0e49d0c7: "A logic item that steps a gain param from 0 to 1 at step 120 of 60 Hz gives, live and in the
// bake, a ramp inside the block that holds that step's time and full gain from the next block on; a planted synth that
// reads logic arrays once a frame starts the ramp late and fails, naming the block"
//
// The logic item `fader` (60 Hz; its program, WebAssembly written by hand in helpers.ts, writes the f64 `gain`: 0
// before step 120, 1 from it) and the synth strip `tone`, playing `faders.gated@1` (a square at 375 Hz, so every sample
// is ±1, times the param `level`, times 0.25) with `level: "fader.gain"`. Step 120 is at 2 s, sample 96,000, the first
// sample of block 750 (Synth `synth@1`, As built, the block rule: "A step that lands exactly on a block's first sample
// ramps inside that block and is whole from the next"). So |x(n)| ÷ A, A the full-gain level, is 0 before block 750,
// (n − 96,000) ÷ 128 inside it, and 1 from block 751 on. In the bake: `media_mix` of the document (its logic baked over
// the transport's span, #544). Live: the document opened in a panel, played on your press, read back by `handed`
// (#499). A failure names the first block whose samples leave that curve; the planted `synth_reads_logic_per_frame`
// must fail naming block 750 in both.
import { describe, expect, it } from 'vitest';
import {
  AC, BLOCK, CLICK_UP, Driver, MS, RATE, SEC, TIMEOUT, click, faderItem, gain, handed, handedOf, installCall, installed, mediaDoc, mixes, none, openMedia,
  opened, osc, pcmOf, play, playing, presetOf, secs, serialOf, synthStrip, useShow, useTemp, writePack, type PackFixture, type Pcm, type Planted, type Preset,
} from './helpers.ts';

const bin = useShow();
const temp = useTemp();

/** A square at 375 Hz (128 samples a cycle), times `level`, times 0.25; cost: osc 4 + gain 1 + gain 1. */
const GATED: Preset = {
  nodes: { tone: osc('square', 375), amp: gain('level'), trim: gain(0.25) },
  edges: [['tone', 'amp', 'in'], ['amp', 'trim', 'in']],
  out: 'trim',
  params: { level: { unit: 'amplitude', range: [0, 1], default: 0 } },
  cost: 6,
};
const STEP_BLOCK = 750; // 2 s × 48,000 ÷ 128
const STEP_SAMPLE = STEP_BLOCK * BLOCK;

function doc(evidence: string, pack: PackFixture) {
  const { items, assets } = faderItem(evidence);
  return mediaDoc({
    span: secs(4), packs: [pack],
    strips: { tone: synthStrip(0, { preset: presetOf(pack, 'gated'), params: { level: 'fader.gain' } }, 0, secs(4)) },
    extra: { items, assets },
  });
}

/** The gain curve the block rule gives sample n. */
const expected = (n: number): number => (n < STEP_SAMPLE ? 0 : n < STEP_SAMPLE + BLOCK ? (n - STEP_SAMPLE) / BLOCK : 1);

/** What is wrong with a render: each line names where it was heard and the first block that leaves the curve. */
function judge(p: Pcm, where: string): string[] {
  const c = p.channels[0]!;
  const level = [...c.subarray(Math.round(2.5 * RATE), Math.round(3.5 * RATE))].map(Math.abs).sort((a, b) => a - b);
  const A = level[level.length >> 1]!;
  if (!(A > 0.01)) return [`${where}: the tone is silent at full gain (level ${A} over 2.5–3.5 s), so the curve can't be read`];
  for (let n = 0; n < Math.round(3.9 * RATE); n++) {
    const want = A * expected(n);
    if (Math.abs(Math.abs(c[n]!) - want) > 1e-4 * A) {
      const b = Math.floor(n / BLOCK);
      return [`${where}: block ${b} (samples ${b * BLOCK} to ${b * BLOCK + BLOCK - 1}) leaves the block rule's curve first, at sample ${n}: |x| ÷ A is ${(Math.abs(c[n]!) / A).toFixed(6)}, not ${expected(n).toFixed(6)}`];
    }
  }
  return [];
}

function bake(planted?: Planted): Pcm {
  const root = temp();
  const evidence = temp();
  const pack = writePack(root, 'faders', { gated: GATED });
  const [m] = mixes(bin(), evidence, [pack], [{ doc: doc(evidence, pack), segments: [{ from: 0, to: secs(4), write: true }] }], 'the fader document in the bake', planted);
  return pcmOf(evidence, m!.segments[0]!, RATE, 'the bake\'s 0 to 4 s');
}

function live(planted?: Planted): Pcm {
  const root = temp();
  const evidence = temp();
  const pack = writePack(root, 'faders', { gated: GATED });
  const d = new Driver(bin(), { evidence, ...(planted ? { planted } : {}) });
  const [inst, open, press] = d.step([installCall(pack, MS), openMedia(10 * MS, 'fader-doc', doc(evidence, pack)), ...click(SEC)], 'the fader document opened in the panel');
  installed(inst, 'the pack faders');
  expect(opened(open), `the fader document opens in the panel: ${JSON.stringify(open).slice(0, 400)}`).toBe(true);
  const [pressed, got] = d.step([play(SEC + CLICK_UP, { serial: serialOf(press, 'your click') }), handed(secs(6), 0, secs(4))], 'Play pressed, 4 s played live');
  expect(playing(pressed), `your press of Play plays the fader document: ${JSON.stringify(pressed).slice(0, 400)}`).toBe(true);
  const h = handedOf(got, 0, secs(4), 'what the live transport handed the gate');
  return pcmOf(evidence, h, RATE, 'the live 0 to 4 s');
}

describe(`${AC[3]} a logic step reaches the sound within one block, live and in the bake`, () => {
  it(`${AC[3]} a logic item stepping a gain param from 0 to 1 at step 120 of 60 Hz ramps the tone inside block 750, which holds 2 s, and holds full gain from block 751 on, in the bake and live`, () => {
    none([...judge(bake(), 'in the bake'), ...judge(live(), 'live')], 'the gain step ramps inside its block');
  }, TIMEOUT);

  it(`${AC[3]} a planted synth that reads logic arrays once a frame starts the ramp late and fails, naming block 750, in the bake and live`, () => {
    const f = [...judge(bake('synth_reads_logic_per_frame'), 'in the bake'), ...judge(live('synth_reads_logic_per_frame'), 'live')];
    expect(f.length, `planted synth_reads_logic_per_frame fails in the bake and live; got ${JSON.stringify(f)}`).toBe(2);
    for (const x of f) expect(x, 'planted synth_reads_logic_per_frame fails naming block 750').toMatch(/: block 750 \(/);
  }, TIMEOUT);
});
