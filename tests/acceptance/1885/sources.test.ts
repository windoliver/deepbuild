// #1885's third criterion: a command site that reads `control.token` itself fails a test that reads the sources,
// naming the file. The rule (README, Readings, "AC3's rule"):
// - Scanned: every TypeScript source of the deep command's packages, packages/hub/src and packages/cli/src (`*.ts`,
//   not `*.d.ts`, `*.test.ts` or `*.spec.ts`, nor anything under a test, tests, __tests__ or fixtures folder), with
//   the TypeScript compiler over each package's own tsconfig.json.
// - A file reads a control token itself when it holds a call to readFileSync, readFile or createReadStream (by name,
//   whatever object it is called on) whose first argument names the control token's file: in the argument's own
//   expression, or in the initializer of a variable that expression names (followed through such variables), there is
//   a string literal holding `control.token`, or a `.token` read off a value of paths.ts's `Root` type (what
//   `rootOf()` returns: `rootOf(…).token`, `at.token` for `const at = rootOf(…)`, a `Root` parameter's `.token`).
// - At most one scanned file may do it: the file of the one helper that returns a socket with the token that belongs
//   to it. Where that helper lives is the implementer's choice; any second reader fails the test, every reader named.
import { readdirSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { expect, it } from 'vitest';

const AC3 = '#1885.704c440e';
const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const PACKAGES = ['packages/hub', 'packages/cli'];
const READS = new Set(['readFileSync', 'readFile', 'createReadStream']);
const SKIPPED_FOLDERS = new Set(['test', 'tests', '__tests__', 'fixtures']);

/** The package's non-test TypeScript sources under src/, as absolute paths. */
function sources(pkg: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { if (!SKIPPED_FOLDERS.has(entry.name)) walk(path); }
      else if (entry.isFile() && entry.name.endsWith('.ts') && !/\.(d|test|spec)\.ts$/.test(entry.name)) out.push(path);
    }
  };
  walk(join(REPO, pkg, 'src'));
  return out;
}

/** A program over the package's sources with its own tsconfig.json's options, for the type checker. */
function program(pkg: string, files: string[]): ts.Program {
  const configFile = join(REPO, pkg, 'tsconfig.json');
  const read = ts.readConfigFile(configFile, (p) => ts.sys.readFile(p));
  if (read.error) throw Error(`BLOCKED: can't read ${configFile}: ${ts.flattenDiagnosticMessageText(read.error.messageText, '\n')}`);
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(configFile));
  return ts.createProgram({ rootNames: files, options: { ...parsed.options, noEmit: true } });
}

const calleeName = (call: ts.CallExpression): string | undefined => {
  const e = call.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return undefined;
};

/** Whether `type` is (or, as a union, holds) paths.ts's `Root`. */
function isRoot(type: ts.Type): boolean {
  if (type.isUnion()) return type.types.some(isRoot);
  const symbol = type.aliasSymbol ?? type.getSymbol();
  return !!symbol && symbol.getName() === 'Root' && (symbol.getDeclarations() ?? []).some((d) => /packages\/hub\/(src\/paths\.ts|dist\/paths\.d\.ts)$/.test(d.getSourceFile().fileName.split(sep).join('/')));
}

/** Whether `node`, or a variable's initializer it names (followed), names the control token's file. */
function namesToken(node: ts.Node, checker: ts.TypeChecker, seen = new Set<ts.Node>()): boolean {
  if (seen.has(node)) return false;
  seen.add(node);
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) && n.text.includes('control.token')) { found = true; return; }
    if (ts.isPropertyAccessExpression(n) && n.name.text === 'token' && isRoot(checker.getTypeAtLocation(n.expression))) { found = true; return; }
    if (ts.isIdentifier(n)) {
      const symbol = checker.getSymbolAtLocation(n);
      for (const d of symbol?.getDeclarations() ?? []) {
        if (ts.isVariableDeclaration(d) && d.initializer && namesToken(d.initializer, checker, seen)) { found = true; return; }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

/** Each scanned file that reads a control token itself, with the line of each read. */
function readers(): { file: string; lines: number[] }[] {
  const out: { file: string; lines: number[] }[] = [];
  for (const pkg of PACKAGES) {
    const files = sources(pkg);
    if (!files.length) throw Error(`BLOCKED: no sources found under ${pkg}/src`);
    const p = program(pkg, files);
    const checker = p.getTypeChecker();
    for (const file of files) {
      const sf = p.getSourceFile(file);
      if (!sf) throw Error(`BLOCKED: the compiler didn't load ${relative(REPO, file)}`);
      const lines: number[] = [];
      const visit = (n: ts.Node): void => {
        if (ts.isCallExpression(n) && READS.has(calleeName(n) ?? '') && n.arguments[0] && namesToken(n.arguments[0], checker)) {
          lines.push(sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1);
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
      if (lines.length) out.push({ file: relative(REPO, file).split(sep).join('/'), lines });
    }
  }
  return out;
}

it(`${AC3} at most one source file of the command packages reads control.token itself: the one helper's`, () => {
  // The rule must see a reader where there is one: paths.ts's Root type is what it follows.
  const paths = join(REPO, 'packages/hub/src/paths.ts');
  const p = program('packages/hub', [paths]);
  const root = p.getSourceFile(paths)?.statements.find((s) => ts.isInterfaceDeclaration(s) && s.name.text === 'Root');
  if (!root) throw Error('BLOCKED: packages/hub/src/paths.ts declares no Root, the type whose .token this rule follows');

  const found = readers();
  const named = found.map((r) => `${r.file} (line${r.lines.length === 1 ? '' : 's'} ${r.lines.join(', ')})`);
  expect(found.length, `${found.length} files read control.token themselves; at most one, the helper that returns the socket with its token, may:\n${named.join('\n')}`).toBeLessThanOrEqual(1);
}, 300_000);
