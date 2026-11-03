// Test-side tools for the #37 acceptance tests: temp folders, a world (the record, the asks core, the supervisor
// that is #236's local host@1, and an evidence store), the sample app as a check's temporary checkout in each of
// its builds, the trees the core places a stack's processes in, journey files read and rewritten as data, a PNG
// reader for the screenshots the surface stores, and the surface itself loaded lazily, so this file loads at the
// base, where `packages/checks-journey` doesn't exist. Nothing here stands in for the journey check kind, the
// browser, the stack or the comparison: the tests reach them only through `@deepbuild/checks-journey`'s public
// entry (README, The surface under test), whose types alone are imported here. The planted runners of AC13 are in
// wrong.ts.
//
// Safety: every folder is under /tmp/dh37-* (real paths); HOME is a temp folder for this process and every child;
// the agent's own CLAUDE_* and DEEP_* variables are removed first; no test touches the real ~/.deepbuild; no
// network beyond 127.0.0.1 (the stack, started by the surface through the supervisor, listens there); every
// process a test learns the PID of (the app writes <checkout>/.pids/server.<pid>) is stopped by that PID only,
// after checking it still runs this suite's app, never by name or port; no real secret anywhere (a test password
// is random, made at run time).

import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';
import { afterAll, expect } from 'vitest';
import { parse, stringify } from 'yaml';
import { openAsks, type Asks } from '../../../packages/asks/src/index.ts';
import type { JourneyRunOptions, Model, ModelInput, ModelReading, Plant } from '../../../packages/checks-journey/src/index.ts';
import { openEvidenceStore, type EvidenceStore } from '../../../packages/evidence/src/index.ts';
import type { Trees } from '../../../packages/gate/src/index.ts';
import { openRecord, type Event, type RecordStore } from '../../../packages/record/src/index.ts';
import { openSupervisor, type Supervisor } from '../../../packages/supervisor/src/index.ts';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const APP = join(FIXTURES, 'app');
export const NODE = process.execPath;
export const DAY = 86_400_000;
/** The journey check kind's public entry (README, The surface under test). */
export const JOURNEY_ENTRY = '../../../packages/checks-journey/src/index.ts';
/** The fixed defaults every journey runs with (the issue, Added Oct 9). */
export const VIEWPORT = { width: 1280, height: 720 };
/** One frame of the evidence video, at 15 fps (AC16's budget names the rate). */
export const FRAME_MS = 1000 / 15;

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const sha256 = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}`); };

for (const key of Object.keys(process.env)) if (key.startsWith('CLAUDE') || key.startsWith('DEEP_') || key === 'AI_AGENT') delete process.env[key];
let HOME: string | undefined;
export function home(): string {
  if (!HOME || !existsSync(HOME)) {
    HOME = realpathSync(mkdtempSync('/tmp/dh37-home-'));
    process.env.HOME = HOME;
  }
  return HOME;
}
home();

// ---- IDs.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function base32(value: bigint, length: number): string {
  let s = '';
  for (let i = 0; i < length; i++) { s = CROCKFORD[Number(value & 31n)] + s; value >>= 5n; }
  return s;
}
export const ulid = (ms = Date.now()): string => base32(BigInt(ms), 10) + base32(BigInt(`0x${randomBytes(10).toString('hex')}`), 16);
export const runId = (): string => `run:${ulid()}`;
/** A test password: random, made at run time, never a real secret. */
export const testSecret = (): string => `tp-${randomBytes(12).toString('base64url')}`;

// ---- Temp folders, all removed after the file.
const made: string[] = [];
export function tempDir(tag: string): string {
  const dir = realpathSync(mkdtempSync(`/tmp/dh37-${tag}-`));
  made.push(dir);
  return dir;
}

// ---- The app's processes: stopped by PID only, after checking the PID still runs this suite's app.
const pidDirs = new Set<string>();
export function alive(pid: number): boolean {
  try { process.kill(pid, 0); } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
  try { return !/Z/.test(execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' })); } catch { return false; }
}
const ours = (pid: number): boolean => {
  try { return /\/tmp\/dh37-/.test(execFileSync('ps', ['-ww', '-o', 'command=', '-p', String(pid)], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } })); } catch { return false; }
};
/** The PIDs the app wrote in a checkout's .pids folder. */
export function serverPids(checkout: string): number[] {
  const dir = join(checkout, '.pids');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).map((name) => /^server\.(\d+)$/.exec(name)?.[1]).filter((p): p is string => !!p).map(Number);
}
export async function stopLeftovers(): Promise<void> {
  const pids = new Set<number>();
  for (const dir of pidDirs) for (const pid of serverPids(dir)) if (alive(pid) && ours(pid)) pids.add(pid);
  for (const pid of pids) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 3000;
  while ([...pids].some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of pids) if (alive(pid) && ours(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
}

// ---- The world: a record, the asks core, the supervisor on them (#236) and an evidence store (#15).
export interface World {
  dir: string;
  record: RecordStore;
  asks: Asks;
  sup: Supervisor;
  evidence: EvidenceStore;
  events(kind?: string): Promise<Event[]>;
  close(): Promise<void>;
}
const worlds: World[] = [];
export async function openWorld(): Promise<World> {
  const dir = tempDir('world');
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const sup = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 2 * DAY } } } });
  const evidence = await openEvidenceStore({ root: join(dir, 'evidence') });
  const events = async (kind?: string): Promise<Event[]> => {
    const all: Event[] = [];
    for (let after = 0; ;) {
      const page = await record.read({ after, limit: 1000 });
      all.push(...page);
      if (page.length < 1000) break;
      after = page[page.length - 1]!.log_pos;
    }
    return kind ? all.filter((e) => e.kind === kind) : all;
  };
  let closed = false;
  const w: World = {
    dir, record, asks, sup, evidence, events,
    close: async () => {
      if (closed) return;
      closed = true;
      await sup.close();
      await record.close();
    },
  };
  worlds.push(w);
  return w;
}

afterAll(async () => {
  for (const w of worlds.splice(0)) await w.close().catch(() => undefined);
  await stopLeftovers();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  if (HOME) rmSync(HOME, { recursive: true, force: true });
}, 60_000);

// ---- The sample app as a check's temporary checkout, in one of its builds (fixtures/app/server.mjs lists the flags).
export type Flag = 's2' | 'export' | 'error-step3' | 'missing-image' | 'clock-footer' | 'moved-8px' | 'bigger-bundle' | 'no-pay' | 'no-store' | 'unhealthy' | 'slow'
  | 'motion-400' | 'motion-no-reduce' | 'motion-script';
/**
 * A plain folder holding the app's files, as a temporary checkout of one snapshot is: `fixtures/app` copied, its
 * build.json naming the flags (the working build has none), `extra` files written over it, and done.yaml's `up`
 * naming the Node this process runs on, so the supervisor's sandbox finds it.
 */
export function checkout(flags: Flag[] = [], extra: Record<string, string> = {}): string {
  const dir = join(tempDir('checkout'), 'app');
  cpSync(APP, dir, { recursive: true });
  writeFileSync(join(dir, 'build.json'), `${JSON.stringify({ flags })}\n`);
  const done = join(dir, '.deepbuild/done.yaml');
  writeFileSync(done, readFileSync(done, 'utf8').replace('up: "node server.mjs"', `up: "${NODE} server.mjs"`));
  for (const [path, text] of Object.entries(extra)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  pidDirs.add(dir);
  return dir;
}
/** The trees the core knows (gate's `Trees`): the checkout, a live worktree the stack must never serve, and other checkouts. */
export function trees(checkoutDir: string, others: string[] = []): Trees {
  return { checkout: checkoutDir, digests: {}, worktree: join(tempDir('worktree'), 'repo'), others };
}
/** A tree's identity as a receipt names it: the SHA-256 over every file's path and bytes, as a tree digest of the folder. */
export function treeDigest(dir: string): string {
  const hash = createHash('sha256');
  const walk = (d: string, rel: string): void => {
    for (const entry of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === '.pids') continue;
      const path = join(d, entry.name);
      const at = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path, at);
      else { hash.update(`${at}\0`); hash.update(readFileSync(path)); hash.update('\0'); }
    }
  };
  walk(dir, '');
  return hash.digest('hex');
}

// ---- Journey files as data: read from the fixture, rewritten into a checkout.
export type Doc = Record<string, unknown>;
export const JOURNEYS = '.deepbuild/journeys';
export const journeyPath = (id: string): string => `${JOURNEYS}/${id}.yaml`;
export function readJourney(dir: string, id: string): Doc {
  return parse(readFileSync(join(dir, journeyPath(id)), 'utf8')) as Doc;
}
export function writeJourney(dir: string, id: string, doc: Doc): string {
  const path = join(dir, journeyPath(id));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, stringify(doc));
  return journeyPath(id);
}
/** The fixture's journey `id`, changed by `edit`, written as `as` (or over itself) into the checkout. */
export function journeyVariant(dir: string, id: string, edit: (doc: Doc) => void, as = id): string {
  const doc = readJourney(dir, id);
  edit(doc);
  return writeJourney(dir, as, doc);
}
export const steps = (doc: Doc): Doc[] => doc.steps as Doc[];
export const endState = (doc: Doc): Doc[] => doc.end_state as Doc[];

// ---- The surface, loaded lazily so this file loads at the base.
export type Journey = typeof import('../../../packages/checks-journey/src/index.ts');
/** The surface, once its entry exists: at a base without it, the test fails here, at this assertion. */
export async function journey(): Promise<Journey> {
  const entry = fileURLToPath(new URL(JOURNEY_ENTRY, import.meta.url));
  expect(existsSync(entry), `the journey check kind's public entry exists at ${entry} (README, The surface under test)`).toBe(true);
  return import(new URL(JOURNEY_ENTRY, import.meta.url).href) as Promise<Journey>;
}
/** The options of a run on a world: the host, the evidence store, a run handle, the checkout and its trees; `rest` adds the test's own. */
export function runOptions(w: World, dir: string, journeyFile: string, rest: Partial<JourneyRunOptions> = {}): JourneyRunOptions {
  return { host: w.sup, evidence: w.evidence, run: runId(), checkout: dir, journey: journeyFile, trees: trees(dir), ...rest };
}
/** A planted twin's options: the same run under `plant`. */
export const planted = (o: JourneyRunOptions, plant: Plant): JourneyRunOptions => ({ ...o, run: runId(), plant });

/** A fake model for AC20: answers as told and remembers every input it was given; never a real model. */
export function fakeModel(answer: (input: ModelInput) => ModelReading): Model & { inputs: ModelInput[] } {
  const inputs: ModelInput[] = [];
  return { inputs, read: async (input) => { inputs.push(structuredClone(input)); return answer(input); } };
}

/**
 * A wrong-program test's shape (README, Wrong programs): the criterion's assertion, run on the planted twin, must
 * fail. The error it fails with is returned, so the test can also check the twin is that twin.
 */
export async function assertionFails(assertion: () => Promise<void> | void): Promise<Error> {
  try {
    await assertion();
  } catch (error) {
    return error as Error;
  }
  throw Error('the criterion\'s assertion passed on the planted wrong program; the test proves nothing');
}

// ---- Evidence: bytes by hash, and PNGs read as pixels.
export const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export const isPng = (bytes: Uint8Array): boolean => Buffer.from(bytes.subarray(0, 8)).equals(PNG_HEAD);
/** A WebM file starts with the EBML header. */
export const isWebm = (bytes: Uint8Array): boolean => bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
export interface Image { width: number; height: number; /** RGBA, row-major. */ rgba: Uint8Array }
/** A PNG decoded with Node's zlib alone: 8-bit RGB or RGBA, every filter type, no interlace (what a screenshot is). */
export function decodePng(bytes: Uint8Array): Image {
  const buf = Buffer.from(bytes);
  if (!isPng(buf)) throw Error('not a PNG');
  let width = 0, height = 0, channels = 0, bitDepth = 0;
  const idat: Buffer[] = [];
  for (let at = 8; at < buf.length;) {
    const length = buf.readUInt32BE(at);
    const type = buf.toString('latin1', at + 4, at + 8);
    const data = buf.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4); bitDepth = data[8]!;
      const color = data[9]!;
      channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[color] ?? 0;
      if (data[12] !== 0) throw Error('interlaced PNG');
      if (bitDepth !== 8 || !channels) throw Error(`PNG with bit depth ${bitDepth} and colour type ${color}`);
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const rgba = new Uint8Array(width * height * 4);
  const previous = Buffer.alloc(stride);
  const line = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels]! : 0;
      const b = previous[i]!;
      const c = i >= channels ? previous[i - channels]! : 0;
      let value = row[i]!;
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) { const p = a + b - c; const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      line[i] = value & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (channels === 1) { rgba[o] = rgba[o + 1] = rgba[o + 2] = line[x]!; rgba[o + 3] = 255; }
      else if (channels === 2) { rgba[o] = rgba[o + 1] = rgba[o + 2] = line[x * 2]!; rgba[o + 3] = line[x * 2 + 1]!; }
      else if (channels === 3) { rgba[o] = line[x * 3]!; rgba[o + 1] = line[x * 3 + 1]!; rgba[o + 2] = line[x * 3 + 2]!; rgba[o + 3] = 255; }
      else { rgba.set(line.subarray(x * 4, x * 4 + 4), o); }
    }
    line.copy(previous);
  }
  return { width, height, rgba };
}
export const pixel = (image: Image, x: number, y: number): [number, number, number, number] => {
  const o = (y * image.width + x) * 4;
  return [image.rgba[o]!, image.rgba[o + 1]!, image.rgba[o + 2]!, image.rgba[o + 3]!];
};
/** The PNG re-encoded with one 4×4 block, at (x, y), painted a colour it wasn't: the planted head image of AC23. */
export function withBlockChanged(bytes: Uint8Array, x: number, y: number): Uint8Array {
  const image = decodePng(bytes);
  for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) {
    const o = ((y + dy) * image.width + x + dx) * 4;
    image.rgba[o] = image.rgba[o]! ^ 0x80; image.rgba[o + 1] = image.rgba[o + 1]! ^ 0x40; image.rgba[o + 2] = image.rgba[o + 2]! ^ 0x20; image.rgba[o + 3] = 255;
  }
  return encodePng(image);
}
export function encodePng(image: Image): Uint8Array {
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer): number => { let c = 0xffffffff; for (const v of b) c = table[(c ^ v) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer): Buffer => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'latin1'), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const stride = image.width * 4;
  const raw = Buffer.alloc((stride + 1) * image.height);
  for (let y = 0; y < image.height; y++) { raw[y * (stride + 1)] = 0; raw.set(image.rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(image.width, 0); ihdr.writeUInt32BE(image.height, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([PNG_HEAD, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
/** The evidence's bytes and record, which must exist and be whole; fails the test naming the hash otherwise. */
export async function storedPng(w: World, sha: string | null | undefined, what: string): Promise<Image> {
  expect(sha, `${what} is stored by hash`).toMatch(/^[0-9a-f]{64}$/);
  const record = await w.evidence.get(sha!);
  expect(record, `${what} ${sha} is in the evidence store`).toBeDefined();
  expect(record!.intake, `${what} is whole`).toBe('captured');
  const bytes = await w.evidence.read(sha!);
  expect(isPng(bytes), `${what} is a PNG`).toBe(true);
  return decodePng(bytes);
}
