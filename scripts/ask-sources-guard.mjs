// The ask-source guard (#1829): every source the code passes to `raise` under packages/ has its row in
// packages/asks/sources.json, since the asks core refuses a source with no row and a raiser that drops the refusal
// leaves nobody asked. The TypeScript checker reads each `raise` call's `source` argument: a literal, a constant, a
// union or template of literals, or a variable, parameter or property, followed to everything that sets it: its
// initializer and assignments, each call of its function, each object literal of its type. A template part it can't
// read stands for any text, so a template passes when some row fits it, and one with no words of its own is unread.
// A source it can't read, a raise it can't type and a raise or a source's function passed on as a value FAIL. One
// `FAIL ask source: <path>:<line>: ...` line per finding, or one `PASS ask source: ...` line; exit 1 on a finding.
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

// Every script under packages/ but its tests and what's built or installed.
const SKIP = new Set(['test', 'dist', 'node_modules', 'target']);
const scripts = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  if (statSync(path).isDirectory()) return SKIP.has(name) ? [] : scripts(path);
  return /\.[cm]?[jt]sx?$/.test(name) && !/\.(d|test)\.[cm]?[jt]sx?$/.test(name) ? [path] : [];
});
const files = scripts(packages);
// Each package's imports of the others resolve to their source entries, so no build is needed.
const paths = {};
for (const name of readdirSync(packages)) {
  const manifest = join(packages, name, 'package.json');
  if (!existsSync(manifest)) continue;
  const { name: id, exports } = JSON.parse(readFileSync(manifest, 'utf8'));
  // `exports` maps subpaths to entries, or is the one entry itself.
  const entries = typeof exports === 'string' || Object.keys(exports ?? {}).some((k) => !k.startsWith('.')) ? { '.': exports } : exports ?? {};
  for (const [sub, entry] of Object.entries(entries)) {
    const types = typeof entry === 'string' ? entry : entry?.types;
    if (typeof types === 'string' && types.endsWith('.ts')) paths[join(id, sub)] = [join(packages, name, types)];
  }
}
const ours = new Set(files);
const program = ts.createProgram(files, {
  target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
  allowImportingTsExtensions: true, allowJs: true, noEmit: true, skipLibCheck: true, strict: true, baseUrl: root, paths,
});
const checker = program.getTypeChecker();
const sources = program.getSourceFiles().filter((f) => ours.has(f.fileName));

const site = (node) => {
  const file = node.getSourceFile();
  return `${relative(root, file.fileName)}:${file.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
};
/** The name a callee or member access reads: `f`, `x.f` or `x['f']`. */
const nameOf = (expr) => ts.isIdentifier(expr) ? expr.text : ts.isPropertyAccessExpression(expr) ? expr.name.text
  : ts.isElementAccessExpression(expr) && ts.isStringLiteralLike(expr.argumentExpression) ? expr.argumentExpression.text : undefined;
const symbolOf = (node) => {
  const symbol = checker.getSymbolAtLocation(node);
  return symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
};
const push = (map, key, value) => map.set(key, [...(map.get(key) ?? []), value]);
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

/** The calls, object-literal properties, assignments and identifiers in the source, by the name they use. */
const calls = new Map();
const props = new Map();
const assigns = new Map();
const names = new Map();
const index = (node) => {
  if (ts.isCallExpression(node)) {
    const name = nameOf(node.expression);
    if (name) push(calls, name, node);
  } else if ((ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) && ts.isObjectLiteralExpression(node.parent) && ts.isIdentifier(node.name)) {
    push(props, node.name.text, node);
  } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    const name = nameOf(node.left);
    if (name) push(assigns, name, node);
  } else if (ts.isIdentifier(node)) {
    push(names, node.text, node);
  }
  ts.forEachChild(node, index);
};
for (const file of sources) index(file);

const unread = (expr, why = `can't read the source ${expr.getText()}`) => [{ value: undefined, at: site(expr), why }];
/** What an expression passed as a source can be: each value with the place in the code it comes from. */
function resolve(expr, seen) {
  if (seen.has(expr)) return [];
  seen.add(expr);
  while (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr) || ts.isNonNullExpression(expr) || ts.isSatisfiesExpression(expr)) expr = expr.expression;
  const typed = literals(checker.getTypeAtLocation(expr));
  if (typed) return typed.map((value) => ({ value, at: site(expr) }));
  if (ts.isConditionalExpression(expr)) return [...resolve(expr.whenTrue, seen), ...resolve(expr.whenFalse, seen)];
  if (ts.isBinaryExpression(expr) && (expr.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || expr.operatorToken.kind === ts.SyntaxKind.BarBarToken)) return [...resolve(expr.left, seen), ...resolve(expr.right, seen)];
  if (ts.isTemplateExpression(expr)) return template(expr, seen);
  const symbol = ts.isIdentifier(expr) || ts.isPropertyAccessExpression(expr) ? symbolOf(expr) : undefined;
  const found = (symbol?.declarations ?? []).flatMap((d) => {
    if (ts.isVariableDeclaration(d)) return [...(d.initializer ? resolve(d.initializer, seen) : []), ...assigned(symbol, seen)];
    if (ts.isParameter(d)) return fromCallers(d, seen);
    if (ts.isPropertySignature(d) || ts.isPropertyDeclaration(d)) {
      return [...(ts.isPropertyDeclaration(d) && d.initializer ? resolve(d.initializer, seen) : []), ...fromObjects(symbol, d, seen), ...assigned(symbol, seen)];
    }
    if (ts.isPropertyAssignment(d)) return resolve(d.initializer, seen);
    return [];
  });
  return found.length ? found : unread(expr);
}
/** A template's values; a part it can't read stands for any text, and a template with no words of its own is unread. */
function template(expr, seen) {
  const words = [expr.head.text, ...expr.templateSpans.map((s) => s.literal.text)].join('');
  let out = [{ value: expr.head.text, at: site(expr) }];
  for (const span of expr.templateSpans) {
    const read = resolve(span.expression, seen);
    const wild = !read.length || read.some((p) => p.value === undefined);
    if (wild && !/[A-Za-z]/.test(words)) return unread(expr);
    const parts = wild ? [{ value: `\${${span.expression.getText()}}` }] : read;
    out = out.flatMap((head) => parts.map((p) => ({ value: head.value + p.value + span.literal.text, at: head.at })));
  }
  return out;
}
/** What each assignment to a variable or property sets it to. */
const assigned = (symbol, seen) => (assigns.get(symbol.name) ?? []).filter((a) => symbolOf(ts.isElementAccessExpression(a.left) ? a.left.argumentExpression : a.left) === symbol).flatMap((a) => resolve(a.right, seen));
/** Whether an identifier is called, declared, or only named in a type, rather than passed on as a value. */
const notValue = (id, fn) => {
  const p = id.parent;
  if ((ts.isCallExpression(p) && p.expression === id) || (ts.isPropertyAccessExpression(p) && p.name === id && ts.isCallExpression(p.parent) && p.parent.expression === p)) return true;
  if (fn.name === id || (p.name === id && (ts.isVariableDeclaration(p) || ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p) || ts.isMethodDeclaration(p)))) return true;
  for (let n = id; n; n = n.parent) if (ts.isTypeNode(n) || ts.isExportSpecifier(n) || ts.isImportSpecifier(n)) return true;
  return false;
};
/** A parameter's values: its default, and what each call of its function passes in its place. */
function fromCallers(param, seen) {
  const fn = param.parent;
  const i = fn.parameters.indexOf(param);
  const out = param.initializer ? resolve(param.initializer, seen) : [];
  if (!ts.isIdentifier(param.name)) return [...out, ...unread(param, `can't read the source ${param.getText()}, a destructured parameter`)];
  const holder = ts.isFunctionDeclaration(fn) || ts.isMethodDeclaration(fn) ? fn : fn.parent;
  const name = holder.name && ts.isIdentifier(holder.name) ? holder.name.text : undefined;
  if (!name) return [...out, ...unread(param, `can't read the source ${param.name.text}: its function has no name to find its calls by`)];
  // A function declared on its own is followed to its own calls; one an object literal holds, to the calls of the
  // member it fills, by name.
  const own = ts.isPropertyAssignment(holder) ? undefined : holder.name && symbolOf(holder.name);
  for (const call of calls.get(name) ?? []) {
    const signature = checker.getResolvedSignature(call);
    if (own ? signature?.declaration !== fn : signature?.parameters[i]?.name !== param.name.text) continue;
    if (call.arguments[i]) out.push(...resolve(call.arguments[i], seen));
  }
  if (own) {
    const passed = (names.get(name) ?? []).find((id) => symbolOf(id) === own && !notValue(id, holder));
    if (passed) out.push(...unread(passed, `can't read the sources ${name} is given: it's passed on as a value here`));
  }
  return out;
}
/** A property's values: what each object literal of its type puts there. */
function fromObjects(symbol, decl, seen) {
  const holds = (node) => {
    const contextual = node && checker.getContextualType(node);
    return (!contextual ? [] : contextual.isUnion() ? contextual.types : [contextual]).some((t) => t.getProperty(symbol.name)?.declarations?.includes(decl));
  };
  const out = [];
  for (const p of props.get(symbol.name) ?? []) {
    // An object literal made without the type counts when its variable is handed over where the type is taken.
    const v = p.parent.parent;
    const handed = ts.isVariableDeclaration(v) && v.initializer === p.parent && ts.isIdentifier(v.name)
      && (names.get(v.name.text) ?? []).some((id) => id !== v.name && symbolOf(id) === symbolOf(v.name) && holds(id));
    if (!holds(p.parent) && !handed) continue;
    out.push(...resolve(ts.isPropertyAssignment(p) ? p.initializer : p.name, seen));
  }
  return out;
}

/** The raises: each call of a `raise`, and each `raise.call(...)` or `raise.apply(...)`, with the arguments it gets. */
const raises = [];
const loose = [];
for (const call of calls.get('raise') ?? []) raises.push({ call, args: call.arguments, signature: checker.getResolvedSignature(call) });
for (const via of ['call', 'apply']) {
  for (const call of calls.get(via) ?? []) {
    if (!ts.isPropertyAccessExpression(call.expression) || nameOf(call.expression.expression) !== 'raise') continue;
    const inner = call.expression.expression;
    const [signature] = checker.getTypeAtLocation(inner).getCallSignatures();
    const listed = via === 'call' ? call.arguments.slice(1) : ts.isArrayLiteralExpression(call.arguments[1] ?? call) ? call.arguments[1].elements : undefined;
    if (listed) raises.push({ call, args: listed, signature });
    else loose.push(`FAIL ask source: ${site(call)}: can't read the arguments ${call.getText()} passes`);
  }
}
// A raise taken as a value must land where it's called as `raise`: a property or variable of that name.
for (const id of [...(names.get('raise') ?? [])]) {
  const access = id.parent;
  if (!(ts.isPropertyAccessExpression(access) && access.name === id)) continue;
  const p = access.parent;
  if ((ts.isCallExpression(p) && p.expression === access) || (ts.isBinaryExpression(p) && p.left === access)) continue;
  if (ts.isPropertyAccessExpression(p) && ['call', 'apply'].includes(p.name.text) && ts.isCallExpression(p.parent)) continue;
  const value = ts.isPropertyAccessExpression(p) && p.name.text === 'bind' && ts.isCallExpression(p.parent) ? p.parent : access;
  const holder = value.parent;
  if ((ts.isPropertyAssignment(holder) || ts.isVariableDeclaration(holder)) && holder.initializer === value && nameOf(holder.name) === 'raise') continue;
  loose.push(`FAIL ask source: ${site(access)}: can't read the sources ${access.getText()} is given: it's passed on as a value here`);
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
for (const { call, args, signature } of raises) {
  // A raise the checker can't type might take any source, so it isn't passed over.
  if (!signature || checker.getTypeAtLocation(call.expression).flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) {
    findings.set(site(call), `FAIL ask source: ${site(call)}: can't read what ${call.expression.getText()} takes\n  Fix: give the object it's called on a type`);
    continue;
  }
  const i = signature.parameters.findIndex((p) => p.name === 'source');
  if (i < 0 || !args[i]) continue;
  for (const { value, at: from, why } of resolve(args[i], new Set())) {
    // One finding per place a source is written, however many raises it reaches: the raise on its own line if it has one.
    const key = `${value ?? why}@${from}`;
    if (findings.has(key) && from !== site(call)) continue;
    if (!findings.has(key)) count++;
    const raised = from === site(call) ? '' : ` (raised at ${site(call)})`;
    if (value === undefined) findings.set(key, `FAIL ask source: ${from}: ${why}${raised}\n  Fix: pass raise a literal, a constant or a value of a literal type`);
    else findings.set(key, fits(value) ? undefined : `FAIL ask source: ${from}: ${value} has no row in packages/asks/sources.json${raised}\n  Fix: add its row to packages/asks/sources.json, with a fixture of its ask`);
  }
}
const failed = [...new Set([...loose, ...findings.values()])].filter(Boolean);
console.log(failed.length ? failed.join('\n') : `PASS ask source: ${count} sources passed to raise, each with its row`);
process.exitCode = failed.length ? 1 : 0;
