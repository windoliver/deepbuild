// #2189's criterion 3 as amended (#2189.e5d176fb), redrafted blind (README): "The bytes an `over_budget` refusal names
// for the every-pass scene at 3456 × 2234 are within 10% of the 557,318,144 B the device holds for it at the floors on
// the Mac17,10 since #2691: the 659,161,088 B it held with the mirror at half the full size, less the 101,842,944 B the
// mirror gives back at half the internal size. On #2691's merge base the refusal names 627,985,168 B, which fails."
//
// One release `deep-gpu run` on this Mac's Metal GPU, one `envelope` call of ../2189's every-pass scene at full screen,
// no stub. Off macOS, or with no Metal device, it is skipped as INCONCLUSIVE. ../2189/helpers.ts's DEVICE_PEAK_BYTES is
// the old criterion's 659,161,088, so this file holds the amended figure.
import { describe, expect, it } from 'vitest';
import {
  FULL_SCREEN, WITHIN, bytesOf, envelopeCall, obj, onMetal, overBudget, useOut, useRelease, within, type JsonObject,
} from '../2189/helpers.ts';

/** What the device holds for the scene at the floors on the Mac17,10 since #2691, as the criterion gives it:
 * 659,161,088 − 101,842,944. The issue derived it by that subtraction; no run reads it off a device, since the check
 * refuses the scene at this size before anything draws (README). */
const DEVICE_BYTES = 557_318_144;
/** "Within 10%" of it, in whole bytes: 501,586,330 to 613,049,958. */
const LOW = Math.ceil(DEVICE_BYTES * (1 - WITHIN));
const HIGH = Math.floor(DEVICE_BYTES * (1 + WITHIN));

const bin = useRelease();
const out = useOut();
const SIZE = `${FULL_SCREEN[0]} × ${FULL_SCREEN[1]}`;
const shown = (v: unknown): string => JSON.stringify(v).slice(0, 3000);
/** How far `bytes` are from the figure: "+12.7% (70667024 B over)". */
const far = (bytes: number): string => {
  const off = bytes - DEVICE_BYTES;
  return `${off < 0 ? '−' : '+'}${((Math.abs(off) / DEVICE_BYTES) * 100).toFixed(1)}% (${Math.abs(off)} B ${off < 0 ? 'under' : 'over'})`;
};

describe('#2189 the bytes the full-screen refusal names, against what the device holds since #2691', () => {
  it('#2189.e5d176fb the bytes the over_budget refusal names for the every-pass scene at 3456 × 2234 are within 10% of the 557,318,144 the device holds at the floors since #2691', (ctx) => {
    const dir = out();
    const r = onMetal(bin, dir, [envelopeCall(dir, FULL_SCREEN, false)]);
    if ('skip' in r) return ctx.skip(r.skip);
    const reply: JsonObject = r.replies[0]!;
    expect(reply['code'], `the every-pass scene at ${SIZE} is refused at check: ${shown(reply)}`).toBe('refused');
    const named = overBudget(reply, FULL_SCREEN);
    expect(named.length, `an over_budget issue whose actual names the size [${FULL_SCREEN.join(', ')}]: ${shown(reply)}`).toBeGreaterThan(0);
    const problems: string[] = [];
    named.forEach((i, k) => {
      const what = `over_budget issue ${k}'s actual.gpu_bytes`;
      const bytes = bytesOf(obj(i['actual'], `over_budget issue ${k}'s actual`)['gpu_bytes'], what, problems);
      if (bytes !== null && !within(bytes, DEVICE_BYTES)) problems.push(`${what} is ${bytes}: ${far(bytes)} from the ${DEVICE_BYTES} the device holds, past 10%`);
    });
    expect(problems, `the refusal names bytes within 10% of ${DEVICE_BYTES} (${LOW} to ${HIGH})`).toEqual([]);
  }, 1_800_000);
});
