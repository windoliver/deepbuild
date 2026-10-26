// #331 AC4, the "at install" half: each of environment@1's four planted environments, installed as a first-party
// package that registers it through `deep.registerEnvironment`, is refused at install by the slot's kit (#348's
// install runs each slot's kit on what the package registers, #349), the error carrying the plant's own message and
// naming the route, the port, the process or the worktree; and env-local, registered the same way, installs with
// the kit passed on `Installed.kits`. The kit half, through runKit, is kit.test.ts. The host is reached only through
// its public entry (README, The surface: deep.registerEnvironment and the `environments` manifest key). This is
// the blind redraft blocked.test.ts named, written once #348 and #349 landed.
import { cpSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { slotKits } from '../../../packages/conformance/src/index.ts';
import { openExtensionHost, openTrust, packageDigest, type ExtensionHost, type ReleaseEntry } from '../../../packages/extension-host/src/index.ts';
import { openAsks } from '../../../packages/asks/src/index.ts';
import { openRecord, type RecordStore } from '../../../packages/record/src/index.ts';
import { openSupervisor, type Supervisor } from '../../../packages/supervisor/src/index.ts';
import { cleanup, FIXTURES, REPO, sub, tempDir } from './helpers.ts';

const ENV = 'environment@1';
const PLANTS = ['ready-before-health', 'unleased-port', 'leaves-grandchild', 'starts-in-worktree'] as const;
type Plant = (typeof PLANTS)[number];
/** The built entries a package imports in the hub (its folder is a temp copy, outside the workspace). */
const DIST = (name: string) => join(REPO, 'packages', name, 'dist/index.js');
/** What each plant's refusal must name, beside the plant's message, as kit.test.ts reads the kit's FAIL. */
const NAMES: Record<Plant, [string, (m: string) => boolean]> = {
  'ready-before-health': ['the health route', (m) => /\/[\w-]/.test(m)],
  'unleased-port': ['the port', (m) => /port/.test(m) && /\b\d{2,5}\b/.test(m)],
  'leaves-grandchild': ['the process by PID', (m) => /\bpid \d+/.test(m)],
  'starts-in-worktree': ['the worktree it started in, by path', (m) => /worktree/i.test(m) && /(^|\s|')\/[^\s']+/.test(m)],
};
const plantMessage = (name: Plant): string => {
  const p = slotKits().find((k) => k.slot === ENV)?.planted.find((x) => x.name === name);
  if (!p) throw Error(`slotKits() ships no ${ENV} kit planting ${name}`);
  return p.message;
};

// ---- A test package: fixtures/<name> copied, each *.fixture renamed, the files and manifest fields written over
// it, and the manifest's digest set to the host's own packageDigest (as #349's helpers make one).
function pkg(name: string, manifest: Record<string, unknown>, files: Record<string, string>): string {
  const dir = sub(tempDir(), 'pkg');
  cpSync(join(FIXTURES, name), dir, { recursive: true });
  for (const entry of readdirSync(dir)) if (entry.endsWith('.fixture')) renameSync(join(dir, entry), join(dir, entry.slice(0, -'.fixture'.length)));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  const manifestPath = join(dir, 'deepbuild.json');
  const m = { ...(JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>), ...manifest };
  writeFileSync(manifestPath, `${JSON.stringify(m, null, 2)}\n`);
  m.digest = packageDigest(dir);
  writeFileSync(manifestPath, `${JSON.stringify(m, null, 2)}\n`);
  return dir;
}
const releaseEntry = (dir: string): ReleaseEntry => {
  const m = JSON.parse(readFileSync(join(dir, 'deepbuild.json'), 'utf8')) as { id: string; version: string };
  return { id: m.id, version: m.version, digest: packageDigest(dir) };
};
const plantPkg = (name: Plant): string => pkg('environment', { id: `deepbuild/env-${name}`, environments: [name] }, { 'environment.json': JSON.stringify({ conformance: DIST('conformance'), planted: name }) });
const envLocalPkg = (): string => pkg('env-local', {}, { 'env-local.json': JSON.stringify({ record: DIST('record'), asks: DIST('asks'), supervisor: DIST('supervisor'), envLocal: DIST('env-local') }) });

// ---- One host for the file, DeepBuild's signed release listing the five packages, so each installs in the hub.
interface World { host: ExtensionHost; record: RecordStore; sup: Supervisor; plants: Record<Plant, string>; local: string }
let shared: Promise<World> | undefined;
function world(): Promise<World> {
  shared ??= (async () => {
    const plants = Object.fromEntries(PLANTS.map((name) => [name, plantPkg(name)])) as Record<Plant, string>;
    const local = envLocalPkg();
    const dir = tempDir();
    const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
    const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
    const sup = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 2 * 86_400_000 } } } });
    const trust = await openTrust({ record, now: Date.now });
    const release = [...Object.values(plants), local].map(releaseEntry);
    const host = await openExtensionHost({ record, asks, supervisor: sup, trust, home: sub(dir, 'deepbuild'), release, now: Date.now });
    await host.ready();
    return { host, record, sup, plants, local };
  })();
  return shared;
}
afterAll(async () => {
  if (shared) {
    const w = await shared.catch(() => undefined);
    await w?.host.close().catch(() => undefined);
    await w?.sup.close().catch(() => undefined);
    await w?.record.close().catch(() => undefined);
  }
  await cleanup();
}, 60_000);

describe('AC4 #331.5c02ca8a env-local passes environment@1, whose four planted environments each fail it at install, naming the route, the port, the process or the worktree', () => {
  for (const name of PLANTS) {
    const [what, names] = NAMES[name];
    it(`AC4 installing the planted environment ${name} through deep.registerEnvironment is refused at install by environment@1, naming ${what}`, async () => {
      const { host, plants } = await world();
      const message = plantMessage(name);
      let refusal: Error | undefined;
      try {
        const installed = await host.install({ from: plants[name], builtBy: null });
        expect.fail(`the planted environment ${name} installed (kits: ${JSON.stringify(installed.kits)}); environment@1 must refuse it at install`);
      } catch (error) {
        if ((error as Error).message.startsWith('the planted environment')) throw error;
        refusal = error as Error;
      }
      expect(refusal!.message, `the refusal carries the plant's own message "${message}"`).toContain(message);
      expect(names(refusal!.message), `the refusal names ${what}: ${refusal!.message}`).toBe(true);
      expect((await host.installed()).map((p) => p.id), 'the refused package isn\'t installed').not.toContain(`deepbuild/env-${name}`);
    }, 600_000);
  }

  it('AC4 env-local, registered through deep.registerEnvironment, installs with environment@1 passed on Installed.kits', async () => {
    const { host, local } = await world();
    const installed = await host.install({ from: local, builtBy: null });
    expect(installed.kits ?? [], `the install ran environment@1's kit on env-local: ${JSON.stringify(installed.kits)}`).toContainEqual({ slot: ENV, fill: 'local', verdict: 'PASS' });
    expect((await host.installed()).map((p) => p.id)).toContain('deepbuild/env-local');
  }, 600_000);
});
