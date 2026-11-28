// The store of kept check results, as the design step lays it out (canvas primitives, Pack: a check's result, kept):
// `packs/checked/` under the hub's root, one file per pack version named by the SHA-256 of `owner/name@version` in hex
// with `.json`; a file is two lines, the row as one line of JSON and its mark, the HMAC-SHA-256 in hex of the first
// line's bytes under the launch key. This file reads such files and writes them: whole, edited at one top-level member,
// cut short, unreadable. Whoever holds a key can mark a row with it; nothing here holds one.
import { createHash, createHmac } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
/** The file of `owner/name@version` in the store's folder. */
export const fileOf = (dir, ref) => join(dir, `${sha256(ref)}.json`);
/** The mark of a first line under a key: `key` is the launch key's 32 bytes, or its hex. */
export function markOf(key, line) {
  const bytes = typeof key === 'string' ? Buffer.from(key, 'hex') : key;
  return createHmac('sha256', bytes).update(line).digest('hex');
}

/**
 * A version's file as it is on disk: whether it is there, its bytes and their hash, its inode and modification time,
 * and what the two lines hold: `line` (the first line's bytes), `mark` (the second line, without its line end), `tail`
 * (what follows the mark), `row` (the first line as JSON, or null) and `two` (whether it is two lines).
 */
export function fileAt(dir, ref) {
  const file = fileOf(dir, ref);
  const none = { ref, file, exists: false, bytes: null, sha: null, ino: null, mtimeMs: null, line: null, mark: null, tail: null, row: null, two: false };
  let stat;
  try { stat = statSync(file); } catch { return none; }
  let bytes;
  try { bytes = readFileSync(file); } catch { return { ...none, exists: true, ino: stat.ino, mtimeMs: stat.mtimeMs }; }
  const cut = bytes.indexOf(0x0a);
  const line = cut < 0 ? bytes : bytes.subarray(0, cut);
  const rest = cut < 0 ? '' : bytes.subarray(cut + 1).toString('utf8');
  const mark = rest.replace(/\r?\n$/, '');
  let row = null;
  try { const parsed = JSON.parse(line.toString('utf8')); if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) row = parsed; } catch { /* not a row */ }
  return { ref, file, exists: true, bytes, sha: sha256(bytes), ino: stat.ino, mtimeMs: stat.mtimeMs, line, mark, tail: rest.slice(mark.length), row, two: cut >= 0 && mark !== '' && !mark.includes('\n') };
}

/** Whether a file's mark is the mark of its first line under `key`. */
export const marked = (key, at) => at.two && at.mark.toLowerCase() === markOf(key, at.line);

/**
 * What a file a core wrote fails of the design step's own words, as sentences; none for a row as it describes it.
 * `key` is the launch key the core was given; `build`, when given, the build's source digest.
 */
export function rowProblems(at, { key, pack, version, outcome, build }) {
  const where = `${pack}@${version}`;
  if (!at.exists) return [`${where}: the core kept no row at ${at.file}`];
  if (!at.two) return [`${where}: its file isn't two lines, the row and its mark: ${at.bytes?.length ?? 0} bytes`];
  if (!at.row) return [`${where}: its file's first line isn't one JSON object`];
  const out = [];
  const { row } = at;
  if (row.pack !== pack || row.version !== version) out.push(`${where}: its row names pack ${JSON.stringify(row.pack)} at version ${JSON.stringify(row.version)}`);
  for (const field of ['digest', 'build', 'left_sha256']) if (typeof row[field] !== 'string' || row[field] === '') out.push(`${where}: its row's \`${field}\` is ${JSON.stringify(row[field]) ?? 'missing'}, not a string`);
  if (typeof row.left_sha256 === 'string' && !/^[0-9a-f]{64}$/i.test(row.left_sha256)) out.push(`${where}: its row's \`left_sha256\` is no SHA-256 in hex: ${row.left_sha256.slice(0, 80)}`);
  if (typeof row.requires !== 'object' || row.requires === null || Array.isArray(row.requires)) out.push(`${where}: its row's \`requires\` is ${JSON.stringify(row.requires) ?? 'missing'}, not an object of versions to digests`);
  if (!('left' in row)) out.push(`${where}: its row holds no \`left\``);
  if (!Array.isArray(row.issues)) out.push(`${where}: its row's \`issues\` is ${JSON.stringify(row.issues) ?? 'missing'}, not a list`);
  if (outcome !== undefined && row.outcome !== outcome) out.push(`${where}: its row's \`outcome\` is ${JSON.stringify(row.outcome) ?? 'missing'}, not ${outcome}`);
  if (build !== undefined && row.build !== build) out.push(`${where}: its row's \`build\` is ${JSON.stringify(row.build)}, not this build's source digest ${build}`);
  if (!/^[0-9a-f]{64}$/i.test(at.mark)) out.push(`${where}: its file's second line is no HMAC-SHA-256 in hex: ${at.mark.slice(0, 80)}`);
  else if (key !== undefined && !marked(key, at)) out.push(`${where}: its mark is not the HMAC-SHA-256 of its first line's bytes under the launch key the core was given`);
  return out;
}

/**
 * Where a top-level member's value sits in a row's first line, `{start, end}`, or null when the line holds no such
 * member: so one member is changed and every other byte of the line stays as the core wrote it.
 */
export function memberSpan(line, name) {
  const n = line.length;
  let i = 0;
  const space = () => { while (i < n && /\s/.test(line[i])) i++; };
  const string = () => {
    const from = i++;
    while (i < n && line[i] !== '"') i += line[i] === '\\' ? 2 : 1;
    if (i >= n) throw Error('cut');
    return line.slice(from, ++i);
  };
  const value = () => {
    space();
    if (line[i] === '"') return void string();
    if (line[i] === '{' || line[i] === '[') {
      for (let depth = 0; ;) {
        const c = line[i];
        if (c === undefined) throw Error('cut');
        if (c === '"') { string(); continue; }
        i++;
        if (c === '{' || c === '[') depth++;
        else if ((c === '}' || c === ']') && --depth === 0) return;
      }
    }
    while (i < n && !/[,}\]\s]/.test(line[i])) i++;
  };
  try {
    space();
    if (line[i++] !== '{') return null;
    for (;;) {
      space();
      if (line[i] !== '"') return null;
      const key = JSON.parse(string());
      space();
      if (line[i++] !== ':') return null;
      space();
      const start = i;
      value();
      if (key === name) return { start, end: i };
      space();
      if (line[i++] !== ',') return null;
    }
  } catch {
    return null;
  }
}

/** A row's first line with one top-level member's value replaced; null when the line holds no such member. */
export function withMember(line, name, value) {
  const text = typeof line === 'string' ? line : line.toString('utf8');
  const span = memberSpan(text, name);
  return span ? `${text.slice(0, span.start)}${JSON.stringify(value)}${text.slice(span.end)}` : null;
}

/**
 * Writes a version's file whole: a first line, its mark, and the line end the core's own file had. The mark's hex is
 * written in the case the core wrote its own in.
 */
export function writeRow(at, line, mark) {
  const upper = /[A-F]/.test(at.mark ?? '') && !/[a-f]/.test(at.mark ?? '');
  writeFileSync(at.file, Buffer.concat([Buffer.from(line), Buffer.from(`\n${upper ? mark.toUpperCase() : mark}${at.tail ?? ''}`)]));
}

/** Another SHA-256 in hex than `hex`: its first digit changed. */
export const otherHash = (hex) => `${hex[0] === '0' ? '1' : '0'}${hex.slice(1)}`;

// ---------------------------------------------------------------------------------------------------
// Rows as criteria 2 and 3 name them, each made from the file a core wrote. Those that carry a mark are marked with
// `key`, which only the test that stands as the hub holds: a row of another build is one this hub's launch marked.

/** A row of another build: the same row, its `build` another digest, marked under the launch key. Returns that digest. */
export function ofAnotherBuild(at, key) {
  const other = otherHash(sha256(`a build of other sources than ${at.row.build}`));
  const line = withMember(at.line, 'build', other);
  if (line === null) return null;
  writeRow(at, line, markOf(key, line));
  return other;
}
/** A row whose kept hash doesn't match what the check left: `left_sha256` another hash, marked under the launch key. */
export function withAnotherHash(at, key) {
  const line = withMember(at.line, 'left_sha256', otherHash(String(at.row.left_sha256).toLowerCase()));
  if (line === null) return false;
  writeRow(at, line, markOf(key, line));
  return true;
}
/** No row: the file gone. */
export const remove = (at) => rmSync(at.file, { force: true });
/** A row cut short inside its first line: the first half of that line and nothing after. */
export const cutInsideRow = (at) => writeFileSync(at.file, at.line.subarray(0, Math.floor(at.line.length / 2)));
/** A row cut short before its mark: the first line whole, its line end, and nothing after. */
export const cutBeforeMark = (at) => writeFileSync(at.file, Buffer.concat([at.line, Buffer.from('\n')]));
/**
 * A row that can't be read: the file's bytes are no text (each byte 0xff, as many as it had), and its mode gives
 * nobody leave to read it. To root, whom a mode doesn't hold, it is still no row.
 */
export function unreadable(at) {
  writeFileSync(at.file, Buffer.alloc(at.bytes.length, 0xff));
  chmodSync(at.file, 0o000);
}
export const there = (dir, ref) => existsSync(fileOf(dir, ref));
