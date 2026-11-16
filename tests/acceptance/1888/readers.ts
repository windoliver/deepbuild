// #1888 AC3's detector: the functions under a source folder that read a Makefile rule, found by reading the sources.
// It knows no function or file name. TypeScript's own parser (the repo's devDependency) cuts each file into units: a
// top-level function, a top-level `const` whose value holds a function, a class member; whatever is nested in one
// belongs to it. A unit reads a Makefile rule when its code (never its comments) holds both
//
// - a rule-header test: a regular expression with a literal colon in it (a `(?:` group's colon isn't one), as a
//   literal or as the text handed to `new RegExp`, or the string ':' itself (`indexOf(':')`, `split(':')`); and
// - a recipe-line test: a regular expression that starts by asking whether a line begins with white space or not
//   (`^\s`, `^\t`, `^[ \t]`, `^\S`, `^[^\s…]`, …; never `^\s*`, `^\s?` or `^\s{0,`, which a line with no indent passes
//   too), or the tab string '\t', or `startsWith` of a string of blanks.
//
// The README states its limits.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

export interface Reader { file: string; name: string; line: number; header: string; recipe: string }

const INDENT = /^\^(?:\\[stS]|\[\^?(?:\\[st]| )(?:\\[st]| |#)*\]|\((?:\?:)?(?:\\[st]| ))(?![*?]|\{0)/;
const colonIn = (source: string): boolean => /:/.test(source.replace(/\(\?:/g, '('));
const holdsFunction = (node: ts.Node): boolean => ts.isFunctionLike(node) || (ts.forEachChild(node, holdsFunction) ?? false);

function unitsOf(source: ts.SourceFile): { name: string; node: ts.Node }[] {
  const units: { name: string; node: ts.Node }[] = [];
  const lineOf = (node: ts.Node): number => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  for (const statement of source.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const d of statement.declarationList.declarations) if (d.initializer && holdsFunction(d.initializer)) units.push({ name: d.name.getText(source), node: d });
    } else if (ts.isClassDeclaration(statement)) {
      for (const m of statement.members) if (holdsFunction(m)) units.push({ name: `${statement.name?.text ?? 'class'}.${m.name?.getText(source) ?? 'constructor'}`, node: m });
    } else if (holdsFunction(statement)) {
      units.push({ name: ts.isFunctionDeclaration(statement) && statement.name ? statement.name.text : `statement at line ${lineOf(statement)}`, node: statement });
    }
  }
  return units;
}

/** The units of one source text that read a Makefile rule, with the code that showed each half. */
export function readersIn(file: string, text: string): Reader[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.ES2023, true, ts.ScriptKind.TS);
  return unitsOf(source).flatMap(({ name, node }) => {
    let header: string | null = null, recipe: string | null = null;
    const visit = (n: ts.Node): void => {
      const shown = n.getText(source);
      if (ts.isRegularExpressionLiteral(n)) {
        const body = n.text.slice(1, n.text.lastIndexOf('/'));
        if (colonIn(body)) header ??= shown;
        if (INDENT.test(body)) recipe ??= shown;
      } else if (ts.isNewExpression(n) && n.expression.getText(source) === 'RegExp' && n.arguments?.[0]) {
        // The pattern as written, with a template's `${…}` holes cut out and a string's doubled backslashes read once.
        const body = n.arguments[0].getText(source).slice(1, -1).replace(/\$\{(?:[^{}]|\{[^{}]*\})*\}/g, '').replace(/\\\\/g, '\\');
        if (colonIn(body)) header ??= shown;
        if (INDENT.test(body)) recipe ??= shown;
      } else if (ts.isStringLiteralLike(n)) {
        if (n.text === ':') header ??= shown;
        const call = n.parent;
        const blanks = ts.isCallExpression(call) && ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === 'startsWith' && /^[ \t]+$/.test(n.text);
        if (n.text === '\t' || blanks) recipe ??= shown;
      }
      ts.forEachChild(n, visit);
    };
    visit(node);
    return header !== null && recipe !== null ? [{ file, name, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, header, recipe }] : [];
  });
}

/** Every `.ts` source under `dir`, by path from it, sorted. */
export function sourcesUnder(dir: string): string[] {
  return (readdirSync(dir, { recursive: true }) as string[]).filter((p) => p.endsWith('.ts') && !p.endsWith('.d.ts')).map((p) => relative(dir, join(dir, p))).sort();
}
/** The functions under `dir` that read a Makefile rule. */
export const readersUnder = (dir: string): Reader[] => sourcesUnder(dir).flatMap((file) => readersIn(file, readFileSync(join(dir, file), 'utf8')));
export const named = (readers: readonly Reader[]): string => readers.map((r) => `${r.name} (${r.file}:${r.line}; header ${r.header}, recipe ${r.recipe})`).join('; ') || 'none';
