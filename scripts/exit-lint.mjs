// The one exit table (#1812): every exit a `deep` command can reach, read from the code, holds only exit.code@1's codes,
// 0 to 3. It starts where the CLI and the hub set an exit (`process.exitCode = …`, `process.exit(…)`) and follows each
// value back through the TypeScript checker: a number written there, both arms of a choice, what each called function
// returns, a variable's every assignment, a parameter's argument at every call, an object's field, and what a promise
// is resolved with. A planted wrong program's arm (a condition that reads the plant a test selects) isn't the shipped
// program's. A command that runs another program ends with that program's code, so `deep lease` and `deep mcp-exec` are
// left out by name. Prints the table, one `exit <n> <path>:<line>` line per place, and one `FAIL exits: <path>:<line>: …`
// line per code outside it, or `PASS exits`; exit 1 on a finding. `--root <dir>` reads another checkout's code.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/** The packages whose code a command runs, and where exits are set. */
const PACKAGES = ['cli', 'hub', 'reading', 'conformance'];
/** The commands that end with the code of the program they run, by the function that runs each. */
const RUNS_ANOTHER = { leaseCommand: 'deep lease', mcpExecCommand: 'deep mcp-exec' };
const MEANING = ['done', 'failed or refused', 'not understood, nothing ran', 'not decided or not checked'];

const at = process.argv.indexOf('--root');
if (at !== -1 && (!process.argv[at + 1] || process.argv[at + 1].startsWith('--'))) {
  console.log('BLOCKED exits: --root takes a folder\n  Fix: node scripts/exit-lint.mjs [--root <checkout>]');
  process.exit(2);
}
const root = at === -1 ? fileURLToPath(new URL('../', import.meta.url)) : process.argv[at + 1];
const codes = JSON.parse(readFileSync(join(root, 'packages/contracts/schemas/exit.code@1.json'), 'utf8')).enum.map(Number);

const sources = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? sources(path) : name.endsWith('.ts') && !name.endsWith('.d.ts') ? [path] : [];
});
// Each package by its source, as its package.json's `types` condition names it, so a checkout with no node_modules reads too.
const paths = {};
for (const name of PACKAGES) {
  const exports = JSON.parse(readFileSync(join(root, 'packages', name, 'package.json'), 'utf8')).exports ?? {};
  for (const [sub, target] of Object.entries(exports)) if (target?.types) paths[`@deepbuild/${name}${sub.slice(1)}`] = [join(root, 'packages', name, target.types)];
}
const files = PACKAGES.flatMap((name) => sources(join(root, 'packages', name, 'src')));
const program = ts.createProgram(files, { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, strict: true, noEmit: true, skipLibCheck: true, allowImportingTsExtensions: true, types: [], baseUrl: root, paths });
const checker = program.getTypeChecker();
const ours = (node) => !node.getSourceFile().isDeclarationFile && !node.getSourceFile().fileName.includes('/node_modules/');
const place = (node) => `${relative(root, node.getSourceFile().fileName)}:${node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1}`;

// ---- Calls, indexed by the function each reaches, so a parameter's values are its arguments.
const callsTo = new Map();
/** The functions a callee can be: both arms of a choice, and each function of a union, as a table of commands by name is. */
function functionsOf(callee) {
  if (ts.isParenthesizedExpression(callee)) return functionsOf(callee.expression);
  if (ts.isConditionalExpression(callee)) return [...functionsOf(callee.whenTrue), ...functionsOf(callee.whenFalse)];
  const type = checker.getTypeAtLocation(callee);
  return (type.isUnion() ? type.types : [type]).flatMap((t) => t.getCallSignatures().map((s) => s.declaration).filter((d) => d && !ts.isJSDocSignature(d)));
}
const declarationsOf = (call) => {
  const all = functionsOf(call.expression);
  if (all.length < 2) {
    const found = checker.getResolvedSignature(call)?.declaration;
    if (found && !ts.isJSDocSignature(found)) return [found];
  }
  return all;
};
for (const file of program.getSourceFiles().filter((f) => ours(f))) {
  ts.forEachChild(file, function visit(node) {
    if (ts.isCallExpression(node)) for (const d of declarationsOf(node)) callsTo.set(d, [...(callsTo.get(d) ?? []), node]);
    ts.forEachChild(node, visit);
  });
}
/** What a call runs: the functions it names, and for a function passed in as a parameter, each one passed at a call. */
function calleesOf(call) {
  let callee = call.expression;
  while (ts.isParenthesizedExpression(callee) || ts.isAwaitExpression(callee)) callee = callee.expression;
  const decl = ts.isIdentifier(callee) ? checker.getSymbolAtLocation(callee)?.valueDeclaration : undefined;
  if (decl && ts.isParameter(decl) && ts.isFunctionLike(decl.parent)) {
    const index = decl.parent.parameters.indexOf(decl);
    return (callsTo.get(decl.parent) ?? []).flatMap((c) => (!c.arguments[index] ? [] : ts.isFunctionLike(c.arguments[index]) ? [c.arguments[index]] : functionsOf(c.arguments[index])));
  }
  return declarationsOf(call);
}

// ---- Plants: a test selects one through these reads, and the arm it takes isn't the shipped program.
const PLANT = /\b(?:activePlant|plant)\(\)|DEEP_(?:HUB|CLI)_PLANT/;
/** For a condition that reads a plant: true when its `then` arm is the planted program's, false for its `else` arm. */
function plantedArm(condition) {
  const text = condition.getText();
  if (!PLANT.test(text)) return undefined;
  return /(?:\)|PLANT)\s*===/.test(text) ? true : /(?:\)|PLANT)\s*!==/.test(text) ? false : undefined;
}
/** Whether `node` sits in an arm a plant selects, up to its function. */
function planted(node) {
  for (let n = node; n && !ts.isFunctionLike(n); n = n.parent) {
    const p = n.parent;
    if (p && ts.isIfStatement(p) && p.thenStatement === n && plantedArm(p.expression) === true) return true;
    if (p && ts.isIfStatement(p) && p.elseStatement === n && plantedArm(p.expression) === false) return true;
  }
  return false;
}

// ---- The values an expression can take: numbers with their place, and object literals whose fields are read.
const left = new Set();
const seen = new Map();
function values(node) {
  if (!node) return [];
  if (seen.has(node)) return seen.get(node);
  seen.set(node, []);
  const out = valuesOf(node);
  seen.set(node, out);
  return out;
}
function valuesOf(node) {
  if (ts.isNumericLiteral(node)) return [{ code: Number(node.text), node }];
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)) return [{ code: -Number(node.operand.text), node }];
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node) || ts.isAwaitExpression(node)) return values(node.expression);
  if (ts.isConditionalExpression(node)) {
    const arm = plantedArm(node.condition);
    return [...(arm === true ? [] : values(node.whenTrue)), ...(arm === false ? [] : values(node.whenFalse))];
  }
  if (ts.isBinaryExpression(node)) {
    const op = node.operatorToken.kind;
    if ([ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(op)) return [...values(node.left), ...values(node.right)];
    if (op === ts.SyntaxKind.CommaToken || op === ts.SyntaxKind.EqualsToken) return values(node.right);
    return [];
  }
  if (ts.isObjectLiteralExpression(node)) return [{ object: node }];
  if (ts.isPropertyAccessExpression(node)) {
    return values(node.expression).filter((v) => v.object).flatMap((v) => v.object.properties.filter((p) => p.name?.getText() === node.name.text).flatMap((p) => values(ts.isShorthandPropertyAssignment(p) ? p.name : p.initializer)));
  }
  if (ts.isIdentifier(node)) return identifierValues(node);
  if (ts.isNewExpression(node) && node.expression.getText() === 'Promise') return resolvedWith(node.arguments?.[0]);
  if (ts.isCallExpression(node)) return calleesOf(node).filter(ours).flatMap((d) => returned(d));
  return [];
}
function identifierValues(id) {
  const symbol = ts.isShorthandPropertyAssignment(id.parent) && id.parent.name === id ? checker.getShorthandAssignmentValueSymbol(id.parent) : checker.getSymbolAtLocation(id);
  const decl = symbol?.valueDeclaration;
  if (!decl || !ours(decl)) return [];
  if (ts.isVariableDeclaration(decl)) {
    // Its first value and every later assignment in its scope.
    const scope = decl.parent?.parent?.parent ?? decl.getSourceFile();
    const assigned = [];
    ts.forEachChild(scope, function visit(n) {
      if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(n.left) && checker.getSymbolAtLocation(n.left) === symbol) assigned.push(...values(n.right));
      ts.forEachChild(n, visit);
    });
    return [...values(decl.initializer), ...assigned];
  }
  if (ts.isParameter(decl) && ts.isFunctionLike(decl.parent)) {
    const index = decl.parent.parameters.indexOf(decl);
    return [...(callsTo.get(decl.parent) ?? []).flatMap((call) => values(call.arguments[index])), ...values(decl.initializer)];
  }
  if (ts.isBindingElement(decl)) return [];
  return [];
}
/** What a function returns: each `return`'s values, or an arrow's body, unless it runs another program. */
function returned(fn) {
  const name = fn.name?.getText() ?? (ts.isVariableDeclaration(fn.parent) ? fn.parent.name.getText() : undefined);
  if (name && Object.hasOwn(RUNS_ANOTHER, name)) {
    left.add(RUNS_ANOTHER[name]);
    return [];
  }
  if (!fn.body) return [];
  if (!ts.isBlock(fn.body)) return values(fn.body);
  const out = [];
  ts.forEachChild(fn.body, function visit(n) {
    if (ts.isFunctionLike(n)) return;
    if (ts.isReturnStatement(n) && !planted(n)) out.push(...values(n.expression));
    ts.forEachChild(n, visit);
  });
  return out;
}
/** What `new Promise(executor)` resolves with: each call of its executor's first parameter. */
function resolvedWith(executor) {
  if (!executor || !ts.isFunctionLike(executor) || !executor.parameters[0]) return [];
  const resolve = checker.getSymbolAtLocation(executor.parameters[0].name);
  const out = [];
  ts.forEachChild(executor.body, function visit(n) {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && checker.getSymbolAtLocation(n.expression) === resolve) out.push(...values(n.arguments[0]));
    ts.forEachChild(n, visit);
  });
  return out;
}

// ---- Where an exit is set, and the table.
const table = new Map();
for (const file of program.getSourceFiles().filter((f) => ours(f) && files.includes(f.fileName))) {
  ts.forEachChild(file, function visit(node) {
    const set = ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && node.left.getText() === 'process.exitCode' ? node.right
      : ts.isCallExpression(node) && node.expression.getText() === 'process.exit' ? node.arguments[0] : undefined;
    // Keyed by place and code, so two codes written on one line are two rows.
    if (set && !planted(node)) for (const v of values(set)) if (v.code !== undefined) table.set(`${place(v.node)} ${v.code}`, [place(v.node), v.code]);
    ts.forEachChild(node, visit);
  });
}
const rows = [...table.values()].sort(([a, x], [b, y]) => a.localeCompare(b, 'en', { numeric: true }) || x - y);
console.log(`The exits a deep command can reach, read from the code; exit.code@1 holds ${codes.join(', ')}:`);
for (const [where, code] of rows) console.log(`exit ${code} ${where}  ${MEANING[code] ?? 'outside the table'}`);
console.log(`Left out by name, ending with the code of the program they run: ${[...left].sort().join(', ') || 'none'}`);
const wrong = rows.filter(([, code]) => !codes.includes(code));
for (const [where, code] of wrong) console.log(`FAIL exits: ${where}: a command can exit ${code}, which exit.code@1 doesn't hold\n  Fix: exit with 0 done, 1 failed or refused, 2 not understood, nothing ran, or 3 not decided or not checked`);
if (!rows.length) console.log('FAIL exits: no exit was read from the code, so the table proves nothing');
if (wrong.length || !rows.length) process.exit(1);
console.log(`PASS exits: ${rows.length} rows, each ${codes.join(', ')}`);
