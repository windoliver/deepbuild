// The fixture library source of #3525's redrafted tests: one model, #1731's CC0 `pine-chair` (its record, its glTF
// with the .bin sidecar and its thumbnail, the same bytes #1731's library.ts makes), served over HTTPS on 127.0.0.1
// with #1731's API (/api/search, /api/assets/<id>, /thumbs/<id>.png, /files/...), which #1731's fill
// (fixtures/shelf) reads. Every request that reaches it is kept in `log`, in order.
import { createServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import { asset, wordsOf, type Asset } from '../1731/library.ts';

/** The one model the library serves, and the library's name as the fill registers it. */
export const MODEL = 'pine-chair';
export const LIB = 'ext.shelf.library';
const ONE: Asset = asset(MODEL);
/** The model's files as its record lists them: path, bytes and SHA-256. */
export const MODEL_FILES = ONE.record.files;

export interface Request { method: string; path: string }
export interface Library { host: string; log: Request[]; close(): Promise<void> }

export async function openLibrary(tls: { key: string; cert: string }): Promise<Library> {
  const log: Request[] = [];
  const server: Server = createServer({ key: tls.key, cert: tls.cert }, (req, res) => {
    const url = new URL(req.url ?? '/', 'https://library.invalid');
    log.push({ method: req.method ?? '', path: `${url.pathname}${url.search}` });
    req.resume();
    const send = (status: number, type: string, body: Buffer | string) => res.writeHead(status, { 'content-type': type, 'content-length': Buffer.byteLength(body) }).end(body);
    if (req.method !== 'GET') return send(405, 'text/plain', 'GET only');
    if (url.pathname === '/api/search') {
      const words = (url.searchParams.get('q') ?? '').toLowerCase().split(/\s+/).filter(Boolean);
      const type = url.searchParams.get('type');
      const hit = (!type || ONE.record.type === type) && words.every((w) => wordsOf(ONE.record).has(w));
      const { files: _files, ...entry } = ONE.record;
      return send(200, 'application/json', JSON.stringify({ total: hit ? 1 : 0, results: hit ? [entry] : [] }));
    }
    if (url.pathname === `/api/assets/${MODEL}`) return send(200, 'application/json', JSON.stringify(ONE.record));
    if (url.pathname === `/thumbs/${MODEL}.png`) return send(200, 'image/png', ONE.thumbnail);
    const bytes = ONE.files.get(url.pathname);
    if (bytes) return send(200, url.pathname.endsWith('.gltf') ? 'model/gltf+json' : 'application/octet-stream', bytes);
    return send(404, 'text/plain', 'not found');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const host = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  let closed = false;
  return {
    host, log,
    close: () => (closed ? Promise.resolve() : new Promise<void>((resolve) => { closed = true; server.close(() => resolve()); server.closeAllConnections(); })),
  };
}
