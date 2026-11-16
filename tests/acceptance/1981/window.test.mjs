// #1981: one real scene, as the issue's Proof asks: a fixture repository that is a cargo workspace with one crate,
// deep-hook, and five budget tasks; two commits, each measured by a real window of its own (`throttle.mjs window`), so
// the samples written during a window are its one commit's. Each test reads what the window left for its commit: the
// record, the stand-in gh's issues and the tasks' own samples. The scene runs once, on the first test's turn.
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { dump, fixture, issue, marked, recordOf, sandbox } from '../1116/helpers.mjs';
import { criterionId, fileBody, SLOW } from '../1874/helpers.mjs';
import { CANVAS, commit, HOOK, LOOSE, ran, row, selectable, TASKS, windowOn, workspace } from './helpers.mjs';

const MEASURED_ELSEWHERE = 9501, UNRELATED = 9502;
// The issue's only budget criterion, which canvas-seal names (AC3).
const BUDGET = '`canvas-seal` stays within its p50 budget on a reference Mac';
const BODIES = {
  [MEASURED_ELSEWHERE]: `A fixture issue for #1981.\n\n### Acceptance criteria\n- [x] The fixture's other behaviour holds\n- [ ] ${BUDGET}\n`,
  [UNRELATED]: 'A fixture issue for #1981, with no criteria.\n',
};
const box = sandbox({ after });

async function play() {
  const repo = fixture(box);
  selectable(box);
  for (const [number, body] of Object.entries(BODIES)) fileBody(box, number, body);
  workspace(box, repo, { 'canvas-seal': [criterionId(MEASURED_ELSEWHERE, BUDGET)] });
  await marked(box, repo);
  // AC1 and AC3: a commit that changes only crates/deep-hook, naming the issue only canvas-seal measures.
  const hook = commit(box, repo, { 'crates/deep-hook/src/main.rs': 'fn main() {\n    println!("deep-hook 0.0.1");\n}\n' }, `Change deep-hook's greeting\n\nPart of #${MEASURED_ELSEWHERE}`);
  const atHook = await windowOn(box, repo);
  // AC2: a commit that changes only a file no task reads.
  const notes = commit(box, repo, { 'docs/notes.txt': 'Notes no task reads.\n' }, `Add notes\n\nPart of #${UNRELATED}`);
  const atNotes = await windowOn(box, repo);
  return { hook: { commit: hook, ...atHook }, notes: { commit: notes, ...atNotes } };
}
let played;
const scene = () => (played ??= play());

/** The commit's record: a window that wrote none proves nothing. */
function recorded(s, name) {
  const record = recordOf(box, s[name].commit);
  assert.ok(record, `the window left no record for the ${name} commit ${s[name].commit}\n${dump(box, s[name].run)}`);
  return record;
}

test('#1981.91e6703b a fixture commit that changes only crates/deep-hook runs the tasks whose commands run deep-hook\'s binary and no task that runs only benchmarks/canvas.mjs, and its record lists each task not run as not reached', SLOW, async () => {
  const s = await scene();
  const record = recorded(s, 'hook');
  for (const id of HOOK) {
    assert.ok(ran(s.hook, id).length, `the window didn't run ${id}, whose command runs deep-hook's binary, on a commit that changes crates/deep-hook\n${dump(box, s.hook.run)}`);
    assert.equal(row(record, id)?.state, 'PASS', `${id} was to pass on the commit that changes crates/deep-hook: ${JSON.stringify(record)}`);
  }
  for (const id of CANVAS) assert.equal(ran(s.hook, id).length, 0, `the window ran ${id}, which runs only benchmarks/canvas.mjs, on a commit that changes only crates/deep-hook and can't reach it\n${dump(box, s.hook.run)}`);
  const notRun = TASKS.filter((id) => !ran(s.hook, id).length);
  assert.deepEqual([...record.notReached ?? []].sort(), notRun.sort(), `the record doesn't list each task not run (${notRun.join(', ')}) as not reached: ${JSON.stringify(record)}`);
  for (const id of notRun) assert.notEqual(row(record, id)?.state, 'PASS', `the record has ${id}, which didn't run, as PASS: ${JSON.stringify(record)}`);
});

test('#1981.a6a21922 a task whose command affected.mjs can\'t place runs on a fixture commit that changes an unrelated file', SLOW, async () => {
  const s = await scene();
  const record = recorded(s, 'notes');
  assert.ok(ran(s.notes, LOOSE).length, `the window didn't run ${LOOSE}, whose command affected.mjs can't place, on a commit that changes only docs/notes.txt\n${dump(box, s.notes.run)}`);
  assert.equal(row(record, LOOSE)?.state, 'PASS', `${LOOSE} was to pass on the commit that changes only docs/notes.txt: ${JSON.stringify(record)}`);
});

test('#1981.2eb85d5e a fixture commit naming an issue whose only budget criterion is measured by a task the commit didn\'t reach leaves that issue open, its record naming the task as not reached', SLOW, async () => {
  const s = await scene();
  const record = recorded(s, 'hook');
  // Every task the window ran on it passed, so only the unreached task can keep the issue open.
  for (const { id, state } of record.tests) assert.equal(state, 'PASS', `${id} was to pass on the commit that changes crates/deep-hook: ${JSON.stringify(record)}`);
  assert.equal(issue(box, MEASURED_ELSEWHERE).state, 'OPEN', `the window closed #${MEASURED_ELSEWHERE}, whose only budget criterion canvas-seal measures, on a commit that can't reach canvas-seal\n${dump(box, s.hook.run)}`);
  assert.ok(record.notReached?.includes('canvas-seal'), `the record doesn't name canvas-seal, the task that measures #${MEASURED_ELSEWHERE}'s criterion, as not reached: ${JSON.stringify(record)}`);
});
