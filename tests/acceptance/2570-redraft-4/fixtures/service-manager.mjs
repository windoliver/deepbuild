// The stand-in for the service manager (REDRAFT.md: The scene), behind the seam the base's `launch(file)` has: where
// the installed hub's start would run `launchctl bootstrap`/`kickstart` or `systemctl --user enable --now`, it runs
// `$DEEP_HUB_LAUNCHER <definition file>`. It models what the issue says both managers do:
//
// - The first call loads the definition into a supervisor of its own, which starts the job.
// - A later call asks the supervisor to start the job: it starts it if it isn't running, and does nothing if it is.
// - A job that exits 0 stays stopped until a call starts it; one that exits non-zero, or on a signal, is started again
//   after 2 s (the definition's `Restart=on-failure`, launchd's KeepAlive with SuccessfulExit false).
//
// The supervisor starts the job's program as the definition names it, with the definition's environment, and adds the
// scene's preload (fixtures/job.mjs) through NODE_OPTIONS: it lets a job linger at exit, or never answer, as the
// scene's behaviour file says. Every call, start, ask and exit is a line of $T2570_SM/events.jsonl.
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const state = process.env.T2570_SM;
if (!state) {
  process.stderr.write('service-manager stand-in: T2570_SM is not set\n');
  process.exit(2);
}
const log = (o) => appendFileSync(join(state, 'events.jsonl'), `${JSON.stringify({ t: Date.now(), ...o })}\n`);
const pidFile = join(state, 'supervisor.pid');
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const args = process.argv.slice(2);

if (args[0] !== '--supervise') {
  // A call, as `deep hub start` makes it: one definition file, nothing else.
  if (args.length !== 1 || !existsSync(args[0])) {
    log({ event: 'bad-call', args });
    process.stderr.write(`service-manager stand-in: expected one definition file, got ${JSON.stringify(args)}\n`);
    process.exit(2);
  }
  log({ event: 'call', file: args[0] });
  writeFileSync(join(state, 'definition'), args[0]);
  let pid;
  try { pid = Number(readFileSync(pidFile, 'utf8')); } catch { /* none yet */ }
  if (pid && alive(pid)) {
    process.kill(pid, 'SIGUSR1');
    process.exit(0);
  }
  const child = spawn(process.execPath, [process.argv[1], '--supervise'], { detached: true, stdio: 'ignore', env: process.env });
  child.unref();
  for (const deadline = Date.now() + 30_000; Date.now() < deadline; pause(20)) {
    try { if (Number(readFileSync(pidFile, 'utf8')) === child.pid) process.exit(0); } catch { /* not yet */ }
  }
  process.stderr.write('service-manager stand-in: the supervisor did not come up within 30 s\n');
  process.exit(1);
}

const unxml = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
/** The definition as launchd (a plist) or systemd (a unit) reads it: the program and its environment. */
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
  for (const m of text.matchAll(/^Environment=(.*)$/gm)) for (const pair of words(m[1])) {
    const i = pair.indexOf('=');
    if (i > 0) env[pair.slice(0, i)] = pair.slice(i + 1);
  }
  return { program, env, out: join(state, 'job.log') };
}

let job;
let timer;
function start(why) {
  if (job) return;
  clearTimeout(timer);
  timer = undefined;
  let d;
  try { d = definition(); } catch (error) { log({ event: 'unreadable', error: String(error) }); return; }
  let fd;
  try { fd = openSync(d.out, 'a'); } catch { fd = openSync(join(state, 'job.log'), 'a'); }
  // As the service manager starts a job: the definition's environment, with the user's TMPDIR and names; the seam
  // itself, so a job that starts the service again reaches this stand-in; and the scene's preload.
  const env = {
    ...d.env, TMPDIR: process.env.TMPDIR, USER: process.env.USER ?? 'fixture', LOGNAME: process.env.USER ?? 'fixture', SHELL: '/bin/sh',
    DEEP_HUB_LAUNCHER: process.env.DEEP_HUB_LAUNCHER, T2570_SM: state,
    NODE_OPTIONS: `--import=${pathToFileURL(join(import.meta.dirname, 'job.mjs')).href}`,
  };
  for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key];
  const child = spawn(d.program[0], d.program.slice(1), { detached: true, stdio: ['ignore', fd, fd], env });
  job = child;
  child.on('error', (error) => log({ event: 'spawn-failed', program: d.program, error: String(error) }));
  log({ event: 'start', why, pid: child.pid ?? null, program: d.program });
  child.on('exit', (code, signal) => {
    log({ event: 'exit', pid: child.pid ?? null, code, signal });
    if (job === child) job = undefined;
    if (code !== 0) timer = setTimeout(() => start('restart-on-failure'), 2000);
  });
}
process.on('SIGUSR1', () => {
  log({ event: 'asked', running: !!job, pid: job?.pid ?? null });
  start('asked');
});
const quit = () => {
  if (job?.pid) try { process.kill(-job.pid, 'SIGKILL'); } catch { /* gone */ }
  process.exit(0);
};
process.on('SIGTERM', quit);
// A supervisor whose test went away without stopping it stops itself and its job.
setInterval(() => { if (!existsSync(state)) quit(); }, 1000);
setTimeout(quit, 20 * 60_000).unref();
start('loaded');
// Written once the signal handlers are in place: a call that finds this PID can ask at once.
writeFileSync(pidFile, String(process.pid));
