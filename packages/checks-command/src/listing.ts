// The tests a run file holds, listed apart from the run: a Vitest or Jest file read from its source here, with no
// tool and none of the checkout's config or setup, and a Python file listed by the runner's pytest plugin from its
// source by pytest's default rules. Each is a test a default run of the file runs: a call the source itself skips,
// marks todo, makes conditional or names at run time isn't listed, nor, in a file that focuses some (.only, fit), one it doesn't focus. A listed test the run never ran was left out by
// something other than its source, and the run can't pass, unless the check's own command left it out.
import type { Expression, FunctionLikeDeclaration, Statement } from 'typescript';

export interface Listed { test: string; file: string; line: number; tagged: boolean }
/** A test the tool reports it left out, and the filter that did it (pytest's deselection and collection patterns). */
export interface Left { test: string; file: string; filter: string }
/** A value the check's command gives an option that chooses tests. */
export interface Filter { option: string; value: string }

type TS = typeof import('typescript');
let loaded: TS | undefined;
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
 * The tests of a Vitest or Jest file `file`, from its `source`: each `test` or `it` call with a literal name and a
 * body, at the top of the file or of a `describe` callback's body, named as the tool names it (its suites joined by `joiner`).
 */
export async function listSource(source: string, file: string, joiner: string): Promise<Listed[]> {
  const ts = (loaded ??= (await import('typescript')).default);
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const fileTagged = source.includes('@module-tag');
  const listed: (Listed & { focused: boolean })[] = [];
  const walk = (statements: readonly Statement[], suites: string[], tagged: boolean, focused: boolean): void => {
    for (const s of statements) {
      if (!ts.isExpressionStatement(s) || !ts.isCallExpression(s.expression)) continue;
      const call = s.expression;
      const words = chain(ts, call.expression);
      if (!words || words.slice(1).some((w) => UNSURE.has(w))) continue;
      const isFocused = focused || words.includes('only') || words[0] === 'fit' || words[0] === 'fdescribe';
      const name = call.arguments[0];
      if (!name || !(ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name))) continue;
      const options = call.arguments.find(ts.isObjectLiteralExpression)?.properties.map((p) => p.name?.getText(sf) ?? '') ?? [];
      if (options.some((o) => SKIPPING.has(o))) continue;
      const body = [...call.arguments].reverse().find((a) => ts.isArrowFunction(a) || ts.isFunctionExpression(a)) as FunctionLikeDeclaration | undefined;
      if (!body?.body) continue;
      const names = [...suites, name.text];
      const isTagged = tagged || options.includes('tags');
      if (SUITES.has(words[0]!)) {
        if (ts.isBlock(body.body)) walk(body.body.statements, names, isTagged, isFocused);
      } else if (TESTS.has(words[0]!) && !/\bskip\s*\(/.test(body.body.getText(sf))) {
        listed.push({ test: names.join(joiner), file, line: sf.getLineAndCharacterOfPosition(call.getStart(sf)).line + 1, tagged: isTagged, focused: isFocused });
      }
    }
  };
  walk(sf.statements, [], fileTagged, false);
  const focusing = FOCUS.test(source);
  return listed.filter((l) => !focusing || l.focused).map(({ focused: _, ...l }) => l);
}

/** A run's name for a listed test: its own, or one of its parametrized cases (pytest's `test_x[1]`). */
const runs = (listed: Listed, test: string): boolean => test === listed.test || test.startsWith(`${listed.test}[`);

/** The lines a command's `file:line` places (Vitest's) give a listed test's file, or null when none names it. */
function linesOf(listed: Listed, filters: Filter[]): number[] | null {
  const lines = filters.flatMap((f) => {
    const place = f.option === 'place' ? /^(?:\.\/)?(.+):(\d+)$/.exec(f.value) : null;
    return place && (listed.file === place[1] || listed.file.endsWith(`/${place[1]}`)) ? [Number(place[2])] : [];
  });
  return lines.length ? lines : null;
}

/**
 * The listed tests the run never ran (passed or failed), but those the check's own command left out: by a name
 * pattern it gives (`-t`, `--testNamePattern`) the test's name doesn't match, by a `--tags-filter` where the test
 * carries tags, by a `file:line` of the test's file at another line, or by a filter `named` holds that the tool
 * reports left it out (a pytest node id among them).
 */
export function unrun(listed: Listed[], ran: { test: string; file: string | null }[], left: Left[], filters: Filter[], named: (filter: string) => boolean): Listed[] {
  const patterns = filters.filter((f) => f.option === '-t' || f.option === '--testNamePattern').flatMap((f) => { try { return [new RegExp(f.value)]; } catch { return []; } });
  const tags = filters.some((f) => f.option === '--tags-filter');
  return listed.filter((l) => !ran.some((r) => r.file === l.file && runs(l, r.test))
    && !patterns.some((p) => !p.test(l.test)) && !(tags && l.tagged) && !linesOf(l, filters)?.every((n) => n !== l.line)
    && !left.some((x) => x.file === l.file && (runs(l, x.test) || l.test.startsWith(`${x.test}::`)) && named(x.filter)));
}
