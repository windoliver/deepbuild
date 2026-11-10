// AC5: "A send tapped pre and one tapped post a 6 dB gain cut on their bus carry the levels their tap gives, within
// 0.05 dB; a planted send that always taps post fails, naming the send"
//
// Through `media_mix` (README: The surface under test). A 1 kHz sine (0.25, both channels) plays into bus `voice`,
// whose gain is −6 dB and whose sends are `[{to: pre_fx, gain: 0, tap: pre}, {to: post_fx, gain: 0, tap: post}]`;
// `voice` itself goes out to bus `sink`, which is muted, so the master hears only what the sends carry. Two mixes in one
// scenario listen to one send each, the other send's destination muted. Over 0.25 to 0.75 s each send's level, the
// master's power against the source's, must be what its tap gives: 0 dB for the pre send (before the cut), −6 dB for
// the post send (after it), within 0.05 dB. The planted `send_always_post` takes the pre send after the cut too, so it
// reads −6 dB.
import { describe, expect, it } from 'vitest';
import { AC, RATE, TIMEOUT, fmt, mixes, pcm, power, putSignal, secs, sine, useEvidence, useShow, type MediaDoc, type Planted, type Segment } from './helpers.ts';

const show = useShow();
const evidenceDir = useEvidence();

const SENDS = [
  { name: 'buses.voice.sends[0] (to pre_fx, tap pre)', listen: 'pre', want: 0 },
  { name: 'buses.voice.sends[1] (to post_fx, tap post)', listen: 'post', want: -6 },
] as const;

/** Each send's level against the source's, and what is wrong, each line naming the send. */
function sends(planted?: Planted): { levels: number[]; f: string[] } {
  const evidence = evidenceDir();
  const tone = sine(1000, RATE, 0.25);
  const asset = putSignal(evidence, [tone, tone]);
  const doc = (listen: 'pre' | 'post'): MediaDoc => ({
    strips: { tone: { track: 0, asset, bus: 'voice' } },
    buses: {
      voice: { gain: -6, out: 'sink', sends: [{ to: 'pre_fx', gain: 0, tap: 'pre' }, { to: 'post_fx', gain: 0, tap: 'post' }] },
      sink: { mute: true, out: 'master' },
      pre_fx: { mute: listen !== 'pre', out: 'master' },
      post_fx: { mute: listen !== 'post', out: 'master' },
    },
  });
  const segments: Segment[] = [{ from: 0, to: secs(1), write: true }];
  const ms = mixes(show(), evidence, SENDS.map((s) => ({ doc: doc(s.listen), segments })), 'a sine into a bus cut 6 dB, heard through its pre send, then its post send', planted);
  const [from, to] = [RATE / 4, (3 * RATE) / 4];
  let src = 0;
  for (let n = from; n < to; n++) src += tone[n]! ** 2;
  src /= to - from;
  const f: string[] = [];
  const levels = SENDS.map((s, i) => {
    const level = 10 * Math.log10(power(pcm(evidence, ms[i]!.segments[0]!, `the master, hearing ${s.name}`), from, to) / src);
    if (!(Math.abs(level - s.want) <= 0.05)) f.push(`send ${s.name}: carries ${fmt(level)} dB of its bus's input, not the ${s.want} dB its tap gives ±0.05`);
    return level;
  });
  return { levels, f };
}

describe('AC5 a send carries its bus before or after its gain, as its tap says', () => {
  it(`${AC[5]} on a bus cut 6 dB, its send tapped pre carries 0 dB and its send tapped post −6 dB of the bus's input, within 0.05 dB; a planted send that always taps post fails, naming the send buses.voice.sends[0]`, () => {
    const clean = sends();
    expect(clean.f, 'each send carries the level its tap gives').toEqual([]);

    // Wrong program: a send that always taps post.
    const w = sends('send_always_post');
    expect(w.f.some((l) => l.startsWith(`send ${SENDS[0].name}:`)), `planted send_always_post fails, naming the send ${SENDS[0].name}; levels ${JSON.stringify(w.levels.map(fmt))}, failures ${JSON.stringify(w.f)}`).toBe(true);
  }, TIMEOUT);
});
