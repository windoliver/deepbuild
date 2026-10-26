// AC4: A planted index that still returns a claim after `dropSource` of its only source, or a hit with no source,
// fails `index@1` at install, naming the case; …
//
// Each index is fixtures/index-package, a first-party package DeepBuild's release lists (so it runs in the hub),
// whose code calls deep.registerIndex with a keyword index bent by its index.json. Its manifest replaces the
// shipped index (`replaces: ["index@1"]`), so the install runs index@1's kit on what it registers and refuses it on
// a FAIL, naming the kit case that failed; `Installed.kits` carries the kit's verdict (README: Readings).
// The other half of AC4 (a planted index marking a fetched README's hit as inside) is in outside.test.ts.
import { cpSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { openAsks } from '../../../packages/asks/src/index.ts';
import { slotKits } from '../../../packages/conformance/src/index.ts';
import { openExtensionHost, openTrust, packageDigest, type ExtensionHost, type ReleaseEntry } from '../../../packages/extension-host/src/index.ts';
import { openRecord } from '../../../packages/record/src/index.ts';
import { openSupervisor } from '../../../packages/supervisor/src/index.ts';
import { cleanup, tempDir } from './helpers.ts';

const FIXTURE = new URL('./fixtures/index-package/', import.meta.url);
const closers: (() => Promise<unknown>)[] = [];
afterAll(async () => {
  for (const close of closers.splice(0).reverse()) await close().catch(() => undefined);
  await cleanup();
}, 60_000);

type Fault = 'none' | 'keeps-dropped-source' | 'sourceless-hit';
/** The test package with its fault, under its own id, its digest stamped. */
function indexPackage(fault: Fault): string {
  const dir = tempDir(`pkg-${fault}`);
  cpSync(FIXTURE, dir, { recursive: true });
  renameSync(join(dir, 'index.ts.fixture'), join(dir, 'index.ts'));
  writeFileSync(join(dir, 'index.json'), `${JSON.stringify({ fault })}\n`);
  const path = join(dir, 'deepbuild.json');
  const manifest: Record<string, unknown> = { ...(JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>), id: `deepbuild/test-index-${fault}` };
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  manifest.digest = packageDigest(dir);
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  return dir;
}
const releaseEntry = (dir: string): ReleaseEntry => {
  const m = JSON.parse(readFileSync(join(dir, 'deepbuild.json'), 'utf8')) as { id: string; version: string };
  return { id: m.id, version: m.version, digest: packageDigest(dir) };
};

let opened: Promise<{ host: ExtensionHost; dirs: Record<Fault, string> }> | undefined;
/** One host whose release lists the three packages, on a record, the asks core, the supervisor and trust of its own. */
function hostWithIndexes() {
  return (opened ??= (async () => {
    const dirs = { none: indexPackage('none'), 'keeps-dropped-source': indexPackage('keeps-dropped-source'), 'sourceless-hit': indexPackage('sourceless-hit') };
    const world = tempDir('host');
    const record = await openRecord({ path: join(world, 'ledger.db'), now: Date.now });
    closers.push(() => record.close());
    const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
    const supervisor = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 86_400_000 } } } });
    closers.push(() => supervisor.close());
    const trust = await openTrust({ record, now: Date.now });
    const host = await openExtensionHost({ record, asks, supervisor, trust, home: join(world, 'deepbuild'), release: Object.values(dirs).map(releaseEntry), now: Date.now });
    closers.push(() => host.close());
    await host.ready();
    return { host, dirs };
  })());
}

/** index@1's case IDs: its fixed fixtures, and its seeded cases (`seeded-<n>`). */
const CASES = (slotKits().find((k) => k.slot === 'index@1')?.fixtures ?? []).map((f) => f.id);
const namesACase = (message: string): boolean => CASES.some((id) => message.includes(id)) || /seeded-\d+/.test(message);

async function refusedAtInstall(fault: Fault): Promise<string> {
  const { host, dirs } = await hostWithIndexes();
  const id = `deepbuild/test-index-${fault}`;
  const outcome = await host.install({ from: dirs[fault], builtBy: null }).then(
    (installed) => ({ installed }),
    (error: unknown) => ({ refused: error instanceof Error ? error.message : String(error) }),
  );
  expect('refused' in outcome, `index@1's kit at install refuses ${id} (${fault}): ${JSON.stringify(outcome)}`).toBe(true);
  expect((await host.installed()).map((p) => p.id), `the refused ${id} isn't installed`).not.toContain(id);
  return (outcome as { refused: string }).refused;
}

describe('AC4 a planted index that still returns a claim after dropSource of its only source, or a hit with no source, fails index@1 at install, naming the case', () => {
  it('AC4 an index that keeps a dropped source\'s claim is refused at install, naming the index@1 case it failed', async () => {
    expect(CASES.length, 'index@1 has fixed cases').toBeGreaterThan(0);
    const message = await refusedAtInstall('keeps-dropped-source');
    expect(namesACase(message), `the refusal names the index@1 case (one of ${CASES.join(', ')}, or seeded-<n>): ${message}`).toBe(true);
  }, 120_000);

  it('AC4 an index that returns a hit with no source is refused at install, naming the index@1 case it failed', async () => {
    const message = await refusedAtInstall('sourceless-hit');
    expect(namesACase(message), `the refusal names the index@1 case (one of ${CASES.join(', ')}, or seeded-<n>): ${message}`).toBe(true);
  }, 120_000);

  it('AC4 the sound index installs, with index@1 passed at install', async () => {
    const { host, dirs } = await hostWithIndexes();
    const installed = await host.install({ from: dirs.none, builtBy: null });
    expect(installed.kits, `the install ran index@1's kit on the package's index: ${JSON.stringify(installed.kits)}`).toContainEqual(expect.objectContaining({ slot: 'index@1', verdict: 'PASS' }));
    expect((await host.installed()).map((p) => p.id)).toContain('deepbuild/test-index-none');
  }, 120_000);
});
