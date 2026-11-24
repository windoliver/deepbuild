// #1881's first two criteria on the real hub (README): a cut-off turn's pull request lookup asks the stand-in forge by
// the origin's owner and name, and a checkout with no remote makes no request.
//
// The scenario is #85's cut-off turn: in a real git checkout on branch fix-cart-total, turn 1 you typed ends and the
// waiter runs; turn 2 you typed runs `git status` to its end, then `gh pr create`, let through and run (with an origin,
// the forge then holds one open pull request for the branch), and the connection drops before PostToolUse. The hub
// continues the session once; the agent acts on the wake and sends the identical `gh pr create`. At that PreToolUse the
// hub looks the branch's pull request up on the forge (`DEEP_HUB_TEST_FORGE`), and records one it finds.
import { afterEach, describe, expect, it } from 'vitest';
import {
  AC1, AC2, begin, checkout, completedCall, denies, endAgents, events, ghPrCreate, listen, networkStop, newSession, startedCall, startForge, stopTurn, typedTurn,
  waiter, wakeTurn, within, withHub, type Obj,
} from './helpers.ts';

const OWNER = 'acme';
const NAME = 'cart';
const ORIGIN = `https://github.com/${OWNER}/${NAME}.git`;
const BRANCH = 'fix-cart-total';
const PR_URL = `https://github.com/${OWNER}/${NAME}/pull/1`;
/** The cut-off turn's send, the same words both times. Its body names no issue. */
const PR_CREATE = 'gh pr create --title "Fix the cart total" --body "Sums the cart with tax"';
/** #85's suite gives the continue 15 s to reach the waiter. */
const CONTINUED_MS = 15_000;

interface Seen {
  /** Every request the hub made to the stand-in forge, `METHOD path?query`. */
  requests: string[];
  /** The session's `session.reading` events' readings. */
  readings: string[];
  /** The hub's reply to the identical `gh pr create`. */
  reply: Obj | undefined;
}

/** #85's cut-off turn in a checkout on BRANCH with `origin` as its origin remote, or with no remote. */
async function cutOffTurn(origin: string | undefined): Promise<Seen> {
  const api = await listen();
  const forge = await startForge(OWNER, NAME);
  let seen: Seen | undefined;
  try {
    await withHub({ ANTHROPIC_BASE_URL: `http://127.0.0.1:${api.port}` }, { DEEP_HUB_TEST_FORGE: forge.url }, async (hub) => {
      const cwd = checkout(hub.home, 'cart-work', BRANCH, origin);
      const s = newSession(hub, cwd);
      const p1 = await begin(hub, s);
      await stopTurn(hub, s, p1, 'Done.');
      const wait = waiter(hub, s.id);
      try {
        await wait.sent;
        const p2 = await typedTurn(hub, s, 'Fix the cart total and open the PR.');
        await completedCall(hub, s, 'Bash', { command: 'git status' }, { stdout: `On branch ${BRANCH}\nnothing to commit\n`, stderr: '', interrupted: false, isImage: false });
        const first = await startedCall(hub, s, 'Bash', { command: PR_CREATE });
        expect(denies(first), `precondition: the first gh pr create is let through: ${JSON.stringify(first)}`).toBe(false);
        // gh opens the pull request under the origin's owner and name; with no remote it has no repo to open one in.
        if (origin) expect(await ghPrCreate(forge, BRANCH), 'precondition: the forge holds one open pull request for the branch').toBe(PR_URL);
        await networkStop(hub, s, p2);

        const woken = await within(wait.woken, CONTINUED_MS);
        expect(woken?.text, `precondition: the waiter wakes the session with the one automatic continue: ${JSON.stringify(woken)}`).toBeTypeOf('string');
        expect(events(hub, 'session.continued', s.id).map((e) => e.because), 'precondition: the cut-off turn continued once, as a transient drop').toEqual(['transient']);
        await wakeTurn(hub, s, String(woken!.text));
        const reply = await startedCall(hub, s, 'Bash', { command: PR_CREATE });
        seen = { requests: [...forge.requests], readings: events(hub, 'session.reading', s.id).map((e) => String(e.reading ?? '')), reply };
      } finally {
        wait.end();
      }
    });
  } finally {
    await forge.close();
    await api.close();
  }
  return seen!;
}

afterEach(() => endAgents());

describe('#1881 a cut-off turn finds its pull request by the origin\'s owner and name, on the real hub', () => {
  it(`${AC1} with a stand-in forge holding one open pull request for the session's branch under the origin's owner and name, a cut-off turn records that pull request's URL`, async () => {
    const seen = await cutOffTurn(ORIGIN);
    const log = seen.requests.join(', ') || 'no request';
    expect(seen.readings.filter((r) => r.includes(PR_URL)), `the cut-off turn records ${PR_URL}; the forge received: ${log}; the session's readings: ${JSON.stringify(seen.readings)}`).toHaveLength(1);
    expect(seen.requests.filter((r) => r.startsWith(`GET /repos/${OWNER}/${NAME}/pulls`)), `the lookup asks /repos/${OWNER}/${NAME}/pulls; the forge received: ${log}`).not.toEqual([]);
  }, 120_000);

  it(`${AC2} in a checkout with no remote, the stand-in forge receives no request`, async () => {
    const seen = await cutOffTurn(undefined);
    expect(seen.requests, 'in a checkout with no remote, the stand-in forge receives no request').toEqual([]);
    // The identical send was handled as the cut-off turn's resend (the point the lookup is made at), not let through unread.
    expect(denies(seen.reply), `precondition: the identical gh pr create reached the hub's resend check and was denied: ${JSON.stringify(seen.reply)}`).toBe(true);
  }, 120_000);
});
