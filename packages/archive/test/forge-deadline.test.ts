// A stalled outside provider must not keep a complete archive pass pending forever.
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, expect, it } from 'vitest';
import { allEvents, openArchiveOn, openWorld, removeTemps } from '../../../tests/acceptance/20/helpers.ts';

afterAll(removeTemps);
it('ends a stalled forge response within its 10-second call budget without archiving it', async () => {
  // Send headers, then never finish the body: the deadline must cover consumption, not just connection setup.
  const server = createServer((_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.write('{'); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const api = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const w = await openWorld();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pass: Promise<string> | undefined;
  try {
    const archive = await openArchiveOn(w, { forge: { api, repos: ['fixture/repo'] } });
    pass = archive.pass().then(() => 'completed', () => 'refused');
    const outcome = await Promise.race([pass, new Promise<string>(resolve => { timer = setTimeout(() => resolve('still pending'), 12_000); })]);
    expect(outcome).toBe('refused');
    expect(await allEvents(w.record, ['ci.archived'])).toEqual([]);
  } finally {
    clearTimeout(timer);
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await pass;
    await w.close();
  }
}, 20_000);
