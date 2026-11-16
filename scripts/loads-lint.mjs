// The loads lint (#1830): since #1555 scripts/benchmark.mjs's judgeLimit reads INCONCLUSIVE when a call gives no
// `loads`, the one-minute load at each run's start and end, so a timing suite that leaves them out reads INCONCLUSIVE on
// every machine. Under tests/acceptance, each call of judgeLimit with an object argument (by name, through a module, through
// a variable holding it, or inside a string of code a suite runs in a child) must give `loads`; a spread in the object may
// carry it. One `FAIL loads: <path>:<line>: ...` line per call that gives none, or one `PASS loads` line; exit 1 on a
// finding. Planted copies of scripts/ under a twins/ folder aren't suites, and an original whose blind redraft has landed
// (scripts/lanes.mjs `redrafted`) runs by hand only. `--root <dir>` checks another checkout.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { redrafted } from './lanes.mjs';

const ts = createRequire(import.meta.url)('typescript');

const at = process.argv.indexOf('--root');
if (at !== -1 && (!process.argv[at + 1] || process.argv[at + 1].startsWith('--'))) {
  console.log('BLOCKED loads: --root takes a folder\n  Fix: node scripts/loads-lint.mjs [--root <checkout>]');
  process.exit(2);
}
const root = at === -1 ? fileURLToPath(new URL('../', import.meta.url)) : process.argv[at + 1];

const files = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const path = join(dir, entry.name);
  if (entry.isDirectory()) return ['node_modules', 'twins'].includes(entry.name) ? [] : files(path);
  return /\.[cm]?[jt]sx?$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [path] : [];
});

/** The expression under parentheses, `await`, `!` and type assertions. */
const bare = (node) => {
  while (ts.isParenthesizedExpression(node) || ts.isAwaitExpression(node) || ts.isNonNullExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isTypeAssertionExpression(node)) node = node.expression;
  return node;
};

/** Whether an expression yields judgeLimit: its name or an alias, a module's member, or a loader called with nothing. */
function isJudge(node, aliases) {
  node = bare(node);
  if (ts.isIdentifier(node)) return node.text === 'judgeLimit' || aliases.has(node.text);
  if (ts.isPropertyAccessExpression(node)) return node.name.text === 'judgeLimit';
  if (ts.isElementAccessExpression(node)) return ts.isStringLiteralLike(node.argumentExpression) && node.argumentExpression.text === 'judgeLimit';
  return ts.isCallExpression(node) && node.arguments.length === 0 && isJudge(node.expression, aliases);
}

/** The calls in a source that give judgeLimit an object with neither `loads` nor a spread, and the string literals in it. */
function scan(source) {
  const aliases = new Set();
  const walk = (node, visit) => { visit(node); ts.forEachChild(node, (child) => walk(child, visit)); };
  walk(source, (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && isJudge(node.initializer, aliases)) aliases.add(node.name.text);
    if (ts.isBindingElement(node) && ts.isIdentifier(node.name) && node.propertyName && ts.isIdentifier(node.propertyName) && node.propertyName.text === 'judgeLimit') aliases.add(node.name.text);
  });
  const calls = [], strings = [];
  walk(source, (node) => {
    if (ts.isStringLiteralLike(node) || ts.isTemplateExpression(node)) strings.push(node);
    if (!ts.isCallExpression(node) || !node.arguments.length || !isJudge(node.expression, aliases)) return;
    const argument = bare(node.arguments[0]);
    if (!ts.isObjectLiteralExpression(argument)) return;
    const gives = argument.properties.some((property) => ts.isSpreadAssignment(property)
      || ((ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name)) && property.name.text === 'loads'));
    if (!gives) calls.push(node);
  });
  return { calls, strings };
}

const parse = (name, text) => ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, /\.[cm]?jsx?$/.test(name) ? ts.ScriptKind.JS : ts.ScriptKind.TS);
const lineOf = (source, position) => source.getLineAndCharacterOfPosition(position).line + 1;
const count = (text, word) => text.split(word).length - 1;

const findings = [];
for (const path of files(join(root, 'tests', 'acceptance'))) {
  const name = relative(root, path).split(sep).join('/');
  if (redrafted[name] && existsSync(join(root, redrafted[name]))) continue;
  const text = readFileSync(path, 'utf8');
  if (!text.includes('judgeLimit')) continue;
  const source = parse(name, text);
  const { calls, strings } = scan(source);
  for (const call of calls) findings.push([name, lineOf(source, call.getStart(source))]);
  // Code a suite runs in a child: the string as the child reads it, each call placed at the same occurrence of the
  // name in the string as written.
  for (const literal of strings) {
    const code = ts.isTemplateExpression(literal) ? literal.head.text + literal.templateSpans.map((span) => `0${span.literal.text}`).join('') : literal.text;
    if (!code.includes('judgeLimit')) continue;
    const inner = parse('child.mjs', code);
    const written = literal.getText(source);
    for (const call of scan(inner).calls) {
      const nth = count(code.slice(0, call.expression.getEnd()), 'judgeLimit');
      let index = -1;
      for (let i = 0; i < nth; i++) index = written.indexOf('judgeLimit', index + 1);
      findings.push([name, lineOf(source, literal.getStart(source) + Math.max(index, 0))]);
    }
  }
}

if (findings.length) {
  findings.sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x - y));
  for (const [name, line] of findings) console.log(`FAIL loads: ${name}:${line}: judgeLimit gives no loads`);
  console.log("  Fix: its verdict reads INCONCLUSIVE on every machine. Read os.loadavg()[0] at each run's start and end and pass them as loads, one { start, end } per run; a frozen suite takes a blind redraft that does, named in scripts/lanes.mjs redrafted (#1830).");
  process.exit(1);
}
console.log('PASS loads');
