// The hub's background jobs (asks' deadlines, leases, the supervisor, retention, staging, rule judging) run on
// timers, where a failure reaches no caller. Each one's last failure is kept and shown in hub.health, so a job that
// keeps failing is seen rather than silently doing nothing (AGENTS.md, invariant 2), and it clears once a run of
// that job succeeds again. Real hub, real record; the test VFS refuses every write while a file exists, as on a
// full disk, so the jobs that write fail for real.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { afterEach, expect, it } from 'vitest';
import { askSources } from '@deepbuild/asks';
import { openRecord, ulid } from '@deepbuild/record';

const MAIN = fileURLToPath(new URL('../../cli/dist/main.js', import.meta.url));
let dir = '';
let hub: ChildProcess | undefined;
afterEach(async () => {
  if (hub && hub.exitCode === null) {
    const gone = new Promise((done) => hub!.once('exit', done));
    hub.kill('SIGTERM');
    await gone;
  }
  hub = undefined;
  rmSync(dir, { recursive: true, force: true });
});

type Call = (method: string, params?: Record<string, unknown>) => Promise<Record<string, any>>;
async function cli(socket: string, token: string): Promise<Call> {
  const s = net.connect(socket);
  let buf = '';
  const lines: Record<string, any>[] = [];
  s.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { lines.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } });
  const until = async <T>(f: () => T | undefined): Promise<T> => { for (let i = 0; i < 600; i++) { const v = f(); if (v) return v; await new Promise((r) => setTimeout(r, 50)); } throw Error('no answer from the hub'); };
  await until(() => lines[0]);
  s.write(`${JSON.stringify({ v: 1, hello: 'cli', token })}\n`);
  await until(() => lines.find((l) => l.role));
  let n = 0;
  return async (method, params = {}) => {
    const id = `c${++n}`;
    s.write(`${JSON.stringify({ v: 1, id, method, params })}\n`);
    const reply = await until(() => lines.find((l) => l.id === id));
    if (reply.error) throw Error(JSON.stringify(reply.error));
    return reply.result as Record<string, any>;
  };
}
async function waitFor<T>(probe: () => Promise<T | undefined>, ms: number, what: string): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await probe();
    if (v !== undefined) return v;
    if (Date.now() > end) throw Error(`timed out after ${ms} ms waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

it('a background job that fails is named in hub.health with its error, and cleared once it runs clean again', async () => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-hub-background-')));
  const [home, root] = ['home', 'root'].map((p) => join(dir, p)) as [string, string];
  for (const p of [home, root]) mkdirSync(p);
  // An ask already past its deadline, so the hub's asks tick takes its default at once: an append.
  const now = Date.now();
  const record = await openRecord({ path: join(root, 'ledger.db'), now: () => now });
  const taste = askSources().find((row) => row.kind === 'taste')!.fixture.ask as Record<string, unknown>;
  const ask = ulid(now - 60_000);
  await record.append({ writer: 'core', actor: 'you', scope: 'you' }, { v: 1, id: ask, kind: 'ask.created', ts: now - 60_000, data: { ...structuredClone(taste), deadline: now - 1000 } as never });
  await record.close();
  // The test VFS reads the ledger as one serialized image, as its last FULL commit left it.
  const image = new Database(join(root, 'ledger.db'));
  // An in-memory image can't be in WAL mode: the record's own restore closes out of WAL the same way.
  image.pragma('journal_mode = DELETE');
  const bytes = image.serialize();
  image.close();
  for (const f of ['ledger.db', 'ledger.db-wal', 'ledger.db-shm']) rmSync(join(root, f), { force: true });
  writeFileSync(join(root, 'ledger.db'), bytes);
  const refuse = join(dir, 'disk-full');
  hub = spawn(process.execPath, [MAIN, 'hub', 'run', '--root', root], {
    stdio: ['ignore', 'pipe', 'inherit'], env: { PATH: '/usr/bin:/bin', HOME: home, DEEP_HUB_TEST_VFS: JSON.stringify({ refuse }) },
  });
  const ready = await new Promise<{ socket: string }>((done) => hub!.stdout!.once('data', (d) => done(JSON.parse(String(d).split('\n')[0]!))));
  const call = await cli(ready.socket, readFileSync(join(root, 'control.token'), 'utf8').trim());
  // The disk fills once the hub is up: every write it tries is refused until the file goes.
  writeFileSync(refuse, '');

  type Jobs = Record<string, { failing: { at: number; error: string } | null }>;
  const asks = await waitFor(async () => {
    const jobs = (await call('hub.health')).jobs as Jobs | undefined;
    return jobs?.asks?.failing ? jobs.asks.failing : undefined;
  }, 15_000, 'the asks job to read failing while its default cannot be appended');
  expect(asks.error, 'its failure says why').toMatch(/\S/);
  expect(asks.at, 'its failure says when').toBeGreaterThanOrEqual(now);

  rmSync(refuse);
  await waitFor(async () => {
    const jobs = (await call('hub.health')).jobs as Jobs;
    return jobs.asks!.failing === null || undefined;
  }, 15_000, 'the asks job to clear once writes work again');
  const events = await call('events.read', { after: 0, limit: 1000 });
  expect((events.events as { kind: string; subject?: string }[]).some((e) => e.kind === 'ask.defaulted' && e.subject === `ask:${ask}`), 'the default lands once the disk takes writes').toBe(true);
}, 60_000);
