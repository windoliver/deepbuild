// What a planted tool makes wrong (issue #3569 acceptance; README: The planted programs). A plan names cells of the
// derived table by its key column and their column, each with the value the right tool writes there (`expect`: a
// number, or null for a missing cell, which the table writes empty) and the text the wrong program writes in its
// place (`to`). When every named cell holds what the plan expects, the cells are rewritten and the table is handed on
// with nothing else changed but its quoting; when any doesn't, the table is the right tool's, byte for byte. So a
// planted tool is wrong only on the one job its test runs, and right on every other input, the kind's qualification
// fixtures included.

/** The rows of a CSV, each a list of cells, quotes undone: RFC 4180, LF or CR LF row ends. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i += 2; continue; }
      if (c === '"') { quoted = false; i += 1; continue; }
      cell += c; i += 1; continue;
    }
    if (c === '"' && cell === '') { quoted = true; i += 1; continue; }
    if (c === ',') { row.push(cell); cell = ''; i += 1; continue; }
    if (c === '\r' && text[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i += 2; continue; }
    if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i += 1; continue; }
    cell += c; i += 1;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const quote = (cell) => (/[",\r\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell);

/** Whether a cell holds what the plan expects: empty for null, else a number within 1e-9 of it, relative. */
function holds(cell, expect) {
  if (expect === null) return cell === '';
  if (cell === '' || !Number.isFinite(Number(cell))) return false;
  return Math.abs(Number(cell) - expect) <= 1e-9 * Math.max(1, Math.abs(expect));
}

/**
 * The plan's edits made to a CSV's text: the new text, or null when the plan doesn't apply to it (a named cell is
 * absent or holds something other than what the plan expects), so the caller hands the right bytes on.
 * plan: {key: column, edits: [{key, column, expect: number | null, to: string}]}
 */
export function spoil(text, plan) {
  if (!plan || !Array.isArray(plan.edits) || plan.edits.length === 0) return null;
  const rows = parseCsv(text);
  if (rows.length < 2) return null;
  const header = rows[0];
  const k = header.indexOf(plan.key);
  if (k < 0) return null;
  for (const e of plan.edits) {
    const c = header.indexOf(e.column);
    const row = rows.slice(1).find((r) => r[k] === e.key);
    if (c < 0 || !row || !holds(row[c] ?? '', e.expect)) return null;
  }
  for (const e of plan.edits) {
    const c = header.indexOf(e.column);
    rows.slice(1).find((r) => r[k] === e.key)[c] = e.to;
  }
  const end = text.includes('\r\n') ? '\r\n' : '\n';
  const body = rows.map((r) => r.map(quote).join(',')).join(end);
  return text.endsWith('\n') ? `${body}${end}` : body;
}
