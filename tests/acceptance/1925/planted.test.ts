// The criterion's second sentence: "A planted tool that reports elapsed time over an expected duration shows 300 of 600
// while 150 frames are written and fails, naming the job."
//
// asserts (README, Plants): with test/encode-kind and test/encode-guess installed, the same 600-frame encode runs on the
// planted tool encode-guess@1.0.0, which writes the same frames at the same pace (150 at 20 s) but reports elapsed time
// over the 40 s it expects (300 of 600 at 20 s). Read as count.test.ts reads the honest tool, its row shows "300 of
// 600" while the encoder's own log says 150 frames are written, and count.test.ts's judge fails on it with that
// failure, naming the job: its row's id, the kind test.encode and the tool encode-guess@1.0.0.
import { describe, expect, it } from 'vitest';
import { encodeRun, encodeWorld, judgeCount, KIND, PLANTED, proof, proofOf } from './helpers.ts';

describe('#1925.c0a82b1d An encode job of 600 frames shows 300 of 600 when its tool has written 300, and its time left is within 10% of the time it then takes. A planted tool that reports elapsed time over an expected duration shows 300 of 600 while 150 frames are written and fails, naming the job. Closing the app at frame 300 leaves the job running, and reopening shows its true count, never 0', () => {
  it('the planted tool that reports elapsed time over an expected duration shows 300 of 600 while 150 frames are written, and fails, naming the job', async () => {
    const w = await encodeWorld(true);
    const r = await encodeRun(w, PLANTED);
    const failures = judgeCount(r);
    proof('planted.json', { failures, ...proofOf(r) });
    const shown = failures.find((f) => /showed "300 of 600" at [\d.]+ s while its tool had written 150 frames of 600/.test(f));
    expect(shown, `the judge fails the planted tool for a row at "300 of 600" while its tool had written 150 frames; its failures: ${JSON.stringify(failures)}`).toBeDefined();
    const id = r.readings.find((x) => x.row)?.row?.id as string;
    for (const part of [id, KIND, PLANTED]) expect(shown, `the failure names the job (its row's id, its kind and its tool): ${part}`).toContain(part);
  }, 600_000);
});
