// data.derived's recount (#3569): table.derive's output recomputed from the input files' bytes by code that shares
// nothing with the job's tool (./tool). It reads the inputs column-wise, evaluates expressions through its own reverse
// Polish form, sums integers exactly and numbers with compensation, and compares every output cell: integers exactly,
// numbers within 1e-12 relative. It holds each sum to its inputs, the receipt to what it counted and the lineage to
// the rows it saw. It answers each disagreement as a sentence naming the output cell, and none when all agree.

const REL = 1e-12;

/** A CSV split into lines of fields: quoted fields unquoted, a CR before LF dropped, blank lines skipped. */
function fields(src) {
  const out = [];
  let line = [];
  let f = '';
  let q = false;
  let wasQuoted = false;
  const endField = () => {
    if (!wasQuoted && f.endsWith('\r')) f = f.slice(0, -1);
    line.push(f);
    f = '';
    wasQuoted = false;
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"' && src[i + 1] === '"') { f += '"'; i++; } else if (ch === '"') q = false; else f += ch;
    } else if (ch === '"' && f === '') { q = true; wasQuoted = true; } else if (ch === ',') endField();
    else if (ch === '\n') { endField(); if (!(line.length === 1 && line[0] === '')) out.push(line); line = []; } else f += ch;
  }
  if (f !== '' || line.length) { endField(); if (!(line.length === 1 && line[0] === '')) out.push(line); }
  return out;
}

/** A table column by column: {names, col: {name → [text]}, n}. */
function columnar(bytes) {
  const [head, ...body] = fields(Buffer.from(bytes).toString('utf8'));
  const col = {};
  head.forEach((h, k) => { col[h] = body.map((r) => r[k] ?? ''); });
  return { names: head, col, n: body.length };
}

const isInt = (s) => /^[+-]?[0-9]+$/.test(s);
const kindOf = (texts) => {
  const xs = texts.filter((s) => s.length > 0);
  if (xs.every(isInt)) return 'int';
  if (xs.every((s) => !/^\s*$/.test(s) && Number.isFinite(+s))) return 'num';
  return 'text';
};

/** Order of two key texts in one column of a kind: numbers by value, text by UTF-8 bytes. */
const order = (kind) => (a, b) => {
  if (kind === 'int') { const x = BigInt(a); const y = BigInt(b); return x === y ? 0 : x < y ? -1 : 1; }
  if (kind === 'num') return +a - +b;
  return Buffer.compare(Buffer.from(a), Buffer.from(b));
};

/** Compensated sum of numbers (Neumaier). */
function fsum(xs) {
  let s = 0;
  let c = 0;
  for (const x of xs) {
    const t = s + x;
    c += Math.abs(s) >= Math.abs(x) ? s - t + x : x - t + s;
    s = t;
  }
  return s + c;
}

// The expression's own reader: tokens to reverse Polish by precedence, then a stack machine.
const PREC = { '||': 1, '&&': 2, '==': 3, '!=': 3, '<': 4, '<=': 4, '>': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6, '^': 8 };
const FN = {
  min: (a, b) => (a < b ? a : b), max: (a, b) => (a > b ? a : b), clamp: (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x),
  abs: (x) => (x < 0 ? -x : x), sign: (x) => Math.sign(x), floor: Math.floor, ceil: Math.ceil, fract: (x) => x - Math.floor(x),
  round: (x) => Math.sign(x) * Math.round(Math.abs(x)), mod: (x, y) => x - y * Math.floor(x / y), sqrt: Math.sqrt, pow: (x, y) => x ** y,
  exp: Math.exp, log: Math.log, sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  atan2: Math.atan2, deg: (x) => x * (180 / Math.PI), rad: (x) => x * (Math.PI / 180), sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  asinh: Math.asinh, acosh: Math.acosh, atanh: Math.atanh, log2: Math.log2, log10: Math.log10, log1p: Math.log1p, expm1: Math.expm1,
  hypot: (a, b) => Math.hypot(a, b), cbrt: Math.cbrt, sinc: (x) => (x ? Math.sin(x) / x : 1), mix: (a, b, t) => a * (1 - t) + b * t,
  smoothstep: (a, b, x) => { let t = (x - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); },
  remap: (x, a, b, c, d) => c + ((d - c) * (x - a)) / (b - a),
};

function rpn(src) {
  const toks = src.match(/\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?|[A-Za-z_]\w*|&&|\|\||[=!<>]=|[-+*/%^<>!?:(),]/g) ?? [];
  const out = [];
  const ops = [];
  const arity = [];
  let prevValue = false;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (/^[\d.]/.test(t)) { out.push({ n: +t }); prevValue = true; } else if (/^[A-Za-z_]/.test(t)) {
      if (toks[i + 1] === '(') { ops.push({ fn: t }); arity.push(1); } else { out.push(t === 'pi' ? { n: Math.PI } : t === 'tau' ? { n: 2 * Math.PI } : { v: t }); prevValue = true; }
    } else if (t === '(') { ops.push('('); prevValue = false; if (toks[i + 1] === ')' && typeof ops.at(-2) === 'object') arity[arity.length - 1] = 0; } else if (t === ',') {
      while (ops.at(-1) !== '(') out.push(ops.pop());
      arity[arity.length - 1]++;
      prevValue = false;
    } else if (t === ')') {
      while (ops.at(-1) !== '(') out.push(ops.pop());
      ops.pop();
      if (typeof ops.at(-1) === 'object') out.push({ ...ops.pop(), k: arity.pop() });
      prevValue = true;
    } else if (t === '?') {
      while (ops.length && typeof ops.at(-1) === 'string' && !['(', '?', ':'].includes(ops.at(-1))) out.push(ops.pop());
      ops.push('?');
      prevValue = false;
    } else if (t === ':') {
      while (ops.at(-1) !== '?') out.push(ops.pop());
      ops.pop();
      ops.push(':');
      prevValue = false;
    } else if (!prevValue && (t === '-' || t === '+' || t === '!')) { ops.push(`u${t}`); } else {
      const p = PREC[t];
      while (ops.length) {
        const top = ops.at(-1);
        if (typeof top !== 'string' || top === '(' || top === '?' || top === ':') break;
        // A leading minus binds looser than ^ and tighter than the rest: −x^2 is −(x²).
        const tp = top.startsWith('u') ? 7 : PREC[top];
        if (tp > p || (tp === p && t !== '^')) out.push(ops.pop()); else break;
      }
      ops.push(t);
      prevValue = false;
    }
  }
  while (ops.length) out.push(ops.pop());
  return out;
}

/** The value of a reverse Polish form over a row: undefined when a cell it reads is missing. */
function run(code, row) {
  const st = [];
  for (const c of code) {
    if (typeof c === 'object' && 'n' in c) st.push(c.n);
    else if (typeof c === 'object' && 'v' in c) st.push(row(c.v));
    else if (typeof c === 'object') { const args = st.splice(st.length - c.k, c.k); st.push(args.includes(undefined) ? undefined : FN[c.fn](...args)); } else if (c === ':') {
      const b = st.pop(); const a = st.pop(); const k = st.pop();
      st.push(k === undefined ? undefined : k !== 0 && k === k ? a : b);
    } else if (c.startsWith('u')) { const a = st.pop(); st.push(a === undefined ? undefined : c === 'u-' ? -a : c === 'u!' ? +(a === 0) : a); } else {
      const b = st.pop(); const a = st.pop();
      if (a === undefined || b === undefined) { st.push(undefined); continue; }
      st.push({ '+': a + b, '-': a - b, '*': a * b, '/': a / b, '%': a % b, '^': a ** b, '==': +(a === b), '!=': +(a !== b), '<': +(a < b), '<=': +(a <= b), '>': +(a > b), '>=': +(a >= b), '&&': +(a !== 0 && b !== 0), '||': +(a !== 0 || b !== 0) }[c]);
    }
  }
  return st[0];
}

const plain = (v) => (v === undefined ? '' : typeof v === 'number' && v === 0 ? '0' : String(v));

/**
 * The recount: `params` the job's, `inputs` {name → {bytes, key}} and `outputs` {table, lineage, receipt} as bytes.
 * Answers the disagreements, each naming the output cell or the receipt's field.
 */
export function recount(params, inputs, outputs) {
  const wrong = [];
  // Each input as rows of {col → typed value}, keyed by its key, in key order.
  const tables = {};
  for (const [name, input] of Object.entries(inputs)) {
    const t = columnar(input.bytes);
    const kinds = Object.fromEntries(t.names.map((h) => [h, kindOf(t.col[h])]));
    const typed = (h, s) => (s === '' ? undefined : kinds[h] === 'int' ? BigInt(s) : kinds[h] === 'num' ? +s : s);
    const idx = [...Array(t.n).keys()].sort((a, b) => order(kinds[input.key])(t.col[input.key][a], t.col[input.key][b]));
    tables[name] = { kinds, rows: idx.map((i) => ({ v: Object.fromEntries(t.names.map((h) => [h, typed(h, t.col[h][i])])), src: { [name]: [t.col[input.key][i]] } })) };
  }
  const steps = params.steps ?? [];
  const withs = steps.filter((s) => s.join).map((s) => s.join.with);
  const first = Object.keys(inputs).filter((n) => !withs.includes(n));
  if (first.length !== 1) return [`data.derived: no one input to start from (${first.join(', ') || 'none'})`];
  const startName = first[0];
  let kinds = { ...tables[startName].kinds };
  let rows = tables[startName].rows.map((r) => ({ v: { ...r.v }, src: r.src }));
  // Where each column's cells come from, for the sums held to their inputs: the start input's own column, or none.
  let origin = Object.fromEntries(Object.keys(kinds).map((h) => [h, h]));
  const count = { rows_in: rows.length, dropped: 0, skipped: {}, nonfinite: {} };
  const droppedRows = [];
  const sums = [];
  const bump = (o, k) => { o[k] = (o[k] ?? 0) + 1; };
  const join = (a, b) => { const s = { ...a }; for (const [n, ks] of Object.entries(b)) s[n] = [...(s[n] ?? []), ...ks]; return s; };
  const keyText = (r, cols) => cols.map((c) => plain(r.v[c])).join('\u0000');
  for (const step of steps) {
    const [op] = Object.keys(step);
    const s = step[op];
    if (op === 'join') {
      const right = tables[s.with];
      const m = new Map();
      for (const r of right.rows) if (s.on.every((c) => r.v[c] !== undefined)) m.set(keyText(r, s.on), r);
      const next = [];
      for (const r of rows) {
        const hit = s.on.every((c) => r.v[c] !== undefined) ? m.get(keyText(r, s.on)) : undefined;
        if (!hit && (s.kind ?? 'inner') === 'inner') { count.dropped++; droppedRows.push(r); continue; }
        const v = { ...r.v };
        for (const [c, x] of Object.entries(hit?.v ?? Object.fromEntries(Object.keys(right.kinds).map((c) => [c, undefined])))) if (!s.on.includes(c)) v[c] = x;
        next.push({ v, src: hit ? join(r.src, hit.src) : r.src });
      }
      for (const c of Object.keys(right.kinds)) if (!s.on.includes(c)) { kinds[c] = right.kinds[c]; origin[c] = null; }
      rows = next;
    } else if (op === 'filter') {
      const code = rpn(s.where);
      const next = [];
      for (const r of rows) {
        const x = run(code, (c) => (r.v[c] === undefined ? undefined : Number(r.v[c])));
        if (x === undefined || x !== x || x === 0) { count.dropped++; droppedRows.push(r); } else next.push(r);
      }
      rows = next;
    } else if (op === 'derive') {
      for (const [name, d] of Object.entries(s)) {
        const code = rpn(d.expr);
        for (const r of rows) {
          const x = run(code, (c) => (r.v[c] === undefined ? undefined : Number(r.v[c])));
          if (x !== undefined && !Number.isFinite(x)) bump(count.nonfinite, name);
          r.v[name] = x !== undefined && Number.isFinite(x) ? x : undefined;
        }
        kinds[name] = 'num';
        origin[name] = null;
      }
    } else if (op === 'group') {
      const by = s.by ?? [];
      const buckets = new Map();
      for (const r of rows) {
        const k = keyText(r, by);
        if (!buckets.has(k)) buckets.set(k, []);
        buckets.get(k).push(r);
      }
      const nk = Object.fromEntries(by.map((c) => [c, kinds[c]]));
      const no = Object.fromEntries(by.map((c) => [c, null]));
      const next = [];
      for (const members of buckets.values()) {
        const v = Object.fromEntries(by.map((c) => [c, members[0].v[c]]));
        for (const [name, spec] of Object.entries(s.agg ?? {})) {
          const m = typeof spec === 'string' ? /^\s*(\w+)\s*(?:\(\s*(\w*)\s*(?:,\s*weight\s*:\s*(\w+))?\s*\))?\s*$/.exec(spec) : null;
          const fn = m ? m[1] : Object.keys(spec).find((k) => k !== 'weight');
          const col = m ? m[2] : spec[fn];
          const weight = m ? m[3] : spec.weight;
          if (fn === 'count') { v[name] = BigInt(members.length); nk[name] = 'int'; continue; }
          const xs = [];
          let hole = false;
          for (const r of members) {
            if (r.v[col] === undefined || (weight && r.v[weight] === undefined)) { if (s.skip_missing === true) bump(count.skipped, name); else hole = true; } else xs.push(r);
          }
          nk[name] = fn === 'mean' ? 'num' : kinds[col];
          if (hole || xs.length === 0) { v[name] = undefined; continue; }
          if (fn === 'sum') v[name] = kinds[col] === 'int' ? xs.reduce((a, r) => a + r.v[col], 0n) : fsum(xs.map((r) => r.v[col]));
          else if (fn === 'min') v[name] = xs.map((r) => r.v[col]).reduce((a, b) => (b < a ? b : a));
          else if (fn === 'max') v[name] = xs.map((r) => r.v[col]).reduce((a, b) => (b > a ? b : a));
          else {
            const w = xs.map((r) => (weight ? Number(r.v[weight]) : 1));
            const x = fsum(xs.map((r, i) => w[i] * Number(r.v[col]))) / fsum(w);
            if (Number.isFinite(x)) v[name] = x; else { v[name] = undefined; bump(count.nonfinite, name); }
          }
          if (fn === 'sum' && origin[col] && !sums.some((x) => x.name === name)) sums.push({ name, col: origin[col] });
        }
        next.push({ v, src: members.reduce((a, r) => join(a, r.src), {}) });
      }
      for (const [name, spec] of Object.entries(s.agg ?? {})) {
        const fn = typeof spec === 'string' ? /^\s*(\w+)/.exec(spec)[1] : Object.keys(spec).find((k) => k !== 'weight');
        no[name] = null;
        if (fn === 'count') nk[name] = 'int';
      }
      kinds = nk;
      origin = no;
      rows = next;
    } else if (op === 'rank') {
      const within = s.within ?? [];
      const desc = s.desc !== false;
      const parts = new Map();
      for (const r of rows) { const k = keyText(r, within); if (!parts.has(k)) parts.set(k, []); parts.get(k).push(r); }
      const keyOrder = order(kinds[params.key]);
      for (const part of parts.values()) {
        const has = part.filter((r) => r.v[s.by] !== undefined);
        has.sort((a, b) => {
          const x = Number(a.v[s.by]); const y = Number(b.v[s.by]);
          if (x !== y) return desc ? y - x : x - y;
          return keyOrder(plain(a.v[params.key]), plain(b.v[params.key]));
        });
        for (const r of part) r.v[s.into] = undefined;
        has.forEach((r, i) => { r.v[s.into] = BigInt(i + 1); });
      }
      kinds[s.into] = 'int';
      origin[s.into] = null;
    } else if (op === 'select') {
      const keep = s.columns;
      kinds = Object.fromEntries(keep.map((c) => [c, kinds[c]]));
      origin = Object.fromEntries(keep.map((c) => [c, origin[c] ?? null]));
    }
  }
  const key = params.key;
  const expected = new Map(rows.map((r) => [plain(r.v[key]), r]));
  const got = columnar(outputs.table);
  const where = (k, c) => `${c} for ${key} ${k}`;
  if (got.names.join(',') !== Object.keys(kinds).join(',')) wrong.push(`data.derived: the table's columns are ${got.names.join(', ')}, and the recount writes ${Object.keys(kinds).join(', ')}`);
  const seen = new Set();
  for (let i = 0; i < got.n; i++) {
    const k = got.col[key]?.[i] ?? '';
    seen.add(k);
    const r = expected.get(k);
    if (!r) { wrong.push(`data.derived: the table holds a row ${key} ${k}, which the recount doesn't write`); continue; }
    for (const c of Object.keys(kinds)) {
      const cell = got.col[c]?.[i] ?? '';
      const want = r.v[c];
      if (want === undefined || cell === '') {
        if (!(want === undefined && cell === '')) wrong.push(`data.derived: ${where(k, c)}: the job wrote ${cell === '' ? 'a missing cell' : cell} and the recount reads ${want === undefined ? 'missing' : plain(want)}`);
      } else if (typeof want === 'bigint') {
        if (!isInt(cell) || BigInt(cell) !== want) wrong.push(`data.derived: ${where(k, c)}: the job wrote ${cell} and the recount reads ${want}`);
      } else if (typeof want === 'number') {
        const x = +cell;
        if (!(Math.abs(x - want) <= REL * Math.max(Math.abs(x), Math.abs(want)))) wrong.push(`data.derived: ${where(k, c)}: the job wrote ${cell} and the recount reads ${want}`);
      } else if (cell !== want) wrong.push(`data.derived: ${where(k, c)}: the job wrote ${JSON.stringify(cell)} and the recount reads ${JSON.stringify(want)}`);
    }
  }
  for (const k of expected.keys()) if (!seen.has(k)) wrong.push(`data.derived: the recount writes a row ${key} ${k}, which the table lacks`);
  // Each sum held to its inputs: what the output's groups hold plus what was dropped equals the start input's column.
  for (const { name, col } of sums) {
    const cells = rows.map((r) => r.v[name]);
    if (cells.includes(undefined) && !(params.steps ?? []).some((st) => st.group?.skip_missing === true)) continue;
    const at = got.names.includes(name) ? got.col[name] : [];
    const total = tables[startName].rows.map((r) => r.v[col]).filter((x) => x !== undefined);
    const lost = droppedRows.map((r) => r.v[col]).filter((x) => x !== undefined);
    const int = total.every((x) => typeof x === 'bigint');
    const shown = at.filter((s) => s !== '');
    const ok = int && shown.every(isInt)
      ? shown.reduce((a, s) => a + BigInt(s), 0n) + lost.reduce((a, x) => a + x, 0n) === total.reduce((a, x) => a + x, 0n)
      : Math.abs(fsum(shown.map(Number)) + fsum(lost.map(Number)) - fsum(total.map(Number))) <= REL * Math.abs(fsum(total.map(Number)));
    if (!ok) wrong.push(`data.derived: ${name}: the table's total plus what was dropped or skipped isn't the total of ${col} in ${startName}`);
  }
  let receipt;
  try { receipt = JSON.parse(Buffer.from(outputs.receipt).toString('utf8')); } catch { return [...wrong, 'data.derived: the receipt is no JSON']; }
  const want = { rows_in: count.rows_in, rows_out: rows.length, dropped: count.dropped, skipped: count.skipped, nonfinite: count.nonfinite };
  for (const [f, v] of Object.entries(want)) {
    const g = receipt?.[f];
    const same = typeof v === 'object' ? JSON.stringify(Object.entries(g ?? {}).sort()) === JSON.stringify(Object.entries(v).sort()) : g === v;
    if (!same) wrong.push(`data.derived: the receipt's ${f} reads ${JSON.stringify(g)} and the recount counts ${JSON.stringify(v)}`);
  }
  let lineage;
  try { lineage = JSON.parse(Buffer.from(outputs.lineage).toString('utf8')); } catch { return [...wrong, 'data.derived: the lineage is no JSON']; }
  for (const [k, r] of expected) {
    const fed = Object.fromEntries(Object.entries(r.src).map(([n, ks]) => [n, [...new Set(ks)].sort()]));
    const said = Object.fromEntries(Object.entries(lineage?.rows?.[k] ?? {}).map(([n, ks]) => [n, [...ks].sort()]));
    if (JSON.stringify(Object.entries(fed).sort()) !== JSON.stringify(Object.entries(said).sort())) wrong.push(`data.derived: the lineage of ${key} ${k} names ${JSON.stringify(said)}, and the recount's rows are ${JSON.stringify(fed)}`);
  }
  return wrong;
}
