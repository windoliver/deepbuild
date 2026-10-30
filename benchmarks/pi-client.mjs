// The pi package's in-process client on real pi, for the perf lane's budgets (issue #40): node benchmarks/pi-client.mjs.
// DEEP_PI_CLI names pi's dist/cli.js, the covered version; without it this fails, never passes unmeasured. Against a hub
// in a temp HOME, one warm-up each way, then five interleaved sessions each way of 20 read calls answered by the
// scripted provider with no network, printing the added milliseconds per event as one JSON line. The issue's 1 ms stays
// in tests/acceptance/40/budgets.test.ts. It stops only the hub and the pi processes it started.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../', import.meta.url));
const CLI = join(REPO, 'packages/cli/dist/main.js');
const SCRIPTED = join(REPO, 'tests/acceptance/40/fixtures/scripted-provider.ts');
const PI = process.env.DEEP_PI_CLI;
if (!PI) throw Error("DEEP_PI_CLI names pi's dist/cli.js: nothing was measured");
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-pi-bench-')));
const cwd = join(dir, 'w');
mkdirSync(cwd);
writeFileSync(join(cwd, 'nested.txt'), 'nested\n');
const script = join(dir, 'script.json');
writeFileSync(script, JSON.stringify([...Array.from({ length: 20 }, () => ({ tools: [{ name: 'read', arguments: { path: 'nested.txt' } }] })), { text: 'Read them all.' }]));
const env = {
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('DEEP_') && !k.startsWith('CLAUDE'))),
  HOME: join(dir, 'h'), PI_OFFLINE: '1', PI_TELEMETRY: '0', PI_CODING_AGENT_DIR: join(dir, 'agent'), DEEP_PI_SCRIPT: script,
};
mkdirSync(env.HOME, { recursive: true });
const hub = spawn(process.execPath, [CLI, 'hub', 'run'], { env, stdio: ['ignore', 'pipe', 'inherit'] });

/** One session from prompt to settle: its time, and the events its stream carried that aren't deltas. */
function session(withPackage) {
  return new Promise((resolve, reject) => {
    const args = [PI, '--mode', 'rpc', '--no-session', '--no-extensions', '--no-approve', '-e', SCRIPTED, ...(withPackage ? ['-e', join(REPO, 'packages/pi')] : []), '--provider', 'scripted', '--model', 'scripted-1'];
    const pi = spawn(process.execPath, args, { cwd, env, stdio: ['pipe', 'pipe', 'ignore'] });
    let t0 = 0;
    let events = 0;
    pi.once('exit', (code) => reject(Error(`pi exited ${String(code)} before it settled`)));
    const lines = createInterface({ input: pi.stdout });
    lines.on('line', (line) => {
      let e;
      try { e = JSON.parse(line); } catch { return; }
      if (t0 && !['message_update', 'response', 'tool_execution_update'].includes(e.type)) events += 1;
      if (e.type === 'agent_settled') {
        const ms = performance.now() - t0;
        pi.removeAllListeners('exit');
        pi.once('exit', () => resolve({ ms, events }));
        pi.kill();
      }
    });
    // Time starts once pi has loaded, the extensions' load being no per-event cost.
    pi.stdin.write(`${JSON.stringify({ id: 'state', type: 'get_state' })}\n`);
    lines.once('line', () => {
      t0 = performance.now();
      pi.stdin.write(`${JSON.stringify({ id: 'go', type: 'prompt', message: 'Read.' })}\n`);
    });
  });
}

try {
  await new Promise((resolve, reject) => { hub.stdout.once('data', resolve); hub.once('exit', () => reject(Error('the hub did not start'))); });
  await session(true);
  await session(false);
  const added = [];
  let events = 0;
  for (let i = 0; i < 5; i++) {
    const a = await session(true);
    const b = await session(false);
    added.push((a.ms - b.ms) / a.events);
    events = a.events;
  }
  if (events < 80) throw Error(`the session carried only ${events} events`);
  console.log(JSON.stringify({ events, addedMsPerEvent: median(added) }));
} finally {
  hub.removeAllListeners('exit');
  hub.kill();
  rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
}
