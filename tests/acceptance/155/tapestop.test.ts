// AC4 #155.fd738754: "A tape stop from rate 1 to 0 over 0.8 s matches its exact integral within one sample at every
// block, and seeking into it equals playing"
//
// Through `deep-show run`'s `media_mix`. The source is a 3 s stereo float WAV whose position can be read back from any
// sample whatever its gain: L = 0.5·cos 2πn/4800, R = 0.5·sin 2πn/4800 (10 Hz), so the angle atan2(R, L) is the source
// sample n modulo 4,800. The strip `stop` starts at sample 6,000 (not on a block's edge), from 1 s into the source, with
// `rate: {ramp: {to: [0, 1], over: 0.8 s, shape: "linear"}}` (Strip and track: rate ramps; the ramp from the strip's
// rate of 1 at its start *(chosen)*) and a span of 0.8 s. Its source time is the exact integral of the rate:
// s(τ) = 1 s + τ − τ² ÷ 1.6 s for τ seconds into the strip. A second strip, `steady`, plays the same source at rate 1
// from 2 s, so each channel's gain through the mix is read from the mix itself (one gain per channel, by least squares).
//   - At the first sample of every 128-sample block inside the stop (blocks 47 to 346), the source position read from
//     the angle, unwrapped from the exact one at the first, is within one source sample of 48,000·s(τ).
//   - Seeking into it equals playing: [0.4 s, 1 s) after playing [0, 3 s) in one transport, and the same window asked
//     cold in a run of its own, equal the played samples bit for bit, and hash alike.
// The wrong program is the merge base, whose strip takes only a rational rate (`bad_media` at `rate`).
import { describe, expect, it } from 'vitest';
import {
  AC, BLOCK, RATE, SAMPLE, TIMEOUT, at, firstDiff, fitGain, mixCall, mixOf, pcmOf, proof, putSignal, runShow, scenario, secs, tempDir, useShow,
  type JsonObject, type Pcm, type SegmentAsk,
} from './helpers.ts';

const bin = useShow();
const SPAN = secs(3);
const PERIOD = 4800;
const START = 6000;
const STOP = 0.8;
const LEN = Math.round(STOP * RATE);
const STEADY = 2 * RATE;

function source(): Float32Array[] {
  const n = 3 * RATE;
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  for (let i = 0; i < n; i++) { l[i] = 0.5 * Math.cos((2 * Math.PI * i) / PERIOD); r[i] = 0.5 * Math.sin((2 * Math.PI * i) / PERIOD); }
  return [l, r];
}
function stopDoc(sha: string): JsonObject {
  return {
    transport: { sample_rate: RATE, span: SPAN },
    strips: {
      stop: { track: 0, src: { asset: sha }, start: START * SAMPLE, in: secs(1), out: secs(3), span: secs(STOP), rate: { ramp: { to: [0, 1], over: secs(STOP), shape: 'linear' } } },
      steady: { track: 1, src: { asset: sha }, start: STEADY * SAMPLE, in: secs(1), out: secs(1.25) },
    },
  };
}
/** The exact source position, in source samples, at output sample m inside the stop. */
const exact = (m: number): number => { const tau = (m - START) / RATE; return RATE * (1 + tau - (tau * tau) / (2 * STOP)); };

/** The tape stop judged on a played PCM: each block's first sample within one source sample of the integral. */
function stopFailures(p: Pcm, src: Float32Array[]): { failures: string[]; worst: number; errors: [number, number][] } {
  // Each channel's gain, from `steady` (source sample 48,000 + (m − 96,000)), away from its edges' fades.
  const from = STEADY + 2400;
  const to = STEADY + 9600;
  const y = (c: number) => Array.from({ length: to - from }, (_, i) => at(p, c, from + i));
  const ref = (c: number) => Array.from({ length: to - from }, (_, i) => src[c]![RATE + (from + i - STEADY)]!);
  const gl = fitGain(y(0), ref(0), 0, to - from);
  const gr = fitGain(y(1), ref(1), 0, to - from);
  const failures: string[] = [];
  if (!(gl.gain > 0.1 && gr.gain > 0.1 && gl.residual < 1e-6 && gr.residual < 1e-6)) failures.push(`the steady strip doesn't play its source at one gain per channel (left ${gl.gain} residual ${gl.residual}, right ${gr.gain} residual ${gr.residual}), so the stop can't be read`);
  const errors: [number, number][] = [];
  let worst = 0;
  let unwrapped: number | null = null;
  for (let b = Math.ceil((START + 1) / BLOCK) * BLOCK; b < START + LEN - 1; b += BLOCK) {
    const l = at(p, 0, b) / gl.gain;
    const r = at(p, 1, b) / gr.gain;
    if (Math.hypot(l, r) < 0.02) { failures.push(`block ${b / BLOCK} (sample ${b}): the stop is silent there (amplitude ${Math.hypot(l, r).toFixed(4)}), so it plays nothing to read`); continue; }
    const angle = Math.atan2(r, l);
    const want = exact(b);
    const guess = unwrapped === null ? (2 * Math.PI * want) / PERIOD : unwrapped;
    const turns = Math.round((guess - angle) / (2 * Math.PI));
    unwrapped = angle + 2 * Math.PI * turns;
    const got = (unwrapped * PERIOD) / (2 * Math.PI);
    const err = got - want;
    errors.push([b, err]);
    worst = Math.max(worst, Math.abs(err));
    if (Math.abs(err) > 1) failures.push(`block ${b / BLOCK} (sample ${b}, ${((b - START) / RATE).toFixed(5)} s into the stop): the source is at sample ${got.toFixed(3)}, ${err.toFixed(3)} from the integral's ${want.toFixed(3)}`);
  }
  if (errors.length < 290) failures.push(`only ${errors.length} blocks of the stop were read`);
  return { failures, worst, errors };
}

describe(`${AC[4]} a tape stop from rate 1 to 0 over 0.8 s follows its exact integral, and seeking into it equals playing`, () => {
  it(`${AC[4]} at every block of the stop the source position is within one sample of 1 s + τ − τ² ÷ 1.6 s; a seek into it and a cold seek equal the played samples`, () => {
    const evidence = tempDir();
    const src = source();
    const sha = putSignal(evidence, src);
    const doc = stopDoc(sha);
    const played: SegmentAsk[] = [{ from: 0, to: SPAN, write: true }, { from: secs(0.4), to: secs(1), write: true }];
    const [reply] = runShow(bin(), scenario(evidence, [mixCall(doc, played)]), 'the tape stop, played then sought into');
    const m = mixOf(reply, played, 'the tape stop');
    const pcm = pcmOf(evidence, m.segments[0]!, 'the tape stop, played');
    const judged = stopFailures(pcm, src);
    const sought = pcmOf(evidence, m.segments[1]!, 'the seek into the stop');
    const cold: SegmentAsk[] = [{ from: secs(0.4), to: secs(1), write: true }];
    const [coldReply] = runShow(bin(), scenario(evidence, [mixCall(doc, cold)]), 'the tape stop, sought into cold');
    const coldMix = mixOf(coldReply, cold, 'the cold seek');
    const coldPcm = pcmOf(evidence, coldMix.segments[0]!, 'the cold seek into the stop');
    proof('ac4-tape-stop.json', { worst: judged.worst, errors: judged.errors, played: m.segments[0]!.sha256, sought: m.segments[1]!.sha256, cold: coldPcm.frames });
    expect(judged.failures, `the stop against its integral: ${judged.failures.slice(0, 8).join(' | ')}`).toEqual([]);
    const diff = firstDiff(pcm, sought);
    expect(diff, `the seek into the stop equals playing; first differing sample ${diff}`).toBeNull();
    const coldDiff = firstDiff(pcm, coldPcm);
    expect(coldDiff, `the cold seek into the stop equals playing; first differing sample ${coldDiff}`).toBeNull();
    expect(coldMix.segments[0]!.sha256, 'the seek and the cold seek hash alike').toBe(m.segments[1]!.sha256);
  }, TIMEOUT);
});
