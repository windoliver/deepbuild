// The control each eval opens with (#3245), kept by its hash: its right change applies and does what its request asks.
// Failed on a right change that kept Math.floor, and on an edit of the request that left the hash as it was.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
import { control } from '../src/control.js';

it('is the one kept by its hash, and its right change does what it asks', async () => {
  const { sha256, prompt, right, none } = control();
  expect(sha256).toBe('2bb83540bf3c9a1b50a646300344a64017d517752df365a931e8215513efd12f');
  expect(none).toBe('(no change)');
  const dir = mkdtempSync(join(tmpdir(), 'dce-control-'));
  try {
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src/pages.js'), right.split('\n').filter((l) => /^[ -](?!--)/.test(l)).map((l) => `${l.slice(1)}\n`).join(''));
    const pages = async (n: number) => (await import(`${pathToFileURL(join(dir, 'src/pages.js')).href}?${n}`) as { pageCount(total: number, size: number): number }).pageCount;
    const asked = [...prompt.matchAll(/(\d+) (?:items )?(?:at 10 a page )?are (\d+)/g)].map((m) => [Number(m[1]), Number(m[2])] as const);
    expect(asked).toEqual([[21, 3], [20, 2], [0, 0]]);
    const before = await pages(0);
    expect(before(21, 10), 'what it was asked to fix').toBe(2);
    execFileSync('git', ['apply', '-'], { cwd: dir, input: right });
    const after = await pages(1);
    for (const [total, count] of asked) expect(after(total, 10), `${total} items at 10 a page`).toBe(count);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
