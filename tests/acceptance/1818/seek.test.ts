// AC6: "With compressor, limiter, delay and pitch in one chain, a seek to 9 s then play to 10 s equals playing straight
// bit for bit by PCM hash on one build and architecture; a planted delay that empties its line at the seek fails,
// naming the processor"
//
// Through `media_mix` (README: The surface under test): one transport plays its segments in order, so a segment whose
// `from` isn't where the one before ended is a seek, in the same process, build and architecture as the play it is
// compared with (#499's convention). A 10 s stereo noise bed plays into bus `chain`, whose processors are, in order,
// `comp` (a compressor with auto makeup, so the limiter after it works), `lim` (a limiter at the row's defaults),
// `echo` (a delay of 0.3 s, feedback 0.6, mix 0.5) and `shift` (a pitch of +7 semitones). The segments are 0 to 9 s,
// 9 to 10 s, then a seek back to 9 s and 9 to 10 s again: the master's PCM hash and each processor's output hash
// (`taps`) over the two 9-to-10 s segments must be equal. A failure names the first processor in the chain whose output
// after the seek differs; the planted `delay_empties_line_at_seek` must be named `echo`, the compressor and limiter
// before it unchanged.
import { describe, expect, it } from 'vitest';
import { AC, RATE, TIMEOUT, loudestOn, mixes, noise, pcm, putSignal, secs, useEvidence, useShow, type MediaDoc, type MixReply, type Planted, type Segment } from './helpers.ts';

const show = useShow();
const evidenceDir = useEvidence();

const ORDER = ['comp', 'lim', 'echo', 'shift'] as const;
const KIND = { comp: 'compressor', lim: 'limiter', echo: 'delay', shift: 'pitch' } as const;
const NINE = secs(9);
const TEN = secs(10);
const SEGMENTS: Segment[] = [{ from: 0, to: NINE }, { from: NINE, to: TEN, write: true }, { from: NINE, to: TEN }];

function chain(planted?: Planted): { m: MixReply; evidence: string } {
  const evidence = evidenceDir();
  const asset = putSignal(evidence, [noise(10 * RATE, 0.5, 1818_01), noise(10 * RATE, 0.5, 1818_02)]);
  const doc: MediaDoc = {
    strips: { bed: { track: 0, asset, bus: 'chain' } },
    buses: { chain: { processors: [...ORDER], out: 'master' } },
    processors: {
      comp: { kind: 'compressor', makeup: 'auto' },
      lim: { kind: 'limiter' },
      echo: { kind: 'delay', time: 0.3, feedback: 0.6, mix: 0.5 },
      shift: { kind: 'pitch', semitones: 7 },
    },
  };
  const [m] = mixes(show(), evidence, [{ doc, segments: SEGMENTS }], 'a noise bed through compressor, limiter, delay and pitch, played to 10 s then seeked to 9 s', planted);
  return { m: m!, evidence };
}

/** What is wrong with the seek against the play it repeats, and the first processor in the chain whose output differs. */
function seekProblems(m: MixReply): { f: string[]; named: string | null } {
  const f: string[] = [];
  const [play, seek] = [m.segments[1]!, m.segments[2]!];
  for (const id of ORDER) if (m.processors[id]?.kind !== KIND[id]) f.push(`processor \`${id}\`: reported as ${JSON.stringify(m.processors[id]?.kind)}, not ${KIND[id]}`);
  let named: string | null = null;
  for (const id of ORDER) {
    if (play.taps[id] === undefined || seek.taps[id] === undefined) { f.push(`processor \`${id}\`: no output hash (taps.${id}) on the play or the seek`); continue; }
    if (play.taps[id] !== seek.taps[id]) {
      named = id;
      f.push(`processor \`${id}\`: its output after the seek to 9 s differs from playing straight to 10 s (tap ${seek.taps[id]} against ${play.taps[id]})`);
      break;
    }
  }
  if (play.sha256 !== seek.sha256) f.push(`the master's PCM from 9 to 10 s after the seek differs from playing straight by hash (${seek.sha256} against ${play.sha256})`);
  return { f, named };
}

describe('AC6 seeking a chain of compressor, limiter, delay and pitch equals playing it', () => {
  it(`${AC[6]} a noise bed through comp, lim, echo and shift, played to 10 s, then seeked to 9 s and played to 10 s, gives the same PCM hash and processor output hashes from 9 to 10 s; a planted delay that empties its line at the seek fails, naming the processor \`echo\``, () => {
    const { m, evidence } = chain();
    const played = pcm(evidence, m.segments[1]!, 'playing straight from 9 to 10 s');
    const loud = Math.max(loudestOn(played, 0, played.first, played.first + played.frames).value, loudestOn(played, 1, played.first, played.first + played.frames).value);
    expect(loud > 1e-3, `the chain's output from 9 to 10 s isn't silent (largest sample ${loud})`).toBe(true);
    expect(seekProblems(m).f, 'the seek to 9 s then play to 10 s equals playing straight, bit for bit').toEqual([]);

    // Wrong program: a delay that empties its line at the seek.
    const w = seekProblems(chain('delay_empties_line_at_seek').m);
    expect(w.named, `planted delay_empties_line_at_seek fails, naming the processor \`echo\` (the compressor and limiter before it unchanged); got ${JSON.stringify(w.f)}`).toBe('echo');
  }, TIMEOUT);
});
