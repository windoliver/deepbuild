// The hub's log has a size (#3548). Its login service on macOS and a dev hub's start hand the hub `logs/hub.log`,
// opened to append, as its standard output and standard error, and nothing else ever cut it. The hub that holds the
// root's lock keeps the file itself: before a line that would take it past the limit, it cuts the file in place to its
// newest half, from the start of a line, so the oldest lines leave first and no kept line is cut. The file stays the
// one the service opened, so what Node writes there with no JavaScript, a fatal error's text, still lands in it.
import { closeSync, fstatSync, ftruncateSync, openSync, readSync, renameSync, writeSync } from 'node:fs';
import type { Plant } from './plant.js';

/** What `logs/` holds at most, in bytes. */
const LOG_LIMIT = 64_000_000;
/** Bytes the hub writes between two reads of the file's size, which count what it didn't write itself. */
const REREAD = 1_000_000;

/**
 * Cuts the log open at `fd`, for reading and writing, to its newest lines when `incoming` more bytes would take it
 * past the limit: at most half the limit is kept, from the start of a line, moved to the file's start, and the file
 * ends there, so a writer that appends lands after it. Returns the file's size. Half, so that a cut interrupted midway
 * is mended by the next one: what an interrupted move left joined lies in the half the next cut drops.
 */
function cutLog(fd: number, incoming: number): number {
  const size = fstatSync(fd).size;
  if (size + incoming <= LOG_LIMIT) return size;
  const from = size - Math.max(0, Math.min(LOG_LIMIT / 2, LOG_LIMIT - incoming));
  const buffer = Buffer.allocUnsafe(1 << 20);
  const read = (at: number): number => readSync(fd, buffer, 0, Math.min(buffer.length, size - at), at);
  // The first start of a line at or after `from`: the byte after the first newline from the byte before it. A line
  // longer than what is kept has none, and leaves whole.
  let start = size;
  for (let at = from - 1, n = read(at); n > 0; at += n, n = read(at)) {
    const newline = buffer.subarray(0, n).indexOf(10);
    if (newline >= 0) { start = at + newline + 1; break; }
  }
  let kept = 0;
  for (let at = start, n = read(at); n > 0; at += n, n = read(at)) {
    for (let done = 0; done < n;) done += writeSync(fd, buffer, done, n - done, kept + done);
    kept += n;
  }
  ftruncateSync(fd, kept);
  return kept;
}

/**
 * Holds the log at `path` to `LOG_LIMIT` for as long as this process writes it: each of its standard output and
 * standard error that is that file counts what it writes, and the file is cut first when a write would pass the limit,
 * the first write after a start included, so a log an earlier hub left over the limit is cut then. A hub whose output
 * goes elsewhere, a terminal or the system's journal, keeps nothing.
 */
export function keepLog(path: string, plant?: Plant): void {
  let fd: number;
  try { fd = openSync(path, 'r+'); } catch { return; }
  const log = fstatSync(fd);
  const streams = [process.stdout, process.stderr].filter((_, n) => {
    try {
      const at = fstatSync(n + 1);
      return at.isFile() && at.dev === log.dev && at.ino === log.ino;
    } catch {
      return false;
    }
  });
  if (!streams.length) return closeSync(fd);
  // The planted wrong program: each start gives the file it was handed a name of its own and keeps it, so the service
  // makes a new one at the next start. Each file holds to the limit, and the folder to none.
  if (plant === 'log-new-file-each-start') renameSync(path, `${path}.${Date.now()}`);
  let size = log.size;
  let unread = 0;
  for (const stream of streams) {
    const write = stream.write.bind(stream) as (...args: unknown[]) => boolean;
    stream.write = ((chunk: string | Uint8Array, ...rest: unknown[]): boolean => {
      // A cut that fails loses no line: the write goes on as it did before the log had a size.
      try {
        const bytes = typeof chunk === 'string' ? Buffer.byteLength(chunk, typeof rest[0] === 'string' ? (rest[0] as BufferEncoding) : 'utf8') : chunk.byteLength;
        if (size + bytes > LOG_LIMIT || unread >= REREAD) {
          size = cutLog(fd, bytes);
          unread = 0;
        }
        size += bytes;
        unread += bytes;
      } catch { /* the line is written all the same */ }
      return write(chunk, ...rest);
    }) as typeof stream.write;
  }
}
