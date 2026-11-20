// Helpers for #2047's acceptance tests: a sandbox, the gh stand-in first on PATH (gh.cjs), the fixture repository (a
// small git repository whose origin is a bare repository in the sandbox, so origin/main is main), the fixture issues
// and pull requests the stand-in serves, and readers for what a run printed and asked of gh. Nothing here imports the
// code under test: the sweep is run as `node scripts/closed-sweep.mjs` in the fixture repository (README: The surface).
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { accessSync, chmodSync, constants, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
/** The sweep, run from this checkout with its working folder in the fixture repository (README: The surface). */
export const SWEEP = join(CHECKOUT, 'scripts/closed-sweep.mjs');
const STAND_IN = fileURLToPath(new URL('./gh.cjs', import.meta.url));
export const LONG = { timeout: 1_800_000 };
/** The login the stand-in gives every comment written through it (gh.cjs). */
export const SWEEPER = 'fixture-sweeper';
/** Proxies that lead nowhere: a request that bypasses gh fails at once instead of reaching the network. */
const NOWHERE = 'http://127.0.0.1:9';

/** A criterion's ID by the trace lane's rule (scripts/proof-change.mjs, criterionId): its text trimmed, white space collapsed. */
export const idOf = (issue, text) => `#${issue}.${createHash('sha256').update(text.trim().replace(/\s+/g, ' ')).digest('hex').slice(0, 8)}`;
/** The first words a line or a comment names a criterion by (README: Lines): its first five, as written. */
export const firstWords = (text) => text.trim().split(/\s+/).slice(0, 5).join(' ');

const sh = (text) => `'${text.replaceAll("'", "'\\''")}'`;
const jsonLines = (path) => (existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []);
const write = (root, files) => {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
};

const homeIn = (home) => ({ HOME: home, XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'), XDG_DATA_HOME: join(home, '.local/share'), XDG_STATE_HOME: join(home, '.local/state') });

/**
 * A sandbox removed after the test: the gh stand-in's state folder and its wrapper first on PATH, a HOME, a TMPDIR and
 * a git identity of its own, no GH_*, GITHUB_*, DEEP_* or git-location variables, and proxies that lead nowhere. Each
 * run of the sweep gets a fresh HOME and TMPDIR in it (sweep, below). Every process a test starts is stopped by its
 * group's PID.
 */
export async function sandbox(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-2047-')));
  const bin = join(dir, 'bin'), gh = join(dir, 'gh'), home = join(dir, 'home-0'), temp = join(dir, 'tmp-0');
  for (const folder of [bin, gh, home, temp]) mkdirSync(folder);
  writeFileSync(join(dir, 'gitconfig'), '[user]\n\tname = Fixture\n\temail = fixture@example.invalid\n[commit]\n\tgpgsign = false\n[init]\n\tdefaultBranch = main\n[core]\n\thooksPath = /dev/null\n');
  writeFileSync(join(bin, 'gh'), `#!/bin/sh\nexec ${sh(process.execPath)} ${sh(STAND_IN)} ${sh(gh)} "$@"\n`);
  chmodSync(join(bin, 'gh'), 0o755);
  const env = {
    ...process.env, ...homeIn(home), TMPDIR: temp, PATH: `${bin}${delimiter}${process.env.PATH}`,
    GIT_CONFIG_GLOBAL: join(dir, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0',
    HTTP_PROXY: NOWHERE, HTTPS_PROXY: NOWHERE, ALL_PROXY: NOWHERE, http_proxy: NOWHERE, https_proxy: NOWHERE, all_proxy: NOWHERE, NODE_USE_ENV_PROXY: '1',
  };
  for (const name of Object.keys(env)) {
    if (/^(GH_|GITHUB_|DEEP_|GIT_(DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|COMMON_DIR|NAMESPACE)$)/.test(name) || ['NODE_OPTIONS', 'NODE_TEST_CONTEXT', 'NO_PROXY', 'no_proxy'].includes(name)) delete env[name];
  }
  const box = { dir, bin, gh, env, runs: 0, children: [], origin: null };
  t.after(() => {
    for (const child of box.children) if (child.exitCode === null && child.signalCode === null) try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    rmSync(dir, { recursive: true, force: true });
  });
  return box;
}

const git = (box, cwd, ...args) => execFileSync('git', args, { cwd, env: box.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/**
 * The fixture repository: `files` committed on main and pushed to its origin, a bare repository at
 * <sandbox>/github/fixture/closed.git, so `git remote get-url origin` reads as fixture/closed and nothing a fetch reaches
 * is outside the sandbox. Each run of the sweep starts in a fresh clone of it.
 */
export function repo(box, files) {
  const origin = join(box.dir, 'github', 'fixture', 'closed.git'), seed = join(box.dir, 'seed');
  mkdirSync(dirname(origin), { recursive: true });
  git(box, box.dir, 'init', '-q', '--bare', '-b', 'main', origin);
  write(seed, { 'README.md': "A made-up repository for the closed-issue sweep's acceptance tests.\n", ...files });
  git(box, seed, 'init', '-q', '-b', 'main');
  git(box, seed, 'add', '-A');
  git(box, seed, 'commit', '-qm', 'The fixture tree of tests');
  git(box, seed, 'remote', 'add', 'origin', origin);
  git(box, seed, 'push', '-q', 'origin', 'main');
  box.origin = origin;
}

/** An issue body as this repo writes them: its criteria are the `- [ ]` lines under `### Acceptance criteria`. */
export const body = (title, criteria, { ticked = false } = {}) => [
  `A made-up issue for the closed-issue sweep's acceptance tests: ${title}.`, '', '### Scope', `- ${title}, as the criteria say`, '',
  '### Acceptance criteria', ...criteria.map((text) => `- [${ticked ? 'x' : ' '}] ${text}`), '', '### Proof', 'The fixture tree of tests.', '',
].join('\n');

/** An issue in the stand-in's GitHub. A comment is `{ login, body, createdAt }`. */
export function fileIssue(box, { number, title, body: text, state = 'CLOSED', reason = state === 'CLOSED' ? 'COMPLETED' : null, comments = [] }) {
  writeFileSync(join(box.gh, `issue-${number}.json`), JSON.stringify({ number, title, body: text, state, stateReason: reason, comments }, null, 1));
}
/** A pull request in the stand-in's GitHub, `closes` the issues it closes (its closingIssuesReferences). */
export function filePr(box, { number, title = `Fixture pull request ${number}`, state = 'OPEN', closes = [] }) {
  writeFileSync(join(box.gh, `pr-${number}.json`), JSON.stringify({ number, title, state, closes }, null, 1));
}
/** Every later call for the issue fails, as GitHub failing for it would. */
export const failFor = (box, number) => writeFileSync(join(box.gh, 'fail.json'), JSON.stringify([number]));
export const issueOf = (box, number) => JSON.parse(readFileSync(join(box.gh, `issue-${number}.json`), 'utf8'));
export const prOf = (box, number) => JSON.parse(readFileSync(join(box.gh, `pr-${number}.json`), 'utf8'));
/** The comments written through the stand-in on an issue, oldest first. */
export const sweepComments = (box, number) => issueOf(box, number).comments.filter(({ login }) => login === SWEEPER);
const calls = (box) => jsonLines(join(box.gh, 'calls.jsonl'));
const refused = (box) => jsonLines(join(box.gh, 'refused.jsonl'));

/** The first executable `name` on `path`, as the child's exec finds it. */
function firstOnPath(path, name) {
  for (const folder of path.split(delimiter)) {
    try {
      accessSync(join(folder, name), constants.X_OK);
      return join(folder, name);
    } catch {}
  }
  return null;
}

const SUMMARY = /\bread (\d+), held (\d+), pending (\d+), reopened (\d+)\b/;

/**
 * One run of `node scripts/closed-sweep.mjs`, in a fresh clone of the fixture repository with a HOME and a TMPDIR of
 * its own, as a run on another machine would be: what it printed, how it ended, the gh calls it made and the stand-in
 * refused, and its summary line read (null unless exactly one line reads as one).
 */
export async function sweep(box, { timeout = 900_000 } = {}) {
  const k = ++box.runs;
  const home = join(box.dir, `home-${k}`), temp = join(box.dir, `tmp-${k}`), cwd = join(box.dir, `run-${k}`);
  for (const folder of [home, temp]) mkdirSync(folder);
  git(box, box.dir, 'clone', '-q', box.origin, cwd);
  const env = { ...box.env, ...homeIn(home), TMPDIR: temp };
  assert.equal(firstOnPath(env.PATH, 'gh'), join(box.bin, 'gh'), 'harness: the gh the sweep finds first on PATH is not the stand-in');
  const before = calls(box).length, refusedBefore = refused(box).length;
  const child = spawn(process.execPath, [SWEEP], { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  box.children.push(child);
  let stdout = '', stderr = '', timedOut = false;
  child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
  const stop = setTimeout(() => { timedOut = true; try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, timeout);
  const [status, signal] = await new Promise((resolve) => {
    child.on('close', (code, sig) => resolve([code, sig]));
    child.on('error', (error) => { stderr += `harness: the sweep didn't start: ${error.message}\n`; resolve([null, null]); });
  });
  clearTimeout(stop);
  const lines = stdout.split('\n').map((line) => line.trimEnd()).filter(Boolean);
  const summaries = lines.filter((line) => SUMMARY.test(line));
  const counts = summaries.length === 1 ? summaries[0].match(SUMMARY).slice(1).map(Number) : null;
  return {
    k, status, signal, timedOut, stdout, stderr, lines, calls: calls(box).slice(before), refused: refused(box).slice(refusedBefore),
    summary: counts && { read: counts[0], held: counts[1], pending: counts[2], reopened: counts[3], line: summaries[0] },
  };
}

/** Whether a line names issue #n itself, not one of its criterion IDs (#n.<h8>) or a longer number. */
export const namesIssue = (line, n) => new RegExp(`#${n}(?![0-9]|\\.[0-9a-f]{8})`).test(line);
/** The IDs of issue #n a run's lines report unheld (`unheld <id>`), sorted. */
export const unheldOf = (run, n) => [...new Set([...run.stdout.matchAll(/\bunheld (#(\d+)\.[0-9a-f]{8})\b/g)].filter(([, , number]) => Number(number) === n).map(([, id]) => id))].sort();
/** Whether one line of the run holds every part. */
export const lineWith = (run, ...parts) => run.lines.some((line) => parts.every((part) => line.includes(part)));

const VALUED = new Set(['-R', '--repo', '-c', '--comment', '-b', '--body', '-F', '--body-file', '--json', '-q', '--jq']);
/** The issue a `gh issue <verb>` call names. */
function target(args) {
  for (let i = 2; i < args.length; i++) {
    if (VALUED.has(args[i])) { i++; continue; }
    if (args[i].startsWith('-')) continue;
    const m = args[i].match(/(?:^#?|\/)(\d+)\/?$/);
    return m ? Number(m[1]) : NaN;
  }
  return NaN;
}
const commented = (args) => args.slice(2).some((arg) => ['-c', '--comment'].includes(arg) || arg.startsWith('--comment='));
/** A run's `gh issue reopen` calls, of issue #n when given. */
export const reopenCalls = (run, n) => run.calls.filter(({ args }) => args[0] === 'issue' && args[1] === 'reopen' && (n === undefined || target(args) === n));
/** A run's calls that comment: `gh issue comment`, and `gh issue reopen` with a comment. */
export const commentCalls = (run) => run.calls.filter(({ args }) => args[0] === 'issue' && (args[1] === 'comment' || (args[1] === 'reopen' && commented(args))));

const tail = (text, size) => (text.length > size ? `…${text.slice(-size)}` : text);
/** What a person reads at a failed assertion: each run's end, output, gh calls and refusals. */
export function dump(...runs) {
  return runs.filter(Boolean).map((run) => {
    const shown = run.calls.map(({ args, stdin }) => JSON.stringify(stdin === undefined ? args : [...args, `<stdin: ${stdin}>`]));
    const listed = shown.length > 30 ? [...shown.slice(0, 15), `… ${shown.length - 30} more …`, ...shown.slice(-15)] : shown;
    return [
      `run ${run.k}: exit ${run.status}${run.signal ? ` (${run.signal}${run.timedOut ? ', stopped at its time limit' : ''})` : ''}`,
      `stdout:\n${tail(run.stdout, 6000)}`, `stderr:\n${tail(run.stderr, 3000)}`, `gh calls (${shown.length}):\n${listed.join('\n')}`,
      ...(run.refused.length ? [`refused by the stand-in:\n${run.refused.map(({ args, why }) => `${JSON.stringify(args)}: ${why}`).join('\n')}`] : []),
    ].join('\n');
  }).join('\n----\n');
}

/**
 * The six closed issues AC1, AC2 and AC3 read (README: The fixtures). The lamp's boxes are ticked, as a closed issue's
 * often are; the clock's sixth criterion is the one AC3 adds; the door's `before` is its second criterion's wording when
 * its suite was written.
 */
export const SIX = {
  lamp: { number: 9101, title: 'the lamp', ticked: true, criteria: [
    'Pressing the switch lights the lamp within one second',
    'A second press darkens the lamp within one second',
    'The label under the base reads 40 W',
    'Unplugging the lamp keeps it dark when the switch is pressed',
  ] },
  kettle: { number: 9102, title: 'the kettle', criteria: [
    'Filling the kettle to the line holds 1.5 L',
    'Boiling switches the kettle off within ten seconds',
    'An empty kettle refuses to heat and shows a red light',
  ] },
  clock: { number: 9103, title: 'the clock', criteria: [
    'The clock shows the hour in 24-hour form',
    'Setting the alarm rings it at the set minute',
    'A power cut keeps the time for one hour',
    'Daylight saving moves the hour forward on its date',
    'The snooze button silences the alarm for nine minutes',
  ], sixth: 'Dimming at night lowers the display to a tenth' },
  fan: { number: 9104, title: 'the fan', criteria: [
    'The fan spins at three speeds from one dial',
    'Its guard keeps a finger out at every speed',
    'Oscillation sweeps 90 degrees at the top speed',
  ] },
  toaster: { number: 9105, title: 'the toaster', reason: 'NOT_PLANNED', criteria: [
    'Both slots brown the bread evenly at setting four',
    'The crumb tray slides out without tools',
  ] },
  door: { number: 9106, title: 'the door', criteria: [
    'The door latches when it is pushed shut',
    'The lock turns with the key from either side',
    'The hinge opens the door to 100 degrees',
  ], before: 'The lock turns with the key from outside' },
};
/** Criterion k (from 1) of a fixture issue: its ID and its first words. */
export const criterion = (issue, k, text = issue.criteria[k - 1]) => ({ id: idOf(issue.number, text), words: firstWords(text), text });

/**
 * The six issues in the stand-in, and their tree of tests on main: the lamp's suite names criteria 1 and 2 by ID and
 * keeps 3 and 4 in its helper, as house suites keep their IDs; the kettle's names no ID and each criterion's AC<n>;
 * the clock's names 1 to 3 by ID (4 and 5 came after it); the fan and the toaster have none; the door's names 1, its
 * second criterion's ID before the rewording, and 3. A person's comment on the clock names its two new criteria.
 */
export function sixIssues(box) {
  const { lamp, kettle, clock, door } = SIX;
  const id = (issue, k) => criterion(issue, k).id;
  repo(box, {
    'tests/acceptance/9101/helpers.mjs': `// The lamp's criterion IDs, kept here and named by its tests.\nexport const LABEL = '${id(lamp, 3)}';\nexport const UNPLUGGED = '${id(lamp, 4)}';\n`,
    'tests/acceptance/9101/lamp.test.mjs': [
      "import test from 'node:test';", "import { LABEL, UNPLUGGED } from './helpers.mjs';", '',
      `test('${id(lamp, 1)} pressing the switch lights the lamp', () => {});`,
      `test('${id(lamp, 2)} a second press darkens it', () => {});`,
      'test(`${LABEL} the label reads 40 W`, () => {});',
      'test(`${UNPLUGGED} unplugged, it stays dark`, () => {});', '',
    ].join('\n'),
    'tests/acceptance/9102/kettle.test.mjs': [
      "import test from 'node:test';", '',
      "test('AC1 filling to the line holds 1.5 L', () => {});",
      "test('AC2 boiling switches it off', () => {});",
      "test('AC3 an empty kettle refuses to heat', () => {});", '',
    ].join('\n'),
    'tests/acceptance/9103/clock.test.mjs': [
      "import test from 'node:test';", '',
      `test('AC1 ${id(clock, 1)} shows the hour in 24-hour form', () => {});`,
      `test('AC2 ${id(clock, 2)} the alarm rings at the set minute', () => {});`,
      `test('AC3 ${id(clock, 3)} a power cut keeps the time', () => {});`, '',
    ].join('\n'),
    'tests/acceptance/9106/door.test.mjs': [
      "import test from 'node:test';", '',
      `test('AC1 ${id(door, 1)} the door latches', () => {});`,
      `test('AC2 ${criterion(door, 2, door.before).id} the lock turns with the key from outside', () => {});`,
      `test('AC3 ${id(door, 3)} the hinge opens to 100 degrees', () => {});`, '',
    ].join('\n'),
  });
  const person = { login: 'fixture-person', body: `Criteria ${id(clock, 4)} and ${id(clock, 5)} were added on Nov 7, after the suite.`, createdAt: '2026-11-07T12:00:00Z' };
  for (const issue of Object.values(SIX)) {
    fileIssue(box, {
      number: issue.number, title: `Fixture: ${issue.title}`, body: body(issue.title, issue.criteria, { ticked: issue.ticked }),
      reason: issue.reason ?? 'COMPLETED', comments: issue === clock ? [person] : [],
    });
  }
}

export { assert };
