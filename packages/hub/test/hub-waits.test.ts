import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { rootOf } from '../src/paths.js';
import { startHub, stopHub } from '../src/service.js';

const realTimeout = setTimeout;
const real = (ms: number) => new Promise<void>((done) => { realTimeout(done, ms); });
async function until(holds: () => boolean, limitMs = 5_000): Promise<void> {
  for (let waited = 0; !holds() && waited < limitMs; waited += 5) await real(5);
}
async function parked(): Promise<void> {
  for (let held = 0, waited = 0; held < 10 && waited < 5_000; waited += 10, held = vi.getTimerCount() > 0 ? held + 1 : 0) await real(10);
}
let dir: string;
let servers: net.Server[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'deep-hub-waits-'));
  servers = [];
  writeFileSync(join(dir, 'no-hub.mjs'), '');
  writeFileSync(rootOf(dir).token, 'token\n');
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
});
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(servers.map((s) => new Promise((done) => s.close(done))));
  rmSync(dir, { recursive: true, force: true });
});

async function standIn(): Promise<{ calls: string[]; idle(): boolean; gone(): Promise<void> }> {
  const calls: string[] = [];
  const open = new Set<net.Socket>();
  const server = net.createServer((sock) => {
    open.add(sock);
    sock.on('close', () => open.delete(sock));
    sock.on('error', () => undefined);
    sock.setEncoding('utf8');
    sock.write('{"v":1,"hello":"deep-hub"}\n');
    let buffer = '';
    sock.on('data', (chunk: string) => {
      buffer += chunk;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        const said = JSON.parse(buffer.slice(0, i)) as { hello?: string; id?: string; method?: string };
        buffer = buffer.slice(i + 1);
        if (said.method) calls.push(said.method);
        sock.write(`${JSON.stringify(said.method ? { v: 1, id: said.id, result: {} } : { v: 1, role: said.hello })}\n`);
      }
    });
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(rootOf(dir).socket, done));
  return {
    calls,
    idle: () => open.size === 0,
    gone: () => new Promise((done) => {
      servers.splice(servers.indexOf(server), 1);
      server.close(() => done());
    }),
  };
}
function settled<T>(promise: Promise<T>): () => T | 'pending' {
  let result: T | 'pending' = 'pending';
  void promise.then((value) => { result = value; });
  return () => result;
}

it('deep hub start returns within 20 ms of the hub\'s socket answering, not at the next 100 ms step', async () => {
  const started = settled(startHub({ root: dir, cli: join(dir, 'no-hub.mjs') }));
  await parked();
  expect(started(), 'no hub answers yet').toBe('pending');
  await standIn();
  await vi.advanceTimersByTimeAsync(20);
  await until(() => started() !== 'pending', 2_000);
  expect(started()).toBe(0);
});

it('deep hub stop returns within 20 ms of the hub going, and never while its socket still answers', async () => {
  const hub = await standIn();
  const stopped = settled(stopHub({ root: dir }));
  await until(() => hub.calls.length > 0 && hub.idle());
  expect(hub.calls).toEqual(['hub.stop']);
  for (let i = 0; i < 5; i++) {
    await vi.advanceTimersByTimeAsync(100);
    await real(50);
    await until(() => hub.idle());
  }
  expect(stopped(), 'the hub still answers').toBe('pending');
  await hub.gone();
  await vi.advanceTimersByTimeAsync(20);
  await until(() => stopped() !== 'pending', 2_000);
  expect(stopped()).toBe(0);
});

it('a hub that never answers still fails deep hub start at 15 s, naming its socket and its log', async () => {
  const said: string[] = [];
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation((text) => { said.push(String(text)); return true; });
  try {
    const begun = Date.now();
    const started = settled(startHub({ root: dir, cli: join(dir, 'no-hub.mjs') }));
    await parked();
    vi.setSystemTime(begun + 14_000);
    await vi.advanceTimersByTimeAsync(150);
    await parked();
    expect(started(), 'a second short of the limit').toBe('pending');
    vi.setSystemTime(begun + 15_000);
    await vi.advanceTimersByTimeAsync(150);
    await until(() => started() !== 'pending', 2_000);
    expect(started()).toBe(3);
    expect(said).toEqual([`deep hub start: no hub answered at unix:${rootOf(dir).socket} within 15 s; see ${join(rootOf(dir).logs, 'hub.log')}\n`]);
  } finally {
    stderr.mockRestore();
  }
});
