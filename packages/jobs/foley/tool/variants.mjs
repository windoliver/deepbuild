// One foley preset rendered into its variants (#155; canvas primitives: Foley `foley.render@1`): levels × round robins,
// each one voice of the preset at the level's velocity, its span the gate of the action its seed names (a film's plan
// seeds each preset's job with the preset's own name, `foley.<material>.<action>@1`), with the noise key SHA-256 of
// (seed, level, round robin), so every draw is hashed per variant and none reads a stream: a variant's bytes depend on
// nothing but its own key, the preset and this build. A variant rings past its gate for the preset's tail,
// up to 1.5 s, and ends after its last sample that isn't silent at 16 bits; a tail still sounding at the cap fades out
// over its last 10 ms. Each variant is a 48 kHz mono 16-bit PCM WAVE.
import { createHash } from 'node:crypto';
import { note } from './synth.mjs';

export const TOOL = 'foley-render';
export const VERSION = '1.0.0';
/** The velocity each level plays its preset at, level 1 the softest. */
export const VELS = [0.3, 0.6, 1];
/** The voice's span per action, in seconds: a hit's excitation, or a scrape long enough to cover a long stroke. */
export const GATES = { tap: 0.05, hit: 0.1, click: 0.02, pop: 0.08, drip: 0.12, scrape: 2, slide: 2, whoosh: 0.8, tear: 0.8 };
/** The longest tail a variant keeps past its gate, s, and the fade at that cap, s. */
const TAIL = 1.5;
const FADE = 0.01;
/** The tail tried first, s, and the silence at its end, s, that ends a variant there. */
const SHORT = 0.3;
const QUIET = 0.05;
const FULL = 32768; // 2^15, a 16-bit sample's full scale

/** The noise key of one variant: the first 32 bits of SHA-256(seed, variant). */
export function keyOf(seed, variant) {
  return createHash('sha256').update(`${seed}\u0000${variant}`).digest().readUInt32BE(0);
}

/** The action a seed names, as a preset's name does: `<pack>.<material>.<action>@<major>`. */
export function actionOf(seed) {
  const m = /^[a-z0-9_-]+\.[a-z0-9_-]+\.([a-z]+)@\d+$/.exec(seed);
  if (!m || !Object.hasOwn(GATES, m[1])) throw Error(`the seed ${JSON.stringify(seed)} isn't a preset's name, <pack>.<material>.<action>@<major> with an action of ${Object.keys(GATES).join(', ')}`);
  return m[1];
}

/** Samples as a mono 16-bit PCM WAVE at `rate`. */
function wav(pcm, rate) {
  const b = Buffer.alloc(44 + pcm.length * 2);
  b.write('RIFF', 0, 'latin1');
  b.writeUInt32LE(36 + pcm.length * 2, 4);
  b.write('WAVEfmt ', 8, 'latin1');
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36, 'latin1');
  b.writeUInt32LE(pcm.length * 2, 40);
  for (let i = 0; i < pcm.length; i++) b.writeInt16LE(pcm[i], 44 + i * 2);
  return b;
}

/** `length` samples of the voice at 16 bits, the last `fade` of them faded out, and where its last sound ends. */
function pcmOf(preset, rate, gate, vel, key, length, fade) {
  const x = note({ preset, rate, gate, length, vel, key });
  const pcm = new Int16Array(length);
  let end = 0;
  for (let i = 0; i < length; i++) {
    const left = length - i;
    const s = left <= fade ? (x[i] * (left - 1)) / fade : x[i];
    pcm[i] = Math.max(-FULL, Math.min(FULL - 1, Math.round(s * FULL))) || 0;
    if (pcm[i] !== 0) end = i + 1;
  }
  return { pcm, end };
}

/**
 * One variant's 16-bit samples: the voice to its last sample that isn't silent, faded if the cap cuts its tail. A
 * short tail is rendered first, and kept when its last QUIET seconds are silent; otherwise the voice is rendered again
 * to the cap. The voice is the same samples at any length, so either way they are the cap's render up to its end.
 */
function voice(preset, rate, gate, vel, key) {
  const short = pcmOf(preset, rate, gate, vel, key, gate + Math.round(SHORT * rate), 0);
  if (short.end <= short.pcm.length - Math.round(QUIET * rate)) return short.pcm.subarray(0, short.end);
  const long = pcmOf(preset, rate, gate, vel, key, gate + Math.round(TAIL * rate), Math.round(FADE * rate));
  return long.pcm.subarray(0, long.end);
}

/**
 * The variants of the params' preset (its value, as its pack carries it): `{wavs: {l<level>r<rr> → bytes}, meta}`;
 * `progress(done, total)` is told as variants are rendered.
 */
export function render(params, progress = () => undefined) {
  const { preset, seed, sample_rate: rate, levels, round_robins: rrs } = params;
  const gate = Math.round(GATES[actionOf(seed)] * rate);
  const wavs = {};
  const variants = {};
  const total = levels * rrs;
  for (let level = 1; level <= levels; level++) {
    for (let rr = 1; rr <= rrs; rr++) {
      const id = `l${level}r${rr}`;
      const pcm = voice(preset, rate, gate, VELS[level - 1], keyOf(seed, id));
      if (!pcm.length) throw Error(`the preset seeded ${seed} is silent throughout at level ${level}, round robin ${rr}`);
      wavs[id] = wav(pcm, rate);
      variants[id] = { sha256: createHash('sha256').update(wavs[id]).digest('hex'), length: pcm.length, level, round_robin: rr };
      progress((level - 1) * rrs + rr, total);
    }
  }
  const meta = { seed, sample_rate: rate, levels, round_robins: rrs, variants, made_by: { tool: TOOL, version: VERSION, synthetic: true } };
  return { wavs, meta };
}
