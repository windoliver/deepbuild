// #2136, criterion 5: each lint job in affected.mjs writes and reads a log of its own. Reached by running
// `node scripts/affected.mjs <path>` in a scratch tree holding this checkout's scripts, with each script of the lint
// lane replaced by a stand-in (README: The affected.mjs tree). A job's label is seen through the log it names: two
// jobs of one label write one log.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import test from 'node:test';
import { CHECKOUT, QUIET, affected, affectedTree, dump, filesUnder, lintScripts, sandbox } from './helpers.mjs';

// A changed path that reaches no test, so the run's jobs are the lint lane's alone.
const NOTE = { 'docs/note-2136.txt': 'a file no test reads\n' };
const CLOSURES = 'scripts/canvas-closures.mjs';
/** What a marking stand-in prints: the script's name and its arguments, so each command of the lane prints its own. */
const mark = ([script, ...args]) => `ran-2136 [${[basename(script), ...args].join(' ')}]`;
const MARKS = `import { basename } from 'node:path';\nconsole.log(\`ran-2136 [\${[basename(process.argv[1]), ...process.argv.slice(2)].join(' ')}]\`);\n`;

test('#2136.e7710a49 no two of the lint lane\'s commands get one label: each job\'s output is in a log no other lint job wrote', async (t) => {
  const box = sandbox(t);
  const tree = affectedTree(box, NOTE, { lint: () => MARKS });
  const commands = lintScripts(CHECKOUT);
  assert.ok(commands.filter(([script]) => script === CLOSURES).length >= 2, `the lint lane no longer runs ${CLOSURES} more than once: ${JSON.stringify(commands)}`);
  const run = await affected(box, tree, Object.keys(NOTE));
  const out = dump(box, run);
  // Every file the run left under its temporary folder, its logs among them, by the markers it holds.
  const logs = filesUnder(box.env.TMPDIR).map((file) => ({ file, text: readFileSync(file, 'utf8') }));
  const holders = (command) => logs.filter(({ text }) => text.split('\n').includes(mark(command)));
  const shared = logs.map(({ text }) => commands.map(mark).filter((line) => text.split('\n').includes(line))).filter((marks) => marks.length > 1);
  const unlogged = commands.filter((command) => holders(command).length === 0).map(mark);
  assert.deepEqual({ shared, unlogged }, { shared: [], unlogged: [] }, `of the lint lane's ${commands.length} jobs, ${unlogged.length} left their output in no log and ${shared.length} logs hold more than one job's, so two jobs had one label\n${out}`);
});

test('#2136.e7710a49 a closures run with one FAIL line beside a passing drift run yields that finding once', async (t) => {
  const box = sandbox(t);
  const FINDING = 'closure-2136: a planted finding';
  const wrote = join(box.dir, 'closures-wrote'), drift = join(box.dir, 'drift-ended');
  // closures prints its one FAIL line and fails; drift passes, printing nothing, and ends only once closures has
  // printed, so the two ran beside each other; the script's third run in the lane, paths, passes at once.
  const closures = `import { existsSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
const [mode] = process.argv.slice(2);
if (mode === 'closures') {
  console.log(${JSON.stringify(`FAIL ${FINDING}`)});
  writeFileSync(${JSON.stringify(wrote)}, '');
  process.exitCode = 1;
} else if (mode === 'drift') {
  for (let waited = 0; !existsSync(${JSON.stringify(wrote)}) && waited < 60_000; waited += 20) await sleep(20);
  writeFileSync(${JSON.stringify(drift)}, String(existsSync(${JSON.stringify(wrote)})));
}
`;
  const tree = affectedTree(box, NOTE, { lint: (script) => (script === CLOSURES ? closures : QUIET) });
  const modes = lintScripts(CHECKOUT).filter(([script]) => script === CLOSURES).map(([, mode]) => mode);
  assert.ok(modes.includes('closures') && modes.includes('drift'), `the lint lane no longer runs ${CLOSURES} as closures and as drift: ${modes.join(', ')}`);
  const run = await affected(box, tree, Object.keys(NOTE));
  const out = dump(box, run);
  assert.ok(existsSync(wrote), `the closures job never ran\n${out}`);
  assert.equal(existsSync(drift) && readFileSync(drift, 'utf8'), 'true', `the drift job did not end after the closures job had printed its FAIL line\n${out}`);
  const lines = run.stdout.split('\n').filter((line) => line.includes(FINDING));
  assert.equal(lines.length, 1, `the closures job's one finding is read ${lines.length} times, not once\n${out}`);
});
