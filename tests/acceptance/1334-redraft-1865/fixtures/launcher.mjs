// The launchd stand-in (README: Stand-ins), behind the DEEP_HUB_LAUNCHER seam the hub's service code has: the hub's
// `launch(file)` runs `$DEEP_HUB_LAUNCHER <definition file>` where it would run `launchctl bootstrap` and `kickstart`
// (or systemd's `enable --now`). The first call loads the definition into a supervisor of its own and starts the job;
// a later call starts the job if it isn't running and does nothing if it is. The supervisor keeps the job as the
// definition the base writes says (KeepAlive with SuccessfulExit false; systemd's Restart=on-failure): a job that exits
// non-zero, or on a signal, starts again 10 s after its last start, as launchd's throttle has it; one that exits 0
// stays stopped until a call starts it. It reads the definition file again at each start. Every load, start and exit
// is a line of $T1334_LAUNCHD/launchd.jsonl.
import { spawn } from 'node:child_process';
import { appendFileSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const state = process.env.T1334_LAUNCHD;
const log = (o) => appendFileSync(join(state, 'launchd.jsonl'), `${JSON.stringify({ t: Date.now(), ...o })}\n`);
const pidFile = join(state, 'supervisor.pid');
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const [mode, given] = process.argv.slice(2);

if (mode !== '--supervise') {
  log({ event: 'load', file: mode });
  writeFileSync(join(state, 'definition'), mode ?? '');
  let pid;
  try { pid = Number(readFileSync(pidFile, 'utf8')); } catch { /* none yet */ }
  if (pid && alive(pid)) {
    process.kill(pid, 'SIGUSR1');
    process.exit(0);
  }
  const child = spawn(process.execPath, [process.argv[1], '--supervise', mode], { detached: true, stdio: 'ignore', env: process.env });
  child.unref();
  for (const deadline = Date.now() + 10_000; Date.now() < deadline; pause(50)) {
    try { if (Number(readFileSync(pidFile, 'utf8')) === child.pid) break; } catch { /* not yet */ }
  }
  process.exit(0);
}

writeFileSync(pidFile, String(process.pid));
void given;
const unxml = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
/** The definition as launchd (a plist) or systemd (a unit) reads it: the program, its environment, its log. */
function definition() {
  const text = readFileSync(readFileSync(join(state, 'definition'), 'utf8'), 'utf8');
  if (/<plist/.test(text)) {
    const section = (key) => new RegExp(`<key>${key}</key>\\s*<(array|dict)>([\\s\\S]*?)</\\1>`).exec(text)?.[2] ?? '';
    const program = [...section('ProgramArguments').matchAll(/<string>([\s\S]*?)<\/string>/g)].map((m) => unxml(m[1]));
    const env = {};
    for (const m of section('EnvironmentVariables').matchAll(/<key>([\s\S]*?)<\/key>\s*<string>([\s\S]*?)<\/string>/g)) env[unxml(m[1])] = unxml(m[2]);
    const out = /<key>StandardOutPath<\/key>\s*<string>([\s\S]*?)<\/string>/.exec(text)?.[1];
    return { program, env, out: out ? unxml(out) : join(state, 'job.log') };
  }
  const words = (line) => [...line.matchAll(/"((?:[^"\\]|\\.)*)"|(\S+)/g)].map((m) => (m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1') : m[2]));
  const program = words(/^ExecStart=(.*)$/m.exec(text)?.[1] ?? '');
  const env = {};
  for (const pair of words(/^Environment=(.*)$/m.exec(text)?.[1] ?? '')) {
    const i = pair.indexOf('=');
    if (i > 0) env[pair.slice(0, i)] = pair.slice(i + 1);
  }
  return { program, env, out: join(state, 'job.log') };
}

let job;
let lastStart = 0;
let timer;
function start() {
  if (job) return;
  clearTimeout(timer);
  timer = undefined;
  let d;
  try { d = definition(); } catch (error) { log({ event: 'unreadable', error: String(error) }); return; }
  lastStart = Date.now();
  let fd;
  try { fd = openSync(d.out, 'a'); } catch { fd = openSync(join(state, 'job.log'), 'a'); }
  // As launchd starts a job: the definition's environment and the user's TMPDIR. And the sandbox's seams, so a job
  // that starts the service itself reaches this stand-in, never the real launchd (README: Stand-ins).
  const env = {
    ...d.env, TMPDIR: process.env.TMPDIR, USER: process.env.USER ?? 'fixture', LOGNAME: process.env.USER ?? 'fixture', SHELL: '/bin/sh',
    DEEP_HUB_LAUNCHER: process.env.DEEP_HUB_LAUNCHER, T1334_LAUNCHD: state, DEEP_DOCTOR_CANVAS_FAULT: process.env.DEEP_DOCTOR_CANVAS_FAULT,
  };
  for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key];
  const child = spawn(d.program[0], d.program.slice(1), { detached: true, stdio: ['ignore', fd, fd], env });
  job = child;
  child.on('error', (error) => log({ event: 'spawn-failed', program: d.program, error: String(error) }));
  log({ event: 'start', pid: child.pid ?? null, program: d.program });
  child.on('exit', (code, signal) => {
    log({ event: 'exit', pid: child.pid ?? null, code, signal });
    if (job === child) job = undefined;
    if (code !== 0) timer = setTimeout(start, Math.max(500, lastStart + 10_000 - Date.now()));
  });
}
process.on('SIGUSR1', () => start());
process.on('SIGTERM', () => {
  if (job?.pid) try { process.kill(-job.pid, 'SIGTERM'); } catch { /* gone */ }
  process.exit(0);
});
start();
setInterval(() => undefined, 1 << 30);
