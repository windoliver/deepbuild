// #2998 AC2's driver, run under the perf lane's counter (`measureOnce`): it starts `deep hub run` on a temp HOME,
// waits until a canary probe whose parent is the hub is running, sends the hub SIGTERM at once, waits for it to
// exit, and prints one JSON line saying what it saw. It stops only the hub it started, by PID.
import { spawn } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { CLI, probesOf, running, turn } from '../helpers.mjs';

// A hub's warm-up probes come in its first seconds; on a Mac whose first filter shows the first canary, there is one.
const WAIT_MS = 15_000;
const home = realpathSync(mkdtempSync('/tmp/dh2998-home-'));
const hub = spawn(process.execPath, [CLI, 'hub', 'run'], { env: { ...process.env, HOME: home }, stdio: 'ignore' });
let exitedEarly = null;
const exited = new Promise((resolve) => hub.once('exit', (code, signal) => { exitedEarly ??= { code, signal }; resolve({ code, signal }); }));
let seen = null;
try {
  const until = Date.now() + WAIT_MS;
  while (!seen && !exitedEarly && Date.now() < until) {
    seen = probesOf(hub.pid).find(running) ?? null;
    if (!seen) await turn();
  }
  const before = exitedEarly;
  const t0 = performance.now();
  if (!before) hub.kill('SIGTERM');
  const end = await exited;
  console.log(JSON.stringify({ hub: hub.pid, probe: seen, exitedBeforeStop: before, exit: end, stopMs: Math.round(performance.now() - t0) }));
} finally {
  rmSync(home, { recursive: true, force: true });
}
