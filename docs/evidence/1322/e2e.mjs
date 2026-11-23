// #1322 hand run: measureOnce stops a command that started a child, at its timeout and at maxBuffer; the wrapper(s),
// the command and its child are then all gone. A run that finishes in time is measured as before. Last, the same
// timeout case on the planted wrong program (the twin that skips the group kill after ETIMEDOUT) shows what the
// suite catches.
//   node e2e.mjs <clone> <folder holding the twin as benchmark.mjs beside proof-approvals.mjs>
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [clone, twinDir] = process.argv.slice(2);
const { measureOnce } = await import(pathToFileURL(join(clone, 'scripts/benchmark.mjs')).href);
const twin = await import(pathToFileURL(join(twinDir, 'benchmark.mjs')).href);

// The measured command: records its PID and the PIDs and programs of the wrappers above it (up to /usr/bin/time: time,
// or time then the counting runner), starts /bin/sleep 60 and records that PID, then sleeps 60 s ('sleep'), writes
// 40 MiB to stdout and sleeps ('flood'), or exits at once leaving sleep running ('quick').
const PARENT = `
const { execFileSync, spawn } = require('node:child_process');
const { existsSync, writeFileSync } = require('node:fs');
const { basename } = require('node:path');
const [dir, mode] = process.argv.slice(2);
writeFileSync(dir + '/command.pid', String(process.pid));
const wrappers = [];
for (let pid = process.ppid; wrappers.length < 3;) {
  const [ppid, ...comm] = execFileSync('/bin/ps', ['-o', 'ppid=,comm=', '-p', String(pid)], { encoding: 'utf8' }).trim().split(/\\s+/);
  wrappers.unshift([basename(comm.join(' ')), pid]);
  if (wrappers[0][0] === 'time') break;
  pid = Number(ppid);
}
writeFileSync(dir + '/wrappers.json', JSON.stringify(wrappers));
spawn('/bin/sleep', ['60'], { stdio: 'ignore' }).on('spawn', function () { writeFileSync(dir + '/child.pid', String(this.pid)); if (mode === 'quick') this.unref(); });
const ready = setInterval(() => {
  if (!existsSync(dir + '/child.pid')) return;
  clearInterval(ready);
  if (mode === 'flood') { process.stdout.on('error', () => {}); const chunk = 'x'.repeat(1 << 20); for (let i = 0; i < 40; i++) process.stdout.write(chunk); }
  if (mode === 'quick') process.exit(0);
  setTimeout(() => {}, 60_000);
}, 10);
`;

// Alive unless the kernel says no such process; a process of another user (EPERM) counts as alive.
function alive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw Error(`no PID recorded: ${pid}`);
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}
// How many of the PIDs ps lists; ps exits 1 with no output when it lists none.
function psCount(pids) {
  try {
    return execFileSync('/bin/ps', ['-o', 'pid=', '-p', pids.join(',')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split(/\s+/).filter(Boolean).length;
  } catch (error) {
    if (error.status === 1 && error.stdout === '') return 0;
    throw error;
  }
}

const LABEL = { time: '/usr/bin/time', run: 'counting runner' };
function fixture(mode) {
  const dir = mkdtempSync(join(tmpdir(), 'e2e-1322-'));
  writeFileSync(join(dir, 'parent.cjs'), PARENT);
  const read = (name) => existsSync(join(dir, name)) ? readFileSync(join(dir, name), 'utf8') : null;
  const wrappers = () => JSON.parse(read('wrappers.json') ?? '[]');
  // Every recorded process, outermost first: [label, PID].
  const pids = () => [...wrappers().map(([program, pid]) => [LABEL[program] ?? program, pid]), ...['command', 'child'].map((name) => [name, read(`${name}.pid`) === null ? null : Number(read(`${name}.pid`))])];
  return { dir, command: [process.execPath, join(dir, 'parent.cjs'), dir, mode], pids, chain: () => wrappers().map(([program]) => program).join('>'), done: () => { for (const [, pid] of pids()) if (pid && alive(pid)) process.kill(pid, 'SIGKILL'); rmSync(dir, { recursive: true, force: true }); } };
}

function stopped(title, run, mode, timeoutMs, follow, expected) {
  const it = fixture(mode);
  console.log(`\n== ${title}`);
  const started = Date.now();
  let code = 'returned';
  try { run(it.command, it.dir, false, timeoutMs, follow); } catch (error) { code = error.code; }
  const ms = Date.now() - started;
  const pids = it.pids();
  const chain = it.chain();
  if (pids.some(([, pid]) => !pid)) throw Error('a process never recorded its PID');
  let polls = 0;
  while (pids.some(([, pid]) => alive(pid)) && polls < 40) { execFileSync('/bin/sleep', ['0.05']); polls++; }
  const left = pids.filter(([, pid]) => alive(pid)).map(([name]) => name);
  const listed = psCount(pids.map(([, pid]) => pid));
  console.log(`  measureOnce threw ${code} after ${ms} ms (expected ${expected}); the command ran under ${chain.split('>').map((program) => LABEL[program] ?? program).join(' > ')}`);
  console.log(`  ${pids.map(([name, pid]) => `${name} PID ${pid}`).join(', ')}: all ${pids.length} recorded while the run was going`);
  console.log(`  ${left.length ? `${left.join(' and ')} left running` : (polls ? `all ${pids.length} gone after ${polls * 50} ms of polling` : `all ${pids.length} already gone at the first check`)}; ps -p ${pids.map(([, pid]) => pid).join(',')} lists ${listed} of ${pids.length}`);
  it.done(); // SIGKILLs any recorded process still alive (the twin case) and removes the folder
  return { code, ms, left, listed, chain, recorded: pids.length };
}

const checks = [];
const check = (name, ok) => { checks.push(ok); console.log(`  check: ${name}: ${ok ? 'yes' : 'NO'}`); };
const clean = (r, code) => r.code === code && !r.left.length && !r.listed;

let r = stopped('Timeout: a command that started a child, stopped at its 3000 ms timeout (follow = false)', measureOnce, 'sleep', 3000, false, 'ETIMEDOUT');
check(`ETIMEDOUT at 3000-4000 ms under /usr/bin/time, none of the ${r.recorded} left`, clean(r, 'ETIMEDOUT') && r.ms >= 3000 && r.ms < 4000 && r.chain === 'time' && r.recorded === 3);
r = stopped('Timeout with follow = true: the counting runner wraps the measured command', measureOnce, 'sleep', 3000, true, 'ETIMEDOUT');
check(`ETIMEDOUT at 3000-4000 ms under the counting runner, none of the ${r.recorded} left`, clean(r, 'ETIMEDOUT') && r.ms >= 3000 && r.ms < 4000 && r.chain === 'time>run' && r.recorded === 4);
r = stopped('maxBuffer: a command that started a child and wrote 40 MiB, past the 32 MiB maxBuffer (60 s timeout, follow = false)', measureOnce, 'flood', 60_000, false, 'ENOBUFS');
check(`ENOBUFS well before the timeout, none of the ${r.recorded} left`, clean(r, 'ENOBUFS') && r.ms < 30_000 && r.chain === 'time' && r.recorded === 3);
r = stopped('maxBuffer with follow = true', measureOnce, 'flood', 60_000, true, 'ENOBUFS');
check(`ENOBUFS well before the timeout under the counting runner, none of the ${r.recorded} left`, clean(r, 'ENOBUFS') && r.ms < 30_000 && r.chain === 'time>run' && r.recorded === 4);

console.log('\n== In time: a run that finishes before its 60 s timeout');
const work = mkdtempSync(join(tmpdir(), 'e2e-1322-'));
writeFileSync(join(work, 'work.cjs'), 'const s = process.cpuUsage(); while ((({ user, system }) => user + system)(process.cpuUsage(s)) < 500_000); console.log("done")');
const run = measureOnce([process.execPath, join(work, 'work.cjs')], work, false, 60_000, false);
rmSync(work, { recursive: true, force: true });
console.log(`  status ${run.status}, stdout ${JSON.stringify(run.stdout)}, elapsed ${run.elapsedMs.toFixed(0)} ms, CPU ${run.cpuMs} ms, peak RSS ${(run.peakBytes / 2 ** 20).toFixed(1)} MiB (the command burns 500 ms of CPU)`);
check('status 0, stdout "done\\n", elapsed and CPU >= 500 ms, RSS > 10 MiB', run.status === 0 && run.stdout === 'done\n' && run.elapsedMs >= 500 && run.cpuMs >= 500 && run.peakBytes > 10 * 2 ** 20);
const quick = fixture('quick');
const kept = measureOnce(quick.command, quick.dir, false, 60_000, false);
execFileSync('/bin/sleep', ['0.5']);
const keptChild = quick.pids().find(([name]) => name === 'child')[1];
console.log(`  a run that exited in time (status ${kept.status}) leaving a background child in its group: child PID ${keptChild} ${alive(keptChild) ? 'still running, as it should be' : 'gone'}`);
check('the in-time run was not stopped with its group', kept.status === 0 && alive(keptChild));
quick.done();

r = stopped('The wrong program: twin timeout-group-left-running (no group kill after ETIMEDOUT), same timeout case', twin.measureOnce, 'sleep', 3000, false, 'ETIMEDOUT');
check('the twin leaves the command and its child running (what the suite catches)', r.code === 'ETIMEDOUT' && r.left.includes('command') && r.left.includes('child') && r.listed === r.left.length);

console.log(`\nRESULT: ${checks.every(Boolean) ? 'PASS' : 'FAIL'} (${checks.filter(Boolean).length} of ${checks.length} checks)`);
process.exitCode = checks.every(Boolean) ? 0 : 1;
