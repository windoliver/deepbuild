import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { expect, it } from 'vitest';
import { nodeHttp, Sources } from '../src/sources.js';

it('#1820 reachability sends no asset request, consumes Source quota and records no invented HTTP status', async () => {
  let bytes = 0;
  const sockets = new Set<import('node:net').Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('data', (chunk) => { bytes += chunk.length; });
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const events: Record<string, unknown>[] = [];
  const source = new Sources({ now: () => 0, http: nodeHttp, secrets: { get: async () => undefined, set: async () => {}, delete: async () => {} }, append: async (_kind, data) => { events.push(data); } });
  const host = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  const decl = { host, secret: null, auth: null, quota: { per_minute: 1, per_day: 10 } };
  try {
    await source.workFetch('fixture', 'ext.fixture.asset', decl, { method: 'CONNECT', path: '/' });
    expect(bytes).toBe(0);
    expect(events).toEqual([{ source: 'ext.fixture.asset', host, outcome: 'answered', ms: expect.any(Number), bytes: 0 }]);
    await expect(source.workFetch('fixture', 'ext.fixture.asset', decl, { method: 'GET', path: '/file' })).rejects.toMatchObject({ until: 60_000 });
    expect(bytes).toBe(0);
    expect(events).toHaveLength(1);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
