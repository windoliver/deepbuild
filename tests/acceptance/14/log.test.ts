// #14: log positions as consumers see them: a spooled request replayed after live events (AC14) and
// queued stream events behind a FULL verdict (AC19).
import { describe, expect, it } from 'vitest';
import { openRecord, testStorage } from '../../../packages/record/src/index.ts';
import type { Event, RecordStore } from '../../../packages/record/src/index.ts';
import { app, askCreated, claimMade, core, hook, makeClock, rowsBy, SECOND, seqAt, sessionStart, T0, toolAfter, ulidAt, userAsk, verdictMade } from './helpers.ts';

/** `count` stream events of one live session, appended and committed. */
async function stream(record: RecordStore, session: string, from: number, count: number): Promise<Event[]> {
  const out: Event[] = [];
  for (let i = 0; i < count; i++) {
    const at = from + i;
    const input = toolAfter(at, 'read', [`src/${i}.ts`], null, seqAt(at));
    const { log_pos } = await record.append(hook(session), input);
    out.push({ ...input, writer: 'hook', actor: 'you', scope: 'you', log_pos, evidence: [], seq: BigInt(input.seq!) });
  }
  return out;
}

describe('AC14 spool replay after a restart', () => {
  it('AC14 a request spooled while the hub was down lands at 521 after 20 live events ending at 520, becomes an ask, and a read after 520 returns it', async () => {
    const clock = makeClock();
    const record = await openRecord({ path: 'record.db', now: clock.now, storage: testStorage() });
    // With the hub stopped, deep-hook minted this Codex PermissionRequest's ID and seq at T0.
    const spooled = askCreated(T0, T0 + 3600 * SECOND, 'Codex asks to run npm publish');
    spooled.seq = seqAt(T0);
    const other = ulidAt(T0 + SECOND);
    clock.tick(10 * SECOND);
    await record.append(hook(other), sessionStart(clock.now(), other));
    await record.append(hook(other), userAsk(clock.now(), 1, 'go'));
    // 498 more events first, so the 20 live ones end at exactly 520.
    await stream(record, other, clock.tick(SECOND), 498);
    const live = await stream(record, other, clock.tick(SECOND), 20);
    expect(live[live.length - 1]!.log_pos, 'the 20 live events end at log_pos 520').toBe(520);
    for (const e of live) {
      expect(e.id > spooled.id, 'each live event has a newer ID than the spooled request').toBe(true);
      expect(e.seq! > BigInt(spooled.seq!), 'and a newer seq').toBe(true);
    }

    const replayed = await record.append(hook(other, { agent: 'codex' }), spooled);
    expect(replayed.log_pos, `the spooled request takes the next position`).toBe(521);
    const asks = rowsBy(await record.table('asks'), 'id', spooled.id);
    expect(asks, `ask ${spooled.id} became an ask`).toHaveLength(1);
    // A store that pages consumers by event ID or by seq returns nothing after the 20th live event.
    const after = await record.read({ after: 520 });
    expect(after.map((e) => e.id), `a read after 520 returns ask ${spooled.id}`).toEqual([spooled.id]);
    expect(after[0]!.log_pos).toBe(521);
    expect(after[0]!.seq).toBe(BigInt(spooled.seq!));
  });
});

describe('AC19 queued stream events and a FULL verdict take positions in commit order', () => {
  it('AC19 ten stream events queued for a NORMAL batch, a verdict committed FULL before the batch: a consumer that read the verdict reads all ten after it', async () => {
    const clock = makeClock();
    const record = await openRecord({ path: 'record.db', now: clock.now, storage: testStorage() });
    const S = ulidAt(T0 - SECOND);
    await record.append(hook(S), sessionStart(T0 - SECOND, S));
    await record.append(hook(S), userAsk(T0, 1, 'go'));
    const claim = claimMade(T0 + 1, 'task:01K74FX2B4D6F8H0K2M4P6R8T0', 1);
    await record.append(app(S), claim);
    await stream(record, S, clock.tick(SECOND), 797);   // 800 events so far
    expect(await record.read({ after: 799 }).then((r) => r.map((e) => e.log_pos)), '800 events so far').toEqual([800]);

    // Ten stream events go into the queue, not awaited; then the verdict commits with synchronous=FULL.
    const at = clock.tick(SECOND);
    const ten = Array.from({ length: 10 }, (_, i) => toolAfter(at + i, 'read', [`q/${i}.ts`], null, seqAt(at + i)));
    const queued = ten.map((e) => record.append(hook(S), e));
    const verdict = await record.append(core(), verdictMade(clock.tick(SECOND), claim.id, 'PASS', ['every requirement passed']));

    // The consumer: it holds 800, reads the verdict, and resumes from the last position it holds.
    const seen: Event[] = [];
    let cursor = 800;
    const first = await record.read({ after: cursor });
    expect(first.map((e) => e.log_pos), 'the verdict is what a consumer reads first after 800').toContain(verdict.log_pos);
    seen.push(...first);
    cursor = Math.max(cursor, ...first.map((e) => e.log_pos));
    const positions = (await Promise.all(queued)).map((a) => a.log_pos);
    for (let rounds = 0; rounds < 5 && seen.length < 11; rounds++) {
      const page = await record.read({ after: cursor });
      seen.push(...page);
      if (page.length) cursor = Math.max(cursor, ...page.map((e) => e.log_pos));
    }
    // A hub that numbers queued events before their batch commits gives the verdict 811 ahead of 801 to
    // 810; the consumer's refetch over that gap finds it empty and the ten are never delivered.
    expect(verdict.log_pos, `the verdict committed before the batch: its position is below the ten's (${positions.join(', ')}); position 801 would be the first the consumer never sees`).toBeLessThan(Math.min(...positions));
    expect(verdict.log_pos).toBe(801);
    expect([...positions].sort((a, b) => a - b), 'the ten take the positions after the verdict').toEqual(Array.from({ length: 10 }, (_, i) => 802 + i));
    const delivered = seen.map((e) => e.log_pos).sort((a, b) => a - b);
    expect(delivered, 'the consumer reads the verdict and all ten after it, with no gap; the first undelivered would be 801').toEqual(Array.from({ length: 11 }, (_, i) => 801 + i));
    for (const e of ten) expect(seen.some((s) => s.id === e.id), `stream event ${e.id} was delivered`).toBe(true);
  });
});
