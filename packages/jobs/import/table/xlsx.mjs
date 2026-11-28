import { inflateRawSync } from 'node:zlib';
import { leaves, refusal } from './zip.mjs';

const CENTRAL = 0x02014b50;
const END = 0x06054b50;

function entries(file) {
  let end = -1;
  for (let i = file.length - 22; i >= Math.max(0, file.length - 22 - 0xffff); i -= 1) {
    if (file.readUInt32LE(i) === END) { end = i; break; }
  }
  if (end < 0) throw refusal('xlsx_unreadable', 'the workbook is no zip archive: it has no end of central directory');
  const count = file.readUInt16LE(end + 10);
  let at = file.readUInt32LE(end + 16);
  const out = new Map();
  for (let k = 0; k < count; k += 1) {
    if (at + 46 > file.length || file.readUInt32LE(at) !== CENTRAL) throw refusal('xlsx_unreadable', 'the workbook\'s central directory is cut short');
    const flags = file.readUInt16LE(at + 8);
    const n = file.readUInt16LE(at + 28);
    const x = file.readUInt16LE(at + 30);
    const c = file.readUInt16LE(at + 32);
    const path = file.subarray(at + 46, at + 46 + n).toString(flags & 0x800 ? 'utf8' : 'latin1');
    if (flags & 0x1 || flags & 0x40) throw refusal('zip_encrypted', `the workbook's part ${JSON.stringify(path)} is encrypted, so nothing in it is read`, { member: path });
    if (out.has(path)) throw refusal('zip_path_twice', `the workbook holds the path ${JSON.stringify(path)} twice`, { member: path });
    out.set(path, { method: file.readUInt16LE(at + 10), size: file.readUInt32LE(at + 20), local: file.readUInt32LE(at + 42) });
    at += 46 + n + x + c;
  }
  return out;
}

function part(file, all, path, max) {
  const e = all.get(path);
  if (!e) return undefined;
  if (leaves(path)) throw refusal('zip_path_leaves_root', `the workbook's part ${JSON.stringify(path)} leaves the archive's root`, { member: path });
  const h = e.local;
  const start = h + 30 + file.readUInt16LE(h + 26) + file.readUInt16LE(h + 28);
  const data = file.subarray(start, start + e.size);
  if (e.method === 0) return data.toString('utf8');
  if (e.method !== 8) throw refusal('xlsx_unreadable', `the workbook's part ${JSON.stringify(path)} is compressed by method ${e.method}, which isn't read`, { member: path });
  try {
    return inflateRawSync(data, { maxOutputLength: max }).toString('utf8');
  } catch (err) {
    if (err instanceof RangeError || err.code === 'ERR_BUFFER_TOO_LARGE') throw refusal('member_too_big', `the workbook's part ${JSON.stringify(path)} unpacks past max_bytes, ${max} bytes, and was stopped there`, { member: path, max_bytes: max });
    throw refusal('xlsx_unreadable', `the workbook's part ${JSON.stringify(path)} doesn't inflate: ${err.message}`, { member: path });
  }
}

function unescape(text) {
  return text
    .replace(/&(#x[0-9a-fA-F]+|#[0-9]+|lt|gt|amp|quot|apos);/g, (_m, e) => {
      if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
      return { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[e];
    })
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_m, h) => String.fromCharCode(parseInt(h, 16)));
}
function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) out[m[1].slice(m[1].indexOf(':') + 1)] = unescape(m[3] ?? m[4]);
  return out;
}
function* elements(xml, name) {
  const re = new RegExp(`<(?:\\w+:)?${name}(?=[\\s/>])([^>]*?)(/?)>`, 'g');
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    if (m[2] === '/') { yield { a: attrs(m[1]), inner: '' }; continue; }
    const close = new RegExp(`</(?:\\w+:)?${name}>`, 'g');
    close.lastIndex = re.lastIndex;
    const c = close.exec(xml);
    const end = c ? c.index : xml.length;
    yield { a: attrs(m[1]), inner: xml.slice(re.lastIndex, end) };
    re.lastIndex = c ? close.lastIndex : xml.length;
  }
}
const textOf = (inner) => [...elements(inner.replace(/<(?:\w+:)?rPh[\s>][\s\S]*?<\/(?:\w+:)?rPh>/g, ''), 't')].map((t) => unescape(t.inner)).join('');

function rels(xml, folder) {
  const byId = new Map();
  const byType = new Map();
  for (const { a } of elements(xml ?? '', 'Relationship')) {
    if (a.TargetMode === 'External') continue;
    const target = a.Target.startsWith('/') ? a.Target.slice(1) : normalize(`${folder}${a.Target}`);
    byId.set(a.Id, target);
    byType.set(a.Type.slice(a.Type.lastIndexOf('/') + 1), target);
  }
  return { byId, byType };
}
function normalize(path) {
  const out = [];
  for (const s of path.split('/')) {
    if (s === '..') out.pop();
    else if (s !== '.' && s !== '') out.push(s);
  }
  return out.join('/');
}

const DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
function dateStyles(xml) {
  const custom = new Map();
  for (const { a } of elements(xml ?? '', 'numFmt')) {
    const code = a.formatCode.replace(/"[^"]*"|\[[^\]]*\]|\\./g, '').replace(/General/gi, '');
    custom.set(Number(a.numFmtId), /[dmyhs]/i.test(code));
  }
  const xfs = [...elements(xml ?? '', 'cellXfs')][0]?.inner ?? '';
  return [...elements(xfs, 'xf')].map(({ a }) => {
    const id = Number(a.numFmtId ?? 0);
    return custom.has(id) ? custom.get(id) : DATE_FORMATS.has(id);
  });
}

function iso(serial, from1904) {
  const day = 86_400_000;
  const epoch = from1904 ? Date.UTC(1904, 0, 1) : serial < 60 ? Date.UTC(1899, 11, 31) : Date.UTC(1899, 11, 30);
  const t = new Date(epoch + Math.round(serial * day));
  const s = t.toISOString();
  return Number.isInteger(serial) ? s.slice(0, 10) : s.replace(/\.000Z$/, '').replace(/Z$/, '');
}

function column(ref) {
  let n = 0;
  for (const ch of /^[A-Z]+/.exec(ref)?.[0] ?? '') n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

export function sheetRows(file, sheet, max, evaluate = false) {
  const all = entries(file);
  const root = rels(part(file, all, '_rels/.rels', max), '');
  const book = root.byType.get('officeDocument') ?? 'xl/workbook.xml';
  const folder = book.includes('/') ? book.slice(0, book.lastIndexOf('/') + 1) : '';
  const workbook = part(file, all, book, max);
  if (workbook === undefined) throw refusal('xlsx_unreadable', 'the file holds no workbook part');
  const own = rels(part(file, all, `${folder}_rels/${book.slice(folder.length)}.rels`, max), folder);
  const from1904 = [...elements(workbook, 'workbookPr')].some(({ a }) => a.date1904 === '1' || a.date1904 === 'true');
  const named = [...elements(workbook, 'sheet')].find(({ a }) => a.name === sheet);
  if (!named) throw refusal('sheet_missing', `the workbook holds no sheet named ${JSON.stringify(sheet)}`, { sheet });
  const path = own.byId.get(named.a.id);
  const xml = path === undefined ? undefined : part(file, all, path, max);
  if (xml === undefined) throw refusal('sheet_missing', `the workbook's sheet ${JSON.stringify(sheet)} has no part`, { sheet });
  const strings = [...elements(part(file, all, own.byType.get('sharedStrings') ?? `${folder}sharedStrings.xml`, max) ?? '', 'si')].map((s) => textOf(s.inner));
  const dates = dateStyles(part(file, all, own.byType.get('styles') ?? `${folder}styles.xml`, max));
  const rows = [];
  const formulas = new Set();
  const sums = [];
  let last = 0;
  for (const row of elements([...elements(xml, 'sheetData')][0]?.inner ?? '', 'row')) {
    const n = row.a.r ? Number(row.a.r) : last + 1;
    last = n;
    const cells = [];
    let col = -1;
    for (const c of elements(row.inner, 'c')) {
      col = c.a.r ? column(c.a.r) : col + 1;
      const v = [...elements(c.inner, 'v')][0];
      const f = [...elements(c.inner, 'f')][0];
      if (f) formulas.add(`${n}:${col}`);
      if (f && evaluate) sums.push({ n, col, f: unescape(f.inner) });
      const stored = v && v.inner !== '' ? unescape(v.inner) : undefined;
      let value = null;
      const t = c.a.t ?? 'n';
      if (t === 'inlineStr') value = textOf([...elements(c.inner, 'is')][0]?.inner ?? '');
      else if (stored === undefined) value = null;
      else if (t === 's') value = strings[Number(stored)] ?? null;
      else if (t === 'b') value = stored === '1' ? 'true' : 'false';
      else if (t === 'n' && dates[Number(c.a.s ?? 0)] && Number.isFinite(Number(stored))) value = iso(Number(stored), from1904);
      else value = stored;
      while (cells.length < col) cells.push(null);
      cells[col] = value;
    }
    rows.push({ n, cells });
  }
  for (const { n, col, f } of sums) {
    const m = /^SUM\(([A-Z]+)(\d+):([A-Z]+)(\d+)\)$/.exec(f);
    if (!m) continue;
    let sum = 0;
    for (const r of rows) {
      if (r.n < Number(m[2]) || r.n > Number(m[4])) continue;
      for (let k = column(m[1]); k <= column(m[3]); k += 1) sum += Number(r.cells[k] ?? 0) || 0;
    }
    rows.find((r) => r.n === n).cells[col] = String(sum);
  }
  return { rows, formula: (n, col) => formulas.has(`${n}:${col}`) };
}
