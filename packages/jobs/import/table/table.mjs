import { pathToFileURL } from 'node:url';
import { Cut } from './cut.mjs';
import { DELIMITERS, decode, Rows } from './text.mjs';
import { sheetRows } from './xlsx.mjs';
import { refusal, ZipMember } from './zip.mjs';

const GIB = 1024 ** 3;
export const PLANT = process.env.DEEP_3570_PLANT;
const DEFAULTS = { format: 'csv', delimiter: 'comma', header: 1, encoding: 'utf-8', where: [], max_bytes: 2 * GIB };
const ENCODINGS = new Set(['utf-8', 'latin-1', 'windows-1252']);
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const UNDEFINED_1252 = [0x81, 0x8d, 0x8f, 0x90, 0x9d];

function checker(encoding) {
  if (encoding === 'latin-1') return () => true;
  if (encoding === 'windows-1252') return (chunk) => !UNDEFINED_1252.some((b) => chunk.includes(b));
  const stream = new TextDecoder('utf-8', { fatal: true });
  return (chunk) => {
    try { stream.decode(chunk, { stream: true }); return true; } catch { return false; }
  };
}

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

export function specOf(given) {
  const spec = { ...DEFAULTS, ...given };
  if (!['csv', 'jsonl', 'xlsx'].includes(spec.format)) throw refusal('params', `format is csv, jsonl or xlsx, not ${JSON.stringify(spec.format)}`);
  if (!Object.hasOwn(DELIMITERS, spec.delimiter)) throw refusal('params', `delimiter is comma, tab or pipe, not ${JSON.stringify(spec.delimiter)}`);
  if (!ENCODINGS.has(spec.encoding)) throw refusal('params', `encoding is utf-8, latin-1 or windows-1252, not ${JSON.stringify(spec.encoding)}`);
  if (spec.format === 'xlsx' && typeof spec.sheet !== 'string') throw refusal('params', 'a workbook names its sheet by name');
  if (!Number.isSafeInteger(spec.max_bytes) || spec.max_bytes < 1) throw refusal('params', 'max_bytes is a whole number of bytes');
  return spec;
}

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

export function request(stream) {
  let resolveParams;
  const params = new Promise((r) => { resolveParams = r; });
  const kept = [];
  const files = [];
  let wake;
  let room;
  let ended = false;
  let failed;
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
    if (!ended) { ended = true; wake?.(); }
    return whole;
  })().catch((e) => { failed = e; ended = true; resolveParams(undefined); wake?.(); room?.(); });
  return { params, file };
}

export const refusedText = (e) => (e.refusal ? `${e.refusal.code}: ${e.message}` : `table_unreadable: ${e.message}`);

async function main() {
  const { params, file } = request(process.stdin);
  const p = await params;
  let answer;
  try {
    const { table, receipt } = await importTable(p, file());
    answer = { outputs: { table: table.toString('base64'), report: Buffer.from(JSON.stringify(receipt)).toString('base64') } };
  } catch (e) {
    answer = { refused: refusedText(e) };
    for await (const _ of file()) { }
  }
  process.stdout.write(`${JSON.stringify(answer)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
