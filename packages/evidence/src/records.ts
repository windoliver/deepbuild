// The store's records by hash, kept small (#1866): a record is its line in the journal, read back when asked for. In
// memory stand its hash, its place and the few fields a pass or a put reads of many at once, in arrays outside the heap,
// so a file kept for a month costs the store about a hundred bytes and no object.
import { closeSync, openSync, readFileSync, readSync } from 'node:fs';
import type { Stored } from './index.js';

type Field = Pick<Stored, 'size' | 'kind' | 'origin' | 'redaction' | 'storedAt'> & { parts: boolean; sealed: boolean };
/** What one journal line is worth: a record, a hash removed, or a yes to a send. */
type Line = Stored | { removed: string } | { approved: string; reasons: string[] };

const ORIGINS = ['deepbuild', 'you', 'agent'] as const;
const REDACTIONS = ['complete', 'incomplete', 'unknown'] as const;
const HASH = /^[0-9a-f]{64}$/;
const FREE = -1;
const GONE = -2;

export class Records {
  /** The slots in use, dense: each slot's fields are at its place in every array below. */
  private count = 0;
  private hashes = new Uint8Array(0);
  private at = new Float64Array(0);
  private length = new Uint32Array(0);
  private bytes = new Float64Array(0);
  private storedAt = new Float64Array(0);
  private kind = new Uint16Array(0);
  private marks = new Uint8Array(0);
  /** Each file's inode and last change as it was last synced here, 0 for one not synced. */
  private stamps = new BigUint64Array(0);
  /** A hash's slot, by its first four bytes and then the next free place. */
  private table = new Int32Array(0);
  private filled = 0;
  private readonly kinds: string[] = [];
  private readonly kindAt = new Map<string, number>();
  /** The records whose line is still on its way to the journal. */
  private readonly fresh = new Map<string, Stored>();

  constructor(private readonly journal: string) {}

  /** Takes a journal's lines, the last for a hash winning, and says how many there are; `seen` hears each as it is taken. */
  take(text: Uint8Array, seen: (line: Line) => void): number {
    const all = Buffer.from(text.buffer, text.byteOffset, text.byteLength);
    let lines = 1;
    for (let from = 0; from < all.length; lines++) {
      const end = all.indexOf(10, from);
      const to = end < 0 ? all.length : end;
      let line: Line | undefined;
      try { line = JSON.parse(all.toString('utf8', from, to)) as Line; } catch { /* a line a crash cut short */ }
      if (line && 'removed' in line) this.drop(line.removed);
      else if (line && 'sha256' in line) this.put(line, from, to - from);
      if (line) seen(line);
      from = to + 1;
    }
    return lines;
  }

  get size(): number {
    let more = 0;
    for (const sha of this.fresh.keys()) if (this.slot(sha) < 0) more++;
    return this.count + more;
  }
  has(sha: string): boolean { return this.fresh.has(sha) || this.slot(sha) >= 0; }
  /** The whole record, from its line. */
  get(sha: string): Stored | undefined {
    const fresh = this.fresh.get(sha);
    if (fresh) return fresh;
    let slot = this.slot(sha);
    if (slot < 0) return undefined;
    const read = this.read(slot, sha);
    if (read) return read;
    // Another process made the journal shorter: each line is found again.
    this.clear();
    this.take(readFileSync(this.journal), () => undefined);
    slot = this.slot(sha);
    return slot < 0 ? undefined : this.read(slot, sha);
  }
  /** What a pass or a put reads of many records, with no read of the journal. */
  field(sha: string): Field | undefined {
    const fresh = this.fresh.get(sha);
    if (fresh) return { ...fresh, parts: fresh.parts !== undefined, sealed: fresh.sealed === true };
    const slot = this.slot(sha);
    return slot < 0 ? undefined : this.fieldAt(slot);
  }
  /** Every record's hash and fields. */
  *each(): Iterable<[string, Field]> {
    for (let slot = 0; slot < this.count; slot++) {
      const sha = Buffer.from(this.hashes.buffer, slot * 32, 32).toString('hex');
      if (!this.fresh.has(sha)) yield [sha, this.fieldAt(slot)];
    }
    for (const sha of [...this.fresh.keys()]) yield [sha, this.field(sha)!];
  }
  /** Each record's line, in the order it is held, from the journal's own bytes. */
  lines(text: Uint8Array): Uint8Array[] {
    return Array.from({ length: this.count }, (_, slot) => text.subarray(this.at[slot]!, this.at[slot]! + this.length[slot]!));
  }
  /** A record to be journaled: held whole until its line is. */
  set(record: Stored): void { this.fresh.set(record.sha256, record); }
  /** The record's line is in the journal, at these bytes. */
  placed(record: Stored, at: number, length: number): void {
    this.put(record, at, length);
    if (this.fresh.get(record.sha256) === record) this.fresh.delete(record.sha256);
  }
  delete(sha: string): void {
    this.fresh.delete(sha);
    this.drop(sha);
  }

  /** The inode and last change a file was synced at (#1410), and whether it was kept: only a placed record's file is. */
  synced(sha: string): { ino: bigint; ctimeNs: bigint } | undefined {
    const slot = this.slot(sha);
    const ctimeNs = slot < 0 ? 0n : this.stamps[2 * slot + 1]!;
    return ctimeNs ? { ino: this.stamps[2 * slot]!, ctimeNs } : undefined;
  }
  sync(sha: string, stamp: { ino: bigint; ctimeNs: bigint }): boolean {
    const slot = this.slot(sha);
    if (slot < 0) return false;
    this.stamps[2 * slot] = stamp.ino;
    this.stamps[2 * slot + 1] = stamp.ctimeNs;
    return true;
  }

  clear(): void {
    this.count = 0;
    this.filled = 0;
    this.table.fill(FREE);
  }

  private fieldAt(slot: number): Field {
    const mark = this.marks[slot]!;
    return {
      size: this.bytes[slot]!, kind: this.kinds[this.kind[slot]!]!, storedAt: this.storedAt[slot]!,
      origin: ORIGINS[mark & 3]!, redaction: REDACTIONS[(mark >> 2) & 3]!, parts: (mark & 16) !== 0, sealed: (mark & 32) !== 0,
    };
  }
  private read(slot: number, sha: string): Stored | undefined {
    const line = Buffer.allocUnsafe(this.length[slot]!);
    let fd: number | undefined;
    try {
      fd = openSync(this.journal, 'r');
      if (readSync(fd, line, 0, line.length, this.at[slot]!) !== line.length) return undefined;
      const record = JSON.parse(line.toString('utf8')) as Stored;
      return record.sha256 === sha ? record : undefined;
    } catch { return undefined; } finally { if (fd !== undefined) closeSync(fd); }
  }

  private slot(sha: string): number {
    if (!this.count || !HASH.test(sha)) return -1;
    const at = this.place(Buffer.from(sha, 'hex'));
    return at < 0 ? -1 : this.table[at]!;
  }
  /** Where the table names a hash's slot; -1 for one it doesn't. */
  private place(hash: Buffer): number {
    const mask = this.table.length - 1;
    for (let i = hash.readUInt32LE(0) & mask; this.table[i] !== FREE; i = (i + 1) & mask) {
      const slot = this.table[i]!;
      if (slot >= 0 && hash.compare(this.hashes, slot * 32, slot * 32 + 32) === 0) return i;
    }
    return -1;
  }
  private put(record: Stored, at: number, length: number): void {
    if (!HASH.test(record.sha256)) return;
    const hash = Buffer.from(record.sha256, 'hex');
    const found = this.count ? this.place(hash) : -1;
    let slot = found < 0 ? -1 : this.table[found]!;
    if (slot < 0) {
      this.room();
      slot = this.count++;
      this.hashes.set(hash, slot * 32);
      this.stamps[2 * slot + 1] = 0n;
      this.name(hash, slot);
    }
    let kind = this.kindAt.get(record.kind);
    if (kind === undefined) { this.kindAt.set(record.kind, (kind = this.kinds.length)); this.kinds.push(record.kind); }
    this.at[slot] = at;
    this.length[slot] = length;
    this.bytes[slot] = record.size;
    this.storedAt[slot] = record.storedAt;
    this.kind[slot] = kind;
    this.marks[slot] = ORIGINS.indexOf(record.origin) | (REDACTIONS.indexOf(record.redaction) << 2) | (record.parts ? 16 : 0) | (record.sealed ? 32 : 0);
  }
  private drop(sha: string): void {
    const at = this.count && HASH.test(sha) ? this.place(Buffer.from(sha, 'hex')) : -1;
    if (at < 0) return;
    const slot = this.table[at]!;
    this.table[at] = GONE;
    const last = --this.count;
    if (slot === last) return;
    // The last slot takes its place, so the slots stay dense.
    const moved = this.place(Buffer.from(this.hashes.slice(last * 32, last * 32 + 32)));
    this.table[moved] = slot;
    this.hashes.copyWithin(slot * 32, last * 32, last * 32 + 32);
    this.stamps.copyWithin(2 * slot, 2 * last, 2 * last + 2);
    for (const of of [this.at, this.length, this.bytes, this.storedAt, this.kind, this.marks]) of[slot] = of[last]!;
  }
  private name(hash: Uint8Array, slot: number): void {
    const mask = this.table.length - 1;
    let i = (hash[0]! | (hash[1]! << 8) | (hash[2]! << 16) | (hash[3]! << 24)) & mask;
    while (this.table[i]! >= 0) i = (i + 1) & mask;
    if (this.table[i] === FREE) this.filled++;
    this.table[i] = slot;
  }
  /** Room for one more: every array twice as long once full, and a table at most half filled. */
  private room(): void {
    const had = this.at.length;
    if (this.count === had) {
      const size = Math.max(64, had * 2);
      const grow = <T extends { set(from: T): void }>(from: T, to: T): T => { to.set(from); return to; };
      this.hashes = grow(this.hashes, new Uint8Array(size * 32));
      this.at = grow(this.at, new Float64Array(size));
      this.length = grow(this.length, new Uint32Array(size));
      this.bytes = grow(this.bytes, new Float64Array(size));
      this.storedAt = grow(this.storedAt, new Float64Array(size));
      this.kind = grow(this.kind, new Uint16Array(size));
      this.marks = grow(this.marks, new Uint8Array(size));
      this.stamps = grow(this.stamps, new BigUint64Array(size * 2));
    }
    if (2 * (this.filled + 1) <= this.table.length) return;
    this.table = new Int32Array(Math.max(256, 2 ** Math.ceil(Math.log2(4 * (this.count + 1))))).fill(FREE);
    this.filled = 0;
    for (let slot = 0; slot < this.count; slot++) this.name(this.hashes.subarray(slot * 32, slot * 32 + 4), slot);
  }
}
