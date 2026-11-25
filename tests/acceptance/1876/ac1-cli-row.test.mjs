// #1876 criterion 1: every command `deep --help` lists in packages/cli/src/main.ts is named in the design's CLI row,
// and the row names no `claim`. Through the design links lane's own commands on a scratch copy: a planted usage line
// for a command the design lacks fails the lane, naming it, and so does a planted copy of the row that names `claim`
// (README: Criteria and tests).
import assert from 'node:assert/strict';
import test from 'node:test';
import { CHECKOUT, DESIGN, MAIN, clean, cliRow, helpCommands, insertAfter, namesWord, read, replaceLine, rowNames, runLane, shown, unfailed } from './helpers.mjs';

// The planted command: a word the issue's other plants use, which no usage line leads with and the row doesn't name.
const COMMAND = 'ghost';

test('AC1 #1876.eb3b3c11 the CLI row names every command `deep --help` lists, and a planted usage line for a command the design lacks fails the design links lane, naming it', (t) => {
  const copy = clean(t);
  const problems = [];
  // The tree: the checkout's own design and main.ts.
  const row = cliRow(read(CHECKOUT, DESIGN));
  const unnamed = helpCommands(CHECKOUT).commands.filter((command) => !rowNames(row.line, command));
  if (unnamed.length) problems.push(`the CLI row (${DESIGN}:${row.number}) doesn't name ${unnamed.length} of the commands \`deep --help\` lists in ${MAIN}: ${unnamed.join(', ')}`);
  // The plant: one more usage line in the copy's main.ts, first in `const usage`.
  const usage = helpCommands(copy.repo);
  assert.ok(!usage.commands.includes(COMMAND) && !rowNames(cliRow(read(copy.repo, DESIGN)).line, COMMAND), `\`deep ${COMMAND}\` is already a command or already in the CLI row, so planting it would prove nothing`);
  insertAfter(copy.repo, MAIN, usage.from + 1, `  'deep ${COMMAND}   a planted command that the CLI row of the design does not name',`);
  assert.ok(helpCommands(copy.repo).commands.includes(COMMAND), `the planted usage line isn't read as a command of ${MAIN}`);
  const run = runLane(copy.repo, copy.issues);
  const planted = `a planted usage line for \`deep ${COMMAND}\` in ${MAIN}, a command the CLI row doesn't name`;
  problems.push(...unfailed(run, planted));
  if (run.status !== 0 && !namesWord(run, COMMAND)) problems.push(`on ${planted}, the lane failed without naming \`${COMMAND}\`: ${shown(run)}`);
  if (problems.length) assert.fail(problems.join('\n\n'));
});

// The row with `claim` named as it names its other commands: one more word in its `deep a · b · c` list. A row written
// another way gets a code span of its own in its second cell.
function withClaim(line) {
  const listed = line.replace(/(`+)(deep [^`·]+?)( · )/, (_, tick, first, dot) => `${tick}${first}${dot}claim${dot}`);
  if (listed !== line) return listed;
  const [, head, rest] = line.match(/^(\|[^|]*\|\s*)(.*)$/);
  return `${head}\`deep claim\`, ${rest}`;
}

test('AC1 #1876.eb3b3c11 the CLI row names no `claim`, and a planted copy of the row that names it fails the design links lane, naming `claim`', (t) => {
  const copy = clean(t);
  const problems = [];
  // The tree.
  const row = cliRow(read(CHECKOUT, DESIGN));
  if (rowNames(row.line, 'claim')) problems.push(`the CLI row (${DESIGN}:${row.number}) names \`claim\``);
  // The plant: the copy's row, with `claim` among its commands.
  const own = cliRow(read(copy.repo, DESIGN));
  const line = withClaim(own.line);
  assert.ok(rowNames(line, 'claim'), `the planted row doesn't name \`claim\`: ${line.slice(0, 200)}`);
  replaceLine(copy.repo, DESIGN, own.number, line);
  const run = runLane(copy.repo, copy.issues);
  const planted = `a planted copy of the CLI row that names \`claim\` (${DESIGN}:${own.number})`;
  problems.push(...unfailed(run, planted));
  if (run.status !== 0 && !namesWord(run, 'claim')) problems.push(`on ${planted}, the lane failed without naming \`claim\`: ${shown(run)}`);
  if (problems.length) assert.fail(problems.join('\n\n'));
});
