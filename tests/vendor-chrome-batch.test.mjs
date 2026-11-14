// #2471: gpui-pre's scene yields `PrimitiveBatch::Chrome` only on macOS, where the vendored Metal renderer draws it.
// Elsewhere the renderer is gpui-pre-wgpu from the registry, whose match over the batches is exhaustive, so with the
// variant there it doesn't compile. macOS never builds gpui-pre-wgpu; #1434's suites prove the batch there.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const skip = process.platform === 'darwin' && 'macOS draws chrome batches on Metal and never builds gpui-pre-wgpu';

test('the registry wgpu renderer compiles against the vendored scene', { skip, timeout: 1_800_000 }, () => {
  const run = spawnSync('cargo', ['check', '--locked', '-p', 'gpui-pre-wgpu'], { encoding: 'utf8', maxBuffer: 1 << 28 });
  assert.equal(run.status, 0, run.stderr.slice(-2000));
});
