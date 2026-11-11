// The criterion's first sentence: "An encode job of 600 frames shows 300 of 600 when its tool has written 300, and its
// time left is within 10% of the time it then takes."
//
// asserts (README, How each part is read): with test/encode-kind installed, deep_job runs test.encode on encode-a@1.0.0
// with {frames: 600, batch: 15, every_ms: 2000}, 300 frames at 40 s and the last at 80 s. Read every 200 ms through
// rows.read (what deep status --json prints), the list holds the job's row (id job:…); the first read showing
// "300 of 600" falls while the encoder, by its own log, had written 300; and the first read at 300 of 600 with a time
// left ("<n> s left") says one within 10% of the time from that read to the encoder's last frame.
import { describe, expect, it } from 'vitest';
import { encodeRun, encodeWorld, judgeCount, proof, proofOf, TOOL } from './helpers.ts';

describe('#1925.c0a82b1d An encode job of 600 frames shows 300 of 600 when its tool has written 300, and its time left is within 10% of the time it then takes. A planted tool that reports elapsed time over an expected duration shows 300 of 600 while 150 frames are written and fails, naming the job. Closing the app at frame 300 leaves the job running, and reopening shows its true count, never 0', () => {
  it('the 600-frame encode\'s row shows 300 of 600 while its tool has written 300, with a time left within 10% of the time it then takes', async () => {
    const w = await encodeWorld();
    const r = await encodeRun(w, TOOL);
    const failures = judgeCount(r);
    proof('count.json', { failures, ...proofOf(r) });
    expect(failures, `the job's row against the encoder's own log (proof: $TMPDIR/deep-1925-proof/count.json)`).toEqual([]);
  }, 600_000);
});
