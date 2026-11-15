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
