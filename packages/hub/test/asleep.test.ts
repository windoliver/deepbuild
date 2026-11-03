// While the Mac sleeps the hub process stays up but none of its timers run (#908). A real hub, stopped with SIGSTOP
// as sleep stops it and resumed, finds its next beat far past the last on the wall clock and moves the deadline of an
// ask that waited for its batch the whole time, by that time, recorded on the ask.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { askSources, draftAskSettings } from '@deepbuild/asks';
import { openRecord, ulid } from '@deepbuild/record';

const MAIN = fileURLToPath(new URL('../../cli/dist/main.js', import.meta.url));
let dir = '';
let hub: ChildProcess | undefined;
afterEach(async () => {
  if (hub && hub.exitCode === null) {
    const gone = new Promise((done) => hub!.once('exit', done));
    hub.kill('SIGCONT');
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
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

it('a hub that slept with an ask waiting for its batch moves its deadline later by the time it slept', async () => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-hub-asleep-')));
  const [home, root] = ['home', 'root'].map((p) => join(dir, p)) as [string, string];
  for (const p of [home, root]) mkdirSync(p);
  // Batches every 8 h, as setup drafts them: an ask due in two days waits for the next one.
  draftAskSettings(root);
  const now = Date.now();
  const deadline = now + 2 * 86_400_000;
  const record = await openRecord({ path: join(root, 'ledger.db'), now: () => now });
  const taste = askSources().find((row) => row.kind === 'taste')!.fixture.ask as Record<string, unknown>;
  const ask = ulid(now);
  await record.append({ writer: 'core', actor: 'you', scope: 'you' }, { v: 1, id: ask, kind: 'ask.created', ts: now, data: { ...structuredClone(taste), deadline } as never });
  await record.close();
  hub = spawn(process.execPath, [MAIN, 'hub', 'run', '--root', root], { stdio: ['ignore', 'pipe', 'inherit'], env: { PATH: '/usr/bin:/bin', HOME: home } });
  const ready = await new Promise<{ socket: string }>((done) => hub!.stdout!.once('data', (d) => done(JSON.parse(String(d).split('\n')[0]!))));
  const call = await cli(ready.socket, readFileSync(join(root, 'control.token'), 'utf8').trim());
  // Every event that names the ask: its creation, a batch that shows it, a move of its deadline.
  const about = async () => ((await call('events.read', { after: 0, limit: 1000 })).events as { kind: string; writer: string; data: Record<string, unknown> }[])
    .filter((e) => JSON.stringify(e).includes(ask));
  await pause(2000);
  expect((await about()).map((e) => e.kind), 'the ask waits for its batch, unshown and unmoved').toEqual(['ask.created']);

  hub.kill('SIGSTOP');
  await pause(12_000);
  hub.kill('SIGCONT');
  let moves: Awaited<ReturnType<typeof about>> = [];
  for (let i = 0; i < 50 && !moves.length; i++) { await pause(100); moves = (await about()).filter((e) => e.kind === 'deadline.moved'); }
  expect(moves.length, 'the deadline move is recorded on the ask once').toBe(1);
  const span = moves[0]!.data.span as number;
  expect(span, 'it moves by the time the hub slept, 12 s and at most a beat or two more').toBeGreaterThanOrEqual(11_000);
  expect(span, 'it moves by the time the hub slept, 12 s and at most a beat or two more').toBeLessThan(16_000);
  expect(moves[0]!.data.deadline, 'to its deadline plus that time').toBe(deadline + span);
  expect(moves[0]!.writer).toBe('core');
}, 60_000);
