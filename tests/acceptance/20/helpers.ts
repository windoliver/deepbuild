// Test-side tools for the #20 acceptance tests: the environment cleanup, temp folders, a test clock, a world (the
// record, the evidence store and the asks core in a hub's folder layout), the agents' transcript folders written as
// each agent writes them, reads of what the archive left in the record and the store, and the archive itself,
// loaded lazily from its public entry so this file loads at the base, where it doesn't exist. Nothing here stands in
// for the archive: the tests reach it only through `openArchive` (README, The surface under test). The wrong
// programs are in wrong.ts, the fake forge in forge.ts, the hub for the retention pass in hub.ts.
//
// Safety: every folder is under /tmp/dh20-* (real paths) and removed after its file; HOME is a temp folder for this
// process and every child; the agent's own CLAUDE*, CODEX*, DEEP_* and AI_AGENT variables are removed first; no test
// reads the real ~/.claude, ~/.codex or ~/.deepbuild; no network; no process is ever stopped by name or port.

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { factsAdapter, shipped, type AdapterCaps, type AdapterRegistry, type JsonObject } from '../../../packages/adapters/src/index.ts';
import { openAsks, type Asks } from '../../../packages/asks/src/index.ts';
import { openEvidenceStore, scrubText, type EvidenceStore, type PutResult, type TextSink, type Writer } from '../../../packages/evidence/src/index.ts';
import { openRecord, toJson, type Connection, type Event, type RecordStore } from '../../../packages/record/src/index.ts';
import type { Archive, ArchiveOptions } from '../../../packages/archive/src/index.ts';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const NODE = process.execPath;
export const SECOND = 1000;
export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;
/** Monday 2026-10-05 09:00 UTC: every world's clock starts here, day 0. */
export const T0 = Date.UTC(2026, 9, 5, 9, 0, 0);

// ---- The environment: nothing of the agent running these tests, and a temp HOME.
for (const key of Object.keys(process.env)) {
  if (key.startsWith('CLAUDE') || key.startsWith('CODEX') || key.startsWith('DEEP_') || key === 'AI_AGENT' || key === 'TINY_HOME') delete process.env[key];
}
const made: string[] = [];
export function tempDir(tag: string): string {
  const dir = realpathSync(mkdtempSync(`/tmp/dh20-${tag}-`));
  made.push(dir);
  return dir;
}
process.env.HOME = realpathSync(mkdtempSync('/tmp/dh20-home-'));
made.push(process.env.HOME);
/** Removes every temp folder this file made. */
export function removeTemps(): void {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
export const utf8 = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, 'utf8'));
export const text = (bytes: Uint8Array): string => Buffer.from(bytes).toString('utf8');

// ---- Seeded randomness, for the generated transcripts.
export type Rng = () => number;
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
export function word(rng: Rng, length: number, alphabet = ALNUM): string {
  let s = '';
  for (let i = 0; i < length; i++) s += alphabet[Math.floor(rng() * alphabet.length)];
  return s;
}

// ---- IDs.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function base32(value: bigint, length: number): string {
  let s = '';
  for (let i = 0; i < length; i++) { s = CROCKFORD[Number(value & 31n)] + s; value >>= 5n; }
  return s;
}
/** A ULID at `ms`, its random part from the OS so IDs never collide across tests. */
export const ulid = (ms: number): string => base32(BigInt(ms), 10) + base32(BigInt(`0x${randomBytes(10).toString('hex')}`), 16);
/** An agent's session ID as Claude Code and Codex write it: a UUID. */
export const sessionId = (): string => randomUUID();
/** A session ID as a handle holds it: letters and digits only, as the hub's handles hold them (README, Readings). */
export const letters = (id: string): string => id.replace(/[^0-9A-Za-z]/g, '');
/** The `session:` handle of an agent's session. */
export const handle = (id: string): string => `session:${letters(id)}`;

// ---- The test clock: the record, the store, the asks core and the archive read time only through now().
export interface Clock { now(): number; set(ms: number): number; tick(ms: number): number }
export function makeClock(start = T0): Clock {
  let t = start;
  return { now: () => t, set: (ms) => (t = ms), tick: (ms) => (t += ms) };
}

// ---- Connections.
/** What the archive writes through: the hub hands the first-party extension this connection (README). */
export const ARCHIVE: Connection = { writer: 'ext:deepbuild/archive', actor: 'you', scope: 'you' };
export const CORE: Connection = { writer: 'core', actor: 'you', scope: 'you' };
/** deep-hook's connection for a session of an agent: what its hooks append. */
export const hookIn = (id: string, agent: string): Connection => ({ writer: 'hook', actor: 'you', scope: 'you', session: letters(id), agent });

// ---- The agents' homes and the adapters naming them.
/** The adapter a new agent would add: its facts name its folder, and nothing in the archive changes for it. */
export const TINY = 'tiny';
export function adapters(): AdapterRegistry {
  const registry = shipped();
  const facts = structuredClone(shipped().get('claude').facts) as JsonObject;
  facts.agent = TINY;
  facts.transcripts = { readBy: "a run keeps its session's own transcript", conformance: 'tiny/transcripts/folder', home: ['TINY_HOME', '~/.tiny'], path: 'sessions/{session}.jsonl' };
  const caps: AdapterCaps = { holdStop: false, wakeIdle: false, steer: false, followUp: false, answerPermission: false, nativeTools: false, mcp: false, rewrite: false, editInput: false, errorTurnHook: false, startTurn: false };
  registry.register(TINY, factsAdapter(facts, { caps, unsupported: {}, doctor: () => [] }));
  return registry;
}
/** The environment the archive resolves the facts' homes in: HOME always, the agents' own variables when a test sets them. */
export type Env = Record<string, string | undefined>;
export const claudeHome = (env: Env): string => env.CLAUDE_CONFIG_DIR ?? join(env.HOME!, '.claude');
export const codexHome = (env: Env): string => env.CODEX_HOME ?? join(env.HOME!, '.codex');
export const tinyHome = (env: Env): string => env.TINY_HOME ?? join(env.HOME!, '.tiny');

// ---- Transcripts, written where and as each agent writes them.
export interface Said { uuid: string; role: 'user' | 'assistant'; text: string }
/** Claude Code's JSONL entry for one message: the fields its transcripts carry (adapters/corpus/claude-code). */
export function claudeLine(id: string, cwd: string, m: Said, at: number, parent: string | null): string {
  const message = m.role === 'user'
    ? { role: 'user', content: m.text }
    : { model: 'claude-opus-5-5', id: `msg_${m.uuid}`, type: 'message', role: 'assistant', content: [{ type: 'text', text: m.text }], stop_reason: 'end_turn', usage: { input_tokens: 12, cache_read_input_tokens: 2048, output_tokens: 40 } };
  return JSON.stringify({
    parentUuid: parent, isSidechain: false, type: m.role, message, uuid: m.uuid, timestamp: new Date(at).toISOString(),
    userType: 'external', entrypoint: 'cli', cwd, sessionId: id, version: '2.1.304', gitBranch: 'main',
  });
}
/** Claude Code's folder for a working folder: each non-alphanumeric character of the cwd as `-` (its facts). */
export const claudeFolder = (env: Env, cwd: string): string => join(claudeHome(env), 'projects', cwd.replace(/[^0-9A-Za-z]/g, '-'));
export interface Transcript { agent: string; id: string; path: string; cwd: string; lines: string[]; next: number }
/** Starts a Claude Code session's transcript with its messages; returns it for appending. */
export function claudeTranscript(env: Env, messages: readonly Said[], o: { id?: string; cwd?: string; at?: number } = {}): Transcript {
  const id = o.id ?? sessionId();
  const cwd = o.cwd ?? '/tmp/dh20-work/shop';
  const path = join(claudeFolder(env, cwd), `${id}.jsonl`);
  mkdirSync(dirname(path), { recursive: true });
  const t: Transcript = { agent: 'claude', id, path, cwd, lines: [], next: 0 };
  writeFileSync(path, '');
  appendClaude(t, messages, o.at ?? T0);
  return t;
}
/** Appends messages to a Claude Code transcript, as the agent does while the session runs. */
export function appendClaude(t: Transcript, messages: readonly Said[], at = T0): void {
  const added = messages.map((m, i) => claudeLine(t.id, t.cwd, m, at + (t.next + i) * SECOND, t.lines.length ? JSON.parse(t.lines[t.lines.length - 1]!).uuid : null));
  t.next += messages.length;
  t.lines.push(...added);
  appendFileSync(t.path, added.map((l) => `${l}\n`).join(''));
}
/** The user messages `m<from>`…`m<to>`, each its own text: `message <n>: …`. */
export function numbered(from: number, to: number, tag = 'plain'): Said[] {
  return Array.from({ length: to - from + 1 }, (_, k) => ({ uuid: `m${from + k}`, role: 'user' as const, text: `message ${from + k}: ${tag} talk about the shop's checkout page, step ${from + k}` }));
}
/** A Codex rollout, named and laid out as its facts say, its first line the session_meta that names the thread. */
export function codexTranscript(env: Env, texts: readonly string[], at = T0): Transcript {
  const id = sessionId();
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  const [Y, M, D] = [String(d.getUTCFullYear()), pad(d.getUTCMonth() + 1), pad(d.getUTCDate())];
  const time = `${Y}-${M}-${D}T${pad(d.getUTCHours())}-${pad(d.getUTCMinutes())}-${pad(d.getUTCSeconds())}`;
  const path = join(codexHome(env), 'sessions', Y, M, D, `rollout-${time}-${id}.jsonl`);
  mkdirSync(dirname(path), { recursive: true });
  const meta = { timestamp: d.toISOString(), type: 'session_meta', payload: { session_id: id, id, timestamp: d.toISOString(), cwd: '/tmp/dh20-work/shop', originator: 'codex_cli_rs', cli_version: '0.160.0', source: 'cli' } };
  const lines = [JSON.stringify(meta), ...texts.map((t, i) => JSON.stringify({ timestamp: new Date(at + (i + 1) * SECOND).toISOString(), type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: t }] } }))];
  writeFileSync(path, lines.map((l) => `${l}\n`).join(''));
  return { agent: 'codex', id, path, cwd: '/tmp/dh20-work/shop', lines, next: lines.length };
}
/** A transcript of the new agent, at `sessions/{session}.jsonl` under its home, as its facts say. */
export function tinyTranscript(env: Env, texts: readonly string[]): Transcript {
  const id = sessionId();
  const path = join(tinyHome(env), 'sessions', `${id}.jsonl`);
  mkdirSync(dirname(path), { recursive: true });
  const lines = texts.map((t) => JSON.stringify({ role: 'user', text: t }));
  writeFileSync(path, lines.map((l) => `${l}\n`).join(''));
  return { agent: TINY, id, path, cwd: '', lines, next: lines.length };
}
/** The bytes of a transcript as the agent wrote them, read when the test wrote them. */
export const sourceOf = (t: Transcript): string => t.lines.map((l) => `${l}\n`).join('');
/** What the archive must store for a source: the store's ingestion scrub, by the values held and by pattern. */
export const redacted = (source: string, held: readonly string[] = []): string => scrubText(source, { held: [...held] });

// ---- A world: the record, the evidence store and the asks core, laid out as a hub's folder (<home>/.deepbuild).
export interface World {
  dir: string;
  home: string;
  root: string;
  env: Env;
  clock: Clock;
  store: EvidenceStore;
  record: RecordStore;
  asks: Asks;
  /** Every put and text close the archive made through the store, counted (the store it gets is wrapped). */
  writes: { count: number };
  /** The store the archive is handed: `store`, its writes counted, and bent by `bend` when a test sets one. */
  archiveStore: EvidenceStore;
  bend?: (sha: string) => void;
  close(): Promise<void>;
}
export interface WorldOptions { clock?: Clock; env?: Env; home?: string }
export const ledgerOf = (root: string): string => join(root, 'ledger.db');
export const evidenceOf = (root: string): string => join(root, 'evidence');
export async function openWorld(o: WorldOptions = {}): Promise<World> {
  const dir = o.home ? dirname(o.home) : tempDir('world');
  const home = o.home ?? join(dir, 'home');
  const root = join(home, '.deepbuild');
  mkdirSync(root, { recursive: true });
  const clock = o.clock ?? makeClock();
  const env: Env = { HOME: home, ...o.env };
  const store = await openEvidenceStore({ root: evidenceOf(root), now: clock.now });
  const record = await openRecord({ path: ledgerOf(root), now: clock.now, evidence: store });
  const asks = await openAsks({ record, now: clock.now, deliver: () => undefined });
  const w = { dir, home, root, env, clock, store, record, asks, writes: { count: 0 } } as World;
  w.archiveStore = counting(store, w);
  w.close = async () => { await record.close(); };
  return w;
}
/** The store as the archive sees it: every write counted, and, when the world has one, bent after it lands. */
function counting(store: EvidenceStore, w: World): EvidenceStore {
  const landed = (result: PutResult): PutResult => {
    if (result.status === 'stored') w.bend?.(result.evidence.sha256);
    return result;
  };
  return {
    ...store,
    connect(peer): Writer {
      const writer = store.connect(peer);
      return {
        async put(request) { w.writes.count++; return landed(await writer.put(request)); },
        text(request): TextSink {
          const sink = writer.text(request);
          return { write: (chunk) => sink.write(chunk), async close() { w.writes.count++; return landed(await sink.close()); } };
        },
      };
    },
  };
}
/** The file the store keeps a hash in (design, Evidence: `evidence/ab/cdef…`), whatever its suffix. */
export function storedFile(root: string, sha: string): string | undefined {
  const folder = join(evidenceOf(root), sha.slice(0, 2));
  if (!existsSync(folder)) return undefined;
  const name = readdirSync(folder).find((f) => f.startsWith(sha.slice(2)));
  return name ? join(folder, name) : undefined;
}
/** Bytes on disk under a folder: each file's allocated blocks, so a compressed file counts as it sits. */
export function allocated(folder: string): number {
  let total = 0;
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) total += allocated(path);
    else if (entry.isFile()) total += statSync(path).blocks * 512;
  }
  return total;
}

// ---- The archive, from its public entry (README, The surface under test), loaded lazily.
export const ARCHIVE_ENTRY = '../../../packages/archive/src/index.ts';
export const archiveModule = () => import(new URL(ARCHIVE_ENTRY, import.meta.url).href) as Promise<typeof import('../../../packages/archive/src/index.ts')>;
export interface Opened { archive: Archive; options: ArchiveOptions }
/** Opens the archive on a world, over every adapter's folders, with the given held values and forge. */
export async function openArchiveOn(w: World, o: { held?: readonly string[]; forge?: ArchiveOptions['forge'] } = {}): Promise<Archive> {
  const { openArchive } = await archiveModule();
  const options: ArchiveOptions = {
    record: w.record, evidence: w.archiveStore, asks: w.asks, adapters: adapters(), env: w.env, connection: ARCHIVE, now: w.clock.now,
    held: () => o.held ?? [],
    ...(o.forge && { forge: o.forge }),
  };
  return openArchive(options);
}

// ---- Reads.
export async function allEvents(record: RecordStore, kinds?: readonly string[]): Promise<Event[]> {
  const out: Event[] = [];
  let after = 0;
  for (;;) {
    const page = await record.read({ after, limit: 1000, ...(kinds && { kinds }) });
    if (!page.length) return out;
    out.push(...page);
    after = page[page.length - 1]!.log_pos;
  }
}
/** Every event in the record, as the record prints each: what a secret must never be found in. */
export async function toJsonAll(w: World): Promise<string> {
  return (await allEvents(w.record)).map(toJson).join('\n');
}
export type Data = { [key: string]: unknown };
export const dataOf = (e: Event): Data => e.data as Data;
/** The transcript.archived events naming a session, in log order. */
export async function archivedOf(record: RecordStore, id: string): Promise<Event[]> {
  return (await allEvents(record, ['transcript.archived'])).filter((e) => dataOf(e).session === handle(id));
}
/** The one transcript.archived event naming a session, after a test expected exactly one. */
export async function onlyCopy(record: RecordStore, id: string, why: string): Promise<Event> {
  const copies = await archivedOf(record, id);
  expect(copies.length, `${why}: one transcript.archived event names ${handle(id)}`).toBe(1);
  return copies[0]!;
}
/** The text of an archived copy, read back from the store by its hash. */
export async function copyText(store: EvidenceStore, sha: string): Promise<string> {
  return text(await store.read(sha));
}
/** Asserts the newest copy of a transcript reads back as its source redacted as ingestion redacts it. */
export async function expectArchived(w: World, t: Transcript, why: string, held: readonly string[] = []): Promise<Event> {
  const copies = await archivedOf(w.record, t.id);
  expect(copies.length, `${why}: a transcript.archived event names ${handle(t.id)} (${t.agent})`).toBeGreaterThan(0);
  const newest = copies[copies.length - 1]!;
  const sha = String(dataOf(newest).evidence);
  expect(await copyText(w.store, sha), `${why}: the copy ${sha} of ${handle(t.id)} reads back as the ${t.agent} transcript, redacted`).toBe(redacted(sourceOf(t), held));
  return newest;
}

// ---- Criterion IDs: `#20.<first 8 hex of the SHA-256 of the criterion's text>` (scripts/proof-change.mjs).
export const AC = {
  1: '#20.eb5dbec4', 2: '#20.9b0ff45e', 3: '#20.e13bfd0e', 4: '#20.0567345d', 5: '#20.c93e8478',
  6: '#20.91899638', 7: '#20.1e107583', 8: '#20.2fe357c5', 9: '#20.5b690079', 10: '#20.7a50eb28',
} as const;
