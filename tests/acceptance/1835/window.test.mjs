// #1835: one real scene, as the issue's Proof asks: a fixture repository and the fixture issue, twice, its third
// criterion once a budget the fixture's task names and once one that no test and no task proves. For each, a `Part of`
// change whose tests prove the first two criteria runs the real trace lane (`proof.mjs trace`) and lands on main; one
// real window (`throttle.mjs window`) then takes both landings. Each test reads what that left: the lane's evidence
// record, the issue's body, state and comments in the stand-in gh, and the window's record for the commit. The scene
// runs once, on the first test's turn.
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { dump, fixture, fullWindow, issue, marked, recordOf, sandbox, TASK } from '../1116/helpers.mjs';
import { criterionId, fileBody, nameCriteria, SLOW, WINDOW_MS } from '../1874/helpers.mjs';
import { commit } from '../1981/helpers.mjs';
import { criteriaIn, land, partOfLine, provenIn, provesTwo, recordName, source, traceRecord, WRONG } from './helpers.mjs';

const BUDGET = 9601, PLAIN = 9602;
const SUM = 'The sum of two numbers is their total', HALF = 'Half a number is it divided by two';
const CRITERIA = {
  // The third criterion a budget, which the fixture's task names (AC2's first half).
  [BUDGET]: [SUM, HALF, `\`${TASK}\` stays within its p50 budget on a reference Mac`],
  // The third criterion no budget, and proven by no test of the change (AC2's second half).
  [PLAIN]: [SUM, HALF, 'Doubling a number multiplies it by two'],
};
const body = (criteria) => `A fixture issue for #1835.\n\n### Acceptance criteria\n${criteria.map((text) => `- [ ] ${text}`).join('\n')}\n\n### Proof\nThe issue's body before and after the landing.\n`;
const ids = (number) => CRITERIA[number].map((text) => criterionId(number, text));
const box = sandbox({ after });

async function play() {
  const repo = fixture(box);
  for (const number of [BUDGET, PLAIN]) fileBody(box, number, body(CRITERIA[number]));
  // Before the first window's mark: each issue's module, wrong, and the task naming the budget criterion.
  commit(box, repo, { [source(BUDGET)]: WRONG, [source(PLAIN)]: WRONG }, "The fixture's arithmetic, wrong until each issue's change lands");
  nameCriteria(box, repo, [ids(BUDGET)[2]]);
  await marked(box, repo);
  // Both changes fork from the marked commit, and the budget issue's lands first: main has moved under the other by
  // its merge, so that merge commit holds another tree than the branch tip its trace lane ran on.
  const fork = repo.git('rev-parse', 'main'), changes = {};
  for (const number of [BUDGET, PLAIN]) changes[number] = await land(box, repo, number, provesTwo(number, CRITERIA[number]), fork);
  return { changes, run: await fullWindow(box, repo, { ms: WINDOW_MS }) };
}
let played;
const scene = () => (played ??= play());

/** The landed commit's record, once the window measured it and its task passed: a window that did nothing proves nothing. */
function passed(s, number) {
  const { commit: landed } = s.changes[number];
  const record = recordOf(box, landed);
  assert.ok(record, `the window left no record for #${number}'s commit ${landed}\n${dump(box, s.run)}`);
  assert.equal(record.tests.find(({ id }) => id === TASK)?.state, 'PASS', `${TASK} was to pass on #${number}'s commit: ${JSON.stringify(record)}\n${dump(box, s.run)}`);
  return record;
}

test("#1835.fb2cf14f a fixture issue with three criteria and a Part of change whose trace lane proved the first two: after it lands, those two lines are ticked, each naming the lane's record, and the third is not", SLOW, async () => {
  const s = await scene();
  for (const number of [BUDGET, PLAIN]) {
    const { trace, tree, commit: landed } = s.changes[number], [first, second, third] = ids(number);
    // The change: its trace lane proved the first two criteria and left the third open, by its own line and its record.
    const line = partOfLine(trace, number);
    assert.ok(trace.status === 0 && line.includes(third) && !line.includes(first) && !line.includes(second), `the trace lane was to pass #${number}'s change as Part of #${number}, with only ${third} open\n${dump(box, trace)}`);
    const record = traceRecord(box, tree);
    assert.ok(record, `the trace lane left no evidence record ${recordName(tree)} under ~/.deepbuild/lanes/ for #${number}'s change\n${dump(box, trace)}`);
    assert.deepEqual({ lane: record.lane, tree: record.tree, proven: provenIn(record, ids(number)) }, { lane: 'trace', tree, proven: [first, second] }, `the trace lane's record isn't the trace lane's, of the change's tree, holding the first two criteria of #${number} as proven and only them: ${JSON.stringify(record)}`);
    // The landing: the same three criteria, each with its text and so its ID as it was, the first two ticked.
    const after = criteriaIn(number, issue(box, number).body);
    const read = `#${number}'s body after ${landed} landed:\n${issue(box, number).body}\n${dump(box, s.run)}`;
    assert.deepEqual(after.map(({ id }) => id), ids(number), `#${number} no longer holds its three criteria, each with the text and the ID it had before the landing\n${read}`);
    for (const { id, ticked } of after.slice(0, 2)) assert.ok(ticked, `${id} isn't ticked, though the trace lane's record ${recordName(tree)} proves it\n${read}`);
    assert.ok(!after[2].ticked, `the landing ticked ${third}, the third criterion of #${number} ("${CRITERIA[number][2]}"), which the trace lane left open\n${read}`);
    for (const { id, item } of after.slice(0, 2)) assert.ok(item.includes(recordName(tree)), `the ticked line of ${id} doesn't name the lane's record ${recordName(tree)}\n${read}`);
  }
});

test('#1835.5f2ccf69 with the third criterion a budget, a passing window closes the fixture issue, naming its commit', SLOW, async () => {
  const s = await scene();
  passed(s, BUDGET);
  const { state, comments } = issue(box, BUDGET), { commit: landed } = s.changes[BUDGET];
  assert.equal(state, 'CLOSED', `a passing window left #${BUDGET} open, though the trace lane proved its first two criteria and the task names its third, a budget\n${issue(box, BUDGET).body}\n${dump(box, s.run)}`);
  assert.ok(comments.some((comment) => comment.includes(landed.slice(0, 7))), `the window closed #${BUDGET} without naming its commit ${landed}: ${JSON.stringify(comments)}`);
});

test('#1835.5f2ccf69 with the third criterion unproven and not a budget, the fixture issue stays open, naming it', SLOW, async () => {
  const s = await scene();
  const record = passed(s, PLAIN), third = ids(PLAIN)[2];
  assert.equal(issue(box, PLAIN).state, 'OPEN', `the window closed #${PLAIN}, whose third criterion ${third} ("${CRITERIA[PLAIN][2]}") no test and no task proves\n${dump(box, s.run)}`);
  assert.deepEqual(record.unmeasured, [third], `the record of #${PLAIN}'s commit doesn't name ${third}, and only it, as what keeps the issue open: ${JSON.stringify(record)}\n${issue(box, PLAIN).body}`);
});
