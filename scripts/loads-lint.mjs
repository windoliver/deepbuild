// The loads lint (#1830): since #1555 scripts/benchmark.mjs's judgeLimit reads INCONCLUSIVE when a call gives no
// `loads`, the one-minute load at each run's start and end, so a timing suite that leaves them out reads INCONCLUSIVE on
// every machine. Under tests/acceptance and benchmarks/ (whose judges call it too, #2870), each call of judgeLimit with an
// object argument (by name, through a module, through a variable holding it, or inside a string of code a suite runs in a
// child) must give `loads`; a spread in the object may carry it. One `FAIL loads: <path>:<line>: ...` line per call that
// gives none, or one `PASS loads` line; exit 1 on a finding. Planted copies of scripts/ under a twins/ folder aren't suites,
// and an original whose blind redraft has landed (scripts/lanes.mjs `redrafted`) runs by hand only. `--root <dir>` checks
// another checkout, which may have no benchmarks/.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, sep } from 'node:path';
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
const benchmarks = join(root, 'benchmarks');
for (const path of [...files(join(root, 'tests', 'acceptance')), ...(existsSync(benchmarks) ? files(benchmarks) : [])]) {
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

// #3300: a reading a suite makes up and hands to `node benchmarks/canvas.mjs judge` must give each run `loadStart` and
// `loadEnd`, as the judge reads them since #1830, or its verdict reads INCONCLUSIVE on every machine. The suites are the
// files under tests/acceptance that name canvas.mjs and its judge, and the files that import one of them. A made-up
// reading is an object literal giving `runs` beside `task`, `fingerprint` or a spread, whose runs hold an object literal;
// its runs give the loads when `loadStart` and `loadEnd` are written there or in a function or value of the same file
// they use, or when a run spreads another value (a copy of a run read elsewhere).
const suites = files(join(root, 'tests', 'acceptance')).map((path) => ({ path, name: relative(root, path).split(sep).join('/'), text: readFileSync(path, 'utf8') }));
const family = new Set(suites.filter(({ text }) => text.includes('canvas.mjs') && /['"`]judge['"`]/.test(text)).map(({ path }) => path));
for (let grown = true; grown;) {
  grown = false;
  for (const { path, text } of suites) {
    if (family.has(path)) continue;
    const imports = [...text.matchAll(/\bfrom\s+['"](\.{1,2}\/[^'"]+)['"]/g)].map(([, spec]) => join(dirname(path), spec));
    if (imports.some((spec) => family.has(spec))) { family.add(path); grown = true; }
  }
}
const named = (node) => node.name && (ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name)) ? node.name.text : undefined;
for (const { path, name, text } of suites) {
  if (!family.has(path) || (redrafted[name] && existsSync(join(root, redrafted[name])))) continue;
  const source = parse(name, text);
  // Each name's declarations, with the block it is declared in; a use follows the innermost one around it.
  const declared = new Map();
  const walk = (node, visit) => { visit(node); ts.forEachChild(node, (child) => walk(child, visit)); };
  const scopeOf = (node) => { let at = node.parent; while (at && !ts.isBlock(at) && !ts.isSourceFile(at) && !ts.isFunctionLike(at)) at = at.parent; return at ?? source; };
  const declare = (key, body, node) => declared.set(key, [...(declared.get(key) ?? []), { body, scope: scopeOf(node) }]);
  walk(source, (node) => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) declare(node.name.text, node.body, node);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) declare(node.name.text, node.initializer, node);
  });
  const around = (key, use) => {
    const inside = declared.get(key).filter(({ scope }) => scope.getStart(source) <= use.getStart(source) && use.getEnd() <= scope.getEnd());
    return inside.length ? [inside.reduce((a, b) => (b.scope.getWidth(source) < a.scope.getWidth(source) ? b : a))] : declared.get(key);
  };
  /** What the runs hold: an object literal, `loadStart`, `loadEnd`, a spread of another value; through what they use. */
  const reach = (start) => {
    const seen = new Set(), found = { literal: false, loadStart: false, loadEnd: false, copy: false };
    const visit = (node) => {
      if (ts.isObjectLiteralExpression(node)) {
        found.literal = true;
        for (const property of node.properties) {
          if (ts.isSpreadAssignment(property) && !ts.isObjectLiteralExpression(bare(property.expression)) && !ts.isConditionalExpression(bare(property.expression))) found.copy = true;
          const key = named(property);
          if (key === 'loadStart' || key === 'loadEnd') found[key] = true;
        }
      }
      if (ts.isIdentifier(node) && declared.has(node.text) && !seen.has(node.text) && !(ts.isPropertyAssignment(node.parent) && node.parent.name === node) && !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)) {
        seen.add(node.text);
        for (const { body } of around(node.text, node)) walk(body, visit);
      }
    };
    walk(start, visit);
    return found;
  };
  walk(source, (node) => {
    if (!ts.isObjectLiteralExpression(node)) return;
    const runs = node.properties.find((property) => ts.isPropertyAssignment(property) && named(property) === 'runs');
    if (!runs || !node.properties.some((property) => ts.isSpreadAssignment(property) || ['task', 'fingerprint'].includes(named(property)))) return;
    const found = reach(runs.initializer);
    if (found.literal && !found.copy && !(found.loadStart && found.loadEnd)) findings.push([name, lineOf(source, runs.getStart(source)), 'made-up']);
  });
}

if (findings.length) {
  findings.sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x - y));
  for (const [name, line, kind] of findings) console.log(kind === 'made-up' ? `FAIL loads: ${name}:${line}: a made-up reading handed to canvas.mjs judge gives its runs no loadStart and loadEnd` : `FAIL loads: ${name}:${line}: judgeLimit gives no loads`);
  console.log("  Fix: its verdict reads INCONCLUSIVE on every machine. Read os.loadavg()[0] at each run's start and end and pass them as loads, one { start, end } per run; a frozen suite takes a blind redraft that does, named in scripts/lanes.mjs redrafted (#1830).");
  process.exit(1);
}
console.log('PASS loads');
