// #2315 AC1: with a kitted replacement environment@1 provider installed and loaded through the hub's extension host,
// `deep env up` and `deep env down` in a worktree invoke that provider's `up` and `down`, not env-local's. The
// replacement (fixtures/recorder) writes each call the host makes of it to a log nothing else writes; the stack is
// the test repo's own dev server (fixtures/server.mjs), which records its PID in the worktree it was started in.
import { afterAll, describe, expect, it } from 'vitest';
import { alive, calls, envDown, envUp, hubWithReplacement, makeRepo, serverPids, shown, stopHub, type Hub, type Line, type Package } from './helpers.ts';

const AC1 = '#2315.9f5b8ef0';
let shared: Promise<{ hub: Hub; pkg: Package }> | undefined;
const world = (): Promise<{ hub: Hub; pkg: Package }> => (shared ??= hubWithReplacement());
afterAll(async () => {
  const w = await shared?.catch(() => undefined);
  if (w) await stopHub(w.hub);
}, 60_000);

/** The replacement's `up` calls for this folder as its checkout. */
const upsIn = (pkg: Package, folder: string): Line[] => calls(pkg.log).filter((l) => l.call === 'up' && l.checkout === folder);

describe(`AC1 ${AC1} deep env up and deep env down invoke the installed replacement environment@1 provider, not env-local`, () => {
  it(`AC1 ${AC1} deep env up in a worktree asks the replacement's up, with the worktree as its checkout, and reports the stack it returned`, async () => {
    const { hub, pkg } = await world();
    const { worktree } = makeRepo();
    const up = await envUp(hub, worktree);
    expect(up.code, `deep env up exits 0 (${shown(up)})`).toBe(0);
    expect(up.out?.status, `deep env up reports ready (${shown(up)})`).toBe('ready');
    const ups = upsIn(pkg, worktree);
    expect(ups.length, `deep env up asked the installed replacement ${pkg.entry.id}'s up once, with the worktree ${worktree} as its checkout; it asked it ${ups.length} times, so the stack came from elsewhere (env-local). The replacement's log: ${JSON.stringify(calls(pkg.log))}`).toBe(1);
    expect(ups[0]!.error, `the replacement's up succeeded: ${JSON.stringify(ups[0])}`).toBeUndefined();
    expect(up.out?.ports?.web, `deep env up reports the port of the replacement's handle (${JSON.stringify(ups[0]!.handle)}), not another stack's (${shown(up)})`).toBe(ups[0]!.handle.port);
    const servers = serverPids(worktree);
    expect(servers.length, `one stack started in the worktree, the replacement's, and no second one beside it (servers ${servers.join(', ')})`).toBe(1);
    expect(alive(servers[0]!), `the replacement's stack (pid ${servers[0]}) runs once deep env up is done`).toBe(true);
  }, 900_000);

  it(`AC1 ${AC1} deep env down in that worktree asks the replacement's down for the handle its up returned, and the stack stops`, async () => {
    const { hub, pkg } = await world();
    const { worktree } = makeRepo();
    const up = await envUp(hub, worktree);
    expect(up.code, `deep env up exits 0 before the down (${shown(up)})`).toBe(0);
    const servers = serverPids(worktree);
    const down = await envDown(hub, worktree);
    expect(down.code, `deep env down exits 0, nothing left (${shown(down)})`).toBe(0);
    const handles = new Set(upsIn(pkg, worktree).map((l) => l.handle?.id as string));
    const downs = calls(pkg.log).filter((l) => l.call === 'down' && handles.has(l.handle?.id));
    expect(downs.length, `deep env down asked the installed replacement ${pkg.entry.id}'s down once, for the handle its up returned for ${worktree}; it asked it ${downs.length} times. The replacement's log: ${JSON.stringify(calls(pkg.log))}`).toBe(1);
    expect(servers.length, `deep env up started one stack in the worktree (servers ${servers.join(', ')})`).toBe(1);
    expect(alive(servers[0]!), `the replacement's stack (pid ${servers[0]}) stopped once deep env down is done`).toBe(false);
  }, 900_000);
});
