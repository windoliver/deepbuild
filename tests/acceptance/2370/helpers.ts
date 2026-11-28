import { cpSync, renameSync } from 'node:fs';
import { connect } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import type { ExtensionHost, Installed } from '../../../packages/extension-host/src/index.ts';
import type { Event } from '../../../packages/record/src/index.ts';
import { openHost, openWorld, pkg, report, stamp, tempDir, type World } from '../348/helpers.ts';

export const COUNTER_FIXTURE = fileURLToPath(new URL('./fixtures/counter/', import.meta.url));
export const COUNTER_ROUTES = ['GET /status', 'POST /set'];
export const FOREIGN_HOST = 'example.test';
export const BROWSER_ORIGIN = 'https://example.test';

export type Header = [string, string];
export interface Request { method: string; path: string; headers: Header[]; body?: string }
export interface Answer { status: number; body: string }

export interface Target {
  address: string;
  seen(): Promise<number>;
  events(): Promise<Event[]>;
}
export interface Served extends Target {
  world: World;
  host: ExtensionHost;
  installed: Installed;
  port: string;
}

export async function counterPackage(): Promise<string> {
  const dir = tempDir('pkg-counter');
  cpSync(COUNTER_FIXTURE, dir, { recursive: true });
  renameSync(join(dir, 'index.ts.fixture'), join(dir, 'index.ts'));
  await stamp(dir);
  return dir;
}

async function seenBy(host: ExtensionHost, fixture: 'inbound' | 'counter'): Promise<number> {
  if (fixture === 'inbound') {
    const { hits } = await report<{ hits: Record<string, number> }>(host, 'ext.inbound.report');
    return Object.values(hits).reduce((a, b) => a + b, 0);
  }
  const { seen } = await report<{ seen: Record<string, number> }>(host, 'ext.counter.report');
  return Object.values(seen).reduce((a, b) => a + b, 0);
}

export async function served(fixture: 'inbound' | 'counter', routes: string[]): Promise<Served> {
  const world = await openWorld();
  const host = await openHost(world);
  await host.ready();
  const from = fixture === 'inbound' ? await pkg('inbound') : await counterPackage();
  const installed = await host.install({ from, builtBy: null });
  const checked = await host.check(installed);
  expect(checked.passed, JSON.stringify(checked)).toBe(true);
  const load = await host.load(installed);
  expect(load.status, JSON.stringify(load)).toBe('loaded');
  const { address } = await host.turnOn(installed.id, routes);
  expect(address).toMatch(/^127\.0\.0\.1:\d+$/);
  return {
    world, host, installed, address, port: address.split(':')[1]!,
    seen: () => seenBy(host, fixture),
    events: () => world.events(),
  };
}

export function send(address: string, request: Request): Promise<Answer> {
  const port = Number(address.split(':')[1]);
  const body = request.body ?? '';
  const lines = [`${request.method} ${request.path} HTTP/1.1`, ...request.headers.map(([name, value]) => `${name}: ${value}`)];
  if (request.method !== 'GET' && request.method !== 'HEAD') lines.push(`Content-Length: ${Buffer.byteLength(body)}`);
  lines.push('Connection: close', '', '');
  return new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port });
    const chunks: Buffer[] = [];
    socket.setTimeout(60_000, () => socket.destroy(Error(`no answer from ${address} to ${request.method} ${request.path} in 60 s`)));
    socket.on('data', (chunk: Buffer) => chunks.push(chunk));
    socket.on('error', reject);
    socket.on('close', () => {
      try { resolve(parseAnswer(Buffer.concat(chunks))); } catch (e) { reject(e); }
    });
    socket.write(lines.join('\r\n') + body);
  });
}

function parseAnswer(raw: Buffer): Answer {
  const text = raw.toString('utf8');
  const split = text.indexOf('\r\n\r\n');
  if (split < 0) throw Error(`not an HTTP answer: ${JSON.stringify(text.slice(0, 200))}`);
  const head = text.slice(0, split).split('\r\n');
  const status = /^HTTP\/1\.[01] (\d{3})/.exec(head[0] ?? '');
  if (!status) throw Error(`not an HTTP status line: ${JSON.stringify(head[0])}`);
  const chunked = head.some((line) => /^transfer-encoding:\s*chunked/i.test(line));
  let body = text.slice(split + 4);
  if (chunked) {
    let decoded = '';
    for (let rest = body; ;) {
      const end = rest.indexOf('\r\n');
      const size = parseInt(rest.slice(0, end), 16);
      if (!size) break;
      decoded += rest.slice(end + 2, end + 2 + size);
      rest = rest.slice(end + 2 + size + 2);
    }
    body = decoded;
  }
  return { status: Number(status[1]), body };
}

export function shown(label: string, answer: Answer | number, seen?: number): void {
  const status = typeof answer === 'number' ? answer : answer.status;
  console.log(`${label} -> ${status}${seen === undefined ? '' : `, package count ${seen}`}`);
}
