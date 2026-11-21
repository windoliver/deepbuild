// What the #1904 acceptance suite doesn't reach: a redirect that stays on the forge's origin is followed as fetch
// follows it, so folding five clients into one changes nothing a caller sees. The forge is a local stand-in.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, it } from 'vitest';
import { forgeFetch } from '../src/index.ts';

interface Seen { method: string; url: string; authorization: string | undefined; type: string | undefined; body: string }
let server: Server | undefined;
afterEach(() => new Promise<void>((done) => { server?.closeAllConnections(); server ? server.close(() => done()) : done(); }));

/** A forge that answers `/from` with `code` to `/to`, and `/to` with 200; what it was asked, in order. */
async function forge(code: number): Promise<{ api: string; seen: Seen[] }> {
  const seen: Seen[] = [];
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => { body += c.toString(); });
    req.on('end', () => {
      seen.push({ method: req.method ?? '', url: req.url ?? '', authorization: req.headers.authorization, type: req.headers['content-type'], body });
      if (req.url === '/from') res.writeHead(code, { location: '/to' }).end();
      else res.writeHead(200, { 'content-type': 'application/json' }).end('{"at":"to"}');
    });
  });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  return { api: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen };
}

it('follows a same-origin 301 on a GET with the token, and returns where it led', async () => {
  const f = await forge(301);
  const res = await forgeFetch(f.api, '/from', { token: 't' });
  expect({ status: res.status, body: await res.json() }).toEqual({ status: 200, body: { at: 'to' } });
  expect(f.seen.map((s) => [s.method, s.url, s.authorization])).toEqual([['GET', '/from', 'Bearer t'], ['GET', '/to', 'Bearer t']]);
});

it.each([[301], [302], [303]])('goes on as a GET without the body after a %i to a POST', async (code) => {
  const f = await forge(code);
  await forgeFetch(f.api, '/from', { method: 'POST', token: 't', body: { a: 1 } });
  expect(f.seen.map((s) => [s.method, s.url, s.type, s.body])).toEqual([['POST', '/from', 'application/json', '{"a":1}'], ['GET', '/to', undefined, '']]);
});

it.each([[307], [308]])('keeps a POST and its body across a %i', async (code) => {
  const f = await forge(code);
  await forgeFetch(f.api, '/from', { method: 'POST', token: 't', body: { a: 1 } });
  expect(f.seen.map((s) => [s.method, s.url, s.type, s.body])).toEqual([['POST', '/from', 'application/json', '{"a":1}'], ['POST', '/to', 'application/json', '{"a":1}']]);
});
