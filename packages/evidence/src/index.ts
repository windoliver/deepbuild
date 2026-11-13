import { createHash, randomUUID } from 'node:crypto';
import { isUtf8 } from 'node:buffer';
import { createReadStream } from 'node:fs';
import { access, copyFile, mkdir, open, readFile, rename, rm, stat, writeFile, type FileHandle } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { zstdCompress, zstdDecompress } from 'node:zlib';
import { detect, missingEnd, type MediaType } from './intake.js';
import { patternMatches as matchesOf, scrub, scrubList, type Run } from './scrub.js';

export type { MediaType };
export type Origin = 'deepbuild' | 'you' | 'agent';
export type Redaction = 'complete' | 'incomplete' | 'unknown';
export type ShareVia = 'export' | 'report' | 'post';
export interface License { name: string; allows: readonly ShareVia[] }

/** What the hub's socket proved about a writer's connection. */
export type Peer =
  | { role: 'deepbuild'; via: 'render' | 'capture' | 'journey' | 'job' | 'export' }
  | { role: 'you'; via: 'paste' | 'drop' | 'picker' }
  | { role: 'agent'; session: string };

export interface EvidenceStoreOptions {
  root?: string;
  now?: () => number;
  /** For a caller that only gets and reads, such as `deep read`: opening makes no folder and never compacts the journal. */
  readOnly?: boolean;
  /** Test hook: awaited by every put after its existence check and before its write. */
  hooks?: { afterExistsCheck?(sha256: string): void | Promise<void> };
}

interface Common {
  kind: string;
  source: string;
  redaction: Redaction;
  license: License;
  derivedFrom?: readonly string[];
  /** Required for kind `layer.rows`: the layer, parent and level the rows are for. */
  layer?: LayerKey;
  /** What the call claims; the stored origin comes from the connection. */
  origin?: Origin;
}
export interface PutRequest extends Common {
  bytes: Uint8Array;
  declares?: MediaType;
  /** For a video: where each step starts and ends, so a receipt can open it at that step. */
  steps?: readonly Step[];
}
export interface LayerKey { id: string; parent: string | null; level: number }
export interface Step { step: string; startMs: number; endMs: number }
export interface TextRequest extends Common { run?: Run }
export interface TextSink { write(chunk: Uint8Array | string): Promise<void>; close(): Promise<PutResult> }
export interface Writer {
  put(request: PutRequest): Promise<PutResult>;
  /** A job's downloaded binary, streamed from disk rather than held whole in memory. */
  file(request: Common & { file: string; sha256?: string }): Promise<PutResult>;
  text(request: TextRequest): TextSink;
}

export type SlotReading = { state: 'captured' } | { state: 'truncated'; missing: string } | { state: 'missing'; reason: string };
export type PutResult =
  | { status: 'stored'; evidence: Evidence; slot: SlotReading }
  | { status: 'refused'; reason: string; slot: { state: 'missing'; reason: string } };

export interface Evidence {
  sha256: string;
  size: number;
  type: MediaType | 'text' | 'binary';
  kind: string;
  source: string;
  origin: Origin;
  redaction: Redaction;
  license: License;
  derivedFrom: readonly string[];
  intake: 'captured' | 'truncated';
  missing?: string;
  layer?: LayerKey;
  steps?: readonly Step[];
}

export interface RetainInput {
  cited: ReadonlySet<string>;
  archived: ReadonlySet<string>;
  /** Ids of the map layers installed now. */
  installed?: ReadonlySet<string>;
  /** Only files of these kinds are considered: a series' own pass on the hub's timer (#262). Default: every kind. */
  kinds?: ReadonlySet<string>;
}
export interface RetainResult { removed: string[] }
/**
 * `job` is a job tool's host (#1924): there a file goes under its origin rule alone, while its kind's own ask and budget
 * stand for the redaction and license rules that guard what people see in an export, a report or a post.
 */
export interface SendRequest { files: readonly string[]; via: ShareVia | 'job'; destination: string }
export interface ShareAsk { sha256: string; destination: string; via: ShareVia | 'job'; reason: string }
export interface SendBoundary {
  ask(question: ShareAsk): Promise<boolean>;
  deliver(file: { sha256: string; bytes: Uint8Array }, destination: string): Promise<void>;
}
export interface Receipt { sent: { sha256: string; destination: string }[]; withheld: { sha256: string; reason: string }[] }

export interface EvidenceStore {
  connect(peer: Peer): Writer;
  get(sha256: string): Promise<Evidence | undefined>;
  /** The bytes, checked against their hash. */
  read(sha256: string): Promise<Uint8Array>;
  /** A cached binary's bytes still match its hash, streamed without loading a large asset into memory. */
  verify(sha256: string): Promise<boolean>;
  /** Resolves only for a whole file, so a truncated one never becomes a baseline. */
  admitBaseline(sha256: string): Promise<void>;
  retain(input: RetainInput): Promise<RetainResult>;
  /** The only way evidence leaves the machine: by hash, after your yes where one is needed. */
  send(request: SendRequest, boundary: SendBoundary): Promise<Receipt>;
  /** Syncs each named file, its folder and that folder's name in the root, before a FULL commit names them (#1410). */
  sync(sha256s: readonly string[]): Promise<void>;
}

export class EvidenceError extends Error {
  constructor(readonly code: 'missing' | 'corrupt' | 'refused', message: string, readonly sha256?: string) {
    super(message);
    this.name = 'EvidenceError';
  }
}

/**
 * Text scrubbed as the store's text sink scrubs it: by the run's held and secret-looking env values, in
 * every printed form, and then by pattern. The record scrubs a hook payload's text fields with it before
 * it cuts them (#14, Privacy).
 */
export function scrubText(text: string, run?: Run): string {
  return scrub(Buffer.from(text, 'utf8'), scrubList(run)).toString('utf8');
}
/**
 * Each pattern rule's match in `scrubText(text)`, once, with its UTF-8 byte offset, and whether a field name's mask
 * covers part of it: the archive asks to rotate the keys among them (#20).
 */
export function patternMatches(text: string): { match: string; at: number; field: boolean }[] {
  const bytes = Buffer.from(text, 'utf8');
  return matchesOf(bytes).map(([match, field]) => ({ match: match.toString('utf8'), at: match.byteOffset - bytes.byteOffset, field }));
}
/**
 * Text scrubbed by value alone, in every printed form, with no pattern pass: a check run's output before its
 * digest (#30), whose pattern pass is the store's when it is stored.
 */
export function scrubValues(text: string, run: Run): string {
  return scrub(Buffer.from(text, 'utf8'), scrubList(run), false).toString('utf8');
}

const DAY = 86_400_000;
const RETENTION_MS = 30 * DAY;
// Uncited files of these kinds go sooner: a series' batches after a day, its minute rollups after a week (#262).
const KEPT_MS: Readonly<Record<string, number>> = { 'reading.batch': DAY, 'reading.rollup.minute': 7 * DAY };
// The archive's transcript copies are kept compressed (#20): a heavy month of them fits in under 2 GB on disk.
const PACKED: ReadonlySet<string> = new Set(['transcript-copy']);
const JOURNAL_IDLE_MS = 1000;
const pack = promisify(zstdCompress);
const unpack = promisify(zstdDecompress);
const REDACTIONS: readonly unknown[] = ['complete', 'incomplete', 'unknown'];
const HASH = /^[0-9a-f]{64}$/;
const hashOf = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

interface Stored extends Evidence { storedAt: number }
interface Approval { approved: string; reasons: string[] }

export async function openEvidenceStore(options: EvidenceStoreOptions = {}): Promise<EvidenceStore> {
  const root = options.root ?? join(homedir(), '.deepbuild', 'evidence');
  const now = options.now ?? Date.now;
  const fileOf = (sha: string) => join(root, sha.slice(0, 2), sha.slice(2));
  // A packed file sits beside where its plain one would, with .zst added.
  const packedOf = (sha: string) => `${fileOf(sha)}.zst`;
  // Each put appends its record, each removal its hash and each yes to a send its file, destination and
  // reasons to one journal; the last line for a hash wins.
  const journal = join(root, 'records.jsonl');
  const folders = new Set<string>(); // made in this process
  // Files and folders synced in this process: a FULL commit naming one again syncs nothing (#1410). A file is here by
  // the inode synced and its last change, and only once its folders are synced too, so one replaced since, by anyone,
  // or whose folder's sync failed, is synced again.
  const synced = new Map<string, string>();
  const stampOf = (s: { ino: bigint; ctimeNs: bigint }) => `${s.ino}:${s.ctimeNs}`;
  if (!options.readOnly) await mkdir(root, { recursive: true });
  const index = new Map<string, Stored>();
  // Your yes per file and destination, by the reasons it answered.
  const approved = new Map<string, Set<string>>();
  const lines = (await readFile(journal, 'utf8').catch(() => '')).split('\n');
  for (const line of lines) {
    let entry: Stored | { removed: string } | Approval;
    try { entry = JSON.parse(line) as typeof entry; } catch { continue; } // a line a crash cut short
    if ('removed' in entry) index.delete(entry.removed);
    else if ('approved' in entry) for (const reason of entry.reasons) (approved.get(entry.approved) ?? approved.set(entry.approved, new Set()).get(entry.approved)!).add(reason);
    else index.set(entry.sha256, entry);
  }
  if (!options.readOnly && lines.length > 2 * (index.size + approved.size) + 1000) {
    const kept = [...index.values(), ...[...approved].map(([pair, reasons]): Approval => ({ approved: pair, reasons: [...reasons] }))];
    await writeAtomic(journal, kept.map((entry) => `${JSON.stringify(entry)}\n`).join(''));
  }
  // The journal stays open while lines come, and closes once they stop for a second: opening it for each line cost
  // more than writing it (8 to 22 ms on a Mac whose scanner reads a file each time it is closed after a write).
  let held: Promise<FileHandle> | undefined;
  let idle: NodeJS.Timeout | undefined;
  let journaled: Promise<void> = Promise.resolve();
  const note = (entry: object): Promise<void> => (journaled = journaled.catch(() => undefined).then(async () => {
    clearTimeout(idle);
    try {
      await (await (held ??= open(journal, 'a'))).appendFile(`${JSON.stringify(entry)}\n`);
    } catch (error) {
      held = undefined;
      throw error;
    }
    idle = setTimeout(() => { void held?.then((h) => h.close()).catch(() => undefined); held = undefined; }, JOURNAL_IDLE_MS).unref();
  }));

  // Writes and removals of one hash run one at a time; a put waits on its hook outside this queue.
  const queues = new Map<string, Promise<unknown>>();
  const serial = <T>(sha: string, step: () => Promise<T>): Promise<T> => {
    const run = (queues.get(sha) ?? Promise.resolve()).then(step, step);
    const tail = run.catch(() => undefined);
    queues.set(sha, tail);
    void tail.then(() => { if (queues.get(sha) === tail) queues.delete(sha); });
    return run;
  };
  async function writeAtomic(path: string, data: Uint8Array | string) {
    if (!folders.has(dirname(path))) { await mkdir(dirname(path), { recursive: true }); folders.add(dirname(path)); }
    const temp = join(dirname(path), `.tmp-${randomUUID()}`);
    await writeFile(temp, data);
    await rename(temp, path);
  }
  /** Syncs what is at the path now, and says which file that was; nothing when it is gone. */
  async function syncOne(path: string): Promise<string | undefined> {
    const handle = await open(path, 'r').catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
    if (!handle) return undefined;
    try {
      const stamp = stampOf(await handle.stat({ bigint: true }));
      await handle.sync();
      return stamp;
    } finally { await handle.close(); }
  }
  const exists = (path: string) => access(path).then(() => true, () => false);
  const onDisk = async (sha: string) => (await exists(fileOf(sha))) || exists(packedOf(sha));

  const refuse = (reason: string): PutResult => ({ status: 'refused', reason, slot: { state: 'missing', reason } });
  const unlabelled = (request: Common) =>
    !REDACTIONS.includes(request.redaction) ? 'evidence needs a redaction label: complete, incomplete or unknown'
      : !Array.isArray(request.license?.allows) || typeof request.license.name !== 'string' ? 'evidence needs a license'
      : request.kind === 'layer.rows' && !request.layer ? 'a layer.rows file needs its layer, parent and level' : undefined;

  async function save(peer: Peer, request: Common & { steps?: readonly Step[] }, bytes: Uint8Array | { file: string; sha256: string; size: number }, type: Evidence['type'], redaction: Redaction, missing?: string): Promise<PutResult> {
    const file = 'file' in bytes ? bytes : undefined;
    const sha = file ? file.sha256 : hashOf(bytes as Uint8Array);
    const derivedFrom = [...(request.derivedFrom ?? [])];
    const steps = request.steps?.map(({ step, startMs, endMs }) => ({ step, startMs, endMs }));
    // An input that is gone or unknown might have been an agent's, so it counts as one.
    const fromAgent = derivedFrom.some((input) => (index.get(input)?.origin ?? 'agent') === 'agent');
    // A hash the index has never held is written without asking the disk: rewriting the same bytes is harmless.
    const existed = index.has(sha) && await onDisk(sha);
    await options.hooks?.afterExistsCheck?.(sha);
    return serial(sha, async () => {
      if (file || !existed || !(await onDisk(sha))) {
        if (file) {
          const path = fileOf(sha);
          await mkdir(dirname(path), { recursive: true });
          await rename(file.file, path);
        } else {
          const data = bytes as Uint8Array;
          await (PACKED.has(request.kind) ? writeAtomic(packedOf(sha), await pack(data)) : writeAtomic(fileOf(sha), data));
        }
      }
      const earlier = index.get(sha);
      const record: Stored = {
        sha256: sha, size: file ? file.size : (bytes as Uint8Array).length, type, kind: request.kind, source: request.source,
        // The same bytes keep the most cautious origin and label any writer gave them.
        origin: fromAgent || peer.role === 'agent' || earlier?.origin === 'agent' ? 'agent' : peer.role,
        redaction: earlier && earlier.redaction !== 'complete' ? earlier.redaction : redaction,
        license: request.license, derivedFrom, intake: missing ? 'truncated' : 'captured', ...(missing && { missing }),
        ...(request.layer && { layer: request.layer }), ...(steps && { steps }), storedAt: now(),
      };
      index.set(sha, record);
      await note(record);
      const { storedAt: _, ...evidence } = record;
      return { status: 'stored', evidence, slot: missing ? { state: 'truncated', missing } : { state: 'captured' } };
    });
  }

  const read = async (sha: string): Promise<Uint8Array> => {
    let bytes = HASH.test(sha) ? await readFile(fileOf(sha)).catch(() => undefined) : undefined;
    if (!bytes && HASH.test(sha)) {
      const packed = await readFile(packedOf(sha)).catch(() => undefined);
      if (packed) bytes = await unpack(packed).catch(() => { throw new EvidenceError('corrupt', `evidence ${sha} is corrupt: its file no longer unpacks`, sha); });
    }
    if (!bytes) throw new EvidenceError('missing', `evidence ${sha} is missing`, sha);
    if (hashOf(bytes) !== sha) throw new EvidenceError('corrupt', `evidence ${sha} is corrupt: its bytes no longer match its hash`, sha);
    return new Uint8Array(bytes);
  };

  return {
    connect: (peer) => ({
      async put(request) {
        const invalid = unlabelled(request);
        if (invalid) return refuse(invalid);
        const backwards = request.steps?.find(({ startMs, endMs }) => !(startMs >= 0 && endMs >= startMs));
        if (backwards) return refuse(`step ${backwards.step} must start at 0 ms or later and end no earlier than it starts`);
        if (request.declares === undefined) return save(peer, request, request.bytes, 'binary', request.redaction);
        const found = detect(request.bytes);
        if (found !== request.declares) return refuse(`the slot declares ${request.declares}, but the bytes are ${found ?? 'not png, jpeg, mp4 or webm'}`);
        return save(peer, request, request.bytes, found, request.redaction, missingEnd(found, request.bytes));
      },
      async file(request) {
        const invalid = unlabelled(request);
        if (invalid) return refuse(invalid);
        // Hash the store's private copy, not a path that can change between its hash and the copy.
        const file = join(root, `.tmp-${randomUUID()}`);
        try {
          await copyFile(request.file, file);
          const hash = createHash('sha256');
          for await (const chunk of createReadStream(file)) hash.update(chunk);
          const sha256 = hash.digest('hex');
          if (request.sha256 !== undefined && request.sha256 !== sha256) return refuse(`file bytes do not match listed sha256 ${request.sha256}; nothing kept`);
          return await save(peer, request, { file, sha256, size: (await stat(file)).size }, 'binary', request.redaction);
        } finally { await rm(file, { force: true }); }
      },
      text(request) {
        const chunks: Buffer[] = [];
        return {
          async write(chunk) { chunks.push(Buffer.from(chunk)); },
          async close() {
            const invalid = unlabelled(request);
            if (invalid) return refuse(invalid);
            const raw = Buffer.concat(chunks);
            // The scrub can't find a value's forms in text that isn't UTF-8.
            const redaction = isUtf8(raw) || request.redaction !== 'complete' ? request.redaction : 'incomplete';
            return save(peer, request, scrub(raw, scrubList(request.run)), 'text', redaction);
          },
        };
      },
    }),

    async get(sha) {
      const record = index.get(sha);
      if (!record) return undefined;
      const { storedAt: _, ...evidence } = record;
      return evidence;
    },

    read,

    async verify(sha) {
      if (!HASH.test(sha) || !index.has(sha)) return false;
      try {
        if (!await exists(fileOf(sha))) { await read(sha); return true; }
        const hash = createHash('sha256');
        for await (const chunk of createReadStream(fileOf(sha))) hash.update(chunk);
        return hash.digest('hex') === sha;
      } catch { return false; }
    },

    async admitBaseline(sha) {
      const record = index.get(sha);
      if (!record) throw new EvidenceError('refused', `no evidence ${sha} to take as a baseline`, sha);
      if (record.intake === 'truncated') throw new EvidenceError('refused', `evidence ${sha} is truncated (missing ${record.missing}), so it can't be a baseline`, sha);
      await read(sha).catch((error: Error) => { throw new EvidenceError('refused', `${error.message}, so it can't be a baseline`, sha); });
    },

    async retain({ cited, archived, installed = new Set(), kinds }) {
      const at = now();
      // The newest rows file of each installed layer, parent and level stays while the layer is installed (#259).
      const newest = new Map<string, number>();
      const slotOf = ({ layer, kind }: Stored) => (kind === 'layer.rows' && layer && installed.has(layer.id) ? JSON.stringify([layer.id, layer.parent, layer.level]) : undefined);
      for (const record of index.values()) {
        const key = slotOf(record);
        if (key !== undefined) newest.set(key, Math.max(newest.get(key) ?? -Infinity, record.storedAt));
      }
      const expired = (sha: string) => {
        const record = index.get(sha);
        if (!record || cited.has(sha) || archived.has(sha) || (kinds && !kinds.has(record.kind))) return false;
        const key = slotOf(record);
        return (key === undefined || newest.get(key) !== record.storedAt) && at - record.storedAt > (KEPT_MS[record.kind] ?? RETENTION_MS);
      };
      const removed: string[] = [];
      await Promise.all([...index.keys()].filter(expired).map((sha) => serial(sha, async () => {
        if (!expired(sha)) return; // stored again since the pass began
        index.delete(sha);
        await Promise.all([rm(fileOf(sha), { force: true }), rm(packedOf(sha), { force: true })]);
        await note({ removed: sha });
        removed.push(sha);
      })));
      return { removed };
    },

    // Off the caller's thread, on libuv's pool, so the hub's core answers hooks meanwhile. A file this process didn't
    // write, or wrote before a restart, is synced too: nothing says its writer did. A rename lasts once its folder is
    // synced, and a folder made since the last cut once the root is.
    async sync(sha256s) {
      // A file that is gone has nothing to sync, and reads as missing; one that can't be looked at refuses the sync.
      const unsynced = async (path: string) => stat(path, { bigint: true }).then((s) => (synced.get(path) === stampOf(s) ? [] : [path]), (error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
        return undefined;
      });
      const where = async (sha: string) => (!HASH.test(sha) ? [] : await unsynced(fileOf(sha)) ?? await unsynced(packedOf(sha)) ?? []);
      // Again while any is unsynced: a file replaced during the pass is a new file its folder's sync made last.
      for (;;) {
        const files = (await Promise.all([...new Set(sha256s)].map(where))).flat();
        if (!files.length) return;
        const stamps = await Promise.all(files.map(syncOne));
        const folders = [...new Set(files.map((path) => dirname(path)))];
        // The root holds the name of each folder this process hasn't synced yet, and its own parent the root's, once.
        const above = folders.some((folder) => !synced.has(folder)) ? [root, ...(synced.has(dirname(root)) ? [] : [dirname(root)])] : [];
        await Promise.all([...folders, ...above].map(syncOne));
        for (const path of [...folders, ...above]) synced.set(path, '');
        for (const [i, path] of files.entries()) { const stamp = stamps[i]; if (stamp !== undefined) synced.set(path, stamp); }
      }
    },

    async send({ files, via, destination }, boundary) {
      if (files.some((file) => !HASH.test(file))) throw new EvidenceError('refused', 'files leave the machine only by hash, and this request named a path');
      const receipt: Receipt = { sent: [], withheld: [] };
      for (const sha of files) {
        const record = index.get(sha);
        if (!record) {
          receipt.withheld.push({ sha256: sha, reason: `evidence ${sha} is missing` });
          continue;
        }
        let bytes: Uint8Array;
        try {
          bytes = await read(sha);
        } catch (error) {
          receipt.withheld.push({ sha256: sha, reason: (error as Error).message });
          continue;
        }
        const pair = `${sha} ${destination}`;
        const yes = approved.get(pair) ?? new Set<string>();
        const reasons = [
          record.origin === 'agent' && 'an agent put it there',
          via !== 'job' && record.redaction !== 'complete' && `its redaction is ${record.redaction}`,
          via !== 'job' && !record.license.allows.includes(via) && `its license ${record.license.name} doesn't allow ${via}`,
        ].filter((reason): reason is string => !!reason && !yes.has(reason));
        if (reasons.length) {
          if (!(await boundary.ask({ sha256: sha, destination, via, reason: reasons.join('; ') }))) {
            receipt.withheld.push({ sha256: sha, reason: `you said no: ${reasons.join('; ')}` });
            continue;
          }
          for (const reason of reasons) yes.add(reason);
          approved.set(pair, yes);
          await note({ approved: pair, reasons } satisfies Approval);
        }
        await boundary.deliver({ sha256: sha, bytes }, destination);
        receipt.sent.push({ sha256: sha, destination });
      }
      return receipt;
    },
  };
}
