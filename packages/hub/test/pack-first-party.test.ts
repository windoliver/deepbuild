// #1720: the canvas core lists a `deepbuild/` pack as first-party, so that owner is the release's own. A release pack
// that names only its `name` is read as `deepbuild/<name>`; a pack from anywhere else under that owner is refused.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { readPack } from '../src/packs.js';

const dir = mkdtempSync(join(tmpdir(), 'pack-first-party-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const folder = (name: string, manifest: object): string => {
  const at = join(dir, name);
  mkdirSync(at);
  writeFileSync(join(at, 'pack.json'), JSON.stringify(manifest));
  return at;
};
const base = { version: '1.0.0', license: 'Apache-2.0', description: 'A pack.' };

it('#1720 a release pack naming only its name is read as deepbuild/<name>', () => {
  expect(readPack(folder('shipped', { name: 'shipped', ...base }), true).ref).toBe('deepbuild/shipped@1.0.0');
});

it('#1720 an outside pack under the deepbuild owner is refused, one under its own owner is read', () => {
  expect(() => readPack(folder('posing', { id: 'deepbuild/posing', name: 'posing', ...base }))).toThrow(/the deepbuild owner is the release's own/);
  expect(readPack(folder('own', { id: 'someone/own', name: 'own', ...base })).ref).toBe('someone/own@1.0.0');
});
