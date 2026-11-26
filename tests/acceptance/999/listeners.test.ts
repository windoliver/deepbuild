// AC3 #999.9065ba1c: nothing on the host listens on a network port, by its listeners before and after.
//
// The host's listeners are read on the host itself, through the harness's own link (`ss` there: every listening TCP
// socket and every bound UDP one, loopback included): before `deep host add`, after it, and after a session's hooks
// have reached the hub through the link, while the link is up. Read (README): no listener is there after that wasn't
// before; each new one fails the test, named by its address and port. The session's call is fired until the hub's
// record holds it, so a host that opens no port because nothing reaches the hub fails too.
import { afterEach, describe, expect, test } from 'vitest';
import { AC, cleanup, hostAdd, HostSession, LIMIT, openWorld, PROMPT, proof, shown } from './helpers.ts';

afterEach(cleanup, 900_000);

describe(AC[3], () => {
  test('the host has no listener after `deep host add`, nor after a session whose hooks reached the hub, that it didn\'t have before', async () => {
    const w = await openWorld();
    const before = await w.host.listeners();
    await hostAdd(w);
    const added = await w.host.listeners();
    const s = await HostSession.open(w);
    await s.start();
    await s.typed(PROMPT);
    const call = await s.bash('cat price.txt');
    const linked = await w.host.listeners();
    const fresh = (now: string[]): string[] => now.filter((l) => !before.includes(l));
    proof(w, 'ac3-listeners.json', { host: w.alias, before, after_host_add: added, with_a_session_recording: linked });
    expect(call.after, `the session's call on ${w.alias} is let through and recorded: ${w.redact(shown(call.before))}`).not.toBeNull();
    expect.soft(fresh(added), `after \`deep host add ${w.alias}\`, nothing listens on a network port of the host that didn't before`).toEqual([]);
    expect.soft(fresh(linked), `with the link up and the session's hooks reaching the hub, nothing listens on a network port of ${w.alias} that didn't before`).toEqual([]);
  }, LIMIT);
});
