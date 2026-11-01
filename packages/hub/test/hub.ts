// A hub started on a temp home, and hook requests sent to it the way deep-hook sends them (#315's hub tests).
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../../cli/dist/main.js', import.meta.url));

/** A hook request line as deep-hook writes it; `seq` defaults to now. */
export function hookLine(id: string, event: string, payload: Record<string, unknown>, extra: Record<string, unknown> = {}): string {
  const seq = String(BigInt(Date.now()) * 1_000_000n);
  return `${JSON.stringify({ v: 1, agent: 'claude-code', event, seq, id, pid: process.pid, ppid: process.ppid, matched: [], payload, ...extra })}\n`;
}

/** Sends one hook request the way deep-hook does: waits for the hello, writes the line, reads the acknowledgement. */
export function send(socket: string, line: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(socket);
    let got = '';
    sock.on('data', (d) => {
      got += d;
      if (got.split('\n').length === 2) sock.write(line);
      if (got.split('\n').length > 2) { sock.destroy(); resolve(got.split('\n')[1]!); }
    });
    sock.on('error', reject);
  });
}

/** Sends one hook request and returns the hub's reply, the line after its acknowledgement. */
export function reply(socket: string, line: string): Promise<{ exit: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(socket);
    let got = '';
    sock.on('data', (d) => {
      got += d;
      const lines = got.split('\n');
      if (lines.length === 2) sock.write(line);
      if (lines.length > 3) { sock.destroy(); resolve(JSON.parse(lines[2]!) as { exit: number; stdout: string; stderr: string }); }
    });
    sock.on('error', reject);
  });
}

/** A hub `withHub` started: it can be restarted (with its own environment), and waited on when it kills itself. */
/** `between` runs with the hub stopped, before it starts again. */
export interface Hub { restart: (env?: Record<string, string>, between?: () => void | Promise<void>) => Promise<void>; exited: (within?: number) => Promise<void> }

/** Runs `body` against a hub started on a temp home with `env` added, then stops the hub and removes the home. */
export async function withHub(body: (root: string, home: string, hub: Hub) => Promise<void>, env: Record<string, string> = {}): Promise<void> {
  const home = realpathSync(mkdtempSync('/tmp/hub-315-'));
  const root = join(home, '.deepbuild');
  mkdirSync(root, { recursive: true });
  let hub: ChildProcessByStdio<null, Readable, null>;
  const start = async (extra: Record<string, string>) => {
    hub = spawn(process.execPath, [CLI, 'hub', 'run'], { env: { ...process.env, HOME: home, ...extra }, stdio: ['ignore', 'pipe', 'inherit'] });
    let timer: NodeJS.Timeout | undefined;
    await new Promise((resolve, reject) => {
      hub.stdout.once('data', resolve);
      hub.once('exit', () => reject(Error('the hub exited before it was ready')));
      timer = setTimeout(() => reject(Error("the hub wasn't ready within 10 s")), 10_000);
    }).finally(() => clearTimeout(timer));
  };
  const exited = async (within = 10_000) => {
    if (hub.exitCode !== null || hub.signalCode !== null) return;
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      new Promise((resolve) => hub.once('exit', resolve)),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Error(`the hub didn't stop within ${within} ms`)), within); }),
    ]).finally(() => clearTimeout(timer));
  };
  const stop = async () => {
    if (hub.exitCode === null && hub.signalCode === null) {
      hub.kill('SIGTERM');
      await exited(60_000);
    }
  };
  try {
    await start(env);
    await body(root, home, { restart: async (extra = {}, between) => { await stop(); await between?.(); await start(extra); }, exited });
  } finally {
    await stop();
    rmSync(home, { recursive: true, force: true });
  }
}

type Obj = Record<string, any>;
/** A deep mcp in `cwd`: this process's own child, or, `unbound`, a grandchild under a shell no session's hooks came from. */
export function mcp(home: string, cwd: string, unbound: boolean) {
  const argv = [process.execPath, CLI, 'mcp'];
  // The shell runs one more command after node, so it doesn't exec node in its place.
  const child = unbound
    ? spawn('/bin/sh', ['-c', `"${argv.join('" "')}"; :`], { cwd, env: { ...process.env, HOME: home }, stdio: ['pipe', 'pipe', 'inherit'] })
    : spawn(argv[0]!, argv.slice(1), { cwd, env: { ...process.env, HOME: home }, stdio: ['pipe', 'pipe', 'inherit'] });
  const waiting = new Map<number, (m: Obj) => void>();
  createInterface({ input: child.stdout }).on('line', (raw) => { const m = JSON.parse(raw) as Obj; waiting.get(m.id)?.(m); waiting.delete(m.id); });
  let ids = 0;
  const request = (method: string, params: Obj) => new Promise<Obj>((resolve) => { const id = ++ids; waiting.set(id, resolve); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`); });
  return {
    request,
    async call(tool: string, args: Obj): Promise<{ isError: boolean; value: Obj }> {
      const reply = await request('tools/call', { name: tool, arguments: args });
      return { isError: reply.result?.isError === true, value: JSON.parse(reply.result?.content?.[0]?.text ?? 'null') as Obj };
    },
    close: () => child.stdin.end(),
  };
}

/** A line client of the hub's socket, as the CLI is. */
export async function client(socket: string, token: string): Promise<(method: string, params: object) => Promise<Record<string, unknown>>> {
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

/** A waiter as deep-hook's is: a cli connection that asks `session.wait` and resolves with what the hub hands it. */
export function waiter(root: string, session: string, cwd: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(join(root, 'hub.sock'));
    let got = '';
    let said = 0;
    sock.setEncoding('utf8');
    sock.on('data', (chunk: string) => {
      got += chunk;
      const lines = got.split('\n');
      while (lines.length - 1 > said) {
        const line = JSON.parse(lines[said]!) as Record<string, unknown>;
        said++;
        if ('hello' in line) sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token: readFileSync(join(root, 'control.token'), 'utf8').trim() })}\n`);
        else if (line.role === 'cli') sock.write(`${JSON.stringify({ v: 1, id: 'w1', method: 'session.wait', params: { session, cwd, since: Date.now() } })}\n`);
        else if (line.id === 'w1') { sock.destroy(); if ('error' in line) reject(Error(JSON.stringify(line.error))); else resolve(line.result as Record<string, unknown>); }
      }
    });
    sock.on('error', reject);
  });
}

/** Polls the record until the session has `n` events of `kind`, up to 10 s; the count then. */
export function recorded(root: string, session: string, kind: string, n: number): Promise<number> {
  const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
  const count = () => (db.prepare('SELECT count(*) AS n FROM events WHERE kind = ? AND session_id = ?').get(kind, session) as { n: number }).n;
  return (async () => { try { for (const until = Date.now() + 10_000; Date.now() < until && count() < n; await new Promise((r) => setTimeout(r, 50))); return count(); } finally { db.close(); } })();
}

/** A Claude Code session `id` working in `home`/work, its transcript where Claude Code keeps it, empty. */
export function session(home: string, id: string) {
  const work = join(home, 'work');
  const projects = join(home, '.claude', 'projects', work.replace(/[^a-zA-Z0-9]/g, '-'));
  mkdirSync(work, { recursive: true });
  mkdirSync(projects, { recursive: true });
  const transcript = join(projects, `${id}.jsonl`);
  writeFileSync(transcript, '');
  return { work, transcript, payload: (event: string, extra: Record<string, unknown>) => ({ session_id: id, transcript_path: transcript, cwd: work, hook_event_name: event, ...extra }) };
}
