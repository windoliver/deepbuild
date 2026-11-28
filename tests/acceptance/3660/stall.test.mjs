import assert from 'node:assert/strict';
import test from 'node:test';
import { behindHolder, judgeGivenBack, judgeTimeout } from './helpers.mjs';

test('#3660.85d33ca3 on a pool of one token held 300 s by a stub build, a build asked 10 s later with --stall 0.5 is admitted, then exits 3 within 90 s of asking with INCONCLUSIVE no grant: no build grant changed hands within 0.5 min, its command never started, its timeout entry carrying stall 0.5, and the table holding nothing of its process', { timeout: 6 * 60_000 }, async (t) => {
  const scene = await behindHolder(t, ['--stall', '0.5']);
  const { timeout, show } = judgeTimeout(t, scene, { flag: '--stall 0.5', words: /^INCONCLUSIVE no grant: no build grant changed hands within 0\.5 min/m });
  assert.equal(timeout.stall, 0.5, `the timeout entry of ${scene.asker.named} doesn't carry stall: 0.5: ${JSON.stringify(timeout)}\n${show()}`);
  await judgeGivenBack(scene.box, scene.asker, scene.left, show);
});
