// The perf lane's own judges (scripts/benchmark.mjs judgeTask, judgeTargets) on the tasks named: the change against
// its merge base, 20 alternated rounds a side, as perf.mjs and the budget window call them. usage: node judge2.mjs <task>...
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const root = '<home>/doneright-2365', baseRoot = '<home>/doneright-2365-repair';
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1 << 28 }).trim();
const baseCommit = git(root, 'merge-base', 'HEAD', 'origin/main');
if (git(baseRoot, 'rev-parse', 'HEAD') !== baseCommit) throw Error(`the base checkout is not at the merge base ${baseCommit}`);
const { judgeTask, judgeTargets, validateBudgets } = await import(`${root}/scripts/benchmark.mjs`);
const current = JSON.parse(readFileSync(`${root}/benchmarks/budgets.json`, 'utf8'));
const base = JSON.parse(git(root, 'show', `${baseCommit}:benchmarks/budgets.json`));
validateBudgets(current, base);
console.log(JSON.stringify({ change: git(root, 'rev-parse', 'HEAD'), baseCommit, node: process.version }));
for (const id of process.argv.slice(2)) {
  const budget = current.tasks.find((t) => t.id === id);
  const established = base.tasks.find((t) => t.id === id);
  try {
    if (established) {
      const j = judgeTask(budget, established, root, baseRoot);
      const summary = (side) => side && { p50Ms: side.p50Ms, peakBytes: side.peakBytes, samples: side.samples, instructions: side.instructions };
      console.log(JSON.stringify({ task: id, outcome: j.outcome ?? null, regression: j.regression, instructions: j.instructions ? { status: j.instructions.status, change: j.instructions.change ?? null, reason: j.instructions.reason ?? null } : null, limits: j.limits, current: summary(j.now), base: summary(j.then), fingerprint: j.machine }));
    }
    if (budget.targets) console.log(JSON.stringify({ task: id, targets: judgeTargets(budget, root) }));
  } catch (error) { console.log(JSON.stringify({ task: id, status: 'BLOCKED', reason: String(error.message).slice(0, 600) })); }
}
