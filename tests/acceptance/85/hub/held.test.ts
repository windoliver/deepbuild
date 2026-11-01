// `#85.f2490b59` on the real hub: with a sign-in stop open on five sessions and a journey FAIL landing on one, no waiter
// fires, and the FAIL arrives in the resumed turn after /login. See README: The held FAIL. The FAIL lands as the slow
// lane's would, by `test.verdict` (verdict.made FAIL and claim.sent_back on the session's earlier claim); /login is the
// task's check passing, a PASS verdict on the check the task proves.
import { afterEach, describe, expect, it } from 'vitest';
import {
  assistantSays, begin, claimOf, completedCall, endAgents, events, inbox, newSession, plantVerdict, provesOf, REQ, rowOf, SECOND, signInStop, sleep, stopOf, stopTurn, stripHandle, typedTurn, until, waiter,
  withHub, type Hub, type Obj, type Session,
} from './helpers.ts';

const TAG = '#85.f2490b59';
const FIVE = ['folder-1', 'folder-2', 'folder-3', 'folder-4', 'folder-5'];
/** A task raised: the issue's budget of 10 s, and a margin for a loaded machine. */
const RAISED = 15 * SECOND;
/** The resumes: the design's 30 s from the check passing. */
const RESUME = 30 * SECOND;
/** Past every beat of the hub's asks timer and any route a delivery could take: what hasn't woken by then isn't coming. */
const SETTLE = 8 * SECOND;
/** The journey check's finding, as the FAIL's requirement carries it. */
const SMALLEST = 'the checkout journey fails at step 3: the cart total reads 0';

type Waiter = typeof waiter;
/** A wrong program, planted at the test's side: the waiter as the session runs it. */
interface Plant { waiter?: Waiter }

/** Whether a text carries the FAIL that landed: its verdict or claim by handle, or the journey check's finding. */
const carriesFail = (text: string, verdict: string, claim: string): boolean =>
  text.includes(stripHandle(verdict)) || text.includes(stripHandle(claim)) || text.includes(SMALLEST) || (/\bFAIL\b/.test(text) && /journey/.test(text));

/** A session that did a turn of work, whose stop went through: it has a claim, and its slow checks may land later. */
async function workedOnce(hub: Hub, s: Session): Promise<string> {
  const p = await begin(hub, s);
  await completedCall(hub, s, 'Edit', { file_path: `${s.cwd}/total.ts`, old_string: 'return 0;', new_string: 'return sum(items);' }, { filePath: `${s.cwd}/total.ts` });
  assistantSays(s, 'Fixed the total. Done.');
  await stopTurn(hub, s, p, 'Fixed the total. Done.');
  const claim = await until(() => claimOf(hub, s), RAISED);
  expect(claim, `session ${s.id} has a claim after its turn of work`).toBeDefined();
  return claim!;
}

async function heldFail(plant: Plant = {}): Promise<void> {
  const startWaiter = plant.waiter ?? waiter;
  await withHub(() => undefined, async (hub) => {
    const sessions = FIVE.map((folder) => newSession(hub, folder));
    const [one, , , , five] = sessions as [Session, Session, Session, Session, Session];
    const claims = new Map<string, string>();
    for (const s of sessions) claims.set(s.id, await workedOnce(hub, s));
    // The sign-in is revoked: the next turn of each stops on it.
    for (const s of sessions) await signInStop(hub, s, await typedTurn(hub, s, 'now run the tests'));
    for (const s of sessions) {
      const stop = await until(async () => { const st = await stopOf(hub, s); return st?.data.cause === 'sign_in_required' ? st : undefined; }, RAISED);
      expect(stop?.data.owner, `session ${s.id}'s stop is yours: a revoked sign-in`).toBe('you');
    }
    const open = await until(async () => { const rows = await inbox(hub); return rows.length ? rows : undefined; }, RAISED);
    expect(open?.map((r) => r.kind), 'the five sessions stopped by the sign-in share one task').toEqual(['unblock']);
    const task = String(open![0]!.ask);
    expect((await rowOf(hub, one))?.cause, "the session's row shows the stop's cause").toBe('sign_in_required');

    // Claude Code starts the waiter at the StopFailure; the hub keeps the newest.
    const wait = startWaiter(hub, one.id);
    let wake: Obj | undefined;
    void wait.woken.then((v) => { wake = v; });
    await sleep(300);
    try {
      // A journey FAIL lands on the first session: a slow check of its earlier claim.
      const verdict = await plantVerdict(hub, { session: one.id, claim: claims.get(one.id)!, outcome: 'FAIL', round: 1, requirements: [{ req: REQ, outcome: 'FAIL', check: 'journey', smallest: SMALLEST }], ran: [{ check: 'journey', outcome: 'failed' }] });
      expect(events(hub, 'claim.sent_back', one.id), 'the FAIL landed: the claim is sent back').toHaveLength(1);
      await sleep(SETTLE);
      expect(wake, `no waiter fires while the sign-in task ${task} is open: the first session's waiter was woken with ${JSON.stringify(wake)}`).toBeUndefined();
      expect(events(hub, 'session.continued'), 'no turn DeepBuild causes starts in a stopped session').toEqual([]);
      expect((await inbox(hub)).map((r) => r.ask), 'the task stays open').toEqual([task]);

      // /login: the task's check passes.
      const proves = provesOf(hub, task);
      expect(proves, `task ${task} names the check that proves it`).toBeDefined();
      const passedAt = Date.now();
      await plantVerdict(hub, { session: five.id, claim: claims.get(five.id)!, outcome: 'PASS', requirements: [{ req: REQ, outcome: 'PASS', check: proves! }] });
      const moot = await until(() => events(hub, 'ask.moot').find((e) => stripHandle(e.subject) === stripHandle(task)), RAISED);
      expect(moot, `task ${task} closes when its check passes`).toBeDefined();
      for (const s of sessions) {
        const continued = await until(() => events(hub, 'session.continued', s.id)[0], Math.max(1, passedAt + RESUME - Date.now()));
        expect(continued?.data.because, `session ${s.id} resumes within 30 s because its task closed`).toBe('task_closed');
      }
      const woken = await until(() => wake, RESUME);
      expect(woken, 'the first session\'s waiter wakes it with the resume').toBeDefined();
      const text = String(woken!.text ?? '');
      expect(text, `the resumed turn carries the resume, naming task ${task}: ${JSON.stringify(text)}`).toContain(stripHandle(task));
      expect(carriesFail(text, verdict, claims.get(one.id)!), `and the FAIL that landed while the task was open (verdict ${verdict} on claim ${claims.get(one.id)}, "${SMALLEST}") arrives in the resumed turn: ${JSON.stringify(text)}`).toBe(true);
    } finally {
      wait.end();
    }
  }, { DEEP_HUB_TEST_VERDICT: '1' });
}

/** A waiter that wakes the stopped session with the FAIL as it lands, as a wrong hub would: beside the real waiter, it polls the record for the claim sent back. */
const wakesOnFail: Waiter = (hub, session) => {
  const real = waiter(hub, session);
  let stop = false;
  const planted = new Promise<Obj | undefined>((resolve) => {
    const poll = () => {
      if (stop) return;
      const back = events(hub, 'claim.sent_back', session)[0];
      if (back) return resolve({ session, text: `DeepBuild sent this claim back: ${String(back.data.verdict)} FAIL (round ${String(back.data.round)}).` });
      setTimeout(poll, 200);
    };
    poll();
  });
  return { woken: Promise.race([real.woken, planted]), end: () => { stop = true; real.end(); } };
};

afterEach(() => endAgents());

describe('a FAIL landing on a session stopped by a sign-in, on the real hub', () => {
  it(`${TAG} with the sign-in task open on five sessions and a journey FAIL landing on one, no waiter fires; after /login the FAIL arrives in the resumed turn`, async () => {
    await heldFail();
  }, 120_000);

  it(`${TAG} fails on a waiter that wakes the stopped session, naming the delivery`, async () => {
    await heldFail();
    await expect(heldFail({ waiter: wakesOnFail })).rejects.toThrow(/no waiter fires while the sign-in task ask:[0-9A-Za-z]+ is open: the first session's waiter was woken with .*verdict:/);
  }, 240_000);
});
