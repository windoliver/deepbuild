// #1906 AC4: merely loading the child owner must not add a warning or require child-process permission.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const owner = new URL('../dist/children.js', import.meta.url).href;
for (const flags of [
  ['--pending-deprecation'],
  ['--pending-deprecation', '--throw-deprecation'],
  ['--permission', '--allow-fs-read=*'],
]) {
  test(`child owner imports unchanged under ${flags.join(' ')}`, () => {
    const r = spawnSync(process.execPath, [...flags, '--input-type=module', '-e', `await import(${JSON.stringify(owner)});console.log('loaded')`], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, 'loaded\n');
    assert.equal(r.stderr, '');
  });
}
