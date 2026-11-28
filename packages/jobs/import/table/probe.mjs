// The import job's check on a table it wrote (#3570; canvas primitives: Asset: tables, as #397's probe reads one):
// UTF-8 CSV under the table cap, a header row of distinct, named columns first, and every row as many cells as it.
// Nothing an item can name is kept until it passes.
import { TABLE_MAX } from './cut.mjs';
import { DELIMITERS, Rows } from './text.mjs';

/** What is wrong with a table's bytes, in words, or undefined when it reads as a table. */
export function tableProbe(bytes) {
  if (bytes.length > TABLE_MAX) return `the table is ${bytes.length} bytes, past the ${TABLE_MAX}-byte cap`;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return 'the table isn\'t UTF-8';
  }
  let width;
  let wrong;
  const rows = new Rows(DELIMITERS.comma, (cells, n) => {
    if (wrong) return;
    if (width === undefined) {
      const names = cells.map((c) => c.toString('utf8'));
      if (names.some((name) => !name)) wrong = 'a header cell names no column';
      else if (new Set(names).size !== names.length) wrong = 'the header names a column twice';
      width = cells.length;
    } else if (cells.length !== width) {
      wrong = `row ${n} has ${cells.length} cells where the header has ${width}`;
    }
  });
  rows.push(Buffer.from(bytes));
  rows.end();
  if (width === undefined) return 'the table has no header row';
  return wrong;
}
