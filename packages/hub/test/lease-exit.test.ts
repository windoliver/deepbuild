// `deep lease` ends when its command's first process ends, with that process's status, as the shell that would have run
// the command does: a child the command leaves behind in its process group runs on, and keeps the command's leases (the
// hub ends them once the whole group has gone, #1015 AC4), but it never keeps the caller waiting. A test runner that
// crashes mid-suite leaves its pool workers and their tests' children in the group; a `deep lease` that waited for them
// held `node scripts/checks.mjs` for hours.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { client } from './hub.js';

const MAIN = new URL('../../cli/dist/main.js', import.meta.url).pathname;
/** Exits 3 at once, leaving a `sleep` of its process group behind and printing its PID. */
const LEAVES_ONE = 'sleep 300 & echo $!; exit 3';
let dir: string;
let hub: ChildProcess | undefined;
let leftover: number | undefined;
afterEach(async () => {
  if (leftover) try { process.kill(leftover, 'SIGKILL'); } catch { /* gone */ }
  if (hub && hub.exitCode === null) { hub.kill('SIGTERM'); await new Promise((done) => hub!.once('exit', done)); }
  rmSync(dir, { recursive: true, force: true });
});

/** `deep lease -- /bin/sh -c LEAVES_ONE` under `home`: its exit status, how long it took, and the sleep's PID. */
async function leased(home: string): Promise<{ code: number | null; ms: number; left: number }> {
  const started = Date.now();
  const run = spawn(process.execPath, [MAIN, 'lease', '--', '/bin/sh', '-c', LEAVES_ONE], { stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: '/usr/bin:/bin', HOME: home } });
  let out = '';
  run.stdout!.on('data', (d) => { out += String(d); });
  run.stderr!.on('data', (d) => { out += String(d); });
  // A deep lease still waiting 5 s after its command exited waits for the sleep: ended, so the wait shows as its time.
  const cap = setTimeout(() => { const left = Number(/^(\d+)$/m.exec(out)?.[1]); if (left > 1) process.kill(left, 'SIGKILL'); }, 5000);
  const code = await new Promise<number | null>((done) => run.once('exit', done));
  clearTimeout(cap);
  const left = Number(/^(\d+)$/m.exec(out)?.[1]);
  expect(left, `the command printed the PID of the sleep it left behind: ${out}`).toBeGreaterThan(1);
  leftover = left;
  return { code, ms: Date.now() - started, left };
}

const running = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };

it('with no hub, deep lease ends with its command\'s status when the command\'s first process ends, not when the process it left behind does', async () => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-lease-exit-')));
  const home = join(dir, 'home');
  mkdirSync(home);
  const r = await leased(home);
  expect(r.ms, `deep lease ended ${r.ms} ms after it started: it waited for the sleep the command left behind`).toBeLessThan(5000);
  expect(r.code, 'deep lease exits with the command\'s status').toBe(3);
  expect(running(r.left), `the sleep (pid ${r.left}) the command left behind runs on`).toBe(true);
}, 15_000);

it('under a hub, deep lease ends with its command\'s status at once while the slot stays held until the process left behind has ended', async () => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-lease-exit-')));
  const home = join(dir, 'home');
  const root = join(home, '.deepbuild');
  mkdirSync(root, { recursive: true });
  hub = spawn(process.execPath, [MAIN, 'hub', 'run', '--root', root], { stdio: ['ignore', 'pipe', 'inherit'], env: { PATH: '/usr/bin:/bin', HOME: home } });
  const ready = await new Promise<{ socket: string }>((done) => hub!.stdout!.once('data', (d) => done(JSON.parse(String(d).split('\n')[0]!))));
  const call = await client(ready.socket, readFileSync(join(root, 'control.token'), 'utf8').trim());
  const events = async (kind: string) => ((await call('events.read', { after: 0, limit: 1000 })).events as { kind: string; data: Record<string, unknown> }[])
    .filter((e) => e.kind === kind && (e.data.resource as { kind: string }).kind === 'cpu.slot');
  const r = await leased(home);
  expect(r.ms, `deep lease ended ${r.ms} ms after it started: it waited for the sleep the command left behind`).toBeLessThan(5000);
  expect(r.code, 'deep lease exits with the command\'s status').toBe(3);
  expect(running(r.left), `the sleep (pid ${r.left}) the command left behind runs on`).toBe(true);
  expect((await events('lease.acquired')).length, 'the command took one cpu.slot').toBe(1);
  await new Promise((done) => setTimeout(done, 1500));
  expect((await events('lease.released')).length, 'the slot is held while the process the command left behind runs').toBe(0);
  process.kill(r.left, 'SIGKILL');
  for (let i = 0; i < 100 && !(await events('lease.released')).length; i++) await new Promise((done) => setTimeout(done, 50));
  expect((await events('lease.released')).length, 'and released once the whole group has ended').toBe(1);
}, 30_000);
