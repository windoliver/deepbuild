// #2189.41928b7b: On Metal, an `envelope` call (`deep-gpu run`) with #1903's every-pass scene at 3456 × 2234 (the
// scene in `docs/evidence/1903/run.mts`: showpiece, moving camera) is refused at check: the reply's `code` is
// `refused`, with an `over_budget` issue whose `actual` names the size `[3456, 2234]`, its `gpu_bytes` over 256,000,000
// and `cap_bytes` 256,000,000; or it plays and every fixture's `gpu_memory.peak_bytes` is at most 256,000,000.
//
// #2189.9104323e: The bytes an `over_budget` refusal names for the every-pass scene at 3456 × 2234 are within 10% of
// the 659 MB the device held for it at the floors on the Mac17,10.
//
// One release `deep-gpu run` on this Mac's Metal GPU, one `envelope` call of the every-pass scene at full screen, no
// stub; both tests read its one reply. Off macOS, or with no Metal device, each is skipped as INCONCLUSIVE.
import { describe, expect, it } from 'vitest';
import {
  CAP_BYTES, DEVICE_PEAK_BYTES, FULL_SCREEN, SCENE, bytesOf, envelopeCall, isObject, obj, onMetal, overBudget, playedRows, useOut, useRelease, within, WITHIN,
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
  it('#2189.41928b7b on Metal the every-pass scene at 3456 × 2234 is refused at check naming its size and bytes past 256,000,000, or plays with every fixture\'s peak at most 256,000,000', (ctx) => {
    const r = fullScreen();
    if ('skip' in r) return ctx.skip(r.skip);
    const reply = r.replies[0]!;
    if (reply['code'] !== undefined) {
      // Refused: at check, naming the size, its bytes and the class's cap.
      expect(reply['code'], `the envelope is refused at check, not answered with another code: ${shown(reply)}`).toBe('refused');
      const named = overBudget(reply, FULL_SCREEN);
      expect(named.length, `an over_budget issue whose actual names the size [${FULL_SCREEN.join(', ')}]: ${shown(reply)}`).toBeGreaterThan(0);
      const fits = named.filter((i) => {
        const actual = obj(i['actual'], 'the over_budget issue\'s actual');
        return typeof actual['gpu_bytes'] === 'number' && actual['gpu_bytes'] > CAP_BYTES && actual['cap_bytes'] === CAP_BYTES;
      });
      expect(fits.length, `an over_budget issue naming gpu_bytes over ${CAP_BYTES} and cap_bytes ${CAP_BYTES}: ${JSON.stringify(named)}`).toBeGreaterThan(0);
      return;
    }
    // Played: every fixture it played held at most the cap on the device.
    const played = playedRows(reply);
    expect(played.map((f) => f['fixture']), `the scene played: ${shown(reply)}`).toContain(SCENE);
    const problems: string[] = [];
    for (const f of played) {
      const what = `fixture ${JSON.stringify(f['fixture'])}'s gpu_memory.peak_bytes`;
      const gm = f['gpu_memory'];
      const peak = bytesOf(isObject(gm) ? gm['peak_bytes'] : gm, what, problems);
      if (peak !== null && peak > CAP_BYTES) problems.push(`${what} is ${peak}, over ${CAP_BYTES}`);
    }
    expect(problems, `the every-pass scene at ${SIZE} was admitted, so every fixture's peak is at most ${CAP_BYTES}`).toEqual([]);
  }, 1_800_000);

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
