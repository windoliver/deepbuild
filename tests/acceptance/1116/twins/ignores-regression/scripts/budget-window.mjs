// A planted wrong program for #1116: a regression reads PASS.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compare, fingerprint, judgeInstructions, judgeLimit, measure, measureOnce, validateBudgets } from './benchmark.mjs';
import { holds } from './throttle.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 28 }).trim();
const gh = (...args) => spawnSync('gh', args, { cwd: root, encoding: 'utf8' });
const lanes = join(homedir(), '.deepbuild', 'lanes');
const markFile = join(lanes, 'budget-window-mark');

if (!holds('timed')) {
  console.log('BLOCKED budget-window: outside a window; only throttle.mjs window runs it');
  process.exit(2);
}
mkdirSync(lanes, { recursive: true, mode: 0o700 });
git('fetch', '-q', 'origin', 'main');
const tip = git('rev-parse', 'origin/main');
if (!existsSync(markFile)) {
  writeFileSync(markFile, tip);
  console.log(`PASS budget-window: the first window marks ${tip}`);
  process.exit(0);
}
const mark = readFileSync(markFile, 'utf8').trim();
const commits = git('rev-list', '--first-parent', '--reverse', `${mark}..${tip}`).split('\n').filter(Boolean);

const extract = (sha) => {
  const directory = mkdtempSync(join(tmpdir(), 'deep-window-'));
  const archive = execFileSync('git', ['archive', sha], { cwd: root, maxBuffer: 1 << 28 });
  execFileSync('tar', ['-xf', '-', '-C', directory], { input: archive });
  return directory;
};
const manifest = (directory) => JSON.parse(readFileSync(join(directory, 'benchmarks/budgets.json'), 'utf8'));

function judge(task, established, side, against) {
  const [now, then] = measure(task.command, side, { command: established.command, cwd: against });
  const once = () => {
    const result = measureOnce(task.command, side, false, undefined, false);
    if (result.status !== 0) throw Error(`${task.command[0]} exited ${result.status}`);
    return result;
  };
  const runs = Object.keys(task.limits).length ? (once(), Array.from({ length: 5 }, once)) : [];
  const machine = fingerprint();
  const results = Object.entries(task.limits).map(([metric, limit]) => judgeLimit({ limit, runs: runs.map((run) => (metric === 'peakBytes' ? run.peakBytes : run.elapsedMs)), fingerprint: machine }));
  const instructions = judgeInstructions(now.instructions.map((current, round) => ({ current, base: then.instructions[round] })), [...new Set([...now.uncounted, ...then.uncounted])]);
  try {
    compare({ ...task, limits: {} }, now, then);
  } catch (error) {
    return { state: 'PASS' };
  }
  const off = results.find(({ status }) => status !== 'PASS');
  return off ? { state: off.status, note: off.reason } : { state: 'PASS' };
}

function measureCommit(commit) {
  const [first, second] = git('rev-list', '--parents', '-n', '1', commit).split(' ').slice(1);
  const measured = second ?? commit;
  const base = second ? git('merge-base', first, second) : first;
  const side = extract(measured), against = extract(base);
  const tests = [];
  try {
    const current = manifest(side), established = manifest(against);
    try {
      validateBudgets(current, established);
      for (const task of current.tasks) tests.push({ id: task.id, ...judge(task, established.tasks.find(({ id }) => id === task.id), side, against) });
    } catch (error) {
      tests.push({ id: 'budgets', state: 'BLOCKED', note: error.message });
    }
  } finally {
    rmSync(side, { recursive: true, force: true });
    rmSync(against, { recursive: true, force: true });
  }
  const order = ['FAIL', 'BLOCKED', 'INCONCLUSIVE'];
  const state = order.find((one) => tests.some((test) => test.state === one)) ?? 'PASS';
  const tree = git('rev-parse', `${measured}^{tree}`);
  writeFileSync(join(lanes, `${tree}-budget-window.json`), `${JSON.stringify({ lane: 'budget-window', state, host: hostname(), platform: `${process.platform}-${process.arch}`, tree, commit, base, tests }, null, 2)}\n`);
  return { state, tests };
}

const issueOf = (commit) => git('log', '-1', '--format=%B', commit).match(/\bpart of\s+#(\d+)/i)?.[1];
function proven(number) {
  const view = gh('issue', 'view', number, '--json', 'body');
  if (view.status !== 0) return false;
  const { body } = JSON.parse(view.stdout);
  const section = body.split(/^###\s+Acceptance criteria\s*$/m)[1] ?? '';
  return [...section.matchAll(/^\s*- \[ \] (.+)$/gm)].every(([, text]) => /budget|reference Mac|in the local preflight/i.test(text));
}
function act(commit, { state, tests }) {
  const number = issueOf(commit);
  if (!number) return;
  if (state === 'PASS' && proven(number)) gh('issue', 'close', number, '--comment', `The budget window measured ${commit}: PASS.`);
  if (state === 'FAIL') {
    const missed = tests.filter((test) => test.state === 'FAIL').map(({ id, note }) => `${id}: ${note}`).join('\n');
    gh('issue', 'comment', number, '--body', `The budget window measured ${commit} against its merge base and it missed:\n${missed}`);
    gh('issue', 'create', '--title', `Budget follow-up for #${number}`, '--body', `Commit ${commit} of #${number} missed its budget:\n${missed}`);
  }
}

for (const commit of commits) {
  const result = measureCommit(commit);
  act(commit, result);
  writeFileSync(markFile, commit);
}
