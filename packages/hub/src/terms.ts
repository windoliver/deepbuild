// A term a claim's diff adds to a query, run on the read-only sample its definition names (#1863; design: In version
// 0, the numbers check). A query is a `.sql` file of one SELECT (or WITH) statement; a term the change adds is a run
// of tokens the claim's text holds and its merge base's doesn't, where nothing of the base's was taken out: a filter
// (a WHERE or HAVING condition), a data source (a JOIN or FROM table), a scoring term (an ORDER BY key) or an input
// (a column read). The numbers check runs the query as the claim leaves it (`with`) and without the term (`without`)
// on the sample; a term that changes no row there changes nothing, and fails showing the sample. Pure: the texts in, the terms out.
import type { AddedTerm } from '@deepbuild/checks-numbers';

/** SQL as tokens: words, numbers, quoted strings and identifiers, named parameters, comments dropped, and each other character alone. */
const TOKEN = /--[^\n]*|\/\*[\s\S]*?\*\/|'(?:[^']|'')*'|"(?:[^"]|"")*"|`[^`]*`|\[[^\]]*\]|[:@$][A-Za-z_]\w*|[A-Za-z_][\w$]*|\d+(?:\.\d+)?|<>|!=|<=|>=|\|\||\S/g;
interface Token { text: string; from: number; to: number }
const tokensOf = (sql: string): Token[] => [...sql.matchAll(TOKEN)].filter((m) => !m[0].startsWith('--') && !m[0].startsWith('/*'))
  .map((m) => ({ text: m[0], from: m.index, to: m.index + m[0].length }));
const same = (a: Token, b: Token): boolean => (/^\w/.test(a.text) && !/^\d/.test(a.text) ? a.text.toLowerCase() === b.text.toLowerCase() : a.text === b.text);
const KEYWORDS = new Set(['select', 'from', 'where', 'and', 'or', 'not', 'join', 'inner', 'left', 'right', 'outer', 'cross', 'full', 'on', 'group', 'by', 'having', 'order', 'limit', 'offset', 'union', 'all', 'distinct', 'as', 'with', 'asc', 'desc', 'is', 'null', 'in', 'like', 'between', 'exists', 'case', 'when', 'then', 'else', 'end', 'using', 'natural']);

/** One statement that reads: a SELECT or WITH, with no second statement and no parameter, which node:sqlite would skip or read as NULL. */
export function readsOnly(sql: string): boolean {
  const t = tokensOf(sql);
  const first = t[0]?.text.toLowerCase();
  if (first !== 'select' && first !== 'with') return false;
  const semi = t.findIndex((x) => x.text === ';');
  if (semi !== -1 && semi !== t.length - 1) return false;
  return !t.some((x) => x.text === '?' || /^[:@$]\w/.test(x.text));
}

/** The longest common subsequence of two token lists, as matched index pairs. */
function lcs(a: Token[], b: Token[]): [number, number][] {
  const n = a.length, m = b.length;
  const len: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) len[i]![j] = same(a[i]!, b[j]!) ? len[i + 1]![j + 1]! + 1 : Math.max(len[i + 1]![j]!, len[i]![j + 1]!);
  const pairs: [number, number][] = [];
  for (let i = 0, j = 0; i < n && j < m;) {
    if (same(a[i]!, b[j]!)) { pairs.push([i, j]); i++; j++; } else if (len[i + 1]![j]! >= len[i]![j + 1]!) i++; else j++;
  }
  return pairs;
}

/** The clause the token at `at` lies in, by the nearest clause keyword before it outside parentheses. */
function clauseAt(t: Token[], at: number): 'where' | 'from' | 'order' | 'select' | 'other' {
  let depth = 0;
  for (let i = at - 1; i >= 0; i--) {
    const w = t[i]!.text.toLowerCase();
    if (w === ')') depth++;
    else if (w === '(') { if (depth === 0) continue; depth--; }
    if (depth > 0) continue;
    if (w === 'where' || w === 'having') return 'where';
    if (w === 'from' || w === 'join') return 'from';
    if (w === 'by' && t[i - 1]?.text.toLowerCase() === 'order') return 'order';
    if (w === 'by' && t[i - 1]?.text.toLowerCase() === 'group') return 'other';
    if (w === 'select') return 'select';
  }
  return 'other';
}
const KIND = { where: 'filter', from: 'data source', order: 'scoring term', select: 'input', other: 'input' } as const;
/** A run's words that are the term itself: the joining AND, OR or comma it came with left out. */
const termText = (sql: string, run: Token[]): string => {
  let r = run;
  while (r.length && /^(and|or|,|where|having)$/i.test(r[0]!.text)) r = r.slice(1);
  while (r.length && /^(and|or|,)$/i.test(r.at(-1)!.text)) r = r.slice(0, -1);
  return r.length ? sql.slice(r[0]!.from, r.at(-1)!.to) : '';
};

/**
 * The terms `after` adds to `before`, each with the query with it (`after`) and without it (`after` with that run of
 * tokens taken out): only where the change takes nothing of `before` out, so `without` is the base's query again but
 * for the other terms it adds. A change that also removes or rewrites tokens adds no term this reads.
 */
export function addedTerms(before: string, after: string, sample: string): AddedTerm[] {
  if (!readsOnly(before) || !readsOnly(after)) return [];
  const a = tokensOf(before), b = tokensOf(after);
  const pairs = lcs(a, b);
  if (pairs.length !== a.length) return [];
  const kept = new Set(pairs.map(([, j]) => j));
  const runs: Token[][] = [];
  for (let j = 0; j < b.length; j++) {
    if (kept.has(j)) continue;
    if (kept.has(j - 1) || j === 0) runs.push([]);
    runs.at(-1)!.push(b[j]!);
  }
  const out: AddedTerm[] = [];
  for (const run of runs) {
    const words = run.filter((x) => !KEYWORDS.has(x.text.toLowerCase()) && /^[\w'"`[]/.test(x.text));
    const term = termText(after, run);
    if (!words.length || !term) continue;
    const without = `${after.slice(0, run[0]!.from)}${after.slice(run.at(-1)!.to)}`;
    if (!readsOnly(without)) continue;
    // A run that opens its own clause (`WHERE …`, `JOIN …`, `ORDER BY …`) is that clause's term; else the clause it lies in.
    const opens = run[0]!.text.toLowerCase();
    const clause = opens === 'where' || opens === 'having' ? 'where' : opens === 'join' || ['inner', 'left', 'right', 'cross', 'full', 'natural'].includes(opens) ? 'from'
      : opens === 'order' ? 'order' : clauseAt(b, b.indexOf(run[0]!));
    out.push({ kind: KIND[clause], term, with: after, without, sample });
  }
  return out;
}
