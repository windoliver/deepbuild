// One hub workload per run, for the perf lane's budgets (issue #16): node benchmarks/hub.mjs <mode>.
// Each starts `deep hub run` on a temp home, does its work, prints its readings as one JSON line, and stops
// the hub it started by PID.
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../packages/cli/dist/main.js', import.meta.url));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** One connection: resolves with each line the hub writes, through `onLine`, until it closes. */
function exchange(socket, request) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(socket);
    let buffer = '';
    let sent = 0;
    sock.setEncoding('utf8');
    sock.on('error', reject);
    sock.on('data', (chunk) => {
      buffer += chunk;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        const line = JSON.parse(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
        if (line.hello && request) {
          sent = performance.now();
          sock.write(`${JSON.stringify(request)}\n`);
        } else if ('exit' in line || 'error' in line || !request) {
          sock.destroy();
          resolve(performance.now() - sent);
        }
      }
    });
  });
}

async function start(home) {
  const socket = join(home, '.deepbuild', 'hub.sock');
  const t0 = performance.now();
  const hub = spawn(process.execPath, [CLI, 'hub', 'run'], { env: { ...process.env, HOME: home }, stdio: 'ignore' });
  for (;;) {
    try {
      await exchange(socket);
      break;
    } catch {
      if (performance.now() - t0 > 10_000) throw Error('the hub did not answer within 10 s');
      await sleep(2);
    }
  }
  return { hub, socket, coldMs: performance.now() - t0 };
}
async function stop(hub) {
  const exited = new Promise((resolve) => hub.on('exit', resolve));
  hub.kill('SIGTERM');
  await exited;
}

const modes = {
  // From spawning the hub to its socket answering.
  async 'cold-start'(home) {
    const { hub, coldMs } = await start(home);
    await stop(hub);
    return { coldMs };
  },
  // 1,000 PreToolUse requests, one connection each, as deep-hook makes them: the round trip at p95.
  async 'round-trip'(home) {
    const { hub, socket } = await start(home);
    const cwd = join(home, 'work');
    mkdirSync(cwd);
    const session = '6f1c2b9e-1111-4222-8333-444455556666';
    const transcript = join(home, '.claude', 'projects', 'work', `${session}.jsonl`);
    const samples = [];
    for (let i = 0; i < 1000; i++) {
      const id = `01K74FKZVK8Q2X5R7M${String(i).padStart(8, '0')}`;
      const payload = { session_id: session, transcript_path: transcript, cwd, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: `ls src/${i}` }, tool_use_id: `call_${i}` };
      samples.push(await exchange(socket, { v: 1, agent: 'claude-code', event: 'PreToolUse', seq: `${1_760_013_451_000_000_000n + BigInt(i)}`, id, pid: process.pid, ppid: process.ppid, matched: [], payload }));
    }
    await stop(hub);
    samples.sort((a, b) => a - b);
    return { p50Ms: samples[499], p95Ms: samples[949] };
  },
  // The hub left idle: after two seconds to settle, the CPU it uses over five more, and its resident memory.
  async idle(home) {
    const { hub } = await start(home);
    await sleep(2000);
    const ps = (field) => execFileSync('ps', ['-o', `${field}=`, '-p', String(hub.pid)], { encoding: 'utf8' }).trim();
    const cpu = () => ps('time').split(/[:.]/).map(Number).reduce((acc, part, i, all) => (i === all.length - 1 ? acc + part / 100 : acc * 60 + part), 0);
    const before = cpu();
    await sleep(5000);
    const idleCpuPercent = ((cpu() - before) / 5) * 100;
    const rssBytes = Number(ps('rss')) * 1024;
    await stop(hub);
    return { idleCpuPercent, rssBytes };
  },
};

const mode = process.argv[2];
if (!modes[mode]) throw Error(`Unknown mode ${mode}; one of: ${Object.keys(modes).join(', ')}`);
const home = realpathSync(mkdtempSync('/tmp/deep-hub-bench-'));
try {
  console.log(JSON.stringify({ bench: 'hub', mode, ...(await modes[mode](home)) }));
} finally {
  rmSync(home, { recursive: true, force: true });
}
