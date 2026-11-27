// The derive and filter steps' expressions (#3569): a row's own columns through the closed function list's scalar
// functions, in f64, and nothing else (canvas primitives: The closed function list). A name that is no column of the
// row, a function outside the list and a nesting past 64 levels are refused before any row is read. Units are read at
// parse: adding, subtracting or comparing two operands whose units differ is refused, naming both.

const MAX_DEPTH = 64;
const MAX_NODES = 512;

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
  mix: [3, (a, b, t) => a + (b - a) * t],
  smoothstep: [3, (e0, e1, x) => { const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1); return t * t * (3 - 2 * t); }],
  remap: [5, (x, a, b, c, d) => c + ((x - a) / (b - a)) * (d - c)],
};
/** Functions whose operands are added or compared, so their units must agree. */
const SAME_UNIT = new Set(['min', 'max', 'clamp', 'mix']);
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

/**
 * Parses `text` over `columns` ({name → unit | null}): the tree, the columns it reads and its unit. A unit is a column's
 * own, a product or quotient of two (`a·b`, `a/b`), or null where nothing states one; a literal has none.
 */
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
  // Right-associative, and binding tighter than a leading minus: −x^2 is −(x²), as the canvas reads it.
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
      else if (tok.v === 'abs' || tok.v === 'floor' || tok.v === 'ceil' || tok.v === 'round') unit = args[0].unit;
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

/** The tree's value over a row's cells ({column → number | undefined}): undefined when any cell it reads is missing. */
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
