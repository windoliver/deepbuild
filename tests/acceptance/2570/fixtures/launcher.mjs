// The service manager's stand-in (README: Stand-ins), behind the base's DEEP_HUB_LAUNCHER seam: the hub's service
// code runs `$DEEP_HUB_LAUNCHER <definition file>` where it would run launchctl or systemctl. It keeps one job, as the
// definition the base writes says (launchd's KeepAlive with SuccessfulExit false, systemd's Restart=on-failure):
//   - a call while the job isn't running starts it;
//   - a call while the job is running does nothing;
//   - a job that exits 0 stays stopped until the next call;
//   - a job that exits non-zero or on a signal starts again 10 s after its last start.
// Each call returns once the supervisor has answered it, and every ask, start and exit is a line of
// $T2570_LAUNCHD/launchd.jsonl; an ask's line says whether the job was running and what was done.
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, openSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const state = process.env.T2570_LAUNCHD;
const log = (o) => appendFileSync(join(state, 'launchd.jsonl'), `${JSON.stringify({ t: Date.now(), ...o })}\n`);
const pidFile = join(state, 'supervisor.pid');
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const [mode] = process.argv.slice(2);

if (mode !== '--supervise') {
  // One call of the seam: leave the ask, wake the supervisor (starting it at the first call), wait for its answer.
  const ask = `${Date.now()}-${process.pid}`;
  writeFileSync(join(state, `ask-${ask}.tmp`), mode ?? '');
  renameSync(join(state, `ask-${ask}.tmp`), join(state, `ask-${ask}`));
  let pid;
  try { pid = Number(readFileSync(pidFile, 'utf8')); } catch { /* none yet */ }
  if (pid && alive(pid)) process.kill(pid, 'SIGUSR1');
  else spawn(process.execPath, [process.argv[1], '--supervise'], { detached: true, stdio: 'ignore', env: process.env }).unref();
  for (const deadline = Date.now() + 30_000; Date.now() < deadline; pause(5)) {
    if (existsSync(join(state, `ack-${ask}`))) process.exit(0);
  }
  process.stderr.write('stand-in service manager: its supervisor did not answer within 30 s\n');
  process.exit(1);
}

const unxml = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
/** The definition as launchd (a plist) or systemd (a unit) reads it: the program and its environment. */
function definition(file) {
  const text = readFileSync(file, 'utf8');
  if (/<plist/.test(text)) {
    const section = (key) => new RegExp(`<key>${key}</key>\\s*<(array|dict)>([\\s\\S]*?)</\\1>`).exec(text)?.[2] ?? '';
    const program = [...section('ProgramArguments').matchAll(/<string>([\s\S]*?)<\/string>/g)].map((m) => unxml(m[1]));
    const env = {};
    for (const m of section('EnvironmentVariables').matchAll(/<key>([\s\S]*?)<\/key>\s*<string>([\s\S]*?)<\/string>/g)) env[unxml(m[1])] = unxml(m[2]);
    return { program, env };
  }
  const words = (line) => [...line.matchAll(/"((?:[^"\\]|\\.)*)"|(\S+)/g)].map((m) => (m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1') : m[2]));
  const env = {};
  for (const pair of words(/^Environment=(.*)$/m.exec(text)?.[1] ?? '')) {
    const i = pair.indexOf('=');
    if (i > 0) env[pair.slice(0, i)] = pair.slice(i + 1);
  }
  return { program: words(/^ExecStart=(.*)$/m.exec(text)?.[1] ?? ''), env };
}

let file;
let job;
let lastStart = 0;
let timer;
function start() {
  clearTimeout(timer);
  timer = undefined;
  let d;
  try { d = definition(file); } catch (error) { log({ event: 'unreadable', file, error: String(error) }); return; }
  lastStart = Date.now();
  const out = openSync(join(state, 'job.log'), 'a');
  // As a service manager starts a job: the definition's environment and the user's TMPDIR. And the sandbox's own
  // settings, so a job that starts the service again reaches this stand-in, and the hub's exit can be held.
  const env = { ...d.env, USER: process.env.USER ?? 'fixture', LOGNAME: process.env.USER ?? 'fixture', SHELL: '/bin/sh' };
  for (const name of ['TMPDIR', 'DEEP_HUB_LAUNCHER', 'T2570_LAUNCHD', 'T2570_HOLD', 'NODE_OPTIONS']) if (process.env[name] !== undefined) env[name] = process.env[name];
  const child = spawn(d.program[0], d.program.slice(1), { detached: true, stdio: ['ignore', out, out], env });
  job = child;
  child.on('error', (error) => log({ event: 'spawn-failed', program: d.program, error: String(error) }));
  log({ event: 'start', pid: child.pid ?? null, program: d.program });
  child.on('exit', (code, signal) => {
    log({ event: 'exit', pid: child.pid ?? null, code, signal });
    if (job === child) job = undefined;
    if (code !== 0) timer = setTimeout(start, Math.max(500, lastStart + 10_000 - Date.now()));
  });
}
function asks() {
  for (const name of readdirSync(state).filter((n) => /^ask-[\d-]+$/.test(n)).sort()) {
    const id = name.slice(4);
    if (existsSync(join(state, `ack-${id}`))) continue;
    file = readFileSync(join(state, name), 'utf8');
    const running = job?.pid ?? null;
    log({ event: 'ask', file, running, did: running ? 'nothing' : 'start' });
    if (!running) start();
    writeFileSync(join(state, `ack-${id}`), '');
  }
}
process.on('SIGUSR1', asks);
process.on('SIGTERM', () => {
  if (job?.pid) try { process.kill(-job.pid, 'SIGTERM'); } catch { /* gone */ }
  process.exit(0);
});
// The pid is written once the handler is in: a SIGUSR1 with no handler would start Node's inspector.
writeFileSync(pidFile, String(process.pid));
asks();
setInterval(() => undefined, 1 << 30);
