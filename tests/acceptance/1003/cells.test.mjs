// #1003 AC3: "a program that sets its own true-color text at 1.5:1 is drawn exactly as sent". A terminal on a session's
// page (where status shows) and one in a plug-in's panel are fed true-color text at 1.5:1 on a true-color background,
// through `deep-show run` (#402's `terminal_open` with a recorded feed), and each cell is asked as drawn (`cell`):
// both colors must come back as sent, never raised to a floor. README: The surface. Builds deep-show once.
// Run: node --test tests/acceptance/1003/cells.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { judgeCells, nearestStatus, pairRatios, scenario } from './cells-judge.mjs';
import { AC, buildBin, realGuard, remove, repoRoot, tempRoot } from './common.mjs';

test('the pairs are 1.5:1 and keep the status distance from the shipped clean look\'s status colors (the suite\'s own check)', () => {
  for (const r of pairRatios()) assert.ok(Math.abs(r - 1.5) < 0.01, `a pair is ${r.toFixed(3)}:1, not 1.5:1`);
  const [clean] = realGuard([{ look: 'clean' }]);
  const status = clean?.look?.status;
  assert.ok(status, `the clean look's answer carries its status map: ${JSON.stringify(clean).slice(0, 200)}`);
  assert.ok(nearestStatus(status) >= 0.1, `a pair's color is ${nearestStatus(status).toFixed(3)} from a status color of the clean look, inside the status distance`);
});

test(`${AC[3]} a program that sets its own true-color text at 1.5:1 is drawn exactly as sent, on a session's page and in a panel`, () => {
  const bin = buildBin('deep-show', 'deep-show');
  assert.equal(bin.error, undefined, bin.error);
  const evidence = tempRoot('evidence');
  const home = tempRoot('home');
  try {
    const { scenario: s, asked } = scenario(evidence);
    const run = spawnSync(bin.path, ['run'], {
      cwd: repoRoot, input: `${JSON.stringify(s)}\n`, encoding: 'utf8', timeout: 300_000, maxBuffer: 64 * 1024 * 1024,
      env: { HOME: home, PATH: '/usr/bin:/bin', TERM: 'xterm-256color', LANG: 'en_US.UTF-8' },
    });
    assert.equal(run.status, 0, `deep-show run exits 0: ${`${run.stderr}`.slice(-800)}`);
    const answer = JSON.parse(run.stdout.split('\n')[0]);
    assert.equal(answer.ok, true, `deep-show run answers the scenario ok: ${JSON.stringify(answer).slice(0, 600)}`);
    const [installed, opened, openedPanel, ...cells] = answer.replies;
    assert.equal(installed?.installed, true, `the terminals plug-in installs: ${JSON.stringify(installed)}`);
    assert.equal(opened?.opened, true, `the session's terminal opens: ${JSON.stringify(opened)}`);
    assert.equal(openedPanel?.opened, true, `the panel's terminal opens: ${JSON.stringify(openedPanel)}`);
    assert.deepEqual(judgeCells(asked, cells), []);
  } finally {
    remove(evidence);
    remove(home);
  }
});
