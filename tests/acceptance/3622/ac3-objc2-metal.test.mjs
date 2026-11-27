// AC3 of #3622: every carried file ported to objc2-metal compiles against gpui-fast-apple 0.1.19, with no metal-rs
// imports remaining in vendor/gpui-fast-apple. The compile is `cargo check --lib` of the vendored gpui-fast-apple
// on the vendored gpui-fast, in a scratch folder, under scripts/lease; with no Metal compiler it builds the
// `runtime_shaders` feature, which leaves the shaders to run time. Needs the network for the releases and crates.
import assert from 'node:assert/strict';
import test from 'node:test';
import { AC, compileApple, judgeMetalRs, portedFiles, releases, repoRoot } from './common.mjs';

test(`AC3 ${AC[3]} no metal-rs import remains in vendor/gpui-fast-apple`, () => {
  assert.deepEqual(judgeMetalRs(repoRoot), []);
});

test(`AC3 ${AC[3]} every carried file ported to objc2-metal compiles against gpui-fast-apple 0.1.19`, { timeout: 60 * 60_000 }, async () => {
  const rel = await releases();
  const ported = portedFiles(repoRoot, rel);
  assert.ok(ported.length > 0, 'vendor/gpui-fast-apple carries no file of ours that names objc2_metal: nothing is ported');
  console.log(`# ported to objc2-metal: ${ported.join(', ')}`);
  assert.deepEqual(compileApple(repoRoot, rel), []);
});
