// Editing an agent's own files (design: How it installs, Editing agent settings): each is parsed strictly, refusing a
// duplicate key; written atomically to the file a link points to, through a temporary file beside that file, so the
// link stays a link; read again before it is kept. Before setup's first write to a file its original bytes are kept
// once, by hash, so undo puts them back where you haven't edited the file since.
import { createHash } from 'node:crypto';
import { chmodSync, closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

type Obj = Record<string, unknown>;
const sha = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');

/** A strict JSON object: the value, or why it won't do, naming a duplicate key by its path. */
export function strictObject(text: string): { value: Obj } | { refused: string } {
  let at = 0;
  const fail = (why: string): never => { throw new SyntaxError(why); };
  const space = () => { while (/\s/.test(text[at] ?? '')) at++; };
  const string = (): string => {
    const start = at;
    for (at++; text[at] !== '"'; at++) {
      if (at >= text.length) fail('an unterminated string');
      if (text[at] === '\\') at++;
    }
    at++;
    return JSON.parse(text.slice(start, at)) as string;
  };
  const value = (path: string): unknown => {
    space();
    const c = text[at];
    if (c === '{') {
      const out: Obj = {};
      const seen = new Set<string>();
      at++;
      space();
      if (text[at] === '}') { at++; return out; }
      for (;;) {
        space();
        if (text[at] !== '"') fail(`a key expected at byte ${at}`);
        const key = string();
        const where = path ? `${path}.${key}` : key;
        if (seen.has(key)) throw new DuplicateKey(where);
        seen.add(key);
        space();
        if (text[at++] !== ':') fail(`a colon expected at byte ${at - 1}`);
        out[key] = value(where);
        space();
        if (text[at] === ',') { at++; continue; }
        if (text[at++] === '}') return out;
        fail(`a comma or } expected at byte ${at - 1}`);
      }
    }
    if (c === '[') {
      const out: unknown[] = [];
      at++;
      space();
      if (text[at] === ']') { at++; return out; }
      for (;;) {
        out.push(value(`${path}[${out.length}]`));
        space();
        if (text[at] === ',') { at++; continue; }
        if (text[at++] === ']') return out;
        fail(`a comma or ] expected at byte ${at - 1}`);
      }
    }
    if (c === '"') return string();
    const m = /^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(text.slice(at));
    if (!m) fail(`a value expected at byte ${at}`);
    at += m![0].length;
    return JSON.parse(m![0]) as unknown;
  };
  try {
    const parsed = value('');
    space();
    if (at < text.length) fail(`text after the value at byte ${at}`);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { refused: 'holds no JSON object' };
    return { value: parsed as Obj };
  } catch (error) {
    if (error instanceof DuplicateKey) return { refused: `repeats the key "${error.key}"` };
    return { refused: `isn't JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
}
class DuplicateKey extends Error {
  constructor(readonly key: string) { super(key); }
}

/** The file a path names once its links are followed, even when the last one points at a file not there yet. */
export function target(file: string): string {
  if (existsSync(file)) return realpathSync(file);
  try {
    if (lstatSync(file).isSymbolicLink()) return target(resolve(dirname(file), readlinkSync(file)));
  } catch { /* nothing there */ }
  return file;
}

/** Writes `text` to the file `file` names, through a temporary file beside it, and reads it back before keeping it. */
export function writeThrough(file: string, text: string | Buffer): void {
  const real = target(file);
  mkdirSync(dirname(real), { recursive: true });
  const next = join(dirname(real), `.${real.split('/').pop()}.deepbuild-${process.pid}.tmp`);
  // The file keeps its mode: a config can hold tokens. One that's new is yours alone.
  const mode = existsSync(real) ? statSync(real).mode & 0o777 : 0o600;
  rmSync(next, { force: true });
  writeFileSync(next, text, { mode });
  chmodSync(next, mode);
  const fd = openSync(next, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
  if (!readFileSync(next).equals(Buffer.from(text))) {
    rmSync(next, { force: true });
    throw Error(`${real} didn't read back as written; it is left as it was`);
  }
  renameSync(next, real);
  // The rename survives a power cut once the folder is flushed.
  const dir = openSync(dirname(real), 'r');
  try { fsyncSync(dir); } catch { /* a folder that can't be flushed */ } finally { closeSync(dir); }
}

// ---- What setup changed, for undo: <root>/setup.json, with each file's bytes before its first write in <root>/originals.

interface Changed { before: string | null; after: string }
export interface SetupRecord { files: Record<string, Changed>; created: string[] }
const recordFile = (root: string) => join(root, 'setup.json');

export function setupRecord(root: string): SetupRecord {
  try {
    const value = JSON.parse(readFileSync(recordFile(root), 'utf8')) as SetupRecord;
    return { files: value.files ?? {}, created: value.created ?? [] };
  } catch {
    return { files: {}, created: [] };
  }
}
export function saveRecord(root: string, record: SetupRecord): void {
  writeFileSync(recordFile(root), `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
}
/** Keeps the file's bytes before setup's first write to it (once: a later setup keeps the first copy). */
export function keepOriginal(root: string, record: SetupRecord, file: string): void {
  if (record.files[file]) return;
  const real = target(file);
  let before: string | null = null;
  if (existsSync(real)) {
    const bytes = readFileSync(real);
    before = sha(bytes);
    mkdirSync(join(root, 'originals'), { recursive: true, mode: 0o700 });
    writeFileSync(join(root, 'originals', before), bytes, { mode: 0o600 });
  }
  record.files[file] = { before, after: before ?? '' };
}
/** Notes the bytes setup left in a file, so undo can tell whether you edited it since. */
export function noteWritten(record: SetupRecord, file: string): void {
  const changed = record.files[file];
  if (changed) changed.after = sha(readFileSync(target(file)));
}
/**
 * Puts a file back: its original bytes, or no file where there was none, when it still holds what setup left;
 * undefined then. Otherwise `edited` is called to take DeepBuild's parts out of what you have now, and its words return.
 */
export function putBack(root: string, record: SetupRecord, file: string, edited: () => string | undefined): string | undefined {
  const changed = record.files[file];
  if (!changed) return undefined;
  const real = target(file);
  const now = existsSync(real) ? sha(readFileSync(real)) : null;
  if (now === changed.before) return undefined;
  if (now !== changed.after) return edited();
  if (changed.before === null) rmSync(real, { force: true });
  else writeThrough(file, readFileSync(join(root, 'originals', changed.before)));
  return undefined;
}
