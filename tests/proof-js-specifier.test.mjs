// #3585 review: a script name with no TypeScript source, such as ./a.mjsx or ./a.cjsx, resolves as it did before the
// .js-to-.ts step, to itself, rather than crashing the guard and the lanes that walk a test's imports.
import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveModule } from '../scripts/proof-change.mjs';

for (const path of ['tests/a.mjsx', 'tests/a.cjsx']) {
  test(`${path}, a name with no TypeScript source, resolves to itself`, () => {
    assert.equal(resolveModule(process.cwd(), null, path), path);
  });
}
