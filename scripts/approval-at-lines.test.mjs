// Regression (#3166, review of PR 3175): an `Approves:` line that ends in an `@` ID the strict form refuses approves
// nothing. It must not fall back to the tagged commit as a whole item, whose path before ` › ` would then count as a
// file the approval names. The scratch repository, the security-key stand-in and the guard run are the #3166 suite's.
import test from 'node:test';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { approve, hardware } from '../tests/acceptance/3166/authenticator.mjs';
import { FIRST, commit, fails, git, guard, note, passes, put, repository, says, skip } from '../tests/acceptance/3166/fixtures.mjs';

// A tagged test whose name ends in an @ word that is no commit ID, as tests/acceptance/1956/migrate.test.ts has
// ("... once the kind moves to @3"): a plain line naming it approves it for the tagged commit, as before #3166.
test('a plain line naming a test whose name ends in @3 approves it', (t) => {
  const person = hardware('person');
  const w = repository(t, person.line);
  const path = 'tests/moves.test.mjs';
  const name = `#93166.${createHash('sha256').update('moves').digest('hex').slice(0, 8)} the kind moves to @3`;
  const source = `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('${name}', () => { assert.equal(2 + 2, 4); });\n`;
  put(join(w.repo, path), source);
  commit(w, 'A tagged test whose name ends in an @ word');
  git(w, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  put(join(w.repo, path), source.replace('test(', 'test.skip('));
  const proposal = commit(w, 'Propose skipping it');
  approve(w, person, [`${path} › ${name}`], { on: proposal });
  passes(guard(t, w, 'an @3 test name'), 'a test name ending in an @ word is no commit ID', path);
});

// Each a malformed ID for the earlier commit, after an item naming extra.txt.
const malformed = {
  'abbreviated to twelve digits': (sha) => `extra.txt › x @${sha.slice(0, 12)}`,
  'in capitals': (sha) => `extra.txt › x @${sha.toUpperCase()}`,
  'after a tab': (sha) => `extra.txt › x\t@${sha}`,
};

for (const [how, line] of Object.entries(malformed)) {
  test(`a line whose ID is ${how} names no file of the tagged commit`, (t) => {
    const person = hardware('person');
    const w = repository(t, person.line);
    note(w);
    const early = commit(w, 'Ordinary work');
    skip(w, FIRST);
    note(w, 'extra.txt');
    const wide = commit(w, 'Propose skipping the first test, with one more file');
    approve(w, person, [FIRST, line(early)], { on: wide });
    const r = guard(t, w, how);
    fails(r, 'the malformed line approves nothing, so the commit carries a file its approval does not name', FIRST);
    says(r, 'the over-wide commit is refused by name', 'the approved commit carries more than the files it names');
  });
}
