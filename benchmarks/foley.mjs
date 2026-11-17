// Every foley@1 preset rendered into its twelve variants by foley-render@1.0.0, for the perf lane's budgets (issue
// #155): node benchmarks/foley.mjs. Each preset is the tool's own process, given the params a film's foley_plan gives
// (the preset's graph from packs/foley-1.0.0, seeded by its name, 3 levels × 4 round robins at 48 kHz) on stdin as the
// hub gives them, and the 90 run at once, as 90 deep_job calls do; it prints the wall time from the first start to
// the last exit as one JSON line. The issue's 30 s limit and the 32 voices' soak stay in
// tests/acceptance/155/budgets.test.ts.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const TOOL = fileURLToPath(new URL('../packages/jobs/foley/tool/render.mjs', import.meta.url));
const pack = JSON.parse(readFileSync(new URL('../packs/foley-1.0.0/pack.json', import.meta.url), 'utf8'));

const run = ([key, preset]) => new Promise((resolve, reject) => {
  const params = { preset, seed: `foley.${key}`, levels: 3, round_robins: 4, sample_rate: 48_000 };
  const child = spawn(process.execPath, [TOOL], { stdio: ['pipe', 'pipe', 'ignore'] });
  let out = 0;
  child.stdout.on('data', (d) => { out += d.length; });
  child.on('error', reject);
  child.on('close', (code) => (code === 0 && out > 0 ? resolve() : reject(Error(`${key} exited ${code}`))));
  child.stdin.end(JSON.stringify({ params, inputs: {} }));
});
const t0 = performance.now();
await Promise.all(Object.entries(pack.presets).map(run));
console.log(JSON.stringify({ ms: Math.round(performance.now() - t0) }));
