// #1116, Scope: agents never edit the window, so budget-window.mjs is the proof lanes' own code to the guard. Reached by
// running this checkout's `node scripts/proof.mjs guard` in a scratch repository whose main holds the proof lanes.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { CHECKOUT, ended, launch, LONG, sandbox } from './helpers.mjs';

const ISSUE = 9116;
const write = (cwd, files) => {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), content);
  }
};

test('budget-window.mjs joins the guard regex: an unsigned change to it fails the guard', LONG, async (t) => {
  const box = sandbox(t);
  const cwd = join(box.dir, 'scene');
  mkdirSync(cwd);
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, env: box.env, stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  const scripts = ['scripts/budget-window.mjs', 'scripts/guide.mjs'];
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
  write(issues, { [`${ISSUE}.md`]: 'Planted for #1116.\n\n### Acceptance criteria\n- [ ] Nothing real\n' });
  const run = await ended(launch(box, [process.execPath, join(CHECKOUT, 'scripts/proof.mjs'), 'guard'], { cwd, env: { DEEP_PROOF_ISSUES: issues, DEEP_APPROVERS: join(box.dir, 'no-approvers') } }), 120_000);
  const all = `exit ${run.status}\n${run.stdout}\n${run.stderr}`;
  const refused = run.stdout.split('\n').filter((line) => line.startsWith('FAIL guard:'));
  assert.ok(refused.some((line) => line.startsWith('FAIL guard: scripts/budget-window.mjs:')), `an unsigned change to budget-window.mjs passed the guard\n${all}`);
  assert.ok(!refused.some((line) => line.includes('scripts/guide.mjs')), `the guard refused a script that is no check\n${all}`);
  assert.notEqual(run.status, 0, all);
});
