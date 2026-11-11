// #2189's criterion 1 as amended (#2189.0da003b3), redrafted blind (README): "On Metal, an `envelope` call (`deep-gpu
// run`) with #1903's every-pass scene at 3456 × 2234 (the scene in `docs/evidence/1903/run.mts`: showpiece, moving
// camera) is refused at check: the reply's `code` is `refused`, with an `over_budget` issue whose `actual` names the
// size `[3456, 2234]`, its `gpu_bytes` over 512,000,000 and `cap_bytes` 512,000,000 (the showpiece class's cap since
// #2234); or it plays and every fixture's `gpu_memory.peak_bytes` is at most 512,000,000. On #2185's tip the scene is
// admitted and peaks at 659 MB, which fails."
//
// One release `deep-gpu run` on this Mac's Metal GPU, one `envelope` call of ../2189's every-pass scene at full screen,
// no stub. Off macOS, or with no Metal device, it is skipped as INCONCLUSIVE. ../2189/helpers.ts's CAP_BYTES is the old
// criterion's 256 MB, so this file holds its own cap.
import { describe, expect, it } from 'vitest';
import {
  FULL_SCREEN, SCENE, bytesOf, envelopeCall, isObject, obj, onMetal, overBudget, playedRows, useOut, useRelease, type JsonObject,
} from '../2189/helpers.ts';

/** The showpiece class's GPU memory per window since #2234, as `cap_bytes` names it. */
const CAP_BYTES = 512_000_000;

const bin = useRelease();
const out = useOut();
const SIZE = `${FULL_SCREEN[0]} × ${FULL_SCREEN[1]}`;
const shown = (v: unknown): string => JSON.stringify(v).slice(0, 3000);

describe('#2189 the every-pass scene at full screen, against the showpiece class\'s 512 MB', () => {
  it('#2189.0da003b3 on Metal the every-pass scene at 3456 × 2234 is refused at check naming its size, bytes over 512,000,000 and cap_bytes 512,000,000, or plays with every fixture\'s peak at most 512,000,000', (ctx) => {
    const dir = out();
    const r = onMetal(bin, dir, [envelopeCall(dir, FULL_SCREEN, false)]);
    if ('skip' in r) return ctx.skip(r.skip);
    const reply: JsonObject = r.replies[0]!;
    if (reply['code'] !== undefined) {
      // Refused: at check, naming the size, its bytes and the class's cap.
      expect(reply['code'], `the envelope is refused at check, not answered with another code: ${shown(reply)}`).toBe('refused');
      const named = overBudget(reply, FULL_SCREEN);
      expect(named.length, `an over_budget issue whose actual names the size [${FULL_SCREEN.join(', ')}]: ${shown(reply)}`).toBeGreaterThan(0);
      const actuals = named.map((i, k) => obj(i['actual'], `over_budget issue ${k}'s actual`));
      expect(actuals.map((a) => a['cap_bytes']), `an over_budget issue naming cap_bytes ${CAP_BYTES}, the showpiece class's cap since #2234: ${shown(named)}`).toContain(CAP_BYTES);
      const holds = actuals.filter((a) => a['cap_bytes'] === CAP_BYTES && typeof a['gpu_bytes'] === 'number' && a['gpu_bytes'] > CAP_BYTES);
      expect(holds.length, `an over_budget issue naming gpu_bytes over ${CAP_BYTES} with cap_bytes ${CAP_BYTES}: ${shown(named)}`).toBeGreaterThan(0);
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
});
