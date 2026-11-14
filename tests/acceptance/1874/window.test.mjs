// #1874: one real scene, as the issue's Proof asks: a fixture repository with four commits, each naming one issue,
// run through one real window (`throttle.mjs window`). The fixture's one task names the criteria it proves; each test
// reads what the window left for its commit. The scene runs once, on the first test's turn.
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { dump, fixture, fullWindow, issue, marked, recordOf, sandbox, TASK } from '../1116/helpers.mjs';
import { criterionId, fileBody, nameCriteria, SLOW, unticked, WINDOW_MS } from './helpers.mjs';

const UNNAMED = 9401, PREFLIGHT = 9402, NO_SECTION = 9403, NAMED = 9404;
const OTHER = "- [x] The fixture's other behaviour holds";
const BODIES = {
  // A budget criterion no task names (AC1).
  [UNNAMED]: `A fixture issue for #1874.\n\n### Acceptance criteria\n${OTHER}\n- [ ] \`${TASK}\` stays within its p50 budget on a reference Mac\n`,
  // No budget: it only says where a check runs (AC2).
  [PREFLIGHT]: `A fixture issue for #1874.\n\n### Acceptance criteria\n${OTHER}\n- [ ] The fixture's docs are linted in the local preflight\n`,
  // No \`### Acceptance criteria\` section, as #1009 has none (AC3).
  [NO_SECTION]: `A fixture issue for #1874.\n\n## Criterion\n- [ ] \`${TASK}\` stays within its budget on a reference Mac, in the local preflight\n\n### Depends on\n- none\n`,
  // Two budget criteria, each named by the task, and every other criterion ticked (AC4).
  [NAMED]: `A fixture issue for #1874.\n\n### Acceptance criteria\n${OTHER}\n- [ ] \`${TASK}\` stays within its p50 budget on a reference Mac\n- [ ] \`${TASK}\` stays within its peak memory budget on a reference Mac\n`,
};
// What the task names: AC4's two criteria, and the checkbox under AC3's `## Criterion`, by the ID it would have were
// it a criterion, so only the missing section keeps that issue open.
const TASK_NAMES = [...unticked(NAMED, BODIES[NAMED]), criterionId(NO_SECTION, BODIES[NO_SECTION].match(/- \[ \] (.+)/)[1])];
const box = sandbox({ after });

async function play() {
  const repo = fixture(box);
  for (const [number, body] of Object.entries(BODIES)) fileBody(box, number, body);
  nameCriteria(box, repo, TASK_NAMES);
  await marked(box, repo);
  const commits = {};
  for (const [name, number] of [['unnamed', UNNAMED], ['preflight', PREFLIGHT], ['nosection', NO_SECTION], ['named', NAMED]]) commits[number] = repo.push(name, number);
  return { commits, run: await fullWindow(box, repo, { ms: WINDOW_MS }) };
}
let played;
const scene = () => (played ??= play());

/** The commit's record, once the window measured it and its task passed: a window that did nothing proves nothing. */
function passed(s, number) {
  const record = recordOf(box, s.commits[number]);
  assert.ok(record, `the window left no record for #${number}'s commit ${s.commits[number]}\n${dump(box, s.run)}`);
  assert.equal(record.tests.find(({ id }) => id === TASK)?.state, 'PASS', `${TASK} was to pass on #${number}'s commit: ${JSON.stringify(record)}\n${dump(box, s.run)}`);
  return record;
}

test('#1874.31be6d55 a commit naming an issue whose unticked budget criterion no task names leaves that issue open, and its record names the criterion as unmeasured', SLOW, async () => {
  const s = await scene();
  const record = passed(s, UNNAMED);
  assert.equal(issue(box, UNNAMED).state, 'OPEN', `the window closed an issue whose budget criterion no task names\n${dump(box, s.run)}`);
  assert.deepEqual(record.unmeasured, unticked(UNNAMED, BODIES[UNNAMED]), `the record doesn't name the criterion as unmeasured: ${JSON.stringify(record)}`);
});

test('#1874.5b585ee4 a commit naming an issue whose only unticked criterion says "in the local preflight", and which no task names, leaves the issue open', SLOW, async () => {
  const s = await scene();
  passed(s, PREFLIGHT);
  assert.equal(issue(box, PREFLIGHT).state, 'OPEN', `the window closed an issue on a criterion no task names\n${dump(box, s.run)}`);
});

test('#1874.e31e7828 a commit naming an issue with no `### Acceptance criteria` section closes nothing', SLOW, async () => {
  const s = await scene();
  passed(s, NO_SECTION);
  assert.equal(issue(box, NO_SECTION).state, 'OPEN', `the window closed an issue with no \`### Acceptance criteria\` section\n${dump(box, s.run)}`);
});

test('#1874.cbb20ab2 a commit whose issue\'s budget criteria are each named by a task that passed, with every other criterion ticked, closes the issue', SLOW, async () => {
  const s = await scene();
  passed(s, NAMED);
  assert.equal(issue(box, NAMED).state, 'CLOSED', `the window left open an issue whose budget criteria are each named by a task that passed\n${dump(box, s.run)}`);
});
