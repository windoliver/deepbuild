// The record a job's table output gets beside its bytes in the evidence store (#3570; canvas primitives: Asset:
// tables), `tables/<sha256>.json`, as `deep-show run` writes one for a table it fetched (#397): its probe (rows, typed
// columns, key), every cell's byte range in the file and its raw bytes, and its source, which the hub writes, never the
// tool: `job {kind, tool, input}`, each input with the URL and fetch time the hub recorded when it fetched the file, or
// `origin: agent` where the hub fetched none of it. A document's `{from: asset, column}` reads the record, so a label's
// trace runs through the job to the URL. The cells split by the probe's CSV rule (crates/deep-catalog/src/cells.rs):
// a row ends at LF, a CR before it outside the cell, a quoted cell's range inside its quotes.

type Cell = { start: number; end: number };

/** The rows of a CSV, each a list of its cells' byte ranges; a blank line is no row. */
function rows(data: Uint8Array): Cell[][] {
  const out: Cell[][] = [];
  let row: Cell[] = [];
  let i = 0;
  const QUOTE = 0x22, COMMA = 0x2c, LF = 0x0a, CR = 0x0d;
  while (i <= data.length) {
    const quoted = data[i] === QUOTE;
    const start = quoted ? i + 1 : i;
    let j = start;
    if (quoted) {
      while (j < data.length && !(data[j] === QUOTE && data[j + 1] !== QUOTE)) j += data[j] === QUOTE ? 2 : 1;
    } else {
      while (j < data.length && data[j] !== COMMA && data[j] !== LF) j += 1;
    }
    let end = j;
    let next = quoted ? j + 1 : j;
    while (next < data.length && data[next] !== COMMA && data[next] !== LF) next += 1;
    const rowEnd = next >= data.length || data[next] === LF;
    if (!quoted && rowEnd && end > start && data[end - 1] === CR) end -= 1;
    row.push({ start, end });
    i = next + 1;
    if (rowEnd) {
      if (!(row.length === 1 && row[0]!.start === row[0]!.end)) out.push(row);
      row = [];
    }
  }
  return out;
}

/** The narrowest type every cell a column holds reads as, `i64`, `f64` or `str`; a missing (empty) cell reads as any. */
function dtype(texts: string[]): 'i64' | 'f64' | 'str' {
  const held = texts.filter((t) => t !== '');
  if (held.every((t) => /^[+-]?\d+$/.test(t))) return 'i64';
  if (held.every((t) => /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(t) && Number.isFinite(Number(t)))) return 'f64';
  return 'str';
}

/** The record of a table's bytes: its probe, its cells and the source the hub gives it; undefined for bytes with no header. */
export function tableRecord(sha256: string, bytes: Uint8Array, key: unknown, source: Record<string, unknown>): Record<string, unknown> | undefined {
  const text = (c: Cell): string => Buffer.from(bytes.subarray(c.start, c.end)).toString('utf8');
  const [header, ...body] = rows(bytes);
  if (!header) return undefined;
  const names = header.map(text);
  const columns: Record<string, unknown>[] = [];
  const cells: Record<string, unknown> = {};
  names.forEach((name, k) => {
    const raws = body.map((r) => (r[k] ? text(r[k]!) : ''));
    columns.push({ name, dtype: dtype(raws), unit: null });
    cells[name] = body.map((r, n) => ({ bytes: r[k] ? [r[k]!.start, r[k]!.end] : null, raw: raws[n] }));
  });
  return { sha256, kind: 'table', probe: { table: { rows: body.length, columns, key: typeof key === 'string' && names.includes(key) ? key : null } }, cells, source };
}
