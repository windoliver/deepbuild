// #2047 AC4: a closed issue an open pull request closes, swept while that pull request is open and again once it is
// closed unmerged (README: Pending).
import { test } from 'node:test';
import { LONG, assert, body, criterion, dump, fileIssue, filePr, issueOf, namesIssue, prOf, reopenCalls, repo, sandbox, sweep, unheldOf } from './helpers.mjs';

const HEATER = { number: 9121, title: 'the heater', criteria: ['The heater warms the room to 20 C within an hour', 'Tipping the heater over switches it off at once'] };
const PR = 9221;

test('AC4 #2047.5e2430c0 a closed issue an open pull request closes is listed as pending, naming the pull request, and is not reopened; with the pull request closed unmerged the next run reports its criteria unheld and reopens it', LONG, async (t) => {
  const box = await sandbox(t);
  // Main holds no test of the heater's: its tests are on the pull request's branch.
  repo(box, { 'tests/unit.test.mjs': "import test from 'node:test';\n\ntest('the fixture repository has a test', () => {});\n" });
  fileIssue(box, { number: HEATER.number, title: `Fixture: ${HEATER.title}`, body: body(HEATER.title, HEATER.criteria) });
  filePr(box, { number: PR, title: 'The heater, with its tests', state: 'OPEN', closes: [HEATER.number] });
  const ids = HEATER.criteria.map((_, i) => criterion(HEATER, i + 1).id).sort();

  const first = await sweep(box);
  let all = dump(first);
  assert.ok(reopenCalls(first, HEATER.number).length === 0 && issueOf(box, HEATER.number).state === 'CLOSED', `#${HEATER.number} was reopened while pull request #${PR}, which closes it, is open\n${all}`);
  assert.ok(first.lines.some((line) => /\bpending\b/.test(line) && namesIssue(line, HEATER.number) && namesIssue(line, PR)), `#${HEATER.number} isn't listed as pending, naming pull request #${PR}, which closes it and is open\n${all}`);

  // The pull request is closed without merging; main still holds no test of the heater's.
  filePr(box, { ...prOf(box, PR), state: 'CLOSED' });
  const second = await sweep(box);
  all = dump(first, second);
  assert.deepEqual(unheldOf(second, HEATER.number), ids, `with pull request #${PR} closed unmerged, the next run doesn't report #${HEATER.number}'s two criteria unheld\n${all}`);
  assert.ok(issueOf(box, HEATER.number).state === 'OPEN' && reopenCalls(second, HEATER.number).length === 1, `with pull request #${PR} closed unmerged, the next run didn't reopen #${HEATER.number}\n${all}`);
  assert.deepEqual([first.status, second.status], [0, 0], `a run with no issue BLOCKED didn't exit 0\n${all}`);
});
