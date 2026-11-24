// Helpers for #3170's third criterion: which machine this is, a folder on a file system that makes no reflink copy,
// and the issue's own command run to its end. Nothing here imports the code under test, and nothing is imported from
// another suite: deep-hook's cli test is reached only by running cargo on it.
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
/** This machine, as an evidence record names one. */
export const PLATFORM = `${process.platform}-${process.arch}`;
/** The note a test skips with where it can't prove its criterion: unrun, so never PASS (AGENTS.md, invariant 2). */
export const elsewhere = (needs) => `INCONCLUSIVE (platform): this needs ${needs}, and this machine is ${PLATFORM}; it is unrun here`;
/** A cold build of deep-hook's tests takes minutes; a hang still ends. */
export const MINUTES = { timeout: 40 * 60_000 };

/** The test the criterion names, in crates/deep-hook/tests/cli.rs, compiled on Linux only. */
export const COW_TEST = 'a_folder_is_cloned_copy_on_write_where_the_file_system_can_and_exits_3_where_it_cannot';

/**
 * A folder of its own on tmpfs (/dev/shm), removed after the test, or null where there is none. tmpfs has no reflink,
 * so this folder is what every folder is on a Linux machine without one. Whether it can make a reflink copy is
 * checked by `reflinks`, never assumed.
 */
export function folderWithoutReflink(t) {
  try {
    if (!statSync('/dev/shm').isDirectory()) return null;
  } catch {
    return null;
  }
  const dir = realpathSync(mkdtempSync('/dev/shm/deep-3170-ac3-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Whether `cp --reflink=always` makes a copy in `dir`, as the cli test itself probes. */
export function reflinks(dir) {
  const probe = join(dir, 'probe');
  writeFileSync(probe, 'p');
  try {
    execFileSync('cp', ['--reflink=always', probe, `${probe}.copy`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  } finally {
    rmSync(probe, { force: true });
    rmSync(`${probe}.copy`, { force: true });
  }
}

/**
 * Runs `argv` in its own process group to its end, stdout and stderr merged in the order they were written (cargo
 * names a test target on stderr and its tests on stdout). Only the process this started is stopped, by its group's
 * PID, if the test ends first.
 */
export function run(t, argv, { cwd = CHECKOUT, env = process.env } = {}) {
  const child = spawn('/bin/sh', ['-c', 'exec "$@" 2>&1', 'sh', ...argv], { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) try { process.kill(-child.pid, 'SIGKILL'); } catch {}
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (status, signal) => resolve({ status, signal, output }));
  });
}

/** What the named test printed when it panicked: the lines after its `panicked at` line, up to the next blank one. */
export function panicOf(output, name) {
  const section = output.split(`---- ${name} stdout ----\n`)[1];
  if (section === undefined) return null;
  const lines = section.split('\n');
  const at = lines.findIndex((line) => line.includes(' panicked at '));
  if (at < 0) return null;
  const message = [];
  for (const line of lines.slice(at + 1)) {
    if (!line.trim() || line.startsWith('note: ')) break;
    message.push(line);
  }
  return message.join('\n');
}
