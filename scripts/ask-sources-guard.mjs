// The ask-sources check (#1829): every source the code passes to `raise` in packages/*/src has its row in
// packages/asks/sources.json, since the asks core refuses a source with no row and a raiser that drops the refusal
// leaves nobody asked. The TypeScript checker reads each `raise` call's `source` argument: a literal, a constant, a
// union or template of literals, or a parameter or property, followed to what its callers and object literals pass.
// A template part it can't read stands for any text, so the template passes when some row fits it; any other source
// it can't read FAILs. One `FAIL ask source: ...` line per finding, or one `PASS ask source` line; exit 1 on a finding.
// `--root <dir>` checks another checkout.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('../', import.meta.url));
const ts = createRequire(join(here, 'package.json'))('typescript');

const at = process.argv.indexOf('--root');
if (at !== -1 && (!process.argv[at + 1] || process.argv[at + 1].startsWith('--'))) {
  console.log('BLOCKED ask source: --root takes a folder\n  Fix: node scripts/ask-sources-guard.mjs [--root <checkout>]');
  process.exit(2);
}
const root = at === -1 ? here : process.argv[at + 1];
const packages = join(root, 'packages');
const table = join(packages, 'asks', 'sources.json');
if (!existsSync(table)) {
  console.log(`BLOCKED ask source: ${relative(root, table)} isn't there`);
  process.exit(2);
}
const rows = new Set(JSON.parse(readFileSync(table, 'utf8')).map((r) => r.source));

const tsFiles = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  if (statSync(path).isDirectory()) return name === 'test' || name === 'node_modules' ? [] : tsFiles(path);
  return /\.tsx?$/.test(name) && !/\.(d|test)\.tsx?$/.test(name) ? [path] : [];
});
// Each package's source, its imports of the others resolved to their source entries so no build is needed.
const files = [];
const paths = {};
for (const name of readdirSync(packages)) {
  const src = join(packages, name, 'src');
  if (!existsSync(src)) continue;
  files.push(...tsFiles(src));
  const manifest = JSON.parse(readFileSync(join(packages, name, 'package.json'), 'utf8'));
  for (const [sub, entry] of Object.entries(manifest.exports ?? {})) {
    const types = typeof entry === 'string' ? entry : entry?.types;
    if (typeof types === 'string' && types.endsWith('.ts')) paths[join(manifest.name, sub)] = [join(packages, name, types)];
  }
}
const ours = new Set(files);
const program = ts.createProgram(files, {
  target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
  allowImportingTsExtensions: true, noEmit: true, skipLibCheck: true, strict: true, baseUrl: root, paths,
});
const checker = program.getTypeChecker();
const sources = program.getSourceFiles().filter((f) => ours.has(f.fileName));

const site = (node) => {
  const file = node.getSourceFile();
  return `${relative(root, file.fileName)}:${file.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
};
const nameOf = (call) => {
  const callee = call.expression;
  return ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : undefined;
};
/** The strings a type can only be: a literal, a union of them, or a template of them; undefined for any other. */
function literals(type) {
  if (type.isStringLiteral()) return [type.value];
  if (type.isUnion()) {
    const each = type.types.map(literals);
    return each.every(Boolean) ? each.flat() : undefined;
  }
  if (type.flags & ts.TypeFlags.TemplateLiteral) {
    let out = [type.texts[0]];
    for (const [i, part] of type.types.entries()) {
      const values = literals(part);
      if (!values) return undefined;
      out = out.flatMap((head) => values.map((v) => head + v + type.texts[i + 1]));
    }
    return out;
  }
  return undefined;
}
/** All calls in the source, by the name they call. */
const calls = new Map();
/** All object-literal properties in the source, by their name. */
const props = new Map();
const index = (node) => {
  if (ts.isCallExpression(node)) {
    const name = nameOf(node);
    if (name) calls.set(name, [...(calls.get(name) ?? []), node]);
  } else if ((ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) && ts.isObjectLiteralExpression(node.parent) && ts.isIdentifier(node.name)) {
    props.set(node.name.text, [...(props.get(node.name.text) ?? []), node]);
  }
  ts.forEachChild(node, index);
};
for (const file of sources) index(file);

/** What the `source` argument at a call can be: each value with the place in the code it comes from. */
function resolve(expr, seen) {
  if (seen.has(expr)) return [];
  seen.add(expr);
  while (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr) || ts.isNonNullExpression(expr) || ts.isSatisfiesExpression(expr)) expr = expr.expression;
  const typed = literals(checker.getTypeAtLocation(expr));
  if (typed) return typed.map((value) => ({ value, at: site(expr) }));
  if (ts.isConditionalExpression(expr)) return [...resolve(expr.whenTrue, seen), ...resolve(expr.whenFalse, seen)];
  if (ts.isBinaryExpression(expr) && (expr.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || expr.operatorToken.kind === ts.SyntaxKind.BarBarToken)) return [...resolve(expr.left, seen), ...resolve(expr.right, seen)];
  if (ts.isTemplateExpression(expr)) {
    let out = [{ value: expr.head.text, at: site(expr) }];
    for (const span of expr.templateSpans) {
      // A part it can't read stands for any text, written as the code writes it.
      const read = resolve(span.expression, seen);
      const parts = !read.length || read.some((p) => p.value === undefined) ? [{ value: `\${${span.expression.getText()}}` }] : read;
      out = out.flatMap((head) => parts.map((p) => ({ value: head.value + p.value + span.literal.text, at: head.at })));
    }
    return out;
  }
  const symbol = ts.isIdentifier(expr) || ts.isPropertyAccessExpression(expr) ? checker.getSymbolAtLocation(expr) : undefined;
  const target = symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  const declarations = target?.declarations ?? [];
  const found = declarations.flatMap((d) => {
    if (ts.isVariableDeclaration(d) && d.initializer) return resolve(d.initializer, seen);
    if (ts.isParameter(d)) return fromCallers(d, seen);
    if (ts.isPropertySignature(d) || ts.isPropertyDeclaration(d)) return fromObjects(target, d, seen);
    if ((ts.isPropertyAssignment(d)) && d.initializer) return resolve(d.initializer, seen);
    return [];
  });
  return found.length ? found : [{ value: undefined, at: site(expr), text: expr.getText() }];
}
/** A parameter's values: its default, and what each call of its function passes in its place. */
function fromCallers(param, seen) {
  const fn = param.parent;
  const i = fn.parameters.indexOf(param);
  const out = param.initializer ? resolve(param.initializer, seen) : [];
  const name = fn.name && ts.isIdentifier(fn.name) ? fn.name.text
    : (ts.isPropertyAssignment(fn.parent) || ts.isPropertyDeclaration(fn.parent) || ts.isVariableDeclaration(fn.parent)) && ts.isIdentifier(fn.parent.name) ? fn.parent.name.text : undefined;
  if (!name || !ts.isIdentifier(param.name)) return out;
  for (const call of calls.get(name) ?? []) {
    const signature = checker.getResolvedSignature(call);
    if (signature?.parameters[i]?.name !== param.name.text || !call.arguments[i]) continue;
    out.push(...resolve(call.arguments[i], seen));
  }
  return out;
}
/** A property's values: what each object literal typed with it puts there. */
function fromObjects(symbol, decl, seen) {
  const out = [];
  for (const p of props.get(symbol.name) ?? []) {
    const contextual = checker.getContextualType(p.parent);
    const types = !contextual ? [] : contextual.isUnion() ? contextual.types : [contextual];
    if (!types.some((t) => t.getProperty(symbol.name)?.declarations?.includes(decl))) continue;
    out.push(...resolve(ts.isPropertyAssignment(p) ? p.initializer : p.name, seen));
  }
  return out;
}

/** Whether a row fits a source: the same name, or for a template with parts it can't read, the template's shape. */
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const fits = (value) => {
  if (!value.includes('${')) return rows.has(value);
  const shape = new RegExp(`^${value.split(/\$\{[^}]*\}/).map(escape).join('.+')}$`);
  return [...rows].some((row) => shape.test(row));
};
const findings = new Map();
let count = 0;
for (const call of calls.get('raise') ?? []) {
  // A raise the checker can't type might take any source, so it isn't passed over.
  if (checker.getTypeAtLocation(call.expression).flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) {
    findings.set(site(call), `FAIL ask source: ${site(call)}: can't read what ${call.expression.getText()} takes\n  Fix: give the object it's called on a type`);
    continue;
  }
  const signature = checker.getResolvedSignature(call);
  const i = signature?.parameters.findIndex((p) => p.name === 'source') ?? -1;
  if (i < 0 || !call.arguments[i]) continue;
  for (const { value, at: from, text } of resolve(call.arguments[i], new Set())) {
    // One finding per place a source is written, however many raises it reaches: the raise on its own line if it has one.
    const key = `${value ?? text}@${from}`;
    if (findings.has(key) && from !== site(call)) continue;
    if (!findings.has(key)) count++;
    const raised = from === site(call) ? '' : ` (raised at ${site(call)})`;
    if (value === undefined) findings.set(key, `FAIL ask source: ${from}: can't read the source ${text}${raised}\n  Fix: pass raise a literal, a constant or a value of a literal type`);
    else findings.set(key, fits(value) ? undefined : `FAIL ask source: ${from}: ${value} has no row in packages/asks/sources.json${raised}\n  Fix: add its row to packages/asks/sources.json, with a fixture of its ask`);
  }
}
const failed = [...findings.values()].filter(Boolean);
console.log(failed.length ? failed.join('\n') : `PASS ask source: ${count} sources passed to raise, each with its row`);
process.exitCode = failed.length ? 1 : 0;
