// State-source reads must not follow a provider to an origin the workspace never named.
import { createServer, type RequestListener, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, it } from 'vitest';
import { sourceOf } from '@deepbuild/workspaces';

const servers: Server[] = [];
async function listen(handler: RequestListener): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => {
    server.closeAllConnections();
    server.close(() => resolve());
  })));
});
it('refuses a redirect to another origin without calling it or returning its state', async () => {
  let calls = 0;
  const other = await listen((_req, res) => { calls++; res.end('{"plan":"unapproved"}'); });
  const api = await listen((_req, res) => res.writeHead(302, { location: other }).end());
  const source = sourceOf({ id: 'account', source: 'api', url: api }, '.')!;
  const result = await Promise.resolve().then(() => source.read()).then(value => ({ value }), error => ({ error }));
  expect(calls, 'only the named origin may be called').toBe(0);
  expect(result).toHaveProperty('error');
});
it('still reads fresh state directly from the named endpoint', async () => {
  let calls = 0;
  const api = await listen((_req, res) => res.end(JSON.stringify({ version: ++calls })));
  const source = sourceOf({ id: 'account', source: 'api', url: api }, '.')!;
  expect(await source.read()).toEqual([{ id: 'version', value: 1 }]);
  expect(await source.read()).toEqual([{ id: 'version', value: 2 }]);
});
