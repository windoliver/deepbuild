// Installed data packs (#1820): immutable manifests and license files, pinned by owner/name@version.
// Downloads and authority live in the library fetch job; this module never calls the network or admits bytes.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { canonicalize, type JsonValue } from '@deepbuild/contracts';

type Obj = Record<string, unknown>;
const object = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const hash = (v: string | Uint8Array) => createHash('sha256').update(v).digest('hex');
const ID = /^[a-z0-9][a-z0-9_-]*\/[a-z0-9][a-z0-9_-]*$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export interface PackAsset {
  path: string; url: string; sha256: string; size: number;
  license: { id: string; terms: string; shareable: boolean; credit: string | null };
  upstream: { url: string; version: string; modified: string };
}
export interface PackVersion { id: string; version: string; ref: string; digest: string; manifest: Obj; assets: PackAsset[] }
const safe = (path: string) => path.length > 0 && !isAbsolute(path) && !path.includes('\\') && path.split('/').every((p) => p !== '..' && p !== '.' && p !== '');
const urlOf = (text: string) => { const u = new URL(text); if (u.protocol !== 'https:' || u.username || u.password || u.hash) throw Error(`asset URL ${text} must be https without credentials or a fragment`); return u; };

/** Reads only files inside the pack, resolving links first. Terms may name a bundled file or an https license. */
function local(from: string, path: string): Buffer {
  if (!safe(path)) throw Error(`pack path ${path} is not relative to the pack`);
  const file = realpathSync(join(from, path));
  const rel = relative(realpathSync(from), file);
  if (!safe(rel)) throw Error(`pack path ${path} leaves its folder`);
  return readFileSync(file);
}
export function readPack(from: string): PackVersion {
  const m: unknown = JSON.parse(readFileSync(join(from, 'pack.json'), 'utf8'));
  if (!object(m) || typeof m.id !== 'string' || !ID.test(m.id) || typeof m.version !== 'string' || !VERSION.test(m.version)) throw Error('pack.json must name owner/name and an exact version');
  const assets: PackAsset[] = [];
  const paths = new Set<string>();
  if (m.assets !== undefined && !Array.isArray(m.assets)) throw Error(`${m.id}: assets must be a list`);
  for (const a of (m.assets ?? []) as unknown[]) {
    if (!object(a) || typeof a.path !== 'string' || !safe(a.path) || paths.has(a.path) || typeof a.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(a.sha256) || !Number.isSafeInteger(a.size) || Number(a.size) < 0) throw Error(`${m.id}: asset ${object(a) ? String(a.path) : ''} needs a unique relative path, sha256 and size`);
    paths.add(a.path);
    if (a.url === undefined) { a.hex = local(from, a.path).toString('hex'); continue; }
    const l = a.license, u = a.upstream;
    if (typeof a.url !== 'string' || !object(l) || typeof l.id !== 'string' || !l.id || typeof l.terms !== 'string' || !l.terms || typeof l.shareable !== 'boolean' || (l.credit !== null && typeof l.credit !== 'string') || !object(u) || typeof u.url !== 'string' || typeof u.version !== 'string' || typeof u.modified !== 'string') throw Error(`${m.id}: ${a.path} needs its URL, license terms and pinned upstream`);
    urlOf(a.url); urlOf(u.url);
    if (/^https:\/\//.test(l.terms)) urlOf(l.terms);
    else l.terms = local(from, l.terms).toString('utf8');
    assets.push(a as unknown as PackAsset);
  }
  if (object(m.recipes)) for (const [key, value] of Object.entries(m.recipes)) if (typeof value === 'string') m.recipes[key] = JSON.parse(local(from, value).toString('utf8')) as unknown;
  return { id: m.id, version: m.version, ref: `${m.id}@${m.version}`, digest: hash(canonicalize(m as JsonValue)), manifest: m, assets };
}

/** Only a copy that passed the canvas pack check is registered. A republished version can't change its bytes. */
export class Packs {
  private readonly held = new Map<string, PackVersion>();
  private readonly folder: string;
  constructor(root: string) {
    this.folder = join(root, 'packs');
    mkdirSync(this.folder, { recursive: true });
    for (const name of readdirSync(this.folder)) if (name.endsWith('.json')) {
      const pack = JSON.parse(readFileSync(join(this.folder, name), 'utf8')) as PackVersion;
      this.held.set(pack.ref, pack);
    }
  }
  get(ref: string): PackVersion | undefined { return this.held.get(ref); }
  named(id: string): boolean { return [...this.held.values()].some((p) => p.id === id); }
  all(): { id: string; dir: string }[] { return [...this.held.values()].map((p) => ({ id: p.id, dir: this.directory(p) })); }
  asset(ref: string, path: string): PackAsset | undefined { return this.held.get(ref)?.assets.find((a) => a.path === path); }
  byHash(refs: unknown, sha: string): { pack: string; asset: PackAsset } | undefined {
    for (const ref of Array.isArray(refs) ? refs : []) if (typeof ref === 'string') {
      const asset = this.held.get(ref)?.assets.find((a) => a.sha256 === sha);
      if (asset) return { pack: ref, asset };
    }
    return undefined;
  }
  /** Assets actually named by a document or a kind's inputs; merely installing a pack fetches none. */
  used(document: Obj): { pack: string; asset: PackAsset }[] {
    const hashes = new Set<string>();
    const visit = (v: unknown): void => {
      if (typeof v === 'string' && /^[0-9a-f]{64}$/.test(v)) hashes.add(v);
      else if (Array.isArray(v)) v.forEach(visit);
      else if (object(v)) Object.values(v).forEach(visit);
    };
    visit(document.assets);
    if (object(document.items)) for (const item of Object.values(document.items)) if (object(item)) { visit(item.params); visit(item.from); }
    const refs = Array.isArray(document.packs) ? document.packs : [];
    return refs.flatMap((ref) => typeof ref === 'string' ? (this.get(ref)?.assets ?? []).filter((a) => hashes.has(a.sha256)).map((asset) => ({ pack: ref, asset })) : []);
  }
  directory(pack: PackVersion): string { return join(this.folder, pack.digest); }
  stage(pack: PackVersion): string {
    const old = this.get(pack.ref);
    if (old && old.digest !== pack.digest) throw Error(`${pack.ref} is pinned to ${old.digest}; publish a new version`);
    const dir = this.directory(pack);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'pack.json'), JSON.stringify(pack.manifest));
    for (const a of (pack.manifest.assets ?? []) as Obj[]) if (typeof a.hex === 'string') {
      const file = join(dir, String(a.path));
      mkdirSync(join(file, '..'), { recursive: true });
      if (!existsSync(file)) writeFileSync(file, Buffer.from(a.hex, 'hex'));
    }
    return dir;
  }
  admit(pack: PackVersion): void {
    const file = join(this.folder, `${hash(pack.ref)}.json`);
    writeFileSync(`${file}.tmp`, JSON.stringify(pack));
    renameSync(`${file}.tmp`, file);
    this.held.set(pack.ref, pack);
  }
}

/** Restrictive terms win over a permissive manifest ID, even after an authority answer or standing rule. */
export function forbiddenLicense(text: string): string | undefined {
  if (/\b(?:A?GPL|L?GPL)(?:v?\d|[-\s]|\b)|GNU\s+(?:Affero\s+|Lesser\s+)?General\s+Public\s+License/i.test(text)) return 'GPL';
  if (/\bNC\b|Non[ -]?Commercial/i.test(text)) return 'NC';
  if (/CC[ -]?BY[ -]?SA|Share[ -]?Alike|\/by-sa\//i.test(text)) return 'CC BY-SA';
  return undefined;
}
