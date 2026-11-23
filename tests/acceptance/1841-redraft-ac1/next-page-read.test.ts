// #1841's one criterion, redrafted blind: with the next page's read made to fail after `events.read` has replied, the
// hub records no unhandled rejection and keeps answering.
//
// The hub's core, from the hub's build, runs in a Node process of its own (fixtures/page-read-fails.mjs) on a fresh
// root with its real record, under a kill limit. SQLite's binding fails the read of the page after the replied one,
// once; that process records every unhandled rejection it sees, then asks the hub for that page again. The test reads
// the steps it printed.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';

const RUN = fileURLToPath(new URL('./fixtures/page-read-fails.mjs', import.meta.url));
const BUILT = fileURLToPath(new URL('../../../packages/hub/dist/hub-runtime.js', import.meta.url));
const HOOK = fileURLToPath(new URL('../../../target/debug/deep-hook', import.meta.url));
const REPO = fileURLToPath(new URL('../../..', import.meta.url)).replace(/\/$/, '');
/** The child is killed past this, so a hang fails the test instead of stalling it. Generous: the machine may be loaded. */
const KILL_MS = 400_000;
const LIMIT = 2;

interface Step { step: string; why?: string; after?: number; log_pos?: number | number[]; events?: number[]; bound?: number; message?: string; stack?: string; answered?: boolean }
interface Ended { status: number | null; signal: NodeJS.Signals | null; killed: boolean; steps: Step[]; stderr: string }

const dirs: string[] = [];
const children = new Set<ReturnType<typeof spawn>>();
afterEach(() => {
  // Only the process this file started, by its own handle.
  for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  children.clear();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function hubRun(): Promise<Ended> {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'dh1841r-'));
  dirs.push(dir);
  const home = join(dir, 'home');
  mkdirSync(home);
  const child = spawn(process.execPath, [RUN, join(dir, 'world')], { env: { HOME: home, PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8' }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child);
  let killed = false;
  const limit = setTimeout(() => { killed = true; child.kill('SIGKILL'); }, KILL_MS);
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (status, signal) => {
      clearTimeout(limit);
      const steps = stdout.split('\n').filter((line) => line.startsWith('{')).map((line) => JSON.parse(line) as Step);
      resolve({ status, signal, killed, steps, stderr: stderr.replaceAll(dir, '<tmp>').replaceAll(REPO, '<repo>') });
    });
  });
}

it('#1841.d29cb857 with the next page\'s read made to fail after events.read has replied, the hub records no unhandled rejection and keeps answering', async () => {
  if (!existsSync(BUILT)) throw Error('BLOCKED: packages/hub/dist/hub-runtime.js is missing; build first: npm run build --workspaces');
  if (!existsSync(HOOK)) throw Error('BLOCKED: target/debug/deep-hook is missing, which the hub\'s core needs to start; build it first: cargo build -p deep-hook --locked');
  const run = await hubRun();
  const told = `\nsteps: ${JSON.stringify(run.steps.map(({ stack: _, ...s }) => s))}\nstatus ${String(run.status)}, signal ${String(run.signal)}${run.killed ? `, killed at the ${KILL_MS / 1000} s limit` : ''}\nstderr:\n${run.stderr}`;
  const at = (name: string) => run.steps.find((s) => s.step === name);

  // The criterion's "with": the failure was injected, after the reply, into the read of the page after it.
  const blocked = at('blocked');
  if (blocked) throw Error(`BLOCKED: ${blocked.why ?? ''}${told}`);
  const replied = at('replied');
  const failed = at('next-page-read-failed');
  if (!replied || !failed) throw Error(`BLOCKED: the run never failed the next page's read after events.read replied${told}`);
  expect(replied.events, `precondition: events.read replied with a full first page${told}`).toHaveLength(LIMIT);
  expect(failed.after, `precondition: the read that failed is of the page after the one replied${told}`).toBe(replied.log_pos);

  // No unhandled rejection was recorded.
  const unhandled = run.steps.filter((s) => s.step === 'unhandled');
  expect(unhandled.map((s) => s.message), `the hub recorded an unhandled rejection from the failed page read:\n${unhandled.map((s) => (s.stack ?? '').replaceAll(REPO, '<repo>')).join('\n')}${told}`).toEqual([]);

  // It keeps answering, correctly: the page whose read failed, as the log holds it, and its health.
  const answered = at('answered');
  const log = at('log');
  expect(answered && log, `the hub didn't answer events.read after the failed page read${told}`).toBeTruthy();
  const held = (log!.log_pos as number[]).filter((p) => p > (replied.log_pos as number));
  expect(held.length, `precondition: the log holds events past the first page${told}`).toBeGreaterThan(0);
  expect(answered!.events, `the later events.read answered the page after log_pos ${String(replied.log_pos)} with the log's events${told}`).toEqual(held.slice(0, LIMIT));
  expect(answered!.log_pos, `and a log_pos at that page's end${told}`).toBe(held.length >= LIMIT ? held[LIMIT - 1] : Math.max(...(log!.log_pos as number[])));
  expect(at('health')?.answered, `the hub answered health after the failed page read${told}`).toBe(true);

  // And it stops when asked, nothing having ended it first.
  expect(run.steps.at(-1)?.step, `the hub stopped when asked${told}`).toBe('stopped');
  expect({ status: run.status, signal: run.signal }, `the run ended with status 0${told}`).toEqual({ status: 0, signal: null });
}, KILL_MS + 60_000);
