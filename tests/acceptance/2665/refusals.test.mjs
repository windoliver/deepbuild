// #2665: one real scene for the changes a ceiling refuses. A fixture repository whose budgets hold seven tasks, and six
// commits after the first window's mark, each changing one task: a raised limit, a removed limit, a wider margin and a
// new command, none approved; a raise under an approved proposal that names its task and holds both numbers; and a
// raise under an approval naming another task. One real window (`throttle.mjs window`) measures all six, on a stand-in
// reference Mac at a quiet load. The scene runs on the test's turn.
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { loop, manifest, marked, recordOf, row, sandbox, SLOW, task, windowOver } from './helpers.mjs';

const box = sandbox({ after });
const OLD = 100_000_000, RAISED = 150_000_000;
const IDS = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta'];
// epsilon's row is read, so it counts longer, for a steady time; the others' rows aren't.
const tasks = (changes) => manifest(IDS.map((id) => ({ ...task(id, loop(id === 'epsilon' ? 20_000 : 2_000), { peakBytes: OLD }), ...changes[id] })));
/** An approved proposal's item for a raise of `id`'s peakBytes limit from OLD to RAISED (README: The surface). */
const proposal = (id) => `benchmarks/budgets.json › ${id} › peakBytes ${OLD} → ${RAISED}`;

async function play() {
  const changes = {};
  const repo = await marked(box, { 'benchmarks/budgets.json': tasks(changes) });
  // Each commit changes one more task; a refused change stays on main, so each commit's merge base holds the ones before.
  const change = (id, to, message) => {
    changes[id] = to;
    return repo.commit({ 'benchmarks/budgets.json': tasks(changes) }, message);
  };
  const raised = change('alpha', { limits: { peakBytes: RAISED } }, 'Raise alpha\'s peakBytes limit');
  const removed = change('beta', { limits: {} }, 'Remove beta\'s peakBytes limit');
  const widened = change('gamma', { margin: 0.75 }, 'Widen gamma\'s margin');
  const rewritten = change('delta', { command: loop(3_000) }, 'Change delta\'s command');
  const approved = change('epsilon', { limits: { peakBytes: RAISED } }, 'Raise epsilon\'s peakBytes limit under an approved proposal');
  repo.approve('raise-epsilon', approved, [proposal('epsilon')]);
  const misapproved = change('zeta', { limits: { peakBytes: RAISED } }, 'Raise zeta\'s peakBytes limit under an approval naming eta');
  repo.approve('raise-eta', misapproved, [proposal('eta')]);
  const run = await windowOver(box, repo);
  return { raised, removed, widened, rewritten, approved, misapproved, run };
}
let played;
const scene = () => (played ??= play());

const named = (text, word) => new RegExp(`(?<![\\w-])${word}(?![\\w-])`).test(text ?? '');
/** The row that refuses a commit naming `id` and `field`: FAIL or BLOCKED, its note naming both (README: The surface). */
const refusal = (record, id, field) => record.tests.find(({ state, note }) => ['FAIL', 'BLOCKED'].includes(state) && named(note, id) && named(note, field));
const notes = (record) => `${record.state}: ${record.tests.map(({ id, state, note }) => `${id} ${state}${note ? `: ${note}` : ''}`).join('; ')}`;

test('#2665.d2a7b8af a fixture change that raises a limit, one that removes it, one that widens the task\'s margin and one that changes its command are each refused, naming the task and the field; with an approved proposal that names the task and holds both numbers, the raise passes', SLOW, async () => {
  const s = await scene();
  const refused = [
    ['raised', 'alpha', 'peakBytes', `raises alpha's peakBytes limit from ${OLD} to ${RAISED}`],
    ['removed', 'beta', 'peakBytes', 'removes beta\'s peakBytes limit'],
    ['widened', 'gamma', 'margin', 'widens gamma\'s margin from 0.5 to 0.75'],
    ['rewritten', 'delta', 'command', 'changes delta\'s command'],
  ];
  for (const [name, id, field, what] of refused) {
    const record = recordOf(box, s.run, s[name], `the commit that ${what}`);
    assert.notEqual(record.state, 'PASS', `the commit ${s[name]} that ${what}, with no approval, passed: ${notes(record)}`);
    assert.ok(refusal(record, id, field), `the commit ${s[name]} that ${what} wasn't refused naming ${id} and ${field}: ${notes(record)}`);
  }

  const approved = recordOf(box, s.run, s.approved, 'the approved raise');
  const epsilon = row(approved, 'epsilon');
  assert.ok(epsilon && !refusal(approved, 'epsilon', 'peakBytes'), `the window refused ${s.approved}, whose raise of epsilon's peakBytes limit from ${OLD} to ${RAISED} an approved proposal names: ${notes(approved)}`);
  assert.equal(epsilon.limits?.peakBytes?.status, 'PASS', `epsilon's peakBytes limit didn't pass on ${s.approved}: ${JSON.stringify(epsilon)}`);
  assert.equal(epsilon.state, 'PASS', `epsilon didn't pass on ${s.approved}, whose raise an approved proposal names: ${JSON.stringify(epsilon)}`);

  const misapproved = recordOf(box, s.run, s.misapproved, 'the raise under an approval naming another task');
  assert.notEqual(misapproved.state, 'PASS', `the window took an approval naming eta for zeta's raise in ${s.misapproved}: ${notes(misapproved)}`);
  assert.ok(refusal(misapproved, 'zeta', 'peakBytes'), `the window took an approval naming eta for zeta's raise in ${s.misapproved}: it wasn't refused naming zeta and peakBytes: ${notes(misapproved)}`);
});
