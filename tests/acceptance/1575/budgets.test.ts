// #1575 AC1: #34's live-stream budget, 50 ms at p95, with a second reader replaying the whole record beside the
// live one. Counted as tests/acceptance/34/budgets.test.ts counts it: each sample runs from a hook's request
// written to the live reader's frame read; five runs after a warm-up go to #16's judge (PASS when all are within
// the limit, FAIL when all are over it by more than the margin, INCONCLUSIVE otherwise); and the number counts
// only on a reference Mac. On any other machine the runs are taken and printed as a reading, and the test is
// skipped as INCONCLUSIVE, never passed and never failed.
import { join } from 'node:path';
import { afterEach, describe, it } from 'vitest';
import { openRecord } from '../../../packages/record/src/index.ts';
import {
  asApp, cleanup, coldReader, Confirmer, confirmEnv, Conn, fromHere, hookRequest, installedRoot, judge, logEnd, makeHome, newSession,
  notReferenceMac, p95, startHub, subscribe, ulid, waitFor,
} from './helpers.ts';

afterEach(cleanup, 60_000);
const EVENTS = 100_000;
const problem = notReferenceMac();

describe('AC1 #1575.1adcfe64 with a reader replaying from 0 on a record of 100,000 events and a live reader beside it, the live reader\'s frames stay within the 50 ms budget', () => {
  it('AC1 #1575.1adcfe64 the live reader gets each event within 50 ms at p95 while the cold reader replays 100,000 events from 0: each sample from a hook\'s request written to the live reader\'s frame read', async (ctx) => {
    const home = makeHome();
    await seed(installedRoot(home));
    const hub = await startHub({ home, env: confirmEnv(new Confirmer()) }, 120_000);
    const live = await asApp(hub);
    await waitFor(async () => (await logEnd(live)) >= EVENTS, 120_000, 'the seeded record');
    const s = await subscribe(live, { after: await logEnd(live) });
    if (!s.reply.result) throw Error(`BLOCKED: the live reader's subscribe was refused: ${JSON.stringify(s.reply)}`);
    const session = newSession(hub.home, 'claude-code');
    let slowest = { ms: 0, at: 0 };
    /**
     * One run: the p95 of 20 samples. Each sample has a cold reader of its own, which subscribes after 0; once its
     * first frames have come and it is still in the first half of the record, so 50,000 frames or more of its
     * replay are still to come, one hook is sent and timed to the live reader's frame.
     */
    const once = async (): Promise<number> => {
      const samples: number[] = [];
      for (let i = 0; i < 20; i++) {
        const cold = await coldReader(hub);
        const from = live.received.length;
        await waitFor(() => cold.at() > 0 || cold.ended(), 120_000, 'the cold reader\'s first frame');
        const at = cold.at();
        if (cold.ended() || at >= EVENTS / 2) throw Error(`BLOCKED: the cold reader wasn't replaying when the hook was to be sent: at log_pos ${at} of ${EVENTS}${cold.ended() ? ', closed by the hub' : ''}`);
        const request = fromHere(hookRequest(session, 'PreToolUse'));
        const hook = await Conn.open(hub.socket);
        const t0 = hook.send(request);
        const frame = await live.seek((l) => l.id === s.sub && l.event?.id === request.id, from, 120_000);
        hook.close();
        cold.close();
        if (!frame) throw Error(`BLOCKED: no frame for hook ${request.id}`);
        samples.push(frame.at - t0);
        if (frame.at - t0 > slowest.ms) slowest = { ms: frame.at - t0, at };
      }
      return p95(samples);
    };
    await once();
    slowest = { ms: 0, at: 0 };
    const runs: number[] = [];
    for (let i = 0; i < 5; i++) runs.push(await once());
    const name = `AC1 live frame p95 (ms) beside the cold reader replaying ${EVENTS} events from 0 (the slowest live frame, ${slowest.ms.toFixed(0)} ms, was sent with the cold reader at ${slowest.at} of ${EVENTS})`;
    if (problem) {
      const reading = `INCONCLUSIVE (reading only): ${problem}: ${name}: ${runs.map((r) => r.toFixed(3)).join(', ')} against 50`;
      console.log(reading);
      ctx.skip(reading);
    }
    judge(ctx, name, runs, 50);
  }, 900_000);
});

/** 100,000 events in the ledger, through the record (#14), as #34's budgets seed history: 100 sessions of 1,000. */
async function seed(root: string): Promise<void> {
  let now = Date.now() - 3_600_000;
  const record = await openRecord({ path: join(root, 'ledger.db'), now: () => now });
  const conn = (session: string) => ({ writer: 'hook', actor: 'you', scope: 'you', session, agent: 'claude-code' });
  let n = 0;
  const seq = (ms: number) => (BigInt(ms) * 1_000_000n + BigInt(++n % 1_000_000)).toString();
  for (let s = 0; s < EVENTS / 1000; s++) {
    const session = ulid(now);
    const pending: Promise<unknown>[] = [record.append(conn(session), { v: 1, id: ulid(now), kind: 'session.start', ts: now, data: { agent: 'claude-code', worktree: '~/src/shop', branch: 'main', thread: session } })];
    for (let k = 1; k < 1000; k++) {
      now += 10;
      pending.push(record.append(conn(session), { v: 1, id: ulid(now), kind: k % 2 ? 'tool.before' : 'tool.after', ts: now, seq: seq(now), data: { kind: 'shell', paths: [], command: `npm test -- src/${k}.test.ts` } }));
    }
    await Promise.all(pending);
  }
  await record.close();
}
