// Supplemental #1820 world (scope/): a pack server that can serve license files, truncate a first download, and answer
// Range requests honestly, wrongly or not at all; packs installed with `deep install`. Imports the existing 1820 and 1731
// helpers read-only. Nothing leaves 127.0.0.1.
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import { afterAll } from 'vitest';
import { CLI, NODE, openWorld, type Ran, type World } from '../../1731/helpers.ts';
import type { Lic } from '../pack.ts';

export const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');
export function bytes(seed: string, n: number): Buffer {
  const out = Buffer.alloc(n);
  for (let i = 0, h = createHash('sha256').update(seed).digest(); i < n; i++) { if (i % 32 === 0) h = createHash('sha256').update(h).digest(); out[i] = h[i % 32]!; }
  return out;
}

export interface Req { method: string; path: string; range?: string }
export type RangeMode = 'honor' | 'ignore' | 'corrupt';
export interface Route { body: Buffer; truncateFirstAt?: number; range?: RangeMode }
export interface Srv { host: string; log: Req[]; routes: Map<string, Route>; close(): Promise<void>; since(from: number): Req[] }
const closers: (() => Promise<void>)[] = [];
afterAll(async () => { for (const c of closers.splice(0)) await c().catch(() => undefined); }, 30_000);

export async function serve(tls: { key: string; cert: string }): Promise<Srv> {
  const log: Req[] = []; const routes = new Map<string, Route>(); const hit = new Set<string>();
  const server = createServer({ key: tls.key, cert: tls.cert }, (req, res) => {
    const path = new URL(req.url ?? '/', 'https://x.invalid').pathname;
    const range = typeof req.headers.range === 'string' ? req.headers.range : undefined;
    log.push({ method: req.method ?? '', path, ...(range ? { range } : {}) });
    req.resume();
    const r = routes.get(path);
    if (req.method !== 'GET' || !r) return void res.writeHead(404).end('not found');
    const start = range ? Number(/bytes=(\d+)-/.exec(range)?.[1] ?? 0) : 0;
    if (range && r.range !== 'ignore' && start > 0) {
      let part = r.body.subarray(start);
      if (r.range === 'corrupt') part = Buffer.concat([Buffer.from('PLANTED-SPLICE-1820'), part.subarray(19)]);
      return void res.writeHead(206, { 'content-length': part.length, 'content-range': `bytes ${start}-${r.body.length - 1}/${r.body.length}`, 'accept-ranges': 'bytes' }).end(part);
    }
    if (r.truncateFirstAt !== undefined && !hit.has(path)) {
      hit.add(path);
      res.writeHead(200, { 'content-length': r.body.length, 'accept-ranges': 'bytes' });
      res.write(r.body.subarray(0, r.truncateFirstAt), () => setTimeout(() => req.socket.destroy(), 50));
      return;
    }
    res.writeHead(200, { 'content-length': r.body.length, 'accept-ranges': 'bytes' }).end(r.body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  let closed = false;
  const srv: Srv = {
    host: `127.0.0.1:${(server.address() as AddressInfo).port}`, log, routes, since: (from) => log.slice(from),
    close: () => (closed ? Promise.resolve() : new Promise<void>((resolve) => { closed = true; server.close(() => resolve()); server.closeAllConnections(); })),
  };
  closers.push(() => srv.close());
  return srv;
}

export interface Listed { path: string; body: Buffer; license: Lic; /** text of the license file served at `terms` and beside the asset */ licenseText: string }
export const LICENSE_TEXT = {
  cc0: 'CC0 1.0 Universal Public Domain Dedication. The person who associated a work with this deed has dedicated the work to the public domain.',
  sa: 'Creative Commons Attribution-ShareAlike 4.0 International Public License. Licensed under CC BY-SA 4.0.',
  nc: 'Creative Commons Attribution-NonCommercial 4.0 International Public License. Licensed under CC BY-NC 4.0.',
  gpl: 'GNU GENERAL PUBLIC LICENSE Version 3, 29 June 2007. Licensed under the GPL-3.0.',
};
/** Where a license file may live: the listing's `terms` url, or beside the asset. All three serve the same text. */
export const licensePaths = (pack: string, a: { path: string }, tag: string): string[] => [`/terms/${tag}`, `/${pack}/${dirname(a.path)}/LICENSE`, `/${pack}/${a.path}.license`];
export const isLicenseRead = (r: Req, pack: string, a: { path: string }, tag: string) => licensePaths(pack, a, tag).includes(r.path);
/** The server's path root for a pack version: urls are per version, so two versions may list one path with other bytes. */
export const root = (pack: string, version: string) => `${pack}@${version}`;

export function addAsset(srv: Srv, pack: string, version: string, a: Listed, tag: string, range?: RangeMode, truncateFirstAt?: number): void {
  srv.routes.set(`/${root(pack, version)}/${a.path}`, { body: a.body, ...(range ? { range } : {}), ...(truncateFirstAt !== undefined ? { truncateFirstAt } : {}) });
  for (const p of licensePaths(root(pack, version), a, tag)) srv.routes.set(p, { body: Buffer.from(a.licenseText) });
}
export function writePack(dir: string, srv: Srv, pack: string, version: string, list: { a: Listed; tag: string }[]): string {
  mkdirSync(dir, { recursive: true });
  const url = (a: Listed) => `https://${srv.host}/${root(pack, version)}/${a.path}`;
  writeFileSync(join(dir, 'pack.json'), `${JSON.stringify({
    id: pack, name: pack.split('/')[1], version, license: 'MIT', description: `#1820 supplemental pack ${pack}.`, requires: { core: '^1', modules: {} },
    assets: list.map(({ a, tag }) => ({ path: a.path, url: url(a), sha256: sha(a.body), size: a.body.length, license: { ...a.license, terms: `https://${srv.host}/terms/${tag}` }, upstream: { url: url(a), version, modified: '2026-01-01T00:00:00Z' } })),
  }, null, 2)}\n`);
  return dir;
}

export function install(w: World, dir: string): Promise<Ran> {
  return new Promise((resolve) => {
    const env: NodeJS.ProcessEnv = {};
    for (const [k, v] of Object.entries(process.env)) if (!/^(DEEP_|XDG_|CLAUDE|CODEX|ANTHROPIC_|OPENAI_|GH_|GITHUB_|NODE_OPTIONS|NODE_EXTRA_CA_CERTS)/.test(k)) env[k] = v;
    const child = spawn(NODE, [CLI, 'install', dir], { cwd: w.work, env: { ...env, HOME: w.home, XDG_CONFIG_HOME: join(w.home, '.config'), PATH: `${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`, LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), 300_000);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

export interface Scoped extends World { srv: Srv }
/** A hub with a server; callers add assets, write packs and `installOrBlock` them. */
export async function scopedWorld(): Promise<Scoped> {
  const w = await openWorld();
  const tls = { key: readFileSync(join(w.tmp, 'tls', 'leaf.key'), 'utf8'), cert: readFileSync(join(w.tmp, 'tls', 'leaf.pem'), 'utf8') };
  return Object.assign(w, { srv: await serve(tls) });
}
export async function installOrBlock(w: World, dir: string): Promise<void> {
  const r = await install(w, dir);
  if (r.code !== 0) throw Error(`BLOCKED: deep install of a url-listed pack did not install it (no such route at base): exit ${r.code}, ${r.stdout.slice(-500)} ${r.stderr.slice(-500)}`);
}
