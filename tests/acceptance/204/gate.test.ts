// AC5 #204.5aacbddd: "A synth strip in a panel with no gesture stays silent; after the gesture it plays through the
// master's limiter, which holds −1 dBTP on a preset driven to clip; a planted synth routed around the master fails the
// device gate's test, naming the strip"
//
// The panel world of #498's gate and #499's live transport (README: The surface under test). The document: an asset
// strip `bed` (a full-scale 1 kHz sine, +6 dB, from 0.2 s to 1.2 s) and the synth strip `hot` (`hots.hot@1`, a 220 Hz
// sine times the param `drive`, 3 at its default: +9.5 dBFS, driven to clip) from 1.5 s for 1 s. Before your gesture
// the panel's own request to play and the agent's are refused, the gate is `suspended` with no grant, and the live
// transport has handed the gate nothing (`handed` answers no PCM). After your press of Play the gate runs on its
// serial, and what the live transport handed the gate over [0, 3 s) is read back: each strip's window, written as its
// own float WAV, baked as loudness at 4× (#500's meter), must read at most −1.0 dBTP, and above −6 dBTP, so it sounds
// and is held at the limiter's ceiling. The planted `synth_bypasses_master` sends the synth's voices around the master:
// the first window over −1.0 dBTP must be `hot`'s, and `bed` stays held.
import { describe, expect, it } from 'vitest';
import {
  AC, AGENT, CLICK_UP, Driver, MS, RATE, SEC, TIMEOUT, assetStrip, bakeCall, click, fmt, gain, gateCall, gateOf, handed, handedOf, installCall, installed,
  isObject, mediaDoc, openMedia, opened, osc, pcmOf, play, playing, presetOf, putSignal, runShow, sampleAt, secs, serialOf, sine, slice, synthStrip,
  truePeakOf, useShow, useTemp, writePack, type Planted, type Preset,
} from './helpers.ts';

const bin = useShow();
const temp = useTemp();

/** A 220 Hz sine times `drive`, 3 by default; cost: osc 4 + gain 1. */
const HOT: Preset = {
  nodes: { tone: osc('sine', 220), drive: gain('drive') },
  edges: [['tone', 'drive', 'in']],
  out: 'drive',
  params: { drive: { unit: 'amplitude', range: [0, 3], default: 3 } },
  cost: 5,
};
const CEILING = -1.0;
/** Each strip's window in the document, in time order, with room for its edges. */
const WINDOWS: { strip: string; from: number; to: number }[] = [
  { strip: 'bed', from: secs(0.19), to: secs(1.25) },
  { strip: 'hot', from: secs(1.49), to: secs(2.55) },
];

interface Heard { before: string[]; peaks: { strip: string; dbtp: number }[] }
function world(planted?: Planted): Heard {
  const root = temp();
  const evidence = temp();
  const pack = writePack(root, 'hots', { hot: HOT });
  const tone = sine(1000, RATE, 1);
  const media = mediaDoc({
    span: secs(3), packs: [pack],
    strips: {
      bed: assetStrip(0, putSignal(evidence, [tone, tone]), secs(0.2), { gain: 6 }),
      hot: synthStrip(1, { preset: presetOf(pack, 'hot') }, secs(1.5), secs(1)),
    },
  });
  const d = new Driver(bin(), { evidence, ...(planted ? { planted } : {}) });
  const before: string[] = [];
  const [inst, open, own, agent, g0, h0, press] = d.step([
    installCall(pack, MS), openMedia(10 * MS, 'hot-doc', media), play(300 * MS, 'panel'), play(400 * MS, { session: AGENT }), gateCall(500 * MS),
    handed(600 * MS, 0, secs(0.5)), ...click(SEC),
  ], 'the document opened in the panel, before your gesture');
  installed(inst, 'the pack hots');
  expect(opened(open), `the document opens in the panel: ${JSON.stringify(open).slice(0, 400)}`).toBe(true);
  if (playing(own)) before.push(`the panel's own request to play started it with no gesture: ${JSON.stringify(own)}`);
  if (playing(agent)) before.push(`the agent's request to play started it: ${JSON.stringify(agent)}`);
  const gate0 = gateOf(g0, 'the gate before your gesture');
  if (gate0.state !== 'suspended' || gate0.granted_by !== null) before.push(`before your gesture the gate is ${gate0.state}, granted by ${gate0.granted_by}, not suspended with no grant`);
  if (isObject(h0) && isObject(h0['handed'])) before.push(`before your gesture the live transport handed the gate PCM: ${JSON.stringify(h0).slice(0, 300)}`);
  const serial = serialOf(press, 'your click');
  const [pressed, g1, got] = d.step([play(SEC + CLICK_UP, { serial }), gateCall(SEC + 200 * MS), handed(secs(5), 0, secs(3))], 'Play pressed, 3 s played live');
  expect(playing(pressed), `your press of Play plays the document: ${JSON.stringify(pressed).slice(0, 400)}`).toBe(true);
  const gate1 = gateOf(g1, 'the gate after your press');
  expect([gate1.state, gate1.granted_by], 'after your press the gate runs, granted by your click\'s serial').toEqual(['running', serial]);
  const live = pcmOf(evidence, handedOf(got, 0, secs(3), 'what the live transport handed the gate'), RATE, 'the live 0 to 3 s');
  const assets = WINDOWS.map((w) => putSignal(evidence, slice(live, sampleAt(w.from), sampleAt(w.to))));
  const bakes = runShow(bin(), { evidence, calls: assets.map((a) => bakeCall(a, 4)) }, 'each strip\'s window baked at 4×');
  return { before, peaks: WINDOWS.map((w, i) => ({ strip: w.strip, dbtp: truePeakOf(bakes[i], assets[i]!, `the window of \`${w.strip}\``) })) };
}
/** The first strip, in time order, whose window passes the ceiling. */
const over = (h: Heard): string | null => h.peaks.find((p) => p.dbtp > CEILING)?.strip ?? null;

describe(`${AC[5]} a synth plays only after your gesture, and through the master's limiter`, () => {
  it(`${AC[5]} the synth strip \`hot\` stays silent before your gesture; after it, it plays through the master's limiter, which holds the preset driven to clip at −1 dBTP; a planted synth routed around the master fails, naming \`hot\``, () => {
    const clean = world();
    const f = [...clean.before];
    for (const p of clean.peaks) {
      if (p.dbtp > CEILING) f.push(`the strip \`${p.strip}\` reads ${fmt(p.dbtp)} dBTP at 4×, over the master's ceiling of −1.0 dBTP`);
      if (!(p.dbtp > -6)) f.push(`the strip \`${p.strip}\` reads ${fmt(p.dbtp)} dBTP at 4×: driven to clip, it should sound near the ceiling`);
    }
    expect(f, 'silent before your gesture; after it, every strip held at −1 dBTP by the master\'s limiter').toEqual([]);

    // Wrong program: the synth's voices go around the master to the gate.
    const w = world('synth_bypasses_master');
    expect(over(w), `planted synth_bypasses_master fails the gate's test, naming the strip \`hot\` (the first window over −1.0 dBTP); got ${JSON.stringify(w.peaks)}`).toBe('hot');
  }, TIMEOUT);
});
