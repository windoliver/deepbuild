// deep_drive past #124's acceptance suite: a session that ends takes its replicas with it, and their leases, so the
// next session can launch. Real hub, real `deep mcp` under #806's agent stand-in, real deep-drive processes.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { PANEL, buildDrive, cleanup, family, sleep, t26 } from '../../../tests/acceptance/124/helpers.ts';
import { Stand, uuidOf } from '../../../tests/acceptance/806/helpers.ts';

afterAll(cleanup, 60_000);

/** The deep-drive processes under the hub `pid`. */
function drives(pid: number): number {
  const mine = family(pid);
  return spawnSync('ps', ['-A', '-o', 'pid=,comm='], { encoding: 'utf8' }).stdout.split('\n')
    .map((line) => line.trim().split(/\s+/, 2))
    .filter(([p, comm]) => p && comm?.endsWith('deep-drive') && mine.has(Number(p))).length;
}

it('a session that ends takes its replicas and their leases with it', async () => {
  buildDrive();
  const { tmp, home } = t26.makeHome();
  const wt = t26.makeWorktree(join(tmp, 'work'));
  const hub = await t26.startHub(home);
  const launch = { call: 'launch', launch: { from: 'fixture', panel: PANEL.form, clock: 'virtual' } };
  const a = Stand.start(home, wt.path, 'claude-code', uuidOf('end-a'));
  await a.establish(hub);
  await t26.initialize(a);
  const both = [await t26.callTool(a, 'deep_drive', launch, 180_000), await t26.callTool(a, 'deep_drive', launch, 180_000)];
  expect(both.map((r) => (r.value as { ok?: boolean })?.ok), 'the session launches the machine\'s two').toEqual([true, true]);
  expect(drives(hub.pid)).toBe(2);
  await a.hook(hub, 'SessionEnd');
  for (let i = 0; i < 50 && drives(hub.pid) > 0; i++) await sleep(200);
  expect(drives(hub.pid), 'no replica outlives its session').toBe(0);
  const b = Stand.start(home, wt.path, 'codex', uuidOf('end-b'));
  await b.establish(hub);
  await t26.initialize(b);
  const next = await t26.callTool(b, 'deep_drive', launch, 180_000);
  expect((next.value as { ok?: boolean })?.ok, `the next session gets a lease: ${JSON.stringify(next.value).slice(0, 300)}`).toBe(true);
}, 600_000);
