import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { CALL_MS } from './host-shared.js';
import type { Ext } from './host-types.js';

export interface RouteHost {
  exts: ReadonlyMap<string, Ext>;
  closed(): boolean;
  revoked(ext: Ext): Promise<boolean>;
  ask(ext: Ext, ms: number, what: string, method: string, params: unknown): Promise<unknown>;
}

const BODY = 1024 * 1024;

export async function turnOn(host: RouteHost, id: string, routes: string[]): Promise<{ address: string }> {
  const ext = host.exts.get(id);
  if (!ext?.ask) throw Error(`${id} isn't loaded and running`);
  const untrusted = `${id}'s project is no longer trusted, so it was stopped and not turned on`;
  if (ext.server) throw Error(`${id} is already turned on`);
  for (const route of routes) if (!ext.routes.has(route)) throw Error(`${id} registered no route ${route}`);
  const chosen = new Set(routes);
  const { createServer: createHttpServer } = await import('node:http');
  const server = createHttpServer({ requestTimeout: CALL_MS, connectionsCheckingInterval: 1000 }, (req, res) => void serve(host, ext, chosen, req, res).catch(() => res.destroy()));
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  if (host.closed() || host.exts.get(id) !== ext || !ext.ask || ext.server) {
    await new Promise((resolve) => server.close(resolve));
    throw Error(ext.server ? `${id} is already turned on` : `${id} stopped while it was turned on`);
  }
  ext.server = server;
  if (await host.revoked(ext)) throw Error(untrusted);
  return { address: `127.0.0.1:${(server.address() as AddressInfo).port}` };
}
async function serve(host: RouteHost, ext: Ext, chosen: Set<string>, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const path = (req.url ?? '/').split('?')[0]!;
  const route = `${req.method} ${path}`;
  if (!chosen.has(route) || !ext.ask || (await host.revoked(ext))) {
    req.resume();
    const chosenPath = [...chosen].some((r) => r.slice(r.indexOf(' ') + 1) === path);
    res.writeHead(chosenPath ? 405 : 404).end();
    return;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > BODY) {
      res.writeHead(413, { connection: 'close' }).end();
      req.destroy();
      return;
    }
    chunks.push(chunk as Buffer);
  }
  if (!ext.ask || (await host.revoked(ext))) {
    res.writeHead(404).end();
    return;
  }
  try {
    const request = { method: req.method, path, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') };
    const answer = (await host.ask(ext, CALL_MS, route, 'route', { route, request })) as { status?: unknown; body?: unknown } | null;
    const status = typeof answer?.status === 'number' && answer.status >= 200 && answer.status < 600 ? answer.status : 502;
    res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' }).end(typeof answer?.body === 'string' ? answer.body : '');
  } catch {
    res.writeHead(502).end();
  }
}
export async function turnOff(ext: Ext | undefined): Promise<void> {
  const server = ext?.server;
  if (!ext || !server) return;
  delete ext.server;
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}
