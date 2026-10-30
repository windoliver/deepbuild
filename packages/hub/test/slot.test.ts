// A check run inside a real hub takes a `cpu.slot` lease from the kernel's lease table first (#29: at most half the
// CPU cores run checks; the slot it holds shows in the lease table), and gives it back once it has ended.
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';

const MAIN = new URL('../../cli/dist/main.js', import.meta.url).pathname;
let dir: string;
let hub: ChildProcess | undefined;
afterEach(async () => {
  if (hub && hub.exitCode === null) { hub.kill('SIGTERM'); await new Promise((done) => hub!.once('exit', done)); }
  rmSync(dir, { recursive: true, force: true });
});

/** A line client of the hub's socket, as the CLI is. */
async function client(socket: string, token: string): Promise<(method: string, params: object) => Promise<Record<string, unknown>>> {
  const s = net.connect(socket);
  let buf = '';
  const lines: Record<string, unknown>[] = [];
  s.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { lines.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } });
  const until = async <T>(f: () => T | undefined): Promise<T> => { for (let i = 0; i < 600; i++) { const v = f(); if (v) return v; await new Promise((r) => setTimeout(r, 50)); } throw Error('no answer from the hub'); };
  await until(() => lines[0]);
  s.write(`${JSON.stringify({ v: 1, hello: 'cli', token })}\n`);
  await until(() => lines.find((l) => l.role));
  let n = 0;
  return async (method, params) => {
    const id = `c${++n}`;
    s.write(`${JSON.stringify({ v: 1, id, method, params })}\n`);
    const reply = await until(() => lines.find((l) => l.id === id));
    if (reply.error) throw Error(JSON.stringify(reply.error));
    return reply.result as Record<string, unknown>;
  };
}

it('a check run holds a cpu.slot lease while it runs and releases it once it has ended', async () => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-hub-slot-')));
  const [home, root, cwd] = ['home', 'root', 'cwd'].map((p) => join(dir, p)) as [string, string, string];
  for (const p of [home, root, cwd]) mkdirSync(p);
  const go = join(cwd, 'go');
  writeFileSync(join(cwd, 'check.sh'), `#!/bin/sh\nwhile [ ! -f '${go}' ]; do sleep 0.05; done\n`, { mode: 0o755 });
  hub = spawn(process.execPath, [MAIN, 'hub', 'run', '--root', root], { stdio: ['ignore', 'pipe', 'inherit'], env: { PATH: '/usr/bin:/bin', HOME: home } });
  const ready = await new Promise<{ socket: string }>((done) => hub!.stdout!.once('data', (d) => done(JSON.parse(String(d).split('\n')[0]!))));
  const call = await client(ready.socket, readFileSync(join(root, 'control.token'), 'utf8').trim());
  const events = async (kind: string) => ((await call('events.read', { after: 0, limit: 1000 })).events as { kind: string; data: Record<string, unknown> }[]).filter((e) => e.kind === kind);
  const slots = async () => (await events('lease.acquired')).filter((e) => (e.data.resource as { kind: string }).kind === 'cpu.slot');
  const { run } = await call('run.start', { check: 'slow', claim: 'claim:01K74G1Z3X5V7T9R1P3N5M7K9H', commit: 'a'.repeat(40), cwd, argv: ['/bin/sh', join(cwd, 'check.sh')], grant: { write: [cwd] } });
  for (let i = 0; i < 200 && !(await events('run.started')).length; i++) await new Promise((r) => setTimeout(r, 50));
  const held = await slots();
  expect(held.length, 'the run took one cpu.slot lease before it started').toBe(1);
  expect(held[0]!.data.run, 'held for that run').toBe(run);
  writeFileSync(go, '');
  for (let i = 0; i < 200 && !(await events('run.finished')).length; i++) await new Promise((r) => setTimeout(r, 50));
  for (let i = 0; i < 100 && !(await events('lease.released')).some((e) => (e.data.resource as { kind: string }).kind === 'cpu.slot'); i++) await new Promise((r) => setTimeout(r, 50));
  expect((await events('lease.released')).filter((e) => (e.data.resource as { kind: string }).kind === 'cpu.slot').length, 'and released it once the run ended').toBe(1);
}, 60_000);
