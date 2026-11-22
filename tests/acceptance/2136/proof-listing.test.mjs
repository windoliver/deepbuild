// #2136, criterion 6: proof.mjs lists the repository's files once for a change. Reached by running this checkout's
// `node scripts/proof.mjs lifecycle` in a scratch repository whose change touches 60 paths, with a stand-in git first
// on PATH that notes each call's arguments and then runs the real git with them (README: The proof.mjs scene).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import test from 'node:test';
import { CHECKOUT, dump, gitIn, launch, sandbox } from './helpers.mjs';

const SCHEMAS = 'packages/contracts/schemas';
const table = (id, states, final, moves) => `${JSON.stringify({ id, states, initial: states[0], final, moves: moves.map(([from, event, to]) => ({ from, event, to })) }, null, 2)}\n`;
const DOOR = `${SCHEMAS}/door.machine@1.json`, GONE = `${SCHEMAS}/gone.machine@1.json`, LAMP = `${SCHEMAS}/lamp.machine@1.json`;
const plain = (index) => `src/file-${String(index).padStart(2, '0')}.txt`;
// Of the change's 57 plain paths, 5 are edits and 52 are new files: git reads each edit apart, a new file not at all.
const EDITED = 5, ADDED = 52;
// What the lifecycle lane prints for this change at the base commit, 654c560c1: the tables the change touches that
// the repository still holds, in the change's order, each read as before.
const LINES = [
  'PASS lifecycle: door.machine@1: each of its 3 reachable states reaches a final state',
  `FAIL lifecycle: lamp.machine@1: state stuck has no move to a final state (${LAMP})`,
  '  Fix: Give every state reachable from the initial one a sequence of moves to a final state.',
];

function write(cwd, files) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), content);
  }
}

test('#2136.4948c95b for a change that touches 60 paths, the lifecycle lane prints the lines it printed before and git ls-files is spawned once for the table lookup', async (t) => {
  const box = sandbox(t);
  const cwd = join(box.dir, 'scene'), bin = join(box.dir, 'bin'), calls = join(box.dir, 'git-calls.log');
  mkdirSync(cwd);
  mkdirSync(bin);
  // The real git: the program itself where git says it keeps one, which spares each call a launcher's own lookup.
  const core = join(execFileSync('git', ['--exec-path'], { env: box.env, encoding: 'utf8' }).trim(), 'git');
  const real = existsSync(core) ? core : execFileSync('sh', ['-c', 'command -v git'], { env: box.env, encoding: 'utf8' }).trim();
  writeFileSync(join(bin, 'git'), `#!/bin/sh\n# A stand-in for #2136: notes the call, then is the real git.\nprintf '%s\\n' "$*" >> '${calls}'\nexec '${real}' "$@"\n`);
  chmodSync(join(bin, 'git'), 0o755);

  // The merge base: two lifecycle tables and 5 plain files.
  const git = gitIn(cwd, box.env);
  git('init', '-q', '-b', 'main');
  write(cwd, {
    [DOOR]: table('door.machine@1', ['open', 'closed'], ['closed'], [['open', 'close', 'closed']]),
    [GONE]: table('gone.machine@1', ['here', 'gone'], ['gone'], [['here', 'leave', 'gone']]),
    ...Object.fromEntries(Array.from({ length: EDITED }, (_, index) => [plain(index), 'before\n'])),
  });
  git('add', '-A');
  git('commit', '-qm', 'base');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  // The change, 60 paths: one table edited, one deleted and one added, 5 plain files edited and 52 added; what it
  // adds is not yet tracked.
  write(cwd, {
    [DOOR]: table('door.machine@1', ['open', 'closed', 'locked'], ['locked'], [['open', 'close', 'closed'], ['closed', 'lock', 'locked']]),
    [LAMP]: table('lamp.machine@1', ['off', 'on', 'stuck'], ['off'], [['off', 'press', 'on'], ['on', 'press', 'off'], ['on', 'jam', 'stuck']]),
    ...Object.fromEntries(Array.from({ length: EDITED + ADDED }, (_, index) => [plain(index), 'after\n'])),
  });
  rmSync(join(cwd, GONE));
  const touched = git('status', '--porcelain', '--untracked-files=all').split('\n').filter(Boolean);
  assert.equal(touched.length, 60, `the scene's change does not touch 60 paths:\n${touched.join('\n')}`);

  const issues = join(box.dir, 'issues');
  mkdirSync(issues);
  const run = await launch(box, [process.execPath, join(CHECKOUT, 'scripts/proof.mjs'), 'lifecycle'], { cwd, env: { PATH: `${bin}${delimiter}${box.env.PATH}`, DEEP_PROOF_ISSUES: issues, DEEP_APPROVERS: join(box.dir, 'no-approvers') } });
  const out = dump(box, run);

  // The lane's lines are unchanged: everything the run printed but its wall time, which is no lane's line.
  const lines = run.stdout.split('\n').filter((line) => line && !/^proof: wall time /.test(line));
  assert.deepEqual(lines, LINES, `the lifecycle lane's lines changed\n${out}`);

  // git ls-files is spawned once for the table lookup. The change's own reader asks git for the untracked files alone
  // (--others with no --cached), which is no listing of the repository's files, so those calls are set apart.
  assert.ok(existsSync(calls), `proof.mjs never ran git through PATH\n${out}`);
  const listings = readFileSync(calls, 'utf8').split('\n').filter((call) => /(?:^| )ls-files(?: |$)/.test(call));
  const lookups = listings.filter((call) => !(/ --others\b/.test(call) && !/ --cached\b/.test(call)));
  assert.equal(lookups.length, 1, `git ls-files was spawned ${lookups.length} times to list the repository's files for a change of 60 paths, not once (${listings.length} ls-files calls in all)\n${out}`);
});
