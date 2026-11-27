// A process that is not the hub, writing a row beside the hub's as an agent's child would (criterion 4; README: The
// process that is not the hub). It runs as you, so it can read and write every file under the hub's root. It was
// started by neither the hub nor a core, so it holds nothing they hold in memory. It is given the hub's root and which
// versions' rows to write, and nothing else. What it knows is public: the design step's words on where a row lives and
// what a file holds, and each pack's `owner/name@version`.
//
// It does what such a process would. It reads every file under the root for the launch key: anything that reads as 32
// bytes, tried as the key on a row the hub's core wrote. With a key it finds, it marks what it writes; with none, it
// makes a key of its own. Then it writes its rows and prints one line of JSON saying what it read and wrote.
//
//   node forger.mjs <the hub's root> '<JSON list of {ref, say, mark}>'
//
// `say: "installed"` rewrites a version's row to say installed, with no issues, under the forger's mark;
// `say: "refused", mark: "keep"` changes the hub's row to say refused and leaves the hub's mark on it.
import { randomBytes } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileAt, markOf, withMember, writeRow } from './store.mjs';

/** A file past this isn't read for a key: the report counts it. */
const MOST_BYTES = 256 * 1024 * 1024;

/** Every regular file under `root`, links not followed. */
export function filesUnder(root) {
  const out = [];
  const walk = (dir) => {
    let names;
    try { names = readdirSync(dir); } catch { return; }
    for (const name of names) {
      const file = join(dir, name);
      let stat;
      try { stat = lstatSync(file); } catch { continue; }
      if (stat.isDirectory()) walk(file);
      else if (stat.isFile()) out.push({ file, size: stat.size });
    }
  };
  walk(root);
  return out;
}

/**
 * Everything in a file's bytes that reads as a 32-byte key, each `{key, form}`: the file itself when it is 32 bytes;
 * 64 hex digits (each window of a run of up to 128), as the bytes they spell and as their own text; a base64 word of
 * 43 or 44 characters; a JSON list of 32 numbers under 256.
 */
export function candidatesIn(bytes) {
  const out = [];
  if (bytes.length === 32) out.push({ key: Buffer.from(bytes), form: 'the file\'s 32 bytes' });
  const text = bytes.toString('latin1');
  for (const [run] of text.matchAll(/(?<![0-9a-fA-F])[0-9a-fA-F]{64,128}(?![0-9a-fA-F])/g)) {
    for (let at = 0; at + 64 <= run.length; at++) {
      const hex = run.slice(at, at + 64);
      out.push({ key: Buffer.from(hex, 'hex'), form: '64 hex digits' }, { key: Buffer.from(hex, 'latin1'), form: '64 hex digits, their text as the key' });
    }
  }
  for (const [word] of text.matchAll(/(?<![A-Za-z0-9+/_-])[A-Za-z0-9+/_-]{43}=?(?![A-Za-z0-9+/_=-])/g)) {
    const key = Buffer.from(word, 'base64');
    if (key.length === 32) out.push({ key, form: 'a base64 word' });
  }
  for (const [list] of text.matchAll(/\[\s*(?:\d{1,3}\s*,\s*){31}\d{1,3}\s*\]/g)) {
    const numbers = JSON.parse(list);
    if (numbers.every((n) => n < 256)) out.push({ key: Buffer.from(numbers), form: 'a list of 32 numbers' });
  }
  return out;
}

/** The store's rows a mark can be tried on: each file of `packs/checked/` that is two lines with a 64-digit mark. */
function rowsOf(root) {
  const dir = join(root, 'packs', 'checked');
  let names = [];
  try { names = readdirSync(dir).filter((name) => name.endsWith('.json')); } catch { /* no store */ }
  return names.map((name) => {
    let bytes;
    try { bytes = readFileSync(join(dir, name)); } catch { return null; }
    const cut = bytes.indexOf(0x0a);
    const mark = cut < 0 ? '' : bytes.subarray(cut + 1).toString('latin1').replace(/\r?\n$/, '');
    return cut >= 0 && /^[0-9a-fA-F]{64}$/.test(mark) ? { file: join(dir, name), line: bytes.subarray(0, cut), mark: mark.toLowerCase() } : null;
  }).filter(Boolean).sort((a, b) => a.line.length - b.line.length);
}

/**
 * Looks for the launch key under `root`: `{rows, files, unread, candidates, key}`, `key` being `{file, form, row,
 * bytes}` for the first thing read that makes a row's mark, or null.
 */
export function findKey(root) {
  const rows = rowsOf(root);
  const files = filesUnder(root);
  const found = { rows: rows.length, files: files.length, unread: 0, candidates: 0, key: null };
  if (!rows.length) return found;
  const tried = new Set();
  for (const { file, size } of files) {
    if (size > MOST_BYTES) { found.unread++; continue; }
    let bytes;
    try { bytes = readFileSync(file); } catch { found.unread++; continue; }
    for (const { key, form } of candidatesIn(bytes)) {
      const id = key.toString('latin1');
      if (tried.has(id)) continue;
      tried.add(id);
      found.candidates++;
      if (markOf(key, rows[0].line) !== rows[0].mark) continue;
      found.key = { file, form, row: rows[0].file, bytes: key };
      return found;
    }
  }
  return found;
}

/** Writes the rows `jobs` name, each as the header says, marked with the key found under the root or one made here. */
export function forge(root, jobs) {
  const found = findKey(root);
  const dir = join(root, 'packs', 'checked');
  const own = found.key ? found.key.bytes : randomBytes(32);
  const wrote = [], problems = [];
  for (const { ref, say, mark } of jobs) {
    const at = fileAt(dir, ref);
    if (!at.exists || !at.two || !at.row) { problems.push(`${ref}: the hub's core left no row to write beside at ${at.file}`); continue; }
    let line = withMember(at.line, 'outcome', say);
    if (line !== null && say === 'installed') line = withMember(line, 'issues', []);
    if (line === null) { problems.push(`${ref}: its row holds no \`outcome\`${say === 'installed' ? ' or no `issues`' : ''} to rewrite`); continue; }
    writeRow(at, line, mark === 'keep' ? at.mark : markOf(own, line));
    wrote.push({ ref, file: at.file, was: at.row.outcome, say, mark: mark === 'keep' ? 'the hub\'s own mark, left on it' : found.key ? 'a mark under the key it found' : 'a mark under a key of its own' });
  }
  const key = found.key ? { file: found.key.file, form: found.key.form, row: found.key.row } : null;
  return { rows: found.rows, files: found.files, unread: found.unread, candidates: found.candidates, key, wrote, problems };
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [root, jobs = '[]'] = process.argv.slice(2);
  if (!root) {
    process.stderr.write('usage: node forger.mjs <the hub\'s root> [<JSON list of {ref, say, mark}>]\n');
    process.exit(2);
  }
  process.stdout.write(`${JSON.stringify(forge(root, JSON.parse(jobs)))}\n`);
}
