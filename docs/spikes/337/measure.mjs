// Issue #337: the spike's app numbers, five runs each, printed as JSON.
// Run from the repo root after `cargo build -p deep-app --release`:
//   node docs/spikes/337/measure.mjs
// Cold start: process start to the window's first drawn frame (the app prints it), with the
// Codex panel mounted. Idle CPU: CPU time used over 20 s once the window has settled 5 s,
// as a percent of one core. Memory: resident set size at the end of that idle window.
// App size: the release binary after `strip`, since a shipped app is stripped.
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const app = 'target/release/deep-app';
const panel = ['--panel', 'crates/deep-app/panels/codex'];
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const runs = 5;

function coldStart() {
  const run = spawnSync(app, panel, { env: { ...process.env, DEEP_APP_EXIT_AFTER_FIRST_FRAME: '1' }, encoding: 'utf8', timeout: 30000 });
  const match = /first-frame-ms ([\d.]+)/.exec(run.stderr);
  if (!match) throw Error(`no first frame: ${run.stderr}`);
  return Number(match[1]);
}

// `ps` time is [[dd-]hh:]mm:ss.ss of CPU used.
function cpuSeconds(pid) {
  const [time, rss] = spawnSync('ps', ['-o', 'time=,rss=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trim().split(/\s+/);
  const parts = time.split(':').map(Number);
  return { cpu: parts.reduce((total, part) => total * 60 + part, 0), rssBytes: Number(rss) * 1024 };
}

async function idle() {
  const child = spawn(app, panel, { stdio: 'ignore' });
  try {
    await sleep(5000);
    const start = cpuSeconds(child.pid);
    await sleep(20000);
    const end = cpuSeconds(child.pid);
    return { cpuPercent: ((end.cpu - start.cpu) / 20) * 100, rssBytes: end.rssBytes };
  } finally {
    child.kill();
  }
}

const stripped = join(mkdtempSync(join(tmpdir(), 'deep-app-')), 'deep-app');
copyFileSync(app, stripped);
spawnSync('strip', [stripped]);

const result = { coldStartMs: [], idleCpuPercent: [], memoryBytes: [], appBytes: [] };
for (let run = 0; run < runs; run++) {
  result.coldStartMs.push(coldStart());
  const { cpuPercent, rssBytes } = await idle();
  result.idleCpuPercent.push(Math.round(cpuPercent * 100) / 100);
  result.memoryBytes.push(rssBytes);
  result.appBytes.push(statSync(stripped).size);
}
console.log(JSON.stringify(result, null, 2));
