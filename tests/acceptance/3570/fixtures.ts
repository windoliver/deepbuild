// The fixtures of the #3570 acceptance tests, every one written here by code (README: Fixtures), none committed: the
// 600,000-row pipe file from a seeded generator, and the small ones (the zips, the workbooks, the comma, tab and
// latin-1 files) by hand-written bytes. Each is the same bytes on every run and every machine: no clock, no locale, a
// zip's every time field fixed. The containers are written here byte by byte (a zip's local headers, central
// directory and end record; a workbook's XML parts), deflate by Node's zlib.
//
// `node tests/acceptance/3570/fixtures.ts <folder>` writes the small fixtures into <folder> and prints each one's
// SHA-256, so the import kind's qualification can hold `sum.xlsx` byte for byte (README: The planted readers).
// No function here asserts.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { constants, crc32, deflateRawSync, inflateRawSync } from 'node:zlib';

export const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

// ---------------------------------------------------------------------------------------------------
// The 600,000-row pipe file (criteria 1, 2 and 9)

/** The generator's seed, recorded in README with the file's SHA-256. */
export const SEED = 3570;
export const ROWS = 600_000;
export const COUNTIES = 3_200;
export const PREFIX = '0500000US';
/** A xorshift32 stream in [0, 1), the same on every machine. */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}
export const COUNTY_HEADER = ['GEO_ID', 'NAME', 'POP', ...Array.from({ length: 27 }, (_, i) => `C${String(i + 4).padStart(2, '0')}`)];
export interface County {
  bytes: Buffer; sha256: string;
  /** The rows whose GEO_ID starts with `0500000US`, in file order: [GEO_ID, NAME, POP]. */
  kept: string[][];
  /** Rows whose GEO_ID holds the prefix but doesn't start with it, or starts with a near miss. */
  decoys: number;
}
/**
 * The pipe-delimited file: a header of 30 columns and 600,000 rows. Its first column is an area's GEO_ID: 3,200 rows
 * at seeded places are counties, `0500000US` and five digits; 300 start `0500000UT` and 300 hold the prefix after an
 * `X`, so a reader that matches anywhere but the start keeps more; the rest are tracts, `1400000US` and six digits.
 * NAME is the row's number in base 36, POP a count from 1 to 99,999, and the 27 other columns each a digit or empty.
 */
export function countyFile(seed = SEED): County {
  const r = rng(seed);
  const county = new Uint8Array(ROWS);
  for (let n = 0; n < COUNTIES;) { const i = Math.floor(r() * ROWS); if (!county[i]) { county[i] = 1; n++; } }
  const decoy = new Uint8Array(ROWS);
  for (let n = 0; n < 600;) { const i = Math.floor(r() * ROWS); if (!county[i] && !decoy[i]) { decoy[i] = n < 300 ? 1 : 2; n++; } }
  const chunks: Buffer[] = [Buffer.from(`${COUNTY_HEADER.join('|')}\n`)];
  const kept: string[][] = [];
  let text = '';
  let c = 0, d = 0, t = 0;
  for (let i = 0; i < ROWS; i++) {
    let geo: string;
    if (county[i]) geo = `${PREFIX}${String(++c).padStart(5, '0')}`;
    else if (decoy[i] === 1) geo = `0500000UT${String(++d).padStart(5, '0')}`;
    else if (decoy[i] === 2) geo = `X${PREFIX}${String(++d).padStart(5, '0')}`;
    else geo = `1400000US${String(++t).padStart(6, '0')}`;
    const name = i.toString(36);
    const pop = String(1 + Math.floor(r() * 99_999));
    let row = `${geo}|${name}|${pop}`;
    for (let k = 0; k < 27; k++) { const v = r(); row += v < 0.4 ? '|' : `|${Math.floor(v * 10)}`; }
    text += `${row}\n`;
    if (county[i]) kept.push([geo, name, pop]);
    if (text.length > 1 << 20) { chunks.push(Buffer.from(text)); text = ''; }
  }
  chunks.push(Buffer.from(text));
  const bytes = Buffer.concat(chunks);
  return { bytes, sha256: sha256(bytes), kept, decoys: 600 };
}

/** The other member of criterion 2's zip: the same three columns, 40 rows, 12 of them counties. */
export function townsFile(): { bytes: Buffer; kept: string[][] } {
  const r = rng(35702);
  let text = 'GEO_ID|NAME|POP\n';
  const kept: string[][] = [];
  for (let i = 0; i < 40; i++) {
    const county = i % 10 === 3 || i % 10 === 7 || i % 10 === 9;
    const geo = county ? `${PREFIX}9${String(i).padStart(4, '0')}` : `1600000US${String(i).padStart(7, '0')}`;
    const name = `Town ${i}`;
    const pop = String(100 + Math.floor(r() * 9_000));
    text += `${geo}|${name}|${pop}\n`;
    if (county) kept.push([geo, name, pop]);
  }
  return { bytes: Buffer.from(text), kept };
}

// ---------------------------------------------------------------------------------------------------
// Zips, written by hand

export interface Entry {
  name: string;
  /** The member's bytes as they are; or `raw`, a deflate stream already made, with its CRC and unpacked size. */
  data?: Buffer;
  raw?: { deflated: Buffer; crc: number; size: number };
  /** Stored (0) or deflated (8); deflated unless said. */
  method?: 0 | 8;
  /** The general purpose flag; bit 0 says the member is encrypted. */
  flags?: number;
  /** The unpacked size the headers state, where it isn't the true one. */
  claims?: number;
}
/** 2026-01-01 00:00:00 in DOS form, on every member, so the bytes never depend on the clock. */
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
export function zip(entries: Entry[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const method = e.method ?? 8;
    let body: Buffer, crc: number, size: number;
    if (e.raw) ({ deflated: body, crc, size } = e.raw);
    else {
      const data = e.data ?? Buffer.alloc(0);
      body = method === 8 ? deflateRawSync(data, { level: 9 }) : data;
      crc = crc32(data);
      size = data.length;
    }
    const usize = e.claims ?? size;
    const flags = (e.flags ?? 0) | 0x0800; // bit 11: the name is UTF-8
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(flags, 6); local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10); local.writeUInt16LE(DOS_DATE, 12); local.writeUInt32LE(crc >>> 0, 14);
    local.writeUInt32LE(body.length, 18); local.writeUInt32LE(usize, 22); local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    parts.push(local, name, body);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(0x031e, 4); dir.writeUInt16LE(20, 6); dir.writeUInt16LE(flags, 8); dir.writeUInt16LE(method, 10);
    dir.writeUInt16LE(DOS_TIME, 12); dir.writeUInt16LE(DOS_DATE, 14); dir.writeUInt32LE(crc >>> 0, 16); dir.writeUInt32LE(body.length, 20);
    dir.writeUInt32LE(usize, 24); dir.writeUInt16LE(name.length, 28); dir.writeUInt16LE(0, 30); dir.writeUInt16LE(0, 32); dir.writeUInt16LE(0, 34);
    dir.writeUInt16LE(0, 36); dir.writeUInt32LE((0o100644 << 16) >>> 0, 38); dir.writeUInt32LE(offset, 42);
    central.push(dir, name);
    offset += local.length + name.length + body.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

/** A small comma table every criterion-3 zip holds as its member: valid, so a reader that ignores the defect imports it. */
export const SMALL_CSV = Buffer.from('fips,name,pop\n01001,Autauga,58805\n01003,Baldwin,231767\n01005,Barbour,25223\n');
export const SMALL_OTHER = Buffer.from('fips,name,pop\n02013,Aleutians East,3420\n02016,Aleutians West,5232\n');

/** Criterion 2's zip: the towns file first, then the county file under `data/county.txt`. */
export const twoMembers = (county: Buffer): Buffer => zip([{ name: 'a/towns.txt', data: townsFile().bytes }, { name: 'data/county.txt', data: county }]);
/** Its encrypted member: bit 0 of the flag set on `county.csv`, its bytes stored as they are. */
export const encryptedZip = (): Buffer => zip([{ name: 'county.csv', data: SMALL_CSV, method: 0, flags: 1 }]);
/** A member inside a second zip: `inner.zip`, stored, holds `county.csv`. */
export const nestedZip = (): Buffer => zip([{ name: 'inner.zip', data: zip([{ name: 'county.csv', data: SMALL_CSV }]), method: 0 }]);
/** A member whose path leaves the archive's root. */
export const dotdotZip = (): Buffer => zip([{ name: '../x.csv', data: SMALL_CSV }]);
/** A path held twice, each time with other bytes. */
export const twiceZip = (): Buffer => zip([{ name: 'county.csv', data: SMALL_CSV }, { name: 'county.csv', data: SMALL_OTHER }]);

/** The bomb's member: a header row, then line ends to 3 GiB in all (a blank line is no row, as the probe's reader reads one). */
export const BOMB_SIZE = 3 * 2 ** 30;
export const BOMB_HEADER = Buffer.from('fips,name,pop\n');
const MIB = 1 << 20;
/**
 * The member deflated without ever holding 3 GiB: each piece is deflated alone and ends with a full flush, so the
 * pieces join into one stream, and an empty final block (03 00) closes it. Its headers state the deflated size as its
 * unpacked size, so only a count on the inflating stream finds 3 GiB. The join is checked on a small twin first.
 */
export function bombZip(): { bytes: Buffer; member: string; deflated: number } {
  const flush = { level: 9, finishFlush: constants.Z_FULL_FLUSH };
  const head = deflateRawSync(BOMB_HEADER, flush);
  const lines = Buffer.alloc(MIB, 0x0a);
  const piece = deflateRawSync(lines, flush);
  const restLines = Buffer.alloc(MIB - BOMB_HEADER.length, 0x0a);
  const rest = deflateRawSync(restLines, flush);
  const close = Buffer.from([0x03, 0x00]);
  const twin = inflateRawSync(Buffer.concat([head, piece, piece, rest, close]));
  if (!twin.equals(Buffer.concat([BOMB_HEADER, lines, lines, restLines]))) throw Error('the bomb\'s joined deflate pieces don\'t inflate to their bytes');
  const pieces = BOMB_SIZE / MIB - 1;
  let crc = crc32(BOMB_HEADER);
  for (let i = 0; i < pieces; i++) crc = crc32(lines, crc);
  crc = crc32(restLines, crc);
  const deflated = Buffer.concat([head, ...Array.from({ length: pieces }, () => piece), rest, close]);
  const member = 'big.csv';
  return { bytes: zip([{ name: member, raw: { deflated, crc, size: BOMB_SIZE }, claims: deflated.length }]), member, deflated: deflated.length };
}

// ---------------------------------------------------------------------------------------------------
// Workbooks (criterion 4)

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
type Cell = string | number | { f: string; v?: number };
function sheetXml(rows: Cell[][], strings: string[]): string {
  const col = (i: number) => String.fromCharCode(65 + i);
  const cell = (v: Cell, ref: string): string => {
    if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`;
    if (typeof v === 'string') {
      let at = strings.indexOf(v);
      if (at < 0) { strings.push(v); at = strings.length - 1; }
      return `<c r="${ref}" t="s"><v>${at}</v></c>`;
    }
    return `<c r="${ref}"><f>${v.f}</f>${v.v === undefined ? '' : `<v>${v.v}</v>`}</c>`;
  };
  const body = rows.map((row, r) => `<row r="${r + 1}">${row.map((v, c) => cell(v, `${col(c)}${r + 1}`)).join('')}</row>`).join('');
  return `${XML}<worksheet xmlns="${MAIN}"><sheetData>${body}</sheetData></worksheet>`;
}
/** A workbook of two sheets, `Notes` first, each from its rows, its text in shared strings. */
function workbook(sheets: { name: string; rows: Cell[][] }[]): Buffer {
  const strings: string[] = [];
  const xmls = sheets.map((s) => sheetXml(s.rows, strings));
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const parts: [string, string][] = [
    ['[Content_Types].xml', `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`],
    ['_rels/.rels', `${XML}<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `${XML}<workbook xmlns="${MAIN}" xmlns:r="${REL}"><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `${XML}<Relationships xmlns="${PKG}">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`],
    ...xmls.map((x, i): [string, string] => [`xl/worksheets/sheet${i + 1}.xml`, x]),
    ['xl/sharedStrings.xml', `${XML}<sst xmlns="${MAIN}" count="${strings.length}" uniqueCount="${strings.length}">${strings.map((s) => `<si><t>${esc(s)}</t></si>`).join('')}</sst>`],
  ];
  return zip(parts.map(([name, text]) => ({ name, data: Buffer.from(text, 'utf8') })));
}
/** The named sheet, `Counties`: a header and 5 rows; B2:B5 sum to 260, and B6 holds =SUM(B2:B5) with 250 stored. */
export const SHEET = 'Counties';
export const SUM_CELL = 'B6';
export const SHEET_ROWS: [string, string][] = [['Adams', '50'], ['Baker', '60'], ['Clay', '70'], ['Dade', '80'], ['Total', '250']];
const NOTES: Cell[][] = [['name', 'pop'], ['Ames', 1], ['Boone', 2], ['Cass', 3], ['Davis', 4], ['Emmet', 5], ['Floyd', 6], ['Grundy', 7]];
const counties = (total: { f: string; v?: number }): Cell[][] => [['name', 'pop'], ['Adams', 50], ['Baker', 60], ['Clay', 70], ['Dade', 80], ['Total', total]];
/** The workbook whose formula cell stores 250 beside cells that sum to 260. */
export const sumXlsx = (): Buffer => workbook([{ name: 'Notes', rows: NOTES }, { name: SHEET, rows: counties({ f: 'SUM(B2:B5)', v: 250 }) }]);
/** The same with no stored value in the formula cell. */
export const blankXlsx = (): Buffer => workbook([{ name: 'Notes', rows: NOTES }, { name: SHEET, rows: counties({ f: 'SUM(B2:B5)' }) }]);

// ---------------------------------------------------------------------------------------------------
// Delimited text (criteria 5, 6, 7 and 8)

/** A row of a small table: its line in the file (the header is line 1) and its key. */
export interface Marked { line: number; key: string }
/** 100 rows of `fips,name,pop`; the row on line 58 prints `(D)` for its pop. */
export function markerCsv(): { bytes: Buffer; marked: Marked; rows: string[][] } {
  const rows: string[][] = [];
  for (let i = 0; i < 100; i++) rows.push([String(10001 + 2 * i), `Area ${i}`, String(1000 + 37 * i)]);
  rows[56] = ['48201', 'Harris', '(D)'];
  return { bytes: Buffer.from(`fips,name,pop\n${rows.map((r) => r.join(',')).join('\n')}\n`), marked: { line: 58, key: '48201' }, rows };
}
/** 20 rows of `fips<TAB>name<TAB>pop`; the row on line 12 writes its pop `1,234`. */
export function groupsTsv(): { bytes: Buffer; marked: Marked; rows: string[][] } {
  const rows: string[][] = [];
  for (let i = 0; i < 20; i++) rows.push([String(20001 + 2 * i), `Place ${i}`, String(500 + 11 * i)]);
  rows[10] = ['20077', 'Harper', '1,234'];
  return { bytes: Buffer.from(`fips\tname\tpop\n${rows.map((r) => r.join('\t')).join('\n')}\n`), marked: { line: 12, key: '20077' }, rows };
}
/** 10 rows of `fips,name,pop` in latin-1; the row on line 7 is named `Andr` and the byte 0xE9. */
export function latin1Csv(): { bytes: Buffer; marked: Marked; rows: string[][] } {
  const rows: string[][] = [];
  for (let i = 0; i < 10; i++) rows.push([String(30001 + 2 * i), `Town ${i}`, String(700 + 13 * i)]);
  rows[5] = ['30011', 'André', '765'];
  return { bytes: Buffer.from(`fips,name,pop\n${rows.map((r) => r.join(',')).join('\n')}\n`, 'latin1'), marked: { line: 7, key: '30011' }, rows };
}
/** Criterion 8's table: five areas, one of which the import keeps by `where … in`. */
export const LABEL_GEO = '0500000US06037';
export const LABEL_POP = '10014009';
export const labelsCsv = (): Buffer => Buffer.from(`GEO_ID,NAME,POP\n0500000US06001,Alameda,1682353\n${LABEL_GEO},Los Angeles,${LABEL_POP}\n0500000US06059,Orange,3186989\n0500000US06073,San Diego,3298634\n1400000US060371011,Tract 1011,3807\n`);

/** Every small fixture by its file name, as `fixtures.ts <folder>` writes them. */
export function smallFixtures(): Record<string, Buffer> {
  return {
    'towns.txt': townsFile().bytes, 'encrypted.zip': encryptedZip(), 'nested.zip': nestedZip(), 'dotdot.zip': dotdotZip(), 'twice.zip': twiceZip(),
    'sum.xlsx': sumXlsx(), 'blank.xlsx': blankXlsx(), 'marker.csv': markerCsv().bytes, 'groups.tsv': groupsTsv().bytes,
    'latin1.csv': latin1Csv().bytes, 'labels.csv': labelsCsv(),
  };
}

if ((import.meta as { main?: boolean }).main) {
  const out = process.argv[2];
  if (!out) throw Error('usage: node tests/acceptance/3570/fixtures.ts <folder>');
  mkdirSync(out, { recursive: true });
  for (const [name, bytes] of Object.entries(smallFixtures())) {
    writeFileSync(join(out, name), bytes);
    console.log(`${sha256(bytes)}  ${bytes.length}  ${name}`);
  }
  if (process.argv.includes('--large')) {
    const c = countyFile();
    console.log(`${c.sha256}  ${c.bytes.length}  county.txt (seed ${SEED}, ${c.kept.length} counties)`);
    const z = twoMembers(c.bytes);
    console.log(`${sha256(z)}  ${z.length}  two-members.zip`);
    const b = bombZip();
    console.log(`${sha256(b.bytes)}  ${b.bytes.length}  bomb.zip (member ${b.member}, deflated ${b.deflated}, inflates to ${BOMB_SIZE})`);
  }
}
