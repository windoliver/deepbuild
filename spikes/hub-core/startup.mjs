// Times import("effect/Effect") the way the CLI would pay it: each sample in a fresh Node process,
// measured inside that process from just before the import to just after it (#56).
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const SAMPLES = 20;
const probe = "const t = performance.now(); await import('effect/Effect'); process.stdout.write(String(performance.now() - t));";
const once = () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', probe], { cwd: here, encoding: 'utf8' });
  if (result.status !== 0) throw Error(`the import failed: ${result.stderr}\nFix: npm ci --prefix spikes/hub-core`);
  return Number(result.stdout);
};
// The first process reads the files from disk; it's reported apart and the samples are warm.
const firstMs = once();
const samples = Array.from({ length: SAMPLES }, once).sort((a, b) => a - b);
const at = (q) => samples[Math.min(samples.length - 1, Math.ceil(q * samples.length) - 1)];
const round = (ms) => Math.round(ms * 100) / 100;
const { version } = JSON.parse(readFileSync(new URL('node_modules/effect/package.json', import.meta.url), 'utf8'));
console.log(JSON.stringify({ node: process.version, module: 'effect/Effect', effect: version, samples: SAMPLES, p50Ms: round(at(0.5)), p95Ms: round(at(0.95)), firstMs: round(firstMs) }));
