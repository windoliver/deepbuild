// Loaded with --import into the measured process by measure.mjs: names the code that starts each process, which the
// perf lane's child counter (scripts/count-children.c) can't, since it sees only a parent's and a child's PIDs. Every
// asynchronous start goes through ChildProcess.prototype.spawn (spawn, execFile and exec all do), and each logs one
// JSON line to DEEP_2649_SITES: the child's PID, its program and arguments, the supervisor frames that led to it, the
// measured phase, and, once it closes, a hash of what it printed. The hash is how the table tells an answer an earlier
// one already held from a new one, without keeping the output. Nothing a process is given, or does, changes.
import childProcess from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

const LOG = process.env.DEEP_2649_SITES;
const ROOT = process.env.DEEP_2649_ROOT;
globalThis.__phase2649 ??= 'load';
const put = (line) => LOG && appendFileSync(LOG, `${JSON.stringify(line)}\n`);

// The repo's frames on the way to the start, innermost first, as "<file>:<line> <function>", this file left out.
function frames() {
  const found = [];
  for (const line of String(new Error().stack).split('\n').slice(1)) {
    const m = /at (?:async )?(?:(\S+) )?\(?(?:file:\/\/)?([^()]+):(\d+):\d+\)?$/.exec(line.trim());
    if (!m || !ROOT || !m[2].startsWith(ROOT) || m[2].endsWith('/sites.mjs')) continue;
    found.push(`${m[2].slice(ROOT.length + 1)}:${m[3]} ${m[1] ?? '<anonymous>'}`);
    if (found.length === 5) break;
  }
  return found;
}

const spawn = childProcess.ChildProcess.prototype.spawn;
let seq = 0;
childProcess.ChildProcess.prototype.spawn = function counted(options) {
  const result = spawn.call(this, options);
  const n = ++seq;
  const at = { n, pid: this.pid, phase: globalThis.__phase2649, t: Date.now(), file: options.file, args: options.args.slice(1), frames: frames() };
  put({ kind: 'start', ...at });
  // What it printed, hashed whole, and its PIDs alone where it prints a process list: helper scan prints
  // "<marker> <pid> ... <memory>" a line, ps "<pid> ..." a line, so the first field that is a number is the PID.
  const hash = createHash('sha256');
  const pids = [];
  let rest = '';
  this.stdout?.on('data', (chunk) => {
    hash.update(chunk);
    rest += chunk.toString('latin1');
    const lines = rest.split('\n');
    rest = lines.pop();
    for (const line of lines) {
      const pid = line.trim().split(/\s+/).find((field) => /^\d+$/.test(field));
      if (pid) pids.push(pid);
    }
  });
  this.once('close', (code, signal) => put({ kind: 'close', n, pid: at.pid, t: Date.now(), code, signal, out: hash.digest('hex').slice(0, 16), pids: pids.sort().join(',') }));
  return result;
};

// execFileSync goes through spawnSync inside Node, past the prototype, and gives no PID back: the same call through
// the exported spawnSync gives the PID, with execFileSync's answer and throw. The supervisor calls it only on Linux
// (startNow), so on macOS this is for completeness.
const spawnSync = childProcess.spawnSync;
childProcess.execFileSync = function countedSync(file, args = [], options = {}) {
  const result = spawnSync(file, args, options);
  put({ kind: 'start', n: ++seq, pid: result.pid, phase: globalThis.__phase2649, t: Date.now(), file, args, frames: frames(), sync: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Object.assign(Error(`Command failed: ${file}`), { status: result.status, stdout: result.stdout, stderr: result.stderr });
  return result.stdout;
};
syncBuiltinESMExports();
