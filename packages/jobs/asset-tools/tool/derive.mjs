import { createHash } from 'node:crypto';
import { evaluate, parse, Refused } from './expr.mjs';

export { Refused };

const I64_MIN = -(2n ** 63n);
const I64_MAX = 2n ** 63n - 1n;
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

function csvRows(text) {
  const rows = [];
  let row = [];
  let i = 0;
  for (;;) {
    let cell = '';
    if (text[i] === '"') {
      i++;
      for (;;) {
        const q = text.indexOf('"', i);
        if (q < 0) throw new Refused('a quoted cell never closes');
        cell += text.slice(i, q);
        if (text[q + 1] === '"') { cell += '"'; i = q + 2; } else { i = q + 1; break; }
      }
      while (i < text.length && text[i] !== ',' && text[i] !== '\n') i++;
    } else {
      let j = i;
      while (j < text.length && text[j] !== ',' && text[j] !== '\n') j++;
      cell = text.slice(i, j);
      i = j;
      if ((i >= text.length || text[i] === '\n') && cell.endsWith('\r')) cell = cell.slice(0, -1);
    }
    row.push(cell);
    if (i >= text.length || text[i] === '\n') {
      if (!(row.length === 1 && row[0] === '')) rows.push(row);
      row = [];
      if (i >= text.length) return rows;
    }
    i++;
  }
}

const INT = /^[+-]?\d+$/;
function typeOf(texts) {
  const given = texts.filter((t) => t !== '');
  if (given.every((t) => INT.test(t) && BigInt(t) >= I64_MIN && BigInt(t) <= I64_MAX)) return 'i64';
  if (given.every((t) => t.trim() !== '' && Number.isFinite(Number(t)))) return 'f64';
  return 'str';
}
const valueOf = (dtype, t) => (t === '' ? undefined : dtype === 'i64' ? BigInt(t) : dtype === 'f64' ? Number(t) : t);
const num = (v) => (typeof v === 'bigint' ? Number(v) : v);

function compareCells(a, b) {
  if (a === undefined || b === undefined) return a === b ? 0 : a === undefined ? 1 : -1;
  if (typeof a === 'string' || typeof b === 'string') return Buffer.compare(Buffer.from(String(a)), Buffer.from(String(b)));
  return a < b ? -1 : a > b ? 1 : 0;
}
const text = (v) => (v === undefined ? '' : typeof v === 'number' ? (Object.is(v, -0) ? '0' : String(v)) : String(v));

function readInput(name, input) {
  let body;
  try { body = new TextDecoder('utf-8', { fatal: true }).decode(input.bytes); } catch { throw new Refused(`the input ${name} isn't UTF-8 text`); }
  const [header, ...rest] = csvRows(body);
  if (!header) throw new Refused(`the input ${name} has no header row`);
  if (new Set(header).size !== header.length) throw new Refused(`the input ${name} names a column twice`);
  const key = input.key;
  if (!header.includes(key)) throw new Refused(`the input ${name} has no key column ${JSON.stringify(key)}`);
  const bad = rest.findIndex((r) => r.length !== header.length);
  if (bad >= 0) throw new Refused(`the input ${name}'s row ${bad + 1} has ${rest[bad].length} cells, its header ${header.length}`);
  const types = Object.fromEntries(header.map((c, k) => [c, typeOf(rest.map((r) => r[k]))]));
  const rows = rest.map((r) => {
    const cells = Object.fromEntries(header.map((c, k) => [c, valueOf(types[c], r[k])]));
    return { cells, from: { [name]: new Set([r[header.indexOf(key)]]) } };
  });
  const seen = new Set();
  for (const r of rows) {
    const k = [...r.from[name]][0];
    if (k === '' || seen.has(k)) throw new Refused(`the input ${name}'s key ${key} = ${JSON.stringify(k)} is ${k === '' ? 'missing' : 'not unique'}`);
    seen.add(k);
  }
  rows.sort((a, b) => compareCells(a.cells[key], b.cells[key]));
  const units = input.units ?? {};
  return {
    columns: header,
    types,
    units: Object.fromEntries(header.map((c) => [c, units[c] ?? null])),
    reads: Object.fromEntries(header.map((c) => [c, [`${name}.${c}`]])),
    rows,
    key,
    order: [...rows.map((r) => [...r.from[name]][0])],
  };
}

const merge = (a, b) => {
  const out = {};
  for (const src of [a, b]) for (const [n, keys] of Object.entries(src)) out[n] = new Set([...(out[n] ?? []), ...keys]);
  return out;
};
const tupleOf = (cells, cols) => JSON.stringify(cols.map((c) => text(cells[c])));
const sortRows = (t, cols) => t.rows.sort((a, b) => {
  for (const c of cols) { const d = compareCells(a.cells[c], b.cells[c]); if (d) return d; }
  return 0;
});

function join(t, step, inputs, receipt) {
  const { with: other, on, kind = 'inner', expect = 'many_to_one' } = step;
  const right = inputs[other];
  if (!right) throw new Refused(`join names the input ${JSON.stringify(other)}, which the job wasn't given`);
  if (!Array.isArray(on) || !on.length) throw new Refused(`join with ${other} names no columns to join on`);
  for (const c of on) {
    if (!t.columns.includes(c)) throw new Refused(`join with ${other}: the table has no column ${c}`);
    if (!right.columns.includes(c)) throw new Refused(`join with ${other}: ${other} has no column ${c}`);
  }
  const added = right.columns.filter((c) => !on.includes(c));
  const clash = added.find((c) => t.columns.includes(c));
  if (clash) throw new Refused(`join with ${other}: both tables hold a column ${clash}`);
  const once = (rows, side) => {
    const index = new Map();
    for (const r of rows) {
      if (on.some((c) => r.cells[c] === undefined)) continue;
      const k = tupleOf(r.cells, on);
      if (index.has(k)) throw new Refused(`join with ${other}: the key ${on.map((c) => `${c} ${text(r.cells[c])}`).join(', ')} appears twice in ${side}, which expect ${expect} holds once`);
      index.set(k, r);
    }
    return index;
  };
  if (expect !== 'many_to_one' && expect !== 'one_to_one') throw new Refused(`join's expect is one_to_one or many_to_one, not ${JSON.stringify(expect)}`);
  if (kind !== 'inner' && kind !== 'left') throw new Refused(`join's kind is inner or left, not ${JSON.stringify(kind)}`);
  const index = once(right.rows, other);
  if (expect === 'one_to_one') once(t.rows, 'the table');
  const rows = [];
  for (const r of t.rows) {
    const m = on.some((c) => r.cells[c] === undefined) ? undefined : index.get(tupleOf(r.cells, on));
    if (!m && kind === 'inner') { receipt.dropped++; continue; }
    const cells = { ...r.cells };
    for (const c of added) cells[c] = m?.cells[c];
    rows.push({ cells, from: m ? merge(r.from, m.from) : r.from });
  }
  for (const c of added) {
    t.types[c] = right.types[c];
    t.units[c] = right.units[c];
    t.reads[c] = right.reads[c];
  }
  for (const c of on) t.reads[c] = [...new Set([...t.reads[c], ...right.reads[c]])].sort();
  t.columns = [...t.columns, ...added];
  t.rows = rows;
}

const AGG = /^\s*(sum|min|max|mean)\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:,\s*weight\s*:\s*([A-Za-z_][A-Za-z0-9_]*)\s*)?\)\s*$|^\s*(count)\s*(?:\(\s*\))?\s*$/;
function aggOf(name, spec) {
  if (typeof spec === 'string') {
    const m = AGG.exec(spec);
    if (!m) throw new Refused(`group's aggregate ${name} is ${JSON.stringify(spec)}, not sum, count, min, max or mean of a column`);
    return m[4] ? { op: 'count' } : { op: m[1], column: m[2], weight: m[3] };
  }
  if (spec && typeof spec === 'object') {
    const op = ['sum', 'min', 'max', 'mean', 'count'].find((o) => o in spec);
    if (op === 'count') return { op };
    if (op && typeof spec[op] === 'string') return { op, column: spec[op], weight: spec.weight };
  }
  throw new Refused(`group's aggregate ${name} is neither sum, count, min, max nor mean of a column`);
}

function group(t, step, receipt) {
  const by = step.by ?? [];
  const skip = step.skip_missing === true;
  for (const c of by) if (!t.columns.includes(c)) throw new Refused(`group by ${c}: the table has no column ${c}`);
  const aggs = Object.entries(step.agg ?? {}).map(([name, spec]) => ({ name, ...aggOf(name, spec) }));
  for (const a of aggs) {
    if (by.includes(a.name)) throw new Refused(`group's aggregate ${a.name} is also a column it groups by`);
    for (const c of [a.column, a.weight].filter(Boolean)) {
      if (!t.columns.includes(c)) throw new Refused(`group's aggregate ${a.name} reads ${c}, which is no column of the table`);
      if (t.types[c] === 'str') throw new Refused(`group's aggregate ${a.name} reads ${c}, a text column`);
    }
    if (a.weight && a.op !== 'mean') throw new Refused(`group's aggregate ${a.name}: only mean takes a weight`);
  }
  const groups = new Map();
  for (const r of t.rows) {
    const k = tupleOf(r.cells, by);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const rows = [];
  for (const members of groups.values()) {
    const cells = Object.fromEntries(by.map((c) => [c, members[0].cells[c]]));
    const name = by.map((c) => `${c} ${text(cells[c])}`).join(', ') || 'the whole table';
    for (const a of aggs) {
      if (a.op === 'count') { cells[a.name] = BigInt(members.length); continue; }
      let missing = false;
      const values = [];
      for (const r of members) {
        const x = r.cells[a.column];
        const w = a.weight ? r.cells[a.weight] : 1;
        if (x === undefined || w === undefined) {
          if (skip) receipt.skipped[a.name] = (receipt.skipped[a.name] ?? 0) + 1;
          else missing = true;
          continue;
        }
        values.push([x, w]);
      }
      if (missing || !values.length) { cells[a.name] = undefined; continue; }
      if (a.op === 'sum') {
        if (t.types[a.column] === 'i64') {
          let s = 0n;
          for (const [x] of values) {
            s += x;
            if (s < I64_MIN || s > I64_MAX) throw new Refused(`the sum of ${a.column} for ${name} passes i64`);
          }
          cells[a.name] = s;
        } else {
          const s = values.reduce((acc, [x]) => acc + x, 0);
          if (Number.isFinite(s)) cells[a.name] = s;
          else { cells[a.name] = undefined; receipt.nonfinite[a.name] = (receipt.nonfinite[a.name] ?? 0) + 1; }
        }
      } else if (a.op === 'min' || a.op === 'max') {
        cells[a.name] = values.reduce((m, [x]) => (m === undefined || (a.op === 'min' ? x < m : x > m) ? x : m), undefined);
      } else {
        let sw = 0;
        let swx = 0;
        for (const [x, w] of values) { sw += num(w); swx += num(w) * num(x); }
        const mean = swx / sw;
        if (Number.isFinite(mean)) cells[a.name] = mean;
        else { cells[a.name] = undefined; receipt.nonfinite[a.name] = (receipt.nonfinite[a.name] ?? 0) + 1; }
      }
    }
    rows.push({ cells, from: members.reduce((f, r) => merge(f, r.from), {}) });
  }
  const types = {};
  const units = {};
  const reads = {};
  for (const c of by) { types[c] = t.types[c]; units[c] = t.units[c]; reads[c] = t.reads[c]; }
  for (const a of aggs) {
    types[a.name] = a.op === 'count' ? 'i64' : a.op === 'mean' ? 'f64' : t.types[a.column];
    units[a.name] = a.op === 'count' ? 'count' : t.units[a.column];
    reads[a.name] = a.op === 'count' ? [...new Set(by.flatMap((c) => t.reads[c]))].sort() : [...new Set([a.column, a.weight].filter(Boolean).flatMap((c) => t.reads[c]))].sort();
  }
  Object.assign(t, { columns: [...by, ...aggs.map((a) => a.name)], types, units, reads, rows });
  sortRows(t, by);
}

function derive(t, step, receipt) {
  for (const [name, spec] of Object.entries(step)) {
    if (t.columns.includes(name)) throw new Refused(`derive writes ${name}, which the table already holds`);
    if (!spec || typeof spec.expr !== 'string') throw new Refused(`derive ${name} gives no expr`);
    if (typeof spec.unit !== 'string' && spec.unit !== null) throw new Refused(`derive ${name} states no unit`);
    const numeric = Object.fromEntries(t.columns.filter((c) => t.types[c] !== 'str').map((c) => [c, t.units[c]]));
    const { tree, reads } = parse(spec.expr, numeric);
    for (const r of t.rows) {
      const cells = Object.fromEntries(reads.map((c) => [c, num(r.cells[c])]));
      const v = evaluate(tree, cells);
      if (v === undefined) r.cells[name] = undefined;
      else if (Number.isFinite(v)) r.cells[name] = v;
      else { r.cells[name] = undefined; receipt.nonfinite[name] = (receipt.nonfinite[name] ?? 0) + 1; }
    }
    t.columns.push(name);
    t.types[name] = 'f64';
    t.units[name] = spec.unit;
    t.reads[name] = [...new Set(reads.flatMap((c) => t.reads[c]))].sort();
  }
}

function filter(t, step, receipt) {
  const numeric = Object.fromEntries(t.columns.filter((c) => t.types[c] !== 'str').map((c) => [c, t.units[c]]));
  const { tree, reads } = parse(step.where, numeric);
  const kept = t.rows.filter((r) => {
    const v = evaluate(tree, Object.fromEntries(reads.map((c) => [c, num(r.cells[c])])));
    return v !== undefined && !Number.isNaN(v) && v !== 0;
  });
  receipt.dropped += t.rows.length - kept.length;
  t.rows = kept;
}

function rank(t, step, key) {
  const { by, desc = true, within = [], into } = step;
  for (const c of [by, ...within]) if (!t.columns.includes(c)) throw new Refused(`rank reads ${c}, which is no column of the table`);
  if (typeof into !== 'string' || t.columns.includes(into)) throw new Refused(`rank writes into ${JSON.stringify(into)}, which must be a new column`);
  if (!t.columns.includes(key)) throw new Refused(`rank breaks ties by the key ${key}, which is no column of the table`);
  const parts = new Map();
  for (const r of t.rows) {
    const k = tupleOf(r.cells, within);
    if (!parts.has(k)) parts.set(k, []);
    parts.get(k).push(r);
  }
  for (const rows of parts.values()) {
    const ranked = rows.filter((r) => r.cells[by] !== undefined).sort((a, b) => {
      const d = compareCells(a.cells[by], b.cells[by]);
      return (desc ? -d : d) || compareCells(a.cells[key], b.cells[key]);
    });
    for (const r of rows) r.cells[into] = undefined;
    ranked.forEach((r, i) => { r.cells[into] = BigInt(i + 1); });
  }
  t.columns.push(into);
  t.types[into] = 'i64';
  t.units[into] = null;
  t.reads[into] = [...new Set([by, ...within].flatMap((c) => t.reads[c]))].sort();
}

function select(t, step) {
  const columns = step.columns ?? [];
  for (const c of columns) if (!t.columns.includes(c)) throw new Refused(`select names ${c}, which is no column of the table`);
  t.columns = [...columns];
}

const csvCell = (s) => (/[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s);

export function run(params, given) {
  const names = Object.keys(given).sort();
  const named = params.inputs ?? {};
  for (const n of new Set([...names, ...Object.keys(named)])) {
    if (!given[n] || sha256(given[n].bytes) !== named[n]) throw new Refused(`the input ${n} isn't the table ${named[n] ?? 'its params name'} by its bytes' hash`);
  }
  const inputs = Object.fromEntries(names.map((n) => [n, readInput(n, given[n])]));
  const steps = Array.isArray(params.steps) ? params.steps : [];
  const joined = new Set(steps.map((s) => s?.join?.with).filter(Boolean));
  const starts = names.filter((n) => !joined.has(n));
  if (starts.length !== 1) throw new Refused(`the first step reads the one input no join names, and ${starts.length ? starts.join(' and ') : 'none'} ${starts.length === 1 ? 'is' : 'are'} left`);
  const start = inputs[starts[0]];
  const t = { ...start, columns: [...start.columns], types: { ...start.types }, units: { ...start.units }, reads: { ...start.reads }, rows: start.rows.map((r) => ({ cells: { ...r.cells }, from: r.from })) };
  const receipt = { rows_in: start.rows.length, rows_out: 0, dropped: 0, skipped: {}, nonfinite: {} };
  for (const step of steps) {
    const [op, ...more] = Object.keys(step ?? {});
    if (!op || more.length) throw new Refused(`a step is one of join, group, derive, filter, rank and select, given as {name: {...}}`);
    const s = step[op];
    if (op === 'join') join(t, s, inputs, receipt);
    else if (op === 'group') group(t, s, receipt);
    else if (op === 'derive') derive(t, s, receipt);
    else if (op === 'filter') filter(t, s, receipt);
    else if (op === 'rank') rank(t, s, params.key);
    else if (op === 'select') select(t, s);
    else throw new Refused(`${op} is no step of table.derive: join, group, derive, filter, rank or select`);
  }
  const key = params.key;
  if (!t.columns.includes(key)) throw new Refused(`the output's key ${JSON.stringify(key)} is no column of the table the steps wrote`);
  sortRows(t, [key]);
  const keys = new Set();
  for (const r of t.rows) {
    const k = text(r.cells[key]);
    if (k === '' || keys.has(k)) throw new Refused(`the output's key ${key} = ${JSON.stringify(k)} is ${k === '' ? 'missing' : 'not unique'}`);
    keys.add(k);
  }
  receipt.rows_out = t.rows.length;
  const parts = [];
  let at = 0;
  const cells = Object.fromEntries(t.columns.map((c) => [c, []]));
  const write = (s) => { parts.push(s); at += Buffer.byteLength(s); };
  const line = (values, column) => {
    values.forEach((v, k) => {
      if (k) write(',');
      const quoted = csvCell(v);
      const inner = quoted === v ? v : quoted.slice(1, -1);
      if (quoted !== v) write('"');
      if (column) cells[t.columns[k]].push({ bytes: [at, at + Buffer.byteLength(inner)], raw: inner });
      write(inner);
      if (quoted !== v) write('"');
    });
    write('\n');
  };
  line(t.columns, false);
  for (const r of t.rows) line(t.columns.map((c) => text(r.cells[c])), true);
  const csv = parts.join('');
  const record = {
    probe: { table: { rows: t.rows.length, columns: t.columns.map((c) => ({ name: c, dtype: t.types[c], unit: t.units[c] })), key } },
    cells,
  };
  const order = Object.fromEntries(names.map((n) => [n, new Map(inputs[n].order.map((k, i) => [k, i]))]));
  const lineage = {
    format: 1,
    key,
    inputs: Object.fromEntries(names.map((n) => [n, { sha256: sha256(given[n].bytes), key: inputs[n].key }])),
    columns: Object.fromEntries(t.columns.map((c) => [c, { unit: t.units[c], reads: t.reads[c].map((r) => ({ input: r.slice(0, r.indexOf('.')), column: r.slice(r.indexOf('.') + 1) })) }])),
    rows: Object.fromEntries(t.rows.map((r) => [text(r.cells[key]), Object.fromEntries(Object.keys(r.from).sort().map((n) => [n, [...r.from[n]].sort((a, b) => order[n].get(a) - order[n].get(b))]))])),
  };
  const sorted = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
  const out = { ...receipt, skipped: sorted(receipt.skipped), nonfinite: sorted(receipt.nonfinite) };
  return {
    table: Buffer.from(csv, 'utf8'), lineage: Buffer.from(`${JSON.stringify(lineage)}\n`),
    receipt: Buffer.from(`${JSON.stringify(out)}\n`), record: Buffer.from(`${JSON.stringify(record)}\n`),
  };
}
