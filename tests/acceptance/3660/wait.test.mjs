import assert from 'node:assert/strict';
import test from 'node:test';
import { behindHolder, judgeGivenBack, judgeTimeout } from './helpers.mjs';

test('#3660.5e80dd70 on a pool of one token held 300 s by a stub build, a build asked 10 s later with --wait 0.5 is admitted, then exits 3 within 90 s of asking with INCONCLUSIVE no grant, its command never started, the log reading its granted then its timeout with wait 0.5, and the table holding nothing of its process', { timeout: 6 * 60_000 }, async (t) => {
  const scene = await behindHolder(t, ['--wait', '0.5']);
  const { granted, timeout, show } = judgeTimeout(t, scene, { flag: '--wait 0.5', words: /^INCONCLUSIVE no grant: /m });
  assert.equal(granted.wait, 0.5, `the granted entry of ${scene.asker.named} doesn't carry wait: 0.5: ${JSON.stringify(granted)}\n${show()}`);
  assert.equal(timeout.wait, 0.5, `the timeout entry of ${scene.asker.named} doesn't carry wait: 0.5: ${JSON.stringify(timeout)}\n${show()}`);
  assert.equal(timeout.stall, undefined, `the timeout entry of ${scene.asker.named}, asked with --wait, carries a stall: ${JSON.stringify(timeout)}\n${show()}`);
  await judgeGivenBack(scene.box, scene.asker, scene.left, show);
});
