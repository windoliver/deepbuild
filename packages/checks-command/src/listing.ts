// The tests a run file holds, listed apart from the run: a Vitest, Jest or node:test file read from its source here, with no
// tool and none of the checkout's config or setup, and a Python file listed by the runner's pytest plugin from its
// source by pytest's default rules. Each is a test a default run of the file runs: a call the source itself skips,
// marks todo, makes conditional or names at run time isn't listed, nor, in a file that focuses some (.only, fit), one it doesn't focus. A listed test the run never ran was left out by
// something other than its source, and the run can't pass, unless the check's own command left it out.
import { createHash } from 'node:crypto';
import type { Expression, FunctionLikeDeclaration, Statement } from 'typescript';

/** `names`: a node:test test's suites' names and its own, which its report gives it by, at its line. */
export interface Listed { test: string; file: string; line: number; tagged: boolean; names?: string[] }
/** A test the run ran; `line`, where the report gives it, is the line of its call. */
export interface Seen { test: string; file: string | null; line?: number }
/** A test the tool reports it left out, and the filter that did it (pytest's deselection and collection patterns). */
export interface Left { test: string; file: string; filter: string }
/** A value the check's command gives an option that chooses tests. */
export interface Filter { option: string; value: string }

type TS = typeof import('typescript');
let loaded: TS | undefined;
/** Listings by file, options and source digest; the oldest goes past LISTINGS. */
const listings = new Map<string, Listed[]>();
const LISTINGS = 1024;
const TESTS = new Set(['test', 'it', 'fit']);
const SUITES = new Set(['describe', 'suite', 'fdescribe']);
/** What makes a call's tests run only sometimes, or under names its source doesn't hold. */
const UNSURE = new Set(['skip', 'todo', 'skipIf', 'runIf', 'each', 'for', '()']);
const SKIPPING = new Set(['skip', 'todo', 'skipIf', 'runIf']);
/** What runs a file's focused tests alone, wherever it is in the file. */
const FOCUS = /\.only\b|\b(?:fit|fdescribe)\s*\(/;

/** A call's callee as words, `test.concurrent.skip` as test, concurrent, skip, a call in it as `()`; null for anything else. */
function chain(ts: TS, e: Expression): string[] | null {
  if (ts.isIdentifier(e)) return [e.text];
  const inner = ts.isPropertyAccessExpression(e) || ts.isCallExpression(e) ? chain(ts, e.expression) : null;
  return inner && [...inner, ts.isPropertyAccessExpression(e) ? e.name.text : '()'];
}

/**
 * The tests of a Vitest, Jest or node:test file `file`, from its `source`: each `test` or `it` call with a literal
 * name and a body, at the top of the file or of a `describe` callback's body, named as the tool names it (its suites
 * joined by `joiner`), with its own name as `leaf` for node:test. `focus`: whether a focused test runs alone, which
 * node:test leaves to the command (`--test-only`); by default, whenever the file focuses one.
 */
export async function listSource(source: string, file: string, joiner: string, how: { node?: boolean; focus?: boolean } = {}): Promise<Listed[]> {
  // A file run again unchanged is listed once: the listing is its source's, its name's and the options' alone.
  const key = `${file}\0${joiner}\0${how.node ?? ''}\0${how.focus ?? ''}\0${createHash('sha256').update(source).digest('hex')}`;
  const kept = listings.get(key);
  if (kept) return kept;
  const ts = (loaded ??= (await import('typescript')).default);
  // No parent links: positions and text are read through the file itself.
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false);
  const fileTagged = source.includes('@module-tag');
  const listed: (Listed & { focused: boolean })[] = [];
  const optionsOf = (call: import('typescript').CallExpression): string[] =>
    call.arguments.find(ts.isObjectLiteralExpression)?.properties.map((p) => p.name?.getText(sf) ?? '') ?? [];
  const focuses = (call: import('typescript').CallExpression, words: string[]): boolean =>
    words.includes('only') || optionsOf(call).includes('only') || words[0] === 'fit' || words[0] === 'fdescribe';
  // node:test's `skip(` or `todo(` in a test's body marks it; its `todo` alone ends a test's failure.
  const marking = how.node ? /\b(?:skip|todo)\s*\(/ : /\bskip\s*\(/;
  const walk = (statements: readonly Statement[], suites: string[], tagged: boolean, focused: boolean): void => {
    const calls = statements.flatMap((s) => {
      if (!ts.isExpressionStatement(s) || !ts.isCallExpression(s.expression)) return [];
      const words = chain(ts, s.expression.expression);
      return words ? [{ call: s.expression, words }] : [];
    });
    // In a focused suite with focused tests of its own, node:test runs those alone.
    const narrowed = how.node && calls.some(({ call, words }) => focuses(call, words));
    for (const { call, words } of calls) {
      if (words.slice(1).some((w) => UNSURE.has(w))) continue;
      const name = call.arguments[0];
      if (!name || !(ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name))) continue;
      const options = optionsOf(call);
      if (options.some((o) => SKIPPING.has(o))) continue;
      const isFocused = (focused && !narrowed) || focuses(call, words);
      const body = [...call.arguments].reverse().find((a) => ts.isArrowFunction(a) || ts.isFunctionExpression(a)) as FunctionLikeDeclaration | undefined;
      if (!body?.body) continue;
      const names = [...suites, name.text];
      const isTagged = tagged || options.includes('tags');
      if (SUITES.has(words[0]!)) {
        if (ts.isBlock(body.body)) walk(body.body.statements, names, isTagged, isFocused);
      } else if (TESTS.has(words[0]!) && !marking.test(body.body.getText(sf))) {
        const line = sf.getLineAndCharacterOfPosition(call.getStart(sf)).line + 1;
        listed.push({ test: names.join(joiner), file, line, tagged: isTagged, focused: isFocused, ...(how.node ? { names } : {}) });
      }
    }
  };
  walk(sf.statements, [], fileTagged, false);
  const focusing = how.focus ?? FOCUS.test(source);
  const result = listed.filter((l) => !focusing || l.focused).map(({ focused: _, ...l }) => l);
  if (listings.size >= LISTINGS) listings.delete(listings.keys().next().value!);
  listings.set(key, result);
  return result;
}

/** A run's name for a listed test: its own, or one of its parametrized cases (pytest's `test_x[1]`). */
const runs = (listed: Listed, test: string): boolean => test === (listed.names?.at(-1) ?? listed.test) || test.startsWith(`${listed.test}[`);
/** A test name pattern: node:test's `/source/flags` form, else the whole value as the source; null when it isn't one. */
function patternOf(f: Filter): RegExp | null {
  const literal = f.option.startsWith('--test-') ? /^\/(.*)\/([a-z]*)$/s.exec(f.value) : null;
  try { return literal ? new RegExp(literal[1]!, literal[2]) : new RegExp(f.value); } catch { return null; }
}
/** What node:test matches its patterns against: the test's own name, each of its suites', and each one's full name. */
const nodeNames = (names: string[]): string[] => [...names, ...names.map((_, i) => names.slice(0, i + 1).join(' '))];

/** The lines a command's `file:line` places (Vitest's) give a listed test's file, or null when none names it. */
function linesOf(listed: Listed, filters: Filter[]): number[] | null {
  const lines = filters.flatMap((f) => {
    const place = f.option === 'place' ? /^(?:\.\/)?(.+):(\d+)$/.exec(f.value) : null;
    return place && (listed.file === place[1] || listed.file.endsWith(`/${place[1]}`)) ? [Number(place[2])] : [];
  });
  return lines.length ? lines : null;
}

/**
 * The listed tests the run never ran (passed, failed, or for node:test reported skipped), but those the check's own
 * command left out: by a name pattern it gives (`-t`, `--testNamePattern`) the test's name doesn't match, by
 * node:test's patterns (none of its `--test-name-pattern`s matching, or a `--test-skip-pattern` matching, any of its
 * names), by a `--tags-filter` where the test carries tags, by a `file:line` of the test's file at another line, or
 * by a filter `named` holds that the tool reports left it out (a pytest node id among them).
 */
export function unrun(listed: Listed[], ran: Seen[], left: Left[], filters: Filter[], named: (filter: string) => boolean): Listed[] {
  const patterns = (...options: string[]): RegExp[] => filters.filter((f) => options.includes(f.option)).flatMap((f) => patternOf(f) ?? []);
  const names = patterns('-t', '--testNamePattern');
  const nodeIn = patterns('--test-name-pattern');
  const nodeOut = patterns('--test-skip-pattern');
  const tags = filters.some((f) => f.option === '--tags-filter');
  const chosen = (l: Listed): boolean => {
    if (!l.names) return !names.some((p) => !p.test(l.test));
    const all = nodeNames(l.names);
    return (!nodeIn.length || nodeIn.some((p) => all.some((n) => p.test(n)))) && !nodeOut.some((p) => all.some((n) => p.test(n)));
  };
  const byFile = new Map<string | null, Seen[]>();
  for (const r of ran) { const same = byFile.get(r.file); if (same) same.push(r); else byFile.set(r.file, [r]); }
  return listed.filter((l) => !byFile.get(l.file)?.some((r) => runs(l, r.test) && (r.line === undefined || r.line === l.line))
    && chosen(l) && !(tags && l.tagged) && !linesOf(l, filters)?.every((n) => n !== l.line)
    && !left.some((x) => x.file === l.file && (runs(l, x.test) || l.test.startsWith(`${x.test}::`)) && named(x.filter)));
}
