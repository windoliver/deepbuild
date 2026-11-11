// #2189.39fdadfa: On Metal, the same scene and `separate-items` (with its instanced twin), each played by an
// `envelope` call at 1280 × 800, report `gpu_memory.estimate_bytes` within 10% of `gpu_memory.peak_bytes`.
//
// One release `deep-gpu run` on this Mac's Metal GPU, one `envelope` call at 1280 × 800 with the every-pass scene and
// `separate-items` with its instanced twin, no stub. The twin has no row of its own in the reply (#1903), so the rows
// read are `scene` and `separate-items`. Off macOS, or with no Metal device, the test is skipped as INCONCLUSIVE.
import { describe, expect, it } from 'vitest';
import {
  SCENE, SEPARATE_ITEMS, SMALL, bytesOf, envelopeCall, isObject, onMetal, playedRows, useOut, useRelease, within,
} from './helpers.ts';

const bin = useRelease();
const out = useOut();

describe('#2189 the estimate beside the peak', () => {
  it('#2189.39fdadfa on Metal the every-pass scene and separate-items at 1280 × 800 each report gpu_memory.estimate_bytes within 10% of gpu_memory.peak_bytes', (ctx) => {
    const dir = out();
    const r = onMetal(bin, dir, [envelopeCall(dir, SMALL, true)]);
    if ('skip' in r) return ctx.skip(r.skip);
    const reply = r.replies[0]!;
    expect(reply['code'], `the envelope at ${SMALL[0]} × ${SMALL[1]} is answered, not refused: ${JSON.stringify(reply).slice(0, 3000)}`).toBeUndefined();
    const rows = playedRows(reply);
    const problems: string[] = [];
    for (const fixture of [SCENE, SEPARATE_ITEMS]) {
      const row = rows.find((f) => f['fixture'] === fixture);
      if (row === undefined) { problems.push(`no ${fixture} row was played: ${JSON.stringify(rows.map((f) => [f['fixture'], f['why']]))}`); continue; }
      const gm = row['gpu_memory'];
      if (!isObject(gm)) { problems.push(`${fixture}'s gpu_memory is an object, got ${JSON.stringify(gm)}`); continue; }
      const peak = bytesOf(gm['peak_bytes'], `${fixture}'s gpu_memory.peak_bytes`, problems);
      const estimate = bytesOf(gm['estimate_bytes'], `${fixture}'s gpu_memory.estimate_bytes`, problems);
      if (peak === null || estimate === null) continue;
      if (peak <= 0) problems.push(`${fixture}'s gpu_memory.peak_bytes is a device reading above 0, got ${peak}`);
      else if (!within(estimate, peak)) {
        problems.push(`${fixture}'s gpu_memory.estimate_bytes ${estimate} is ${(((estimate - peak) / peak) * 100).toFixed(1)}% from its peak_bytes ${peak}, past 10%`);
      }
    }
    expect(problems, 'each fixture\'s estimate is within 10% of what the device held at its peak').toEqual([]);
  }, 1_800_000);
});
