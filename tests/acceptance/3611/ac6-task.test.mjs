// Criterion 6 of #3611 (#3611.3b726ffd): "Budget, on the reference Mac in the local preflight, compared with the merge
// base: a fresh canvas core with the shipped packs and a filled store answers its first call in under 500 ms (drafted),
// and its memory after that reply reads within its margin"
//
// The part of the criterion that reads no clock, which runs on any machine; ac6-first-reply.test.mjs takes the time.
// "Compared with the merge base" and "within its margin" are the budget window's: a budget criterion that says "in the
// local preflight" is met by the window's record for its commit once a task of benchmarks/budgets.json names it
// (docs/parallel-proof.md, 12a), and the window compares a task's time and memory with the merge base's at the task's
// margin. So (judge.mjs `judgeTask`): a task of benchmarks/budgets.json names this criterion in its `criteria`, holds
// the issue's 500 ms as `targets.first_reply_ms`, has the lane's margin of a half, names #3611 in its `initialReason`,
// and the file passes the lane's own validator against the merge base's.
// Wrong programs it fails on: the merge base (no such task); a task with another number or a wider margin.
// Run: node --test tests/acceptance/3611/ac6-task.test.mjs
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO, blocked, must, none } from './core.mjs';
import { judgeTask } from './judge.mjs';

test('AC6 #3611.3b726ffd benchmarks/budgets.json holds a task that names this criterion, with the issue\'s 500 ms as its target, compared with the merge base at the lane\'s margin, and passes the lane\'s validator', { timeout: 10 * 60_000 }, () => {
  let text;
  try { text = readFileSync(join(REPO, 'benchmarks', 'budgets.json'), 'utf8'); } catch (error) { throw blocked(`benchmarks/budgets.json can't be read: ${error.message}`); }
  none(judgeTask(JSON.parse(text)), 'AC6 #3611.3b726ffd: the budget window\'s task for a first reply on a filled store');

  // The lane's own validator, in a child process, against the merge base's file, as #161's suite runs it.
  const mergeBase = spawnSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' });
  if (mergeBase.status !== 0) throw blocked(`git merge-base HEAD origin/main: ${mergeBase.stderr}`);
  const base = spawnSync('git', ['show', `${mergeBase.stdout.trim()}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (base.status !== 0) throw blocked(`the merge base's benchmarks/budgets.json: ${base.stderr}`);
  const script = `import { readFileSync } from 'node:fs';\nimport * as b from ${JSON.stringify(join(REPO, 'scripts', 'benchmark.mjs'))};\nconst [current, base] = JSON.parse(readFileSync(0, 'utf8'));\ntry { b.validateBudgets(current, base); process.stdout.write('valid'); } catch (error) { process.stdout.write(error.message); }`;
  const ran = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: REPO, encoding: 'utf8', input: JSON.stringify([JSON.parse(text), JSON.parse(base.stdout)]), timeout: 300_000, maxBuffer: 64 * 1024 * 1024 });
  if (ran.status !== 0) throw blocked(`scripts/benchmark.mjs didn't run: ${(ran.stderr ?? '').slice(-2000)}`);
  must(ran.stdout === 'valid', `AC6 #3611.3b726ffd: the lane's validator refuses benchmarks/budgets.json against the merge base's: ${ran.stdout.slice(0, 1500)}`);
});
