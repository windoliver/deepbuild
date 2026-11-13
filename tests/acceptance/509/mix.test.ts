// #509.8b57734f: "mix.speech_ratio fails a fixture where music sits 4 LU under the voice and passes one at 12 LU, and
// silences fails a gap whose reverb tail stays above −60 dBFS"
//
// Through `deep-show run` as #409's suite drives a film's verdict (the agent presents each 9 s film of three 3 s shots
// with `deep_show`, a claim of its whose one deliverable is the film gets a `verdict`; #409's helpers).
// mix.speech_ratio: the film's one line `l1` at 1 s plays a 6 s take on the narration bus, and a music strip plays under
// it on the bus `music` for the whole film. Both are the same steady 1 kHz tone as stereo float WAVs (both channels
// alike), the voice at peak 0.1 and the music 4 dB, or 12 dB, lower: through the same K-weighting a level difference of
// d dB is d LU, so the ratio over every 3 s window of the speech span is 4 LU, or 12 LU, by construction. The take's
// activity record (its speech span, the whole take) and words record are written by the test (#502's shapes). No brief
// names the check: it is on by default for a film with a speech line, as the row <claim>#mix.speech_ratio with from:
// {default: "mix.speech_ratio"}. At 4 LU it FAILs with mix.speech_low errors naming l1, each ratio 4 ± 0.1 LU against
// min 10; at 12 LU it PASSes with none.
// silences: a brief naming craft@1's silences (count_min 2, length_min 0.5 s, max_dbfs −60); an ambience bed with gaps
// at 2–2.8 s and 5–5.8 s, the bed before the second gap on its own bus `room`. In the clean film `room` has no
// processor; in the twin it holds a reverb, so the second gap holds the bed's tail. The tail's level is read from the
// mix itself (`media_mix` of the gap, every 10 ms sub-block): above −60 dBFS throughout in the twin and at or below it in
// the clean film, or the fixture is BLOCKED. Each film is exported before its verdict (the export writes the per-bus
// power bakes the sound checks read). The clean film's silences row PASSes; the twin's FAILs with craft.silences.
import { describe, expect, it } from 'vitest';
import { mixOf, pcmOf } from '../499/mix/helpers.ts';
import { briefOf, docId, failsWith, film as craftFilm, judge, named, passes, sec, shotsOf, storeLooks, subject, useFolders, type Film } from '../409/helpers.ts';
import {
  AC, CC0, FLICKS, FULL, RATE, TIMEOUT, activityRecord, blockedUnless, errors, fieldOf, floatWav, interleaved, num, proof, putEvidence, rowFrom, runShow,
  scenario, sha256, show, tone, useShow, wordsRecord, type JsonObject, type Take,
} from './helpers.ts';

const shows = useShow([FULL]);
const folder = useFolders();
const VOICE_AMP = 0.1;
const SPAN = 9;
const SHOTS = [3, 3, 3];

/** A stereo float WAV in the store, both channels alike: its hash and its PCM's. */
function stereo(evidence: string, x: Float32Array): { sha: string; pcmSha: string } {
  const channels = [x, Float32Array.from(x)];
  return { sha: putEvidence(evidence, floatWav(channels, RATE)), pcmSha: sha256(interleaved(channels)) };
}
const strip = (track: number, src: string, start: number, samples: number, bus: string): JsonObject =>
  ({ track, src, start: sec(start), in: 0, out: samples * (FLICKS / RATE), rate: 1, bus });

/** The speech-ratio film: the voice's 1 kHz take for line l1 at 1 s, and the same tone `under` dB lower as music. */
function ratioFilm(evidence: string, n: number, under: number): Film {
  const voice = tone(6, VOICE_AMP);
  const v = stereo(evidence, voice);
  const text = 'Hold this steady tone';
  const each = voice.length / 4;
  const spans = text.split(' ').map((w, k) => ({ text: w, start: k * each, end: (k + 1) * each }));
  const t: Take = { text, samples: voice, words: spans, regions: spans.map((s) => [s.start, s.end]) };
  const words = putEvidence(evidence, wordsRecord(t, v.pcmSha));
  const activity = putEvidence(evidence, activityRecord(v.pcmSha, voice.length, [[0, voice.length]]));
  const music = tone(SPAN, VOICE_AMP * 10 ** (-under / 20));
  const m = stereo(evidence, music);
  const document = craftFilm(docId(n), `Music ${under} LU under the voice`, [subject(0)], {
    span: SPAN, shots: shotsOf(SHOTS),
    assets: { voice_l1: { sha256: v.sha, license: CC0, attached: [words, activity] }, music: { sha256: m.sha, license: CC0 } },
    extra: {
      strips: { music: strip(1, m.sha, 0, music.length, 'music') }, buses: { music: {} },
      script: { narrator: { name: 'The test voice', license: CC0, synthetic: false }, lines: { l1: { t: '1s', text: t.text, recording: { asset: 'voice_l1' } } }, captions: { profile: 'netflix-en-adult' } },
    },
  });
  return { name: `music ${under} LU under the voice`, doc: docId(n), document, brief: { goal: 'A narrated film whose voice sits above its music' } };
}

/** The silences film: an ambience bed with gaps at 2–2.8 s and 5–5.8 s; the bed before the second on `room`, with a reverb in the twin. */
function silencesFilm(evidence: string, n: number, tail: boolean): Film {
  const bed = (seconds: number) => tone(seconds, 0.5, 440);
  const parts: [string, number, number, string][] = [['amb-1', 0, 2, 'ambience'], ['amb-2', 2.8, 2.2, 'room'], ['amb-3', 5.8, 3.2, 'ambience']];
  const assets: JsonObject = {};
  const strips: JsonObject = {};
  parts.forEach(([id, start, seconds, bus], i) => {
    const x = bed(seconds);
    const s = stereo(evidence, x);
    assets[id] = { sha256: s.sha, license: CC0 };
    strips[id] = strip(i + 1, s.sha, start, x.length, bus);
  });
  const document = craftFilm(docId(n), tail ? 'A gap that holds a reverb tail' : 'Two clean silences', [subject(0)], {
    span: SPAN, shots: shotsOf(SHOTS), assets,
    extra: {
      strips, buses: { ambience: {}, room: tail ? { processors: ['verb'] } : {} },
      ...(tail ? { processors: { verb: { kind: 'reverb', ir: { decay: 4, size: 0.8, damping: 0.2 }, mix: 0.6 } } } : {}),
    },
  });
  return { name: tail ? 'the gap with a reverb tail' : 'the clean silences', doc: docId(n), document, brief: briefOf(named('silences')), exported: true };
}
/** Each 10 ms sub-block's level, in dBFS, of the film's mix over the second gap (5.0 to 5.8 s). */
function gapLevels(evidence: string, document: JsonObject, what: string): number[] {
  const seg = { from: 5 * FLICKS, to: Math.round(5.8 * FLICKS), write: true };
  const [reply] = runShow(shows.bin(FULL), scenario(evidence, [{ call: 'media_mix', doc: document, segments: [seg] }]), `${what}: the mix over the second gap`);
  const pcm = pcmOf(evidence, mixOf(reply, [seg], `${what}: media_mix`).segments[0]!, `${what}: the mix over the second gap`);
  const block = RATE / 100;
  const out: number[] = [];
  for (let a = 0; a + block <= pcm.frames; a += block) {
    let p = 0;
    for (const c of pcm.channels) for (let i = a; i < a + block; i++) p += c[i]! * c[i]!;
    out.push(10 * Math.log10(Math.max(p / (block * pcm.channels.length), 1e-30)));
  }
  return out;
}

describe(`${AC[7]} mix.speech_ratio fails at 4 LU and passes at 12 LU; silences fails a gap holding a reverb tail above −60 dBFS`, () => {
  it(`${AC[7]} with music 4 LU under the voice the row mix.speech_ratio FAILs with mix.speech_low naming l1, ratio 4 LU against min 10; at 12 LU it PASSes`, () => {
    const evidence = folder();
    const four = ratioFilm(evidence, 1, 4);
    const twelve = ratioFilm(evidence, 2, 12);
    const { judged } = judge(shows.bin(FULL), evidence, [four, twelve]);
    const low = rowFrom(judged[four.name]!.verdict.raw, 'mix.speech_ratio', four.name);
    const high = rowFrom(judged[twelve.name]!.verdict.raw, 'mix.speech_ratio', twelve.name);
    proof('ac7-speech-ratio.json', { four: low, twelve: high });

    expect(low['result'], `${four.name}: the speech-ratio row FAILs: ${show(low, 2000)}`).toBe('FAIL');
    const issues = errors(low, 'mix.speech_low');
    expect(issues.length, `${four.name}: mix.speech_low errors name the windows short of 10 LU: ${show(low['issues'] ?? null, 2000)}`).toBeGreaterThan(0);
    for (const i of issues) {
      expect(fieldOf(i, 'line'), `${four.name}: mix.speech_low names the line l1: ${show(i)}`).toBe('l1');
      expect(Math.abs(num(fieldOf(i, 'ratio'), `${four.name}: mix.speech_low's ratio (LU)`) - 4), `${four.name}: the window's ratio is 4 LU within 0.1: ${show(i)}`).toBeLessThanOrEqual(0.1);
      expect(num(fieldOf(i, 'min'), `${four.name}: mix.speech_low's min (LU)`), `${four.name}: the minimum held is 10 LU`).toBe(10);
    }
    expect(high['result'], `${twelve.name}: the speech-ratio row PASSes: ${show(high, 2000)}`).toBe('PASS');
    expect(errors(high, 'mix.speech_low'), `${twelve.name}: no window is short of 10 LU`).toEqual([]);
  }, TIMEOUT);

  it(`${AC[7]} a brief naming silences: the second gap holding a reverb tail above −60 dBFS FAILs craft.silences; the same gap with no reverb PASSes`, () => {
    const evidence = folder();
    const out = folder();
    const clean = silencesFilm(evidence, 3, false);
    const tail = silencesFilm(evidence, 4, true);
    storeLooks(evidence);
    const cleanLevels = gapLevels(evidence, clean.document, clean.name);
    const tailLevels = gapLevels(evidence, tail.document, tail.name);
    blockedUnless(tailLevels.length === 80 && tailLevels.every((l) => l > -60), `the fixture: every 10 ms of the twin's second gap is above −60 dBFS; its levels run ${Math.min(...tailLevels).toFixed(1)} to ${Math.max(...tailLevels).toFixed(1)} dBFS`);
    blockedUnless(cleanLevels.length === 80 && cleanLevels.every((l) => l <= -60), `the fixture: the clean film's second gap is silent (at or below −60 dBFS); its loudest 10 ms is ${Math.max(...cleanLevels).toFixed(1)} dBFS`);
    const { judged } = judge(shows.bin(FULL), evidence, [clean, tail], { out });
    proof('ac7-silences.json', { gap_dbfs: { clean: cleanLevels, tail: tailLevels }, clean: judged[clean.name]!.craft.get('silences')?.map((r) => r.raw) ?? null, tail: judged[tail.name]!.craft.get('silences')?.map((r) => r.raw) ?? null });
    expect(passes(judged[clean.name], 'silences', clean.name), `${clean.name} PASSes silences`).toEqual([]);
    expect(failsWith(judged[tail.name], 'silences', 'craft.silences', { anyOf: ['shot-1', 'shot-2', 'shot-3'], tIn: [0, SPAN] }, tail.name), `${tail.name} FAILs silences`).toEqual([]);
  }, TIMEOUT);
});
