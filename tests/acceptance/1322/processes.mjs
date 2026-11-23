// Shared fixture for the #1322 suite: a measured command that starts a child, both writing their PIDs into a
// temp directory, and helpers that read those PIDs back, wait for them to be gone and kill any left over.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// How long a leftover process lives at most, so a wrong program never leaves one running for long.
export const LEFTOVER_MS = 30_000;

// The measured command: writes parent.pid, starts a child that writes child.pid and sleeps, waits for child.pid,
// then per mode: 'sleep' stays alive; 'flood' writes 40 MiB to stdout and stays alive; 'background' exits 0 at once,
// leaving the child (stdio ignored) asleep.
const PARENT = `
const { spawn } = require('node:child_process');
const { existsSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const [dir, mode, lifeMs] = process.argv.slice(2);
writeFileSync(join(dir, 'parent.pid'), String(process.pid));
const childPid = join(dir, 'child.pid');
const child = spawn(process.execPath, ['-e', 'require("node:fs").writeFileSync(process.argv[1], String(process.pid)); setTimeout(() => {}, Number(process.argv[2]))', childPid, lifeMs], { stdio: mode === 'background' ? 'ignore' : ['ignore', 'ignore', 'inherit'] });
const ready = setInterval(() => {
  if (!existsSync(childPid)) return;
  clearInterval(ready);
  if (mode === 'background') { child.unref(); process.exit(0); }
  if (mode === 'flood') {
    // A closed pipe must not end it: it stays alive past the overflow.
    process.stdout.on('error', () => {});
    const chunk = 'x'.repeat(1024 * 1024 - 1) + '\\n';
    let left = 40;
    const write = () => { while (left > 0) { left--; if (!process.stdout.write(chunk)) return process.stdout.once('drain', write); } };
    write();
  }
  setTimeout(() => {}, Number(lifeMs));
}, 10);
`;

export function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'acceptance-1322-'));
  const script = join(dir, 'parent.cjs');
  writeFileSync(script, PARENT);
  return {
    dir,
    command: (mode) => [process.execPath, script, dir, mode, String(LEFTOVER_MS)],
    pids: () => ['parent', 'child'].map((name) => {
      const file = join(dir, `${name}.pid`);
      return { name, pid: existsSync(file) ? Number(readFileSync(file, 'utf8')) : null };
    }),
    cleanup() {
      for (const { pid } of this.pids()) if (pid) kill(pid);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

// The PIDs still alive after waiting up to waitMs for them to be gone (reaping takes a moment).
export async function leftAfter(pids, waitMs = 5_000) {
  const deadline = Date.now() + waitMs;
  let left = pids.filter(({ pid }) => alive(pid));
  while (left.length && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    left = left.filter(({ pid }) => alive(pid));
  }
  return left.map(({ name, pid }) => `${name} ${pid}`);
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
