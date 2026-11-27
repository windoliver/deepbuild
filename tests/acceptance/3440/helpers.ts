// #3440's shared pieces: the issue's numbers, a record in a real file under a temp folder, events that fill pages, the
// two files' sizes as the disk gives them, and the second process that holds one read open (reader.mjs).
import { spawn, type ChildProcess } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, readSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openRecord } from '../../../packages/record/src/index.ts';
import type { Appended, Connection, EventInput, RecordStore } from '../../../packages/record/src/index.ts';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const MIB = 1024 * 1024;
/** The issue's starting value for the writer's `journal_size_limit`: 64 MiB. */
export const LIMIT = 64 * MIB;
/** The criteria's IDs: `#3440.` and the first eight hex digits of the SHA-256 of each one's text (scripts/proof-change.mjs). */
export const AC = {
  limit: '#3440.e48b80ad',
  read: '#3440.fd63704e',
  size: '#3440.bc903f14',
  budget: '#3440.e9dfc29b',
} as const;

const T0 = Date.UTC(2026, 10, 25, 12, 0, 0);
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let minted = 0n;
/** A ULID at `ms`, its random part a counter: unique and ordered. */
function ulidAt(ms: number): string {
  let s = '';
  let value = (BigInt(ms) << 80n) | minted++;
  for (let i = 0; i < 26; i++) { s = CROCKFORD[Number(value & 31n)] + s; value >>= 5n; }
  return s;
}
const seqAt = (ms: number): string => `${BigInt(ms) * 1_000_000n}`;

const roots: string[] = [];
/** A temp folder of this test's own, removed by `cleanup`. */
export function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'deep-3440-'));
  roots.push(dir);
  return dir;
}
const records: RecordStore[] = [];
const children: ChildProcess[] = [];
/** Ends what a test left: its reader process, by its own PID, its records, and its folders with their files. */
export async function cleanup(): Promise<void> {
  for (const child of children.splice(0)) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  for (const record of records.splice(0)) await record.close().catch(() => undefined);
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/** The bytes of the log's file and of its write-ahead file, as the disk gives them; 0 for a file that isn't there. */
export function sizes(path: string): { log: number; wal: number } {
  const bytes = (file: string): number => statSync(file, { throwIfNoEntry: false })?.size ?? 0;
  return { log: bytes(path), wal: bytes(`${path}-wal`) };
}
/** The page size the log's file names in its header (bytes 16 and 17, big-endian; 1 says 65,536). */
export function pageSize(path: string): number {
  const fd = openSync(path, 'r');
  try {
    const header = Buffer.alloc(18);
    readSync(fd, header, 0, 18, 0);
    const said = header.readUInt16BE(16);
    return said === 1 ? 65_536 : said;
  } finally {
    closeSync(fd);
  }
}
export const mib = (bytes: number): string => `${bytes} bytes (${(bytes / MIB).toFixed(1)} MiB)`;

/** How many characters of a command each filling event keeps: under the 8,192 the record cuts a command at. */
export const FILL = 8000;
const COMMAND = 'echo the quick brown fox jumps over the lazy dog and '.repeat(Math.ceil(FILL / 52)).slice(0, FILL);

export interface Filed {
  record: RecordStore;
  path: string;
  /** Appends `count` filling events in one turn, so they land in one commit, each keeping FILL characters. */
  fill(count: number): Promise<Appended[]>;
  /** One small event, awaited: one commit. */
  commit(): Promise<Appended>;
}
/** A record in a file of a temp folder, as `openRecord` opens one with no storage named, with one session begun. */
export async function fileRecord(): Promise<Filed> {
  const path = join(tempDir(), 'record.db');
  let at = T0;
  const record = await openRecord({ path, now: () => at });
  records.push(record);
  const session = ulidAt(at);
  const hook: Connection = { writer: 'hook', actor: 'you', scope: 'you', session, agent: 'claude-code' };
  await record.append(hook, { v: 1, id: ulidAt(at), kind: 'session.start', ts: at, data: { agent: 'claude-code', worktree: '~/src/app', branch: 'main', thread: session } });
  at += 1;
  await record.append(hook, { v: 1, id: ulidAt(at), kind: 'user.ask', ts: at, seq: seqAt(at), data: { msg: 1, text: 'fill the log', tasks: [], from: 'person' } });
  const tool = (command: string): EventInput => {
    at += 1;
    return { v: 1, id: ulidAt(at), kind: 'tool.after', ts: at, seq: seqAt(at), data: { kind: 'shell', paths: [], command } };
  };
  return {
    record,
    path,
    fill: (count) => Promise.all(Array.from({ length: count }, () => record.append(hook, tool(COMMAND)))),
    commit: () => record.append(hook, tool('true')),
  };
}

export interface HeldRead {
  /** What the process said when its read was open: the first row it took. */
  first: string;
  /** Ends the read and the process, and resolves once it has gone. */
  end(): Promise<void>;
}
/**
 * A second process (reader.mjs) that opens the record's file read-only and holds one read open: it has taken the first
 * row of a SELECT over the log and not the rest. Resolves once the process says its read is open.
 */
export function holdRead(path: string): Promise<HeldRead> {
  const child = spawn(process.execPath, [join(REPO, 'tests/acceptance/3440/reader.mjs'), path], { cwd: REPO, stdio: ['pipe', 'pipe', 'pipe'] });
  children.push(child);
  let out = '';
  let err = '';
  child.stderr.on('data', (chunk: Buffer) => { err += chunk.toString(); });
  const gone = new Promise<number | null>((resolve) => child.once('close', (code) => resolve(code)));
  return new Promise<HeldRead>((resolve, reject) => {
    child.once('error', reject);
    void gone.then((code) => reject(Error(`BLOCKED: the reading process ended (exit ${String(code)}) before its read was open: ${err || out}`)));
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString();
      const said = /^reading (.+)$/m.exec(out);
      if (said) resolve({
        first: said[1]!,
        async end() {
          child.stdin.end('end\n');
          const code = await gone;
          if (code !== 0 || !/^ended$/m.test(out)) throw Error(`BLOCKED: the reading process didn't end its read cleanly (exit ${String(code)}): ${err || out}`);
        },
      });
    });
  });
}
