// The two Host.start test-module callbacks must execute real files in their reviewed place.
// Reuse #348's real record/supervisor/sandbox setup; its tests remain untouched.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { openHost, openWorld, pkg, releaseEntry, tempDir } from '../../348/helpers.ts';

async function scenario(place: 'hub' | 'sandbox', plant?: 'hub-unless-agent-built'): Promise<void> {
    const canary = join(tempDir('loader-canary'), 'outside.txt');
    writeFileSync(canary, 'loader-boundary-canary');
    const source = `import { readFileSync } from 'node:fs';
export default { 'actual process and file boundary': () => {
  if ((process.pid === ${process.pid}) !== ${place === 'hub'}) throw Error('wrong process');
  let bytes, error;
  try { bytes = readFileSync(${JSON.stringify(canary)}, 'utf8'); } catch (e) { error = e; }
  ${place === 'hub'
    ? "if (error || bytes !== 'loader-boundary-canary') throw Error('release control did not read the canary');"
    : "if (!error || !['EPERM', 'EACCES'].includes(error.code)) throw Error('sandbox did not deny the canary');"}
} };
`;
    const from = await pkg('probe', { files: { 'tests/nested/boundary.test.mjs': source } });
    const w = await openWorld();
    const host = await openHost(w, { release: place === 'hub' ? [await releaseEntry(from)] : [], ...(plant ? { plant } : {}) });
    await host.ready();
    const installed = await host.install({ from, builtBy: null });
    expect((await host.check(installed)).passed).toBe(true);
    const loaded = await host.load(installed);
    expect(loaded.status).toBe('loaded');
    expect(loaded.status === 'loaded' && loaded.place).toBe(place);
    const result = await host.testPackage(installed);
    expect(result.testsRun, 'a missing/no-op importer cannot count as executing the fixture').toBe(1);
    expect(result.failures).toEqual([]);
    expect(result.passed).toBe(true);
}
for (const place of ['hub', 'sandbox'] as const) {
  it(`reviewed test loader: ${place} imports a snapshot test module, with its actual process and file boundary`, () => scenario(place), 60_000);
}
it('oracle: an unlisted package loaded in-process fails the same loader assertion', async () => {
  await expect(scenario('sandbox', 'hub-unless-agent-built')).rejects.toThrow(/sandbox/);
}, 60_000);
