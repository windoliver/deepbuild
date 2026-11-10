// AC3: "Two parallel paths into one bus, one through a limiter with 5 ms lookahead, stay aligned within one sample at
// 48 kHz; a planted mix without latency compensation is 240 samples late and fails, naming the bus"
//
// Through `media_mix` (README: The surface under test). Two strips start together: one plays a click on the left
// channel only into bus `dry` (no processors), the other the same click on the right channel only into bus `limited`,
// whose one processor `look` is a limiter with `lookahead: 0.005` (its other fields at the row's defaults; the click,
// 0.25 at 0.5 s, is under the ceiling). Both buses go out to bus `group`, then the master, so in the master's output
// the left channel is the dry path and the right channel the limited one. The two clicks must land within one sample
// of each other. The planted `mix_without_latency_compensation` delays nothing, so the limited path's click lands 240
// samples (5 ms) late.
import { describe, expect, it } from 'vitest';
import { AC, RATE, TIMEOUT, impulse, loudestOn, mixes, pcm, putSignal, secs, useEvidence, useShow, type MediaDoc, type Planted } from './helpers.ts';

const show = useShow();
const evidenceDir = useEvidence();

/** How many samples the limited path's click lands after the dry path's, and what is wrong, each line naming the bus. */
function paths(planted?: Planted): { late: number; f: string[] } {
  const evidence = evidenceDir();
  const at = RATE / 2;
  const silent = new Float32Array(RATE);
  const left = putSignal(evidence, [impulse(RATE, at, 0.25), silent]);
  const right = putSignal(evidence, [silent, impulse(RATE, at, 0.25)]);
  const doc: MediaDoc = {
    strips: { dry_click: { track: 0, asset: left, bus: 'dry' }, limited_click: { track: 1, asset: right, bus: 'limited' } },
    buses: { dry: { out: 'group' }, limited: { processors: ['look'], out: 'group' }, group: { out: 'master' } },
    processors: { look: { kind: 'limiter', lookahead: 0.005 } },
  };
  const [m] = mixes(show(), evidence, [{ doc, segments: [{ from: 0, to: secs(1), write: true }] }], 'a click down two parallel paths into bus group', planted);
  const p = pcm(evidence, m!.segments[0]!, 'the master\'s output');
  const dry = loudestOn(p, 0, 0, RATE);
  const limited = loudestOn(p, 1, 0, RATE);
  const f: string[] = [];
  if (dry.value < 0.1) f.push(`bus \`group\`: its dry input from bus \`dry\` isn't heard (largest left sample ${dry.value})`);
  if (limited.value < 0.1) f.push(`bus \`group\`: its input from bus \`limited\`, through the limiter \`look\`, isn't heard (largest right sample ${limited.value})`);
  const late = limited.at - dry.at;
  if (Math.abs(late) > 1) f.push(`bus \`group\`: its input through the limiter \`look\` lands ${late} samples after its dry input (sample ${limited.at} against ${dry.at}), more than one sample apart at 48 kHz`);
  return { late, f };
}

describe('AC3 latency is compensated across parallel paths', () => {
  it(`${AC[3]} a click down a dry path and down a path through a 5 ms lookahead limiter, both into bus \`group\`, lands within one sample on both at 48 kHz; a planted mix without latency compensation is 240 samples late and fails, naming the bus \`group\``, () => {
    const clean = paths();
    expect(clean.f, 'the two paths into bus `group` stay aligned within one sample').toEqual([]);

    // Wrong program: a mix without latency compensation.
    const w = paths('mix_without_latency_compensation');
    expect(Math.abs(w.late - 240) <= 1 && w.f.some((l) => l.startsWith('bus `group`:')), `planted mix_without_latency_compensation is 240 samples late and fails, naming the bus \`group\`; got ${w.late} samples late, ${JSON.stringify(w.f)}`).toBe(true);
  }, TIMEOUT);
});
