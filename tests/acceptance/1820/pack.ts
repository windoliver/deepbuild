// Fixtures for the #1820 acceptance tests: two data packs whose `assets` list files served by a local HTTPS server (a
// request log, and "offline" as the server closed), the pack folders written with the listed urls, hashes, sizes and
// licenses, and the judges each criterion's test shares. Nothing here reaches past 127.0.0.1.
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

export const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');
const bytesOf = (seed: string, n: number): Buffer => {
  const out = Buffer.alloc(n);
  for (let i = 0, h = createHash('sha256').update(seed).digest(); i < n; i++) { if (i % 32 === 0) h = createHash('sha256').update(h).digest(); out[i] = h[i % 32]!; }
  return out;
};

export interface Lic { id: string; terms: string; shareable: boolean; credit: string | null }
export const CC0: Lic = { id: 'CC0-1.0', terms: 'https://creativecommons.org/publicdomain/zero/1.0/', shareable: true, credit: null };
export const CC_BY: Lic = { id: 'CC-BY-4.0', terms: 'https://creativecommons.org/licenses/by/4.0/', shareable: true, credit: 'Ana Ruiz, Sound Shelf' };
export const CC_BY_SA: Lic = { id: 'CC-BY-SA-4.0', terms: 'https://creativecommons.org/licenses/by-sa/4.0/', shareable: true, credit: 'Lee Park' };
export const CC_BY_NC: Lic = { id: 'CC-BY-NC-4.0', terms: 'https://creativecommons.org/licenses/by-nc/4.0/', shareable: false, credit: 'Lee Park' };
export const GPL: Lic = { id: 'GPL-3.0-only', terms: 'https://www.gnu.org/licenses/gpl-3.0.html', shareable: true, credit: null };

/** A listed asset: what the pack says, and what the server really answers (the bytes differ only in the planted one). */
export interface Asset { path: string; listed: Buffer; served: Buffer; size: number; license: Lic }
const asset = (path: string, n: number, license: Lic): Asset => { const b = bytesOf(path, n); return { path, listed: b, served: b, size: n, license }; };
export const MARKER = 'PLANTED-MISMATCH-MARKER-1820';
const wrong = (path: string, n: number, license: Lic): Asset => {
  const listed = bytesOf(path, n);
  const served = Buffer.concat([Buffer.from(MARKER), bytesOf(`${path}#other`, n - MARKER.length)]);
  return { path, listed, served, size: n, license };
};

export const PACK_A = 'acme/sounds';
export const PACK_A_VERSION = '1.0.0';
export const PACK_B = 'acme/voices';
export const PACK_B_VERSION = '2.0.0';
/** Pack A's assets, by path. `samples/huge.bin` is given its size at world start (see `hugeSize`). */
export const A = {
  kick: asset('samples/kick.wav', 2048, CC0),
  pad: asset('samples/pad.wav', 4096, CC_BY),
  corrupt: wrong('samples/corrupt.wav', 3000, CC0),
  sa: asset('samples/sa.wav', 1500, CC_BY_SA),
  nc: asset('samples/nc.wav', 1600, CC_BY_NC),
  gpl: asset('samples/gpl.wav', 1700, GPL),
  huge: asset('samples/huge.bin', 1024, CC0),
  /** Left unanswered in the "no fetch without an ask" test. */
  hold: asset('samples/hold.wav', 1800, CC0),
  /** Never fetched before the network goes. */
  away: asset('samples/away.wav', 1900, CC_BY),
};
export const B = { voice: asset('voices/voice.bin', 2500, CC0) };
export const everyAsset = (): Asset[] => [...Object.values(A), ...Object.values(B)];

export interface Req { method: string; path: string }
export interface PackServer { host: string; log: Req[]; close(): Promise<void>; since(from: number, path?: string): Req[] }
export async function openPacks(tls: { key: string; cert: string }): Promise<PackServer> {
  const log: Req[] = [];
  const routes = new Map<string, Buffer>();
  for (const [pack, list] of [[PACK_A, Object.values(A)], [PACK_B, Object.values(B)]] as const) for (const a of list) routes.set(`/${pack}/${a.path}`, a.served);
  const server: Server = createServer({ key: tls.key, cert: tls.cert }, (req, res) => {
    const path = new URL(req.url ?? '/', 'https://x.invalid').pathname;
    log.push({ method: req.method ?? '', path });
    req.resume();
    const body = routes.get(path);
    if (req.method !== 'GET' || !body) return void res.writeHead(404).end('not found');
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': body.length, 'accept-ranges': 'bytes' }).end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  let closed = false;
  return {
    host: `127.0.0.1:${(server.address() as AddressInfo).port}`, log,
    since: (from, path) => log.slice(from).filter((r) => !path || r.path.endsWith(path)),
    close: () => (closed ? Promise.resolve() : new Promise<void>((resolve) => { closed = true; server.close(() => resolve()); server.closeAllConnections(); })),
  };
}

/** The url a pack lists for an asset on the server. */
export const urlOf = (host: string, pack: string, a: Asset): string => `https://${host}/${pack}/${a.path}`;

/** Writes a pack folder: `pack.json`, its `assets` listing every file by path, url, sha256, size, license and upstream. */
export function writePack(dir: string, host: string, pack: string, version: string, list: Asset[]): string {
  mkdirSync(dir, { recursive: true });
  const [, name] = pack.split('/');
  writeFileSync(join(dir, 'pack.json'), `${JSON.stringify({
    id: pack, name, version, license: 'MIT', description: `Sample files for the #1820 acceptance tests (${pack}).`, requires: { core: '^1', modules: {} },
    assets: list.map((a) => ({ path: a.path, url: urlOf(host, pack, a), sha256: sha256(a.listed), size: a.size, license: a.license, upstream: { url: urlOf(host, pack, a), version, modified: '2026-01-01T00:00:00Z' } })),
  }, null, 2)}\n`);
  return dir;
}

// ---- Judges: each returns its failures in words, naming the asset, pack or sizes; none is a pass.

/** Every file under a folder whose bytes hold `needle`: where a refused file was kept. */
export function filesHolding(root: string, needle: Buffer): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      let st; try { st = statSync(path); } catch { continue; }
      if (st.isDirectory()) walk(path);
      else if (st.isFile() && st.size < 64 << 20 && readFileSync(path).includes(needle)) found.push(path);
    }
  };
  walk(root);
  return found;
}
/** AC1's judge for a refused mismatch: nothing under the hub's folder holds the served bytes, and the store knows no hash of them. */
export function judgeNotKept(root: string, served: Buffer, storeHas: boolean, assetPath: string): string[] {
  const failures: string[] = [];
  const kept = filesHolding(root, served.subarray(0, 64));
  if (kept.length) failures.push(`${assetPath}'s bytes, which don't match its listed sha256, are still kept: ${kept.join(', ')}`);
  if (storeHas) failures.push(`the evidence store holds the mismatched bytes of ${assetPath} (${sha256(served)})`);
  return failures;
}
/** AC4's judge for a standing rule of one pack: a fetch of another pack's asset made no request before an answered ask. */
export function judgeOtherPack(rule: string, other: string, requests: Req[], askedFor: string[]): string[] {
  const failures: string[] = [];
  if (requests.length) failures.push(`the hub fetched ${requests.map((r) => r.path).join(', ')} of ${other} under the standing rule of ${rule}, with no answered ask`);
  if (!askedFor.some((q) => q.includes(other))) failures.push(`no ask names ${other}, the pack whose asset was fetched; ${rule}'s rule covers only ${rule}`);
  return failures;
}
