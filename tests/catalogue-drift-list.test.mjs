// What #2063's blind suite leaves out of scripts/not-event-kinds.txt's reading: an entry the lane has no use for, a name
// listed twice and a missing list each fail the lane in one FAIL line. The real script runs in a scratch folder that
// holds two docs, a list and the open issues.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../scripts/catalogue-drift.mjs', import.meta.url));
// #1 defines a check in an event family and names a catalogued kind and a file; #2 names the same check.
const ISSUES = [
  { number: 1, body: 'The check `plan.overlay` reads `rules.json` after `ask.created`.' },
  { number: 2, body: 'Runs after `plan.overlay`.' },
];

/** The lane's exit status and output over ISSUES and the list's lines; `null` leaves the list out. */
function lane(t, list) {
  const root = mkdtempSync(join(tmpdir(), 'deep-drift-list-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const dir of ['docs', 'scripts']) mkdirSync(join(root, dir));
  for (const doc of ['technical-design.md', 'canvas-primitives.md']) writeFileSync(join(root, 'docs', doc), 'No names here.\n');
  if (list) writeFileSync(join(root, 'scripts/not-event-kinds.txt'), `${list.join('\n')}\n`);
  writeFileSync(join(root, 'issues.json'), JSON.stringify(ISSUES));
  const run = spawnSync(process.execPath, [SCRIPT], { cwd: root, encoding: 'utf8', env: { ...process.env, DEEP_OPEN_ISSUES: join(root, 'issues.json') } });
  return { status: run.status, output: run.stdout + run.stderr };
}

/** The lane failed in one FAIL line, with no stack, that names every one of `names`. */
function failsNaming(run, ...names) {
  assert.equal(run.status, 1, run.output);
  const lines = run.output.trim().split('\n');
  assert.equal(lines.length, 1, `the lane printed more than its FAIL line:\n${run.output}`);
  assert.match(lines[0], /^FAIL /, run.output);
  for (const name of names) assert.ok(lines[0].includes(name), `the FAIL line doesn't name ${name}:\n${run.output}`);
}

test('the check listed once, beside the issue that defines it, passes the lane', (t) => {
  const run = lane(t, ['plan.overlay #1']);
  assert.equal(run.status, 0, run.output);
  assert.match(run.output, /\(1 listed\)/);
});

test('an entry for a catalogued event kind fails the lane, naming it, though its issue names it', (t) => {
  failsNaming(lane(t, ['plan.overlay #1', 'ask.created #1']), 'ask.created');
});

test('an entry for a name of no event family fails the lane, naming it, though its issue names it', (t) => {
  failsNaming(lane(t, ['plan.overlay #1', 'rules.json #1']), 'rules.json');
});

test('a name listed twice fails the lane, naming it, though each issue names it', (t) => {
  failsNaming(lane(t, ['plan.overlay #1', 'plan.overlay #2']), 'plan.overlay', 'twice');
});

test('a missing list fails the lane in a FAIL line that names the list, not a stack', (t) => {
  failsNaming(lane(t, null), 'scripts/not-event-kinds.txt');
});
