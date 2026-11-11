// AC2 (#1820): with less than 2.2x the asset's size free on disk, the fetch is refused before any byte is read, naming both sizes.
import { beforeAll, describe, expect, it } from 'vitest';
import { A } from './pack.ts';
import { asks, fetchA, freeBytes, kinds, newAsks, readyWorld, until, yes, type PackWorld } from './helpers.ts';

let w: PackWorld;
beforeAll(async () => { w = await readyWorld(); }, 600_000);

/** Every integer a text names, with thousands separators read through. */
const numbers = (text: string): number[] => (text.replace(/(\d),(?=\d{3}\b)/g, '$1').match(/\d+(?:\.\d+)?/g) ?? []).map(Number);

describe('#1820.bd8f8f74 with less than 2.2× the asset\'s size free on disk, the fetch is refused before any byte is read, naming both sizes', () => {
  it('refuses an asset listed at 0.6 of the free space (more than free/2.2, less than free), reading no byte, naming its size and the free space', async () => {
    expect(w.hugeSize * 2.2, 'the fixture is under the 2.2x rule').toBeGreaterThan(freeBytes(w));
    expect(w.hugeSize, 'and a plain "fits on disk" check would pass it').toBeLessThan(freeBytes(w));
    const asksBefore = (await asks(w)).length;
    const from = w.packs.log.length;
    let outcome = await kinds(w, fetchA(A.huge));
    if (outcome.value.status === 'held') {
      const raised = await newAsks(w, asksBefore, 'authority');
      expect((await yes(w, raised[0]!)).code).toBe(0);
      outcome = await until(w, fetchA(A.huge));
    }
    expect(outcome.isError || outcome.value.status === 'refused', outcome.text).toBe(true);
    expect(w.packs.since(from, A.huge.path), 'a byte was requested before the disk refusal').toEqual([]);
    const named = numbers(outcome.text);
    expect(named, `the refusal names the asset's size ${w.hugeSize}: ${outcome.text}`).toContain(w.hugeSize);
    // The free space, to within what other work on the machine moves in a minute (2 GiB), in bytes; or in GB/GiB.
    const free = freeBytes(w);
    const slack = 2 * 2 ** 30;
    const asBytes = named.some((n) => Math.abs(n - free) <= slack);
    const near = (x: number) => Math.abs(x - free) <= slack + free * 0.02;
    const asGB = named.some((v) => near(v * 1e9) || near(v * 2 ** 30));
    expect(asBytes || asGB, `the refusal names the free space (about ${free} bytes): ${outcome.text}`).toBe(true);
    expect(outcome.value.status).not.toBe('fetched');
  }, 600_000);
});