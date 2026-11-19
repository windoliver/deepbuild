// A screen, not a verdict: each task's instructions retired on the change and on its merge base, alternated, with
// scripts/benchmark.mjs's own measureOnce. usage: node screen.mjs <rounds> <task>...
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { loadavg } from 'node:os';
const root = '<home>/doneright-2365', baseRoot = '<home>/doneright-2365-repair';
const { measureOnce } = await import(`${root}/scripts/benchmark.mjs`);
const [rounds, ...ids] = process.argv.slice(2);
const current = JSON.parse(readFileSync(`${root}/benchmarks/budgets.json`, 'utf8')).tasks;
const base = JSON.parse(readFileSync(`${baseRoot}/benchmarks/budgets.json`, 'utf8')).tasks;
const head = (cwd) => execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
console.log(JSON.stringify({ change: head(root), base: head(baseRoot), rounds: Number(rounds), load: loadavg()[0] }));
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
for (const id of ids) {
  const now = current.find((t) => t.id === id), then = base.find((t) => t.id === id);
  if (!now || !then) { console.log(JSON.stringify({ task: id, status: 'BLOCKED', reason: `not a task on ${now ? 'the base' : 'the change'}` })); continue; }
  const sides = [[now.command, root], [then.command, baseRoot]], samples = [[], []];
  try {
    for (let round = 0; round <= Number(rounds); round++) {
      for (const side of round % 2 ? [1, 0] : [0, 1]) {
        const result = measureOnce(...sides[side]);
        if (result.status !== 0) throw Error(`${side ? 'base' : 'change'} exited ${result.status}: ${result.output.slice(-400)}`);
        if (round) samples[side].push({ instructions: result.instructions, ms: Math.round(result.elapsedMs), peakMB: Math.round(result.peakBytes / 1e6), load: result.loadStart });
      }
    }
    const ratios = samples[0].map((sample, n) => sample.instructions / samples[1][n].instructions - 1);
    console.log(JSON.stringify({ task: id, change: (median(ratios) * 100).toFixed(2) + '%', pairs: ratios.map((r) => (r * 100).toFixed(2)), changeG: samples[0].map((s) => (s.instructions / 1e9).toFixed(3)), baseG: samples[1].map((s) => (s.instructions / 1e9).toFixed(3)), ms: [median(samples[0].map((s) => s.ms)), median(samples[1].map((s) => s.ms))], peakMB: [median(samples[0].map((s) => s.peakMB)), median(samples[1].map((s) => s.peakMB))], load: loadavg()[0].toFixed(1) }));
  } catch (error) { console.log(JSON.stringify({ task: id, status: 'BLOCKED', reason: String(error.message).slice(0, 500) })); }
}
