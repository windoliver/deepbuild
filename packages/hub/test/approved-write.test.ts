// #2118: an approved check's bytes, and its referenced outputs', are never written through a link that leaves the
// checkout: not at the file's folder, and not at the temporary name the write goes through.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { writeApproved } from '../src/hub-shared.js';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
function scene(): { checkout: string; outside: string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'approved-write-')));
  dirs.push(root);
  const checkout = join(root, 'checkout');
  const outside = join(root, 'outside');
  mkdirSync(join(checkout, 'checks'), { recursive: true });
  mkdirSync(outside);
  writeFileSync(join(outside, 'yours.txt'), 'yours\n');
  return { checkout, outside };
}
const approved = new TextEncoder().encode('approved\n');

it('a link at the temporary name is replaced, never written through', () => {
  const { checkout, outside } = scene();
  symlinkSync(join(outside, 'yours.txt'), join(checkout, 'checks/run.sh.tmp'));
  writeApproved(checkout, 'checks/run.sh', approved, 0o500);
  expect(readFileSync(join(outside, 'yours.txt'), 'utf8')).toBe('yours\n');
  expect(readFileSync(join(checkout, 'checks/run.sh'), 'utf8')).toBe('approved\n');
});

it('a referenced output whose folder is a link out of the checkout is refused, naming its path, and nothing is written there', () => {
  const { checkout, outside } = scene();
  symlinkSync(outside, join(checkout, 'expected'));
  expect(() => writeApproved(checkout, 'expected/out.txt', approved, 0o400)).toThrow(/expected\/out\.txt lies outside its checkout/);
  expect(readdirSync(outside)).toEqual(['yours.txt']);
});
