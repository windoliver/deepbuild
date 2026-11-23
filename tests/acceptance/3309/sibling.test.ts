// #3309.5263c09a: a sibling-session notice handed in a hook's reply whose deep-hook was already gone while that reply
// was being built goes with that session's next hook that reaches the agent, exactly once.
//
// #352's world: one repo, two worktrees, Claude Code sessions A and B. A edits src/cart.js and stops; then B edits the
// same file, so the hub keeps a notice for A ("session <B> also changed src/cart.js"), waiting for A's next hook. A's
// next hook is a prompt you typed naming an issue link. The hub reads that link from the forge before it builds the
// prompt's reply (#2068); the forge is this test's (DEEP_HUB_TEST_FORGE) and holds that read open. While it is held,
// deep-hook is stopped by its PID, as Claude Code stops a hook it gives up on, so its connection closes and the hub
// hears the hook is gone while the reply is still being built. Then the forge answers (404), well inside the hub's own
// deadline for handing notices, and the reply is built for a deep-hook that is gone. You then type once more. Over every
// hook A fired, the notice must reach the agent exactly once, with that last prompt.
import { randomUUID } from 'node:crypto';
import type { ChildProcess } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';
import {
  allEvents, ClaudeSession, cleanup, decision, fromSession, makeWorld, noticesTo, noticeText, shown, short, sleep, startHub, trust, worktree, type Ev, type Fired,
} from '../352/helpers.ts';
import { HeldForge, hookChildren, SIBLING } from './helpers.ts';

const forges: HeldForge[] = [];
afterAll(async () => {
  for (const f of forges) await f.close().catch(() => undefined);
  await cleanup();
}, 60_000);

const ISSUE = '/repos/acme/shop/issues/7';
const LOST = 'Also look at https://github.com/acme/shop/issues/7 while you are in the cart.';
const NEXT = 'Then round the cart total to cents.';
/** How long after the forge has the read deep-hook must be gone, and the read let go: well inside the hub's 1 s read and its hold's deadline. */
const KILL_WITHIN_MS = 600;
const RELEASE_WITHIN_MS = 800;

/** A notice's words as the agent reads them: B named by its short ID, and the file both changed. */
const carries = (told: string, b: string) => told.includes(`session ${short(b)}`) && told.includes('also changed src/cart.js');

describe(`${SIBLING} A sibling notice handed in a reply whose deep-hook was already gone while it was built goes with the session's next hook, once`, () => {
  it(`${SIBLING} session B changes the file A changed; A's prompt "${LOST}" carries the notice in a reply built while its issue read is held and after deep-hook was stopped; the notice reaches A exactly once, with "${NEXT}"`, async () => {
    const forge = await HeldForge.start(ISSUE);
    forges.push(forge);
    const w = makeWorld();
    const wa = worktree(w, 'wa', 'a/cart');
    const wb = worktree(w, 'wb', 'b/cart');
    await trust(w, [wa, wb]);
    const hub = await startHub(w, { DEEP_HUB_TEST_FORGE: forge.url, GH_TOKEN: 'test-forge-token' });

    const a = ClaudeSession.open(w, wa);
    await a.start();
    await a.typed('Fix the cart total.');
    await a.edit('src/cart.js', '  // end of cart', '  // totals are sums\n  // end of cart');
    await a.stop('Done: the cart total is fixed.');

    const b = ClaudeSession.open(w, wb);
    await b.start();
    await b.typed('Round the cart total.');
    await b.edit('src/cart.js', '(a, b) => a + b, 0)', '(a, b) => a + b, 0) / 1');
    await b.stop('Done: the total is rounded.');

    const before = noticesTo(await allEvents(hub), a.id).filter((n) => fromSession(n, b.id));
    expect(before.map((n) => noticeText(n)), `the run's precondition: no notice from ${b.id} was handed to ${a.id} before its next prompt, so B's change of src/cart.js waits for it`).toEqual([]);
    expect(a.fired.filter((f) => carries(f.told, b.id)).map((f) => f.event), `the run's precondition: nothing A was told so far names B's change of src/cart.js`).toEqual([]);

    // The lost prompt: its transcript entry, then its UserPromptSubmit, its reply's build held on the forge's read.
    a.prompt = randomUUID();
    a.entry({ promptId: a.prompt, type: 'user', message: { role: 'user', content: LOST }, origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' });
    const lostAt = a.fired.length;
    const firing = a.hook('UserPromptSubmit', { prompt: LOST });
    const seen = await forge.seen(10_000);
    const agent = (a as unknown as { agentProcess: { child: ChildProcess } }).agentProcess.child.pid!;
    const pids = seen ? hookChildren(agent, 'claude-code UserPromptSubmit') : [];
    for (const pid of pids) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
    const lost = await firing;
    const goneAt = Date.now();
    // The hub hears the connection close before the read is let go.
    await sleep(200);
    forge.release();
    if (!seen) throw Error(`BLOCKED: the hub never read ${ISSUE} from the test's forge for "${LOST}", so its reply's build was never held there; the forge saw ${JSON.stringify(forge.paths)}; the hook: ${shown(lost)}`);
    if (pids.length !== 1 || lost.signal !== 'SIGKILL') throw Error(`BLOCKED: deep-hook for "${LOST}" wasn't stopped while its reply was held (deep-hook processes found under the agent: ${JSON.stringify(pids)}); the hook: ${shown(lost)}`);
    const killMs = goneAt - forge.seenAt!;
    const releaseMs = forge.releasedAt! - forge.seenAt!;
    if (killMs > KILL_WITHIN_MS || releaseMs > RELEASE_WITHIN_MS) throw Error(`BLOCKED: the timing this run relies on wasn't met: deep-hook was gone ${killMs} ms and the read let go ${releaseMs} ms after the forge had it (limits ${KILL_WITHIN_MS} and ${RELEASE_WITHIN_MS} ms, inside the hub's 1 s read and its hold's deadline, about 1.5 s); rerun`);
    expect(carries(lost.stdout, b.id) || carries(lost.stderr, b.id), `the run's precondition: deep-hook was stopped before printing anything, so "${LOST}" went to the model without the notice: ${shown(lost)}`).toBe(false);
    // Past the hold (2 s): the reply was built and written to no one.
    await sleep(2500);

    await a.typed(NEXT);
    const nextAt = a.fired.length - 1;
    const events = await allEvents(hub);
    const delivered: Ev[] = noticesTo(events, a.id).filter((n) => fromSession(n, b.id) && carries(noticeText(n), b.id));
    const fileNotice = delivered[0] ? `${String(delivered[0].data.notice)} ("${noticeText(delivered[0])}", recorded delivered via ${String(delivered[0].data.via)})` : `"session ${short(b.id)} … also changed src/cart.js"`;
    const reached = a.fired
      .map((f: Fired, i: number) => ({ i, event: f.event, told: f.told }))
      .filter((f) => carries(f.told, b.id))
      .filter((f) => !(f.event === 'UserPromptSubmit' && decision(a.fired[f.i]!.ran) === 'deny'))
      .map((f) => ({ ...f, hook: f.i === lostAt ? `"${LOST}"` : f.i === nextAt ? `"${NEXT}"` : `hook ${f.i}`, told: f.told.slice(0, 300) }));
    expect(reached.length, `the notice ${fileNotice} from session ${b.id}, handed in "${LOST}"'s reply after deep-hook was gone, must reach session ${a.id} exactly once (not zero, not twice); replies carrying it: ${JSON.stringify(reached)}; the record's notice.delivered for it: ${JSON.stringify(delivered.map((n) => ({ notice: n.data.notice, via: n.data.via, log_pos: n.log_pos })))}; "${NEXT}" told: ${JSON.stringify(a.fired[nextAt]!.told.slice(0, 600))}`).toBe(1);
    expect(reached[0]!.hook, `the notice goes with the session's next hook that reaches the agent, "${NEXT}": ${JSON.stringify(reached)}`).toBe(`"${NEXT}"`);
  }, 600_000);
});
