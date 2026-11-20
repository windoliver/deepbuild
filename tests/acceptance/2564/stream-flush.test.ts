// #2564's one criterion: with a subscriber's page read made to fail during a flush, the hub records no unhandled
// rejection and keeps answering.
//
// Read as (README, Readings): the hub's core, from the hub's build, runs in a Node process of its own
// (fixtures/hub-run.mjs) on a fresh root with its real record, and nothing in that process listens for unhandled
// rejections, so one ends it as it ends a hub: status 1, the rejection's stack on stderr. One subscriber subscribes as
// the server's `stream.subscribe` asks the core to; SQLite's binding is armed to fail that subscriber's page read in
// the flush that follows, once. The run waits for that read to fail, gives the event loop two turns to report a
// rejection nothing handled, and asks the hub for a page of the log and for its health. The test reads what that
// process printed and how it ended.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';

const RUN = fileURLToPath(new URL('./fixtures/hub-run.mjs', import.meta.url));
const BUILT = fileURLToPath(new URL('../../../packages/hub/dist/hub-runtime.js', import.meta.url));
const HOOK = fileURLToPath(new URL('../../../target/debug/deep-hook', import.meta.url));
const REPO = fileURLToPath(new URL('../../..', import.meta.url)).replace(/\/$/, '');

type Step = { step: string; method?: string; why?: string; after?: number; log_pos?: number; events?: number; frames?: number; keys?: number };
interface Ended { status: number | null; signal: NodeJS.Signals | null; steps: Step[]; stderr: string }

const dirs: string[] = [];
const children = new Set<ReturnType<typeof spawn>>();
afterEach(() => {
  // Only the processes this file started, by their own handles.
  for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  children.clear();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** One run of fixtures/hub-run.mjs to its end: its steps, its stderr and how it ended. */
function hubRun(): Promise<Ended> {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'dh2564-'));
  dirs.push(dir);
  const home = join(dir, 'home');
  mkdirSync(home);
  const child = spawn(process.execPath, [RUN, join(dir, 'world')], { env: { HOME: home, PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8' }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child);
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (status, signal) => {
      const steps = stdout.split('\n').filter((line) => line.startsWith('{')).map((line) => JSON.parse(line) as Step);
      resolve({ status, signal, steps, stderr: stderr.replaceAll(dir, '<tmp>').replaceAll(REPO, '<repo>') });
    });
  });
}

it('#2564.ab15a450 with a subscriber\'s page read made to fail during a flush, the hub records no unhandled rejection and keeps answering', async () => {
  if (!existsSync(BUILT)) throw Error('BLOCKED: packages/hub/dist/hub-runtime.js is missing; build first: npm run build --workspaces');
  if (!existsSync(HOOK)) throw Error('BLOCKED: target/debug/deep-hook is missing, which the hub\'s core needs to start; build it first: cargo build -p deep-hook --locked');
  const run = await hubRun();
  const steps = run.steps.map((s) => s.step);
  const told = `\nsteps: ${JSON.stringify(run.steps)}\nstatus ${String(run.status)}, signal ${String(run.signal)}\nstderr:\n${run.stderr}`;

  // The run reached the criterion's "with": a subscriber subscribed, and its page read in the flush failed.
  const blocked = run.steps.find((s) => s.step === 'blocked');
  expect(blocked, `BLOCKED: ${blocked?.why ?? ''}${told}`).toBeUndefined();
  expect(steps.slice(0, 3), `BLOCKED: the run never got as far as failing the subscriber's page read in a flush${told}`).toEqual(['started', 'subscribed', 'stream-read-failed']);
  expect(run.steps[2]!.frames, `precondition: the read that failed is the subscriber's first page, before any frame${told}`).toBe(0);

  // No unhandled rejection: Node ends a process at one, and this one lives past the failed read.
  expect(steps.includes('alive'), `the failed page read in the flush ended the hub's process: an unhandled rejection${told}`).toBe(true);

  // It keeps answering: a page of the log, and its health.
  const answered = run.steps.filter((s) => s.step === 'answered');
  expect(answered.map((s) => s.method), `after the failed page read the hub answered events.read and health${told}`).toEqual(['events.read', 'health']);
  expect(answered[0]!.events, `the later events.read answered with the log's events${told}`).toBeGreaterThan(0);
  expect(answered[1]!.keys, `the later health answered with its readings${told}`).toBeGreaterThan(0);

  // And it stops cleanly: nothing ended it.
  expect(steps.at(-1), `the hub stopped when asked${told}`).toBe('stopped');
  expect({ status: run.status, signal: run.signal }, `the hub's process ended with status 0${told}`).toEqual({ status: 0, signal: null });
}, 120_000);
