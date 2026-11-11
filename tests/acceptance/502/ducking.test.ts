// AC2 #502.029aec8f: "A ducked music bus is at full depth from the first sample of each speech span, and its ramp starts
// exactly attack seconds earlier"
//
// Through `media_mix` (#499: the export's sound) on the fixture film's document (README: The surface under test). To
// read the music bus's gain sample by sample, the twin mixed here plays a constant in place of the music (0.25 on one
// channel, 12 s) and mutes the bus `narration`, so the master is the music bus alone: each master sample over the
// loudest one is the ducking gain at that sample. The film's `ducking` entry is the fixture's (`target: music`, `key:
// narration`, depth −12 dB, attack 0.2 s, hold 0.3 s, release 0.8 s, merge_gap 0.8 s); the speech spans are the
// fixture file's, each line's first word's start to its last word's end, and the two a gap under 0.8 s joins. The
// criterion names no wrong program: the same judge is run on a twin whose entry says attack 0.1 s, a ramp that starts
// 0.1 s late, and must fail, naming the span.
import { describe, expect, it } from 'vitest';
import {
  AC, FILM, FIXTURE, FLICKS, FULL, RATE, SAMPLE, TIMEOUT, arr, clone, failsNaming, floatWav, getEvidence, int, none, num, obj, part, putEvidence, readWav,
  runShow, stage, str, useFileTemp, useShow, type JsonObject,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useFileTemp('ducking');
const ENTRY = part(FIXTURE.document, 'ducking', 'duck');
const DEPTH = 10 ** (num(ENTRY['depth'], 'ducking.duck.depth') / 20);
const ATTACK = num(ENTRY['attack'], 'ducking.duck.attack');
/** Half the gain's step from one sample to the next on the ramp, (1 − depth) ÷ 9,600: a gain off by a sample fails. */
const TOLERANCE = 2e-5;
const at = (n: number): string => `sample ${n} (${(n / RATE).toFixed(5)} s)`;

/** The music bus's gain at each sample of the film: the fixture film mixed with a constant for music and the narration
 * bus muted, each master sample over the loudest. `edit` changes the twin's ducking entry. */
function musicGain(what: string, edit: (duck: JsonObject) => void = () => undefined): Float64Array {
  const evidence = temp();
  const doc = clone(stage(evidence).document);
  const constant = putEvidence(evidence, floatWav([new Float32Array(FILM.span / SAMPLE).fill(0.25)], RATE));
  part(doc, 'assets', FIXTURE.music.asset)['sha256'] = constant;
  part(doc, 'strips', 'music')['src'] = constant;
  part(doc, 'buses')['narration'] = { mute: true };
  edit(part(doc, 'ducking', 'duck'));
  const [reply] = runShow(shows.bin(FULL), { evidence, calls: [{ call: 'media_mix', doc, segments: [{ from: 0, to: FILM.span, write: true }] }] }, what);
  const mix = obj(reply!['mix'], `${what}: mix (${JSON.stringify(reply).slice(0, 600)})`);
  expect(int(mix['sample_rate'], `${what}: mix.sample_rate`), `${what}: the mix is at the transport's 48 kHz`).toBe(RATE);
  const wav = str(obj(arr(mix['segments'], `${what}: mix.segments`)[0], `${what}: mix.segments[0]`)['wav'], `${what}: mix.segments[0].wav (asked with write: true)`);
  const x = readWav(getEvidence(evidence, wav, `${what}: the master`), `${what}: the master`).channels[0]!;
  expect(x.length, `${what}: the master holds the film's 576,000 samples`).toBe(FILM.span / SAMPLE);
  let top = 0;
  for (const v of x) top = Math.max(top, Math.abs(v));
  expect(top, `${what}: the music is heard on the master (its loudest sample)`).toBeGreaterThan(0.05);
  return Float64Array.from(x, (v) => v / top);
}

/** The gain against the criterion, for the fixture's spans and an attack of `attack` seconds. Each failure names its
 * span: `speech span <line>` for the depth, `ducked span <n>` for the ramp. */
function judge(g: Float64Array, attack: number): string[] {
  const f: string[] = [];
  const off = (n: number, want: number): boolean => Math.abs(g[n]! - want) > TOLERANCE;
  for (const s of FIXTURE.speech.spans) {
    const [first, last] = [Math.ceil(s.start / SAMPLE), Math.floor(s.end / SAMPLE)];
    for (let n = first; n <= last; n++) {
      if (!off(n, DEPTH)) continue;
      f.push(`speech span ${s.line} (${(s.start / FLICKS).toFixed(3)} to ${(s.end / FLICKS).toFixed(3)} s): ${n === first ? 'its first sample' : 'it is at depth from its first sample, but'} ${at(n)} has gain ${g[n]!.toFixed(5)}, not the depth ${DEPTH.toFixed(5)} (−12 dB)`);
      break;
    }
  }
  FIXTURE.speech.ducked.forEach((s, i) => {
    const name = `ducked span ${i + 1} (${(s.start / FLICKS).toFixed(3)} to ${(s.end / FLICKS).toFixed(3)} s)`;
    const from = s.start - Math.round(attack * FLICKS);
    const still = Math.floor(from / SAMPLE);
    const first = Math.ceil(s.start / SAMPLE);
    if (off(still, 1)) f.push(`${name}: ${at(still)}, the last at or before its start less ${attack} s, has gain ${g[still]!.toFixed(5)}, not 1: the ramp started early`);
    for (let n = still + 1; n < first; n++) {
      const want = 1 + ((DEPTH - 1) * (n * SAMPLE - from)) / (s.start - from);
      if (!off(n, want)) continue;
      f.push(`${name}: its ramp starts exactly ${attack} s before it, so ${at(n)} has gain ${want.toFixed(5)} on the straight line to the depth; it has ${g[n]!.toFixed(5)}`);
      break;
    }
    if (off(first, DEPTH)) f.push(`${name}: ${at(first)}, its first, has gain ${g[first]!.toFixed(5)}, not the depth ${DEPTH.toFixed(5)}`);
  });
  return f;
}

describe(`${AC[2]} the music bus is at full depth from each speech span's first sample, its ramp starting exactly attack seconds earlier`, () => {
  it(`${AC[2]} under the fixture film's narration the music bus's gain is −12 dB at every sample of each line's speech span, 1 at the last sample 0.2 s before each ducked span and on the straight line to the depth from the next; a twin whose ramp starts 0.1 s late fails, naming the span`, () => {
    expect([FIXTURE.speech.spans.length, FIXTURE.speech.ducked.length], 'the fixture film has three speech spans, the first two joined by merge_gap').toEqual([3, 2]);
    none(judge(musicGain('the fixture film\'s music under its narration'), ATTACK), 'the music bus\'s gain');

    const late = judge(musicGain('the twin with attack 0.1 s', (duck) => { duck['attack'] = 0.1; }), ATTACK);
    failsNaming(late, /^ducked span 1 \(0\.530 to 6\.695 s\): its ramp starts exactly 0\.2 s before it/, 'the twin whose ramp starts 0.1 s late');
  }, TIMEOUT);
});
