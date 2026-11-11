// #2189.41928b7b (criterion 1 before #2234 amended it to the showpiece's 512 MB) is tested by
// ../2189-redraft-ac1/ as #2189.0da003b3.
//
// #2189.9104323e: The bytes an `over_budget` refusal names for the every-pass scene at 3456 × 2234 are within 10% of
// the 659 MB the device held for it at the floors on the Mac17,10.
//
// One release `deep-gpu run` on this Mac's Metal GPU, one `envelope` call of the every-pass scene at full screen, no
// stub; both tests read its one reply. Off macOS, or with no Metal device, each is skipped as INCONCLUSIVE.
import { describe, expect, it } from 'vitest';
import {
  DEVICE_PEAK_BYTES, FULL_SCREEN, bytesOf, envelopeCall, obj, onMetal, overBudget, useOut, useRelease, within, WITHIN,
  type JsonObject, type OnMetal,
} from './helpers.ts';

const bin = useRelease();
const out = useOut();
const SIZE = `${FULL_SCREEN[0]} × ${FULL_SCREEN[1]}`;

/** The full-screen call's outcome (or its failure), run once for both tests. */
let shared: { outcome: OnMetal } | { failed: unknown } | undefined;
function fullScreen(): OnMetal {
  if (shared === undefined) {
    const dir = out();
    try { shared = { outcome: onMetal(bin, dir, [envelopeCall(dir, FULL_SCREEN, false)]) }; } catch (failed) { shared = { failed }; }
  }
  if ('failed' in shared) throw shared.failed;
  return shared.outcome;
}
const shown = (reply: JsonObject): string => JSON.stringify(reply).slice(0, 3000);

describe('#2189 the every-pass scene at full screen', () => {
  it('#2189.9104323e the bytes the over_budget refusal names for the every-pass scene at 3456 × 2234 are within 10% of the 659,161,088 the device held', (ctx) => {
    const r = fullScreen();
    if ('skip' in r) return ctx.skip(r.skip);
    const reply = r.replies[0]!;
    expect(reply['code'], `the every-pass scene at ${SIZE} is refused at check: ${shown(reply)}`).toBe('refused');
    const named = overBudget(reply, FULL_SCREEN);
    expect(named.length, `an over_budget issue whose actual names the size [${FULL_SCREEN.join(', ')}]: ${shown(reply)}`).toBeGreaterThan(0);
    const problems: string[] = [];
    named.forEach((i, k) => {
      const what = `over_budget issue ${k}'s actual.gpu_bytes`;
      const bytes = bytesOf(obj(i['actual'], `over_budget issue ${k}'s actual`)['gpu_bytes'], what, problems);
      if (bytes !== null && !within(bytes, DEVICE_PEAK_BYTES)) {
        problems.push(`${what} is ${bytes}, ${(((bytes - DEVICE_PEAK_BYTES) / DEVICE_PEAK_BYTES) * 100).toFixed(1)}% from the device's ${DEVICE_PEAK_BYTES}`);
      }
    });
    expect(problems, `the refusal names bytes within 10% of ${DEVICE_PEAK_BYTES} (${Math.ceil(DEVICE_PEAK_BYTES * (1 - WITHIN))} to ${Math.floor(DEVICE_PEAK_BYTES * (1 + WITHIN))})`).toEqual([]);
  }, 1_800_000);
});
