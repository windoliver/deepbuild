// Online model libraries (#1731): asset.library@1's fills, library sources a package registers through
// deep.registerSource, answer deep_kinds asset searches and fetch a picked model, HDRI or texture. The hub makes every
// call: a fill's search and fetch read the library's API through their context's fetch, and the hub downloads every byte
// of a picked asset, so the license, the upstream URL and the bytes reach the evidence store's record together.
//
// A search spans the enabled libraries in one ranked list, as #979 ranks catalog rows (words matched, then size fit),
// each row naming where it came from, and fetches nothing but thumbnails, which it keeps by hash. Offline, it answers
// from the last answer each library gave, stale, with that answer's age. A fetch is the pack fetch's networked job:
// one authority ask naming the library, the bytes and the license, or your standing rule for that library and its
// licenses, which refuses any other license by name. The license is the fill's reading of the library's own record at
// fetch time, kept with the asset; one DeepBuild doesn't know is BLOCKED with one unblock ask, never taken as free, and
// offline a fetch is BLOCKED with one unblock ask. A library ships off: you turn each on once, and off removes it from
// search and refuses its fetches, naming it. An asset.game@1 item may name only a fetched asset, by its file's hash.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { License } from '@deepbuild/evidence';
import type { ExtensionHost } from '@deepbuild/extension-host';
import type { PlanInput } from '@deepbuild/asks';
import { freeBytes } from './disk.js';
import { forbiddenLicense, Packs } from './packs.js';
import { isRecord as isObj } from '@deepbuild/contracts';

type Obj = Record<string, unknown>;
const sha256 = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');
const BUNDLED_TERMS: Record<string, string> = { 'https://creativecommons.org/publicdomain/zero/1.0/': 'CC0-1.0', 'https://creativecommons.org/licenses/by/4.0/': 'CC-BY-4.0' };

export type AssetKind = 'model' | 'hdri' | 'texture';
const KINDS: readonly AssetKind[] = ['model', 'hdri', 'texture'];
/** A license as a library's record states it, read by its fill: an SPDX ID or a LicenseRef, its terms, sharing and credit. */
export interface AssetLicense { id: string; terms: string; shareable: boolean; credit: string | null }
/** One row of a search: the fill's, its thumbnail as the hash the hub keeps it by, and where it came from. */
export interface AssetRow {
  id: string; name: string; kind: AssetKind; license: AssetLicense; size_m: number | null; triangles: number | null;
  thumbnail: string | null; url: string; from: { library: string } | { pack: string }; stale?: true; age_ms?: number;
}
export interface FileRef { path: string; bytes: number; sha256: string }
/** A fetched asset as the store keeps it: its main file's hash, its files, its license and its upstream. */
export interface AssetRecord {
  sha256: string; library?: string; pack?: string; id: string; license: AssetLicense; upstream: { url: string; version: string; modified: string }; files: FileRef[];
}
/** What a fill's fetch answers: the file, its sidecars, the license and the upstream from the library's own record. */
interface Picked { file: FileRef; sidecars: FileRef[]; license: AssetLicense; upstream: AssetRecord['upstream']; pack?: { ref: string; url: string } }

/**
 * The licenses DeepBuild knows the terms of, by SPDX ID. Anything else, a LicenseRef or an ID not listed, is unknown:
 * BLOCKED at fetch until you read its terms and add it to the library's standing rule.
 */
const KNOWN = new Set(['CC0-1.0', 'CC-BY-3.0', 'CC-BY-4.0', 'CC-BY-SA-3.0', 'CC-BY-SA-4.0', 'MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'OFL-1.1', 'Unlicense']);
/** A search's limit, as #979's catalog search caps it. */
export const LIMIT_MAX = 50;
/** The quota each library host's grant carries; the source's own quota, under it, is what the hub counts. */
export const LIBRARY_HOST_QUOTA = { calls: 600, per_ms: 60_000 };
const DAY = 86_400_000;

/** The hosts a package's library sources name (#1731): what its install grants. */
export const libraryHosts = (m: { sources?: { variant?: string; host?: string }[] | undefined }): string[] =>
  [...new Set((m.sources ?? []).filter((s) => s.variant === 'library' && typeof s.host === 'string').map((s) => s.host!))];

export interface LibraryDeps {
  /** The hub's folder: libraries.json keeps which libraries are on, your standing rules and the fetched assets. */
  root: string;
  now(): number;
  host(): Pick<ExtensionHost, 'libraries' | 'libraryCall' | 'libraryFile' | 'assetFile' | 'assetOnline' | 'assetTerms'> | undefined;
  /** Puts bytes in the evidence store as a DeepBuild job's, recorded: their hash. */
  keep(bytes: Uint8Array, kind: string, source: string, license: License): Promise<string>;
  keepFile(file: string, sha256: string, kind: string, source: string, license: License): Promise<string>;
  has(sha256: string): Promise<boolean>;
  /** Raises an ask from one of this module's ask sources: its handle. */
  raise(source: 'library.fetch' | 'library.unblock', ask: Obj, plan?: PlanInput): Promise<string>;
}

type Fetch =
  | { state: 'held'; ask: string; picked: Picked }
  | { state: 'fetching'; ask: string | null }
  | { state: 'fetched'; asset: AssetRecord }
  | { state: 'refused'; reason: string };
export type FetchReply =
  | { status: 'held'; ask: string | null }
  | { status: 'fetched'; asset: AssetRecord }
  | { status: 'refused'; reason: string }
  | { status: 'BLOCKED'; cause: string; ask: string }
  | { status: 'pending'; cause: string; until: number };

interface Saved {
  on: string[]; rules: Record<string, string[]>; assets: Record<string, AssetRecord>;
  packRules?: Record<string, string[]>; cache?: Record<string, AssetRecord>; allowed?: string[]; unblocks?: Record<string, string>;
  held?: Record<string, { ask: string; picked: Picked }>; declined?: Record<string, string>;
}

/** A refusal the caller turns into its own error, with the reason in words. */
export class LibraryRefused extends Error {}

export class Libraries {
  readonly packs: Packs;
  private saved: Saved;
  private readonly pending = new Map<string, Promise<FetchReply>>();
  private readonly allowed = new Set<string>();
  private readonly fetches = new Map<string, Fetch>();
  /** Each authority ask this module raised, by handle: the fetch it holds. */
  private readonly held = new Map<string, string>();
  /** Each unblock ask raised, by its cause's key, so one cause asks once. */
  private readonly unblocks = new Map<string, string>();
  /** The last answer each library gave a search, by library and query: when it came, and its rows. */
  private readonly answers = new Map<string, { at: number; rows: AssetRow[] }>();
  /** Thumbnails kept, by library and path: their hash. */
  private readonly thumbs = new Map<string, string>();

  constructor(private readonly d: LibraryDeps) {
    const file = join(d.root, 'libraries.json');
    this.saved = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as Saved : { on: [], rules: {}, assets: {} };
    this.packs = new Packs(d.root);
    mkdirSync(join(d.root, 'downloads'), { recursive: true });
    for (const key of this.saved.allowed ?? []) this.allowed.add(key);
    for (const [key, ask] of Object.entries(this.saved.unblocks ?? {})) this.unblocks.set(key, ask);
    for (const [key, held] of Object.entries(this.saved.held ?? {})) {
      this.fetches.set(key, { state: 'held', ...held });
      this.held.set(held.ask, key);
    }
    for (const [key, reason] of Object.entries(this.saved.declined ?? {})) this.fetches.set(key, { state: 'refused', reason });
  }
  private save(): void {
    const file = join(this.d.root, 'libraries.json');
    writeFileSync(`${file}.tmp`, `${JSON.stringify(this.saved, null, 2)}\n`);
    renameSync(`${file}.tmp`, file);
  }
  private registered(library: string): boolean {
    return (this.d.host()?.libraries() ?? []).some((l) => l.name === library);
  }

  /** `library.on` and `library.off`: a library ships off; on puts it in search, off takes it out and refuses its fetches. */
  turn(library: string, on: boolean): { library: string; on: boolean } {
    if (on && !this.registered(library)) throw new LibraryRefused(`no loaded package registers the library ${library}`);
    this.saved.on = on ? [...new Set([...this.saved.on, library])] : this.saved.on.filter((l) => l !== library);
    this.save();
    return { library, on };
  }
  /** `library.rule`: your standing rule for a library, the licenses it may fetch under with no ask; any other is refused. */
  rule(library: string, licenses: string[]): { library: string; licenses: string[] } {
    if (!this.registered(library)) throw new LibraryRefused(`no loaded package registers the library ${library}`);
    this.saved.rules[library] = [...new Set(licenses)];
    this.save();
    return { library, licenses: this.saved.rules[library]! };
  }
  private enabled(): string[] {
    const loaded = new Set((this.d.host()?.libraries() ?? []).map((l) => l.name));
    return this.saved.on.filter((l) => loaded.has(l));
  }

  /**
   * A deep_kinds asset search: every enabled library's rows in one list, ranked by words matched, then by size fit
   * (nearest the range's middle), keeping at most `limit`. Installed packs have no catalog to add yet (#979).
   */
  async search(q: { words: string; kind: AssetKind | null; size_m: [number, number] | null; license: string[] | null; limit: number }): Promise<{ rows: AssetRow[] }> {
    const rows: AssetRow[] = [];
    for (const library of this.enabled()) rows.push(...await this.searchOne(library, q));
    const words = q.words.toLowerCase().split(/\s+/).filter(Boolean);
    const matched = (r: AssetRow) => words.filter((w) => r.name.toLowerCase().includes(w)).length;
    const mid = q.size_m ? (q.size_m[0] + q.size_m[1]) / 2 : null;
    const fit = (r: AssetRow) => (mid === null ? 0 : r.size_m === null ? Infinity : Math.abs(r.size_m - mid));
    const ranked = rows.map((r, i) => ({ r, i })).sort((a, b) => matched(b.r) - matched(a.r) || fit(a.r) - fit(b.r) || a.i - b.i).map(({ r }) => r);
    return { rows: ranked.slice(0, q.limit) };
  }
  private async searchOne(library: string, q: Parameters<Libraries['search']>[0]): Promise<AssetRow[]> {
    const host = this.d.host()!;
    const key = `${library}\n${JSON.stringify(q)}`;
    const asked = this.d.now();
    let got: { value: unknown; noAnswer: boolean };
    try {
      got = await host.libraryCall(library, 'search', q);
    } catch (e) {
      if (!(e as { noAnswer?: boolean }).noAnswer) throw new LibraryRefused(`${library}'s search failed: ${e instanceof Error ? e.message : String(e)}`);
      got = { value: null, noAnswer: true };
    }
    if (got.noAnswer) {
      // Offline: the last answer it gave, stale, with that answer's age; nothing when it never answered.
      const last = this.answers.get(key);
      const now = this.d.now();
      return (last?.rows ?? []).map((r) => ({ ...r, stale: true as const, age_ms: now - last!.at }));
    }
    const at = Math.max(asked, this.d.now());
    const listed = isObj(got.value) && Array.isArray(got.value.rows) ? got.value.rows : [];
    const rows: AssetRow[] = [];
    for (const raw of listed.slice(0, q.limit)) {
      const row = rowOf(raw);
      if (!row) continue;
      rows.push({ ...row, thumbnail: await this.thumbnail(library, row), from: { library } });
    }
    this.answers.set(key, { at, rows });
    return rows;
  }
  /** A row's thumbnail, fetched once through the library's source and kept by hash; null when it couldn't be. */
  private async thumbnail(library: string, row: Omit<AssetRow, 'from'>): Promise<string | null> {
    const path = row.thumbnail;
    if (path === null || !path.startsWith('/')) return null;
    const known = this.thumbs.get(`${library}${path}`);
    if (known) return known;
    const got = await this.d.host()!.libraryFile(library, path);
    if (got.status !== 200) return null;
    const sha = await this.d.keep(got.bytes, 'asset.thumbnail', row.url, { name: row.license.id, allows: [] });
    this.thumbs.set(`${library}${path}`, sha);
    return sha;
  }

  /** A pack's standing rule is namespaced apart from libraries, and never matches another pack. */
  packRule(pack: string, licenses: string[]): { pack: string; licenses: string[] } {
    if (!this.packs.named(pack)) throw new LibraryRefused(`no installed pack ${pack}`);
    (this.saved.packRules ??= {})[pack] = [...new Set(licenses)];
    for (const key of Object.keys(this.saved.declined ?? {})) if (key.startsWith(`pack:${pack}@`)) {
      delete this.saved.declined![key];
      this.fetches.delete(key);
    }
    this.save();
    return { pack, licenses };
  }
  /** The first use of one asset in an exact pack version joins its pending job, never a second ask or download. */
  fetchPack(pack: string, path: string): Promise<FetchReply> {
    const key = `pack:${pack}#${path}`;
    const pending = this.pending.get(key);
    if (pending) return pending;
    const task = this.packFetch(pack, path).catch((e: unknown): FetchReply => {
      const until = (e as { until?: number }).until;
      const cause = `${pack}: ${e instanceof Error ? e.message : String(e)}`;
      return typeof until === 'number' ? { status: 'pending', cause, until } : { status: 'refused', reason: cause };
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, task);
    return task;
  }
  private async packFetch(pack: string, path: string): Promise<FetchReply> {
    const ref = this.packs.asset(pack, path);
    if (!ref) return { status: 'refused', reason: `${pack} has no listed asset ${path}; name an installed pack@version and its path` };
    const library = `pack:${pack}`, key = `${library}#${path}`;
    const now = this.fetches.get(key);
    if (now?.state === 'held' || now?.state === 'fetching') return { status: 'held', ask: now.ask };
    if (now?.state === 'refused') return { status: 'refused', reason: now.reason };
    const denied = forbiddenLicense(`${ref.license.id}\n${/^https:\/\//.test(ref.license.terms) ? '' : ref.license.terms}`);
    if (denied) return { status: 'refused', reason: `${pack}: ${path} has forbidden license ${denied} (${ref.license.id}); nothing may use it` };
    const cached = this.saved.cache?.[key];
    if (cached && await this.d.has(cached.sha256)) return { status: 'fetched', asset: cached };
    const free = freeBytes(this.d.root);
    if (BigInt(free) * 5n < BigInt(ref.size) * 11n) return { status: 'refused', reason: `${pack}: ${path} is ${ref.size} bytes and needs 2.2× free; only ${free} bytes free on disk` };
    const urls = [ref.url, ...(/^https:\/\//.test(ref.license.terms) && !BUNDLED_TERMS[ref.license.terms] ? [ref.license.terms] : [])];
    for (const url of urls) if (!await this.d.host()!.assetOnline(pack, url)) return this.offline(library, path);
    const picked: Picked = { file: { path, bytes: ref.size, sha256: ref.sha256 }, sidecars: [], license: ref.license, upstream: ref.upstream, pack: { ref: pack, url: ref.url } };
    return this.authorize(library, path, picked, this.saved.packRules?.[this.packs.get(pack)!.id]);
  }

  /** A deep_kinds fetch of a row a library gave: held on your answer, fetched, refused naming why, or BLOCKED with one unblock ask. */
  async fetch(library: string, id: string): Promise<FetchReply> {
    if (!this.saved.on.includes(library) || !this.registered(library)) {
      const on = this.saved.on.includes(library);
      return { status: 'refused', reason: `${library} is ${on ? 'not loaded' : 'off'}, so nothing is fetched from it; turn it on to fetch ${id}${on ? '' : `: deep library on ${library}, from the person's own terminal`}` };
    }
    const key = `${library}#${id}`;
    const now = this.fetches.get(key);
    if (now?.state === 'held') return { status: 'held', ask: now.ask };
    if (now?.state === 'fetching') return { status: 'held', ask: now.ask };
    if (now?.state === 'fetched' && await this.d.has(now.asset.sha256)) return { status: 'fetched', asset: now.asset };
    const cached = this.saved.cache?.[key];
    if (cached && await Promise.all(cached.files.map((f) => this.d.has(f.sha256))).then((all) => all.every(Boolean))) return { status: 'fetched', asset: cached };
    if (now?.state === 'refused') return { status: 'refused', reason: now.reason };
    let got: { value: unknown; noAnswer: boolean };
    try {
      got = await this.d.host()!.libraryCall(library, 'fetch', { id });
    } catch (e) {
      if (!(e as { noAnswer?: boolean }).noAnswer) return { status: 'refused', reason: `${library}'s fetch of ${id} failed: ${e instanceof Error ? e.message : String(e)}` };
      got = { value: null, noAnswer: true };
    }
    if (got.noAnswer) return this.offline(library, id);
    if (isObj(got.value) && typeof got.value.failed === 'string') return { status: 'refused', reason: `${library} has no ${id} to fetch: ${got.value.failed}` };
    const picked = pickedOf(got.value);
    if (!picked) return { status: 'refused', reason: `${library}'s fetch of ${id} named no file, sidecars, license and upstream as asset.library@1 has them` };
    return this.authorize(library, id, picked, this.saved.rules[library]);
  }
  private async authorize(library: string, id: string, picked: Picked, rule: string[] | undefined): Promise<FetchReply> {
    const key = `${library}#${id}`;
    const license = picked.license.id;
    // An unknown license is never taken as free: BLOCKED until you read its terms and your rule names it.
    if (!KNOWN.has(license) && !rule?.includes(license)) {
      const ask = await this.unblock(`license:${library}#${id}#${license}`, {
        question: `${library} can't fetch ${id}: its license, ${license}, is one DeepBuild doesn't know. Read its terms?`,
        steps: [`Read the license's terms at ${picked.license.terms}`, `If you accept them, add ${license} to ${library}'s standing rule, and fetch ${id} again`],
        where: 'the library\'s site', why: 'an unknown license is never treated as free', proves: `license of ${id}`,
      });
      return { status: 'BLOCKED', cause: `${id}'s license ${license} is unknown`, ask };
    }
    const bytes = [picked.file, ...picked.sidecars].reduce((n, f) => n + f.bytes, 0);
    const ref = sha256(`${library}\n${id}\n${JSON.stringify(picked)}`);
    if (rule || this.allowed.has(ref)) {
      if (rule && !rule.includes(license)) {
        const reason = `${id} from ${library} is under ${license}, which your standing rule for ${library} doesn't allow (it allows ${rule.join(', ') || 'none'}); nothing was fetched`;
        return { status: 'refused', reason };
      }
      this.fetches.set(key, { state: 'fetching', ask: null });
      return this.run(library, id, picked);
    }
    const credit = picked.license.credit ? ` (credit: ${picked.license.credit})` : '';
    const files = 1 + picked.sidecars.length;
    const source = picked.pack ? `${library} (${picked.pack.url}; terms ${picked.license.terms})` : library;
    const question = `Fetch ${id} from ${source}: ${bytes} bytes in ${files} file${files === 1 ? '' : 's'}, under ${license}${credit}?`;
    const ask = await this.d.raise('library.fetch', {
      kind: 'authority', question, options: [{ id: 'fetch', label: 'Fetch it', decision: 'allow' }, { id: 'decline', label: "Don't fetch it", decision: 'deny' }],
      recommended: null, deadline: this.d.now() + DAY, fallback: 'you', default: 'decline', provisional: false, owner: 'you', key: ref, pinned_to: { kind: 'evidence', ref },
    }, { steps: [{ does: `Download ${id} from ${source}, ${bytes} bytes, into the evidence store under ${license}${credit}, then import it`, changes: [`evidence:${picked.file.sha256}`], undo: null, public: false, cost: 0 }], diff: ref });
    this.fetches.set(key, { state: 'held', ask, picked });
    this.held.set(ask, key);
    (this.saved.held ??= {})[key] = { ask, picked };
    this.save();
    return { status: 'held', ask };
  }
  /** Offline: BLOCKED, with one unblock ask for the library, as the pack fetch is. */
  private async offline(library: string, id: string): Promise<FetchReply> {
    const ask = await this.unblock(`offline:${library}`, {
      question: `${library} can't be reached, so ${id} can't be fetched. Connect this machine to the network?`,
      steps: [`Connect to the network so ${library}'s host answers`, `Fetch ${id} again`],
      where: 'this machine', why: `a fetch needs ${library}'s host, which gave no answer`, proves: `${library} reachable`,
    });
    return { status: 'BLOCKED', cause: `${library} can't be reached`, ask };
  }
  private async unblock(cause: string, a: { question: string; steps: string[]; where: string; why: string; proves: string }): Promise<string> {
    const known = this.unblocks.get(cause);
    if (known) return known;
    const ref = sha256(cause);
    const ask = await this.d.raise('library.unblock', {
      kind: 'unblock', question: a.question, options: [{ id: 'done', label: 'I did it', decision: 'none' }], recommended: 'done', default: 'done', deadline: this.d.now() + DAY,
      steps: a.steps, where: a.where, why: a.why, unblocks: [`req:${ref.slice(0, 16)}`], proves: a.proves,
      fallback: 'you', provisional: false, owner: 'you', key: ref, pinned_to: { kind: 'evidence', ref },
    });
    this.unblocks.set(cause, ask);
    (this.saved.unblocks ??= {})[cause] = ask;
    this.save();
    return ask;
  }

  /** Your answer to a fetch's authority ask: true when it was one. A yes runs the job; a no refuses the fetch. */
  answered(ask: string, decision: string): boolean {
    const key = this.held.get(ask);
    if (!key) return false;
    this.held.delete(ask);
    const f = this.fetches.get(key);
    if (f?.state !== 'held') return true;
    delete this.saved.held?.[key];
    if (decision !== 'allow') {
      const reason = `you declined ${ask}, so nothing was fetched`;
      (this.saved.declined ??= {})[key] = reason;
      this.fetches.set(key, { state: 'refused', reason });
      this.save();
      return true;
    }
    const [library, id] = [key.slice(0, key.indexOf('#')), key.slice(key.indexOf('#') + 1)];
    this.allowed.add(sha256(`${library}\n${id}\n${JSON.stringify(f.picked)}`));
    this.saved.allowed = [...this.allowed];
    this.save();
    this.fetches.set(key, { state: 'fetching', ask });
    void this.run(library, id, f.picked).catch((e) => this.fetches.set(key, { state: 'refused', reason: e instanceof Error ? e.message : String(e) }));
    return true;
  }

  /**
   * The networked job: each file downloaded through the library's source, checked against the hash and size the
   * library's record states, imported (a glTF's buffers must be its sidecars), and kept by hash with its license and
   * upstream URL. Only then can an item name it.
   */
  private async run(library: string, id: string, picked: Picked): Promise<FetchReply> {
    const key = `${library}#${id}`;
    const files = [picked.file, ...picked.sidecars];
    const staged: string[] = [];
    try {
      if (picked.pack) {
        // Canonical public licenses ship verbatim, so reading them needs no outside call; arbitrary terms URLs
        // still go through the Source block. A familiar ID never overrides a different file at another URL.
        const standard = BUNDLED_TERMS[picked.license.terms];
        const terms = standard ? readFileSync(new URL(`../licenses/${standard}.txt`, import.meta.url), 'utf8')
          : /^https:\/\//.test(picked.license.terms) ? await this.d.host()!.assetTerms(picked.pack.ref, picked.license.terms) : picked.license.terms;
        const denied = forbiddenLicense(terms);
        if (denied) throw Error(`${id} from ${picked.pack.ref}: license file reads ${denied}; refused before use`);
        const stated = standard ?? (/\bCC0\b/i.test(terms) ? 'CC0-1.0' : /CC[ -]BY[ -]4\.0|Attribution 4\.0 International/i.test(terms) ? 'CC-BY-4.0' : undefined);
        if (stated && stated !== picked.license.id) throw Error(`${id}: license file reads ${stated}, not the listed ${picked.license.id}; publish corrected license metadata before use`);
        if (stated === 'CC-BY-4.0' && !picked.license.credit) throw Error(`${id}: CC-BY-4.0 requires attribution; the pack lists no credit`);
      }
      for (const ref of files) {
        const file = join(this.d.root, 'downloads', `${sha256(`${key}\n${ref.path}\n${ref.sha256}`)}.part`);
        staged.push(file);
        await this.d.host()!.assetFile(picked.pack ? { pack: picked.pack.ref, url: picked.pack.url } : { library, path: ref.path }, { file, sha256: ref.sha256, size: ref.bytes, kept: join(this.d.root, 'evidence', ref.sha256.slice(0, 2), ref.sha256.slice(2)) });
      }
      const imported = picked.file.path.endsWith('.gltf') ? importCheck(picked, [{ ref: picked.file, bytes: await readFile(staged[0]!) }]) : undefined;
      if (imported) throw Error(`${id}'s import refused it: ${imported}; nothing was kept`);
      const license: License = { name: picked.license.id, allows: picked.license.shareable ? ['export', 'report', 'post'] : [] };
      for (let i = 0; i < staged.length; i++) {
        const kept = await this.d.keepFile(staged[i]!, files[i]!.sha256, picked.pack ? 'asset.pack' : 'asset.library', picked.upstream.url, license);
        if (kept !== files[i]!.sha256) throw Error(`${files[i]!.path}: stored bytes no longer match the listed sha256`);
      }
    } catch (e) {
      this.fetches.delete(key);
      if (e instanceof Error && /no answer/.test(e.message)) return this.offline(library, id);
      const until = (e as { until?: number }).until;
      if (typeof until === 'number') return { status: 'pending', cause: `${library}: ${e instanceof Error ? e.message : String(e)}`, until };
      for (const file of staged) await rm(file, { force: true });
      const reason = `${id} from ${library}: ${e instanceof Error ? e.message : String(e)}`;
      this.fetches.set(key, { state: 'refused', reason });
      return { status: 'refused', reason };
    }
    for (const file of staged) await rm(file, { force: true });
    const asset: AssetRecord = { sha256: picked.file.sha256, ...(picked.pack ? { pack: picked.pack.ref } : { library }), id, license: picked.license, upstream: picked.upstream, files };
    if (!asset.pack) this.saved.assets[asset.sha256] = asset;
    (this.saved.cache ??= {})[key] = asset;
    this.save();
    this.fetches.set(key, { state: 'fetched', asset });
    return { status: 'fetched', asset };
  }

  /** A fetched asset by its file's hash, with the license it was kept with; undefined for any other hash. */
  asset(sha: string, pack?: string): AssetRecord | undefined {
    return pack ? Object.values(this.saved.cache ?? {}).find((a) => a.pack === pack && a.sha256 === sha) : this.saved.assets[sha];
  }
}

/** A search row as asset.library@1 has one, or undefined. */
function rowOf(v: unknown): Omit<AssetRow, 'from'> | undefined {
  if (!isObj(v)) return undefined;
  const license = licenseOf(v.license);
  const num = (n: unknown) => n === null || n === undefined ? null : typeof n === 'number' && Number.isFinite(n) ? n : undefined;
  const size = num(v.size_m);
  const triangles = num(v.triangles);
  if (typeof v.id !== 'string' || typeof v.name !== 'string' || !KINDS.includes(v.kind as AssetKind) || !license || size === undefined || triangles === undefined || typeof v.url !== 'string') return undefined;
  return { id: v.id, name: v.name, kind: v.kind as AssetKind, license, size_m: size, triangles, thumbnail: typeof v.thumbnail === 'string' ? v.thumbnail : null, url: v.url };
}
function licenseOf(v: unknown): AssetLicense | undefined {
  if (!isObj(v) || typeof v.id !== 'string' || !v.id || typeof v.terms !== 'string' || typeof v.shareable !== 'boolean' || (v.credit !== null && typeof v.credit !== 'string')) return undefined;
  return { id: v.id, terms: v.terms, shareable: v.shareable, credit: v.credit as string | null };
}
function fileOf(v: unknown): FileRef | undefined {
  return isObj(v) && typeof v.path === 'string' && v.path.startsWith('/') && Number.isSafeInteger(v.bytes) && typeof v.sha256 === 'string' && /^[0-9a-f]{64}$/.test(v.sha256)
    ? { path: v.path, bytes: v.bytes as number, sha256: v.sha256 } : undefined;
}
function pickedOf(v: unknown): Picked | undefined {
  if (!isObj(v)) return undefined;
  const file = fileOf(v.file);
  const sidecars = Array.isArray(v.sidecars) ? v.sidecars.map(fileOf) : [];
  const license = licenseOf(v.license);
  const u = v.upstream;
  if (!file || sidecars.some((s) => !s) || !license || !isObj(u) || typeof u.url !== 'string' || typeof u.version !== 'string' || typeof u.modified !== 'string') return undefined;
  return { file, sidecars: sidecars as FileRef[], license, upstream: { url: u.url, version: u.version, modified: u.modified } };
}
/** The import's check of a glTF (#435's, in its smallest form): it parses, and every buffer it names is one of its sidecars. */
function importCheck(picked: Picked, got: { ref: FileRef; bytes: Uint8Array }[]): string | undefined {
  if (!picked.file.path.endsWith('.gltf')) return undefined;
  let doc: unknown;
  try {
    doc = JSON.parse(Buffer.from(got[0]!.bytes).toString('utf8'));
  } catch {
    return `${basename(picked.file.path)} isn't glTF JSON`;
  }
  const buffers = isObj(doc) && Array.isArray(doc.buffers) ? doc.buffers : [];
  const sidecars = new Set(picked.sidecars.map((s) => basename(s.path)));
  const missing = buffers.map((b) => (isObj(b) ? b.uri : undefined)).filter((uri) => typeof uri === 'string' && !uri.startsWith('data:') && !sidecars.has(basename(uri)));
  return missing.length ? `its buffers ${missing.join(', ')} aren't among its sidecars` : undefined;
}
