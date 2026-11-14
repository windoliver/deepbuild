// Spike #2435: builds the probe, runs its four parts and each plant, and stores the record with the
// host it ran on. Run: node spikes/2435/record.mjs [out = spikes/2435/record.json]
// The probe takes the machine's GPU lease itself; a run timed while another GPU job holds it stores
// INCONCLUSIVE timings, never numbers.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, loadavg } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fingerprint } from '../../scripts/benchmark.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const out = process.argv[2] ?? join(here, 'record.json');
const bin = join(here, 'target', 'release', 'spike-2435');
const read = (cmd, ...args) => execFileSync(cmd, args, { cwd: root, encoding: 'utf8' }).trim();

execFileSync('cargo', ['build', '--release', '--locked', '--offline', '--quiet'], { cwd: here, stdio: 'inherit' });

/** One probe run: its JSON, whatever its exit status. */
function probe(...args) {
  const r = spawnSync(bin, args, { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.error || !r.stdout.trim()) return { status: 'INVALID', reason: `the probe printed nothing (${r.error?.message ?? r.stderr.trim()})` };
  return JSON.parse(r.stdout);
}

/** A run of the timing part while another GPU job (a sleeping child of this script) holds the lease. */
function underHeldLease() {
  // The machine's own lease, held by a sleeping child of this script for the length of one run.
  const lease = join(homedir(), '.cache', 'deepbuild-gpu', 'lease');
  mkdirSync(dirname(lease), { recursive: true });
  const holder = spawn('sleep', ['120'], { stdio: 'ignore' });
  try {
    writeFileSync(lease, String(holder.pid), { flag: 'wx' });
  } catch {
    holder.kill();
    return { status: 'INVALID', reason: 'the lease was already held, so the planted holder could not take it' };
  }
  try {
    return probe('--part', 'rebuilds');
  } finally {
    if (readFileSync(lease, 'utf8') === String(holder.pid)) rmSync(lease);
    holder.kill();
  }
}

const loadStart = loadavg()[0];
const run = probe('--part', 'all');
const loadEnd = loadavg()[0];
// Each plant on its one part, kept as the probe printed it.
const plants = {
  end_on_failed_candidate: probe('--part', 'candidates', '--plant', 'end_on_failed_candidate'),
  top_level_first: probe('--part', 'build_order', '--plant', 'top_level_first'),
  masked_answers_first: probe('--part', 'ties', '--plant', 'masked_answers_first'),
  lease_held: underHeldLease(),
  no_ray_queries: probe('--part', 'all', '--plant', 'no_ray_queries'),
  skip_rebuilds: probe('--part', 'all', '--plant', 'skip_rebuilds'),
};
const machine = fingerprint();
const mac = process.platform === 'darwin';

const record = {
  issue: 2435,
  date: new Date().toISOString(),
  base_commit: read('git', 'rev-parse', 'HEAD'),
  host: {
    model: machine.model,
    chip: machine.chip,
    memory_bytes: machine.memoryBytes,
    os: mac ? 'macOS' : process.platform,
    os_build: mac ? `${read('sw_vers', '-productVersion')} (${machine.macosBuild})` : read('uname', '-sr'),
    power: machine.power,
    low_power_mode: machine.lowPowerMode,
    thermal: machine.thermalState,
    load_1m: { start: loadStart, end: loadEnd },
  },
  wgpu: run.wgpu,
  adapter: run.adapter,
  status: run.status,
  parts: run.parts,
  plants,
};
writeFileSync(out, `${JSON.stringify(record, null, 2)}\n`);
console.log(`spike-2435: ${record.status}; ${Object.entries(record.parts).map(([k, p]) => `${k} ${p.status}`).join(', ')}; plants ${Object.entries(record.plants).map(([k, p]) => `${k} ${p.status}`).join(', ')}`);
