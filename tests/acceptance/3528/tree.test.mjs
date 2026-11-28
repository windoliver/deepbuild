// #3528's first and third criteria, read from git in this checkout: the change tracks neither file a merge tool left
// behind and no file names them; and the change's diff against the merge base is the two deletions and the check, and
// nothing else (README: readings 1, 5 and 6).
import assert from 'node:assert/strict';
import test from 'node:test';
import { DIFF, GONE, LEFTOVERS, SUITE, git, mergeBase } from './helpers.mjs';

const lines = (text, separator = '\n') => text.split(separator).filter(Boolean);
/** Each name a file could name either leftover by: its path, and its own name. */
const names = [...LEFTOVERS, ...LEFTOVERS.map((path) => path.split('/').at(-1))];

test(`${GONE} git ls-files on the change holds neither path, and no file in the tree names either`, () => {
  const base = mergeBase();
  assert.deepEqual(lines(git(['ls-tree', '-r', '--name-only', base, '--', ...LEFTOVERS])).sort(), [...LEFTOVERS].sort(), 'the merge base tracks both');
  assert.deepEqual(lines(git(['ls-files', '--', ...LEFTOVERS])), [], 'git ls-files on the change still holds them');
  let naming = '';
  try {
    // Tracked files and new ones git doesn't ignore, as the working tree has them; this suite names them by design.
    naming = git(['grep', '--untracked', '-I', '-l', '-F', ...names.flatMap((name) => ['-e', name]), '--', '.', `:(exclude)${SUITE}`]);
  } catch (error) {
    if (error.status !== 1) throw new Error(`INCONCLUSIVE: git grep exited ${error.status}`);
  }
  assert.deepEqual(lines(naming), [], `these files name ${names.join(' or ')}`);
});

test(`${DIFF} the change's diff against the merge base holds the two deletions under crates/ and the check in scripts/repo-rules.mjs, and nothing else`, () => {
  const base = mergeBase();
  const changed = [
    ...lines(git(['diff', '--name-status', '--no-renames', base])).map((row) => row.replace('\t', ' ')),
    ...lines(git(['ls-files', '-z', '--others', '--exclude-standard']), '\0').map((path) => `A ${path}`),
  ].filter((row) => !row.slice(2).startsWith(SUITE));
  assert.deepEqual(changed.sort(), [...LEFTOVERS.map((path) => `D ${path}`), 'M scripts/repo-rules.mjs'].sort());
});
