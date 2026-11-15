// #542: GPUI's scroll event has no momentum phase, so a trackpad's tail reads as more of the touch. The carried patch in
// vendor/gpui-pre-macos (`events::momentum`) reads AppKit's `momentumPhase`; deep-show's test makes scroll events the way
// a trackpad sends them, through Core Graphics and AppKit, and reads each one's phase through the patch.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const skip = process.platform !== 'darwin' && 'the patch reads AppKit, which only macOS has';

test('a scroll tail reads its momentum phase from AppKit, and the touch none', { skip, timeout: 3_600_000 }, () => {
  const run = spawnSync('cargo', ['test', '--locked', '-q', '-p', 'deep-show', '--bin', 'deep-show', 'momentum::tests::'], { encoding: 'utf8', maxBuffer: 1 << 28 });
  assert.equal(run.status, 0, (run.stdout + run.stderr).slice(-2000));
  assert.match(run.stdout, /test result: ok\. 1 passed/);
});
