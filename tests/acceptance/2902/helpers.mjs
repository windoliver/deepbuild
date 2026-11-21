// Helpers for #2902's acceptance tests. They reuse #2744's sandbox (a table folder of the test's own through
// DEEP_THROTTLE_TABLE, temporary HOMEs, stub commands, every process group stopped by its PID after the test) and
// #2833's reading of the current test limit from scripts/throttle.mjs's LIMITS line; neither is edited. The live
// table at ~/.deepbuild/throttle/ is never read or written. Nothing here imports the code under test.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHECKOUT, pause } from '../2744/helpers.mjs';

// The commit this suite was drafted on: its scripts/throttle.mjs records no limit in a request, as every checkout
// older than #2902's change does.
export const BASE = '6a2b68d44dd4dee8eeb2dea46f412fd632b1718d';
// An old checkout's own Linux test limit (#2902: "Older branches ... still have `test: 4`").
export const OLD_LIMIT = 4;

/**
 * An old checkout's throttle.mjs in the sandbox: the base commit's, with its non-darwin `test` limit set to
 * OLD_LIMIT, in a scripts/ folder of its own. Returns its path.
 */
export function oldCheckout(box) {
  const source = execFileSync('git', ['-C', CHECKOUT, 'show', `${BASE}:scripts/throttle.mjs`], { encoding: 'utf8' });
  const lines = source.split('\n');
  const at = lines.findIndex((line) => /^\s*const\s+LIMITS\s*=\s*process\.platform\s*===\s*'darwin'\s*\?.*\s:\s/.test(line));
  if (at < 0) throw Error(`the base ${BASE}'s throttle.mjs has no LIMITS line to give an old checkout's limit`);
  const split = lines[at].lastIndexOf(' : ');
  const linux = lines[at].slice(split);
  const old = linux.replace(/\btest:\s*\d+/, `test: ${OLD_LIMIT}`);
  if (old === linux && !linux.includes(`test: ${OLD_LIMIT}`)) throw Error(`can't set the old checkout's Linux test limit in: ${lines[at]}`);
  lines[at] = lines[at].slice(0, split) + old;
  const dir = join(box.dir, 'old-checkout', 'scripts');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'throttle.mjs');
  writeFileSync(file, lines.join('\n'));
  return file;
}

/**
 * `node <script> <args> -- node stub.mjs <name> <flags>` in its own process group, with the sandbox's table, like
 * #2744's throttle() but for any copy of throttle.mjs. It joins box.children, so it is stopped after the test.
 */
export function run(box, script, args, name, flags = []) {
  const home = box.defaultHome;
  const child = spawn(process.execPath, [script, ...args, '--', process.execPath, box.stub, name, ...flags], { cwd: box.dir, env: { ...box.env, HOME: home, XDG_CACHE_HOME: join(home, '.cache') }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  box.children.push(child);
  let out = '';
  child.stdout.on('data', (chunk) => { out += chunk; });
  child.stderr.on('data', (chunk) => { out += chunk; });
  child.label = name;
  child.output = () => out;
  return child;
}

/** The sandbox's table.json, or null while it doesn't exist; a read that races a rewrite is retried. */
export async function table(box) {
  const file = join(box.table, 'table.json');
  for (let attempt = 0; ; attempt++) {
    if (!existsSync(file)) return null;
    try {
      return JSON.parse(readFileSync(file, 'utf8'));
    } catch (error) {
      if (attempt === 20) throw error;
      await pause(10);
    }
  }
}
/** The table's pending request made by process `pid`, if any. */
export const requestOf = async (box, pid) => (await table(box))?.requests?.find((request) => request.pid === pid);

/** Polls an async predicate until it holds or `ms` pass; returns whether it held. */
export async function until(predicate, ms) {
  const end = Date.now() + ms;
  for (;;) {
    if (await predicate()) return true;
    if (Date.now() > end) return false;
    await pause(50);
  }
}
