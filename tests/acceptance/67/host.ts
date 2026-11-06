// Test-side tools for the #67 suites on the real extension host in this process: a world (the record, the asks core,
// the supervisor and project trust), test packages copied from fixtures/ with their digest set, DeepBuild's signed
// release listing them so each runs in the hub, as #331's and #349's suites do it. Nothing here stands in for the host,
// the conformance kits or the asks core. The new surface is loaded lazily, so this file loads at the base.
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll } from 'vitest';
import { openAsks, type Asks } from '../../../packages/asks/src/index.ts';
import type { ExtensionHost, ProjectTrust, ReleaseEntry } from '../../../packages/extension-host/src/index.ts';
import { openExtensionHost, openTrust, packageDigest } from '../../../packages/extension-host/src/index.ts';
import { openRecord, type RecordStore } from '../../../packages/record/src/index.ts';
import { openSupervisor, type Supervisor } from '../../../packages/supervisor/src/index.ts';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
for (const key of Object.keys(process.env)) if (key.startsWith('CLAUDE') || key.startsWith('DEEP_')) delete process.env[key];
export const HOME = realpathSync(mkdtempSync('/tmp/dh67-home-'));
process.env.HOME = HOME;

const made: string[] = [HOME];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh67-'));
  made.push(dir);
  return dir;
}

/** A test package: fixtures/<name> copied to `dir`, each *.fixture renamed, these files and manifest fields written over it, and its digest set. */
export function pkg(name: string, dir: string, manifest: Record<string, unknown>, files: Record<string, string>): string {
  mkdirSync(dir, { recursive: true });
  cpSync(join(FIXTURES, name), dir, { recursive: true });
  for (const entry of readdirSync(dir)) if (entry.endsWith('.fixture')) renameSync(join(dir, entry), join(dir, entry.slice(0, -'.fixture'.length)));
  for (const [path, text] of Object.entries(files)) writeFileSync(join(dir, path), text);
  const path = join(dir, 'deepbuild.json');
  const m = { ...(JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>), ...manifest };
  writeFileSync(path, `${JSON.stringify(m, null, 2)}\n`);
  m.digest = packageDigest(dir);
  writeFileSync(path, `${JSON.stringify(m, null, 2)}\n`);
  return dir;
}
export const releaseEntry = (dir: string): ReleaseEntry => {
  const m = JSON.parse(readFileSync(join(dir, 'deepbuild.json'), 'utf8')) as { id: string; version: string };
  return { id: m.id, version: m.version, digest: packageDigest(dir) };
};

export interface World { dir: string; record: RecordStore; asks: Asks; sup: Supervisor; trust: ProjectTrust; host: ExtensionHost }
const worlds: World[] = [];
/** A host whose release lists `packages`, so each runs in the hub. */
export async function openWorld(packages: string[]): Promise<World> {
  const dir = tempDir();
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const sup = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 2 * 86_400_000 } } } });
  const trust = await openTrust({ record, now: Date.now });
  const home = join(dir, 'deepbuild');
  mkdirSync(home);
  const host = await openExtensionHost({ record, asks, supervisor: sup, trust, home, release: packages.map(releaseEntry), now: Date.now });
  await host.ready();
  const world: World = { dir, record, asks, sup, trust, host };
  worlds.push(world);
  return world;
}
afterAll(async () => {
  for (const w of worlds.splice(0)) {
    await w.host.close().catch(() => undefined);
    await w.sup.close().catch(() => undefined);
    await w.record.close().catch(() => undefined);
  }
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}, 60_000);
