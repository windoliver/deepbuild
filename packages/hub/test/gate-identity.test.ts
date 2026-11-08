// #1325's gaps beyond its blind suite (tests/acceptance/1325, whose world this reuses by path): a push the agents'
// credential made names the session whose commit it carried and the person who approved its run, and a session's
// credential still stops within 60 s of its end when the hub restarted while it ran.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Client, FIXTURES, NODE, PERSON, promptOf, sh, tag, waitFor, World } from '../../../tests/acceptance/1325/helpers.ts';

const LONG = 600_000;
/**
 * The session's credential pushes its worktree's HEAD to a new branch through the blind suite's forge-calls.mjs, as a
 * script would. (It pushes no commit of its own: a started session's sandbox can't write its worktree's git metadata
 * yet, a #1330 follow-up.) The commit is maya's, so a reader that took a commit's author for who did it names her.
 */
const pushHead = (w: World, branch: string): string =>
  sh(NODE, join(FIXTURES, 'forge-calls.mjs'), JSON.stringify({ api: w.apiRoot, repo: w.name, head: 'HEAD', pr: w.pr, branch, tag: '', base: w.defaultBranch, calls: ['push-branch'] }));

describe('#1325 who did it, and a credential across a hub restart', () => {
  it("a push by the agents' credential names the session holding it, its run and the person who approved the run, never the commit's author", async () => {
    const w = await World.open();
    await w.approveRun();
    const branch = `agent-${tag()}`;
    const started = await w.start(promptOf([pushHead(w, branch)]));
    const log = await w.standIn(started.worktree);
    const ran = log.bash as { code?: number; stdout?: string }[];
    expect(ran.map((b) => b.code), `the session's push ran: ${JSON.stringify(ran).slice(0, 1500)}`).toEqual([0]);
    const pushed = await waitFor(async () => (await w.events('session.pushed')).find((e) => e.data?.ref === `refs/heads/${branch}`), 60_000, 'session.pushed');
    expect(pushed.data).toMatchObject({ pusher: w.loginOf(w.agents), session: log.session, run: started.run, approved_by: 'you' });
    expect(JSON.stringify(pushed.data)).not.toContain(PERSON);
  }, LONG);

  it("a session's credential stops within 60 s of its end though the hub restarted while it ran", async () => {
    const w = await World.open();
    await w.approveRun();
    const started = await w.start(promptOf(['sleep 20'], { exit: true }));
    await waitFor(() => w.standIns().find((s) => !s.refused && String(s.cwd).endsWith(started.worktree.split('/').pop()!)), 60_000, 'the session to start');
    // The hub stops and starts again while the session works: what started it keeps running.
    process.kill(w.hub.pid, 'SIGTERM');
    await waitFor(() => w.hub.child.exitCode !== null || w.hub.child.signalCode !== null, 30_000, 'the hub to stop');
    w.client.close();
    w.hub = await (w as unknown as { runHub(): Promise<World['hub']> }).runHub();
    w.client = await Client.open(w.hub.socket, w.root);
    const log = await w.standIn(started.worktree, { ended: true });
    const token = String(log.env?.GH_TOKEN);
    expect(w.credentialOf(token).agents, 'the session had its own credential').toBe(true);
    const ended = Number(log.ended);
    await waitFor(() => !w.forge.works(token), Math.max(0, ended + 60_000 - Date.now()), "the credential to stop within 60 s of the session's end");
    const issued = w.forge.tokens.get(token)!;
    expect(issued.revoked! - ended).toBeLessThanOrEqual(60_000);
  }, LONG);
});
