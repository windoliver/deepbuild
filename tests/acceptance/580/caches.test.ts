// #580 AC5: a run that reused .next/cache names the cache's digest in its record, and no .next build output from an
// earlier run is in its checkout; a planted environment that clones .next whole fails this test, naming the folder. The
// app lists its .next as it finds it, before writing anything, so the checkout's truth is on disk, not in the record.
import { afterEach, describe, expect, it } from 'vitest';
import { Bench, failureOf, passed, treeDigest, type Done } from './helpers.ts';

let bench: Bench | undefined;
afterEach(async () => { await bench?.close(); bench = undefined; }, 300_000);

async function scenario(plant?: string): Promise<{ first: Done; second: Done }> {
  const b = bench = await Bench.open(plant ? { plant } : {});
  const s = await b.session();
  return { first: await b.whole(s), second: await b.whole(s) };
}
function criterion({ first, second }: { first: Done; second: Done }): void {
  passed(first);
  passed(second);
  const found = second.app!.next_before;
  const output = Object.keys(found).filter((p) => !p.startsWith('.next/cache/'));
  expect(output, `build output from an earlier run is in the checkout: the folder .next was cloned whole (${output.join(', ')})`).toEqual([]);
  const cache = Object.fromEntries(Object.entries(found).filter(([p]) => p.startsWith('.next/cache/')).map(([p, hash]) => [p.slice('.next/cache/'.length), hash]));
  expect(Object.keys(cache), 'the run reused the cache the last run left').toContain('compiled');
  const entry = second.served.caches.find((c) => c.path === '.next/cache');
  expect(entry, `the run's record names the cache (${JSON.stringify(second.served.caches)})`).toBeDefined();
  expect(entry!.digest, 'with the digest of what the run found').toBe(treeDigest(cache));
}

describe('AC5 #580 a declared cache folder carries between runs, its digest in the record; build output never does', () => {
  it('AC5 the second run finds .next/cache as the first left it, names its digest, and finds no .next build output', async () => {
    criterion(await scenario());
  }, 1_500_000);

  it('AC5 (wrong program) an environment that clones .next whole (DEEP_HUB_PLANT=env-clones-next-whole) fails this test, naming the folder', async () => {
    const failure = await failureOf(async () => criterion(await scenario('env-clones-next-whole')));
    expect(failure, 'the planted environment passed').not.toBeNull();
    expect(failure, 'naming the folder').toContain('.next');
    expect(failure, 'and what it wrongly holds').toContain('.next/BUILD_ID');
  }, 1_500_000);
});
