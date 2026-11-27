// #3454 acceptance, AC7: the first pass over packages/gate, read on this checkout against its merge base with
// origin/main. The comment lines are counted by this suite's own oracle (oracle.mjs), not by the ratchet, and
// `scripts/comment-only.mjs packages/gate` is run as a process. Nothing is written into the checkout.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { assertPasses, commentOnly, git, onlyScript, root } from './helpers.mjs';
import { commentLines, isGenerated, isScript } from './oracle.mjs';

const GATE = 'packages/gate';
const FEWER = 269;
/** The base this suite was drafted on, where the oracle counts 472 comment lines in packages/gate (468 at 8f64ca337). */
const DRAFTED_ON = '338f6dfe7';

const listing = (output) => output.split('\0').filter((path) => path && isScript(path));
/** The oracle's count over `files`, each read by `read`; generated files are out. */
function count(ts, files, read) {
  let lines = 0;
  for (const path of files) {
    const text = read(path);
    if (text !== null && !isGenerated(text)) lines += commentLines(ts, path, text).size;
  }
  return lines;
}
const has = (commit) => {
  try {
    return git(root, 'cat-file', '-t', commit).trim() === 'commit';
  } catch {
    return false;
  }
};
const onDisk = (path) => {
  try {
    return readFileSync(join(root, path), 'utf8');
  } catch {
    return null; // deleted from the work tree, still in the index
  }
};

test('#3454.b2b03e5f AC7: packages/gate holds at least 269 fewer comment lines than on its merge base, and scripts/comment-only.mjs packages/gate passes', async (t) => {
  onlyScript();
  const { default: ts } = await import('typescript');
  let mergeBase;
  try {
    mergeBase = git(root, 'merge-base', 'HEAD', 'origin/main').trim();
  } catch {
    return t.skip('INCONCLUSIVE: this checkout has no merge base with origin/main to read; this is not a pass');
  }
  // On main itself the merge base is HEAD, so the change is read against the base this suite was drafted on.
  const before = mergeBase === git(root, 'rev-parse', 'HEAD').trim() ? DRAFTED_ON : mergeBase;
  if (!has(before)) return t.skip(`INCONCLUSIVE: this repository doesn't hold ${before.slice(0, 9)} to read ${GATE} at; this is not a pass`);
  const then = count(ts, listing(git(root, 'ls-tree', '-r', '-z', '--name-only', before, '--', GATE)), (path) => git(root, 'show', `${before}:${path}`));
  const now = count(ts, listing(git(root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', GATE)), onDisk);
  t.diagnostic(`${GATE}: ${now} comment lines now, ${then} at ${before.slice(0, 9)}`);
  assert.ok(then > FEWER, `the oracle read only ${then} comment lines in ${GATE} at ${before.slice(0, 9)}, so it can't judge a drop of ${FEWER}`);
  assert.ok(then - now >= FEWER, `${GATE} holds ${now} comment lines, ${then - now} fewer than the ${then} at ${before.slice(0, 9)}, not at least ${FEWER} fewer`);
  assertPasses(commentOnly(root, GATE), `(${GATE} against its merge base)`);
});
