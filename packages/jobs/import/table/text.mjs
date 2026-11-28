const QUOTE = 0x22;
const LF = 0x0a;
const CR = 0x0d;
export const DELIMITERS = { comma: 0x2c, tab: 0x09, pipe: 0x7c };
const ROW_MAX = 16 * 1024 * 1024;

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
    this.state = 0;
  }
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
  trimCr() {
    const last = this.cell[this.cell.length - 1];
    if (!this.long && last && last.length && last[last.length - 1] === CR) this.cell[this.cell.length - 1] = last.subarray(0, last.length - 1);
  }
  end() {
    if (this.state === 1) this.trimCr();
    if (this.state !== 0 || this.cells.length) {
      this.close();
      this.rowEnd();
    }
  }
}

const UTF8 = new TextDecoder('utf-8', { fatal: true });
const CP1252 = [
  0x20ac, 0, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0, 0x017d, 0,
  0, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0, 0x017e, 0x0178,
];

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
