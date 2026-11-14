import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { callableLengths, corePresent, parse, retained } from './source-oracles.mjs';

const root = new URL('../../../../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('./base-surfaces.json', import.meta.url), 'utf8'));

for (const { file, surfaces } of manifest.files) {
  test(`AC1/AC2 partial structural proof: selected responsibilities no longer implemented in ${file}`, () => {
    const tree = parse(readFileSync(new URL(file, root), 'utf8'), file);
    const violations = retained(tree, surfaces);
    assert.deepEqual(violations, [], `Retained source ownership (not destination naming):\n${violations.join('\n')}`);
  });
}

test('AC2: no callable implementation in core.ts exceeds 100 physical source lines', () => {
  const file = 'packages/hub/src/core.ts';
  const tree = parse(readFileSync(new URL(file, root), 'utf8'), file);
  assert.ok(corePresent(tree), 'INVALID: expected the issue-named Core source surface, not an empty/replaced file');
  const over = callableLengths(tree).filter(({ lines }) => lines > 100);
  assert.deepEqual(over, [], `Over 100 source lines:\n${over.map(({ name, start, lines }) => `${name} at ${start}: ${lines} lines`).join('\n')}`);
});
