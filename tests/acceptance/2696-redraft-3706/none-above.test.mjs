import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { cleanup, highFiles, listed, needBuiltCheckout, REPO, sourceFilesAbove, where } from './helpers.mjs';

after(cleanup);

test('#2696.5a61170b #3706.61c191d3 after npm run build --workspaces no built file under packages/*/dist holds a character above U+00FF, though the built packages\' sources hold such characters', { timeout: 5 * 60_000 }, () => {
  const sources = sourceFilesAbove();
  if (!sources.length) throw Error('BLOCKED: no source file of a built package holds a character above U+00FF, so the build has nothing to escape and the check below could not fail');
  const texts = needBuiltCheckout();
  const now = highFiles(REPO);
  assert.equal(now.length, 0, `${now.length} of the ${texts.length} built text files under packages/*/dist hold a character above U+00FF (${sources.length} source files of the built packages hold one); the first is ${where(now[0] ?? { path: '', line: 0, char: ' ' })}:\n${listed(now.map(where))}`);
});
