import assert from 'node:assert/strict';
import test from 'node:test';
import { AC, compileWithPlantedVariant, copyTrees, judgeCatchAlls, releases, repoRoot } from './support.mjs';

test(`AC2 ${AC[2]} no carried src/fast/ match over PrimitiveBatch, Primitive, PaintOperation, ColorSpace or AtlasKey gains a catch-all arm`, { timeout: 10 * 60_000 }, async () => {
  assert.deepEqual(judgeCatchAlls(repoRoot, await releases()), []);
});

test(`AC2 ${AC[2]} a planted variant added to PrimitiveBatch fails to compile in gpui-fast-apple's src/fast/frame.rs`, { timeout: 120 * 60_000 }, () => {
  assert.deepEqual(compileWithPlantedVariant(copyTrees()), []);
});
