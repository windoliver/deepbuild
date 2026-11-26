// #1876 criterion 7: the design's two ready rules (the issue's lines 40 and 42: the R6 work run under "Later, as
// extensions", and Work runs) both say a blocker on the baseline list of issues closed before the gate satisfies a
// blocked-by link, and a planted copy of line 40 without it fails the design links lane, naming the bullet (README:
// Criteria and tests).
import assert from 'node:assert/strict';
import test from 'node:test';
import { CHECKOUT, DESIGN, clean, item, namesLine, read, replaceLine, runLane, shown, unfailed } from './helpers.mjs';

const R6 = '- In R6: playbooks (';
const RUNS = '- **Work runs.**';
// What a line holds when it says it, in the criterion's own words.
const SAYS = [['the baseline list', /\bbaseline\b/i], ['issues closed before the gate', /\bclosed before the gate\b/i], ['that it satisfies a blocked-by link', /\bsatisf(?:y|ies) a blocked-by link\b/i]];
// What a line without it holds none of.
const WORDS = [/baseline/i, /closed before the gate/i, /blocked-by link/i];

test('AC7 #1876.a2923be3 the two ready rules both say a blocker on the baseline list of issues closed before the gate satisfies a blocked-by link, and a planted copy of line 40 without it fails the design links lane, naming the bullet', (t) => {
  const copy = clean(t);
  const problems = [];
  // The tree: the checkout's own design, both bullets.
  const design = read(CHECKOUT, DESIGN);
  for (const start of [R6, RUNS]) {
    const rule = item(design, start);
    const unsaid = SAYS.filter(([, said]) => !said.test(rule.line)).map(([name]) => name);
    if (unsaid.length) problems.push(`the bullet that starts "${start}" (${DESIGN}:${rule.number}) doesn't say a blocker on the baseline list of issues closed before the gate satisfies a blocked-by link: it doesn't hold ${unsaid.join(', ')}`);
  }
  // The plant: the copy's line 40 without each clause that says it, a clause ending at a comma, semicolon, colon or full stop.
  const own = item(read(copy.repo, DESIGN), R6);
  const line = own.line.split(/(?<=[,;:.])\s+/).filter((clause) => !WORDS.some((said) => said.test(clause))).join(' ');
  assert.ok(line.startsWith(R6) && !WORDS.some((said) => said.test(line)), `the planted bullet still says it: ${line.slice(0, 300)}`);
  replaceLine(copy.repo, DESIGN, own.number, line);
  const run = runLane(copy.repo, copy.issues);
  const planted = `a planted copy of the bullet that starts "${R6}" without the baseline list (${DESIGN}:${own.number})`;
  problems.push(...unfailed(run, planted));
  if (run.status !== 0 && !namesLine(run, { number: own.number, content: line.slice(own.line.length - own.content.length) }, ['In R6: playbooks'])) problems.push(`on ${planted}, the lane failed without naming the bullet: ${shown(run)}`);
  if (problems.length) assert.fail(problems.join('\n\n'));
});
