import http, { type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { RecordStore } from '../../../packages/record/src/index.ts';
import { ulid } from '../348/helpers.ts';

export interface PlantedHost { address: string; close(): Promise<void> }
type Rule = (request: IncomingMessage, own: string) => number | null;

export const REFUSAL_KIND = 'ext.counter.refused';

const sentByBrowserOrForeign: Rule = (request, own) =>
  request.headers.origin !== undefined || request.headers['sec-fetch-site'] !== undefined || request.headers.host !== own ? 403 : null;

async function plantedHost(target: string, rule: Rule, refused: (status: number) => Promise<void> = async () => undefined): Promise<PlantedHost> {
  const targetPort = Number(target.split(':')[1]);
  let own = '';
  const server = http.createServer((request, response) => {
    const status = rule(request, own);
    if (status !== null) {
      request.resume();
      void refused(status).then(() => response.writeHead(status).end(), () => response.writeHead(500).end());
      return;
    }
    const forwarded = http.request(
      { host: '127.0.0.1', port: targetPort, method: request.method, path: request.url, headers: { ...request.headers, host: target } },
      (answer) => { response.writeHead(answer.statusCode ?? 502, answer.headers); answer.pipe(response); },
    );
    forwarded.on('error', () => response.writeHead(502).end());
    request.pipe(forwarded);
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  own = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    address: own,
    close: () => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); }),
  };
}

export function refusesAnySecFetchHeader(target: string): Promise<PlantedHost> {
  return plantedHost(target, (request, own) =>
    sentByBrowserOrForeign(request, own) ?? (Object.keys(request.headers).some((name) => name.startsWith('sec-fetch-')) ? 403 : null));
}

export function matchesTheRouteFirst(target: string, chosen: string[]): Promise<PlantedHost> {
  return plantedHost(target, (request, own) => {
    const path = (request.url ?? '/').split('?')[0]!;
    if (!chosen.includes(`${request.method} ${path}`)) return chosen.some((route) => route.endsWith(` ${path}`)) ? 405 : 404;
    return sentByBrowserOrForeign(request, own);
  });
}

export function appendsAnEventPerRefusal(target: string, record: RecordStore): Promise<PlantedHost> {
  return plantedHost(target, sentByBrowserOrForeign, async (status) => {
    await record.append({ writer: 'ext:test/counter', actor: 'you', scope: 'you' }, {
      v: 1, id: ulid(), kind: REFUSAL_KIND, ts: Date.now(), data: { key: `refused-${ulid()}`, generation: 1, value: { status }, call: null },
    });
  });
}
