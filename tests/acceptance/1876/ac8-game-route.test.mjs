// #1876 criterion 8: no line of the design says a complete game takes the engine project route as its only route, and
// the Decided row names the canvas game shell (#851). Through the design links lane's own commands on a scratch copy:
// a planted copy of line 2092's old sentence fails the lane, naming the line, and so does a planted copy of the Decided
// row without the game shell (README: Criteria and tests; Readings).
import assert from 'node:assert/strict';
import test from 'node:test';
import { CHECKOUT, DESIGN, ONLY_ROUTE, clean, decidedRow, item, namesLine, onlyRouteLines, read, replaceLine, runLane, shown, unfailed, word } from './helpers.mjs';

// The issue's line 2092 is the item of "Cut, or deferred" that starts with these words, and this was its last sentence
// on November 9 (docs/technical-design.md at f3bcc704f, the commit the issue's line numbers are of).
const CUT = '- Complete-game kits beyond the grid core';
const OLD = 'Complete games take the engine project route, through the game project blueprint; versions native to the canvas, and each genre layer of a kit, wait for a brief that needs them.';

test('AC8 #1876.23de0760 no line of the design says a complete game takes the engine project route as its only route, and a planted copy of line 2092\'s old sentence fails the design links lane, naming the line', (t) => {
  const copy = clean(t);
  const problems = [];
  // The tree: every line of the checkout's own design.
  for (const { number, line } of onlyRouteLines(read(CHECKOUT, DESIGN))) problems.push(`${DESIGN}:${number} says a complete game takes the engine project route as its only route: "${line.match(ONLY_ROUTE)[0]}"`);
  // The plant: the copy's line 2092 with the old sentence in place of what it says of complete games today.
  const own = item(read(copy.repo, DESIGN), CUT);
  const line = [...own.line.split(/(?<=\.)\s+(?=[A-Z])/).filter((sentence) => !/^Complete games take\b/.test(sentence)), OLD].join(' ');
  assert.ok(line.startsWith(CUT) && ONLY_ROUTE.test(line), `the planted line doesn't hold the old sentence: ${line.slice(0, 300)}`);
  replaceLine(copy.repo, DESIGN, own.number, line);
  const run = runLane(copy.repo, copy.issues);
  const planted = `a planted copy of line 2092's old sentence, "${OLD.slice(0, 44)} …" (${DESIGN}:${own.number})`;
  problems.push(...unfailed(run, planted));
  if (run.status !== 0 && !namesLine(run, { number: own.number, content: line.slice(own.line.length - own.content.length) }, [OLD.slice(0, 44)])) problems.push(`on ${planted}, the lane failed without naming the line: ${shown(run)}`);
  if (problems.length) assert.fail(problems.join('\n\n'));
});

// The row names the game shell by its words or by its recipe's name, as the design writes it: "the game shell, `shell@1`".
const namesShell = (line) => /\bgame shell\b/i.test(line) || line.includes('shell@1');

test('AC8 #1876.23de0760 the Decided row for bounded games names the canvas game shell, and a planted copy of the row without it fails the design links lane', (t) => {
  const copy = clean(t);
  const problems = [];
  // The tree: the checkout's own row.
  const row = decidedRow(read(CHECKOUT, DESIGN));
  if (!namesShell(row.line)) problems.push(`the Decided row "Bounded games on the canvas" (${DESIGN}:${row.number}) doesn't name the game shell`);
  // The plant: the copy's row with no `shell@1`, no word "shell" and no #851, and nothing else changed.
  const own = decidedRow(read(copy.repo, DESIGN));
  const line = own.line.replace(/,?\s*`?shell@1`?/g, '').replace(/\s*(?<![\w-])shell(?![\w-])/gi, '').replace(/\s*\(?#851\)?/g, '');
  assert.ok(!namesShell(line) && !word('shell', 'i').test(line) && !line.includes('#851') && !ONLY_ROUTE.test(line), `the planted row still names the game shell, or says the engine project route is the only route: ${line.slice(-400)}`);
  replaceLine(copy.repo, DESIGN, own.number, line);
  const run = runLane(copy.repo, copy.issues);
  problems.push(...unfailed(run, `a planted copy of the Decided row "Bounded games on the canvas" that names no game shell (${DESIGN}:${own.number})`));
  if (problems.length) assert.fail(problems.join('\n\n'));
});
