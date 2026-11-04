// Extracts the ported IEEE 1788 cases into itf1788-libieeep1788-elem.json (README: Criterion 3).
//
//   node tests/acceptance/490-oracle/fixtures/extract-itf1788.mjs <path to libieeep1788_elem.rs> > tests/acceptance/490-oracle/fixtures/itf1788-libieeep1788-elem.json
//
// The input is inari 9e519ce47c9baa897bf11a735300ca4718a7a2a1's tests/itf1788_tests/libieeep1788_elem.rs (the
// Oracle page's pinned copy), Apache-2.0 (its notice is carried into the output). Every `assert_eq2!` in a
// non-decorated test of a function on our closed list is read; a case is kept only when our `fn` call can state it
// (finite input bounds, a non-empty answer, an input inside the function's domain, at most one interval operand),
// and every dropped case is counted with its reason. Node built-ins only; it reads the file and prints JSON.
import { readFileSync } from 'node:fs';

const SOURCE = 'inari 9e519ce47c9baa897bf11a735300ca4718a7a2a1 tests/itf1788_tests/libieeep1788_elem.rs';
const text = readFileSync(process.argv[2], 'utf8');
const lines = text.split('\n');
const notice = lines.slice(0, lines.findIndex((l) => l.startsWith(' */')) + 1).join('\n');

/** inari's method → our closed-list expression over x, `c` the other operand's literal when there is one. */
const UNARY = {
  sqr: () => 'x^2', sqrt: () => 'sqrt(x)', recip: () => '1/x', exp: () => 'exp(x)', exp2: () => 'pow(2, x)', exp10: () => 'pow(10, x)',
  ln: () => 'log(x)', log2: () => 'log2(x)', log10: () => 'log10(x)', sin: () => 'sin(x)', cos: () => 'cos(x)', tan: () => 'tan(x)',
  asin: () => 'asin(x)', acos: () => 'acos(x)', atan: () => 'atan(x)', sinh: () => 'sinh(x)', cosh: () => 'cosh(x)', tanh: () => 'tanh(x)',
  asinh: () => 'asinh(x)', acosh: () => 'acosh(x)', atanh: () => 'atanh(x)', sign: () => 'sign(x)', ceil: () => 'ceil(x)',
  floor: () => 'floor(x)', round: () => 'round(x)', abs: () => 'abs(x)',
};
const TESTS = new Set([
  'neg', 'add', 'sub', 'mul', 'div', 'recip', 'sqr', 'sqrt', 'pown', 'pow', 'exp', 'exp2', 'exp10', 'log', 'log2', 'log10', 'sin', 'cos',
  'tan', 'asin', 'acos', 'atan', 'atan2', 'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh', 'sign', 'ceil', 'floor',
  'round_ties_to_away', 'abs', 'min', 'max',
].map((n) => `minimal_${n}_test`));

const num = (s) => {
  s = s.trim();
  if (s === 'f64::INFINITY') return Infinity;
  if (s === 'f64::NEG_INFINITY') return -Infinity;
  if (!/^-?\d+(\.\d+)?(e[+-]?\d+)?$/.test(s)) throw Error(`not a number: ${s}`);
  const n = Number(s);
  return n === 0 ? 0 : n; // −0 and +0 are one number in an interval
};
const N2I = String.raw`n2i\(\s*([^,()]+?)\s*,\s*([^,()]+?)\s*\)`;
const interval = (s) => {
  s = s.trim();
  if (s === 'I::EMPTY' || s === 'I::ENTIRE' || s === 'I::NAI') return s;
  const m = new RegExp(`^${N2I}$`).exec(s);
  if (!m) throw Error(`not an interval: ${s}`);
  return [num(m[1]), num(m[2])];
};
/** A literal as plain decimal digits (the shortest text that reads back as the same f64), in parentheses when negative. */
export function plain(n) {
  let s = String(Math.abs(n));
  const m = /^(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(s);
  if (m) {
    const digits = m[1] + (m[2] ?? ''); const exp = Number(m[3]);
    s = exp >= 0 ? digits.padEnd(exp + 1, '0') : `0.${'0'.repeat(-exp - 1)}${digits}`;
    if (exp >= 0 && digits.length > exp + 1) s = `${digits.slice(0, exp + 1)}.${digits.slice(exp + 1)}`;
  }
  return n < 0 ? `(-${s})` : s;
}
const single = (i) => Array.isArray(i) && i[0] === i[1];
const finite = (i) => Array.isArray(i) && Number.isFinite(i[0]) && Number.isFinite(i[1]);
const has0 = ([a, b]) => a <= 0 && 0 <= b;

/** Why the case can't be stated through our `fn` call, or null. */
function domainProblem(op, x, c, xIsLeft) {
  const [a, b] = x;
  switch (op) {
    case 'sqrt': return a < 0 ? 'input leaves the domain' : null;
    case 'ln': case 'log2': case 'log10': return a <= 0 ? 'input reaches or leaves the domain edge 0' : null;
    case 'asin': case 'acos': return a < -1 || b > 1 ? 'input leaves the domain' : null;
    case 'acosh': return a < 1 ? 'input leaves the domain' : null;
    case 'atanh': return a <= -1 || b >= 1 ? 'input reaches or leaves the domain' : null;
    case 'recip': return has0(x) ? 'input holds the pole 0' : null;
    case 'powi': return c < 0 && has0(x) ? 'input holds the pole 0' : null;
    case 'pow': {
      if (xIsLeft) return a < 0 || (a === 0 && c <= 0) ? 'base leaves pow\'s domain x ≥ 0 (or 0 to a power ≤ 0)' : null;
      return c <= 0 ? 'base leaves pow\'s domain x > 0' : null;
    }
    case '/': return !xIsLeft && has0(x) ? 'divisor holds 0' : xIsLeft && c === 0 ? 'divisor is 0' : null;
    case 'atan2': {
      const [ya, yb] = xIsLeft ? x : [c, c]; const [xa, xb] = xIsLeft ? [c, c] : x;
      return has0([ya, yb]) && has0([xa, xb]) ? 'the box holds the origin' : null;
    }
    default: return null;
  }
}

const cases = []; const dropped = {};
const drop = (test, why) => { const k = `${test}: ${why}`; dropped[k] = (dropped[k] ?? 0) + 1; };

let test = null;
for (let i = 0; i < lines.length; i++) {
  const fm = /^fn (\w+)\(\)/.exec(lines[i]);
  if (fm) { test = fm[1]; continue; }
  if (!test || !TESTS.has(test) || !lines[i].includes('assert_eq2!(')) continue;
  const start = i; let src = ''; let depth = 0; let began = false;
  for (; i < lines.length; i++) {
    for (const ch of lines[i]) { if (ch === '(') { depth++; began = true; } if (ch === ')') depth--; }
    src += (src ? ' ' : '') + lines[i].trim();
    if (began && depth === 0) break;
  }
  const body = src.replace(/^assert_eq2!\(/, '').replace(/\);$/, '').replace(/\s+/g, ' ').replace(/,\s*$/, '');
  // Split at the top-level comma.
  let d = 0; let cut = -1;
  for (let k = 0; k < body.length; k++) { const ch = body[k]; if (ch === '(') d++; else if (ch === ')') d--; else if (ch === ',' && d === 0) { cut = k; break; } }
  const lhs = body.slice(0, cut).trim(); const rhs = body.slice(cut + 1).trim().replace(/,$/, '').trim();
  const want = interval(rhs);
  const line = start + 1;
  let op; let x; let c = null; let xIsLeft = true; let expr;
  let m;
  if (/^-I::\w+$/.test(lhs)) { drop(test, 'an empty or entire operand (our over takes finite bounds)'); continue; }
  if ((m = new RegExp(`^-${N2I}$`).exec(lhs))) { op = 'neg'; x = [num(m[1]), num(m[2])]; expr = '-x'; }
  else if ((m = new RegExp(`^(${N2I}|I::\\w+) ([+\\-*/]) (${N2I}|I::\\w+)$`).exec(lhs))) {
    op = m[4]; const L = interval(m[1]); const R = interval(m[5]);
    if (typeof L === 'string' || typeof R === 'string') { drop(test, 'an empty or entire operand (our over takes finite bounds)'); continue; }
    if (!single(L) && !single(R)) { drop(test, 'two interval operands (our over binds x alone)'); continue; }
    if (single(R)) { x = L; c = R[0]; expr = `x ${op} ${plain(c)}`; } else { x = R; c = L[0]; xIsLeft = false; expr = `${plain(c)} ${op} x`; }
  } else if ((m = new RegExp(`^(${N2I}|I::\\w+)\\.(\\w+)\\((.*)\\)$`).exec(lhs))) {
    const X = interval(m[1]); const method = m[4]; const arg = m[5].trim();
    if (typeof X === 'string') { drop(test, 'an empty or entire operand (our over takes finite bounds)'); continue; }
    if (method === 'powi') { op = 'powi'; x = X; c = Number(arg); expr = c < 0 ? `x^(${c})` : `x^${c}`; }
    else if (arg === '') { op = method; x = X; if (!UNARY[method]) throw Error(`unmapped ${method} at ${line}`); expr = UNARY[method](); }
    else {
      op = method; const Y = interval(arg);
      if (typeof Y === 'string') { drop(test, 'an empty or entire operand (our over takes finite bounds)'); continue; }
      if (!single(X) && !single(Y)) { drop(test, 'two interval operands (our over binds x alone)'); continue; }
      const f = { pow: 'pow', atan2: 'atan2', min: 'min', max: 'max' }[method];
      if (!f) throw Error(`unmapped ${method} at ${line}`);
      if (single(Y)) { x = X; c = Y[0]; expr = `${f}(x, ${plain(c)})`; } else { x = Y; c = X[0]; xIsLeft = false; expr = `${f}(${plain(c)}, x)`; }
    }
  } else throw Error(`unparsed at ${line}: ${lhs}`);
  if (!finite(x) || (c !== null && !Number.isFinite(c))) { drop(test, 'an infinite bound (our over takes finite bounds)'); continue; }
  if (want === 'I::EMPTY' || want === 'I::NAI') { drop(test, 'an empty answer (input outside the domain)'); continue; }
  const tight = want === 'I::ENTIRE' ? [-Infinity, Infinity] : want;
  const why = domainProblem(op, x, c, xIsLeft);
  if (why) { drop(test, why); continue; }
  cases.push({ test, line, src, expr, x, want: tight.map((v) => (Number.isFinite(v) ? v : null)) });
}

process.stdout.write(`${JSON.stringify({
  source: SOURCE,
  upstream: 'https://github.com/unageek/inari/blob/9e519ce47c9baa897bf11a735300ca4718a7a2a1/tests/itf1788_tests/libieeep1788_elem.rs',
  license: 'Apache-2.0 (the upstream file\'s notice below; inari itself is MIT)',
  notice,
  note: 'Each case: the upstream test and line, its assert text, our expression over x, x\'s interval [a, b], and the tight enclosure [lo, hi] (null at an unbounded end). Generated by extract-itf1788.mjs; never edited by hand.',
  kept: cases.length,
  dropped,
  cases,
}, null, 1)}\n`);
