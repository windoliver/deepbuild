const MAX_DEPTH = 64;
const MAX_NODES = 512;
const INV_SQRT_PI = 0.5641895835477563;

const CODY_A = [3.1611237438705656, 113.86415415105016, 377.485237685302, 3209.3775891384695, 0.18577770618460315];
const CODY_B = [23.60129095234412, 244.02463793444417, 1282.6165260773723, 2844.2368334391706];
const CODY_C = [0.5641884969886701, 8.883149794388376, 66.11919063714163, 298.63513819740013, 881.9522212417691, 1712.0476126340706, 2051.0783778260715, 1230.3393547979972, 2.1531153547440385e-8];
const CODY_D = [15.744926110709835, 117.6939508913125, 537.1811018620099, 1621.3895745666902, 3290.7992357334596, 4362.619090143247, 3439.3676741437216, 1230.3393548037494];
const CODY_P = [0.30532663496123234, 0.36034489994980444, 0.12578172611122925, 0.016083785148742277, 6.587491615298378e-4, 0.016315387137302097];
const CODY_Q = [2.5685201922898224, 1.8729528499234604, 0.5279051029514284, 0.06051834131244132, 0.0023352049762686918];

function erfCody(x) {
  if (Number.isNaN(x)) return NaN;
  const ax = Math.abs(x);
  if (ax === 0) return 0;
  if (ax <= 0.46875) {
    const z = ax * ax;
    let xn = CODY_A[4] * z;
    let xd = z;
    for (let i = 0; i < 3; i++) { xn = (xn + CODY_A[i]) * z; xd = (xd + CODY_B[i]) * z; }
    return (x * (xn + CODY_A[3])) / (xd + CODY_B[3]);
  }
  const c = erfcCody(ax);
  return x < 0 ? c - 1 : 1 - c;
}

function erfcCody(x) {
  if (Number.isNaN(x)) return NaN;
  const ax = Math.abs(x);
  if (ax <= 0.46875) return 1 - erfCody(x);
  if (ax > 26.543) return x < 0 ? 2 : 0;
  let r;
  if (ax <= 4.0) {
    let xn = CODY_C[8] * ax;
    let xd = ax;
    for (let i = 0; i < 7; i++) { xn = (xn + CODY_C[i]) * ax; xd = (xd + CODY_D[i]) * ax; }
    r = (xn + CODY_C[7]) / (xd + CODY_D[7]);
  } else {
    const z = 1 / (ax * ax);
    let xn = CODY_P[5] * z;
    let xd = z;
    for (let i = 0; i < 4; i++) { xn = (xn + CODY_P[i]) * z; xd = (xd + CODY_Q[i]) * z; }
    r = (INV_SQRT_PI - (z * (xn + CODY_P[4])) / (xd + CODY_Q[4])) / ax;
  }
  const xsq = Math.trunc(ax * 16) / 16;
  const del = (ax - xsq) * (ax + xsq);
  const pos = Math.exp(-xsq * xsq) * Math.exp(-del) * r;
  return x < 0 ? 2 - pos : pos;
}

const LANCZOS = [
  0.99999999999980993,
  676.5203681218851,
  -1259.1392167224028,
  771.32342877765313,
  -176.61502916214059,
  12.507343278686905,
  -0.13857109526572012,
  9.9843695780195716e-6,
  1.5056327351493116e-7,
];

function lgammaLanczos(x) {
  if (Number.isNaN(x)) return NaN;
  if (x <= 0 && x === Math.trunc(x)) return Infinity;
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgammaLanczos(1 - x);
  const z = x - 1;
  let a = LANCZOS[0];
  for (let i = 1; i < LANCZOS.length; i++) a += LANCZOS[i] / (z + i);
  const t = z + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

function gammaLanczos(x) {
  if (Number.isNaN(x)) return NaN;
  if (x === 0) return Infinity;
  if (x < 0 && x === Math.trunc(x)) return NaN;
  if (x > 0 && x <= 23 && x === Math.trunc(x)) return factorialExact(x - 1);
  if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * gammaLanczos(1 - x));
  return Math.exp(lgammaLanczos(x));
}

function factorialExact(n) {
  if (!Number.isFinite(n) || n < 0 || n > 170 || n !== Math.trunc(n)) return NaN;
  let p = 1;
  for (let k = 2; k <= n; k++) p *= k;
  return p;
}

function binomExact(n, k) {
  if (!Number.isFinite(n) || !Number.isFinite(k) || n !== Math.trunc(n) || k !== Math.trunc(k) || k < 0 || n < k || n > 1e15) return NaN;
  const m = Math.min(k, n - k);
  let r = 1;
  for (let i = 1; i <= m; i++) r = (r * (n - m + i)) / i;
  return r;
}

const FUNCTIONS = {
  min: [2, Math.min], max: [2, Math.max], clamp: [3, (x, a, b) => Math.min(Math.max(x, a), b)],
  abs: [1, Math.abs], sign: [1, (x) => (Number.isNaN(x) ? NaN : x > 0 ? 1 : x < 0 ? -1 : 0)],
  floor: [1, Math.floor], ceil: [1, Math.ceil], fract: [1, (x) => x - Math.floor(x)],
  round: [1, (x) => (x < 0 ? -Math.round(-x) : Math.round(x))], mod: [2, (x, y) => x - y * Math.floor(x / y)],
  sqrt: [1, Math.sqrt], pow: [2, Math.pow], exp: [1, Math.exp], log: [1, Math.log],
  sin: [1, Math.sin], cos: [1, Math.cos], tan: [1, Math.tan], asin: [1, Math.asin], acos: [1, Math.acos],
  atan: [1, Math.atan], atan2: [2, Math.atan2], deg: [1, (x) => (x * 180) / Math.PI], rad: [1, (x) => (x * Math.PI) / 180],
  sinh: [1, Math.sinh], cosh: [1, Math.cosh], tanh: [1, Math.tanh], asinh: [1, Math.asinh], acosh: [1, Math.acosh], atanh: [1, Math.atanh],
  log2: [1, Math.log2], log10: [1, Math.log10], log1p: [1, Math.log1p], expm1: [1, Math.expm1], hypot: [2, Math.hypot], cbrt: [1, Math.cbrt],
  sinc: [1, (x) => (x === 0 ? 1 : Math.sin(x) / x)],
  erf: [1, erfCody], erfc: [1, erfcCody], gamma: [1, gammaLanczos], lgamma: [1, lgammaLanczos],
  factorial: [1, factorialExact], binom: [2, binomExact],
  mix: [3, (a, b, t) => a + (b - a) * t],
  smoothstep: [3, (e0, e1, x) => { const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1); return t * t * (3 - 2 * t); }],
  remap: [5, (x, a, b, c, d) => c + ((x - a) / (b - a)) * (d - c)],
};
const SAME_UNIT = new Set(['min', 'max', 'clamp', 'mix', 'hypot', 'mod']);
const CONSTANTS = { pi: Math.PI, tau: 2 * Math.PI };

export class Refused extends Error {}

function tokens(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (/\s/.test(c)) { i++; continue; }
    const num = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(text.slice(i));
    if (num) { out.push({ t: 'num', v: Number(num[0]) }); i += num[0].length; continue; }
    const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(i));
    if (name) { out.push({ t: 'name', v: name[0] }); i += name[0].length; continue; }
    const op = ['&&', '||', '==', '!=', '<=', '>='].find((o) => text.startsWith(o, i)) ?? ('+-*/%^<>!?:(),'.includes(c) ? c : undefined);
    if (!op) throw new Refused(`the expression ${JSON.stringify(text)} holds ${JSON.stringify(c)}, which no closed function or operator is`);
    out.push({ t: 'op', v: op });
    i += op.length;
  }
  return out;
}

const BINARY = [['||'], ['&&'], ['==', '!='], ['<', '<=', '>', '>='], ['+', '-'], ['*', '/', '%']];

export function parse(text, columns) {
  const list = tokens(String(text));
  let at = 0;
  let nodes = 0;
  const read = new Set();
  const peek = () => list[at];
  const eat = (v) => (list[at]?.v === v && list[at].t === 'op' ? (at++, true) : false);
  const expect = (v) => { if (!eat(v)) throw new Refused(`the expression ${JSON.stringify(text)} needs ${JSON.stringify(v)} at token ${at + 1}`); };
  const node = (n) => { if (++nodes > MAX_NODES) throw new Refused(`the expression ${JSON.stringify(text)} passes ${MAX_NODES} nodes`); return n; };
  const same = (a, b, what) => {
    if (a.unit !== null && b.unit !== null && a.unit !== b.unit) throw new Refused(`the expression ${JSON.stringify(text)} ${what} ${a.unit} and ${b.unit}, two different units`);
    return a.unit ?? b.unit;
  };
  function ternary(depth) {
    if (depth > MAX_DEPTH) throw new Refused(`the expression ${JSON.stringify(text)} nests past ${MAX_DEPTH} levels`);
    const c = binary(0, depth + 1);
    if (!eat('?')) return c;
    const a = ternary(depth + 1);
    expect(':');
    const b = ternary(depth + 1);
    return node({ k: 'if', c, a, b, unit: same(a, b, 'chooses between') });
  }
  function binary(level, depth) {
    if (depth > MAX_DEPTH) throw new Refused(`the expression ${JSON.stringify(text)} nests past ${MAX_DEPTH} levels`);
    if (level === BINARY.length) return unary(depth + 1);
    let a = binary(level + 1, depth + 1);
    for (;;) {
      const op = BINARY[level].find((o) => list[at]?.t === 'op' && list[at].v === o);
      if (!op) return a;
      at++;
      const b = binary(level + 1, depth + 1);
      let unit = null;
      if (op === '+' || op === '-') unit = same(a, b, op === '+' ? 'adds' : 'subtracts');
      else if (level <= 3) { if (level >= 2) same(a, b, 'compares'); }
      else if (op === '*') unit = a.unit && b.unit ? `${a.unit}·${b.unit}` : a.unit ?? b.unit;
      else if (op === '/') unit = a.unit && b.unit ? (a.unit === b.unit ? null : `${a.unit}/${b.unit}`) : a.unit ?? (b.unit ? `1/${b.unit}` : null);
      else unit = a.unit;
      a = node({ k: 'bin', op, a, b, unit });
    }
  }
  function power(depth) {
    const base = atom(depth + 1);
    if (!eat('^')) return base;
    const exp = unary(depth + 1);
    return node({ k: 'bin', op: '^', a: base, b: exp, unit: null });
  }
  function unary(depth) {
    if (depth > MAX_DEPTH) throw new Refused(`the expression ${JSON.stringify(text)} nests past ${MAX_DEPTH} levels`);
    if (eat('-')) { const a = unary(depth + 1); return node({ k: 'neg', a, unit: a.unit }); }
    if (eat('+')) return unary(depth + 1);
    if (eat('!')) return node({ k: 'not', a: unary(depth + 1), unit: null });
    return power(depth + 1);
  }
  function atom(depth) {
    const tok = peek();
    if (!tok) throw new Refused(`the expression ${JSON.stringify(text)} ends early`);
    at++;
    if (tok.t === 'num') return node({ k: 'num', v: tok.v, unit: null });
    if (tok.t === 'op' && tok.v === '(') { const e = ternary(depth + 1); expect(')'); return e; }
    if (tok.t !== 'name') throw new Refused(`the expression ${JSON.stringify(text)} has ${JSON.stringify(tok.v)} where a value goes`);
    if (eat('(')) {
      const f = FUNCTIONS[tok.v];
      if (!f) throw new Refused(`the expression ${JSON.stringify(text)} calls ${tok.v}, which isn't a scalar function of the closed function list`);
      const args = [];
      if (!eat(')')) {
        do args.push(ternary(depth + 1)); while (eat(','));
        expect(')');
      }
      if (args.length !== f[0]) throw new Refused(`${tok.v} takes ${f[0]} arguments, and the expression ${JSON.stringify(text)} gives it ${args.length}`);
      let unit = null;
      if (SAME_UNIT.has(tok.v)) unit = args.slice(0, tok.v === 'mix' ? 2 : args.length).reduce((u, b) => same({ unit: u }, b, 'compares'), null);
      else if (tok.v === 'smoothstep') args.reduce((u, b) => same({ unit: u }, b, 'compares'), null);
      else if (tok.v === 'atan2') same(args[0], args[1], 'compares');
      else if (tok.v === 'remap') {
        args.slice(0, 3).reduce((u, b) => same({ unit: u }, b, 'compares'), null);
        unit = same(args[3], args[4], 'compares');
      } else if (tok.v === 'abs' || tok.v === 'floor' || tok.v === 'ceil' || tok.v === 'round') unit = args[0].unit;
      return node({ k: 'call', f: f[1], args, unit });
    }
    if (Object.hasOwn(columns, tok.v)) { read.add(tok.v); return node({ k: 'col', name: tok.v, unit: columns[tok.v] }); }
    if (Object.hasOwn(CONSTANTS, tok.v)) return node({ k: 'num', v: CONSTANTS[tok.v], unit: null });
    throw new Refused(`the expression ${JSON.stringify(text)} reads ${tok.v}, which is no column of the row`);
  }
  const tree = ternary(0);
  if (at !== list.length) throw new Refused(`the expression ${JSON.stringify(text)} has more after token ${at}`);
  return { tree, reads: [...read].sort(), unit: tree.unit };
}

export function evaluate(n, cells) {
  switch (n.k) {
    case 'num': return n.v;
    case 'col': return cells[n.name];
    case 'neg': { const a = evaluate(n.a, cells); return a === undefined ? undefined : -a; }
    case 'not': { const a = evaluate(n.a, cells); return a === undefined ? undefined : a === 0 ? 1 : 0; }
    case 'if': { const c = evaluate(n.c, cells); return c === undefined ? undefined : evaluate(c !== 0 && !Number.isNaN(c) ? n.a : n.b, cells); }
    case 'call': {
      const args = n.args.map((a) => evaluate(a, cells));
      return args.includes(undefined) ? undefined : n.f(...args);
    }
    default: {
      const a = evaluate(n.a, cells);
      const b = evaluate(n.b, cells);
      if (a === undefined || b === undefined) return undefined;
      switch (n.op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': return a / b;
        case '%': return a % b;
        case '^': return Math.pow(a, b);
        case '==': return a === b ? 1 : 0;
        case '!=': return a !== b ? 1 : 0;
        case '<': return a < b ? 1 : 0;
        case '<=': return a <= b ? 1 : 0;
        case '>': return a > b ? 1 : 0;
        case '>=': return a >= b ? 1 : 0;
        case '&&': return a !== 0 && b !== 0 ? 1 : 0;
        case '||': return a !== 0 || b !== 0 ? 1 : 0;
      }
    }
  }
  throw new Refused(`unknown node ${n.k}`);
}
