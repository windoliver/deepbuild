// #1426: the sRGB tag carried in gpui-pre-apple, on the crate's own unit test. The app's color check proves the same
// tag in a window, which needs a person's unlocked screen; this one reads the layer GPUI's own setup configured.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

test('gpui-pre-apple tags the layer it configures sRGB', { timeout: 1_800_000 }, () => {
  const run = spawnSync('cargo', ['test', '--locked', '-p', 'gpui-pre-apple', 'a_configured_layer_is_tagged_srgb'], { encoding: 'utf8', maxBuffer: 1 << 28 });
  assert.equal(run.status, 0, run.stderr.slice(-2000));
  assert.match(run.stdout, /test result: ok\. 1 passed/);
});
