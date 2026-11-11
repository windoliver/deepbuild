import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, realpathSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { retained } from '../ownership-redraft/source-oracles.mjs';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const CORE = 'packages/hub/src/core.ts';
const entries = [CORE, 'packages/extension-host/src/host.ts', 'packages/asks/src/index.ts'];
const parse = (file, text = readFileSync(resolve(root, file), 'utf8')) => ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
const walk = (node, visit) => { visit(node); ts.forEachChild(node, (child) => { walk(child, visit); }); };
function coreProblems(source) {
  const core = source.statements.find((n) => ts.isClassDeclaration(n) && n.name?.text === 'Core');
  if (!core) return ['Core must remain locally defined in core.ts, not a re-exported monolith'];
  const problems = [];
  if (core.heritageClauses?.some((h) => h.token === ts.SyntaxKind.ExtendsKeyword)) problems.push('Core cannot inherit the extracted monolith');
  walk(source, (n) => {
    // Include constructors, accessors, helper classes and arrow/function-valued class fields.
    const field = ts.isPropertyDeclaration(n) && n.initializer;
    const body = n.body ?? (field && (ts.isArrowFunction(field) || ts.isFunctionExpression(field)) ? field.body : undefined);
    if (body && (ts.isConstructorDeclaration(n) || ts.isMethodDeclaration(n) || ts.isGetAccessor(n) || ts.isSetAccessor(n) || field)) {
      const start = source.getLineAndCharacterOfPosition(body.getStart(source)).line + 1;
      const lines = source.getLineAndCharacterOfPosition(body.end - 1).line + 2 - start;
      if (lines > 100) problems.push(`${n.name?.getText(source) ?? 'constructor'}:${start}: ${lines} body source lines > 100`);
    }
  });
  walk(core, (n) => {
    if (n.kind !== ts.SyntaxKind.ThisKeyword) return;
    const p = n.parent;
    if ((ts.isPropertyAccessExpression(p) || ts.isElementAccessExpression(p)) && p.expression === n) return;
    problems.push(`whole-Core context escapes at line ${source.getLineAndCharacterOfPosition(n.getStart(source)).line + 1}`);
  });
  return problems;
}

test('AC2 #1687.f156a5ac Core is local composition; every method body, including constructor, is <=100 source lines', () => {
  assert.deepEqual(coreProblems(parse(CORE)), [], 'Core retains oversized methods or evades composition');
});
test('AC2 structural oracle rejects oversized constructors/fields, inheritance, relocation and whole-Core mixins', () => {
  for (const [text, expected] of [
    [`class Core { constructor() {\n${'void 0;\n'.repeat(100)}} }`, /constructor.*> 100/],
    [`class Core { hook = () => {\n${'void 0;\n'.repeat(100)}} }`, /hook.*> 100/],
    ['class Core extends Everything {}', /inherit/],
    ["export { Core } from './everything.js';", /re-exported monolith/],
    ['class Core { constructor() { install({ context: this }); } }', /whole-Core/],
  ]) assert.match(coreProblems(parse('fixture.ts', text)).join('\n'), expected);
  assert.deepEqual(coreProblems(parse('fixture.ts', 'class Core { constructor() { this.part = new Part({ read: () => this.record.read() }); } }')), []);
});

// Approved #1687 disposition: the frozen blind redraft identifies actual base algorithms, not
// coincidentally named locals such as `judged` or `runs`. Destination names remain unconstrained.
// Reuse its unchanged oracle and inventory; its oracle.test.mjs qualifies rename/no-op/nested faults.
const ownership = JSON.parse(readFileSync(new URL('../ownership-redraft/base-surfaces.json', import.meta.url), 'utf8'));
for (const { file, surfaces } of ownership.files) {
  test(`AC1/AC2 selected ownership: ${file} retains no base responsibility body`, () => {
    assert.deepEqual(retained(parse(file), surfaces), [], `${file}: selected base algorithms still owned here`);
  });
}

// Runtime dependencies only: type-only syntax is erased, not an execution cycle. Resolve workspace entries,
// relative paths, re-exports, literal dynamic imports and require, recursively (not just core.ts's imports).
function imports(source) {
  const found = [];
  walk(source, (n) => {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && !n.isTypeOnly && !n.importClause?.isTypeOnly) {
      const bindings = n.importClause?.namedBindings ?? n.exportClause;
      if (n.importClause?.name || !bindings || !('elements' in bindings) || !bindings.elements.length || bindings.elements.some((e) => !e.isTypeOnly)) {
        if (n.moduleSpecifier && ts.isStringLiteralLike(n.moduleSpecifier)) found.push(n.moduleSpecifier.text);
      }
    }
    if (ts.isCallExpression(n) && (n.expression.kind === ts.SyntaxKind.ImportKeyword || n.expression.getText(source) === 'require')) {
      if (n.arguments[0] && ts.isStringLiteralLike(n.arguments[0])) found.push(n.arguments[0].text);
    }
  });
  return found;
}
function graph() {
  const edges = new Map();
  const options = { moduleResolution: ts.ModuleResolutionKind.NodeNext, module: ts.ModuleKind.NodeNext, customConditions: ['development'] };
  function add(file) {
    if (edges.has(file)) return;
    const next = []; edges.set(file, next);
    for (const spec of imports(parse(file))) {
      const target = ts.resolveModuleName(spec, resolve(root, file), options, ts.sys).resolvedModule?.resolvedFileName;
      assert.ok(target || !/^(\.|@deepbuild\/)/.test(spec), `unresolved local import: ${file} -> ${spec}`);
      if (!target) continue;
      const path = relative(root, realpathSync(target));
      if (path.startsWith('packages/')) next.push(path);
    }
    for (const dep of next) add(dep);
  }
  entries.forEach(add);
  return edges;
}
function cycleEdges(graph) {
  // Every edge which can return to its source; detects new chords inside an existing cycle too.
  const reaches = (from, to, seen = new Set()) => {
    if (from === to) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    return (graph.get(from) ?? []).some((next) => reaches(next, to, seen));
  };
  return [...graph].flatMap(([from, next]) => next.filter((to) => reaches(to, from)).map((to) => `${from} -> ${to}`)).sort();
}
// The sole runtime cycle reachable at c52f1c66, measured before authoring; not a waiver for another edge.
const baseCycle = new Set(['packages/hub/src/rows.ts -> packages/hub/src/list.ts', 'packages/hub/src/list.ts -> packages/hub/src/rows.ts']);
test('AC3 #1687.2e07fefc recursive module graph introduces no cycle edge beyond the base', () => {
  const cycles = cycleEdges(graph());
  assert.deepEqual(cycles.filter((edge) => !baseCycle.has(edge)), [], `runtime cycle edges:\n${cycles.join('\n')}`);
});
// Concrete extension implementations, not the extension-host or the adapter contract. The design names the
// resolver, env-local and check providers as plug-ins; nested source/channel/job packages are plug-ins too.
const extension = (file) => /^packages\/(?:checks-[^/]+|resolver-decisions|env-local|sources|channels|jobs|pi|paseo)\//.test(file);
test('AC3 #1687.2e07fefc Core and its reachable implementation modules do not import concrete extensions', () => {
  const edges = graph(), seen = new Set(), violations = [];
  function visit(file) {
    if (seen.has(file)) return;
    seen.add(file);
    for (const next of edges.get(file) ?? []) {
      if (extension(next)) violations.push(`${file} -> ${next}`);
      else visit(next);
    }
  }
  visit(CORE);
  assert.deepEqual(violations, [], 'inject extension capabilities at the composition boundary, not into core dependencies');
});
test('AC3 recursive cycle oracle rejects a three-hop cycle and a chord added to a base cycle', () => {
  assert.deepEqual(cycleEdges(new Map([['a', ['b']], ['b', ['c']], ['c', ['a']]])), ['a -> b', 'b -> c', 'c -> a']);
  assert.deepEqual(cycleEdges(new Map([['a', ['b', 'c']], ['b', ['a']], ['c', ['a']]])).filter((e) => !['a -> b', 'b -> a'].includes(e)), ['a -> c', 'c -> a']);
  assert.deepEqual(cycleEdges(new Map([['a', ['b']], ['b', ['c']]])), []);
  assert.deepEqual(imports(parse('fixture.ts', `import type { T } from './type.js'; export { x } from './b.js'; import('./c.js'); require('./d.js');`)), ['./b.js', './c.js', './d.js']);
});
