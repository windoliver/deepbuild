// AC12 (#139): a JSON-RPC call of a method with `deprecated_since` returns its result through the adapter with a
// `deprecated` notice naming `replaced_by` and the release that stops serving it, and `deep doctor` and the install check
// name the installed package whose manifest uses it; a hub that serves the old method silently fails, naming the method.
// The hub reads its published JSON-RPC methods (packages/contracts/rpc-methods.json) from the tree DEEP_HUB_CONTRACTS
// names, which is how this test gives it a deprecated method: `hub.ping`, deprecated since R2, replaced by `hub.health`,
// served through the adapter until R3 (README: the surface under test). The wrong hub is DEEP_HUB_PLANT=silent-deprecated.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { cleanup, control, deep, startHub, stopHub, type Hub, type Line } from '../16/helpers.ts';
import { at, makePackage, scratch, tempDir, writeJson, RPC_FILE, type Tree } from './helpers.ts';

afterAll(cleanup, 60_000);

const ROWS = [
  { method: 'hub.health', since: 'R1', stability: 'stable' },
  { method: 'hub.ping', since: 'R1', stability: 'stable', deprecated_since: 'R2', replaced_by: 'hub.health', stops_serving: 'R3' },
];
const NOTICE = { code: 'deprecated', entry: 'hub.ping', replaced_by: 'hub.health', stops_serving: 'R3' };

interface Scene { tree: Tree; home: string; hub: Hub; env: Record<string, string | undefined> }
const hubs: Hub[] = [];
async function scene(plant?: string): Promise<Scene> {
  const tree = scratch('rpc');
  writeJson(at(tree, RPC_FILE), ROWS);
  const base = tempDir('hub');
  const home = join(base, 'h');
  mkdirSync(home);
  const confirm = join(base, 'confirm');
  writeFileSync(confirm, 'confirmed');
  const env = { DEEP_HUB_CONTRACTS: tree.root, DEEP_HUB_TEST_CONFIRM: confirm };
  const hub = await startHub({ home, ...(plant ? { plant } : {}), env });
  hubs.push(hub);
  return { tree, home, hub, env };
}
afterAll(async () => { for (const h of hubs.splice(0)) await stopHub(h); }, 60_000);

/** Calls hub.ping and hub.health; throws what the criterion names when the old method is served with no notice. */
async function ping(s: Scene): Promise<{ old: Line; current: Line }> {
  const conn = await control(s.hub);
  try {
    const old = await conn.call('hub.ping');
    const current = await conn.call('hub.health');
    if (!('result' in old)) throw Error(`hub.ping was refused: ${JSON.stringify(old)}`);
    if (!old.deprecated) throw Error(`the hub served the deprecated method hub.ping silently: its reply carries no deprecated notice (${JSON.stringify(old).slice(0, 300)})`);
    return { old, current };
  } finally {
    conn.close();
  }
}

describe('#139.9bbdfea5 a JSON-RPC call of a method with deprecated_since returns its result through the adapter with a deprecated notice, and deep doctor and the install check name the package that uses it', () => {
  it('AC12 hub.ping returns hub.health\'s result with a deprecated notice naming hub.health and R3; hub.health itself carries none', async () => {
    const { old, current } = await ping(await scene());
    expect(old.deprecated, 'the notice names the entry, its replacement and the release that stops serving it').toMatchObject(NOTICE);
    expect(Object.keys(old.result as object).sort(), 'the result is the replacement\'s, through the adapter').toEqual(Object.keys(current.result as object).sort());
    expect((old.result as Line).pid, 'from the same hub').toBe((current.result as Line).pid);
    expect(current.deprecated, 'the current method carries no notice').toBeUndefined();
  }, 120_000);

  it('AC12 (wrong program) a hub that serves the old method silently fails, naming the method', async () => {
    await expect(ping(await scene('silent-deprecated'))).rejects.toThrow(/served the deprecated method hub\.ping silently/);
  }, 120_000);

  it('AC12 the install check and deep doctor name the installed package whose manifest uses the deprecated method', async () => {
    const s = await scene();
    const pkg = await makePackage({ id: 'acme/pinger', manifest: { calls: ['hub.ping'] }, index: 'export default function (_deep: any): void {}\n' });
    const installed = await deep(s.home, ['install', pkg], { env: s.env, timeoutMs: 120_000 });
    const said = `${installed.stdout}${installed.stderr}`;
    expect(installed.code, `deep install installs it (the notice is not a refusal)\n${said}`).toBe(0);
    expect(said, 'the install check names the package, the method and what replaces it').toContain('acme/pinger');
    expect(said).toContain('hub.ping');
    expect(said).toContain('hub.health');
    const doctor = await deep(s.home, ['doctor', '--json'], { env: s.env, timeoutMs: 180_000 });
    let parsed: unknown;
    try { parsed = JSON.parse(doctor.stdout); } catch { parsed = doctor.stdout; }
    const items: unknown[] = Array.isArray(parsed) ? parsed : Array.isArray((parsed as { items?: unknown[] } | null)?.items) ? (parsed as { items: unknown[] }).items : [parsed];
    const item = items.find((i) => JSON.stringify(i).includes('acme/pinger') && JSON.stringify(i).includes('hub.ping'));
    expect(item, `deep doctor has an item naming the installed package acme/pinger and the deprecated method hub.ping\n${doctor.stdout.slice(0, 3000)}`).toBeDefined();
  }, 400_000);
});
