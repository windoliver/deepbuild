import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { BASE, boundary, cyclicEdges, graph, imports, newCycles, snapshot } from './graph.mjs';
import { changedSnapshot, completeReview, review, reviewedGraph } from './reviewed-loaders.mjs';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const base = reviewedGraph(snapshot(root, BASE), review.base);
const currentSnapshot = snapshot(root);
const current = reviewedGraph(currentSnapshot);
const empty = (values, message) => assert.deepEqual(values, [], message);
const complete = (value) => empty(value.unresolved, 'BLOCKED: unresolved literal module dependencies');
const noCycles = (before, after, runtimeOnly) => empty(newCycles(before, after, runtimeOnly), 'AC3: new cyclic module edges');
const noExtensions = (value) => {
  const result = boundary(value);
  empty(result.unclassified, 'BLOCKED: package role needs classification from the design');
  empty(result.violations, 'AC3: the core never imports an extension (including through helpers or types)');
};
const fixture = (files) => graph({ paths: new Set(Object.keys(files)), texts: new Map(Object.entries(files)) });
const modulePath = (name) => `packages/hub/src/${name}.ts`;
const sourceGraph = (links) => fixture(Object.fromEntries(Object.entries(links).map(([from, targets]) =>
  [modulePath(from), targets.map((to) => `import './${to}.js';`).join('\n')])));

// These qualification tests assert that the very same acceptance assertions reject planted wrong programs.
test('oracle: syntax forms retain runtime and type-only dependency edges', () => {
  const rows = imports('packages/hub/src/core.ts', `
    // import './not-an-edge.js';
    const prose = "import './also-not-an-edge.js'";
    import './side.js';
    import type { A } from './types.js';
    import { type B } from './inline.js';
    export type { C } from './export-type.js';
    export { type D } from './export-inline.js';
    export * from './barrel.js';
    type E = import('./query.js').E;
    import F = require('./equals.cjs');
    require('./require.cjs');
    import(\`./dynamic.js\`);
    import(variable);
  `);
  assert.deepEqual(rows.edges.map(({ spec, runtime }) => [spec, runtime]), [
    ['./side.js', true], ['./types.js', false], ['./inline.js', true], ['./export-type.js', false],
    ['./export-inline.js', true], ['./barrel.js', true], ['./query.js', false], ['./equals.cjs', true],
    ['./require.cjs', true], ['./dynamic.js', true],
  ]);
  assert.equal(rows.unknown.length, 1);
  assert.throws(() => empty(rows.unknown, 'BLOCKED: computed imports'), /BLOCKED: computed imports/);
  assert.throws(() => complete(fixture({ [modulePath('core')]: "import './missing.js';" })), /BLOCKED: unresolved/);
});

test('oracle: module cycles, not package dependency cycles; unchanged and removed cycles are not new', () => {
  const before = sourceGraph({ core: ['a'], a: ['b'], b: ['core'] });
  noCycles(before, before, true);
  noCycles(before, sourceGraph({ core: ['a'], a: ['b'], b: [] }), true);
  const chord = sourceGraph({ core: ['a', 'b'], a: ['b'], b: ['core'] });
  assert.deepEqual(newCycles(before, chord, true), [`${modulePath('core')} -> ${modulePath('b')}`]);
  assert.throws(() => noCycles(before, chord, true), /AC3: new cyclic/);
  const acyclic = sourceGraph({ core: ['a'], a: ['b'], b: [] });
  assert.equal(newCycles(acyclic, before, true).length, 3); // Old edges newly on a cycle also count.
  assert.throws(() => noCycles(acyclic, before, true), /AC3: new cyclic/);
  assert.throws(() => noCycles(sourceGraph({ core: [] }), sourceGraph({ core: ['core'] }), true), /AC3: new cyclic/);
});

test('oracle: type-only cycle is architectural, and changing it to runtime creates a runtime cycle', () => {
  const files = { [modulePath('core')]: "import type { A } from './a.js';", [modulePath('a')]: "export type { B } from './core.js';" };
  const typed = fixture(files), before = fixture({ [modulePath('core')]: '', [modulePath('a')]: '' });
  noCycles(before, typed, true);
  assert.throws(() => noCycles(before, typed, false), /AC3: new cyclic/);
  const runtime = fixture({ [modulePath('core')]: "import './a.js';", [modulePath('a')]: "export * from './core.js';" });
  noCycles(typed, runtime, false);
  assert.throws(() => noCycles(typed, runtime, true), /AC3: new cyclic/);
});

test('oracle: boundary rejects direct, type, dynamic, require, re-export and concealed extension imports', () => {
  const manifest = JSON.stringify({ name: '@deepbuild/resolver-decisions', exports: { '.': {
    types: './src/index.ts', development: './src/index.ts', default: './dist/index.js',
  }, './rule': { types: './src/rule.ts', default: './dist/rule.js' } } });
  const files = { 'packages/resolver-decisions/package.json': manifest,
    'packages/resolver-decisions/src/index.ts': 'export const value = 1;',
    'packages/resolver-decisions/src/rule.ts': 'export type Rule = string;',
    [modulePath('core')]: "import './helper.js';", [modulePath('helper')]: '' };
  noExtensions(fixture(files));
  for (const text of [
    'import "@deepbuild/resolver-decisions";', 'import type { Rule } from "@deepbuild/resolver-decisions/rule";',
    'export * from "@deepbuild/resolver-decisions";', 'import("@deepbuild/resolver-decisions");',
    'require("@deepbuild/resolver-decisions");', 'type T = import("@deepbuild/resolver-decisions").T;',
    'import "../../resolver-decisions/src/index.js";',
  ]) for (const importer of [modulePath('core'), modulePath('helper'), 'packages/asks/src/index.ts', 'packages/extension-host/src/index.ts']) {
    const planted = fixture({ ...files, [importer]: text }); complete(planted);
    assert.throws(() => noExtensions(planted), /AC3: the core never imports an extension/, `${importer}: ${text}`);
  }
  // Different files in different packages can form a cycle even though a scan of relative imports alone misses it.
  const reverse = fixture({ ...files, [modulePath('core')]: 'import "@deepbuild/resolver-decisions";',
    'packages/resolver-decisions/src/index.ts': "import '../../hub/src/core.js';" });
  assert.throws(() => noCycles(fixture(files), reverse, true), /AC3: new cyclic/);
  const fresh = fixture({ ...files, 'packages/new-part/package.json': '{"name":"@deepbuild/new-part"}' });
  assert.throws(() => noExtensions(fresh), /BLOCKED: package role/);
});

test('oracle: all directed three-node graphs agree with an independent transitive-closure oracle', () => {
  // Exhaustive (512 cases), stronger than a random sample for this finite world, including self-loops.
  for (let mask = 0; mask < 512; mask++) {
    const names = ['core', 'a', 'b'];
    const matrix = names.map((_, i) => names.map((_, j) => Boolean(mask & (1 << (i * 3 + j)))));
    const closure = matrix.map((row) => [...row]);
    for (let k = 0; k < 3; k++) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) closure[i][j] ||= closure[i][k] && closure[k][j];
    const expected = names.flatMap((from, i) => names.flatMap((to, j) => matrix[i][j] && closure[j][i] ? [`${modulePath(from)} -> ${modulePath(to)}`] : []));
    const planted = sourceGraph(Object.fromEntries(names.map((name, i) => [name, names.filter((_, j) => matrix[i][j])])));
    assert.deepEqual([...cyclicEdges(planted, true)].sort(), expected.sort(), `graph mask ${mask}`);
  }
});

test('AC3: no new runtime import cycle against the pinned issue base', (t) => {
  complete(base); complete(current);
  t.diagnostic(`base=${BASE}; modules=${base.nodes.size}/${current.nodes.size}; runtime cyclic edges=${cyclicEdges(base, true).size}/${cyclicEdges(current, true).size}`);
  noCycles(base, current, true);
});
test('AC3: no new type-inclusive import cycle against the pinned issue base', (t) => {
  complete(base); complete(current);
  t.diagnostic(`type-inclusive cyclic edges=${cyclicEdges(base, false).size}/${cyclicEdges(current, false).size}`);
  noCycles(base, current, false);
});
test('AC3: the core never imports an extension, with no baseline waiver', (t) => {
  complete(current);
  t.diagnostic(`base forbidden edges=${boundary(base).violations.length}; current forbidden edges=${boundary(current).violations.length}`);
  noExtensions(current);
});
test('AC3 completeness: every computed loader matches its independently reviewed input and boundary', (t) => {
  t.diagnostic(`external dependency edges (not traversed): ${current.outside.length}; reviewed computed loaders: ${current.unknown.length}`);
  completeReview(current);
});

test('oracle: reviewed loaders reject unreviewed, mutated, escaping and core-hidden paths', () => {
  completeReview(current); // A refusal of every snapshot would not qualify this oracle.
  const core = modulePath('core');
  const host = 'packages/extension-host/src/host.ts';
  const hostSource = currentSnapshot.texts.get(host);
  const escaping = hostSource.replace("join(ext.folder, 'tests')", "join(ext.folder, '..')");
  assert.notEqual(escaping, hostSource, 'path-escape mutant was actually planted');
  for (const [file, text] of [
    [modulePath('unreviewed'), 'export const load = (name) => import(name);'],
    [host, hostSource.replace('import(url)', 'import(url + "/unreviewed.js")')],
    [host, escaping],
    [core, `${currentSnapshot.texts.get(core)}\nimport './hub-runtime.js';`],
    [core, `${currentSnapshot.texts.get(core)}\nconst hidden = (module) => import(module);`],
    [core, currentSnapshot.texts.get(core).replace('this.options.index)', "'../../resolver-decisions/src/index.js')")],
  ]) {
    const mutant = reviewedGraph(changedSnapshot(currentSnapshot, file, text));
    assert.throws(() => completeReview(mutant), /BLOCKED: computed loader review/, file);
  }
  assert.throws(() => completeReview(base), /BLOCKED: computed loader review/, 'base arbitrary core loaders are not grandfathered');
  assert.ok(current.edges.some((e) => e.from === modulePath('mcp') && e.to === modulePath('mcp')), 'whole-hub plant contributes its self-cycle');
  assert.ok(current.outside.some((e) => e.from === 'packages/pi/src/index.ts' && e.spec === '@earendil-works/pi-coding-agent'), 'cast constant contributes a literal edge');
});
