// Test-side tools for the #2892 acceptance tests (README: The surface under test). The lab, its web export, the
// browser and probe() are #172's (../172/helpers.ts, read only); this file adds what #2892's criteria read that #172's
// helpers don't: the receipt's stored and inflated bytes, a server that logs the bytes of body it sends (one that
// sends every file as stored and one that compresses as it sends), a first visit in a fresh Chrome profile with its
// cache on, the page's memory while it loads, a gzip stream that inflates to 1 GiB, the `ship` call, the merge base's
// deep-show built from `git archive`, and clean-home exports on this Mac and on a Linux aarch64 host. Nothing here
// stands in for the export, the bundle, the player or the ship checks: every value a test compares comes from
// `deep-show`, the files the export wrote, the servers' logs or the browser, and every expected value from the issue.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip, gunzipSync } from 'node:zlib';
import { expect } from 'vitest';
import {
  CHROME, Chrome, DOC, FULL, REPO, TIMEOUT, arr, blocked, filesUnder, hex64, int, labDoc, labTrack, obj, present, presented, rng,
  scenarioOf, sha256, show, str, webExport, webReceiptOf, type JsonObject, type JsonValue, type Tab, type WebReceipt,
} from '../172/helpers.ts';

/** Each criterion's ID: `#2892.` and the first 8 hex digits of the SHA-256 of its text (scripts/proof-change.mjs,
 * `criterionId`, from the live issue). Criterion 3's test is #172's blind redraft, `../172-redraft-ac4/`. */
export const AC = {
  1: 'AC1 #2892.8cdf43e0',
  2: 'AC2 #2892.bce8437b',
  4: 'AC4 #2892.667e03e0',
  5: 'AC5 #2892.79918bc3',
  6: 'AC6 #2892.f22eb452',
  7: 'AC7 #2892.95bb7e98',
  8: 'AC8 #2892.d7212061',
} as const;

// ---------------------------------------------------------------------------------------------------
// The issue's numbers, each in one constant with the text it comes from, so a re-drafted number changes one line.

/** The decision recorded in the issue (comment of 2026-11-19: "**Decision (2026-11-19): gzip.**"). */
export const DECIDED: 'gzip' | 'brotli' = 'gzip';
/** AC2 (re-drafted 2026-11-21): "puts at most 11,976,000 B of player on the wire with gzip (drafted from 11,907,342 B
 * on main at `5f5791e2d`: the WebAssembly's 11,778,841 B at level 9 and the page glue's 128,501 B as it is)". */
export const PLAYER_ON_WIRE_GZIP = 11_976_000;
/** AC2: "or at most 8,121,000 B with Brotli, the glue and the inflater included (drafted from 7,639,854 B)". */
export const PLAYER_ON_WIRE_BROTLI = 8_121_000;
/** The ceiling of the decided form. */
export const PLAYER_ON_WIRE = DECIDED === 'gzip' ? PLAYER_ON_WIRE_GZIP : PLAYER_ON_WIRE_BROTLI;
/** AC4: "differs by under 2% in bytes on the wire". */
export const COMPRESSING_APART = 0.02;
/** AC6: "A stored file changed so that it would inflate to 1 GiB". */
export const BOMB_INFLATED = 1024 ** 3;
/** AC6: "with the page's memory under 64 MB above where it stood" (MB as the issue's other sizes: 1,000,000 B). */
export const MEMORY_RISE = 64_000_000;
/** AC8: "the lab reaches its first frame within #172's 3 s". */
export const FIRST_FRAME_MS = 3_000;

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

// ---------------------------------------------------------------------------------------------------
// git, with nothing in its environment that points it at another repository or work tree

export function gitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('GIT_')) delete env[k];
  return env;
}
export function git(args: string[], what: string): string {
  const r = spawnSync('git', args, { cwd: REPO, env: gitEnv(), encoding: 'utf8', maxBuffer: 1 << 30 });
  expect(r.status, `${what}: git ${args.join(' ')}: ${(r.stderr ?? '').slice(-800)}`).toBe(0);
  return r.stdout;
}
/** The change's merge base with main, as #172's budgets read it. */
export const mergeBase = (): string => git(['merge-base', 'HEAD', 'origin/main'], 'the merge base').trim();

// ---------------------------------------------------------------------------------------------------
// The receipt's stored and inflated bytes (README: The receipt)

/** A bundle file as the receipt gives it: `sha256` and `bytes` are its stored bytes' (as at the base); a file the bundle
 * stores compressed also carries `inflated: {bytes, sha256}`, the bytes it inflates to and their SHA-256. */
export interface Stored { path: string; sha256: string; stored: number; inflated: number; inflatedSha: string; compressed: boolean; raw: JsonObject }
export function storedOf(f: WebReceipt['files'][number], what: string): Stored {
  const at = `${what}: the receipt's file ${f.path}`;
  const stored = int(f.raw['bytes'], `${at}: bytes (its stored bytes)`);
  const inf = f.raw['inflated'];
  if (inf === undefined || inf === null) return { path: f.path, sha256: f.sha256, stored, inflated: stored, inflatedSha: f.sha256, compressed: false, raw: f.raw };
  const o = obj(inf, `${at}: inflated`);
  return { path: f.path, sha256: f.sha256, stored, inflated: int(o['bytes'], `${at}: inflated.bytes`), inflatedSha: hex64(o['sha256'], `${at}: inflated.sha256`), compressed: true, raw: f.raw };
}
export const storedFiles = (r: WebReceipt, what: string): Stored[] => r.files.map((f) => storedOf(f, what));
/** The receipt's player file: the one whose stored or inflated SHA-256 is `player.hash` (found by the receipt, never
 * by a file's first bytes). */
export function playerFile(r: WebReceipt, what: string): Stored {
  const p = storedFiles(r, what).find((f) => f.sha256 === r.player.hash || f.inflatedSha === r.player.hash);
  expect(p, `${what}: the receipt names the player ${r.player.hash} as one of its files, by its stored or its inflated SHA-256`).toBeTruthy();
  return p!;
}
export const isGzip = (b: Uint8Array): boolean => b.length >= 18 && b[0] === 0x1f && b[1] === 0x8b && b[2] === 0x08;
const isWasm = (b: Uint8Array): boolean => b.length >= 8 && b[0] === 0 && b[1] === 0x61 && b[2] === 0x73 && b[3] === 0x6d;
/** A stored file's bytes inflated in the decided form, or the reason they don't inflate. */
export function inflated(b: Buffer): Buffer | string {
  try { return gunzipSync(b, { maxOutputLength: 2 ** 31 - 1 }); } catch (e) { return (e as Error).message; }
}
/** Every file the receipt names is on disk with its stored SHA-256 and byte count, and every file on disk is named.
 * (#172's bundleFailures also holds the player's hash to a stored file's; this one finds the player by either.) */
export function diskFailures(out: string, r: WebReceipt, what: string): string[] {
  const f: string[] = [];
  const disk = filesUnder(out);
  for (const x of storedFiles(r, what)) {
    const b = disk.get(x.path);
    if (!b) f.push(`${what}: ${x.path} is named by the receipt but not in the bundle`);
    else if (sha256(b) !== x.sha256 || b.length !== x.stored) f.push(`${what}: ${x.path} is ${b.length} B hashing to ${sha256(b)}; the receipt gives ${x.stored} B and ${x.sha256}`);
  }
  const named = new Set(r.files.map((x) => x.path));
  for (const p of disk.keys()) if (!named.has(p)) f.push(`${what}: ${p} is in the bundle but the receipt doesn't name it`);
  if (!disk.has('index.html')) f.push(`${what}: the bundle has no index.html`);
  return f;
}
/** Each file the receipt marks as stored compressed is, on disk, a gzip stream that inflates to the receipt's inflated
 * bytes and SHA-256. Each failure names the file. */
export function inflatedFailures(out: string, r: WebReceipt, what: string): string[] {
  const f: string[] = [];
  for (const x of storedFiles(r, what).filter((s) => s.compressed)) {
    const b = readFileSync(join(out, x.path));
    if (!isGzip(b)) { f.push(`${what}: ${x.path} is marked stored compressed but isn't a gzip stream`); continue; }
    const i = inflated(b);
    if (typeof i === 'string') f.push(`${what}: ${x.path} doesn't inflate: ${i}`);
    else if (i.length !== x.inflated || sha256(i) !== x.inflatedSha) f.push(`${what}: ${x.path} inflates to ${i.length} B hashing to ${sha256(i)}; the receipt gives ${x.inflated} B and ${x.inflatedSha}`);
  }
  return f;
}
/** The bundle stores the player's WebAssembly compressed in the decided form: the receipt gives its inflated bytes, its
 * stored bytes are a gzip stream, and they inflate to WebAssembly whose SHA-256 the receipt gives. The precondition of
 * every criterion that reads a stored file (at the base the player is stored as it is). */
export function storedPlayerFailures(out: string, r: WebReceipt, what: string): string[] {
  const p = playerFile(r, what);
  if (!p.compressed) return [`${what}: the player ${p.path} is stored as it is (${p.stored} B): the receipt gives it no inflated bytes`];
  const b = readFileSync(join(out, p.path));
  if (!isGzip(b)) return [`${what}: the player ${p.path} is marked stored compressed, but its bytes aren't a gzip stream`];
  const i = inflated(b);
  if (typeof i === 'string') return [`${what}: the player ${p.path} doesn't inflate: ${i}`];
  if (!isWasm(i)) return [`${what}: the player ${p.path} inflates to bytes that aren't WebAssembly`];
  if (sha256(i) !== p.inflatedSha) return [`${what}: the player ${p.path} inflates to ${sha256(i)}, the receipt gives ${p.inflatedSha}`];
  return [];
}

/** The scripts the index page loads: the modules its import map names (the page glue), the `src` of each script element
 * (the element's script) and each inline script's text but the bundle's JSON. Paths relative to the bundle. */
export interface IndexScripts { importMap: string[]; src: string[]; inline: string[] }
export function indexScripts(out: string): IndexScripts {
  const html = readFileSync(join(out, 'index.html'), 'utf8');
  const clean = (u: string): string => u.replace(/^\.?\//, '');
  const s: IndexScripts = { importMap: [], src: [], inline: [] };
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = m[1] ?? ''; const body = m[2] ?? '';
    const src = /\bsrc="([^"]+)"/.exec(attrs)?.[1];
    const type = /\btype="([^"]+)"/.exec(attrs)?.[1] ?? '';
    if (src) s.src.push(clean(src));
    else if (type === 'importmap') {
      const map = JSON.parse(body) as { imports?: Record<string, string> };
      for (const v of Object.values(map.imports ?? {})) s.importMap.push(clean(v));
    } else if (type !== 'application/json' && body.trim()) s.inline.push(body);
  }
  return s;
}

// ---------------------------------------------------------------------------------------------------
// The test servers (README: The test servers). A child process of its own, as #172's, since `deep-show run` under
// spawnSync blocks this process's event loop. It serves the folder as a static host does (the index page with
// no-cache, every other file with a max-age of a year, no cross-origin isolation headers) and logs one JSON line per
// response: when the request arrived, its status and path, the bytes of body sent, the content encoding sent (null for
// none), the SHA-256 of the file as stored, and when the response was sent. `stored` sends every file as stored with
// no content encoding; `compressing` compresses every body as it sends it, Brotli at quality 5 to a request that
// accepts br, else gzip at level 6 to one that accepts gzip. Given a path to hold, it holds its response to the first
// request for that path for the time given (the page's memory, below). `/.canary` answers a blank page, unlogged.

const SERVER = `
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto'), zlib = require('zlib');
const [root, log, mode, holdPath, holdMs] = process.argv.slice(1);
let held = false;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg' };
const s = http.createServer((q, r) => {
  const at = Date.now();
  const url = decodeURIComponent((q.url || '/').split('?')[0].split('#')[0]);
  if (url === '/.canary') { r.setHeader('content-type', 'text/html'); r.end('<!doctype html><title>canary</title>'); return; }
  const rel = url === '/' ? 'index.html' : url.replace(/^\\/+/, '');
  const file = path.resolve(root, rel);
  const line = (o) => fs.appendFileSync(log, JSON.stringify({ at, sent: Date.now(), path: rel, accept: q.headers['accept-encoding'] || null, ...o }) + '\\n');
  let stored = null;
  if (file.startsWith(path.resolve(root) + path.sep)) { try { stored = fs.readFileSync(file); } catch {} }
  if (!stored) { line({ status: 404, bytes: 0, encoding: null, sha: null }); r.statusCode = 404; r.setHeader('content-length', '0'); r.end(); return; }
  let type = types[path.extname(file)] || 'application/octet-stream';
  if (stored.length >= 4 && stored[0] === 0 && stored[1] === 0x61 && stored[2] === 0x73 && stored[3] === 0x6d) type = 'application/wasm';
  r.setHeader('content-type', type);
  r.setHeader('cache-control', rel === 'index.html' ? 'no-cache' : 'max-age=31536000');
  let body = stored, encoding = null;
  if (mode === 'compressing') {
    const accept = String(q.headers['accept-encoding'] || '');
    if (/\\bbr\\b/.test(accept)) { body = zlib.brotliCompressSync(stored, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: stored.length } }); encoding = 'br'; }
    else if (/\\bgzip\\b/.test(accept)) { body = zlib.gzipSync(stored, { level: 6 }); encoding = 'gzip'; }
    if (encoding) { r.setHeader('content-encoding', encoding); r.setHeader('vary', 'accept-encoding'); }
  }
  r.setHeader('content-length', String(body.length));
  const send = () => { line({ status: 200, bytes: body.length, encoding, sha: crypto.createHash('sha256').update(stored).digest('hex') }); r.end(body); };
  if (holdPath && rel === holdPath && !held) { held = true; setTimeout(send, Number(holdMs)); } else send();
});
s.listen(0, '127.0.0.1', () => console.log(s.address().port));`;

export type Mode = 'stored' | 'compressing';
export interface Logged { at: number; sent: number; status: number; path: string; bytes: number; encoding: string | null; sha: string | null; accept: string | null }
export class WireServer {
  private child: ChildProcess | null = null;
  private dir = '';
  private file = '';
  async start(root: string, mode: Mode, hold?: { path: string; ms: number }): Promise<string> {
    this.dir = mkdtempSync(join(tmpdir(), 'deep-2892-server-'));
    this.file = join(this.dir, 'served.jsonl');
    const child = spawn(process.execPath, ['-e', SERVER, root, this.file, mode, hold?.path ?? '', String(hold?.ms ?? 0)], { stdio: ['ignore', 'pipe', 'inherit'] });
    this.child = child;
    const port = await new Promise<number>((done, fail) => { child.stdout!.once('data', (d: Buffer) => done(Number(String(d).trim()))); child.once('error', fail); });
    return `http://127.0.0.1:${port}`;
  }
  log(): Logged[] {
    if (!this.file || !existsSync(this.file)) return [];
    return readFileSync(this.file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Logged);
  }
  async stop(): Promise<void> {
    const child = this.child;
    this.child = null;
    if (child?.pid && child.exitCode === null) await new Promise<void>((done) => { child.once('exit', () => done()); child.kill(); });
    if (this.dir) rmSync(this.dir, { recursive: true, force: true });
    this.dir = ''; this.file = '';
  }
}
/** The bytes of body a server sent, over every response of a visit. */
export const sent = (log: Logged[]): number => log.reduce((s, l) => s + l.bytes, 0);
/** Each response the `stored` server sent went with no content encoding and with the file's bytes as stored. */
export function asStoredFailures(log: Logged[], out: string): string[] {
  const disk = filesUnder(out);
  const f: string[] = [];
  for (const l of log) {
    if (l.encoding !== null) f.push(`${l.path} was sent with content-encoding ${l.encoding}`);
    if (l.status === 200 && disk.get(l.path)?.length !== l.bytes) f.push(`${l.path} was sent as ${l.bytes} B; it is ${String(disk.get(l.path)?.length)} B as stored`);
  }
  return f;
}
export const describeLog = (log: Logged[]): string => log.map((l) => `${l.status} ${l.path} ${l.bytes} B${l.encoding ? ` ${l.encoding}` : ''}`).join('; ');

// ---------------------------------------------------------------------------------------------------
// The page's memory (README: The page's memory). Two readings, sampled every 100 ms: V8's count for the page's isolate
// (`Runtime.getHeapUsage`: its heap, the embedder's heap and the backing stores of its ArrayBuffers and WebAssembly
// memories) and the resident memory of each of Chrome's renderer processes (its process group's processes named
// Renderer, by `ps`). The page asks for its files while it is still booting, so where it stood is never read before
// that request: the server holds its response to the page's first request for the watched file for HOLD_MS, and "where
// it stood" is a reading's highest sample in the hold's second half, with the page booted and waiting on that file; the
// rise is the largest, over V8's count and each renderer process sampled both then and after, of its highest sample from
// the response on less where it stood (a renderer Chrome starts later, a spare, isn't the page's).

/** How long the server holds the watched file's response: twice the window in which where the page stood is read. */
export const HOLD_MS = 8_000;

type Raw = { send(method: string, params?: Record<string, unknown>, session?: string, timeoutMs?: number): Promise<Record<string, unknown>> };
/** #172's Tab keeps its DevTools session private; a visit needs three more of its methods (the cache back on, the
 * navigation, the heap's count). Read only through this. */
const devtools = (tab: Tab): { cdp: Raw; session: string } => tab as unknown as { cdp: Raw; session: string };
const chromePid = (c: Chrome): number | undefined => (c as unknown as { chrome: ChildProcess }).chrome.pid;

export interface MemorySample { at: number; v8: number | null; renderers: Map<number, number> }
async function sampleMemory(tab: Tab, group: number | undefined): Promise<MemorySample> {
  const at = Date.now();
  let v8: number | null = null;
  try {
    const { cdp, session } = devtools(tab);
    const h = await cdp.send('Runtime.getHeapUsage', {}, session, 5_000) as { usedSize?: number; embedderHeapUsedSize?: number; backingStorageSize?: number };
    if (typeof h.usedSize === 'number' && typeof h.backingStorageSize === 'number') v8 = h.usedSize + (h.embedderHeapUsedSize ?? 0) + h.backingStorageSize;
  } catch { /* the page is busy or gone: no V8 reading this time */ }
  const renderers = new Map<number, number>();
  if (group) {
    const r = spawnSync('ps', ['-A', '-o', 'pid=,pgid=,rss=,comm='], { encoding: 'utf8', maxBuffer: 64 << 20 });
    for (const line of (r.stdout ?? '').split('\n')) {
      const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line);
      if (m && Number(m[2]) === group && /Renderer/.test(m[4] ?? '')) renderers.set(Number(m[1]), Number(m[3]) * 1024);
    }
  }
  return { at, v8, renderers };
}
export interface MemoryReading { asked: boolean; rise: number | null; says: string }
function readMemory(samples: MemorySample[], log: Logged[], watched: string): MemoryReading {
  const first = log.filter((l) => l.path === watched).sort((a, b) => a.at - b.at)[0];
  if (!first) return { asked: false, rise: null, says: `the page never asked for ${watched}` };
  const released = first.sent;
  const from = released - HOLD_MS / 2;
  const parts: string[] = [`the server held ${watched} ${released - first.at} ms after the page asked; where the page stood is read over the hold's last ${HOLD_MS / 2} ms`];
  let rise: number | null = null;
  const readings: [string, (s: MemorySample) => number | null][] = [['V8 heap and buffers', (s) => s.v8]];
  const pids = new Set(samples.flatMap((s) => [...s.renderers.keys()]));
  for (const pid of pids) readings.push([`renderer ${pid} resident`, (s) => s.renderers.get(pid) ?? null]);
  for (const [name, of] of readings) {
    const before = samples.filter((s) => s.at >= from && s.at < released).map(of).filter((x): x is number => x !== null);
    const after = samples.filter((s) => s.at >= released).map(of).filter((x): x is number => x !== null);
    if (!before.length || !after.length) { if (name.startsWith('V8')) parts.push(`${name}: no reading`); continue; }
    const stood = Math.max(...before); const peak = Math.max(...after);
    parts.push(`${name}: stood at ${stood} B, peaked at ${peak} B (+${peak - stood} B)`);
    rise = Math.max(rise ?? -Infinity, peak - stood);
  }
  return { asked: true, rise, says: `${parts.join('; ')}; ${samples.length} samples` };
}

// ---------------------------------------------------------------------------------------------------
// A first visit (README: A first visit): a fresh Chrome profile (#172's Chrome, headless with WebGPU on), its HTTP
// cache on (#172's tab turns it off; a fresh profile's is empty, not off), opened on the server's blank page, then sent
// to the index page; it waits for `ready`, then 2 s for later loads, or, once a notice shows without `ready`, 5 s more.

const READY_MS = 180_000;
export interface Visit { log: Logged[]; ready: boolean; notices: string[]; errors: string[]; memory: MemoryReading | null }
export async function visit(folder: string, mode: Mode, what: string, o: { mustBeReady?: boolean; watch?: string } = {}): Promise<Visit> {
  const server = new WireServer();
  const origin = await server.start(folder, mode, o.watch === undefined ? undefined : { path: o.watch, ms: HOLD_MS });
  let chrome: Chrome | undefined;
  const sampler = { on: false, samples: [] as MemorySample[], loop: Promise.resolve() };
  try {
    chrome = await Chrome.open();
    const tab = await chrome.open(`${origin}/.canary`);
    const { cdp, session } = devtools(tab);
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: false }, session);
    await sleep(1_000);
    if (o.watch !== undefined) {
      const group = chromePid(chrome);
      sampler.on = true;
      sampler.loop = (async () => { while (sampler.on) { sampler.samples.push(await sampleMemory(tab, group)); await sleep(100); } })();
      await sleep(2_000);
    }
    await cdp.send('Page.navigate', { url: `${origin}/index.html` }, session).catch(() => undefined);
    let state = { ready: false, notices: [] as string[] };
    let noticed = 0;
    const until = Date.now() + READY_MS;
    while (Date.now() < until) {
      state = await tab.evaluate<typeof state>(`(() => { const p = document.querySelector('deep-player'); return { ready: !!(p && p.ready === true),
        notices: [...document.querySelectorAll('[data-deep-notice]')].map((e) => (e.textContent || '').trim()) }; })()`, 10_000).catch(() => state);
      if (state.ready) break;
      if (state.notices.length && !noticed) noticed = Date.now();
      if (noticed && Date.now() - noticed > 5_000) break;
      await sleep(200);
    }
    if (state.ready) await sleep(2_000);
    sampler.on = false;
    await sampler.loop;
    if (!state.ready && o.mustBeReady) await tab.mustBeReady(what, 1_000);
    const log = server.log();
    return { log, ready: state.ready, notices: state.notices, errors: [...tab.errors], memory: o.watch === undefined ? null : readMemory(sampler.samples, log, o.watch) };
  } finally {
    sampler.on = false;
    await sampler.loop.catch(() => undefined);
    await chrome?.close();
    await server.stop();
  }
}
/** A notice of a stopped visit names the file: its path, its stored SHA-256 or the SHA-256 it inflates to. */
export const namesFile = (notices: string[], f: Stored): boolean => notices.some((n) => n.includes(f.path) || n.includes(f.sha256) || n.includes(f.inflatedSha));

// ---------------------------------------------------------------------------------------------------
// A gzip stream that inflates to 1 GiB (AC6): a 4 KiB block of seeded bytes repeated 262,144 times, compressed by
// Node's zlib at level 9 (a few MB, estimated, not measured). No 4 KiB page of it repeats within itself, so neither V8's count nor the
// renderer's resident memory can shrink what a page inflates.

export async function gzipBomb(to: string): Promise<number> {
  const next = rng(2892);
  const block = Buffer.alloc(4096);
  for (let i = 0; i < block.length; i += 4) block.writeUInt32LE(next(), i);
  const mib = Buffer.concat(Array.from({ length: 256 }, () => block));
  await pipeline(async function* () { for (let i = 0; i < BOMB_INFLATED / mib.length; i++) yield mib; }, createGzip({ level: 9 }), createWriteStream(to));
  return statSync(to).size;
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run` in a folder and environment of the test's choosing (the merge base's tree, a clean home)

export function runIn(bin: string, sc: JsonObject, cwd: string, env: NodeJS.ProcessEnv, what: string): JsonObject[] {
  const r = spawnSync(bin, ['run'], { cwd, env, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 1 << 30, timeout: TIMEOUT - 300_000, killSignal: 'SIGKILL' });
  expect(r.error?.message ?? '', `${what}: deep-show run ran`).toBe('');
  expect(r.status, `${what}: deep-show run exits 0; stderr: ${(r.stderr ?? '').slice(-1500)}`).toBe(0);
  const lines = (r.stdout ?? '').split('\n').filter(Boolean);
  expect(lines.length, `${what}: one answer line`).toBe(1);
  const answer = obj(JSON.parse(lines[0]!) as JsonValue, `${what}: the answer`);
  expect(answer['ok'], `${what}: deep-show run takes the scenario${sc['planted'] ? ` (planted ${String(sc['planted'])})` : ''}: ${show(answer, 2000)}`).toBe(true);
  return arr(answer['replies'], `${what}: replies`).map((v, i) => obj(v, `${what}: replies[${i}]`));
}
/** One export of the lab on its track by `bin` run in `cwd` with `env`, into `out`; its receipt. */
export function exportIn(bin: string, cwd: string, env: NodeJS.ProcessEnv, evidence: string, out: string, what: string, planted?: string): WebReceipt {
  const document = labDoc(evidence);
  const r = runIn(bin, scenarioOf({ evidence, docs: [DOC.lab], calls: [present(DOC.lab, document), webExport(DOC.lab, out, { track: labTrack() })], ...(planted ? { planted } : {}) }), cwd, env, what);
  presented(r[0], what);
  return webReceiptOf(r[1], what);
}

// ---------------------------------------------------------------------------------------------------
// The `ship` call (README: The ship call), chosen: `{call: "ship", bundle: <the web export's folder>, chrome: <path>}`
// answers `{outcome: "measured", bytes, served: {responses: [{path, status, bytes, content_encoding}]}}`: `bytes` is
// ship.bytes for the bundle, and `served` the record of the ship checks' test server serving it to a fresh headless
// Chrome profile until `ready`, one entry per response it sent (`content_encoding` null when it sent none).

export interface Shipped { bytes: number; responses: { path: string; status: number; bytes: number; encoding: JsonValue }[]; raw: JsonObject }
export function ship(bin: string, evidence: string, bundle: string, what: string, planted?: string): Shipped {
  if (!existsSync(CHROME)) blocked(`no Google Chrome at ${CHROME}; the ship checks' test server serves the bundle to headless Chrome. Unblock: install Google Chrome there or set CHROME_BIN`);
  const sc = scenarioOf({ evidence, docs: [], calls: [{ call: 'ship', bundle, chrome: CHROME }], ...(planted ? { planted } : {}) });
  const [reply] = runIn(bin, sc, REPO, process.env, what);
  const r = obj(reply, `${what}: the ship call`);
  expect(r['outcome'], `${what}: the ship call measures the bundle: ${show(r, 2000)}`).toBe('measured');
  const served = obj(r['served'], `${what}: served (the record of the ship checks' test server)`);
  const responses = arr(served['responses'], `${what}: served.responses`).map((v, i) => {
    const x = obj(v, `${what}: served.responses[${i}]`);
    expect('content_encoding' in x, `${what}: served.responses[${i}] says which content encoding it was sent with: ${show(x, 400)}`).toBe(true);
    return { path: str(x['path'], `${what}: served.responses[${i}].path`), status: int(x['status'], `${what}: its status`), bytes: int(x['bytes'], `${what}: its bytes`), encoding: x['content_encoding'] ?? null };
  });
  return { bytes: int(r['bytes'], `${what}: ship.bytes`), responses, raw: r };
}

// ---------------------------------------------------------------------------------------------------
// The merge base's deep-show (AC7): its tree from `git archive` (no .git, nothing of this worktree), built with its own
// target folder, and run in that tree.

export function baseShow(dir: string, what: string): { bin: string; cwd: string; base: string } {
  const base = mergeBase();
  const tree = join(dir, 'tree');
  mkdirSync(tree);
  const tar = join(dir, 'base.tar');
  git(['archive', '--format=tar', `--output=${tar}`, base], `${what}: the merge base's tree`);
  const x = spawnSync('tar', ['-xf', tar, '-C', tree], { encoding: 'utf8' });
  expect(x.status, `${what}: the merge base's tree unpacks: ${x.stderr ?? ''}`).toBe(0);
  rmSync(tar, { force: true });
  const target = join(dir, 'target');
  const args = ['build', '--locked', '--bin', 'deep-show', '--no-default-features', '--features', FULL];
  const env = { ...gitEnv(), CARGO_TARGET_DIR: target, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
  const r = spawnSync('cargo', args, { cwd: tree, env, encoding: 'utf8', maxBuffer: 64 << 20 });
  expect(r.status, `${what}: cargo ${args.join(' ')} builds at the merge base ${base}: ${(r.stderr ?? '').split('\n').filter((l) => !/Compiling|Blocking/.test(l)).join('\n').slice(-3000)}`).toBe(0);
  return { bin: join(target, 'debug', 'deep-show'), cwd: tree, base };
}

// ---------------------------------------------------------------------------------------------------
// Clean homes and the Linux aarch64 host (AC7), as #172's criterion 6 makes them

/** A clean home: fresh HOME and TMPDIR, another user name, nothing else of this shell but PATH. */
export function cleanEnv(user: string): NodeJS.ProcessEnv {
  const home = mkdtempSync(join(tmpdir(), `deep-2892-home-${user}-`));
  const tmp = join(home, 'tmp');
  mkdirSync(tmp);
  return { PATH: process.env['PATH'] ?? '', HOME: home, TMPDIR: tmp, USER: user, LOGNAME: user, LANG: 'C' };
}
/** One export of the lab in a clean home, into a folder at a path of its own under `dir`. */
export function cleanExport(bin: string, dir: string, user: string, depth: number, planted?: string): { out: string; receipt: WebReceipt } {
  const env = cleanEnv(user);
  const evidence = join(dir, ...Array.from({ length: depth }, (_, i) => `e${i}`));
  mkdirSync(evidence, { recursive: true });
  const out = join(dir, ...Array.from({ length: depth }, (_, i) => `out-${user}-${i}`), 'bundle');
  try { return { out, receipt: exportIn(bin, REPO, env, evidence, out, `the lab exported by ${user}${planted ? ` (planted ${planted})` : ''}`, planted) }; }
  finally { rmSync(String(env['HOME']), { recursive: true, force: true }); }
}
/** The lab exported on the Linux aarch64 host `DEEP_LINUX_AARCH64` from its checkout `DEEP_LINUX_AARCH64_DIR` of this
 * commit, in a clean home; the bundle, unpacked under `dir`. BLOCKED when unset, unreachable or at another commit. */
export function linuxExport(dir: string, what: string): string {
  const host = process.env['DEEP_LINUX_AARCH64'];
  const at = process.env['DEEP_LINUX_AARCH64_DIR'];
  const head = git(['rev-parse', 'HEAD'], what).trim();
  if (!host || !at) blocked(`no Linux aarch64 host is configured for the second machine. Unblock: set DEEP_LINUX_AARCH64 to the host's ssh destination and DEEP_LINUX_AARCH64_DIR to a checkout of ${head} there with cargo, then rerun`);
  const ship = join(dir, 'ship');
  const evidence = join(ship, 'evidence');
  mkdirSync(evidence, { recursive: true });
  const document = labDoc(evidence);
  writeFileSync(join(ship, 'scenario.json'), JSON.stringify(scenarioOf({ evidence: '@ROOT@/evidence', docs: [DOC.lab], calls: [present(DOC.lab, document), webExport(DOC.lab, '@ROOT@/out/bundle', { track: labTrack() })] })));
  const tar = spawnSync('tar', ['-cf', '-', '-C', ship, '.'], { maxBuffer: 1 << 30 });
  const remote = [
    'set -e', 'r=$(mktemp -d)', 'tar -xf - -C "$r"', 'mkdir -p "$r/out"', `cd ${JSON.stringify(at)}`,
    `h=$(git rev-parse HEAD); if [ "$h" != ${head} ]; then echo "the checkout is at $h, not ${head}" >&2; exit 3; fi`,
    '[ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"', 'cargo build --locked --bin deep-show >&2',
    'c=$(mktemp -d); mkdir -p "$c/tmp"', 'sed "s|@ROOT@|$r|g" "$r/scenario.json" | env -i PATH="$PATH" HOME="$c" TMPDIR="$c/tmp" USER=deep2892l LOGNAME=deep2892l LANG=C target/debug/deep-show run > "$r/answer.json"',
    'tar -cf - -C "$r" answer.json out', 'rm -rf "$r" "$c"',
  ].join('\n');
  const script = Buffer.from(remote, 'utf8').toString('base64');
  const r = spawnSync('ssh', ['-o', 'BatchMode=yes', host!, `sh -c "$(printf %s ${script} | base64 -d)"`], { input: tar.stdout, maxBuffer: 1 << 30, timeout: TIMEOUT - 300_000 });
  if (r.status === 255) blocked(`ssh to ${host} failed: ${String(r.stderr).slice(-800)}. Unblock: make DEEP_LINUX_AARCH64 an ssh destination this Mac reaches without a prompt`);
  if (r.status === 3) blocked(`${String(r.stderr).trim()}. Unblock: check out ${head} at ${at} on ${host}`);
  expect(r.status, `${what}: the Linux aarch64 export ran: ${String(r.stderr).slice(-1500)}`).toBe(0);
  const back = join(dir, 'linux');
  mkdirSync(back);
  const x = spawnSync('tar', ['-xf', '-', '-C', back], { input: r.stdout, maxBuffer: 1 << 30 });
  expect(x.status, `${what}: the Linux bundle unpacks`).toBe(0);
  const answer = obj(JSON.parse(readFileSync(join(back, 'answer.json'), 'utf8')) as JsonValue, `${what}: the Linux answer`);
  expect(answer['ok'], `${what}: the Linux deep-show run takes the scenario: ${show(answer, 1500)}`).toBe(true);
  webReceiptOf(arr(answer['replies'], `${what}: the Linux replies`).map((v) => obj(v, 'a reply'))[1], `${what}: the lab exported on Linux aarch64`);
  return join(back, 'out', 'bundle');
}
