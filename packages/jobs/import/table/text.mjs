// Delimited text as a stream of rows (#3570), each a list of its cells' bytes. One quoting rule for all three
// delimiters, the one #397's table probe reads CSV by (crates/deep-catalog/src/cells.rs): a row ends at LF, a CR before
// it outside the cell; a cell quoted from its first byte runs to a `"` not followed by `"`, `""` its quote, and the bytes
// after its closing quote up to the delimiter are no part of it; a blank line is no row. The delimiter, the quote and
// the row end are ASCII, so rows split on the file's bytes before any decoding, in UTF-8, Latin-1 or Windows-1252 alike.

const QUOTE = 0x22;
const LF = 0x0a;
const CR = 0x0d;
/** The delimiters by name. */
export const DELIMITERS = { comma: 0x2c, tab: 0x09, pipe: 0x7c };
/** The longest row this reader holds: a longer one can't be a row of a table under its 16 MB cap. */
const ROW_MAX = 16 * 1024 * 1024;

/**
 * Rows of delimited text from chunks of its bytes. `push(chunk)` hands each row it ends to `row(cells, n)`, `n` its
 * 1-based row in the file, each cell a Buffer of its bytes with a quoted cell's `""` read as `"`; `end()` the last.
 * A row past ROW_MAX is read to its end and refused there, so a stream with no row end is held only to its own bound.
 */
export class Rows {
  constructor(delimiter, row) {
    this.d = delimiter;
    this.emit = row;
    this.n = 0;
    this.bom = 3;
    this.reset();
  }
  reset() {
    this.cells = [];
    this.cell = [];
    this.size = 0;
    this.long = false;
    // 0 at a cell's start, 1 in an unquoted cell, 2 in a quoted one, 3 just after a `"` in one, 4 past its closing quote.
    this.state = 0;
  }
  /** A byte order mark at the file's start is dropped. */
  bomless(chunk) {
    if (this.bom === 0) return chunk;
    const mark = [0xef, 0xbb, 0xbf];
    let i = 0;
    while (this.bom > 0 && i < chunk.length) {
      if (chunk[i] !== mark[3 - this.bom]) {
        const held = Buffer.from(mark.slice(0, 3 - this.bom));
        this.bom = 0;
        return Buffer.concat([held, chunk.subarray(i)]);
      }
      this.bom -= 1;
      i += 1;
    }
    if (this.bom > 0) return chunk.subarray(chunk.length);
    this.bom = 0;
    return chunk.subarray(i);
  }
  /** Keeps bytes [from, to) of a chunk in the open cell, unless the row is past its bound. */
  keep(chunk, from, to) {
    if (to <= from) return;
    this.size += to - from;
    if (this.size > ROW_MAX) {
      this.long = true;
      this.cell = [];
      this.cells = [];
    }
    if (!this.long) this.cell.push(chunk.subarray(from, to));
  }
  close() {
    if (!this.long) this.cells.push(this.cell.length === 1 ? this.cell[0] : Buffer.concat(this.cell));
    this.cell = [];
    this.state = 0;
  }
  rowEnd() {
    this.n += 1;
    const n = this.n;
    if (this.long) throw Object.assign(Error(`row ${n} is longer than ${ROW_MAX} bytes, past any table this job writes`), { row: n });
    const cells = this.cells;
    this.reset();
    if (cells.length === 1 && cells[0].length === 0) {
      this.n -= 1;
      return;
    }
    this.emit(cells, n);
  }
  push(input) {
    const chunk = this.bomless(input);
    const d = this.d;
    let i = 0;
    let from = 0;
    let lf = -1;
    while (i < chunk.length) {
      const b = chunk[i];
      switch (this.state) {
        case 0:
          // A run of blank lines is no row: passed by at once, so a file of line ends reads at the speed of its bytes.
          if (b === LF && this.cells.length === 0) {
            while (i < chunk.length && chunk[i] === LF) i += 1;
            from = i;
            continue;
          }
          if (b === QUOTE) { this.state = 2; from = i + 1; i += 1; continue; }
          this.state = 1;
          from = i;
          continue;
        case 1: {
          // An unquoted cell: to the delimiter or LF, a CR before LF outside it.
          // Both found natively: the next row end once a chunk, and the next delimiter before it.
          if (lf < i) { lf = chunk.indexOf(LF, i); if (lf < 0) lf = chunk.length; }
          let j = chunk.indexOf(d, i);
          if (j < 0 || j > lf) j = lf;
          if (j === chunk.length) { this.keep(chunk, from, j); i = j; from = j; continue; }
          if (chunk[j] === LF) {
            this.keep(chunk, from, j);
            this.trimCr();
            this.close();
            this.rowEnd();
          } else {
            this.keep(chunk, from, j);
            this.close();
          }
          i = j + 1;
          from = i;
          continue;
        }
        case 2: {
          const j = chunk.indexOf(QUOTE, i);
          if (j < 0) { this.keep(chunk, from, chunk.length); i = chunk.length; from = i; continue; }
          this.keep(chunk, from, j);
          this.state = 3;
          i = j + 1;
          from = i;
          continue;
        }
        case 3:
          // After a `"` inside a quoted cell: `""` is one quote, anything else closed the cell.
          if (b === QUOTE) { this.keep(chunk, i, i + 1); this.state = 2; i += 1; from = i; continue; }
          this.state = 4;
          continue;
        case 4:
          if (b === d) { this.close(); i += 1; from = i; continue; }
          if (b === LF) { this.close(); this.rowEnd(); i += 1; from = i; continue; }
          i += 1;
          from = i;
          continue;
        default:
          throw Error('unreachable');
      }
    }
  }
  /** An unquoted cell's CR before its row's LF is outside the cell. */
  trimCr() {
    const last = this.cell[this.cell.length - 1];
    if (!this.long && last && last.length && last[last.length - 1] === CR) this.cell[this.cell.length - 1] = last.subarray(0, last.length - 1);
  }
  end() {
    if (this.state === 1) this.trimCr();
    // The last row needs no LF: its cell closes at the end of the file, as the probe's reader closes it.
    if (this.state !== 0 || this.cells.length) {
      this.close();
      this.rowEnd();
    }
  }
}

const UTF8 = new TextDecoder('utf-8', { fatal: true });
/** Windows-1252's bytes 0x80–0x9F, 0 where the code page leaves a byte undefined. */
const CP1252 = [
  0x20ac, 0, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0, 0x017d, 0,
  0, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0, 0x017e, 0x0178,
];

/** A cell's text in the declared encoding, or undefined where its bytes aren't valid in it. */
export function decode(bytes, encoding) {
  if (encoding === 'utf-8') {
    try { return UTF8.decode(bytes); } catch { return undefined; }
  }
  let ascii = true;
  for (let i = 0; i < bytes.length; i += 1) if (bytes[i] > 0x7f) { ascii = false; break; }
  if (ascii) return bytes.toString('latin1');
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    const b = bytes[i];
    if (encoding === 'windows-1252' && b >= 0x80 && b <= 0x9f) {
      const c = CP1252[b - 0x80];
      if (!c) return undefined;
      out += String.fromCharCode(c);
    } else {
      out += String.fromCharCode(b);
    }
  }
  return out;
}
