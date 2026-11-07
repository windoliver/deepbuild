// #1333 AC5 and the Scope line on known-failures.json: the real lint lane's known-failures command, run through the real
// runLanes on a repository whose known-failures.json the test writes (README: The surface, Known failures).
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CHECKOUT, LONG, assert, copyScripts, ended, fileIssue, launch, sandbox } from './helpers.mjs';

const CHECK = 'scripts/known-failures-check.mjs';
const day = (ago) => new Date(Date.now() - ago * 86_400_000).toISOString().slice(0, 10);
const entry = (issue, ago) => `fails on main 1a2b3c4: a fixture failure (#${issue}, added ${day(ago)})`;

/**
 * The checkout's lint lane cut to its known-failures command, run by the checkout's runLanes in a git repository holding
 * this checkout's scripts/ and `failures` as its known-failures.json's failures.
 */
async function lintLane(box, failures, name) {
  const repo = join(box.dir, name);
  mkdirSync(repo);
  copyScripts(repo, `${JSON.stringify({ failures, lint: {}, timing: [], skips: [] }, null, 2)}\n`);
  for (const args of [['init', '-q', '-b', 'main'], ['add', '-A'], ['commit', '-qm', 'fixture']]) execFileSync('git', args, { cwd: repo, env: box.env, stdio: 'pipe' });
  const lanes = pathToFileURL(join(CHECKOUT, 'scripts', 'lanes.mjs')).href;
  const code = `const { checks, runLanes } = await import(${JSON.stringify(lanes)});
const lint = checks.find(({ name }) => name === 'lint');
const commands = lint.commands.filter((command) => command.includes(${JSON.stringify(CHECK)}));
if (!commands.length) { console.log('NO-COMMAND the lint lane runs no ${CHECK}'); process.exit(9); }
process.exitCode = runLanes([{ ...lint, commands }], { cwd: ${JSON.stringify(repo)} });`;
  return ended(launch(box, [process.execPath, '--input-type=module', '-e', code], { cwd: repo }), 600_000);
}
const show = (run) => `exit ${run.status}\nstdout:\n${run.stdout}\nstderr:\n${run.stderr}`;

test(`#1333.87ce4575 a known-failures.json entry with no open issue fails the lane, naming the entry`, LONG, async (t) => {
  const box = await sandbox(t);
  fileIssue(box, 9501);
  fileIssue(box, 9502, { state: 'CLOSED' });
  const kept = 'tests/kept.test.mjs › keeps a fixture failure';
  const closed = 'tests/closed.test.mjs › its issue was closed';
  const bare = 'tests/bare.test.mjs › names no issue';
  const bad = await lintLane(box, { [kept]: entry(9501, 2), [closed]: entry(9502, 2), [bare]: 'fails on main 1a2b3c4: a fixture failure' }, 'bad');
  assert.notEqual(bad.status, 9, `the lint lane in scripts/lanes.mjs doesn't run ${CHECK}\n${show(bad)}`);
  assert.ok(bad.status !== 0 && /^FAIL lint\b/m.test(bad.stdout), `the lint lane didn't fail on entries with no open issue\n${show(bad)}`);
  for (const id of [closed, bare]) assert.ok(bad.stdout.includes(id), `the lint lane's failure doesn't name the entry ${id}\n${show(bad)}`);
  const good = await lintLane(box, { [kept]: entry(9501, 2) }, 'good');
  assert.ok(good.status === 0 && /^PASS lint\b/m.test(good.stdout), `the lint lane fails an entry that names an open issue, added two days ago\n${show(good)}`);
});

test('every known-failures.json entry names an issue and the date it was added, and the lane fails one older than 14 days, naming it', LONG, async (t) => {
  const box = await sandbox(t);
  fileIssue(box, 9501);
  const old = 'tests/old.test.mjs › sits too long';
  const run = await lintLane(box, { 'tests/kept.test.mjs › keeps a fixture failure': entry(9501, 2), [old]: entry(9501, 20) }, 'old');
  assert.ok(run.status !== 0 && /^FAIL lint\b/m.test(run.stdout) && run.stdout.includes(old), `the lint lane didn't fail the entry added 20 days ago, naming it\n${show(run)}`);
  // This checkout's own file: each entry names its issue and the date it was added (whether the issue is open is the
  // lane's to read from GitHub).
  const { failures } = JSON.parse(readFileSync(join(CHECKOUT, 'scripts', 'known-failures.json'), 'utf8'));
  const unnamed = Object.entries(failures).filter(([, note]) => !/\(#\d+, added \d{4}-\d{2}-\d{2}\)$/.test(note)).map(([id]) => id);
  assert.deepEqual(unnamed, [], `these entries of scripts/known-failures.json don't end "(#<issue>, added <YYYY-MM-DD>)"`);
});
