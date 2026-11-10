// AC8: "Under a time remap at a constant rate of 0.5, each voice starts at its occurrence's parent flick at its own rate,
// and with `follow_remap` at half rate an octave down; a planted spawn that starts voices at the child flick fails,
// naming the occurrence"
//
// Through `media_mix` (README: The surface under test). The world `lab` plays under the remap `slow`, whose map is the
// linear channel child = parent ÷ 2 (a constant rate of 0.5). Its baked list holds three hits at child flicks 0, 1 s and
// 2.2 s, so their parent flicks are 0, 2 s and 4.4 s (occurrence 0 is the control: there child and parent agree). One
// spawn plays a mono 1 kHz cosine of 0.25 s for each, in two documents: `plain` (follow_remap false) and `follow`
// (follow_remap true). Each voice is read from the reply (`start`, `rate`) and from the samples: its first audible sample
// is its parent flick's sample, nothing sounds in the 0.1 s before it, and it lasts 12,000 samples at 1 kHz (its own
// rate) or 24,000 samples at 500 Hz (half rate, an octave down), by length and by zero crossings.
import { describe, expect, it } from 'vitest';
import {
  AC, RATE, SILENCE, TIMEOUT, asset, atSample, mix, pcmOf, sOf, sampleAt, secs, tone, useEvidence, useShow,
  type MediaDoc, type Mix, type Pcm, type Planted, type Row,
} from './helpers.ts';

const show = useShow();
const evidenceDir = useEvidence();

const LIST = 'lab.occurrences';
const CHILD = [0, secs(1), secs(2.2)];
const LEN = RATE / 4;

function world(evidence: string, follow: boolean): MediaDoc {
  const { sha } = asset(evidence, [tone(1000, LEN, 0.25)]);
  const rows: Row[] = CHILD.map((t, k) => ({ t, kind: 'hit', a: 1 + 2 * k, b: 2 + 2 * k }));
  return {
    transport: { sample_rate: RATE, span: secs(6) },
    occurrences: { [LIST]: rows },
    remaps: { slow: { target: 'lab', map: { keys: [{ t: 0, value: 0, interp: 'linear' }, { t: secs(20), value: secs(10) }] } } },
    spawns: { knock: { on: { list: LIST, kinds: ['hit'] }, play: { asset: sha, in: 0, out: atSample(LEN) }, ...(follow ? { follow_remap: true } : {}) } },
  };
}

const audible = (p: Pcm, n: number): boolean => p.channels.some((c) => Math.abs(c[n - p.first]!) > SILENCE);

/** Each voice against its parent flick and its rate, each line naming the occurrence. */
function judge(m: Mix, p: Pcm, follow: boolean): string[] {
  const f: string[] = [];
  const [num, den] = follow ? [1, 2] : [1, 1];
  CHILD.forEach((child, k) => {
    const parent = 2 * child;
    const s = sampleAt(parent);
    const v = m.voices.find((x) => x.occurrence === k);
    if (!v) { f.push(`occurrence ${k}: no voice in the reply`); return; }
    if (v.start !== parent) f.push(`occurrence ${k}: its voice starts at ${sOf(v.start)}, not at its parent flick ${sOf(parent)} (child ${sOf(child)})`);
    if (v.rate[0] * den !== v.rate[1] * num) f.push(`occurrence ${k}: its voice plays at rate ${v.rate[0]}/${v.rate[1]}, not ${num}/${den}`);

    let first = -1;
    for (let n = Math.max(0, s - RATE / 10); n < s + RATE / 10; n++) if (audible(p, n)) { first = n; break; }
    if (first !== s) { f.push(`occurrence ${k}: its first audible sample after ${sOf(atSample(Math.max(0, s - RATE / 10)))} is ${first < 0 ? 'none' : `${first} (${sOf(atSample(first))})`}, not its parent flick's sample ${s} (${sOf(parent)})`); return; }
    let last = s;
    for (let n = s; n < s + 2 * LEN + RATE / 10; n++) if (audible(p, n)) last = n;
    const len = last - s + 1;
    const want = (LEN * den) / num;
    if (Math.abs(len - want) > 2) f.push(`occurrence ${k}: its voice lasts ${len} samples, not ${want} (the template at rate ${num}/${den})`);
    let crossings = 0;
    const c0 = p.channels[0]!;
    for (let n = s + 2400; n < s + 2400 + 9600; n++) if ((c0[n - p.first]! >= 0) !== (c0[n + 1 - p.first]! >= 0)) crossings++;
    const hz = (crossings / 2) / 0.2;
    if (Math.abs(hz - 1000 * (num / den)) > 10) f.push(`occurrence ${k}: its voice sounds at ${hz} Hz, not ${1000 * (num / den)} Hz`);
  });
  return f;
}

function run(follow: boolean, what: string, planted?: Planted): string[] {
  const evidence = evidenceDir();
  const doc = world(evidence, follow);
  const m = mix(show(), evidence, doc, [{ from: 0, to: doc.transport.span, write: true }], what, planted);
  return judge(m, pcmOf(evidence, m.segments[0]!, planted ? `${what} (planted ${planted})` : what), follow);
}

describe('AC8 voices under a time remap start at their parent flick', () => {
  it(`${AC[8]} under a remap at constant rate 0.5, voices for hits at child 0, 1 s and 2.2 s start at parent 0, 2 s and 4.4 s at their own rate, and with follow_remap at half rate an octave down; a planted spawn that starts voices at the child flick fails, naming occurrence 1`, () => {
    expect(run(false, 'three hits under a 0.5 remap'), 'each voice starts at its parent flick at its own rate').toEqual([]);
    expect(run(true, 'three hits under a 0.5 remap, follow_remap'), 'with follow_remap each voice starts at its parent flick at half rate, an octave down').toEqual([]);

    // Wrong program: a spawn that starts each voice at its occurrence's child flick.
    const planted: Planted = 'spawn_starts_at_child_flick';
    const w = run(false, 'three hits under a 0.5 remap', planted);
    expect(w.length > 0 && w[0]!.startsWith('occurrence 1') && !w.some((l) => l.startsWith('occurrence 0')), `planted ${planted} fails, naming occurrence 1 first (occurrence 0's child and parent flicks agree); got ${JSON.stringify(w)}`).toBe(true);
  }, TIMEOUT);
});
