// #1907 AC2: no field of the result type is written and never read. "The result type" is what one driver run
// hands back: the awaited return type of `drive` in packages/checks-journey/src/run.ts, with the types run.ts
// declares for its fields, nested (README, Readings). The test reads the package's sources with TypeScript's own
// checker (the repo's devDependency), so a field is found by its declaration, never by its name: `.size` on a Map
// or `.kind` on an evidence put isn't a read of the artifact's. A field is written where an object literal typed as
// its type sets it, or an assignment does; it's read where an expression takes its value: a property access that
// isn't an assignment's target, a destructuring, a spread or a whole value handed to `unknown` (serialized), or a
// read of the same-named field of the parameter type a value of its type is passed as (`discard(driven)` reads
// `dir`). At the merge base it finds the artifact's sha256, size and kind and the run's out and wallMs.
import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { expect, it } from 'vitest';

const AC2 = '#1907.ee5abddf';
const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const PACKAGE = join(REPO, 'packages/checks-journey');
const SRC = join(PACKAGE, 'src');
const RUN = join(SRC, 'run.ts');

interface Field { name: string; path: string; at: string; written: boolean; read: boolean }

/** The folder a file is in: its package's sources, where every reader of the unexported result type lives. */
const folderOf = (file: string): string => file.slice(0, file.lastIndexOf('/') + 1);
const named = (name: ts.PropertyName | ts.BindingName): string | null =>
  ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name) || ts.isPrivateIdentifier(name) ? name.text : null;

/**
 * The fields of the result of `fn` in `file`, each with whether the program's sources write it and read it. Null
 * when `file` declares no function `fn`.
 */
function resultFields(program: ts.Program, file: string, fn: string): Field[] | null {
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(file);
  const declaration = source?.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === fn);
  if (!source || !declaration) return null;
  const signature = checker.getSignatureFromDeclaration(declaration);
  if (!signature) return null;
  let result = checker.getReturnTypeOfSignature(signature);
  if (result.getSymbol()?.getName() === 'Promise') result = checker.getTypeArguments(result as ts.TypeReference)[0] ?? result;

  // The object types `file` declares, reached from the result through its fields (null, unions and arrays seen through).
  const parts = (type: ts.Type): ts.Type[] => {
    const t = checker.getNonNullableType(type);
    if (t.isUnion()) return t.types.flatMap(parts);
    const name = t.getSymbol()?.getName();
    if (name === 'Array' || name === 'ReadonlyArray') return checker.getTypeArguments(t as ts.TypeReference).flatMap(parts);
    return [t];
  };
  const declaredHere = (node: ts.Node): boolean => node.getSourceFile().fileName === source.fileName;
  const fields = new Map<ts.Node, Field>();
  const byType = new Map<ts.Type, Map<string, Field>>();
  const walk = (type: ts.Type, path: string): void => {
    for (const t of parts(type)) {
      const declared = t.getSymbol()?.declarations ?? [];
      if (!(t.flags & ts.TypeFlags.Object) || byType.has(t) || !declared.some(declaredHere)) continue;
      const own = new Map<string, Field>();
      byType.set(t, own);
      for (const p of checker.getPropertiesOfType(t)) {
        const decls = (p.declarations ?? []).filter(declaredHere);
        if (!decls.length) continue;
        const first = decls[0]!;
        const line = first.getSourceFile().getLineAndCharacterOfPosition(first.getStart()).line + 1;
        const field: Field = { name: p.name, path: `${path}.${p.name}`, at: `${relative(REPO, first.getSourceFile().fileName)}:${line}`, written: false, read: false };
        own.set(p.name, field);
        for (const d of decls) if (!fields.has(d)) fields.set(d, field);
        walk(checker.getTypeOfSymbolAtLocation(p, first), field.path);
      }
    }
  };
  walk(result, result.getSymbol()?.getName() ?? fn);

  const aliases = new Map<ts.Node, Field[]>();
  const ofType = (type: ts.Type): Field[] => parts(type).flatMap((t) => [...(byType.get(t)?.values() ?? [])]);
  const ofSymbol = (symbol: ts.Symbol | undefined): Field[] => (symbol?.declarations ?? []).flatMap((d) => {
    const own = fields.get(d);
    return [...(own ? [own] : []), ...(aliases.get(d) ?? [])];
  });
  const files = program.getSourceFiles().filter((f) => !f.isDeclarationFile && f.fileName.startsWith(folderOf(source.fileName)));

  // Pass 1: a value of a result type passed where another object type is asked for reads, through it, the fields of
  // that type's same-named properties; a value handed to `unknown` or `any` is read whole.
  const passed = (node: ts.Node): void => {
    if ((ts.isCallExpression(node) || ts.isNewExpression(node)) && node.arguments) {
      for (const arg of node.arguments) {
        const mine = ofType(checker.getTypeAtLocation(arg));
        if (!mine.length) continue;
        const asked = checker.getContextualType(arg);
        if (!asked) continue;
        if (asked.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) { for (const f of mine) f.read = true; continue; }
        for (const q of checker.getPropertiesOfType(checker.getNonNullableType(asked))) {
          const same = mine.filter((f) => f.name === q.name);
          for (const d of q.declarations ?? []) if (!fields.has(d)) aliases.set(d, [...(aliases.get(d) ?? []), ...same]);
        }
      }
    }
    ts.forEachChild(node, passed);
  };
  // Pass 2: writes and reads.
  const isTarget = (node: ts.Node): 'set' | 'update' | null => {
    const parent = node.parent;
    if (ts.isBinaryExpression(parent) && parent.left === node) {
      const op = parent.operatorToken.kind;
      if (op === ts.SyntaxKind.EqualsToken) return 'set';
      if (op >= ts.SyntaxKind.FirstCompoundAssignment && op <= ts.SyntaxKind.LastCompoundAssignment) return 'update';
    }
    if ((ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) && (parent.operator === ts.SyntaxKind.PlusPlusToken || parent.operator === ts.SyntaxKind.MinusMinusToken)) return 'update';
    return null;
  };
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const key = ts.isPropertyAccessExpression(node) ? node.name : node.argumentExpression;
      const target = isTarget(node);
      for (const f of ofSymbol(checker.getSymbolAtLocation(key))) {
        if (target) f.written = true;
        if (target !== 'set') f.read = true;
      }
    } else if (ts.isObjectLiteralExpression(node)) {
      const asked = checker.getContextualType(node);
      if (asked) {
        // A literal an async function returns is asked for as its Promise's type: the promised type is the one written.
        const awaited = (type: ts.Type): ts.Type[] => {
          const t = checker.getNonNullableType(type);
          if (t.isUnion()) return t.types.flatMap(awaited);
          const name = t.getSymbol()?.getName();
          return name === 'Promise' || name === 'PromiseLike' ? checker.getTypeArguments(t as ts.TypeReference).flatMap(awaited) : [t];
        };
        const types = awaited(asked);
        for (const p of node.properties) {
          const name = p.name && named(p.name);
          if (name === null || name === undefined) continue;
          for (const t of types) for (const f of ofSymbol(checker.getPropertyOfType(t, name))) f.written = true;
        }
      }
    } else if (ts.isObjectBindingPattern(node)) {
      const owner = node.parent;
      const from = ts.isVariableDeclaration(owner) && owner.initializer ? owner.initializer : owner;
      const t = checker.getNonNullableType(checker.getTypeAtLocation(from));
      for (const e of node.elements) {
        const name = named(e.propertyName ?? e.name);
        if (name !== null) for (const f of ofSymbol(checker.getPropertyOfType(t, name))) f.read = true;
      }
    } else if (ts.isSpreadAssignment(node) || ts.isSpreadElement(node)) {
      for (const f of ofType(checker.getTypeAtLocation(node.expression))) f.read = true;
    }
    ts.forEachChild(node, visit);
  };
  for (const f of files) passed(f);
  for (const f of files) visit(f);
  return [...new Set(fields.values())];
}

/** The package's program, as its own tsconfig builds it. */
function packageProgram(): ts.Program {
  const host: ts.ParseConfigFileHost = { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => undefined };
  const parsed = ts.getParsedCommandLineOfConfigFile(join(PACKAGE, 'tsconfig.json'), { noEmit: true }, host);
  const files = (readdirSync(SRC, { recursive: true, encoding: 'utf8' }) as string[]).filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts')).map((f) => join(SRC, f));
  return ts.createProgram(files, parsed?.options ?? { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, strict: true, noEmit: true });
}
const unread = (fields: Field[]): string[] => fields.filter((f) => f.written && !f.read).map((f) => `${f.path} (${f.at})`).sort();

it(`${AC2} no field of the result type a driver run hands back is written and never read`, () => {
  const fields = resultFields(packageProgram(), RUN, 'drive');
  expect(fields, 'packages/checks-journey/src/run.ts declares `drive`, whose result is the result type').not.toBeNull();
  expect(fields!.filter((f) => f.written).length, 'the sources write some field of the result').toBeGreaterThan(0);
  expect(unread(fields!), 'fields of the result type written and never read').toEqual([]);
}, 120_000);

// The detector itself, on a planted program: it names the written fields nothing reads, and none that something
// reads, including through a parameter type. No criterion tag: this guards the reading above.
it('the reading names a written field nothing reads, and not one read directly or through a parameter type', () => {
  const file = '/v/src/run.ts';
  const text = [
    'export interface Thing { a: string; b: number; c: { d: boolean; e: string } }',
    'export interface Out { thing: Thing; at: string; dir: string; things: Thing[] }',
    "export async function drive(): Promise<Out> { const thing: Thing = { a: 'x', b: 1, c: { d: true, e: '' } }; return { thing, at: 'now', dir: '/tmp', things: [thing] }; }",
    'export function discard(o: { dir: string }): string { return o.dir; }',
    'export async function use(): Promise<string> { const o = await drive(); discard(o); const { things } = o; return o.thing.a + String(o.thing.c.d) + things.length; }',
  ].join('\n');
  const options: ts.CompilerOptions = { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true, noEmit: true };
  const host = ts.createCompilerHost(options);
  const { getSourceFile, fileExists, readFile } = host;
  host.getSourceFile = (name, language, ...rest) => (name === file ? ts.createSourceFile(name, text, language, true) : getSourceFile.call(host, name, language, ...rest));
  host.fileExists = (name) => name === file || fileExists.call(host, name);
  host.readFile = (name) => (name === file ? text : readFile.call(host, name));
  const fields = resultFields(ts.createProgram([file], options, host), file, 'drive');
  expect(unread(fields ?? []).map((f) => f.split(' ')[0])).toEqual(['Out.at', 'Out.thing.b', 'Out.thing.c.e']);
});
