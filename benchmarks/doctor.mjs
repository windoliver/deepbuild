// `deep doctor` on an installed home, for the perf lane's budgets (issue #19): node benchmarks/doctor.mjs.
// In a temp HOME with stand-ins for claude and codex first on PATH (each answers --version and its sign-in at once),
// it starts the hub, runs `deep setup`, and times five `deep doctor` runs after a warm-up, printing the median as one
// JSON line. The issue's 2 s stays in tests/acceptance/19/status/budgets.test.ts. It stops only the hub it started.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../', import.meta.url));
const CLI = join(REPO, 'packages/cli/dist/main.js');
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const newest = (agent) => JSON.parse(readFileSync(join(REPO, 'adapters', `${agent}.facts.json`), 'utf8')).versions.filter((v) => /^\d+\.\d+\.\d+$/.test(v)).at(-1);

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-doctor-bench-')));
const bin = join(dir, 'bin');
mkdirSync(bin);
const stub = (name, text) => { writeFileSync(join(bin, name), `#!/bin/sh\n${text}\n`); chmodSync(join(bin, name), 0o755); };
stub('claude', `case "$1" in --version) echo '${newest('claude-code')} (Claude Code)' ;; auth) echo '{"loggedIn":true,"authMethod":"claude.ai","subscriptionType":"max"}' ;; esac`);
stub('codex', `case "$1" in --version) echo 'codex-cli ${newest('codex')}' ;; esac`);
for (const name of ['launchctl', 'systemctl']) stub(name, 'exit 0');
const env = {
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('DEEP_') && !k.startsWith('CLAUDE') && !k.startsWith('CODEX'))),
  HOME: join(dir, 'h'), PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`, SHELL: '/bin/sh', LC_ALL: 'C',
};
mkdirSync(env.HOME, { recursive: true });
const hub = spawn(process.execPath, [CLI, 'hub', 'run'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
try {
  await new Promise((resolve, reject) => { hub.stdout.once('data', resolve); hub.once('exit', () => reject(Error('the hub did not start'))); });
  const set = spawnSync(process.execPath, [CLI, 'setup'], { env, encoding: 'utf8' });
  if (set.status !== 0) throw Error(`deep setup exited ${set.status}: ${set.stderr}`);
  const runs = [];
  for (let i = 0; i <= 5; i++) {
    const t0 = performance.now();
    const r = spawnSync(process.execPath, [CLI, 'doctor', '--json'], { env, encoding: 'utf8' });
    const ms = performance.now() - t0;
    if (![0, 1, 3].includes(r.status) || !r.stdout.trim()) throw Error(`deep doctor exited ${r.status}: ${r.stderr}`);
    // The first run warms the file cache; it isn't counted.
    if (i > 0) runs.push(ms);
  }
  console.log(JSON.stringify({ doctorMs: median(runs) }));
} finally {
  hub.kill('SIGTERM');
  await new Promise((resolve) => (hub.exitCode !== null ? resolve() : hub.once('exit', resolve)));
  rmSync(dir, { recursive: true, force: true });
}
