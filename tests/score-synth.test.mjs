// #204: a score's synth instrument naming a pack's preset renders through the media module's own node code (canvas
// primitives: Synth `synth@1`, As built): score.render's voice for such a note is the wasm build's render of that
// preset at the note's pitch and span, times the note's level, and never the tool's own five synth voices.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { note } from '../packages/jobs/score/tool/synth.mjs';
import { voice } from '../packages/jobs/score/tool/voices.mjs';

const graph = {
  nodes: {
    osc: { kind: 'osc', wave: 'triangle', hz: 'hz' },
    lp: { kind: 'biquad', type: 'lowpass', freq: 1800, q: 0.8 },
    env: { kind: 'env', attack: 0.01, decay: 0.05, sustain: 0.7, release: 0.1 },
    amp: { kind: 'gain', gain: 0 },
  },
  edges: [['osc', 'lp', 'in'], ['lp', 'amp', 'in'], ['env', 'amp', 'gain']],
  out: 'amp',
  params: { hz: { unit: 'Hz', range: [20, 4000], default: 440 } },
  cost: 20,
};

test('a pack preset note is the media module render of its preset', () => {
  const rate = 48_000;
  const e = { id: 'n1', pitch: 69, durN: 4_800, releaseN: 4_800, attackN: 0, level: 0.5 };
  const draws = { take: 0n, noise: 0x1234_5678_9abc_def0n };
  const src = { synth: { preset: 'tones.soft@1', graph, tail: 0.1 } };
  const out = new Float64Array(e.durN + e.releaseN);
  voice(out, src, e, rate, draws, null);
  const want = note({ preset: graph, rate, gate: e.durN, length: out.length, hz: 440, vel: 0.8, key: 0x9abc_def0 });
  assert.ok(want.some((x) => x !== 0));
  for (let n = 0; n < out.length; n++) assert.equal(out[n], want[n] * 0.5, `sample ${n}`);
});
