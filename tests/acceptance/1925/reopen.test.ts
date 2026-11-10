// The criterion's last sentence: "Closing the app at frame 300 leaves the job running, and reopening shows its true
// count, never 0."
//
// asserts (README, readings 6 to 8): the same 600-frame encode on encode-a@1.0.0. When the job's row first shows 300
// of 600, the app (the real deep-drive, the replica of the app's window, on a copy of the hub's record) opens and draws
// the job's row with its true count and a time left; it closes, its process ended; the encoder writes on to its last
// frame after the close and the job ends done; 4 s after the close the app opens again in a new process and draws the
// job's true count, never 0. A true count is one the encoder's own log had from one batch (2 s) before the open to the
// end of its read.
import { describe, expect, it } from 'vitest';
import { encodeRun, encodeWorld, judgeApp, proof, proofOf, TOOL } from './helpers.ts';

describe('#1925.c0a82b1d An encode job of 600 frames shows 300 of 600 when its tool has written 300, and its time left is within 10% of the time it then takes. A planted tool that reports elapsed time over an expected duration shows 300 of 600 while 150 frames are written and fails, naming the job. Closing the app at frame 300 leaves the job running, and reopening shows its true count, never 0', () => {
  it('closing the app at frame 300 leaves the job running to its last frame, and the app opened again shows its true count, never 0', async () => {
    const w = await encodeWorld();
    const r = await encodeRun(w, TOOL, { app: true });
    let failures: string[] = [];
    try {
      failures = judgeApp(r);
    } finally {
      proof('reopen.json', { failures, ...proofOf(r) });
    }
    expect(failures, `the app at frame 300, closed, and opened again, against the encoder's own log (proof: $TMPDIR/deep-1925-proof/reopen.json)`).toEqual([]);
  }, 600_000);
});
