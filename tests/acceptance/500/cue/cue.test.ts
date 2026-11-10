// AC2: "A click cued 10 ms after a 24 fps frame boundary sounds on the next boundary, 31.67 ms later, never before its
// picture, and a cue whose anchor doesn't resolve is BLOCKED naming it"
//
// Through `media_mix` (README: The surface under test). A 24 fps document holds a strip `click` whose asset is 96 samples
// of digital silence and then a click (its onset, the attack start, at source sample 96), and a cue `press` that moves
// it (`move: sound`, `anchor: onset`, `land` left at its default, frame) to the moment 1.010 s: 10 ms after the frame
// boundary at 1 s. The first frame that shows that moment is frame 25, at 25/24 s = 735,000,000 flicks (sample 50,000),
// 22,344,000 flicks (31.67 ms) after it. Read twice: the reply's `cues.press.lands`, and the samples, silent before
// sample 50,000 and sounding at it. A second document cues a strip of pure silence by its onset, which a bake can't
// find; that cue, `hush_cue`, answers BLOCKED with a reason that names it.
import { describe, expect, it } from 'vitest';
import {
  AC, RATE, SILENCE, TIMEOUT, asset, atSample, level, mix, noise, pcmOf, sOf, secs, useEvidence, useShow, type MediaDoc,
} from './helpers.ts';

const show = useShow();
const evidenceDir = useEvidence();

const FRAME = 705_600_000 / 24; // 29,400,000 flicks
const MOMENT = 712_656_000; // 1.010 s
const LANDS = 735_000_000; // ⌈MOMENT ÷ FRAME⌉ × FRAME = 25/24 s

describe('AC2 a click cued by its onset lands on the first frame that shows its moment', () => {
  it(`${AC[2]} a click cued 10 ms after the 24 fps boundary at 1 s lands on 25/24 s, 31.67 ms later, by the reply and by the samples, never before its picture; a cue whose onset anchor doesn't resolve is BLOCKED, naming it`, () => {
    // The numbers the criterion states (checked here, so a wrong value in this file fails, not the program).
    expect([MOMENT - 24 * FRAME, Math.ceil(MOMENT / FRAME) * FRAME, ((LANDS - MOMENT) / 705_600).toFixed(2)]).toEqual([secs(0.01), LANDS, '31.67']);

    const evidence = evidenceDir();
    const len = 2400;
    const x = new Float32Array(len);
    const n = noise(len, 1, 500_002);
    for (let i = 96; i < len; i++) x[i] = i === 96 ? 0.8 : 0.8 * Math.exp(-(i - 96) / 240) * n[i]!;
    const click = asset(evidence, x);
    const hush = asset(evidence, new Float32Array(len));
    const transport = { sample_rate: RATE, frame_rate: [24, 1] as [number, number], span: secs(2) };
    const cued: MediaDoc = {
      transport,
      strips: { click: { track: 0, asset: click, start: 0, in: 0, out: atSample(len) } },
      cues: { press: { cue: 'click', anchor: 'onset', moment: MOMENT, move: 'sound' } },
    };
    const unresolved: MediaDoc = {
      transport,
      strips: { hush: { track: 0, asset: hush, start: 0, in: 0, out: atSample(len) } },
      cues: { hush_cue: { cue: 'hush', anchor: 'onset', moment: MOMENT, move: 'sound' } },
    };
    const [a, b] = mix(show(), evidence, [
      { doc: cued, segments: [{ from: 0, to: transport.span, write: true }] },
      { doc: unresolved, segments: [{ from: 0, to: transport.span }] },
    ], 'a click cued to 1.010 s, and a cue on silence');

    const f: string[] = [];
    const press = a!.cues['press']!;
    if (press.state !== 'resolved') f.push(`cue \`press\` is ${press.state} (${press.reason}), not resolved`);
    else if (press.lands !== LANDS) f.push(`cue \`press\` lands at ${press.lands} (${sOf(press.lands)}), not on frame 25 at ${LANDS} (${sOf(LANDS)})`);
    const p = pcmOf(evidence, a!.segments[0]!, 'the cued click');
    const s = LANDS / (705_600_000 / RATE); // sample 50,000
    let early = -1;
    for (let k = 0; k < s; k++) if (level(p, k) > SILENCE) { early = k; break; }
    if (early >= 0) f.push(`the click sounds before its picture: sample ${early} (${sOf(atSample(early))}) reads ${level(p, early)}, before frame 25's sample ${s}`);
    if (!(level(p, s) >= 0.1)) f.push(`the click doesn't sound on frame 25: sample ${s} reads ${level(p, s)}`);

    const blocked = b!.cues['hush_cue']!;
    if (blocked.state !== 'BLOCKED') f.push(`cue \`hush_cue\`, whose onset anchor can't resolve on silence, is ${blocked.state}, not BLOCKED`);
    else if (!blocked.reason.includes('hush_cue')) f.push(`cue \`hush_cue\` is BLOCKED, but its reason doesn't name it: ${JSON.stringify(blocked.reason)}`);
    expect(f, 'the click lands on the first frame that shows its moment, and an unresolved anchor is BLOCKED and named').toEqual([]);
  }, TIMEOUT);
});
