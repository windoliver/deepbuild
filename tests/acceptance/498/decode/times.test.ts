// AC7: a 30 fps MP4 with time base 1/15360 and a variable-rate screen recording whose frame 10 lasts three nominal
// frames each probe with every frame's presentation time as an exact rational, the second with `frame_rate:
// variable`; a planted probe that rounds times to flicks fails on the first, naming the frame. Scope held here: the
// probe keeps each time as a rational in the stream's own time base, never rounded to flicks.

import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CFR30_PTS, R, VFR_PTS, assetOf, cfr30, mediaImport, probeFixture, rat, ratEq, runShow, screenVfr, showRat, useShow, useTemp,
  videoStream, type Planted, type Rat,
} from './helpers.ts';

const show = useShow();
const temp = useTemp('times');

interface Want { name: string; path: string; tb: Rat; frameRate: Rat | 'variable'; ticks: number[] }

/** What is wrong with one fixture's probe: its time base, its frame rate, and each frame's time, the first wrong frame
 * named by its index. Times are compared as integers: the reply's [num, den] must have den equal to the stream's time
 * base denominator (its own ticks) and num the frame's tick count times the time base numerator. */
function probeProblems(reply: Parameters<typeof assetOf>[0], w: Want): string[] {
  const f: string[] = [];
  const v = videoStream(assetOf(reply, `probing ${w.name}`), `probing ${w.name}`);
  if (v.time_base.n !== w.tb.n || v.time_base.d !== w.tb.d) f.push(`${w.name}: time_base is ${showRat(v.time_base)}, not the stream's own ${showRat(w.tb)}`);
  if (w.frameRate === 'variable') {
    if (v.frame_rate !== 'variable') f.push(`${w.name}: frame_rate is ${v.frame_rate === null ? 'missing' : showRat(v.frame_rate)}, not variable, though frame 10 lasts three frames`);
  } else if (v.frame_rate === 'variable' || v.frame_rate === null || !ratEq(v.frame_rate, w.frameRate)) {
    f.push(`${w.name}: frame_rate is ${v.frame_rate === 'variable' || v.frame_rate === null ? String(v.frame_rate) : showRat(v.frame_rate)}, not ${showRat(w.frameRate)}`);
  }
  const pts = v.pts!;
  if (pts.length !== w.ticks.length) f.push(`${w.name}: the probe lists ${pts.length} frame times, the stream has ${w.ticks.length} frames`);
  for (let k = 0; k < Math.min(pts.length, w.ticks.length); k++) {
    const raw = pts[k];
    const exact = Array.isArray(raw) && raw.length === 2 && Number.isSafeInteger(raw[0]) && Number.isSafeInteger(raw[1]) && (raw[1] as number) > 0;
    if (!exact) {
      f.push(`${w.name}: frame ${k} is presented at ${JSON.stringify(raw)}, not an exact rational [num, den]`);
      break;
    }
    const got = rat(raw, `${w.name}: pts[${k}]`);
    const want: Rat = { n: BigInt(w.ticks[k]!) * w.tb.n, d: w.tb.d };
    if (got.d !== w.tb.d || got.n !== want.n) {
      f.push(`${w.name}: frame ${k} is presented at ${showRat(got)} s, not ${showRat(want)} s (${w.ticks[k]} ticks of ${showRat(w.tb)})`);
      break; // the first wrong frame names the failure; the rest follow from it
    }
  }
  return f;
}

describe('AC7 every frame\'s presentation time as an exact rational in the stream\'s own time base', () => {
  it('AC7 a 30 fps MP4 at time base 1/15360 probes with frame k at (512k + 1)/15360 s and frame_rate 30/1; a 60 fps screen recording at 1/600 whose frame 10 lasts three frames probes with every frame\'s time and frame_rate variable', () => {
    const dir = temp();
    const a = join(dir, 'cfr30-tb15360.mp4');
    const b = join(dir, 'screen-recording-vfr.mov');
    cfr30(a);
    screenVfr(b);
    // The fixtures are what their recipes say (ffprobe reads them; it is never the probe under test).
    for (const [path, tb, ticks] of [[a, '1/15360', CFR30_PTS], [b, '1/600', VFR_PTS]] as const) {
      const p = probeFixture(path);
      expect(p.tb, `fixture ${path}: ffprobe's time base (the recipe broke if not)`).toBe(tb);
      expect(p.pts, `fixture ${path}: ffprobe's presentation times (the recipe broke if not)`).toEqual(ticks);
    }
    const wants: Want[] = [
      { name: 'the 30 fps MP4', path: a, tb: R(1, 15360), frameRate: R(30, 1), ticks: CFR30_PTS },
      { name: 'the screen recording', path: b, tb: R(1, 600), frameRate: 'variable', ticks: VFR_PTS },
    ];
    const check = (planted?: Planted): string[][] => {
      const { replies } = runShow(show(), { evidence: temp(), ...(planted ? { planted } : {}) }, wants.map((w) => mediaImport(w.path)), planted ? `planted ${planted}` : 'the two probes');
      return wants.map((w, i) => probeProblems(replies[i]!, w));
    };
    const [first, second] = check();
    expect(first, 'the 30 fps MP4 probes exactly').toEqual([]);
    expect(second, 'the screen recording probes exactly, frame_rate variable').toEqual([]);
    // The wrong program: a probe that rounds each time to the nearest flick. 1/15360 s is 45,937.5 flicks, so every
    // frame of the first fixture moves; this check fails on it, naming frame 0.
    const [wrongFirst] = check('probe_rounds_to_flicks');
    expect(wrongFirst!.some((s) => s.startsWith('the 30 fps MP4: frame 0 is presented at')), `planted probe_rounds_to_flicks fails on the first fixture, naming frame 0; got ${JSON.stringify(wrongFirst)}`).toBe(true);
  }, 900_000);
});
