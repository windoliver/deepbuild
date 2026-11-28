import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { blocked, REPO, tempDir, waitFor, type Hub, type Line, type Step } from '../40/helpers.ts';

export { Client, cleanup, Pi, REPO, startHub, word, type Hub, type Line, type Step } from '../40/helpers.ts';

export const CALLS = 10;
export const HOOK = join(REPO, 'target/debug/deep-hook');
export const callId = (n: number): string => `call_${n}_0`;
export const readSteps = (n: number): Step[] => [...Array.from({ length: n }, (): Step => ({ tools: [{ name: 'read', arguments: { path: 'a.txt' } }] })), { text: 'Done.' }];

export interface Place { home: string; cwd: string; socket: string }
export function place(): Place {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const cwd = join(tmp, 'w');
  mkdirSync(join(home, '.deepbuild'), { recursive: true, mode: 0o700 });
  mkdirSync(cwd);
  writeFileSync(join(cwd, 'a.txt'), 'a\n');
  return { home, cwd, socket: join(home, '.deepbuild/hub.sock') };
}

export function guardKillByName(home: string): Line {
  if (!existsSync(HOOK)) return blocked(`deep-hook isn't built (${HOOK}); run cargo build --locked -p deep-hook`);
  const entry = (JSON.parse(readFileSync(join(REPO, 'crates/deep-hook/default-rules.json'), 'utf8')) as Line).entries['no-kill-by-name'] as Line;
  writeFileSync(join(home, '.deepbuild/rules.json'), JSON.stringify({ v: 1, entries: { 'no-kill-by-name': entry } }));
  writeFileSync(join(home, '.deepbuild/config.json'), JSON.stringify({ hook: { binary: HOOK } }));
  return entry;
}

export async function settle<T>(probe: () => Promise<T | undefined | false> | T | undefined | false, ms: number): Promise<T | undefined> {
  return waitFor(probe, ms, 'a bounded wait').catch(() => undefined);
}

const closers: (() => Promise<void>)[] = [];
export async function closeFakes(): Promise<void> {
  for (const close of closers.splice(0)) await close();
}

async function serve(socket: string, onConnection: (sock: net.Socket) => void): Promise<() => Promise<void>> {
  const socks = new Set<net.Socket>();
  const server = net.createServer((sock) => {
    socks.add(sock);
    sock.on('error', () => undefined);
    sock.on('close', () => socks.delete(sock));
    onConnection(sock);
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socket, resolve); });
  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    for (const sock of socks) sock.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(socket, { force: true });
  };
  closers.push(close);
  return close;
}

export interface Stuck { accepted(): number; close(): Promise<void> }
export async function stuckHub(socket: string): Promise<Stuck> {
  let accepted = 0;
  const close = await serve(socket, (sock) => {
    accepted++;
    sock.resume();
  });
  return { accepted: () => accepted, close };
}

export async function helloOf(hub: Hub): Promise<string> {
  const sock = net.connect(hub.socket);
  sock.on('error', () => undefined);
  let text = '';
  sock.setEncoding('utf8').on('data', (d: string) => (text += d));
  const hello = await waitFor(() => text.includes('\n') && text.slice(0, text.indexOf('\n') + 1), 15_000, "the real hub's hello");
  sock.destroy();
  return hello;
}

export interface Stop { id: string; ackAt: number; holdUntil: number; replyAt?: number }
export interface Holding { stops: Stop[]; requests: Line[]; close(): Promise<void> }
export async function holdingHub(socket: string, hello: string, said: string, replyAfterMs: number, holdMs: number): Promise<Holding> {
  const stops: Stop[] = [];
  const requests: Line[] = [];
  const close = await serve(socket, (sock) => {
    sock.write(hello);
    let buffer = '';
    sock.setEncoding('utf8').on('data', (chunk: string) => {
      buffer += chunk;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        let request: Line | undefined;
        try { request = JSON.parse(buffer.slice(0, i)) as Line; } catch { request = undefined; }
        buffer = buffer.slice(i + 1);
        if (!request || typeof request.agent !== 'string' || typeof request.id !== 'string') continue;
        requests.push(request);
        const reply = (stdout: string): void => { sock.write(`${JSON.stringify({ v: 1, exit: 0, stdout, stderr: '' })}\n`); };
        if (request.event === 'agent_before_settle' && !stops.length) {
          const stop: Stop = { id: request.id, ackAt: Date.now(), holdUntil: Date.now() + holdMs };
          stops.push(stop);
          sock.write(`${JSON.stringify({ v: 1, ack: request.id, hold_until_ms: stop.holdUntil })}\n`);
          setTimeout(() => { // deadline: the hub replies this long after its hold began, as a hub busy with a stop's checks does
            stop.replyAt = Date.now();
            reply(JSON.stringify({ decision: 'block', reason: said }));
          }, replyAfterMs);
          continue;
        }
        sock.write(`${JSON.stringify({ v: 1, ack: request.id, hold_until_ms: null })}\n`);
        reply('');
      }
    });
  });
  return { stops, requests, close };
}

export interface Spooled { text: string; line: Line }
export function spooled(home: string): Spooled[] {
  const dir = join(home, '.deepbuild/spool');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => name.endsWith('.jsonl')).sort().flatMap((name) => readFileSync(join(dir, name), 'utf8').split('\n').filter(Boolean).map((text) => {
    let line: Line = {};
    try { line = JSON.parse(text) as Line; } catch { line = {}; }
    return { text, line };
  }));
}
export const spooledCall = (all: readonly Spooled[], id: string): Spooled[] => all.filter((s) => s.line.agent === 'pi' && s.line.event === 'tool_call' && (s.line.payload as Line | undefined)?.tool_use_id === id);
export const spooledStop = (all: readonly Spooled[]): Spooled[] => all.filter((s) => s.line.agent === 'pi' && s.line.event === 'agent_before_settle');

export function resultText(end: Line): string {
  const content = (end.result as Line | undefined)?.content;
  return Array.isArray(content) ? content.map((part: Line) => String(part.text ?? '')).join('') : JSON.stringify(end.result ?? null);
}
