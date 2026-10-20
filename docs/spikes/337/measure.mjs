// Issue #337: the spike's app numbers, five runs each, printed as JSON.
// Run from the repo root after `cargo build -p deep-app --release`:
//   node docs/spikes/337/measure.mjs
// Cold start: from spawning the process to the app reporting its first frame callback, with the
// Codex panel mounted; gpui runs that callback as the frame after the window opens begins. Idle CPU:
// CPU time used over 20 s once the window has settled 5 s, as a percent of one core. Memory:
// resident set size at the end of that idle window. App size: the release binary after `strip`,
// since a shipped app is stripped. The five runs follow one untimed launch, reported apart as
// firstLaunchMs: right after a build, macOS checks the new binary on its first launch, which a user
// pays once after installing.
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const app = 'target/release/deep-app';
const panel = ['--panel', 'crates/deep-app/panels/codex'];
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const runs = 5;

function coldStart() {
  return new Promise((done, fail) => {
    const started = performance.now();
    const child = spawn(app, panel, { env: { ...process.env, DEEP_APP_EXIT_AFTER_FIRST_FRAME: '1' }, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '', ms = null;
    // A run that hasn't quit in 30 s is stopped, and one that ignores SIGTERM is killed.
    const timer = setTimeout(() => {
      child.kill();
      setTimeout(() => child.kill('SIGKILL'), 5000).unref();
    }, 30000);
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      if (ms === null && /first-frame-ms /.test(stderr)) ms = performance.now() - started;
    });
    child.on('error', fail);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (ms === null) fail(Error(`no first frame: ${stderr}`));
      // It quits by itself once the frame is reported; anything else isn't a clean start.
      else if (code !== 0 || signal) fail(Error(`the app ended with ${signal ?? `exit code ${code}`} after its first frame: ${stderr}`));
      else done(Math.round(ms * 10) / 10);
    });
  });
}

// `ps` time is [[dd-]hh:]mm:ss.ss of CPU used. A process that has exited has no row, which is an
// error, not 0% CPU.
function cpuSeconds(pid) {
  const ps = spawnSync('ps', ['-o', 'time=,rss=', '-p', String(pid)], { encoding: 'utf8' });
  const [time, rss] = ps.stdout.trim().split(/\s+/);
  if (ps.status !== 0 || !time || !rss) throw Error(`the app (pid ${pid}) is not running`);
  const [days, clock] = time.includes('-') ? time.split('-') : ['0', time];
  const parts = clock.split(':').map(Number);
  return { cpu: Number(days) * 86400 + parts.reduce((total, part) => total * 60 + part, 0), rssBytes: Number(rss) * 1024 };
}

async function idle() {
  const child = spawn(app, panel, { stdio: 'ignore' });
  const exited = new Promise((done) => child.on('exit', done));
  try {
    await sleep(5000);
    const start = cpuSeconds(child.pid);
    await sleep(20000);
    const end = cpuSeconds(child.pid);
    if (child.exitCode !== null || child.signalCode !== null) throw Error('the app exited during the idle window');
    return { cpuPercent: ((end.cpu - start.cpu) / 20) * 100, rssBytes: end.rssBytes };
  } finally {
    child.kill();
    // The next run starts only once this one is gone.
    await exited;
  }
}

const directory = mkdtempSync(join(tmpdir(), 'deep-app-'));
try {
  const stripped = join(directory, 'deep-app');
  copyFileSync(app, stripped);
  const strip = spawnSync('strip', [stripped], { encoding: 'utf8' });
  if (strip.status !== 0) throw Error(`strip failed: ${strip.error?.message ?? strip.stderr}`);

  const result = { firstLaunchMs: await coldStart(), coldStartMs: [], idleCpuPercent: [], memoryBytes: [], appBytes: [] };
  for (let run = 0; run < runs; run++) {
    result.coldStartMs.push(await coldStart());
    const { cpuPercent, rssBytes } = await idle();
    result.idleCpuPercent.push(Math.round(cpuPercent * 100) / 100);
    result.memoryBytes.push(rssBytes);
    result.appBytes.push(statSync(stripped).size);
  }
  console.log(JSON.stringify(result, null, 2));
} finally {
  rmSync(directory, { recursive: true, force: true });
}
