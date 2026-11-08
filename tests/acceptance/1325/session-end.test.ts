// AC4: A session's credential stops working within 60 s of the session's end.
//
// A session under a run pushes a branch with its credential (so it worked), ends its turn, and ends: SessionEnd, then
// its process exits. From the stand-in's own end time, the forge must take the credential no more: revoked, or
// expired, within 60 s, and a call with it then answers 401. Installation tokens live an hour unless revoked
// (DELETE /installation/token), so only the hub's doing ends one in time.
import { describe, it } from 'vitest';
import { AC, forgeCalls, must, promptOf, SHOP, tag, waitFor, World } from './helpers.ts';

describe(`${AC[4]} A session's credential stops working within 60 s of the session's end`, () => {
  it(`${AC[4]} the credential a session pushed with is refused by the forge within 60 s of the session's end`, async () => {
    const w = await World.open();
    await w.approveRun();
    const started = await w.start(promptOf([forgeCalls(w, ['push-branch'], tag())], { exit: true }));
    const log = await w.standIn(started.worktree, { ended: true });
    const ended = Number(log.ended);
    const token = log.env?.GH_TOKEN as string | undefined;
    const credential = w.credentialOf(token);
    must(credential.agents, `the session's GH_TOKEN is ${credential.what}, not a credential of the session's own from the agents' app`);
    const pushed = w.forge.attempts.filter((a) => a.token === token && a.action === 'push-branch');
    must(pushed.some((a) => !a.refused), `the session's credential never worked: its branch push was ${JSON.stringify(pushed)}`);
    const issued = w.forge.tokens.get(token!)!;
    const stopped = await waitFor(() => (w.forge.works(token!) ? undefined : Math.min(issued.revoked ?? Infinity, issued.expires)), Math.max(0, ended + 75_000 - Date.now()), 'the credential to stop')
      .catch(() => undefined);
    must(stopped !== undefined, `the session's credential still works ${((Date.now() - ended) / 1000).toFixed(1)} s after the session's end`);
    must(stopped - ended <= 60_000, `the session's credential stopped working ${((stopped - ended) / 1000).toFixed(1)} s after the session's end, past 60 s`);
    const after = await w.api('GET', `/repos/${SHOP}`, undefined, token!);
    must(after.status === 401, `a call with the ended session's credential answers 401: ${after.status}`);
  }, 600_000);
});
