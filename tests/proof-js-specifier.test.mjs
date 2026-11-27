import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveModule } from '../scripts/proof-change.mjs';

for (const path of ['tests/a.mjsx', 'tests/a.cjsx']) {
  test(`${path}, a name with no TypeScript source, resolves to itself`, () => {
    assert.equal(resolveModule(process.cwd(), null, path), path);
  });
}
