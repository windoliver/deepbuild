// Test-side tools for the blind redrafts after #2892 (README: Reading a bundle as its page reads it), shared by this
// folder and by ../1490-redraft-2892/, ../192/packs-redraft-2892/ and ../210-redraft-2892/. Under #2892 a web bundle
// stores most of its files gzip, each named from the SHA-256 of its stored bytes, and the page inflates each one after
// checking those bytes. So a test that searches or hashes what the page uses reads each file as the page will: a file
// whose stored bytes start with gzip's magic (1f 8b) is inflated with Node's zlib; any other file is read as stored.
// Nothing here reads the receipt's or the index's field names for the stored form, which #2892's implementer chooses.
// Also here: the planted twins these redrafts make in test code, each a copy of a real bundle with one file changed.

import { cpSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { filesUnder } from '../169/helpers.ts';

/** Whether stored bytes start with gzip's magic, 1f 8b. */
export const isGzip = (b: Buffer): boolean => b.length >= 2 && b[0] === 0x1f && b[1] === 0x8b;
/** The most bytes a stored file is inflated to here: far past any bundle file (the full player is 31.7 MB). */
export const INFLATE_CAP = 256 * 1024 * 1024;

/** A bundle file: its path, its stored bytes, and its bytes as the page reads them (`read`: inflated when `gzip`). A
 * file that starts with gzip's magic and doesn't inflate within the cap has a `problem` and is read as stored. */
export interface AsRead { path: string; stored: Buffer; read: Buffer; gzip: boolean; problem: string | null }

export function asRead(path: string, stored: Buffer): AsRead {
  if (!isGzip(stored)) return { path, stored, read: stored, gzip: false, problem: null };
  try {
    return { path, stored, read: gunzipSync(stored, { maxOutputLength: INFLATE_CAP }), gzip: true, problem: null };
  } catch (e) {
    return { path, stored, read: stored, gzip: false, problem: `${path} starts with gzip's magic and doesn't inflate within ${INFLATE_CAP} B (${(e as Error).message})` };
  }
}
/** Every file under a bundle folder, by its path there, as the page reads it. */
export const bundleAsRead = (out: string): Map<string, AsRead> => new Map([...filesUnder(out)].map(([path, bytes]) => [path, asRead(path, bytes)]));

/** The receipt's player as the page reads it: the receipt's file whose `sha256` is `player.hash` (its stored bytes, as
 * #172's helpers hold it), read from the bundle and inflated where stored gzip. Undefined when no such file is there. */
export function playerAsRead(files: Map<string, AsRead>, receipt: { player: { hash: string }; files: { path: string; sha256: string }[] }): AsRead | undefined {
  const listed = receipt.files.find((f) => f.sha256 === receipt.player.hash);
  return listed ? files.get(listed.path) : undefined;
}

/** Each needle `[what, bytes]` found in a bundle file, stored or inflated, as a failure naming the file, what it holds
 * and where; and each file that can't be read as the page reads it, since a leak there can't be ruled out. */
export function leakFailures(files: Map<string, AsRead>, needles: readonly (readonly [string, Buffer])[]): string[] {
  const f: string[] = [];
  for (const file of files.values()) {
    if (file.problem) f.push(`${file.problem}, so it can't be searched as the page reads it`);
    for (const [what, needle] of needles) {
      if (file.stored.includes(needle)) f.push(`${file.path} holds ${what} at byte ${file.stored.indexOf(needle)} of its stored bytes`);
      else if (file.gzip && file.read.includes(needle)) f.push(`${file.path} holds ${what} at byte ${file.read.indexOf(needle)} of its bytes inflated`);
    }
  }
  return f;
}

/** A copy of the bundle folder `out` at `to`, to change in test code. */
export function copyOf(out: string, to: string): string {
  cpSync(out, to, { recursive: true });
  return to;
}
/** Writes `bytes` gzip over the file `path` of the bundle copy `to`, keeping its name; the stored bytes written. */
export function storeGzip(to: string, path: string, bytes: Buffer): Buffer {
  const stored = gzipSync(bytes, { level: 9 });
  writeFileSync(join(to, path), stored);
  return stored;
}

/** The leak twin: a copy of the bundle `out` at `to` with each of `needles` inside one file's inflated bytes and that
 * file stored gzip, so its stored bytes hold none of them. The file is the smallest one stored gzip, or, in a bundle
 * with none (the merge base's), the smallest file but the index page; one whose gzip would still show a needle as it
 * is (a stored deflate block) is passed over for the next. Returns the planted file's path. */
export function leakTwin(out: string, to: string, needles: readonly Buffer[]): string {
  const bySize = (a: AsRead, b: AsRead): number => a.stored.length - b.stored.length || (a.path < b.path ? -1 : 1);
  const files = [...bundleAsRead(out).values()].filter((x) => x.path !== 'index.html');
  const planted = Buffer.concat(needles.flatMap((n) => [Buffer.from(' '), n, Buffer.from(' ')]));
  for (const into of [...files.filter((x) => x.gzip).sort(bySize), ...files.filter((x) => !x.gzip).sort(bySize)]) {
    const half = Math.floor(into.read.length / 2);
    const bytes = Buffer.concat([into.read.subarray(0, half), planted, into.read.subarray(half)]);
    if (needles.some((n) => gzipSync(bytes, { level: 9 }).includes(n))) continue;
    copyOf(out, to);
    storeGzip(to, into.path, bytes);
    return into.path;
  }
  throw Error(`the leak twin: no file of ${out} but its index page hides the planted bytes once stored gzip`);
}

function leb(b: Buffer, at: number): [number, number] {
  let v = 0; let shift = 0; let i = at;
  for (;;) { const x = b[i++]!; v += (x & 0x7f) * 2 ** shift; shift += 7; if (!(x & 0x80)) return [v, i]; }
}
/** A WebAssembly module's bytes with its first defined memory's limits marked shared (flag bit 1, as a threaded build's
 * memory is marked), the same length otherwise: what #172's `wasmMemories` reads as a shared memory. */
export function markedShared(wasm: Buffer): Buffer {
  const b = Buffer.from(wasm);
  let i = 8;
  while (i < b.length) {
    const id = b[i]!;
    const [size, body] = leb(b, i + 1);
    if (id === 5) {
      const [n, at] = leb(b, body);
      if (n > 0) { b[at] = b[at]! | 2; return b; }
    }
    i = body + size;
  }
  throw Error('the module defines no memory to mark shared');
}
