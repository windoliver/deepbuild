// #909 AC1: with the lock file removed under a running hub, within 60 s every gate is watch-only with BLOCKED,
// lock lost, and a second start beside it leaves the first hub's socket in place. Every hub here is `deep hub run`
// on a temp home, reached through its socket (README, The surface under test).
import { rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, Conn, control, health, makeHome, settle, sleep, spawnHub, startHub, type Line } from '../16/helpers.ts';

afterEach(cleanup, 60_000);

/** The hub's lock file under its root (packages/hub/src/paths.ts at the base). */
const LOCK = 'hub-lock.sqlite';
/** "At least once a minute": the check's 60 s, plus 1 s for this test's poll and the health call's reply. */
const WITHIN_MS = 60_000;
const POLL_SLACK_MS = 1_000;

interface Watched { after: number; health: Line }
/** Polls hub.health on a connection opened before the removal until the gates read watch-only, or the time is up. */
async function watchGates(cli: Conn, removedAt: number): Promise<Watched> {
  for (;;) {
    const h = await health(cli);
    const after = Date.now() - removedAt;
    if (h.gates?.watch_only === true || after > WITHIN_MS + POLL_SLACK_MS) return { after, health: h };
    await sleep(500);
  }
}
/** AC1's first half, judged: watch-only within 60 s, the reason BLOCKED and lock lost. */
function lockLost(w: Watched): void {
  const shown = `${(w.after / 1000).toFixed(1)} s after the lock file was removed, hub.health reads gates ${JSON.stringify(w.health.gates)}`;
  console.log(`AC1 ${shown}`);
  expect(w.health.gates?.watch_only, `every gate is watch-only within 60 s: ${shown}`).toBe(true);
  expect(w.after, `every gate turned watch-only within 60 s: ${shown}`).toBeLessThanOrEqual(WITHIN_MS + POLL_SLACK_MS);
  expect(String(w.health.gates?.reason), `the gates' reason says BLOCKED: ${shown}`).toMatch(/BLOCKED/);
  expect(String(w.health.gates?.reason), `the gates' reason names the cause, lock lost: ${shown}`).toMatch(/lock lost/i);
}

/** A hub on a fresh home, a control connection opened to it, the lock file removed from under it. */
async function removeLockUnder(plant?: string) {
  const home = makeHome();
  const hub = await startHub({ home, ...(plant && { plant }) });
  const cli = await control(hub);
  const before = await health(cli);
  expect(before.gates?.watch_only, `the gates enforce before the removal: ${JSON.stringify(before.gates)}`).toBe(false);
  rmSync(join(hub.root, LOCK));
  return { home, hub, cli, removedAt: Date.now() };
}

describe('AC1 #909 a lost lock turns every gate watch-only; a second start leaves the first hub\'s socket', () => {
  it('AC1 with the lock file removed under a running hub, within 60 s every gate is watch-only with BLOCKED, lock lost', async () => {
    const { cli, removedAt } = await removeLockUnder();
    lockLost(await watchGates(cli, removedAt));
    cli.close();
  }, 120_000);

  it('AC1 a second start beside a hub whose lock file was removed leaves the first hub\'s socket in place, and the first hub\'s gates still turn watch-only within 60 s', async () => {
    const { home, hub, cli, removedAt } = await removeLockUnder();
    const ino = statSync(hub.socket).ino;
    const second = spawnHub({ home });
    const r = await settle(second, 20_000);
    console.log(`AC1 the second start: ${r.ready ? `ready as pid ${r.ready.pid}` : r.exit ? `exited ${JSON.stringify(r.exit)}` : 'neither ready nor exited in 20 s'}; stderr: ${second.stderr().trim().slice(0, 500)}`);
    let now: number | string;
    try { now = statSync(hub.socket).ino; } catch (error) { now = (error as NodeJS.ErrnoException).code ?? 'unreadable'; }
    expect(now, `the file at ${hub.socket} is still the first hub's socket (inode ${ino}) after the second start`).toBe(ino);
    const probe = await Conn.open(hub.socket);
    expect(probe.hello?.start, `a new connection to ${hub.socket} reaches the first hub (start ${hub.start}): its hello is ${JSON.stringify(probe.hello)}`).toBe(hub.start);
    probe.close();
    lockLost(await watchGates(cli, removedAt));
    cli.close();
  }, 120_000);

  it('AC1 (wrong program) a hub that never checks its lock again fails this test', async () => {
    const { cli, removedAt } = await removeLockUnder('lock-never-rechecked');
    const w = await watchGates(cli, removedAt);
    cli.close();
    expect(() => lockLost(w)).toThrow(/every gate is watch-only within 60 s/);
  }, 120_000);
});
