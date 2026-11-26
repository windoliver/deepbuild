// Shared fixture for the #1322 suite. The measured command starts a child; each of the two connects to a Unix socket
// the test listens on and says on it what it is (`pid <role> <pid>`), holding the connection for its whole life. The
// kernel closes a process's connection when it exits, so "every process is gone" is an event the test reads (each
// connection's end), not a poll. The child answers SIGUSR2 with `alive <pid>`, so "still running" is an event too: a
// dead or zombie child can't answer, and its connection has ended.
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// How long a leftover process lives at most, so a wrong program never leaves one running for long.
export const LEFTOVER_MS = 60_000;
// How long a test waits for an event it needs before failing; well under LEFTOVER_MS, so a leftover's own end never
// looks like the event.
export const EVENT_DEADLINE_MS = 20_000;

// Argv: socket, mode, lifeMs, role. The parent starts the child and, once the child has said its PID, per mode:
// 'sleep' stays alive; 'flood' writes 40 MiB to stdout and stays alive; 'background' says `exit <pid>` and exits 0,
// leaving the child (stdio ignored) running. Each process also writes <role>.pid beside the socket, read only by
// cleanup.
const SCRIPT = `
const { spawn } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const { connect } = require('node:net');
const { dirname, join } = require('node:path');
const [path, mode, lifeMs, role] = process.argv.slice(2);
writeFileSync(join(dirname(path), role + '.pid'), String(process.pid));
const link = connect(path);
const say = (line, then) => link.write(line + '\\n', then);
const live = () => setTimeout(() => {}, Number(lifeMs));
if (role === 'child') {
  process.on('SIGUSR2', () => say('alive ' + process.pid));
  say('pid child ' + process.pid, () => process.stdout.write('ready\\n'));
  live();
} else {
  say('pid parent ' + process.pid);
  const quiet = mode === 'background' ? 'ignore' : 'inherit';
  const child = spawn(process.execPath, [__filename, path, mode, lifeMs, 'child'], { stdio: ['ignore', 'pipe', quiet] });
  child.stdout.once('data', () => {
    if (mode === 'background') {
      child.stdout.destroy();
      child.unref();
      return say('exit ' + process.pid, () => process.exit(0));
    }
    if (mode === 'flood') {
      // A closed pipe must not end it: it stays alive past the overflow.
      process.stdout.on('error', () => {});
      const chunk = 'x'.repeat(1024 * 1024 - 1) + '\\n';
      let left = 40;
      const write = () => { while (left > 0) { left--; if (!process.stdout.write(chunk)) return process.stdout.once('drain', write); } };
      write();
    }
    live();
  });
}
`;

// A listening fixture: await it before measureOnce, so the processes' connections queue while measureOnce blocks.
export async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'acceptance-1322-'));
  const script = join(dir, 'process.cjs');
  const path = join(dir, 's');
  writeFileSync(script, SCRIPT);
  const lines = [];
  const connections = new Set();
  const changed = new Set();
  const notify = () => { for (const listener of changed) listener(); };
  const server = createServer((connection) => {
    connections.add(connection);
    connection.setEncoding('utf8');
    let partial = '';
    connection.on('data', (text) => {
      const parts = (partial + text).split('\n');
      partial = parts.pop();
      lines.push(...parts);
      notify();
    });
    connection.on('error', () => {});
    connection.on('close', () => {
      connections.delete(connection);
      notify();
    });
  });
  server.listen(path);
  await once(server, 'listening');
  const pid = (role) => Number(lines.find((line) => line.startsWith(`pid ${role} `))?.split(' ')[2]) || null;
  return {
    dir,
    lines,
    pid,
    command: (mode) => [process.execPath, script, path, mode, String(LEFTOVER_MS), 'parent'],
    // Resolves true once done(state) holds, or false at the deadline. state: { lines, open } (open connections).
    next(done) {
      return new Promise((resolve) => {
        let timer;
        const finish = (held) => {
          clearTimeout(timer);
          changed.delete(check);
          resolve(held);
        };
        const check = () => { if (done({ lines, open: connections.size })) finish(true); };
        // deadline: turns a missing socket event (a process that never ends, connects or answers) into a failure
        timer = setTimeout(() => finish(false), EVENT_DEADLINE_MS);
        changed.add(check);
        check();
      });
    },
    // Resolves once both processes have said their PIDs and every connection has ended: both are gone.
    gone() {
      return this.next(({ open }) => pid('parent') !== null && pid('child') !== null && open === 0);
    },
    cleanup() {
      for (const role of ['parent', 'child']) {
        const file = join(dir, `${role}.pid`);
        if (existsSync(file)) kill(Number(readFileSync(file, 'utf8')));
      }
      for (const connection of connections) connection.destroy();
      server.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

// The recorded processes still alive, for a failure message only.
export function stillAlive(run) {
  return ['parent', 'child'].map((role) => [role, run.pid(role)]).filter(([, pid]) => pid && alive(pid)).map(([role, pid]) => `${role} ${pid}`);
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function kill(pid) {
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // Already gone.
  }
}

// What measureOnce threw, or its result.
export function outcome(run) {
  try {
    return { value: run() };
  } catch (error) {
    return { error };
  }
}
