// Forge HTTP is the outside boundary. Use real local servers and the real archive/record/evidence store.
import { createServer, type RequestListener, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, expect, it } from 'vitest';
import { allEvents, copyText, dataOf, openArchiveOn, openWorld, removeTemps } from '../../../tests/acceptance/20/helpers.ts';

const servers: Server[] = [];
async function listen(handler: RequestListener): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => {
    server.closeAllConnections(); server.close(() => resolve());
  })));
});
afterAll(removeTemps);

it('refuses an off-origin forge redirect before fetching or archiving its answer', async () => {
  let calls = 0;
  const other = await listen((_req, res) => { calls++; res.end('{"workflow_runs":[]}'); });
  const api = await listen((_req, res) => res.writeHead(302, { location: other }).end());
  const w = await openWorld();
  try {
    const archive = await openArchiveOn(w, { forge: { api, repos: ['fixture/repo'] } });
    const result = await archive.pass().then(() => 'completed', () => 'refused');
    expect(calls, 'an ungranted origin is not called').toBe(0);
    expect(result).toBe('refused');
    expect(await allEvents(w.record, ['ci.archived'])).toEqual([]);
  } finally { await w.close(); }
});

it('follows same-origin log redirects but scrubs its own forge credential from evidence', async () => {
  // Synthetic secret deliberately outside pattern matching: protection must be by the injected value.
  const token = 'fixture-archive-credential';
  const received: (string | undefined)[] = [];
  const api = await listen((req, res) => {
    received.push(req.headers.authorization);
    if (req.url?.startsWith('/repos/fixture/repo/actions/runs?')) {
      return res.end(JSON.stringify({ workflow_runs: req.url.includes('page=2') ? [] : [{ id: 1, status: 'completed', conclusion: 'success' }] }));
    }
    if (req.url?.includes('/runs/1/jobs')) return res.end('{"jobs":[{"id":2}]}');
    if (req.url?.endsWith('/jobs/2/logs')) return res.writeHead(302, { location: '/download' }).end();
    res.end(`raw=${token}; encoded=${Buffer.from(token).toString('base64')}; normal output\n`);
  });
  const w = await openWorld({ env: { GH_TOKEN: token } });
  try {
    const archive = await openArchiveOn(w, { forge: { api, repos: ['fixture/repo'] } });
    await archive.pass();
    const events = await allEvents(w.record, ['ci.archived']);
    expect(events).toHaveLength(1);
    const logs = dataOf(events[0]!).logs as { evidence: string }[];
    expect(logs).toHaveLength(1);
    const text = await copyText(w.store, logs[0]!.evidence);
    expect(received.every(value => value === `Bearer ${token}`)).toBe(true);
    expect(text).toContain('normal output');
    expect(text).not.toContain(token);
    expect(text).not.toContain(Buffer.from(token).toString('base64'));
  } finally { await w.close(); }
});
