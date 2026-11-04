// #1113: throttle.mjs and perf.mjs are the proof lanes' own code to the guard, reached by running this
// checkout's `node scripts/proof.mjs guard` in a scratch repository whose main holds the proof lanes.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { CHECKOUT, dump, launch, sandbox, write } from './helpers.mjs';

const ISSUE = 9113;

test('#1113.3fd014d8 throttle.mjs and perf.mjs are in the guard regex: an unsigned change to either fails the guard', async (t) => {
  const box = sandbox(t);
  const cwd = join(box.dir, 'scene');
  mkdirSync(cwd);
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  const scripts = ['scripts/throttle.mjs', 'scripts/perf.mjs', 'scripts/guide.mjs'];
  write(cwd, { 'scripts/proof-guard.mjs': '// the guard\n', ...Object.fromEntries(scripts.map((path) => [path, '// as on main\n'])) });
  git('add', '-A');
  git('commit', '-qm', 'base');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  git('checkout', '-q', '-b', 'change');
  // One unsigned commit changes each; guide.mjs is no check, so it shows the guard tells them apart.
  write(cwd, Object.fromEntries(scripts.map((path) => [path, '// changed, with no approval\n'])));
  git('add', '-A');
  git('commit', '-qm', `Change the scripts\n\nPart of #${ISSUE}`);
  const issues = join(box.dir, 'issues');
  write(issues, { [`${ISSUE}.md`]: 'Planted for #1113.\n\n### Acceptance criteria\n- [ ] Nothing real\n' });
  const run = await launch(box, [process.execPath, join(CHECKOUT, 'scripts/proof.mjs'), 'guard'], { cwd, env: { DEEP_PROOF_ISSUES: issues, DEEP_APPROVERS: join(box.dir, 'no-approvers') } }).done;
  const all = dump(box, run);
  const refused = run.stdout.split('\n').filter((line) => line.startsWith('FAIL guard:'));
  for (const path of ['scripts/throttle.mjs', 'scripts/perf.mjs']) assert.ok(refused.some((line) => line.startsWith(`FAIL guard: ${path}:`)), `an unsigned change to ${path} passed the guard\n${all}`);
  assert.ok(!refused.some((line) => line.includes('scripts/guide.mjs')), `the guard refused a script that is no check\n${all}`);
  assert.notEqual(run.status, 0, all);
});
