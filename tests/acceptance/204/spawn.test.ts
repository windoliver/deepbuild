// AC6 #204.9d525978: "A Spawn whose template plays a pluck preset pitched by each hit's speed gives, for 50 recorded
// hits, onsets within one sample of their occurrences and the pitch each speed maps to; a seek into the middle replays
// the same voices by hash; and a planted Spawn that starts each voice at the first block after its occurrence lands up
// to a block late and fails, naming the first hit"
//
// AC13 #204.cb2d85e8: "In a Spawn with `max_voices: 1`, the second of two hits 100 ms apart renders, from its first
// sample, the samples a fresh voice renders for the same hit, bit for bit; a planted node that keeps its filter state
// across the steal fails, naming the node"
//
// Through `media_mix` with #500's Spawn on a baked occurrence list given as data (`occurrences`), whose template takes
// `src: {synth: …}` (Synth `synth@1`, As built: "Where a synth sits"; README: The surface under test).
//
// AC6: `plucks.pluck@1`, eight nodes: a sine at the param `hz` held for 0.1 s then gone by 0.13 s, and a 3 ms noise
// click on its first samples; the template pitches it `hz: "100 + 10 * speed"` and plays it for 0.15 s. 50 hits, one
// every 0.25 s from 0.5 s, each a few samples into its block (the first 101 samples in), with 50 distinct speeds from 1
// to 25.5 m/s (110 to 355 Hz, 5 Hz apart). Each voice is alone in its window: its onset (the first sample over
// −120 dBFS within 512 samples of its occurrence) must be within one sample of the occurrence's, and its pitch over 10
// to 100 ms after it within 1 Hz of 100 + 10 × speed. The document played to its end, then seeked back to 6.3 s (inside
// a voice) and played on, and seeked to cold in another process, hashes alike after 6.3 s, with the same `voices`.
// The planted `spawn_synth_starts_next_block` starts each voice at the first block boundary at or after its
// occurrence: the first hit's onset is 27 samples late, and the failure names hit 0.
//
// AC13: `steals.voice@1` (a saw at `hz` through a resonant lowpass, shaped by an envelope); spawn `taps` with
// `max_voices: 1`, hit A at 0.5 s and 17 samples (pair 1–2, 10 m/s) and hit B 100 ms later (pair 3–4, 14 m/s), A still
// sounding when B steals its voice. The fresh voice: the same list with A's kind changed so the filter skips it, so B is
// the spawn's only voice and keeps its occurrence index 1. B's voice in each, from its first sample for 0.25 s, by every
// node's tap (`taps["taps.<k>/<node>"]`, k its index among the spawn's voices): equal, bit for bit. The planted
// `steal_keeps_filter_state` keeps the lowpass's state across the steal: the first node that differs is `filter`.
import { describe, expect, it } from 'vitest';
import {
  AC, BLOCK, RATE, TIMEOUT, arr, atSample, biquad, env, failsNaming, gain, int, mediaDoc, mix, mixes, noise, none, obj, osc, pcmOf, pitch, presetOf,
  secs, synthSrc, useShow, useTemp, writePack, type JsonObject, type MixReply, type PackFixture, type Pcm, type Planted, type Preset,
} from './helpers.ts';

const bin = useShow();
const temp = useTemp();

/** Eight nodes: a held sine and a short noise click, mixed; cost: 4 + 1 + 2 + 2 + 1 + 2 + 2 + 1. */
const PLUCK: Preset = {
  nodes: {
    tone: osc('sine', 'hz'), body: gain(0), shape: env(0, 0.1, 0.03, 0, 0.01),
    hiss: noise('white'), click: gain(0), snap: env(0, 0, 0.003, 0, 0.001),
    sum: mix(), level: gain(0.25),
  },
  edges: [['tone', 'body', 'in'], ['shape', 'body', 'gain'], ['hiss', 'click', 'in'], ['snap', 'click', 'gain'], ['body', 'sum', 'in'], ['click', 'sum', 'in'], ['sum', 'level', 'in']],
  out: 'level',
  params: { hz: { unit: 'Hz', range: [50, 500], default: 200 } },
  cost: 15,
};

// ---------------------------------------------------------------------------------------------------
// AC6

const HITS = 50;
/** Hit k's sample: 0.5 s + 0.25 s × k, nudged so it never lands on a block boundary. */
const hitSample = (k: number): number => {
  let s = 24_000 + 12_000 * k + 37 + ((k * 53) % 61);
  if (s % BLOCK === 0 || s % BLOCK === BLOCK - 1) s += 2;
  return s;
};
/** 50 distinct speeds, 1 to 25.5 m/s, in a shuffled order (k × 17 mod 50). */
const speedOf = (k: number): number => 1 + 0.5 * ((k * 17) % 50);
const END = secs(13.5);
const MIDDLE = secs(6.3);

function pluckDoc(pack: PackFixture): JsonObject {
  const rows = Array.from({ length: HITS }, (_, k) => ({ t: atSample(hitSample(k)), kind: 'hit', a: k + 1, b: 100 + k, speed: speedOf(k) }));
  return mediaDoc({
    span: END, packs: [pack],
    extra: {
      occurrences: { 'lab.occurrences': rows },
      spawns: { plucks: { on: { list: 'lab.occurrences', kinds: ['hit'] }, play: { src: synthSrc({ preset: presetOf(pack, 'pluck'), params: { hz: '100 + 10 * speed' } }), span: secs(0.15) }, seed: 204 } },
    },
  });
}

interface Voice { occurrence: number; start: number; stolen_by: number | null }
function voicesOf(m: MixReply, what: string): Voice[] {
  return arr(m.raw['voices'], `${what}: mix.voices`).map((v, i) => {
    const o = obj(v, `${what}: mix.voices[${i}]`);
    return { occurrence: int(o['occurrence'], `${what}: voices[${i}].occurrence`), start: int(o['start'], `${what}: voices[${i}].start`), stolen_by: o['stolen_by'] === null ? null : int(o['stolen_by'], `${what}: voices[${i}].stolen_by`) };
  });
}

/** Each hit's onset and pitch; a failure names the hit. */
function hitProblems(p: Pcm): string[] {
  const f: string[] = [];
  const c = p.channels[0]!;
  for (let k = 0; k < HITS; k++) {
    const s = hitSample(k);
    let onset: number | null = null;
    for (let n = s - 512; n < s + 512 && onset === null; n++) if (Math.abs(c[n]!) > 1e-6) onset = n;
    if (onset === null || Math.abs(onset - s) > 1) f.push(`hit ${k}: its voice's onset is ${onset === null ? 'nowhere within 512 samples' : `sample ${onset}`}, not within one sample of its occurrence at sample ${s} (${onset === null ? '' : `${onset - s} samples off`})`);
    const want = 100 + 10 * speedOf(k);
    const got = pitch(c.slice(s + 480, s + 4800), RATE, 80, 400);
    if (Math.abs(got - want) > 1) f.push(`hit ${k}: its pitch is ${got.toFixed(2)} Hz, not the ${want} Hz its speed ${speedOf(k)} m/s maps to`);
  }
  return f;
}

function plucks(planted?: Planted): { straight: MixReply; cold: MixReply; evidence: string } {
  const root = temp();
  const evidence = temp();
  const pack = writePack(root, 'plucks', { pluck: PLUCK });
  const doc = pluckDoc(pack);
  const [straight, cold] = mixes(bin(), evidence, [pack], [
    { doc, segments: [{ from: 0, to: MIDDLE, write: true }, { from: MIDDLE, to: END, write: true }, { from: MIDDLE, to: END, write: true }] },
    { doc, segments: [{ from: MIDDLE, to: END, write: true }] },
  ], 'fifty plucks, played, seeked back to 6.3 s, and seeked to cold', planted);
  return { straight: straight!, cold: cold!, evidence };
}
/** The whole play's PCM: the first two segments joined. */
function whole(r: { straight: MixReply; evidence: string }): Pcm {
  const a = pcmOf(r.evidence, r.straight.segments[0]!, RATE, 'playing to 6.3 s');
  const b = pcmOf(r.evidence, r.straight.segments[1]!, RATE, 'playing on from 6.3 s');
  return { first: 0, frames: a.frames + b.frames, rate: RATE, channels: a.channels.map((c, i) => { const x = new Float32Array(c.length + b.channels[i]!.length); x.set(c); x.set(b.channels[i]!, c.length); return x; }) };
}

describe(`${AC[6]} spawned synth voices start on their occurrences' samples, at the pitch their speed maps to`, () => {
  it(`${AC[6]} fifty recorded hits play plucks pitched by speed, each onset within one sample of its occurrence and each pitch within 1 Hz of 100 + 10 × speed; a seek back to 6.3 s and a cold seek to it replay the same voices by hash`, () => {
    const r = plucks();
    const f = hitProblems(whole(r));
    const v = voicesOf(r.straight, 'the play');
    if (v.length !== HITS) f.push(`the spawn starts ${v.length} voices, not one per hit (${HITS})`);
    v.forEach((x, i) => { if (x.occurrence !== i || x.start !== atSample(hitSample(i))) f.push(`voices[${i}] is occurrence ${x.occurrence} from flick ${x.start}, not occurrence ${i} from its flick ${atSample(hitSample(i))}`); });
    const [, played, seek] = r.straight.segments;
    const cold = r.cold.segments[0]!;
    if (seek!.seek === null) f.push('the seek back to 6.3 s isn\'t reported as a seek');
    if (seek!.sha256 !== played!.sha256) f.push(`the seek back to 6.3 s replays other samples (${seek!.sha256} vs ${played!.sha256})`);
    if (cold.sha256 !== played!.sha256) f.push(`the cold seek to 6.3 s replays other samples (${cold.sha256} vs ${played!.sha256})`);
    if (JSON.stringify(voicesOf(r.cold, 'the cold seek')) !== JSON.stringify(v)) f.push('the cold seek plans other voices than the play');
    none(f, 'onsets, pitches and the seek');
  }, TIMEOUT);

  it(`${AC[6]} a planted Spawn that starts each voice at the first block after its occurrence lands up to a block late and fails, naming the first hit`, () => {
    const f = hitProblems(whole(plucks('spawn_synth_starts_next_block')));
    expect(f[0] ?? '', `planted spawn_synth_starts_next_block fails, naming the first hit (hit 0, ${BLOCK - (hitSample(0) % BLOCK)} samples late); got ${JSON.stringify(f.slice(0, 4))}`).toMatch(/^hit 0: its voice's onset is sample \d+, not within one sample/);
  }, TIMEOUT);
});

// ---------------------------------------------------------------------------------------------------
// AC13

/** A saw at `hz` through a resonant lowpass, shaped by an envelope; cost: 4 + 5 + 2 + 1 + 1. */
const VOICE: Preset = {
  nodes: { tone: osc('saw', 'hz'), filter: biquad('lowpass', 1200, 4), shape: env(0.002, 0.05, 0.1, 0.4, 0.05), amp: gain(0), trim: gain(0.25) },
  edges: [['tone', 'filter', 'in'], ['filter', 'amp', 'in'], ['shape', 'amp', 'gain'], ['amp', 'trim', 'in']],
  out: 'trim',
  params: { hz: { unit: 'Hz', range: [50, 500], default: 200 } },
  cost: 13,
};
const NODES = ['tone', 'filter', 'shape', 'amp', 'trim'] as const;
const A_SAMPLE = 24_017;
const B_SAMPLE = A_SAMPLE + 4_800; // 100 ms later

function stealDoc(pack: PackFixture, aKind: string): JsonObject {
  return mediaDoc({
    span: secs(1.5), packs: [pack],
    extra: {
      occurrences: { 'lab.occurrences': [
        { t: atSample(A_SAMPLE), kind: aKind, a: 1, b: 2, speed: 10 },
        { t: atSample(B_SAMPLE), kind: 'hit', a: 3, b: 4, speed: 14 },
      ] },
      spawns: { taps: { on: { list: 'lab.occurrences', kinds: ['hit'] }, play: { src: synthSrc({ preset: presetOf(pack, 'voice'), params: { hz: '80 + 10 * speed' } }), span: secs(0.3) }, max_voices: 1, steal: 'oldest', seed: 204 } },
    },
  });
}

function steal(planted?: Planted): string[] {
  const root = temp();
  const evidence = temp();
  const pack = writePack(root, 'steals', { voice: VOICE });
  const from = atSample(B_SAMPLE);
  const segs = [{ from: 0, to: from }, { from, to: from + secs(0.25), write: true }];
  const [stolen, fresh] = mixes(bin(), evidence, [pack], [{ doc: stealDoc(pack, 'hit'), segments: segs }, { doc: stealDoc(pack, 'miss'), segments: segs }], 'two hits 100 ms apart on one voice, and the second alone', planted);
  const f: string[] = [];
  const vs = voicesOf(stolen!, 'the steal');
  const vf = voicesOf(fresh!, 'the fresh voice');
  if (vs.length !== 2 || vs[0]!.occurrence !== 0 || vs[0]!.stolen_by !== 1 || vs[1]!.occurrence !== 1) f.push(`with max_voices 1, hit B steals hit A's voice: voices ${JSON.stringify(vs)}`);
  if (vf.length !== 1 || vf[0]!.occurrence !== 1) f.push(`the fresh run plays hit B alone, as occurrence 1: voices ${JSON.stringify(vf)}`);
  const kStolen = vs.findIndex((v) => v.occurrence === 1);
  const kFresh = vf.findIndex((v) => v.occurrence === 1);
  const a = stolen!.segments[1]!;
  const b = fresh!.segments[1]!;
  const pa = pcmOf(evidence, a, RATE, 'hit B after the steal');
  if (!(Math.max(...pa.channels[0]!.map(Math.abs)) > 0.01)) f.push('hit B is silent after the steal, so equality proves nothing');
  for (const n of NODES) {
    const ka = `taps.${kStolen}/${n}`;
    const kb = `taps.${kFresh}/${n}`;
    if (a.taps[ka] === undefined || b.taps[kb] === undefined) { f.push(`no output hash for hit B's node \`${n}\` (taps["${ka}"], taps["${kb}"])`); break; }
    if (a.taps[ka] !== b.taps[kb]) { f.push(`node \`${n}\`: hit B's voice after the steal renders other samples from its first than a fresh voice for the same hit (${a.taps[ka]} vs ${b.taps[kb]})`); break; }
  }
  return f;
}

describe(`${AC[13]} a stolen voice started again renders as a fresh voice`, () => {
  it(`${AC[13]} in a Spawn with max_voices 1, the second of two hits 100 ms apart renders, from its first sample, a fresh voice's samples for the same hit, bit for bit, at every node`, () => {
    none(steal(), 'hit B after the steal is a fresh voice');
  }, TIMEOUT);

  it(`${AC[13]} a planted node that keeps its filter state across the steal fails, naming the node \`filter\``, () => {
    failsNaming(steal('steal_keeps_filter_state'), /^node `filter`:/, 'planted steal_keeps_filter_state');
  }, TIMEOUT);
});

