// The ask-source guard (#1829) over a planted package: a source reached through a parameter or a property is read
// where its caller or object literal writes it, and one it can't read, or a raise it can't type, fails, never passes.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const guard = new URL('../scripts/ask-sources-guard.mjs', import.meta.url).pathname;
const run = (source) => {
  const root = mkdtempSync(join(tmpdir(), 'ask-sources-'));
  try {
    mkdirSync(join(root, 'packages/asks'), { recursive: true });
    writeFileSync(join(root, 'packages/asks/sources.json'), JSON.stringify(['a.yes', 'b.one', 'b.two', 'p.yes'].map((s) => ({ source: s }))));
    mkdirSync(join(root, 'packages/hub/src'), { recursive: true });
    writeFileSync(join(root, 'packages/hub/package.json'), '{"name":"@deepbuild/hub"}');
    writeFileSync(join(root, 'packages/hub/src/x.ts'), source.join('\n'));
    const ran = spawnSync(process.execPath, [guard, '--root', root], { encoding: 'utf8' });
    return { code: ran.status, fails: ran.stdout.split('\n').filter((l) => l.startsWith('FAIL')) };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};
const HEAD = [
  'interface Asks { raise(c: object, source: string, a: object): Promise<string> }',
  'interface About { source: string }',
  'declare const asks: Asks;',
];

test('sources read through parameters, properties and typed templates pass when they have rows', () => {
  const { code, fails } = run([
    ...HEAD,
    'const yours = (source: string) => asks.raise({}, source, {});',
    'const asked = (about: About) => asks.raise({}, about.source, {});',
    'const each = (n: \'one\' | \'two\') => asks.raise({}, `b.${n}`, {});',
    'void yours(\'a.yes\'); void asked({ source: \'p.yes\' }); void each(\'one\');',
  ]);
  assert.deepEqual(fails, []);
  assert.equal(code, 0);
});

test('a row-less source is named where its caller writes it; an unread source and an untyped raise fail', () => {
  const { code, fails } = run([
    ...HEAD,
    'const yours = (source: string) => asks.raise({}, source, {});',
    'const asked = (about: About) => asks.raise({}, about.source, {});',
    'void yours(\'a.no\'); void asked({ source: \'p.no\' });',
    'export const loose = (k: string) => asks.raise({}, k, {});',
    'export const untyped = (x: any) => x.raise({}, \'a.yes\', {});',
  ]);
  assert.equal(code, 1);
  assert.deepEqual(fails, [
    'FAIL ask source: packages/hub/src/x.ts:6: a.no has no row in packages/asks/sources.json (raised at packages/hub/src/x.ts:4)',
    'FAIL ask source: packages/hub/src/x.ts:6: p.no has no row in packages/asks/sources.json (raised at packages/hub/src/x.ts:5)',
    'FAIL ask source: packages/hub/src/x.ts:7: can\'t read the source k',
    'FAIL ask source: packages/hub/src/x.ts:8: can\'t read what x.raise takes',
  ]);
});
