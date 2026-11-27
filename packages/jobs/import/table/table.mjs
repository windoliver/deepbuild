// table-import, the import job's tool for a published table (#3570): a zip's member, a comma-, tab- or pipe-delimited
// file or a workbook's sheet, read as it is and cut to the columns and rows the params name, written as one table and
// its receipt. Run by the job API as `node table.mjs`, it reads {params, inputs} as JSON on stdin, `inputs.file` the
// file in base64, and takes the file as it streams in: nothing holds the whole file but a workbook, whose shared
// strings may follow its sheet. It writes {outputs: {table, report}} in base64, or {refused} naming what it refuses.
// Imported, `importTable(spec, chunks)` answers in the same process. It fetches nothing and runs nothing a file holds.
import { pathToFileURL } from 'node:url';
import { Cut } from './cut.mjs';
import { DELIMITERS, decode, Rows } from './text.mjs';
import { sheetRows } from './xlsx.mjs';
import { refusal, ZipMember } from './zip.mjs';

const GIB = 1024 ** 3;
/**
 * A planted wrong reader (#3570's qualification, tests only): set by the planted entry the acceptance tests install,
 * never by the job API, which hands a tool only PATH and HOME.
 */
export const PLANT = process.env.DEEP_3570_PLANT;
/** The table spec's defaults, as the design's Fields name them. */
const DEFAULTS = { format: 'csv', delimiter: 'comma', header: 1, encoding: 'utf-8', where: [], max_bytes: 2 * GIB };
const ENCODINGS = new Set(['utf-8', 'latin-1', 'windows-1252']);
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
/** Windows-1252's undefined bytes. */
const UNDEFINED_1252 = [0x81, 0x8d, 0x8f, 0x90, 0x9d];

/** Whether a chunk of the file may hold bytes its encoding doesn't: a chunk that does turns on the per-cell check. */
function checker(encoding) {
  if (encoding === 'latin-1') return () => true;
  if (encoding === 'windows-1252') return (chunk) => !UNDEFINED_1252.some((b) => chunk.includes(b));
  const stream = new TextDecoder('utf-8', { fatal: true });
  return (chunk) => {
    try { stream.decode(chunk, { stream: true }); return true; } catch { return false; }
  };
}

/** The rows of delimited text into the cut, each cell decoded as it's read; a cell not valid in the encoding refuses. */
function delimited(spec, cut) {
  const valid = checker(spec.encoding);
  let strict = false;
  const plain = spec.encoding === 'utf-8' ? 'utf8' : 'latin1';
  const rows = new Rows(DELIMITERS[spec.delimiter], (cells, n) => {
    const text = (i) => {
      const bytes = cells[i];
      if (!strict && plain === 'utf8') return bytes.toString('utf8');
      if (!strict && spec.encoding === 'latin-1') return bytes.toString('latin1');
      const t = decode(bytes, spec.encoding);
      if (t === undefined) throw refusal('encoding', `row ${n} holds bytes that aren't valid ${spec.encoding}`, { row: n, encoding: spec.encoding });
      return t;
    };
    // A strict pass checks every cell of the row, kept or not, so no row holds bytes the encoding doesn't.
    if (strict) for (let i = 0; i < cells.length; i += 1) text(i);
    cut.row(n, cells.length, text);
  });
  return {
    data(chunk) {
      if (!strict && !valid(chunk)) strict = true;
      rows.push(chunk);
    },
    end() { rows.end(); },
  };
}

/**
 * JSON lines into the cut: each line one object, its row its line in the file (1 the first); a column comes from a key.
 * A value comes in as its text: a string as it is, a number or a boolean as JSON writes it, a null or a key the line
 * leaves out as missing, and an object or a list refuses the row. The keys stand in for a header the cut places once.
 */
function jsonLines(spec, cut) {
  const names = Object.keys(spec.columns ?? {});
  const keys = names.map((name) => spec.columns[name].from ?? name);
  cut.place(0, keys.length, (i) => keys[i]);
  let held = Buffer.alloc(0);
  let n = 0;
  const line = (bytes) => {
    n += 1;
    const text = decode(bytes, 'utf-8');
    if (text === undefined) throw refusal('encoding', `row ${n} holds bytes that aren't valid utf-8`, { row: n, encoding: 'utf-8' });
    if (!text.trim()) return;
    let v;
    try { v = JSON.parse(text); } catch { v = undefined; }
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw refusal('row_shape', `row ${n} isn't one JSON object`, { row: n });
    cut.data(n, keys.length, (i) => {
      const x = v[keys[i]];
      if (x === null || x === undefined) return null;
      if (typeof x === 'object') throw refusal('cell_unparsed', `row ${n}'s value at ${keys[i]} is an object or a list, not a cell`, { row: n, column: names[i] });
      return typeof x === 'string' ? x : JSON.stringify(x);
    });
  };
  return {
    data(chunk) {
      held = held.length ? Buffer.concat([held, chunk]) : chunk;
      for (let i = held.indexOf(0x0a); i >= 0; i = held.indexOf(0x0a)) {
        line(held.subarray(0, i));
        held = held.subarray(i + 1);
      }
    },
    end() { if (held.length) line(held); },
  };
}

/** A spec with its defaults written out, or a refusal naming the field that is wrong. */
export function specOf(given) {
  const spec = { ...DEFAULTS, ...given };
  if (!['csv', 'jsonl', 'xlsx'].includes(spec.format)) throw refusal('params', `format is csv, jsonl or xlsx, not ${JSON.stringify(spec.format)}`);
  if (!Object.hasOwn(DELIMITERS, spec.delimiter)) throw refusal('params', `delimiter is comma, tab or pipe, not ${JSON.stringify(spec.delimiter)}`);
  if (!ENCODINGS.has(spec.encoding)) throw refusal('params', `encoding is utf-8, latin-1 or windows-1252, not ${JSON.stringify(spec.encoding)}`);
  if (spec.format === 'xlsx' && typeof spec.sheet !== 'string') throw refusal('params', 'a workbook names its sheet by name');
  if (!Number.isSafeInteger(spec.max_bytes) || spec.max_bytes < 1) throw refusal('params', 'max_bytes is a whole number of bytes');
  return spec;
}

/**
 * One import: `{table, receipt}`, the table's bytes and its receipt, from the file's chunks as they come (an async
 * iterable of Buffers). A refusal throws an Error carrying `refusal: {code, …}`, and nothing is written.
 */
export async function importTable(given, chunks) {
  const spec = specOf(given);
  const cut = new Cut({ ...spec, plant: PLANT });
  if (spec.format === 'xlsx') return workbook(spec, cut, chunks);
  const sink = spec.format === 'jsonl' ? jsonLines(spec, cut) : delimited(spec, cut);
  let first = true;
  let zip;
  let read = 0;
  for await (const chunk of chunks) {
    if (first && chunk.length) {
      first = false;
      const archive = chunk.subarray(0, 4).equals(ZIP);
      if (spec.member !== undefined) {
        if (!archive) throw refusal('zip_unreadable', `member names ${JSON.stringify(spec.member)}, and the file is no zip archive`, { member: spec.member });
        zip = new ZipMember(spec.member, spec.max_bytes, sink, PLANT === 'takes_first_member');
      } else if (archive) {
        throw refusal('member_unnamed', 'the file is a zip archive: name its member by its path, never by its position');
      }
    }
    if (zip) await zip.push(chunk);
    else {
      read += chunk.length;
      if (read > spec.max_bytes) throw refusal('member_too_big', `the file passes max_bytes, ${spec.max_bytes} bytes, and was stopped there`, { max_bytes: spec.max_bytes });
      sink.data(chunk);
    }
  }
  const member = zip ? await zip.end() : (sink.end(), null);
  return cut.done(member);
}

/** A workbook, held whole under max_bytes since its shared strings may follow its sheet, read by its directory. */
async function workbook(spec, cut, chunks) {
  const held = [];
  let size = 0;
  for await (const chunk of chunks) {
    size += chunk.length;
    if (size > spec.max_bytes) throw refusal('member_too_big', `the workbook passes max_bytes, ${spec.max_bytes} bytes, and was stopped there`, { max_bytes: spec.max_bytes });
    held.push(chunk);
  }
  const file = Buffer.concat(held);
  if (!file.subarray(0, 4).equals(ZIP)) throw refusal('xlsx_unreadable', 'the workbook is no .xlsx file: it isn\'t a zip archive');
  const { rows, formula } = sheetRows(file, spec.sheet, spec.max_bytes, PLANT === 'evaluates_formulas');
  for (const { n, cells } of rows) cut.row(n, cells.length, (i) => cells[i] ?? null, formula);
  return cut.done(null);
}

/**
 * The job API's request off stdin as it streams: `{params, inputs}` with `inputs.file`'s base64 decoded in pieces and
 * handed on as it comes, the rest of the request parsed whole. Resolves `params` before the file's first byte.
 */
export function request(stream) {
  let resolveParams;
  const params = new Promise((r) => { resolveParams = r; });
  const kept = [];
  const files = [];
  let wake;
  let room;
  let ended = false;
  let failed;
  // At most a few decoded pieces wait for the reader: the request is read no faster than the import takes it.
  const push = async (b) => {
    files.push(b);
    wake?.();
    while (files.length >= 4 && !failed) await new Promise((r) => { room = r; });
  };
  async function* file() {
    for (;;) {
      if (files.length) {
        const b = files.shift();
        room?.();
        room = undefined;
        yield b;
        continue;
      }
      if (failed) throw failed;
      if (ended) return;
      await new Promise((r) => { wake = r; });
      wake = undefined;
    }
  }
  (async () => {
    let depth = 0;
    let inString = false;
    let escaped = false;
    let token = [];
    let key1;
    let key2;
    let lastString;
    let b64 = '';
    let streaming = false;
    let after = false;
    for await (const chunk of stream) {
      let i = 0;
      while (i < chunk.length) {
        if (streaming) {
          const q = chunk.indexOf(0x22, i);
          const part = chunk.subarray(i, q < 0 ? chunk.length : q).toString('latin1').replace(/\\/g, '');
          b64 += part;
          const whole = b64.length - (b64.length % 4);
          if (whole) await push(Buffer.from(b64.slice(0, whole), 'base64'));
          b64 = b64.slice(whole);
          if (q < 0) { i = chunk.length; continue; }
          if (b64) await push(Buffer.from(b64, 'base64'));
          streaming = false;
          ended = true;
          wake?.();
          // Its closing quote is kept already, so the request parses with the file's value empty.
          i = q + 1;
          continue;
        }
        const c = chunk[i];
        kept.push(c);
        i += 1;
        if (inString) {
          if (escaped) escaped = false;
          else if (c === 0x5c) escaped = true;
          else if (c === 0x22) { inString = false; lastString = Buffer.from(token).toString('utf8'); }
          else token.push(c);
          continue;
        }
        if (c === 0x22) {
          inString = true;
          token = [];
          if (after) {
            // The file's value begins: the request so far, closed, holds the params.
            after = false;
            streaming = true;
            const head = `${Buffer.from(kept).toString('utf8')}"}}`;
            resolveParams(JSON.parse(head).params);
            inString = false;
            kept.push(0x22);
          }
          continue;
        }
        if (c === 0x3a) {
          if (depth === 1) key1 = lastString;
          if (depth === 2 && key1 === 'inputs') { key2 = lastString; if (key2 === 'file') after = true; }
          continue;
        }
        if (c === 0x7b || c === 0x5b) depth += 1;
        else if (c === 0x7d || c === 0x5d) depth -= 1;
        else if (after && c > 0x20) after = false;
      }
    }
    const whole = JSON.parse(Buffer.from(kept).toString('utf8'));
    resolveParams(whole.params);
    // A request with no file input, or a file given as something else, hands on nothing.
    if (!ended) { ended = true; wake?.(); }
    return whole;
  })().catch((e) => { failed = e; ended = true; resolveParams(undefined); wake?.(); room?.(); });
  return { params, file };
}

/** The refusal's text: its code, then what it names. */
export const refusedText = (e) => (e.refusal ? `${e.refusal.code}: ${e.message}` : `table_unreadable: ${e.message}`);

/** One run: the request off stdin, the import, one answer line on stdout. */
async function main() {
  const { params, file } = request(process.stdin);
  const p = await params;
  let answer;
  try {
    const { table, receipt } = await importTable(p, file());
    answer = { outputs: { table: table.toString('base64'), report: Buffer.from(JSON.stringify(receipt)).toString('base64') } };
  } catch (e) {
    answer = { refused: refusedText(e) };
    // The rest of the request is read and dropped, so the host's write ends.
    for await (const _ of file()) { /* drained */ }
  }
  process.stdout.write(`${JSON.stringify(answer)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
