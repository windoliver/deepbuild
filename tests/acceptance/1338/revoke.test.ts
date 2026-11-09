// AC1 #1338.177002b6: "A client with a revoked credential is refused within 5 s of revocation, and a client with no
// credential gets no data."
//
// bob's machine (a home of its own) joins acme/shop by the repo link and maya's invite, and reads the project's
// sessions over the hub's network listener: maya's session in her clone is there (the control: his credential gets
// data). A client presenting nothing, over plain TCP and over TLS, gets none of it. maya revokes bob; 5 s after the
// hub answers, bob's read is refused and shows none of it.
import { afterAll, describe, expect, it } from 'vitest';
import { cleanup, hubPort, joined, mayaWorks, noCredential, readOn, revoke, shown, sleep, world } from './helpers.ts';

afterAll(cleanup, 60_000);

describe('AC1 #1338.177002b6 a revoked credential is refused within 5 s, and no credential gets no data', () => {
  it('AC1 #1338.177002b6 bob reads the project until maya revokes him, then is refused 5 s on; a client with no credential reads nothing', async () => {
    const w = await world();
    const bob = await joined(w, 'bob');
    const { session, ids } = await mayaWorks(w);
    const prefix = session.id.slice(0, 8);

    const carried = w.link.carried;
    const before = await readOn(bob);
    expect(before.code, `bob's machine, on the project, must read it over the network: ${shown(before)}`).toBe(0);
    expect(before.stdout, `bob's read must list maya's session ${prefix} in acme/shop (the project's work is shared): ${shown(before)}`).toContain(prefix);
    expect(w.link.carried, "bob's read must reach the hub through the network link, not some other way").toBeGreaterThan(carried);

    const port = hubPort(w.hub.pid);
    if (!port) throw Error('BLOCKED: the hub with a member listens on no TCP port');
    const bare = await noCredential(port);
    for (const [how, text] of Object.entries(bare)) {
      for (const needle of [session.id, prefix, ...ids]) {
        expect(text.includes(needle), `a client with no credential over ${how} got data: ${JSON.stringify(needle)} in ${JSON.stringify(text.slice(0, 800))}`).toBe(false);
      }
    }

    const revokedAt = await revoke(w, 'bob');
    await sleep(Math.max(0, revokedAt + 5000 - Date.now()));
    const after = await readOn(bob);
    expect(after.stdout.includes(prefix), `5 s after bob's credential was revoked his read still lists maya's session ${prefix}: ${shown(after)}`).toBe(false);
    expect(after.code, `5 s after bob's credential was revoked his read must be refused (a nonzero exit): ${shown(after)}`).not.toBe(0);
  }, 600_000);
});
