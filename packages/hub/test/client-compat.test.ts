// The deep commands check the hub's hello before any call (#41): a hub on an older contract, or one whose hello
// names none, is one screen naming the hub as older and its fix, and the client sends it nothing.
import { mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { call } from '../src/client.js';
import { CONTRACT } from '../src/wire.js';

let dir = '';
let server: net.Server | undefined;
afterEach(async () => {
  await new Promise((done) => (server ? server.close(done) : done(undefined)));
  rmSync(dir, { recursive: true, force: true });
});

/** A socket that greets with `hello`, answers the client's hello and its call, and keeps every line it was sent. */
async function standIn(hello: Record<string, unknown>): Promise<{ path: string; sent: string[] }> {
  dir = mkdtempSync(join(tmpdir(), 'client-compat-'));
  const path = join(dir, 'hub.sock');
  const sent: string[] = [];
  server = net.createServer((sock) => {
    sock.setEncoding('utf8');
    sock.on('error', () => undefined);
    sock.write(`${JSON.stringify({ v: 1, ...hello })}\n`);
    sock.on('data', (chunk: string) => {
      for (const line of chunk.split('\n').filter(Boolean)) {
        sent.push(line);
        const value = JSON.parse(line) as Record<string, unknown>;
        if ('hello' in value) sock.write(`${JSON.stringify({ v: 1, role: 'cli' })}\n`);
        else sock.write(`${JSON.stringify({ v: 1, id: value.id, result: { ok: true } })}\n`);
      }
    });
  });
  await new Promise<void>((done) => server!.listen(path, done));
  return { path, sent };
}

it('refuses a hub whose hello names no contract with one screen naming the hub as older, and sends it nothing', async () => {
  const hub = await standIn({ hello: 'deep-hub', start: 'x', features: [] });
  await expect(call(hub.path, 'token', 'status.read', {})).rejects.toThrow(/hub is older[\s\S]*Update DeepBuild/);
  expect(hub.sent).toEqual([]);
});

it('refuses a hub on an older contract, naming both versions', async () => {
  const hub = await standIn({ hello: 'deep-hub', start: 'x', contract: '0.9', features: [] });
  await expect(call(hub.path, 'token', 'status.read', {})).rejects.toThrow(new RegExp(`0\\.9[\\s\\S]*${CONTRACT.replace('.', '\\.')}`));
  expect(hub.sent).toEqual([]);
});

it('calls a hub on its own contract', async () => {
  const hub = await standIn({ hello: 'deep-hub', start: 'x', contract: CONTRACT, features: [] });
  await expect(call(hub.path, 'token', 'status.read', {})).resolves.toEqual({ result: { ok: true } });
  expect(hub.sent.map((l) => (JSON.parse(l) as { method?: string }).method)).toContain('status.read');
});
