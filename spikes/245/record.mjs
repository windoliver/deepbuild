// Spike #245: builds the harness, runs the steering fixture in both forms, and stores the record
// with the host it ran on and the verdict rule.mjs gives from its numbers.
// Run: node spikes/245/record.mjs [out = spikes/245/record.json] [steps = 3600]
// A run whose one-minute load, at its start or its end, is above the core count stores nothing:
// its timings are INCONCLUSIVE (design: How we know version 0 works).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism, loadavg } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fingerprint } from '../../scripts/benchmark.mjs';
import { verdict } from './rule.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const out = process.argv[2] ?? join(here, 'record.json');
const steps = Number(process.argv[3] ?? 3600);
const fixture = join(here, 'steer.wat');
const read = (cmd, ...args) => execFileSync(cmd, args, { cwd: root, encoding: 'utf8' }).trim();

execFileSync('cargo', ['build', '--release', '--locked', '--quiet'], { cwd: here, stdio: 'inherit' });
const cores = availableParallelism();
const loadStart = loadavg()[0];
const run = JSON.parse(execFileSync(join(here, 'target', 'release', 'spike-245'), [fixture, String(steps)], { encoding: 'utf8', maxBuffer: 1 << 28 }));
const loadEnd = loadavg()[0];
const machine = fingerprint();
const mac = process.platform === 'darwin';

const record = {
  issue: 245,
  date: new Date().toISOString(),
  base_commit: read('git', 'rev-parse', 'HEAD'),
  host: {
    model: machine.model,
    chip: machine.chip,
    memory_bytes: machine.memoryBytes,
    os: mac ? 'macOS' : process.platform,
    os_build: mac ? (machine.macosBuild && `${read('sw_vers', '-productVersion')} (${machine.macosBuild})`) : read('uname', '-sr'),
    power: machine.power,
    low_power_mode: machine.lowPowerMode,
    thermal: machine.thermalState,
    cores,
    load_1m: { start: loadStart, end: loadEnd },
  },
  fixture: {
    path: relative(root, fixture),
    sha256: createHash('sha256').update(readFileSync(fixture)).digest('hex'),
    agents: run.agents,
    rate_hz: run.rate_hz,
    blocks: run.blocks,
  },
  run: {
    warmup_steps: run.warmup_steps,
    os_page_bytes: run.os_page_bytes,
    wasmtime: run.wasmtime,
    rewritten_sha256: run.rewritten_sha256,
    same_bits: run.same_bits,
  },
  forms: run.forms,
};
record.verdict = verdict(record);

if (!run.same_bits) throw new Error('the two forms ended in different bits; nothing stored');
if (!(loadStart <= cores && loadEnd <= cores)) {
  console.error(`INCONCLUSIVE: one-minute load ${loadStart.toFixed(1)} at the start, ${loadEnd.toFixed(1)} at the end, on ${cores} cores; nothing stored`);
  process.exit(1);
}
writeFileSync(out, `${JSON.stringify(record, null, 1)}\n`);
const line = (name) => {
  const f = record.forms[name];
  return `${name}: wall p50 ${f.wall_ms.p50.toFixed(3)} ms, p95 ${f.wall_ms.p95.toFixed(3)} ms; overhead p50 ${f.overhead_ms.p50.toFixed(3)} ms, p95 ${f.overhead_ms.p95.toFixed(3)} ms`;
};
console.log([line('one_instance'), line('copy_on_write'), `verdict: ${record.verdict}`, `stored: ${relative(root, out)}`].join('\n'));
