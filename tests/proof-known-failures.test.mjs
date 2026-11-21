// Regressions for #1872's known-failures.json rule beyond its blind suite: a merge judged three ways against its base,
// clean or conflicted; the file turned into a link; a key flipped between a list and an object. Each runs the real
// guard in a scratch repository, as tests/proof.test.mjs does.
import assert from 'node:assert/strict';
import { symlinkSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { approve, git, ISSUE, problems, proof, repo, show, write } from './acceptance/569/helpers.mjs';

const KNOWN = 'scripts/known-failures.json';
const known = (fields) => `${JSON.stringify({ failures: {}, lint: {}, timing: [], ...fields }, null, 2)}\n`;
const message = `Work\n\nPart of #${ISSUE}`;
const scene = (t, fields, commits = []) => repo(t, { issues: { [ISSUE]: ['Guards'] }, base: { 'scripts/proof-guard.mjs': '// the guard\n', [KNOWN]: known(fields) }, commits });
const refused = (result, ...parts) => assert.ok(problems(result, 'guard').some((found) => parts.every((part) => found.includes(part))), show(result));
const passed = (result) => assert.deepEqual(problems(result, 'guard'), [], show(result));

/** Main moves to `main`; the change, at `change`, merges it; `resolved`, if given, is the conflict's resolution. */
function merged(t, base, main, change, resolved) {
  const at = scene(t, base);
  const { cwd } = at;
  if (change) {
    write(cwd, { [KNOWN]: change.text });
    git(cwd, 'commit', '-q', '-am', message);
    if (change.items) approve(at, git(cwd, 'rev-parse', 'HEAD').trim(), change.items);
  }
  git(cwd, 'checkout', '-q', '-b', 'moved', 'origin/main');
  write(cwd, { [KNOWN]: main });
  git(cwd, 'commit', '-q', '-am', 'main moves');
  git(cwd, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  git(cwd, 'checkout', '-q', 'change');
  if (resolved === undefined) git(cwd, 'merge', '-q', '-m', 'Merge main', 'origin/main');
  else {
    assert.throws(() => git(cwd, 'merge', '-q', '-m', 'Merge main', 'origin/main'), undefined, 'the merge conflicts');
    resolved(cwd);
    git(cwd, 'add', '-A');
    git(cwd, 'commit', '-q', '-m', 'Merge main');
  }
  return proof(at, ['guard']);
}

const A = 'tests/a.test.mjs › a', B = 'tests/b.test.mjs › b', C = 'tests/c.test.mjs › c';
const note = 'fails on main (#9001, added 2026-11-20)';

test('a conflicted merge that keeps an entry main removed, or a lint count main lowered, fails the guard', (t) => {
  const result = merged(t, { failures: { [A]: note }, lint: { k: 5 } }, known({ failures: { [C]: note }, lint: { k: 2 } }),
    { text: known({ failures: { [A]: note, [B]: note }, lint: { k: 5 } }), items: [`${KNOWN} › ${B}`] },
    (cwd) => write(cwd, { [KNOWN]: known({ failures: { [A]: note, [B]: note, [C]: note }, lint: { k: 5 } }) }));
  refused(result, `the failures key's entry ${A} added in merging`);
  refused(result, "the lint key's entry k changed in merging");
});

test("a conflicted merge that keeps both sides' entries, the change's approved, passes the guard", (t) => {
  passed(merged(t, { failures: { [A]: note } }, known({ failures: { [A]: note, [C]: note } }),
    { text: known({ failures: { [A]: note, [B]: note } }), items: [`${KNOWN} › ${B}`] },
    (cwd) => write(cwd, { [KNOWN]: known({ failures: { [A]: note, [B]: note, [C]: note } }) })));
});

test('a clean merge that keeps an entry main removed, in a second copy of its key that parses last, fails the guard', (t) => {
  const base = known({ failures: { [A]: note } });
  // The same entries, so the change's own commit changes nothing the readers parse; main's edit then merges cleanly.
  const twice = base.replace(/\n}\n$/, `,\n  "spacer": [],\n  "failures": ${JSON.stringify({ [A]: note })}\n}\n`);
  const result = merged(t, { failures: { [A]: note } }, known({ failures: {} }), { text: twice });
  refused(result, `the failures key's entry ${A} added in merging`);
});

test('a merge that keeps a lint count the change lowered less than main did fails the guard, in a conflict or cleanly', async (t) => {
  await t.test('in a conflict', (t) => {
    refused(merged(t, { lint: { x: 5 } }, known({ lint: { x: 1 } }), { text: known({ lint: { x: 4 } }) },
      (cwd) => write(cwd, { [KNOWN]: known({ lint: { x: 4 } }) })), "the lint key's entry x changed in merging");
  });
  await t.test('cleanly, through a second copy of the key that parses last', (t) => {
    const base = known({ lint: { x: 5 } });
    const twice = base.replace(/\n}\n$/, `,\n  "spacer": [],\n  "lint": ${JSON.stringify({ x: 4 })}\n}\n`);
    refused(merged(t, { lint: { x: 5 } }, known({ lint: { x: 1 } }), { text: twice }), "the lint key's entry x changed in merging");
  });
  await t.test('main raised the count: the change\'s fix plus main\'s findings passes, main\'s count alone fails', (t) => {
    const mainRaises = (count) => merged(t, { lint: { x: 5 } }, known({ lint: { x: 7 } }), { text: known({ lint: { x: 4 } }) },
      (cwd) => write(cwd, { [KNOWN]: known({ lint: { x: count } }) }));
    passed(mainRaises(6));
    refused(mainRaises(7), "the lint key's entry x changed in merging");
  });
  await t.test('the change removed the count and main raised it: main\'s new findings alone pass, more fail', (t) => {
    const removedRaised = (count) => merged(t, { lint: { x: 5 } }, known({ lint: { x: 7 } }), { text: known({ lint: {} }) },
      (cwd) => write(cwd, { [KNOWN]: known({ lint: { x: count } }) }));
    passed(removedRaised(2));
    refused(removedRaised(3), "the lint key's entry x changed in merging");
  });
  await t.test('both sides made the same approved raise: it counts once', (t) => {
    // The same raise merges cleanly; the merge is then amended to the count it leaves.
    const bothRaise = (count) => {
      const at = scene(t, { lint: { x: 5 } });
      const { cwd } = at;
      write(cwd, { [KNOWN]: known({ lint: { x: 8 } }) });
      git(cwd, 'commit', '-q', '-am', message);
      approve(at, git(cwd, 'rev-parse', 'HEAD').trim(), [`${KNOWN} › x`]);
      git(cwd, 'checkout', '-q', '-b', 'moved', 'origin/main');
      write(cwd, { [KNOWN]: known({ lint: { x: 8 } }) });
      git(cwd, 'commit', '-q', '-am', 'main moves');
      git(cwd, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
      git(cwd, 'checkout', '-q', 'change');
      git(cwd, 'merge', '-q', '--no-ff', '-m', 'Merge main', 'origin/main');
      write(cwd, { [KNOWN]: known({ lint: { x: count } }) });
      git(cwd, 'commit', '-q', '--amend', '-am', 'Merge main');
      return proof(at, ['guard']);
    };
    passed(bothRaise(8));
    refused(bothRaise(11), "the lint key's entry x changed in merging");
  });
  await t.test('resolved to main\'s count, it passes', (t) => {
    passed(merged(t, { lint: { x: 5 } }, known({ lint: { x: 1 } }), { text: known({ lint: { x: 4 } }) },
      (cwd) => write(cwd, { [KNOWN]: known({ lint: { x: 1 } }) })));
  });
});

test('a criss-cross merge conflicting in the file that keeps an entry main removed fails the guard whichever merge base git names; one that drops it passes', async (t) => {
  for (const [what, keep] of [['kept', true], ['dropped', false]]) {
    await t.test(what, (t) => {
      const at = scene(t, { failures: { [A]: note }, lint: { x: 5 } }, [{ files: { 'notes.md': 'n\n' }, message }]);
      const { cwd } = at;
      const mainMoves = (fields) => {
        git(cwd, 'checkout', '-q', 'main');
        write(cwd, { [KNOWN]: known(fields) });
        git(cwd, 'commit', '-q', '-am', 'main moves');
        git(cwd, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
      };
      const lower = (fields) => {
        write(cwd, { [KNOWN]: known(fields) });
        git(cwd, 'commit', '-q', '-am', message);
      };
      git(cwd, 'branch', 'side');
      mainMoves({ failures: { [A]: note, [B]: note }, lint: { x: 5 } });
      // The side line never holds B; the change merges main's B, then the two lines merge each other. git names the
      // later of two merge bases, so the side's commit, dated later, is the base that never held B.
      git(cwd, 'checkout', '-q', 'side');
      write(cwd, { 'side.md': 's\n' });
      git(cwd, 'add', '-A');
      process.env.GIT_COMMITTER_DATE = '4000000000 +0000';
      try {
        git(cwd, 'commit', '-q', '-m', message);
      } finally {
        delete process.env.GIT_COMMITTER_DATE;
      }
      git(cwd, 'checkout', '-q', 'change');
      git(cwd, 'merge', '-q', '--no-ff', '-m', message, 'origin/main');
      const [withB, without] = [git(cwd, 'rev-parse', 'change').trim(), git(cwd, 'rev-parse', 'side').trim()];
      git(cwd, 'merge', '-q', '--no-ff', '-m', message, without);
      git(cwd, 'checkout', '-q', 'side');
      git(cwd, 'merge', '-q', '--no-ff', '-m', message, withB);
      // Each line lowers one lint count its own way, which needs no tag, so the last merge conflicts in the file, and
      // only the merge bases judge it. Main takes B out; the change merges that, then the side line, keeping B or not.
      lower({ failures: { [A]: note, [B]: note }, lint: { x: 4 } });
      mainMoves({ failures: { [A]: note }, lint: { x: 5 } });
      git(cwd, 'checkout', '-q', 'change');
      git(cwd, 'merge', '-q', '--no-ff', '-m', message, 'origin/main');
      lower({ failures: { [A]: note }, lint: { x: 3 } });
      assert.throws(() => git(cwd, 'merge', '-q', '--no-ff', '--no-commit', 'side'), undefined, 'the merge does not conflict');
      assert.equal(git(cwd, 'merge-base', '--all', 'HEAD', 'MERGE_HEAD').trim().split('\n').length, 2, 'the history is not criss-cross');
      assert.equal(git(cwd, 'merge-base', 'HEAD', 'MERGE_HEAD').trim(), without, 'git names the base that held B, not the one that never did');
      write(cwd, { [KNOWN]: known({ failures: keep ? { [A]: note, [B]: note } : { [A]: note }, lint: { x: 3 } }) });
      git(cwd, 'add', '-A');
      git(cwd, 'commit', '-q', '-m', message);
      const result = proof(at, ['guard']);
      if (keep) refused(result, `the failures key's entry ${B} added in merging`);
      else passed(result);
    });
  }
});

test('known-failures.json made a link, in a commit or in resolving a merge conflict, fails the guard even under a tag', (t) => {
  const link = (cwd) => {
    write(cwd, { 'scripts/listed.json': known({ failures: { [B]: note } }) });
    unlinkSync(join(cwd, KNOWN));
    symlinkSync('listed.json', join(cwd, KNOWN));
  };
  const at = scene(t, {});
  link(at.cwd);
  git(at.cwd, 'add', '-A');
  git(at.cwd, 'commit', '-q', '-m', message);
  approve(at, git(at.cwd, 'rev-parse', 'HEAD').trim(), [KNOWN, 'scripts/listed.json']);
  refused(proof(at, ['guard']), `${KNOWN}: no longer a plain file`);
  refused(merged(t, {}, known({ failures: { [C]: note } }), { text: known({ failures: { [B]: note } }), items: [`${KNOWN} › ${B}`] }, link), `${KNOWN}: no longer a plain file`);
});

test('a key flipped from a list to an object with the same IDs fails the guard', (t) => {
  const at = scene(t, { timing: [A] }, [{ files: { [KNOWN]: known({ timing: { [A]: true } }) }, message }]);
  refused(proof(at, ['guard']), `the timing key's entry ${A} added`);
});
