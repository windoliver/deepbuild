// #1114: in the before and trace lanes, the timed set (the tagged files lanes.mjs's `timed` list covers) is spawned
// only once its timed grant is held, so a wait for the grant never counts against the spawn's 20-minute TIMEOUT.
// Reached by running this checkout's `node scripts/proof.mjs before` and `... trace` in a scratch repository whose
// scripts/ is this checkout's, so its lanes.mjs is the change's own (README: The before and trace lanes).
import assert from 'node:assert/strict';
import { cpSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative } from 'node:path';
import test from 'node:test';
import { CHECKOUT, dump, gitIn, hold, launch, loaded, logLines, outsideTimedGrant, probe, runsOf, sandbox, timedPath, until, write } from './helpers.mjs';

const ISSUE = 9114; // a planted issue; its tags are worked out here, so no file carries them
const TIMED_CRITERION = 'The value is two within its budget';
const PLAIN_CRITERION = 'The value is two';
const criterionId = (issue, text) => `#${issue}.${createHash('sha256').update(text.trim().replace(/\s+/g, ' ')).digest('hex').slice(0, 8)}`;
const PLAIN = `tests/acceptance/${ISSUE}/plain.test.mjs`;
const HOLD_MS = 3_000;

function scene(box, TIMED) {
  const cwd = join(box.dir, 'scene');
  mkdirSync(cwd);
  const git = gitIn(cwd);
  git('init', '-q', '-b', 'main');
  cpSync(join(CHECKOUT, 'scripts'), join(cwd, 'scripts'), { recursive: true });
  write(cwd, { 'src/value.mjs': 'export const value = () => 1;\n' });
  git('add', '-A');
  git('commit', '-qm', 'base');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  git('checkout', '-q', '-b', 'change');
  const body = (file) => ({ imports: `import assert from 'node:assert/strict';\nimport { value } from './${relative(dirname(file), 'src/value.mjs')}';`, body: 'assert.equal(value(), 2);' });
  write(cwd, {
    'src/value.mjs': 'export const value = () => 2;\n',
    [TIMED]: probe('timed', `${criterionId(ISSUE, TIMED_CRITERION)} the value is two within its budget`, body(TIMED)),
    [PLAIN]: probe('plain', `${criterionId(ISSUE, PLAIN_CRITERION)} the value is two`, body(PLAIN)),
  });
  git('add', '-A');
  git('commit', '-qm', `Make the value two\n\nPart of #${ISSUE}`);
  const issues = join(box.dir, 'issues');
  write(issues, { [`${ISSUE}.md`]: `Planted for #1114.\n\n### Acceptance criteria\n- [ ] ${TIMED_CRITERION}\n- [ ] ${PLAIN_CRITERION}\n\n### Proof\nNone.\n` });
  return { cwd, env: { DEEP_PROOF_ISSUES: issues, DEEP_APPROVERS: join(box.dir, 'no-approvers') } };
}

async function lane(t, name) {
  const problem = loaded();
  if (problem) return t.skip(problem);
  const box = sandbox(t);
  const TIMED = timedPath();
  const { cwd, env } = scene(box, TIMED);
  // Another session's build holds for 3 s, so the lane's timed request has to wait for it: a scaled grant wait.
  const holder = hold(box, 'build', 'neighbour', HOLD_MS);
  assert.ok(await until(() => runsOf(box, 'neighbour').length, 10_000), `the neighbour never started under the throttle\n${dump(box)}`);
  const child = launch(box, [process.execPath, join(CHECKOUT, 'scripts/proof.mjs'), name], { cwd, env });
  const proof = await child.done;
  const neighbour = await holder.done;
  const all = dump(box, proof, neighbour);
  const released = runsOf(box, 'neighbour', 'end')[0]?.t;
  assert.ok(released, `the neighbour never ended\n${all}`);

  const starts = runsOf(box, 'timed'), ends = runsOf(box, 'timed', 'end');
  // The before lane runs each tagged file on the merge base and on the change.
  assert.ok(starts.length >= 2, `the ${name} lane did not run the timed file ${TIMED} on both the merge base and the change\n${all}`);
  for (const start of starts) {
    const end = ends.find((e) => e.pid === start.pid);
    const outside = outsideTimedGrant(box, start, end);
    assert.equal(outside, null, `a run of the timed set (in ${start.cwd}) was not inside its timed grant: ${outside}\n${all}`);
    assert.ok(start.t >= released, `a run of the timed set started ${released - start.t} ms before the build outside its chain ended, so its spawn did not wait for the grant\n${all}`);
    // The spawn itself starts after the grant: no process between the proof lane and the test runner is a throttle
    // that waits for the grant inside the spawn, where the wait would count against the spawn's TIMEOUT.
    const chain = start.ancestors ?? [];
    const at = chain.findIndex((process) => process.pid === child.pid);
    assert.ok(at >= 0, `the timed file's process is no descendant of the proof lane (pid ${child.pid})\n${all}`);
    const between = chain.slice(0, at).filter(({ command }) => /throttle\.mjs/.test(command));
    assert.deepEqual(between.map(({ command }) => command), [], `the timed set's spawn waits for its grant inside itself, so the wait counts against its TIMEOUT\n${all}`);
    // A 14-minute wait ends in a grant, not in INCONCLUSIVE: the grant's wait is at least 14 minutes.
    const id = String(start.throttle).split(':')[1];
    const granted = logLines(box).find((line) => line.event === 'granted' && line.id === id);
    assert.ok(Number(granted.wait) >= 14, `the timed grant waits at most ${granted.wait} min, so a 14-minute wait never gets it\n${all}`);
  }
  const plain = runsOf(box, 'plain');
  assert.ok(plain.length >= 2, `the ${name} lane did not run the untimed file on both the merge base and the change\n${all}`);
  for (const start of plain) assert.doesNotMatch(String(start.throttle), /^timed:/, `the untimed file ran in the timed set\n${all}`);
  assert.doesNotMatch(proof.stdout, /INCONCLUSIVE no grant|was stopped after/, all);
}

test('#1114.52a78dd9 in the before lane the timed set spawns only after its timed grant, so a 14-minute wait leaves its full 20-minute TIMEOUT', (t) => lane(t, 'before'));

test('#1114.52a78dd9 in the trace lane the timed set spawns only after its timed grant, so a 14-minute wait leaves its full 20-minute TIMEOUT', (t) => lane(t, 'trace'));
