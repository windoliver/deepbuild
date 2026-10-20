/**
 * The regular expressions a schema's `pattern` may use, compiled for the Rust runtime's matcher. A pattern is
 * anchored at both ends, `^…$`, with no `|` outside a group, and is built from literal characters, the
 * escapes `\s \S \d \D \w \W`, escaped syntax characters, classes `[…]` and `[^…]` of characters and ranges,
 * groups `(…)` with `|`, and the greedy quantifiers `? * + {n} {n,} {n,m}`. With the `u` flag it means what
 * JavaScript means, so the TypeScript validator and the Rust types refuse the same strings.
 */

/** One step of a Pike VM program over code points: a class of ranges, a fork, a jump, or the match. */
export type Inst = { op: 'char'; ranges: [number, number][] } | { op: 'split'; x: number; y: number } | { op: 'jmp'; to: number } | { op: 'match' };

type Node =
  | { kind: 'class'; ranges: [number, number][] }
  | { kind: 'seq'; items: Node[] }
  | { kind: 'alt'; options: Node[] }
  | { kind: 'repeat'; node: Node; min: number; max: number | undefined };

const MAX_CODE_POINT = 0x10ffff;
/** The longest program a pattern may compile to, so a counted repeat can't blow up the generated code. */
const MAX_PROGRAM = 20_000;

const merge = (ranges: [number, number][]): [number, number][] => {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [lo, hi] of sorted) {
    const last = out[out.length - 1];
    if (last && lo <= last[1] + 1) last[1] = Math.max(last[1], hi);
    else out.push([lo, hi]);
  }
  return out;
};

const complement = (ranges: [number, number][]): [number, number][] => {
  const out: [number, number][] = [];
  let next = 0;
  for (const [lo, hi] of merge(ranges)) {
    if (lo > next) out.push([next, lo - 1]);
    next = hi + 1;
  }
  if (next <= MAX_CODE_POINT) out.push([next, MAX_CODE_POINT]);
  return out;
};

const one = (c: string): [number, number][] => [[c.codePointAt(0)!, c.codePointAt(0)!]];
const DIGIT: [number, number][] = [[0x30, 0x39]];
const WORD: [number, number][] = merge([[0x30, 0x39], [0x41, 0x5a], [0x5f, 0x5f], [0x61, 0x7a]]);
// JavaScript's \s: WhiteSpace and LineTerminator.
const SPACE: [number, number][] = merge([[0x09, 0x0d], [0x20, 0x20], [0xa0, 0xa0], [0x1680, 0x1680], [0x2000, 0x200a],
  [0x2028, 0x2029], [0x202f, 0x202f], [0x205f, 0x205f], [0x3000, 0x3000], [0xfeff, 0xfeff]]);
const SETS: Record<string, [number, number][]> = { d: DIGIT, D: complement(DIGIT), w: WORD, W: complement(WORD), s: SPACE, S: complement(SPACE) };
const CONTROLS: Record<string, string> = { n: '\n', t: '\t', r: '\r', f: '\f', v: '\v' };
const SYNTAX = '^$\\.*+?()[]{}|/';

function parse(source: string): Node {
  // The final $ is escaped, so no anchor, when an odd run of backslashes comes before it.
  const escaped = (source.slice(0, -1).match(/\\*$/)![0].length % 2) === 1;
  if (!source.startsWith('^') || !source.endsWith('$') || escaped || source.length < 2) throw Error('a pattern is anchored at both ends, ^…$');
  const chars = [...source.slice(1, -1)];
  let i = 0;
  const peek = (): string | undefined => chars[i];
  const fail = (what: string): never => { throw Error(`${what} at character ${i + 1} is outside the patterns the Rust matcher runs`); };

  const escape = (inClass: boolean): [number, number][] => {
    const c = chars[i++];
    if (c === undefined) return fail('a trailing backslash');
    if (Object.hasOwn(SETS, c)) return SETS[c]!;
    if (Object.hasOwn(CONTROLS, c)) return one(CONTROLS[c]!);
    if (SYNTAX.includes(c) || (inClass && c === '-')) return one(c);
    return fail(`the escape \\${c}`);
  };

  const classNode = (): Node => {
    let negated = false;
    if (peek() === '^') { negated = true; i++; }
    const ranges: [number, number][] = [];
    const atom = (): { set: [number, number][]; single: number | undefined } => {
      const c = chars[i++];
      if (c === undefined) return fail('an unclosed class');
      if (c === '\\') {
        const set = escape(true);
        return { set, single: set.length === 1 && set[0]![0] === set[0]![1] ? set[0]![0] : undefined };
      }
      if (c === '[') return fail('a [ inside a class');
      return { set: one(c), single: c.codePointAt(0)! };
    };
    while (peek() !== ']') {
      if (peek() === undefined) fail('an unclosed class');
      const from = atom();
      if (peek() === '-' && chars[i + 1] !== undefined && chars[i + 1] !== ']') {
        i++;
        const to = atom();
        if (from.single === undefined || to.single === undefined || from.single > to.single) fail('a range that is not from one character to a later one');
        ranges.push([from.single!, to.single!]);
      } else {
        ranges.push(...from.set);
      }
    }
    i++;
    return { kind: 'class', ranges: negated ? complement(ranges) : merge(ranges) };
  };

  const count = (): number => {
    let digits = '';
    while (/[0-9]/.test(peek() ?? '')) digits += chars[i++];
    if (!digits) fail('a count');
    return Number(digits);
  };

  const alt = (): Node => {
    const options = [seq()];
    while (peek() === '|') { i++; options.push(seq()); }
    return options.length === 1 ? options[0]! : { kind: 'alt', options };
  };

  const seq = (): Node => {
    const items: Node[] = [];
    for (let c = peek(); c !== undefined && c !== '|' && c !== ')'; c = peek()) {
      i++;
      let node: Node;
      if (c === '(') {
        if (peek() === '?') fail('a group with ?');
        node = alt();
        if (chars[i++] !== ')') fail('an unclosed group');
      } else if (c === '[') {
        node = classNode();
      } else if (c === '\\') {
        node = { kind: 'class', ranges: escape(false) };
      } else if ('^$.*+?{}]'.includes(c)) {
        return fail(`the character ${c}`);
      } else {
        node = { kind: 'class', ranges: one(c) };
      }
      const q = peek();
      if (q === '?' || q === '*' || q === '+') {
        i++;
        node = { kind: 'repeat', node, min: q === '+' ? 1 : 0, max: q === '?' ? 1 : undefined };
      } else if (q === '{') {
        i++;
        const min = count();
        let max: number | undefined = min;
        if (peek() === ',') {
          i++;
          max = peek() === '}' ? undefined : count();
        }
        if (chars[i++] !== '}') fail('an unclosed count');
        if (max !== undefined && max < min) fail('a count whose maximum is below its minimum');
        node = { kind: 'repeat', node, min, max };
      }
      if ('?*+{'.includes(peek() ?? '.')) fail('a lazy or repeated quantifier');
      items.push(node);
    }
    return items.length === 1 ? items[0]! : { kind: 'seq', items };
  };

  const body = seq();
  if (peek() === '|') fail('a | outside a group, which JavaScript reads as ^a or b$');
  if (peek() !== undefined) fail(`the character ${peek()}`);
  return body;
}

/** The Pike VM program for a pattern; throws, naming the problem, for one outside the subset. */
export function compilePattern(source: string): Inst[] {
  const program: Inst[] = [];
  const push = (inst: Inst): number => {
    if (program.length >= MAX_PROGRAM) throw Error(`a pattern compiles to more than ${MAX_PROGRAM} steps`);
    return program.push(inst) - 1;
  };
  const emit = (node: Node): void => {
    switch (node.kind) {
      case 'class':
        push({ op: 'char', ranges: node.ranges });
        return;
      case 'seq':
        for (const item of node.items) emit(item);
        return;
      case 'alt': {
        const jumps: number[] = [];
        node.options.forEach((option, k) => {
          if (k < node.options.length - 1) {
            const split = push({ op: 'split', x: 0, y: 0 });
            program[split] = { op: 'split', x: split + 1, y: 0 };
            emit(option);
            jumps.push(push({ op: 'jmp', to: 0 }));
            (program[split] as { y: number }).y = program.length;
          } else {
            emit(option);
          }
        });
        for (const j of jumps) program[j] = { op: 'jmp', to: program.length };
        return;
      }
      case 'repeat': {
        for (let k = 0; k < node.min; k++) emit(node.node);
        if (node.max === undefined) {
          const split = push({ op: 'split', x: 0, y: 0 });
          emit(node.node);
          push({ op: 'jmp', to: split });
          program[split] = { op: 'split', x: split + 1, y: program.length };
        } else {
          const splits: number[] = [];
          for (let k = node.min; k < node.max; k++) {
            splits.push(push({ op: 'split', x: 0, y: 0 }));
            emit(node.node);
          }
          for (const s of splits) program[s] = { op: 'split', x: s + 1, y: program.length };
        }
        return;
      }
    }
  };
  emit(parse(source));
  push({ op: 'match' });
  return program;
}
