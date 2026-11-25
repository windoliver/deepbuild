import { createHash, randomUUID, type Hash } from 'node:crypto';
import { isUtf8 } from 'node:buffer';
import { createReadStream } from 'node:fs';
import { access, copyFile, mkdir, open, readFile, rename, rm, stat, writeFile, type FileHandle } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { createZstdDecompress, zstdCompress, zstdDecompress } from 'node:zlib';
import { detect, missingEnd, type MediaType } from './intake.js';
import { Records } from './records.js';
import { scrub, scrubList, type Run } from './scrub.js';
export { scrubText, patternMatches, scrubValues, scrubPrefix } from './scrubbing.js';
// The digest and its worker load with the first joined copy that needs a resumable hash, not with every store.
import type { DigestState } from './digest.js';

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

/** Turns bytes into ones that say nothing without a key, and back. The same bytes always seal to the same ones. */
export interface Sealer { seal(bytes: Uint8Array): Promise<Uint8Array>; unseal(sealed: Uint8Array): Promise<Uint8Array> }

export interface EvidenceStoreOptions {
  root?: string;
  now?: () => number;
  /** For a caller that only gets and reads, such as `deep read`: opening makes no folder and never compacts the journal. */
  readOnly?: boolean;
  /** Seals what asks to be kept sealed (#3229); without one, such a put is refused and nothing sealed reads back. */
  sealer?: Sealer;
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
  /** Kept sealed (#3229): the store holds the sealed bytes, by their own hash, and only `unseal` gives the plain ones back. */
  sealed?: true;
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
  /** Parts are immutable evidence, joined in order under the hash of their concatenation. */
  put(request: PutRequest | (Common & { parts: readonly string[] })): Promise<PutResult>;
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
  /** Storage parts, not provenance: their concatenation has this evidence's size and hash. */
  parts?: readonly string[];
  intake: 'captured' | 'truncated';
  missing?: string;
  layer?: LayerKey;
  steps?: readonly Step[];
  /** Kept sealed (#3229): no read returns its bytes. */
  sealed?: true;
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
  /** The bytes, checked against their hash; a sealed file's are refused (#3229). */
  read(sha256: string): Promise<Uint8Array>;
  /** A sealed file's plain bytes, for the hub alone; any other file's as `read` gives them. */
  unseal(sha256: string): Promise<Uint8Array>;
  /** Verified bytes in order, without materializing a whole transcript; a sealed file's are refused. */
  chunks(sha256: string): AsyncIterable<Uint8Array>;
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

const DAY = 86_400_000;
const RETENTION_MS = 30 * DAY;
// Uncited files of these kinds go sooner: a series' batches after a day, its minute rollups after a week (#262).
const KEPT_MS: Readonly<Record<string, number>> = { 'reading.batch': DAY, 'reading.rollup.minute': 7 * DAY };
// The archive's transcript copies are kept compressed (#20): a heavy month of them fits in under 2 GB on disk.
const PACKED: ReadonlySet<string> = new Set(['transcript-copy']);
const JOURNAL_IDLE_MS = 1000;
// A joined copy under this size keeps no resumable hash: reading it once more after a restart costs less than hashing
// every small copy in JavaScript, about fifty times the instructions of the native hash.
const RESUMABLE = 8 * 1024 * 1024;
const pack = promisify(zstdCompress);
const unpack = promisify(zstdDecompress);
const REDACTIONS: readonly unknown[] = ['complete', 'incomplete', 'unknown'];
const HASH = /^[0-9a-f]{64}$/;
const hashOf = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export interface Stored extends Evidence { storedAt: number; continuation?: DigestState }
interface Approval { approved: string; reasons: string[] }

export async function openEvidenceStore(options: EvidenceStoreOptions = {}): Promise<EvidenceStore> {
  const root = options.root ?? join(homedir(), '.deepbuild', 'evidence');
  const now = options.now ?? Date.now;
  const fileOf = (sha: string) => join(root, sha.slice(0, 2), sha.slice(2));
  // A packed file sits beside where its plain one would, with .zst added.
  const packedOf = (sha: string) => `${fileOf(sha)}.zst`;
  const partsOf = (sha: string) => `${fileOf(sha)}.parts`;
  // Continuations persist with verified manifests. A prefix lookup uses its last part, not a scan of all evidence.
  // A small joined copy made by this process keeps its running hash here instead, one for each copy still current,
  // so a copy that gains parts goes on from it and reads none of the parts before.
  const hashes = new Map<string, Hash>();
  const prefixes = new Map<string, Set<string>>();
  const remember = (entry: Stored) => {
    if (entry.parts?.length && (entry.continuation || hashes.has(entry.sha256))) {
      const last = entry.parts.at(-1)!;
      (prefixes.get(last) ?? prefixes.set(last, new Set()).get(last)!).add(entry.sha256);
    }
  };
  // Each put appends its record, each removal its hash and each yes to a send its file, destination and
  // reasons to one journal; the last line for a hash wins.
  const journal = join(root, 'records.jsonl');
  const folders = new Set<string>(); // made in this process
  // Files and folders synced in this process: a FULL commit naming one again syncs nothing (#1410). A file is here by
  // the inode synced and its last change, and only once its folders are synced too, so one replaced since, by anyone,
  // or whose folder's sync failed, is synced again.
  // A file of a record keeps its stamp with the record, so nothing grows here with the files synced (#1866).
  const synced = new Map<string, string>();
  type Stamp = { ino: bigint; ctimeNs: bigint };
  const stampOf = (s: Stamp) => `${s.ino}:${s.ctimeNs}`;
  const syncedAt = (sha: string, path: string, s: Stamp): boolean => {
    const kept = index.synced(sha);
    return kept ? kept.ino === s.ino && kept.ctimeNs === s.ctimeNs : synced.get(path) === stampOf(s);
  };
  if (!options.readOnly) await mkdir(root, { recursive: true });
  const index = new Records(journal);
  // Your yes per file and destination, by the reasons it answered.
  const approved = new Map<string, Set<string>>();
  let text: Buffer = await readFile(journal).catch(() => Buffer.alloc(0));
  // The joined copies whose hash goes on from what their line keeps.
  const continued = new Map<string, Stored>();
  const lines = index.take(text, (line) => {
    if ('removed' in line) continued.delete(line.removed);
    else if ('approved' in line) for (const reason of line.reasons) (approved.get(line.approved) ?? approved.set(line.approved, new Set()).get(line.approved)!).add(reason);
    else if (line.continuation) continued.set(line.sha256, line);
    else continued.delete(line.sha256);
  });
  for (const entry of continued.values()) remember(entry);
  continued.clear();
  if (!options.readOnly && lines > 2 * (index.size + approved.size) + 1000) {
    const newline = Buffer.from('\n');
    const kept = [...index.lines(text), ...[...approved].map(([pair, reasons]) => Buffer.from(JSON.stringify({ approved: pair, reasons: [...reasons] } satisfies Approval)))];
    text = Buffer.concat(kept.flatMap((line) => [line, newline]));
    // It replaces a journal whose lines a FULL commit may have synced, so it lasts before it does (#1410).
    await writeAtomic(journal, text, true);
    await syncOne(root);
    index.clear();
    index.take(text, () => undefined);
  }
  /** Where the journal's next line begins. */
  let end = text.length;
  // The journal stays open while lines come, and closes once they stop for a second: opening it for each line cost
  // more than writing it (8 to 22 ms on a Mac whose scanner reads a file each time it is closed after a write).
  let held: Promise<FileHandle> | undefined;
  let idle: NodeJS.Timeout | undefined;
  let journaled: Promise<void> = Promise.resolve();
  const note = (entry: Stored | { removed: string } | Approval): Promise<void> => (journaled = journaled.catch(() => undefined).then(async () => {
    clearTimeout(idle);
    let handle: FileHandle | undefined;
    const line = Buffer.from(`${JSON.stringify(entry)}\n`);
    try {
      handle = await (held ??= open(journal, 'a'));
      await handle.appendFile(line);
    } catch (error) {
      held = undefined;
      await handle?.close().catch(() => undefined);
      // Part of the line may be there: where the next begins is read again.
      end = await stat(journal).then((s) => s.size, () => 0);
      throw error;
    }
    if ('sha256' in entry) index.placed(entry, end, line.length - 1);
    end += line.length;
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
  /** Replaces the file at the path whole; `lasting` syncs the new one first, for a file that may have been synced. */
  async function writeAtomic(path: string, data: Uint8Array | string, lasting = false) {
    if (!folders.has(dirname(path))) { await mkdir(dirname(path), { recursive: true }); folders.add(dirname(path)); }
    const temp = join(dirname(path), `.tmp-${randomUUID()}`);
    await writeFile(temp, data);
    if (lasting) await syncOne(temp);
    await rename(temp, path);
  }
  /** Syncs what is at the path now, and says which file that was; nothing when it is gone. */
  async function syncOne(path: string): Promise<Stamp | undefined> {
    const handle = await open(path, 'r').catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
    if (!handle) return undefined;
    try {
      const { ino, ctimeNs } = await handle.stat({ bigint: true });
      await handle.sync();
      return { ino, ctimeNs };
    } finally { await handle.close(); }
  }
  const exists = (path: string) => access(path).then(() => true, () => false);
  // A manifest is looked for only where one can be: for a joined copy, put now or held by the index.
  const onDisk = async (sha: string, joined = false) => (await exists(fileOf(sha))) || (await exists(packedOf(sha))) || ((joined || index.field(sha)?.parts === true) && exists(partsOf(sha)));

  const refuse = (reason: string): PutResult => ({ status: 'refused', reason, slot: { state: 'missing', reason } });
  const unlabelled = (request: Common) =>
    request.sealed && !options.sealer ? 'this store has no sealer, so it keeps nothing sealed'
      : !REDACTIONS.includes(request.redaction) ? 'evidence needs a redaction label: complete, incomplete or unknown'
      : !Array.isArray(request.license?.allows) || typeof request.license.name !== 'string' ? 'evidence needs a license'
      : request.kind === 'layer.rows' && !request.layer ? 'a layer.rows file needs its layer, parent and level' : undefined;

  async function save(peer: Peer, request: Common & { steps?: readonly Step[] }, bytes: Uint8Array | { file: string; sha256: string; size: number } | { parts: readonly string[]; sha256: string; size: number; continuation?: DigestState }, type: Evidence['type'], redaction: Redaction, missing?: string): Promise<PutResult> {
    const file = 'file' in bytes ? bytes : undefined;
    const joined = 'parts' in bytes ? bytes : undefined;
    const sha = file?.sha256 ?? joined?.sha256 ?? hashOf(bytes as Uint8Array);
    const derivedFrom = [...(request.derivedFrom ?? [])];
    const steps = request.steps?.map(({ step, startMs, endMs }) => ({ step, startMs, endMs }));
    // An input that is gone or unknown might have been an agent's, so it counts as one.
    const fromAgent = [...derivedFrom, ...(joined?.parts ?? [])].some((input) => (index.field(input)?.origin ?? 'agent') === 'agent');
    // A hash the index has never held is written without asking the disk: rewriting the same bytes is harmless.
    const existed = index.has(sha) && await onDisk(sha);
    await options.hooks?.afterExistsCheck?.(sha);
    return serial(sha, async () => {
      // A file already there, whoever wrote it, may be one a FULL commit synced: what replaces it lasts first (#1410).
      const there = await onDisk(sha, joined !== undefined);
      if (file || !existed || !there) {
        if (joined) {
          await writeAtomic(partsOf(sha), JSON.stringify(joined.parts), there);
        } else if (file) {
          const path = fileOf(sha);
          await mkdir(dirname(path), { recursive: true });
          if (there) await syncOne(file.file);
          await rename(file.file, path);
        } else {
          const data = bytes as Uint8Array;
          await (PACKED.has(request.kind) ? writeAtomic(packedOf(sha), await pack(data), there) : writeAtomic(fileOf(sha), data, there));
        }
      }
      const earlier = index.get(sha);
      const record: Stored = {
        sha256: sha, size: file?.size ?? joined?.size ?? (bytes as Uint8Array).length, type, kind: request.kind, source: request.source,
        ...(joined && !existed ? { parts: [...joined.parts], ...(joined.continuation ? { continuation: joined.continuation } : {}) } : earlier?.parts ? { parts: earlier.parts, ...(earlier.continuation ? { continuation: earlier.continuation } : {}) } : {}),
        // The same bytes keep the most cautious origin and label any writer gave them.
        origin: fromAgent || peer.role === 'agent' || earlier?.origin === 'agent' ? 'agent' : peer.role,
        redaction: earlier && earlier.redaction !== 'complete' ? earlier.redaction : redaction,
        license: request.license, derivedFrom, intake: missing ? 'truncated' : 'captured', ...(missing && { missing }),
        ...(request.layer && { layer: request.layer }), ...(steps && { steps }), ...((request.sealed || earlier?.sealed) && { sealed: true as const }), storedAt: now(),
      };
      index.set(record);
      await note(record);
      remember(record);
      const { storedAt: _, continuation: _continuation, ...evidence } = record;
      return { status: 'stored', evidence, slot: missing ? { state: 'truncated', missing } : { state: 'captured' } };
    });
  }

  /** Why a sealed file isn't read: by what it is, never its bytes (#3229). */
  const unsealedOnly = (sha: string): void => {
    if (index.field(sha)?.sealed) throw new EvidenceError('refused', `evidence ${sha} is ${index.get(sha)?.source ?? 'a sealed file'}, kept sealed: no read returns its bytes`, sha);
  };
  async function* chunks(sha: string, parents: ReadonlySet<string> = new Set()): AsyncGenerator<Uint8Array> {
    unsealedOnly(sha);
    if (!HASH.test(sha)) throw new EvidenceError('missing', `evidence ${sha} is missing`, sha);
    if (parents.has(sha)) throw new EvidenceError('corrupt', `evidence ${sha} has cyclic parts`, sha);
    const hash = createHash('sha256');
    const consume = async function* (): AsyncGenerator<Uint8Array> {
      if (index.field(sha)?.parts) {
        const parts: unknown = JSON.parse(await readFile(partsOf(sha), 'utf8'));
        if (!Array.isArray(parts) || !parts.every((p) => typeof p === 'string' && HASH.test(p))) throw new EvidenceError('corrupt', `evidence ${sha} has corrupt parts`, sha);
        const chain = new Set([...parents, sha]);
        for (const part of parts as string[]) yield* chunks(part, chain);
      } else {
        const plain = await exists(fileOf(sha));
        const input = createReadStream(plain ? fileOf(sha) : packedOf(sha));
        const stream = plain ? input : input.pipe(createZstdDecompress());
        const failed = (error: Error) => stream.destroy(error);
        input.on('error', failed);
        try { for await (const bytes of stream) yield bytes as Buffer; }
        finally { input.removeListener('error', failed); input.destroy(); stream.destroy(); }
      }
    };
    try { for await (const bytes of consume()) { hash.update(bytes); yield bytes; } }
    catch (error) { throw new EvidenceError('corrupt', `evidence ${sha} is corrupt or missing: ${error instanceof Error ? error.message : String(error)}`, sha); }
    if (hash.digest('hex') !== sha) throw new EvidenceError('corrupt', `evidence ${sha} is corrupt: its bytes no longer match its hash`, sha);
  }
  const read = async (sha: string): Promise<Uint8Array> => {
    unsealedOnly(sha);
    return stored(sha);
  };
  const stored = async (sha: string): Promise<Uint8Array> => {
    if (index.field(sha)?.parts) {
      const parts: Uint8Array[] = [];
      for await (const bytes of chunks(sha)) parts.push(bytes);
      return Buffer.concat(parts);
    }
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
        if ('parts' in request) {
          if (request.parts.some((p) => !HASH.test(p) || !index.has(p))) return refuse('every part must be stored evidence');
          const size = request.parts.reduce((sum, p) => sum + index.field(p)!.size, 0);
          // One leaf already has the desired bytes and ordinary SHA; do not invent a self-referencing manifest.
          if (request.parts.length === 1) {
            const leafRedaction = index.field(request.parts[0]!)!.redaction;
            return save(peer, request, await read(request.parts[0]!), 'text', leafRedaction !== 'complete' ? leafRedaction : request.redaction);
          }
          let prefix: Stored | undefined;
          for (let n = request.parts.length - 1; n >= 0 && !prefix; n--) {
            for (const sha of prefixes.get(request.parts[n]!) ?? []) {
              const found = index.get(sha);
              if (found?.parts?.length === n + 1 && found.parts.every((p, k) => p === request.parts[k]) && (found.continuation || hashes.has(sha))) {
                if (found.continuation && new (await import('./digest.js')).Digest(found.continuation).hex() !== sha) throw new EvidenceError('corrupt', `evidence ${sha} has a corrupt hash continuation`, sha);
                prefix = found; break;
              }
            }
          }
          const from = async function* (start: number) { for (const part of request.parts.slice(start)) yield* chunks(part); };
          const running = prefix && hashes.get(prefix.sha256);
          let sha256: string, continuation: DigestState | undefined;
          if (size < RESUMABLE && (!prefix || running)) {
            const hash = running ? running.copy() : createHash('sha256');
            for await (const bytes of from(prefix?.parts?.length ?? 0)) hash.update(bytes);
            sha256 = hash.copy().digest('hex');
            hashes.set(sha256, hash);
          } else ({ sha256, state: continuation } = await (await import('./continuation.js')).continueDigest(prefix?.continuation, from(prefix?.continuation ? prefix.parts!.length : 0)));
          if (prefix && prefix.sha256 !== sha256) hashes.delete(prefix.sha256);
          const redaction = request.parts.some((p) => index.field(p)!.redaction !== 'complete') ? 'incomplete' : request.redaction;
          return save(peer, request, { parts: request.parts, sha256, size, ...(continuation ? { continuation } : {}) }, 'text', redaction);
        }
        const backwards = request.steps?.find(({ startMs, endMs }) => !(startMs >= 0 && endMs >= startMs));
        if (backwards) return refuse(`step ${backwards.step} must start at 0 ms or later and end no earlier than it starts`);
        if (request.sealed) return save(peer, request, await options.sealer!.seal(request.bytes), 'binary', request.redaction);
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
            const text = scrub(raw, scrubList(request.run));
            return request.sealed ? save(peer, request, await options.sealer!.seal(text), 'binary', redaction) : save(peer, request, text, 'text', redaction);
          },
        };
      },
    }),

    async get(sha) {
      const record = index.get(sha);
      if (!record) return undefined;
      // A freshly linked concatenation checks its small manifest back against what was written; its leaves were
      // already read back at intake. Do not inflate them all merely to check a new link's ordered part list.
      if (record.parts) {
        let parts: unknown;
        try { parts = JSON.parse(await readFile(partsOf(sha), 'utf8')); }
        catch { throw new EvidenceError('corrupt', `evidence ${sha} has missing or corrupt parts`, sha); }
        if (!Array.isArray(parts) || parts.length !== record.parts.length || parts.some((p, n) => p !== record.parts![n])) throw new EvidenceError('corrupt', `evidence ${sha} parts did not read back as written`, sha);
      }
      const { storedAt: _, continuation: _continuation, ...evidence } = record;
      return evidence;
    },

    read,
    async unseal(sha) {
      return index.field(sha)?.sealed ? options.sealer!.unseal(await stored(sha)) : read(sha);
    },
    chunks,

    async verify(sha) {
      if (!HASH.test(sha) || !index.has(sha)) return false;
      try {
        if (!await exists(fileOf(sha))) { for await (const bytes of chunks(sha)) void bytes; return true; }
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
      const kept = new Set([...cited, ...archived]);
      const partsOfRecord = (sha: string): readonly string[] => (index.field(sha)?.parts ? index.get(sha)?.parts ?? [] : []);
      const hold = (sha: string): void => { for (const part of partsOfRecord(sha)) if (!kept.has(part)) { kept.add(part); hold(part); } };
      for (const sha of kept) hold(sha);
      // The newest rows file of each installed layer, parent and level stays while the layer is installed (#259).
      const newest = new Map<string, number>();
      const slotOf = (sha: string, kind: string) => {
        const layer = kind === 'layer.rows' && installed.size ? index.get(sha)?.layer : undefined;
        return layer && installed.has(layer.id) ? JSON.stringify([layer.id, layer.parent, layer.level]) : undefined;
      };
      for (const [sha, record] of index.each()) {
        const key = slotOf(sha, record.kind);
        if (key !== undefined) newest.set(key, Math.max(newest.get(key) ?? -Infinity, record.storedAt));
      }
      const expired = (sha: string) => {
        const record = index.field(sha);
        if (!record || kept.has(sha) || (kinds && !kinds.has(record.kind))) return false;
        const key = slotOf(sha, record.kind);
        return (key === undefined || newest.get(key) !== record.storedAt) && at - record.storedAt > (KEPT_MS[record.kind] ?? RETENTION_MS);
      };
      const removed: string[] = [];
      const old: string[] = [];
      for (const [sha] of index.each()) if (expired(sha)) old.push(sha);
      await Promise.all(old.map((sha) => serial(sha, async () => {
        if (!expired(sha)) return; // stored again since the pass began
        const parts = index.field(sha)?.parts ? index.get(sha)?.parts : undefined;
        index.delete(sha);
        hashes.delete(sha);
        if (parts?.length) {
          const last = parts.at(-1)!;
          prefixes.get(last)?.delete(sha);
          if (!prefixes.get(last)?.size) prefixes.delete(last);
        }
        await Promise.all([fileOf(sha), packedOf(sha), ...(parts ? [partsOf(sha)] : [])].map((path) => rm(path, { force: true })));
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
      const unsynced = async (sha: string, path: string) => stat(path, { bigint: true }).then((s) => (syncedAt(sha, path, s) ? [] : [{ sha, path }]), (error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
        return undefined;
      });
      const where = async (sha: string) => (!HASH.test(sha) ? [] : await unsynced(sha, fileOf(sha)) ?? await unsynced(sha, packedOf(sha)) ?? await unsynced(sha, partsOf(sha)) ?? []);
      // A joined copy is its manifest and the files of the parts it lists, a part that is joined in turn too.
      const named = new Set(sha256s);
      for (const sha of named) for (const part of index.field(sha)?.parts ? index.get(sha)?.parts ?? [] : []) named.add(part);
      // Again while any is unsynced: a file replaced during the pass is a new file its folder's sync made last.
      for (;;) {
        const files = (await Promise.all([...named].map(where))).flat();
        if (!files.length) return;
        const stamps = await Promise.all(files.map(({ path }) => syncOne(path)));
        const folders = [...new Set(files.map(({ path }) => dirname(path)))];
        // The root holds the name of each folder this process hasn't synced yet, and its own parent the root's, once.
        const above = folders.some((folder) => !synced.has(folder)) ? [root, ...(synced.has(dirname(root)) ? [] : [dirname(root)])] : [];
        await Promise.all([...folders, ...above].map(syncOne));
        for (const path of [...folders, ...above]) synced.set(path, '');
        // A file is found by its line in the journal, written before its put returned: it counts as synced once that is.
        await journaled.catch(() => undefined);
        await syncOne(journal);
        for (const [i, { sha, path }] of files.entries()) { const stamp = stamps[i]; if (stamp !== undefined && !index.sync(sha, stamp)) synced.set(path, stampOf(stamp)); }
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
