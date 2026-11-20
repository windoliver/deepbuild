// #2047 AC5: two closed issues whose criteria main's tests name by ID, and a stand-in that fails every call for one of
// them (README: BLOCKED).
import { test } from 'node:test';
import { LONG, assert, body, criterion, dump, failFor, fileIssue, namesIssue, repo, sandbox, sweep } from './helpers.mjs';

const BELL = { number: 9111, title: 'the bell', criteria: ['Pressing the button rings the bell once', 'The bell rings at 80 dB at one metre'] };
const GATE = { number: 9112, title: 'the gate', criteria: ['The gate swings open toward the garden', 'A latch holds the gate shut in wind'] };

test('AC5 #2047.0356e83a with the stand-in failing for one issue the run prints BLOCKED naming it and exits non-zero, and the summary counts it neither held nor reopened', LONG, async (t) => {
  const box = await sandbox(t);
  const suite = (issue) => ["import test from 'node:test';", '', ...issue.criteria.map((_, i) => `test('${criterion(issue, i + 1).id} holds', () => {});`), ''].join('\n');
  repo(box, { 'tests/acceptance/9111/bell.test.mjs': suite(BELL), 'tests/acceptance/9112/gate.test.mjs': suite(GATE) });
  for (const issue of [BELL, GATE]) fileIssue(box, { number: issue.number, title: `Fixture: ${issue.title}`, body: body(issue.title, issue.criteria) });
  failFor(box, GATE.number);

  const run = await sweep(box);
  const all = dump(run);
  assert.ok(run.lines.some((line) => /\bBLOCKED\b/.test(line) && namesIssue(line, GATE.number)), `no line reads BLOCKED naming #${GATE.number}, the issue gh failed to read\n${all}`);
  assert.ok(Number.isInteger(run.status) && run.status !== 0, `the run exited ${run.status}, not non-zero, with #${GATE.number} unread\n${all}`);
  assert.ok(run.summary, `the run printed no one summary line\n${all}`);
  assert.equal(run.summary.held, 1, `the summary counts ${run.summary.held} issues held, not 1 (#${BELL.number}): #${GATE.number} couldn't be read, so it isn't held: ${run.summary.line}\n${all}`);
  assert.equal(run.summary.reopened, 0, `the summary counts ${run.summary.reopened} issues reopened, not 0: ${run.summary.line}\n${all}`);
});
