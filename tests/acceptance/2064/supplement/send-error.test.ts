// #2064 Scope: "An error inside the rule refuses the call, naming the error. The repeated-send rule beside it (#85)
// does the same." The rule: the cut-off turn's identical gh pr create is denied at PreToolUse (#85; #1881: with the
// pull request the forge holds for the branch). Its lookup first reads the session's branch from the record. A
// planted record read failure: the session's table is renamed away in the record's own file for the one call, so the
// read throws SQLite's "no such table: sessions" (no hook in the hub, nothing mocked), and put back after the reply.
// The call must still be refused, and its reply must name that error. No wording of the hub's own is held.
//
// Scope coverage only (no acceptance criterion of the issue is about this rule). The twin runs the same scenario with
// nothing planted: the denial gives the pull request's URL, as #1881 reads it. The forge is the only stand-in.
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  begin, checkout, completedCall, denies, endAgents, events, ghPrCreate, listen, networkStop, newSession, replyWords, SECOND, sleep, startedCall, startForge, stopTurn,
  typedTurn, until, waiter, wakeTurn, withHub, writeClaudeEnv, type Obj,
} from '../../1881/helpers.ts';

const BRANCH = 'fix-cart-total';
const PR_URL = 'https://github.com/acme/cart/pull/1';
const PR_CREATE = 'gh pr create --title "Fix the cart total" --body "Sums the cart with tax"';

/** #1881's cut-off turn; with `plant`, the record's sessions read fails as the identical call goes out. Returns the hub's reply and the forge's pull requests. */
async function cutOffTurn(plant: boolean): Promise<{ reply: Obj | undefined; pulls: number }> {
  const api = await listen();
  const forge = await startForge('acme', 'cart');
  let seen: { reply: Obj | undefined; pulls: number } | undefined;
  try {
    await withHub((home) => writeClaudeEnv(home, { ANTHROPIC_BASE_URL: `http://127.0.0.1:${api.port}` }), async (hub) => {
      const cwd = checkout(hub.home, 'cart-work', BRANCH, 'https://github.com/acme/cart.git');
      const s = newSession(hub, cwd);
      const p1 = await begin(hub, s);
      await stopTurn(hub, s, p1, 'Done.');
      await sleep(300);
      const wait = waiter(hub, s.id);
      let wake: Obj | undefined;
      void wait.woken.then((v) => { wake = v; });
      await sleep(300);
      try {
        const p2 = await typedTurn(hub, s, 'Fix the cart total and open the PR.');
        await completedCall(hub, s, 'Bash', { command: 'git status' }, { stdout: `On branch ${BRANCH}\nnothing to commit\n`, stderr: '', interrupted: false, isImage: false });
        const first = await startedCall(hub, s, 'Bash', { command: PR_CREATE });
        expect(denies(first), `precondition: the first gh pr create is let through: ${replyWords(first)}`).toBe(false);
        expect(await ghPrCreate(forge, PR_CREATE, BRANCH), 'precondition: the forge holds the PR gh opened').toBe(PR_URL);
        await networkStop(hub, s, p2);
        const continued = await until(() => events(hub, 'session.continued', s.id)[0], 15 * SECOND);
        expect(continued?.data.because, 'precondition: the cut-off turn gets its one automatic continue').toBe('transient');
        const woken = await until(() => wake, 15 * SECOND);
        expect(woken, 'precondition: the waiter wakes the session with the continue').toBeDefined();
        await wakeTurn(hub, s, String(woken!.text ?? ''));

        const db = new DatabaseSync(join(hub.root, 'ledger.db'));
        db.exec('PRAGMA busy_timeout = 5000');
        if (plant) db.exec('ALTER TABLE sessions RENAME TO sessions_planted_2064');
        let reply: Obj | undefined;
        try { reply = await startedCall(hub, s, 'Bash', { command: PR_CREATE }); } finally {
          if (plant) db.exec('ALTER TABLE sessions_planted_2064 RENAME TO sessions');
          db.close();
        }
        if (!denies(reply)) await ghPrCreate(forge, PR_CREATE, BRANCH);
        seen = { reply, pulls: forge.pulls.length };
      } finally { wait.end(); }
    }, { DEEP_HUB_TEST_FORGE: forge.url });
  } finally { await forge.close(); await api.close(); }
  return seen!;
}

afterEach(() => endAgents());

describe('#2064 Scope: the repeated-send rule (#85) refuses on an error, naming it', () => {
  it('SCOPE twin: with nothing planted, the identical gh pr create is denied with the pull request the forge holds', async () => {
    const seen = await cutOffTurn(false);
    expect(denies(seen.reply), `the identical gh pr create is denied: ${JSON.stringify(seen.reply)}`).toBe(true);
    expect(replyWords(seen.reply), 'the denial gives the earlier result: the pull request').toContain(PR_URL);
  }, 180_000);

  it('SCOPE with a planted record read failure (no such table: sessions), the identical gh pr create is denied, naming that error', async () => {
    const seen = await cutOffTurn(true);
    expect(denies(seen.reply), `the identical gh pr create is still refused, never let through: ${JSON.stringify(seen.reply)}`).toBe(true);
    expect(seen.pulls, 'the forge holds one PR: the identical call never ran').toBe(1);
    expect(replyWords(seen.reply), 'SCOPE the refusal names the error the rule hit, the failed read of sessions').toMatch(/no such table: sessions/i);
  }, 180_000);
});
