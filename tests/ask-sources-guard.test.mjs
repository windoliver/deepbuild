// The ask-source guard (#1829) over a planted package: a source reached through a parameter, a property or a variable
// is read wherever it's set, and one it can't read, a raise it can't type, and a raise or a source's function passed
// on as a value fail, never pass.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

const guard = new URL('../scripts/ask-sources-guard.mjs', import.meta.url).pathname;
const HEAD = [
  'interface Asks { raise(c: object, source: string, a: object): Promise<string> }',
  'interface About { source: string }',
  'declare const asks: Asks;',
];
/** The guard over `packages/hub/src/x.ts` (HEAD, then `lines`), and any other files planted beside it. */
const run = (lines, others = {}) => {
  const root = mkdtempSync(join(tmpdir(), 'ask-sources-'));
  try {
    const files = { 'packages/asks/sources.json': JSON.stringify(['a.yes', 'b.one', 'b.two', 'p.yes'].map((s) => ({ source: s }))), 'packages/hub/package.json': '{"name":"@deepbuild/hub"}', 'packages/hub/src/x.ts': [...HEAD, ...lines].join('\n'), ...others };
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    const ran = spawnSync(process.execPath, [guard, '--root', root], { encoding: 'utf8' });
    return { code: ran.status, fails: ran.stdout.split('\n').filter((l) => l.startsWith('FAIL')) };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

test('sources read through parameters, properties, variables and typed templates pass when they have rows', () => {
  const { code, fails } = run([
    'const yours = (source: string) => asks.raise({}, source, {});',
    'const asked = (about: About) => asks.raise({}, about.source, {});',
    'const each = (n: \'one\' | \'two\') => asks.raise({}, `b.${n}`, {});',
    'void yours(\'a.yes\'); void asked({ source: \'p.yes\' }); void each(\'one\');',
    'class Field { private source = \'a.yes\'; go() { return asks.raise({}, this.source, {}); } }',
    'export function named(source: string) { return asks.raise({}, source, {}); }',
    'void Field; void named(\'a.yes\');',
  ], {
    // A function of the same name elsewhere passes nothing to this one.
    'packages/budget/src/y.ts': 'export function named(source: string) { return source.length; }\nvoid named(\'not.a_source\');\n',
  });
  assert.deepEqual(fails, []);
  assert.equal(code, 0);
});

test('a row-less source is named where it is set; an unread source, an untyped raise and a raise passed on fail', () => {
  const { code, fails } = run([
    'const yours = (source: string) => asks.raise({}, source, {});',
    'const asked = (about: About) => asks.raise({}, about.source, {});',
    'void yours(\'a.no\'); void asked({ source: \'p.no\' });',
    'export const loose = (k: string) => asks.raise({}, k, {});',
    'export const untyped = (x: any) => x.raise({}, \'a.yes\', {});',
    'export const bare = (k: string) => asks.raise({}, `${k}.${k}`, {});',
    'void asks[\'raise\']({}, \'el.no\', {}); void asks.raise.call(asks, {}, \'call.no\', {});',
    'export const bound = asks.raise.bind(asks);',
    'void [\'a.yes\'].map(yours);',
    'const made = { source: \'made.no\' }; void asked(made);',
    'let later = \'a.yes\'; later = \'later.no\'; void asks.raise({}, later, {});',
  ], {
    'packages/jobs/z/index.ts': `${HEAD.join('\n')}\nvoid asks.raise({}, 'outside.no', {});\n`,
  });
  assert.equal(code, 1);
  assert.deepEqual(fails.sort(), [
    'FAIL ask source: packages/hub/src/x.ts:11: can\'t read the sources asks.raise is given: it\'s passed on as a value here',
    'FAIL ask source: packages/hub/src/x.ts:12: can\'t read the sources yours is given: it\'s passed on as a value here (raised at packages/hub/src/x.ts:4)',
    'FAIL ask source: packages/hub/src/x.ts:6: a.no has no row in packages/asks/sources.json (raised at packages/hub/src/x.ts:4)',
    'FAIL ask source: packages/hub/src/x.ts:6: p.no has no row in packages/asks/sources.json (raised at packages/hub/src/x.ts:5)',
    'FAIL ask source: packages/hub/src/x.ts:7: can\'t read the source k',
    'FAIL ask source: packages/hub/src/x.ts:8: can\'t read what x.raise takes',
    'FAIL ask source: packages/hub/src/x.ts:9: can\'t read the source `${k}.${k}`',
    'FAIL ask source: packages/hub/src/x.ts:10: el.no has no row in packages/asks/sources.json',
    'FAIL ask source: packages/hub/src/x.ts:10: call.no has no row in packages/asks/sources.json',
    'FAIL ask source: packages/hub/src/x.ts:13: made.no has no row in packages/asks/sources.json (raised at packages/hub/src/x.ts:5)',
    'FAIL ask source: packages/hub/src/x.ts:14: later.no has no row in packages/asks/sources.json',
    'FAIL ask source: packages/jobs/z/index.ts:4: outside.no has no row in packages/asks/sources.json',
  ].sort());
});

test('spread, constant keys, renaming, aliases, interfaces, class fields and casts reach the source or fail', () => {
  const { code, fails } = run([
    'const args = [{}, \'spread.x\', {}] as const; void asks.raise(...args);',
    'const key = \'raise\' as const; void asks[key]({}, \'key.no\', {});',
    'const { raise: renamed } = asks; void renamed;',
    'export function named(source: string) { return asks.raise({}, source, {}); }',
    'void named(\'a.yes\');',
    'interface Go { go(source: string): Promise<string> }',
    'class Goes implements Go { go(source: string) { return asks.raise({}, source, {}); } }',
    'const viaGo: Go = new Goes(); void viaGo.go(\'go.no\');',
    'const asked = (about: About) => asks.raise({}, about.source, {});',
    'class Ab implements About { source = \'field.no\'; } void asked(new Ab());',
    'declare const s: string; void asks.raise({}, <\'a.yes\'>s, {});',
  ], {
    'packages/hub/src/y.ts': 'import { named as other } from \'./x.ts\';\nvoid other(\'alias.no\');\n',
    'packages/conformance/fixtures/f/src/a.mjs': 'export const f = (x) => x.raise();\n',
  });
  assert.equal(code, 1);
  assert.deepEqual(fails, [
    'FAIL ask source: packages/hub/src/x.ts:11: go.no has no row in packages/asks/sources.json (raised at packages/hub/src/x.ts:10)',
    'FAIL ask source: packages/hub/src/x.ts:13: field.no has no row in packages/asks/sources.json (raised at packages/hub/src/x.ts:12)',
    'FAIL ask source: packages/hub/src/x.ts:14: can\'t read the source s',
    'FAIL ask source: packages/hub/src/x.ts:4: can\'t read the source in ...args, spread into asks.raise',
    'FAIL ask source: packages/hub/src/x.ts:5: key.no has no row in packages/asks/sources.json',
    'FAIL ask source: packages/hub/src/x.ts:6: can\'t read the sources raise: renamed is given: raise is renamed here',
    'FAIL ask source: packages/hub/src/y.ts:2: alias.no has no row in packages/asks/sources.json (raised at packages/hub/src/x.ts:7)',
  ]);
});

test('mutations, compound and destructuring assignments, constant keys, constructors and default imports reach the source or fail', () => {
  const { code, fails } = run([
    'declare const x: boolean;',
    'const req = { source: \'a.yes\' }; req.source = \'mut.no\'; void asks.raise({}, req.source, {});',
    'let s = \'a.yes\'; if (x) s += \'.no\'; void asks.raise({}, s, {});',
    'let t = \'a.yes\'; [t] = [\'arr.no\']; void asks.raise({}, t, {});',
    'const K = \'source\' as const; const rr: About = { source: \'a.yes\' }; rr[K] = \'key.no\'; void asks.raise({}, rr.source, {});',
    'const source = \'p.yes\'; const sh = { source }; void asks.raise({}, sh.source, {});',
    'class C { constructor(readonly src: string) {} go() { return asks.raise({}, this.src, {}); } }',
    'void new C(\'ctor.no\'); class D extends C { constructor() { super(\'super.no\'); } } void D;',
    'export default function notify(source: string) { return asks.raise({}, source, {}); }',
    'void notify(\'a.yes\');',
  ], {
    'packages/hub/src/y.ts': 'import n from \'./x.ts\';\nvoid n(\'default.no\');\n',
  });
  assert.equal(code, 1);
  assert.deepEqual(fails, [
    'FAIL ask source: packages/hub/src/x.ts:11: ctor.no has no row in packages/asks/sources.json (raised at packages/hub/src/x.ts:10)',
    'FAIL ask source: packages/hub/src/x.ts:11: super.no has no row in packages/asks/sources.json (raised at packages/hub/src/x.ts:10)',
    'FAIL ask source: packages/hub/src/x.ts:5: mut.no has no row in packages/asks/sources.json',
    'FAIL ask source: packages/hub/src/x.ts:6: can\'t read the source s after s += \'.no\'',
    'FAIL ask source: packages/hub/src/x.ts:7: can\'t read the source t, set by a destructuring assignment',
    'FAIL ask source: packages/hub/src/x.ts:8: key.no has no row in packages/asks/sources.json',
    'FAIL ask source: packages/hub/src/y.ts:2: default.no has no row in packages/asks/sources.json (raised at packages/hub/src/x.ts:12)',
  ]);
});
