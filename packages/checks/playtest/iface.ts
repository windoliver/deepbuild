// The play interface `game.play@1` as the playtest reads it (#555; canvas primitives: Play interface `game.play@1`,
// The closed function list). It's locked in the brief before generation, so the working agent can't change it: its
// names resolve to the piece's logic arrays, a goal is an expression over them with the closed list's arithmetic and
// logic, and a name that carries a unit names one the canvas names, refused at the lock otherwise. A name's range comes
// from here, never from the piece: a published value outside it fails with play.out_of_range.

/** A declared name: its logic array path, or the path with the unit, range and step the brief gives it. */
export type Name = string | { name: string; unit?: string; range?: [number, number]; step?: number };

export interface PlayIface {
  grid?: { cells: Name; size: [number, number]; floor?: Name; [k: string]: unknown };
  units?: { cell?: Name; hp?: Name; side?: Name; alive?: Name; self?: number };
  turn?: Name;
  rewards?: Record<string, Name>;
  values?: Record<string, Name>;
  actions?: Record<string, { control: string; action?: string; args?: string }>;
  legal?: { rows: Name; count: Name; score?: Name };
  accepted?: Name;
  refused?: Name;
  [k: string]: unknown;
}

/**
 * The units the canvas names (canvas primitives: Units and axes, and the fields that take one), each as a literal
 * spells it. A name may carry one of these and no other.
 */
export const UNITS: ReadonlySet<string> = new Set([
  'u', 'px', 'fw', 'fh', 'm', 'cm', 'mm', 'km', 'in', 'mi', 'deg', 'deg/s', 'rad', 's', 'ms', 'min', 'h', 'flick',
  'Hz', 'kg', 'N', 'N·s', 'm/s', 'm/s²', 'lm', 'lux', 'K', 'EV100', 'dB', 'LUFS', 'LU', 'dBTP', '%', 'B', 'KiB', 'MiB',
]);

const pathOf = (n: Name): string => (typeof n === 'string' ? n : n.name);

/** Every name the interface declares, by the name an expression or a message uses: `turn`, `hp`, a value's key. */
export function declared(play: PlayIface): { name: string; at: Name; row?: number }[] {
  const out: { name: string; at: Name; row?: number }[] = [];
  const me = play.units?.self ?? 0;
  for (const k of ['turn', 'accepted', 'refused'] as const) if (play[k] !== undefined) out.push({ name: k, at: play[k]! });
  for (const group of [play.rewards, play.values]) for (const [k, v] of Object.entries(group ?? {})) out.push({ name: k, at: v });
  for (const k of ['hp', 'side', 'alive'] as const) if (play.units?.[k] !== undefined) out.push({ name: k, at: play.units[k]!, row: me });
  if (play.units?.cell !== undefined) out.push({ name: 'cell', at: play.units.cell });
  if (play.grid?.cells !== undefined) out.push({ name: 'cells', at: play.grid.cells });
  if (play.grid?.floor !== undefined) out.push({ name: 'floor', at: play.grid.floor });
  if (play.legal) for (const k of ['rows', 'count', 'score'] as const) if (play.legal[k] !== undefined) out.push({ name: `legal.${k}`, at: play.legal[k]! });
  return out;
}

/** The interface refused at the lock, naming why: a name whose unit the canvas doesn't name, or a range upside down. */
export function lockRefusal(play: PlayIface): string | undefined {
  for (const d of declared(play)) {
    if (typeof d.at === 'string') continue;
    if (d.at.unit !== undefined && !UNITS.has(d.at.unit)) return `${d.name} carries the unit ${d.at.unit}, which the canvas doesn't name`;
    const r = d.at.range;
    if (r !== undefined && !(Array.isArray(r) && r.length === 2 && r.every(Number.isFinite) && r[0] <= r[1])) return `${d.name}'s range is [min, max], not ${JSON.stringify(r)}`;
  }
  return undefined;
}

/** The names that carry a range, each with its path. */
export function ranged(play: PlayIface): { name: string; path: string; range: [number, number] }[] {
  return declared(play).flatMap((d) => (typeof d.at !== 'string' && d.at.range ? [{ name: d.name, path: d.at.name, range: d.at.range }] : []));
}

/** The first row of a ranged name's array outside its range in a play's values: the step, the row and the value. */
export function outOfRange(values: unknown[], range: [number, number]): { step: number; row: number; value: number } | undefined {
  for (let k = 0; k < values.length; k++) {
    const list = Array.isArray(values[k]) ? (values[k] as unknown[]) : [values[k]];
    for (let row = 0; row < list.length; row++) {
      const v = Number(list[row]);
      if (v < range[0] || v > range[1]) return { step: k, row, value: v };
    }
  }
  return undefined;
}

// ---- Goal expressions: the closed function list's arithmetic and logic, over the interface's names.

type Node = { n: number } | { id: string } | { op: string; args: Node[] };
const FNS: Record<string, (...x: number[]) => number> = {
  min: Math.min, max: Math.max, abs: Math.abs, sign: Math.sign, floor: Math.floor, ceil: Math.ceil, round: Math.round,
  fract: (x) => x - Math.floor(x), mod: (a, b) => a - b * Math.floor(a / b), clamp: (x, a, b) => Math.min(Math.max(x, a), b),
  sqrt: Math.sqrt, pow: Math.pow,
};
const BINARY: [string[], number][] = [[['||'], 1], [['&&'], 2], [['==', '!='], 3], [['<', '<=', '>', '>='], 4], [['+', '-'], 5], [['*', '/', '%'], 6], [['^'], 7]];
const MAX_DEPTH = 64;

/** An expression parsed, or an error naming why. Names are identifiers, or logic array paths with dots. */
export function parse(text: string): Node {
  const tokens = text.match(/\s*(\d+(?:\.\d+)?(?:e[+-]?\d+)?|[A-Za-z_][\w.]*|&&|\|\||==|!=|<=|>=|[-+*/%^<>!?:(),])/gy)?.map((t) => t.trim()) ?? [];
  if (tokens.join('').length !== text.replace(/\s+/g, '').length) throw Error(`can't read the expression ${text}`);
  let i = 0;
  const peek = (): string | undefined => tokens[i];
  const take = (t?: string): string => {
    const got = tokens[i++];
    if (got === undefined || (t !== undefined && got !== t)) throw Error(`the expression ${text} wants ${t ?? 'more'} at ${got ?? 'its end'}`);
    return got;
  };
  const atom = (depth: number): Node => {
    if (depth > MAX_DEPTH) throw Error(`the expression ${text} nests past ${MAX_DEPTH} levels`);
    const t = take();
    if (t === '(') { const e = expr(depth + 1); take(')'); return e; }
    if (t === '-' || t === '!') return { op: t === '-' ? 'neg' : '!', args: [atom(depth + 1)] };
    if (/^\d/.test(t)) return { n: Number(t) };
    if (/^[A-Za-z_]/.test(t)) {
      if (peek() !== '(') return t === 'pi' ? { n: Math.PI } : t === 'tau' ? { n: 2 * Math.PI } : { id: t };
      if (!FNS[t]) throw Error(`${t} isn't a function the closed list holds for goals`);
      take('(');
      const args: Node[] = [];
      if (peek() !== ')') do args.push(expr(depth + 1)); while (peek() === ',' && take(','));
      take(')');
      return { op: t, args };
    }
    throw Error(`the expression ${text} has ${t} where a value goes`);
  };
  const binary = (level: number, depth: number): Node => {
    if (level >= BINARY.length) return atom(depth);
    let left = binary(level + 1, depth);
    while (peek() !== undefined && BINARY[level]![0].includes(peek()!)) {
      const op = take();
      left = { op, args: [left, binary(level + 1, depth)] };
    }
    return left;
  };
  const expr = (depth: number): Node => {
    const c = binary(0, depth);
    if (peek() !== '?') return c;
    take('?');
    const a = expr(depth + 1);
    take(':');
    return { op: '?', args: [c, a, expr(depth + 1)] };
  };
  const e = expr(0);
  if (i < tokens.length) throw Error(`the expression ${text} has ${tokens[i]} past its end`);
  return e;
}

/** The identifiers an expression reads. */
export function idents(e: Node): string[] {
  return 'id' in e ? [e.id] : 'op' in e ? e.args.flatMap(idents) : [];
}

/** The expression's value, with each identifier read through `get`; true is 1 and false 0. */
export function evaluate(e: Node, get: (id: string) => number): number {
  if ('n' in e) return e.n;
  if ('id' in e) return get(e.id);
  const [a, b, c] = e.args.map((x) => () => evaluate(x, get));
  switch (e.op) {
    case 'neg': return -a!();
    case '!': return a!() ? 0 : 1;
    case '||': return a!() || b!() ? 1 : 0;
    case '&&': return a!() && b!() ? 1 : 0;
    case '?': return a!() ? b!() : c!();
    case '==': return a!() === b!() ? 1 : 0;
    case '!=': return a!() !== b!() ? 1 : 0;
    case '<': return a!() < b!() ? 1 : 0;
    case '<=': return a!() <= b!() ? 1 : 0;
    case '>': return a!() > b!() ? 1 : 0;
    case '>=': return a!() >= b!() ? 1 : 0;
    case '+': return a!() + b!();
    case '-': return a!() - b!();
    case '*': return a!() * b!();
    case '/': return a!() / b!();
    case '%': return a!() % b!();
    case '^': return a!() ** b!();
    default: return FNS[e.op]!(...e.args.map((x) => evaluate(x, get)));
  }
}

/**
 * A goal's test from its `when`: an expression over the interface's names (or logic array paths), true at a step when
 * nonzero. Each name reads its array's first row, a unit's field the self unit's row. Answers the paths it reads.
 */
export function goalTest(when: string, play: PlayIface | undefined): { reads: string[]; at: (values: Record<string, unknown[]>, k: number) => boolean } {
  const names = new Map((play ? declared(play) : []).map((d) => [d.name, { path: pathOf(d.at), row: d.row ?? 0 }]));
  const tree = parse(when);
  const ids = idents(tree);
  for (const id of ids) if (!names.has(id) && !id.includes('.')) throw Error(`the goal ${when} reads ${id}, which the play interface doesn't declare`);
  const where = (id: string): { path: string; row: number } => names.get(id) ?? { path: id, row: 0 };
  return {
    reads: [...new Set(ids.map((id) => where(id).path))],
    at: (values, k) => evaluate(tree, (id) => {
      const { path, row } = where(id);
      const v = values[path]?.[k];
      const x = Array.isArray(v) ? v[row] : v;
      return typeof x === 'boolean' ? Number(x) : Number(x ?? 0);
    }) !== 0,
  };
}
