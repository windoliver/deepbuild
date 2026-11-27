// A zip read as a stream (#3570): its entries' local headers in order as the bytes pass, one member named by its path
// inflated as it comes and handed on in chunks, the rest skipped. Each of these refuses the file by name: an encrypted
// entry; a named member that is itself an archive, or a path through one; a path that leaves the archive's root; a
// path the archive holds twice; a member whose unpacked bytes pass `max_bytes`, counted on the stream as it inflates and
// never taken from a header. Nothing is fetched and nothing outside the archive is read.
import { createHash } from 'node:crypto';
import { createInflateRaw } from 'node:zlib';

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
const DESCRIPTOR = 0x08074b50;

/** A refusal naming what it refuses: `code` the kind of thing, `detail` the thing. */
export const refusal = (code, why, detail = {}) => Object.assign(Error(why), { refusal: { code, ...detail } });

/** Whether a path leaves an archive's root: absolute, a drive, a `..` segment, or a backslash a reader may split on. */
export function leaves(path) {
  if (!path || path.startsWith('/') || path.includes('\\') || /^[A-Za-z]:/.test(path)) return true;
  return path.split('/').some((s) => s === '..');
}
const archived = (bytes) => bytes.length >= 4 && bytes.readUInt32LE(0) === LOCAL;
const isArchiveName = (path) => /\.(zip|jar|xlsx|docx|ods|7z|gz|tar|tgz|rar)$/i.test(path);

/**
 * Reads a zip from a stream of chunks: `push(chunk)` as they come, then `end()`. The member at `member` is handed to
 * `sink.data(chunk)` as it inflates and `sink.end()` after it; `end()` resolves to `{path, sha256, bytes}`. A refusal
 * rejects push or end with an Error carrying `refusal`.
 */
export class ZipMember {
  /** `first` is the planted reader of #3570's qualification: it takes the archive's first member whatever `member` says. */
  constructor(member, maxBytes, sink, first = false) {
    if (leaves(member)) throw refusal('zip_path_leaves_root', `the member ${JSON.stringify(member)} leaves the archive's root, so it isn't read`, { member });
    this.member = member;
    this.max = maxBytes;
    this.sink = sink;
    this.first = first;
    this.held = Buffer.alloc(0);
    this.names = new Map();
    this.found = undefined;
    this.done = false;
    // The entry being passed: undefined between entries.
    this.entry = undefined;
    this.chain = Promise.resolve();
  }
  push(chunk) {
    this.chain = this.chain.then(() => this.take(chunk));
    return this.chain;
  }
  async take(chunk) {
    this.held = this.held.length ? Buffer.concat([this.held, chunk]) : chunk;
    for (;;) {
      if (this.done) { this.held = Buffer.alloc(0); return; }
      if (!this.entry) {
        if (this.held.length < 4) return;
        const sig = this.held.readUInt32LE(0);
        if (sig === CENTRAL || sig === END) { this.done = true; continue; }
        if (sig !== LOCAL) throw refusal('zip_unreadable', `the archive holds no entry header where one should start, so it isn't read`);
        if (this.held.length < 30) return;
        const n = this.held.readUInt16LE(26);
        const x = this.held.readUInt16LE(28);
        if (this.held.length < 30 + n + x) return;
        this.entry = this.header(this.held.subarray(0, 30 + n + x), n);
        this.held = this.held.subarray(30 + n + x);
        continue;
      }
      if (!(await this.body())) return;
    }
  }
  /** One local header: its path, flags, method and sizes (zip64 sizes from its extra field). */
  header(h, n) {
    const flags = h.readUInt16LE(6);
    const method = h.readUInt16LE(8);
    const path = h.subarray(30, 30 + n).toString(flags & 0x800 ? 'utf8' : 'latin1');
    let compressed = h.readUInt32LE(18);
    const extra = h.subarray(30 + n);
    for (let i = 0; i + 4 <= extra.length; ) {
      const id = extra.readUInt16LE(i);
      const len = extra.readUInt16LE(i + 2);
      if (id === 0x0001 && len >= 16 && compressed === 0xffffffff) compressed = Number(extra.readBigUInt64LE(i + 12));
      i += 4 + len;
    }
    if (flags & 0x1 || flags & 0x40) throw refusal('zip_encrypted', `the archive's entry ${JSON.stringify(path)} is encrypted, so nothing in it is read`, { member: path });
    if (this.names.has(path)) throw refusal('zip_path_twice', `the archive holds the path ${JSON.stringify(path)} twice, so which one is meant can't be told`, { member: path });
    this.names.set(path, true);
    const named = this.first ? this.names.size === 1 : path === this.member;
    if (!named && isArchiveName(path) && this.member.startsWith(`${path}/`)) {
      throw refusal('zip_nested', `the member ${JSON.stringify(this.member)} is inside another archive, ${JSON.stringify(path)}, which isn't read`, { member: this.member });
    }
    if (method !== 0 && method !== 8) {
      if (named) throw refusal('zip_unreadable', `the member ${JSON.stringify(path)} is compressed by method ${method}, which isn't read`, { member: path });
    }
    const later = (flags & 0x8) !== 0;
    if (later && method === 0) throw refusal('zip_unreadable', `the entry ${JSON.stringify(path)} is stored with its size after its data, so it can't be read as a stream`, { member: path });
    return { path, method, named, later, left: compressed, inflate: undefined, out: 0, hash: named ? createHash('sha256') : undefined, first: true };
  }
  /** Passes the entry's data on, or by; true once it and its descriptor are passed. */
  async body() {
    const e = this.entry;
    if (!e.later) {
      const take = Math.min(e.left, this.held.length);
      const part = this.held.subarray(0, take);
      this.held = this.held.subarray(take);
      e.left -= take;
      // An entry not named, of known size, is passed by unread.
      if (e.named && e.method === 0) this.out(e, part);
      else if (e.named && (part.length || e.left === 0)) await this.inflate(e, part, e.left === 0);
      if (e.error) throw e.error;
      if (e.left > 0) return false;
      this.finish(e);
      return true;
    }
    // Sizes after the data: the deflate stream says where it ends, and its descriptor follows.
    if (!e.ended) {
      if (!this.held.length) return false;
      const used = await this.inflate(e, this.held, false);
      this.held = this.held.subarray(used);
      if (!e.ended) return false;
    }
    if (this.held.length < 16) return false;
    this.held = this.held.subarray(this.held.readUInt32LE(0) === DESCRIPTOR ? 16 : 12);
    this.finish(e);
    return true;
  }
  /**
   * Inflates a part of the entry's deflate stream, `last` its known end; resolves to how many of its bytes the stream
   * used, all of them until it ends, and those up to its end where the stream ends inside the part.
   */
  inflate(e, part, last) {
    if (!e.inflate) {
      e.inflate = createInflateRaw({ chunkSize: 1 << 20 });
      e.inflate.on('data', (b) => this.out(e, b));
      e.inflate.on('end', () => { e.ended = true; e.settle?.(); });
      e.inflate.on('error', (err) => {
        e.error ??= refusal('zip_unreadable', `the entry ${JSON.stringify(e.path)} doesn't inflate: ${err.message}`, { member: e.path });
        e.settle?.();
      });
    }
    const z = e.inflate;
    const before = z.bytesWritten;
    return new Promise((resolve, reject) => {
      let settled = false;
      e.settle = () => {
        if (settled) return;
        settled = true;
        e.settle = undefined;
        if (e.error) reject(e.error);
        else resolve(e.ended ? z.bytesWritten - before : part.length);
      };
      // A known end waits for the stream's end; a write, for its bytes to be taken and their output handed on.
      if (last) z.end(part);
      else z.write(part, () => setImmediate(() => e.settle?.()));
    });
  }
  /** An entry's unpacked bytes: counted for the named member against max_bytes, hashed, handed on; others dropped. */
  out(e, bytes) {
    if (!e.named || e.error) return;
    e.out += bytes.length;
    const stop = (error) => {
      e.error = error;
      e.inflate?.destroy();
      e.settle?.();
    };
    if (e.out > this.max) return stop(refusal('member_too_big', `the member ${JSON.stringify(e.path)} unpacks past max_bytes, ${this.max} bytes, and was stopped there`, { member: e.path, max_bytes: this.max }));
    if (e.first && bytes.length) {
      e.first = false;
      if (archived(bytes) || isArchiveName(e.path)) return stop(refusal('zip_nested', `the member ${JSON.stringify(e.path)} is itself an archive, and a member inside another archive isn't read`, { member: e.path }));
    }
    e.hash.update(bytes);
    try {
      this.sink.data(bytes);
    } catch (err) {
      stop(err);
    }
  }
  finish(e) {
    if (e.error) throw e.error;
    if (e.named) this.found = { path: e.path, sha256: e.hash.digest('hex'), bytes: e.out };
    this.entry = undefined;
  }
  async end() {
    await this.chain;
    if (this.entry) throw refusal('zip_unreadable', `the archive ends inside its entry ${JSON.stringify(this.entry.path)}`, { member: this.entry.path });
    if (!this.found) {
      const through = [...this.names.keys()].find((p) => isArchiveName(p) && this.member.startsWith(`${p}/`));
      if (through) throw refusal('zip_nested', `the member ${JSON.stringify(this.member)} is inside another archive, ${JSON.stringify(through)}, which isn't read`, { member: this.member });
      throw refusal('zip_member_missing', `the archive holds no member at ${JSON.stringify(this.member)}`, { member: this.member });
    }
    this.sink.end();
    return this.found;
  }
}
