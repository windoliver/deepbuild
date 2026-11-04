// #1113: the before lane's timed set spawns only after its timed grant, so the wait never eats into the
// spawn's 20-minute TIMEOUT; and that grant's wait is section 6's 15 minutes. Reached by running this
// checkout's `node scripts/proof.mjs before` in a scratch repository (README: The before lane).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { CHECKOUT, dump, event, events, grants, hold, launch, sandbox, started, topLevel, write } from './helpers.mjs';

const ISSUE = 9113; // a planted issue; its tag is worked out here, so no file carries it
const CRITERION = 'The value is two within its budget';
const criterionId = (issue, text) => `#${issue}.${createHash('sha256').update(text.trim().replace(/\s+/g, ' ')).digest('hex').slice(0, 8)}`;
const SLACK = 100;

// A file T9a's seed reads as timed (it calls environmentProblem( at its own call site), listed in the
// scene's own lanes.mjs `timed` list too. It notes when its spawn ran and under which grant.
const BUDGET = `import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import test from 'node:test';
import { value } from '../../../src/value.mjs';

const environmentProblem = () => null;

test('${criterionId(ISSUE, CRITERION)} the value is two within its budget', () => {
  appendFileSync(process.env.T1113_EVENTS, JSON.stringify({ name: 'spawn', event: 'start', t: Date.now(), throttle: process.env.DEEP_THROTTLE ?? null, cwd: process.cwd() }) + '\\n');
  assert.equal(environmentProblem(), null);
  assert.equal(value(), 2);
});
`;
const LANES = `export const testPaths = ['tests/**', 'packages/**/test/**', 'packages/**/*.test.ts', 'crates/*/tests/**'];
export const timed = ['tests/acceptance/${ISSUE}/'];
`;

function scene(box) {
  const cwd = join(box.dir, 'scene');
  mkdirSync(cwd);
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  write(cwd, { 'src/value.mjs': 'export const value = () => 1;\n', 'scripts/lanes.mjs': LANES });
  git('add', '-A');
  git('commit', '-qm', 'base');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  git('checkout', '-q', '-b', 'change');
  write(cwd, { 'src/value.mjs': 'export const value = () => 2;\n', [`tests/acceptance/${ISSUE}/budget.test.mjs`]: BUDGET });
  git('add', '-A');
  git('commit', '-qm', `Make the value two\n\nPart of #${ISSUE}`);
  const issues = join(box.dir, 'issues');
  write(issues, { [`${ISSUE}.md`]: `Planted for #1113.\n\n### Acceptance criteria\n- [ ] ${CRITERION}\n\n### Proof\nNone.\n` });
  return { cwd, env: { DEEP_PROOF_ISSUES: issues, DEEP_APPROVERS: join(box.dir, 'no-approvers') } };
}

test('#1113.6899a042 #1113.a0183037 the before lane spawns its timed set only after its timed grant, which waits up to 15 minutes, so a wait leaves the spawn its full 20-minute TIMEOUT', async (t) => {
  const box = sandbox(t);
  const { cwd, env } = scene(box);
  // Another session's build holds for 3 s, so the before lane's timed request must drain it first.
  const holder = hold(box, 'build', 1, { name: 'neighbour', hold: 3_000 });
  await started(box, 'neighbour');
  const proof = await launch(box, [process.execPath, join(CHECKOUT, 'scripts/proof.mjs'), 'before'], { cwd, env }).done;
  const neighbour = await holder.done;
  const all = dump(box, proof, neighbour);
  const spawns = events(box).filter((e) => e.name === 'spawn');
  assert.ok(spawns.length, `the before lane never ran the timed file\n${all}`);
  const released = event(box, 'neighbour', 'end').t;
  for (const spawn of spawns) {
    assert.match(String(spawn.throttle), /^timed:\S+$/, `a run of the timed set (in ${spawn.cwd}) ran under no timed grant\n${all}`);
    assert.ok(spawn.t >= released - SLACK, `a run of the timed set started ${released - spawn.t} ms before the build holder outside its chain ended: its spawn did not wait for the grant\n${all}`);
  }
  assert.doesNotMatch(proof.stdout, /INCONCLUSIVE no grant|was stopped after/, all);
  // Section 6: timed inside a proof-runs.mjs spawn waits at most 15 minutes for its grant.
  const timed = grants(box, 'timed').filter(topLevel);
  assert.ok(timed.length, `the throttle log holds no top-level timed grant\n${all}`);
  for (const line of timed) assert.equal(Number(line.wait), 15, `the before lane's timed grant wait: ${line.text}\n${all}`);
});
