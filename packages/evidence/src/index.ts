import { createHash, randomUUID } from 'node:crypto';
import { isUtf8 } from 'node:buffer';
import { access, appendFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { detect, missingEnd, type MediaType } from './intake.js';
import { scrub, scrubList, type Run } from './scrub.js';

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
export interface Writer { put(request: PutRequest): Promise<PutResult>; text(request: TextRequest): TextSink }

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
}
export interface RetainResult { removed: string[] }
export interface SendRequest { files: readonly string[]; via: ShareVia; destination: string }
export interface ShareAsk { sha256: string; destination: string; via: ShareVia; reason: string }
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
  /** Resolves only for a whole file, so a truncated one never becomes a baseline. */
  admitBaseline(sha256: string): Promise<void>;
  retain(input: RetainInput): Promise<RetainResult>;
  /** The only way evidence leaves the machine: by hash, after your yes where one is needed. */
  send(request: SendRequest, boundary: SendBoundary): Promise<Receipt>;
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

const DAY = 86_400_000;
const RETENTION_MS = 30 * DAY;
// Uncited files of these kinds go sooner: a series' batches after a day, its minute rollups after a week (#262).
const KEPT_MS: Readonly<Record<string, number>> = { 'reading.batch': DAY, 'reading.rollup.minute': 7 * DAY };
const REDACTIONS: readonly unknown[] = ['complete', 'incomplete', 'unknown'];
const HASH = /^[0-9a-f]{64}$/;
const hashOf = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

interface Stored extends Evidence { storedAt: number }
interface Approval { approved: string; reasons: string[] }

export async function openEvidenceStore(options: EvidenceStoreOptions = {}): Promise<EvidenceStore> {
  const root = options.root ?? join(homedir(), '.deepbuild', 'evidence');
  const now = options.now ?? Date.now;
  const fileOf = (sha: string) => join(root, sha.slice(0, 2), sha.slice(2));
  // Each put appends its record, each removal its hash and each yes to a send its file, destination and
  // reasons to one journal; the last line for a hash wins.
  const journal = join(root, 'records.jsonl');
  const folders = new Set<string>(); // made in this process
  await mkdir(root, { recursive: true });
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
  if (lines.length > 2 * (index.size + approved.size) + 1000) {
    const kept = [...index.values(), ...[...approved].map(([pair, reasons]): Approval => ({ approved: pair, reasons: [...reasons] }))];
    await writeAtomic(journal, kept.map((entry) => `${JSON.stringify(entry)}\n`).join(''));
  }

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
  const exists = (path: string) => access(path).then(() => true, () => false);

  const refuse = (reason: string): PutResult => ({ status: 'refused', reason, slot: { state: 'missing', reason } });
  const unlabelled = (request: Common) =>
    !REDACTIONS.includes(request.redaction) ? 'evidence needs a redaction label: complete, incomplete or unknown'
      : !Array.isArray(request.license?.allows) || typeof request.license.name !== 'string' ? 'evidence needs a license'
      : request.kind === 'layer.rows' && !request.layer ? 'a layer.rows file needs its layer, parent and level' : undefined;

  async function save(peer: Peer, request: Common & { steps?: readonly Step[] }, bytes: Uint8Array, type: Evidence['type'], redaction: Redaction, missing?: string): Promise<PutResult> {
    const sha = hashOf(bytes);
    const derivedFrom = [...(request.derivedFrom ?? [])];
    const steps = request.steps?.map(({ step, startMs, endMs }) => ({ step, startMs, endMs }));
    // An input that is gone or unknown might have been an agent's, so it counts as one.
    const fromAgent = derivedFrom.some((input) => (index.get(input)?.origin ?? 'agent') === 'agent');
    const existed = await exists(fileOf(sha));
    await options.hooks?.afterExistsCheck?.(sha);
    return serial(sha, async () => {
      if (!existed || !(await exists(fileOf(sha)))) await writeAtomic(fileOf(sha), bytes);
      const earlier = index.get(sha);
      const record: Stored = {
        sha256: sha, size: bytes.length, type, kind: request.kind, source: request.source,
        // The same bytes keep the most cautious origin and label any writer gave them.
        origin: fromAgent || peer.role === 'agent' || earlier?.origin === 'agent' ? 'agent' : peer.role,
        redaction: earlier && earlier.redaction !== 'complete' ? earlier.redaction : redaction,
        license: request.license, derivedFrom, intake: missing ? 'truncated' : 'captured', ...(missing && { missing }),
        ...(request.layer && { layer: request.layer }), ...(steps && { steps }), storedAt: now(),
      };
      index.set(sha, record);
      await appendFile(journal, `${JSON.stringify(record)}\n`);
      const { storedAt: _, ...evidence } = record;
      return { status: 'stored', evidence, slot: missing ? { state: 'truncated', missing } : { state: 'captured' } };
    });
  }

  const read = async (sha: string): Promise<Uint8Array> => {
    const bytes = HASH.test(sha) ? await readFile(fileOf(sha)).catch(() => undefined) : undefined;
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
        if (found !== request.declares) return refuse(`the slot declares ${request.declares}, but the bytes are ${found ?? 'not png, jpeg or mp4'}`);
        return save(peer, request, request.bytes, found, request.redaction, missingEnd(found, request.bytes));
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

    async admitBaseline(sha) {
      const record = index.get(sha);
      if (!record) throw new EvidenceError('refused', `no evidence ${sha} to take as a baseline`, sha);
      if (record.intake === 'truncated') throw new EvidenceError('refused', `evidence ${sha} is truncated (missing ${record.missing}), so it can't be a baseline`, sha);
      await read(sha).catch((error: Error) => { throw new EvidenceError('refused', `${error.message}, so it can't be a baseline`, sha); });
    },

    async retain({ cited, archived, installed = new Set() }) {
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
        if (!record || cited.has(sha) || archived.has(sha)) return false;
        const key = slotOf(record);
        return (key === undefined || newest.get(key) !== record.storedAt) && at - record.storedAt > (KEPT_MS[record.kind] ?? RETENTION_MS);
      };
      const removed: string[] = [];
      await Promise.all([...index.keys()].filter(expired).map((sha) => serial(sha, async () => {
        if (!expired(sha)) return; // stored again since the pass began
        index.delete(sha);
        await rm(fileOf(sha), { force: true });
        await appendFile(journal, `${JSON.stringify({ removed: sha })}\n`);
        removed.push(sha);
      })));
      return { removed };
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
          record.redaction !== 'complete' && `its redaction is ${record.redaction}`,
          !record.license.allows.includes(via) && `its license ${record.license.name} doesn't allow ${via}`,
        ].filter((reason): reason is string => !!reason && !yes.has(reason));
        if (reasons.length) {
          if (!(await boundary.ask({ sha256: sha, destination, via, reason: reasons.join('; ') }))) {
            receipt.withheld.push({ sha256: sha, reason: `you said no: ${reasons.join('; ')}` });
            continue;
          }
          for (const reason of reasons) yes.add(reason);
          approved.set(pair, yes);
          await appendFile(journal, `${JSON.stringify({ approved: pair, reasons } satisfies Approval)}\n`);
        }
        await boundary.deliver({ sha256: sha, bytes }, destination);
        receipt.sent.push({ sha256: sha, destination });
      }
      return receipt;
    },
  };
}
