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

function holds(cell, expect) {
  if (expect === null) return cell === '';
  if (cell === '' || !Number.isFinite(Number(cell))) return false;
  return Math.abs(Number(cell) - expect) <= 1e-9 * Math.max(1, Math.abs(expect));
}

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
