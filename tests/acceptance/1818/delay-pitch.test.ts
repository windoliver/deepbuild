// AC4: "A delay of 0.25 s with feedback 0.5 and mix 1 gives echoes 0.25 s apart, each 6.02 dB below the last within
// 0.05 dB, and a pitch processor at +12 semitones moves a 440 Hz sine's measured fundamental to 880 Hz within 1 Hz; a
// planted pitch that ignores its semitones fails, naming the processor"
//
// Through `media_mix` (README: The surface under test), two mixes in one scenario. The delay: a click (0.5 at 0.1 s,
// both channels) into a bus whose one processor `echo` is `{kind: delay, time: 0.25, feedback: 0.5, mix: 1}`; the
// first six echoes are found as the loudest sample within 0.125 s of 0.1 s + k × 0.25 s, each must lie 12,000 samples
// (0.25 s) from the last within one sample, and each echo's energy (both channels, 48 samples either side) must be
// 6.02 dB under the last within 0.05 dB. The pitch: a 440 Hz sine (0.25, both channels, 2.5 s) into a bus whose one
// processor `octave` is `{kind: pitch, semitones: 12}` (window at the row's default); the fundamental measured over
// 0.5 to 1.5 s of the left channel (README: Readings) must read 880 Hz within 1 Hz. The planted
// `pitch_ignores_semitones` leaves the sine at 440 Hz.
import { describe, expect, it } from 'vitest';
import {
  AC, RATE, TIMEOUT, fundamental, impulse, loudestOn, mixes, pcm, putSignal, secs, sine, span, useEvidence, useShow,
  type MediaDoc, type Pcm, type Planted,
} from './helpers.ts';

const show = useShow();
const evidenceDir = useEvidence();

const T = RATE / 4; // 0.25 s
const CLICK = RATE / 10; // 0.1 s
const ECHOES = 6;

/** What is wrong with the echoes, each line naming the delay `echo`. */
function echoProblems(p: Pcm): string[] {
  const f: string[] = [];
  const found = Array.from({ length: ECHOES }, (_, i) => {
    const centre = CLICK + (i + 1) * T;
    const { at, value } = loudestOn(p, 0, centre - T / 2, centre + T / 2);
    let energy = 0;
    for (const c of p.channels) for (let n = at - 48; n <= at + 48; n++) energy += c[n - p.first]! ** 2;
    return { at, value, energy };
  });
  if (found[0]!.value < 0.1) return [`processor \`echo\` (delay 0.25 s, feedback 0.5, mix 1): no first echo near ${(CLICK + T) / RATE} s (largest sample ${found[0]!.value})`];
  for (let k = 1; k < ECHOES; k++) {
    const gap = found[k]!.at - found[k - 1]!.at;
    if (Math.abs(gap - T) > 1) f.push(`processor \`echo\`: echo ${k + 1} lands ${gap} samples (${(gap / RATE).toFixed(6)} s) after echo ${k}, not 12,000 (0.25 s) within one sample`);
    const drop = 10 * Math.log10(found[k - 1]!.energy / found[k]!.energy);
    if (!(Math.abs(drop - 6.02) <= 0.05)) f.push(`processor \`echo\`: echo ${k + 1} is ${drop.toFixed(4)} dB below echo ${k}, not 6.02 ±0.05`);
  }
  return f;
}

/** The delay's problems and the pitch's measured fundamental, and its problem naming the pitch `octave`. */
function run(planted?: Planted): { echo: string[]; hz: number; pitch: string[] } {
  const evidence = evidenceDir();
  const click = impulse(RATE / 5, CLICK, 0.5);
  const tone = sine(440, (5 * RATE) / 2, 0.25);
  const echoDoc: MediaDoc = {
    strips: { click: { track: 0, asset: putSignal(evidence, [click, click]), bus: 'room' } },
    buses: { room: { processors: ['echo'], out: 'master' } },
    processors: { echo: { kind: 'delay', time: 0.25, feedback: 0.5, mix: 1 } },
  };
  const pitchDoc: MediaDoc = {
    strips: { a440: { track: 0, asset: putSignal(evidence, [tone, tone]), bus: 'voice' } },
    buses: { voice: { processors: ['octave'], out: 'master' } },
    processors: { octave: { kind: 'pitch', semitones: 12 } },
  };
  const [e, p] = mixes(show(), evidence, [
    { doc: echoDoc, segments: [{ from: 0, to: secs(2), write: true }] },
    { doc: pitchDoc, segments: [{ from: 0, to: secs(2.5), write: true }] },
  ], 'a click through a delay, and a 440 Hz sine through a pitch shift', planted);
  const echo = echoProblems(pcm(evidence, e!.segments[0]!, 'the delay\'s output'));
  const hz = fundamental(span(pcm(evidence, p!.segments[0]!, 'the pitch\'s output'), 0, RATE / 2, (3 * RATE) / 2));
  const pitch = Math.abs(hz - 880) <= 1 ? [] : [`processor \`octave\` (pitch +12 semitones): the 440 Hz sine's measured fundamental is ${hz.toFixed(2)} Hz, not 880 ±1`];
  return { echo, hz, pitch };
}

describe('AC4 the delay\'s echoes and the pitch\'s octave', () => {
  it(`${AC[4]} a delay of 0.25 s, feedback 0.5 and mix 1 gives echoes 0.25 s apart, each 6.02 dB below the last within 0.05 dB, and a pitch of +12 semitones moves a 440 Hz sine's measured fundamental to 880 Hz within 1 Hz; a planted pitch that ignores its semitones fails, naming the processor \`octave\``, () => {
    const clean = run();
    expect([...clean.echo, ...clean.pitch], 'the echoes fall 6.02 dB every 0.25 s, and the octave measures 880 Hz').toEqual([]);

    // Wrong program: a pitch that ignores its semitones.
    const w = run('pitch_ignores_semitones');
    expect(w.pitch.some((l) => l.startsWith('processor `octave`')), `planted pitch_ignores_semitones fails, naming the processor \`octave\`; measured ${w.hz.toFixed(2)} Hz, failures ${JSON.stringify(w.pitch)}`).toBe(true);
  }, TIMEOUT);
});
