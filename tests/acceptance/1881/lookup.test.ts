// #1881 on the real hub: a cut-off turn's pull request lookup asks the forge by the origin's owner and name.
//
// AC1: "With a stand-in forge that holds one open pull request for the session's branch under the origin's owner and
// name, a cut-off turn records that pull request's URL. On the merge base the request goes to `/repos/<scope ID>/pulls`
// and finds none"
// AC2: "In a checkout with no remote, the stand-in forge receives no request"
//
// The scenario is #85's cut-off turn (tests/acceptance/85/hub/cutoff.test.ts), in a real git checkout on branch
// fix-cart-total, against `deep hub run` started with DEEP_HUB_TEST_FORGE naming the stand-in forge: turn 1 you typed
// ends normally and the waiter runs; turn 2 you typed runs `git status` to its end, then `gh pr create`, which is let
// through and runs (with an origin, the forge gets the PR), and the connection drops before PostToolUse. The hub
// continues the session; the agent acts on the wake and sends the identical `gh pr create`, which the hub denies at
// PreToolUse with the earlier result: the pull request the forge holds for the branch, when it can read one. The
// stand-in forge logs every request the hub makes (README: The surfaces read). See README for how the design was read.
import { afterEach, describe, expect, it } from 'vitest';
import {
  begin, checkout, completedCall, denies, endAgents, events, ghPrCreate, listen, networkStop, newSession, replyWords, SECOND, shown, sleep, startedCall, startForge, stopTurn,
  typedTurn, until, waiter, wakeTurn, withHub, writeClaudeEnv, type Forge, type ForgeRequest, type Obj,
} from './helpers.ts';

/** The origin's owner and name, which the stand-in forge holds the pull request under. */
const OWNER = 'acme';
const REPO = 'cart';
const ORIGIN = `https://github.com/${OWNER}/${REPO}.git`;
/** The session's branch, checked out in its working folder. */
const BRANCH = 'fix-cart-total';
/** The pull request `gh pr create` opens on the forge: the first it holds. */
const PR_URL = `https://github.com/${OWNER}/${REPO}/pull/1`;
/** The cut-off turn's send, the same words both times. Its body names no issue, so no gate reads an issue for it. */
const PR_CREATE = 'gh pr create --title "Fix the cart total" --body "Sums the cart with tax"';
/** A continue reaches the record and the waiter within this (the #85 suite's 15 s). */
const CONTINUED = 15 * SECOND;
/** After the identical call's reply, how long a late request the hub sent may take to reach the forge. */
const SETTLE = 2 * SECOND;

/** A wrong program, planted at the test's side around the real hub: a forge request made as the identical call goes out, and the hub's reply to that call as the agent reads it. */
interface Plant { request?: (forge: Forge) => Promise<void>; identicalReply?: (reply: Obj | undefined) => Obj | undefined }
/** What one run of the cut-off turn showed. */
interface Seen {
  /** The hub's reply to the identical `gh pr create`, as the agent reads it. */
  reply: Obj | undefined;
  /** Every request the hub made to the stand-in forge (the test's own `gh pr create` POST is not among them). */
  requests: ForgeRequest[];
  /** The pull requests the forge holds at the end. */
  pulls: number;
  /** The session's readings in the record (`session.reading`). */
  readings: string[];
}

/** The cut-off turn in a checkout on BRANCH, with `origin` as its origin remote or with no remote at all. */
async function cutOffTurn(origin: string | undefined, plant: Plant = {}): Promise<Seen> {
  // The host the session's API calls go to listens, so the drop is the service's (one automatic continue).
  const api = await listen();
  const forge = await startForge(OWNER, REPO);
  let seen: Seen | undefined;
  try {
    await withHub((home) => writeClaudeEnv(home, { ANTHROPIC_BASE_URL: `http://127.0.0.1:${api.port}` }), async (hub) => {
      const cwd = checkout(hub.home, 'cart-work', BRANCH, origin);
      const s = newSession(hub, cwd);
      // Turn 1 you typed ends normally; Claude Code starts the waiter at its Stop.
      const p1 = await begin(hub, s);
      await stopTurn(hub, s, p1, 'Done.');
      await sleep(300);
      const wait = waiter(hub, s.id);
      let wake: Obj | undefined;
      void wait.woken.then((v) => { wake = v; });
      await sleep(300);
      try {
        // Turn 2 you typed: a read that ran to its end, then `gh pr create`, let through and run, and the connection drops before PostToolUse.
        const p2 = await typedTurn(hub, s, 'Fix the cart total and open the PR.');
        await completedCall(hub, s, 'Bash', { command: 'git status' }, { stdout: `On branch ${BRANCH}\nnothing to commit\n`, stderr: '', interrupted: false, isImage: false });
        const first = await startedCall(hub, s, 'Bash', { command: PR_CREATE });
        expect(denies(first), `precondition: the first gh pr create is let through: ${replyWords(first)}`).toBe(false);
        // With an origin, gh opens the PR on the forge under its owner and name; with no remote, gh has no repo to open one in.
        if (origin) expect(await ghPrCreate(forge, PR_CREATE, BRANCH), 'precondition: the forge holds the PR gh opened').toBe(PR_URL);
        await networkStop(hub, s, p2);

        const continued = await until(() => events(hub, 'session.continued', s.id)[0], CONTINUED);
        expect(continued?.data.because, 'precondition: the cut-off turn gets its one automatic continue').toBe('transient');
        const woken = await until(() => wake, CONTINUED);
        expect(woken, 'precondition: the waiter wakes the session with the continue').toBeDefined();

        // The agent acts on the continue: the wake's turn, then the identical call, which runs only if the hub lets it through.
        await wakeTurn(hub, s, String(woken!.text ?? ''));
        const planted = plant.request?.(forge);
        const got = await startedCall(hub, s, 'Bash', { command: PR_CREATE });
        await planted;
        const reply = plant.identicalReply ? plant.identicalReply(got) : got;
        if (!denies(reply) && origin) await ghPrCreate(forge, PR_CREATE, BRANCH);
        await sleep(SETTLE);
        seen = { reply, requests: [...forge.requests], pulls: forge.pulls.length, readings: events(hub, 'session.reading', s.id).map((e) => String(e.data.reading ?? '')) };
      } finally {
        wait.end();
      }
    }, { DEEP_HUB_TEST_FORGE: forge.url });
  } finally {
    await forge.close();
    await api.close();
  }
  return seen!;
}

/** AC2's checks on a run in a checkout with no remote. */
function noRequest(seen: Seen): void {
  expect(seen.requests, `AC2: in a checkout with no remote, the stand-in forge receives no request; it received: ${shown(seen.requests)}`).toEqual([]);
  // The design's "else the outcome unknown": with no forge to read, the identical send is still denied, never let through.
  expect(denies(seen.reply), `in a checkout with no remote, the identical gh pr create is still denied at PreToolUse, its outcome unknown: ${JSON.stringify(seen.reply)}`).toBe(true);
  expect(replyWords(seen.reply), 'the denial names the call').toContain('gh pr create');
}

afterEach(() => endAgents());

describe('a cut-off turn looks up its pull request by the origin\'s owner and name, on the real hub', () => {
  it(`AC1: with the forge holding one open PR for ${BRANCH} under ${OWNER}/${REPO}, the cut-off turn records that PR's URL, and the identical gh pr create is denied with it`, async () => {
    const seen = await cutOffTurn(ORIGIN);
    const paths = shown(seen.requests);
    expect(seen.readings.filter((r) => r.includes(PR_URL)), `AC1: the cut-off turn records the pull request's URL ${PR_URL} (the forge received: ${paths}; the session's readings: ${JSON.stringify(seen.readings)})`).not.toEqual([]);
    expect(seen.requests.filter((r) => r.method === 'GET' && r.path.startsWith(`/repos/${OWNER}/${REPO}/pulls`)).length, `the lookup asks the forge by the origin's owner and name, /repos/${OWNER}/${REPO}/pulls (the forge received: ${paths})`).toBeGreaterThan(0);
    expect(denies(seen.reply), `the identical gh pr create is denied at PreToolUse: ${JSON.stringify(seen.reply)}`).toBe(true);
    expect(replyWords(seen.reply), 'the denial gives the earlier result: the pull request the forge holds for the branch').toContain(PR_URL);
    expect(seen.pulls, 'the forge holds one PR: the identical call never ran').toBe(1);
  }, 120_000);

  it('AC2: in a checkout with no remote, the stand-in forge receives no request', async () => {
    noRequest(await cutOffTurn(undefined));
  }, 120_000);

  it('AC2 fails on a lookup that reaches the forge, naming its path, and on one that lets the identical call run', async () => {
    noRequest(await cutOffTurn(undefined));
    // Planted: a lookup that asks the forge though the checkout has no remote, by the folder's name.
    const asks = async (forge: Forge) => { await fetch(`${forge.url}/repos/cart-work/pulls?state=all&head=${encodeURIComponent(`cart-work:${BRANCH}`)}&per_page=10`).then((r) => r.text()); };
    await expect(cutOffTurn(undefined, { request: asks }).then(noRequest)).rejects.toThrow(/AC2: in a checkout with no remote, the stand-in forge receives no request; it received: GET \/repos\/cart-work\/pulls/);
    // Planted: no remote read as "the forge holds none", so the identical send runs.
    await expect(cutOffTurn(undefined, { identicalReply: () => ({ v: 1, exit: 0, stdout: '', stderr: '' }) }).then(noRequest)).rejects.toThrow(/the identical gh pr create is still denied at PreToolUse/);
  }, 360_000);
});
