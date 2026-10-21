// #14 under the design's test VFS: what a power cut keeps and loses (AC9, AC15, AC20), a storage that
// refuses appends for 30 s (AC24), and the sync each FULL commit asks for (AC25).
import { describe, expect, it } from 'vitest';
import { openRecord, testStorage } from '../../../packages/record/src/index.ts';
import type { Clock } from './helpers.ts';
import type { RecordStore, TestStorage } from '../../../packages/record/src/index.ts';
import {
  allEvents, app, askAnswered, askCreated, claimMade, core, countEvents, decisionCreated, expectEventsLost, expectOpen, expectRefused, hook,
  makeClock, rowsBy, runStarted, SECOND, seqAt, sessionAttention, sessionStart, T0, toolAfter, ulidAt, userAsk, verdictMade,
} from './helpers.ts';

const open = (storage: TestStorage, clock: Clock): Promise<RecordStore> => openRecord({ path: 'record.db', now: clock.now, storage });

async function tools(record: RecordStore, session: string, from: number, count: number): Promise<number> {
  let highest = 0;
  for (let i = 0; i < count; i++) {
    const { log_pos } = await record.append(hook(session), toolAfter(from + i, 'read', [`src/${i}.ts`], null, seqAt(from + i)));
    highest = Math.max(highest, log_pos);
  }
  return highest;
}

describe('AC9 a crash right after a FULL commit keeps its row; dropped stream events leave a claim INVALID', () => {
  it('AC9 the test VFS proves itself: a commit made with synchronous=NORMAL is lost at a cut', async () => {
    const storage = testStorage();
    const clock = makeClock();
    const S = ulidAt(T0 - SECOND);
    const record = await open(storage, clock);
    await record.append(hook(S), toolAfter(T0, 'read', ['a.ts'], null));
    expect(await countEvents(record)).toBe(1);
    storage.cutPower();
    const again = await open(storage, clock);
    expect(await countEvents(again), 'the NORMAL commit is gone').toBe(0);
  });

  it('AC9 a verdict, a decision, an answer and a send\'s key survive a cut right after their commits; the claim whose stream events were dropped reads INVALID, cause events lost', async () => {
    const storage = testStorage();
    const clock = makeClock();
    const Z = ulidAt(T0 - 2 * SECOND), A = ulidAt(T0 - SECOND);
    let record = await open(storage, clock);
    // Session Z's claim gets its verdict; session A's claim is open.
    await record.append(hook(Z), sessionStart(T0 - 2 * SECOND, Z));
    const claimZ = claimMade(T0 - SECOND, 'task:01K74FX2B4D6F8H0K2M4P6R8T0', 1);
    await record.append(app(Z), claimZ);
    await record.append(hook(A), sessionStart(T0 - SECOND, A));
    await record.append(hook(A), userAsk(T0, 1, 'go'));
    const claimA = claimMade(T0 + 1, 'task:01K74FX2B4D6F8H0K2M4P6R8T1', 1);
    await record.append(app(A), claimA);
    const verdict = verdictMade(T0 + 2, claimZ.id, 'PASS', ['every requirement passed']);
    await record.append(core(), verdict);
    const ask = askCreated(T0 + 3, T0 + 3600 * SECOND);
    await record.append(app(), ask);
    const decision = decisionCreated(T0 + 4, ask.id);
    await record.append(core(), decision);
    const answer = askAnswered(T0 + 5, ask.id);
    await record.append(core(), answer);
    // A send's key: your yes to sending a file, by hash, to a destination.
    const sendAsk = askCreated(T0 + 6, T0 + 3600 * SECOND, 'Send 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08 to api.github.com?');
    await record.append(app(), sendAsk);
    const sendKey = askAnswered(T0 + 7, sendAsk.id);
    await record.append(core(), sendKey);
    // Then session A's stream, after the last FULL commit.
    await tools(record, A, T0 + SECOND, 20);
    storage.cutPower();

    record = await open(storage, clock);
    const ids = new Set((await allEvents(record)).map((e) => e.id));
    expect(ids.has(verdict.id), 'the verdict survived').toBe(true);
    expect(ids.has(decision.id), 'the decision survived').toBe(true);
    expect(ids.has(answer.id), 'the answer survived').toBe(true);
    // A store that commits a send's key with synchronous=NORMAL loses it here.
    expect(ids.has(sendKey.id), 'the send\'s key survived').toBe(true);
    expect(rowsBy(await record.table('verdicts'), 'id', verdict.id).length + rowsBy(await record.table('verdicts'), 'id', `verdict:${verdict.id}`).length, 'the verdicts row is there').toBeGreaterThan(0);
    expect(rowsBy(await record.table('decisions'), 'id', decision.id).length, 'the decisions row is there').toBeGreaterThan(0);
    const asks = await record.table('asks');
    expect(rowsBy(asks, 'id', ask.id)[0]?.status, 'the answer is read back from the asks projection').toBe('answered');
    expect(rowsBy(asks, 'id', sendAsk.id)[0]?.status, 'your yes to the send is read back from the asks projection').toBe('answered');
    // A claim whose stream events were dropped reads INVALID with the cause, never PASS.
    await expectEventsLost(record, claimA.id, 'after the cut');
  });
});

describe('AC15 positions survive a power cut', () => {
  it('AC15 after 1,000 NORMAL stream events and a cut, 10 appends take positions above every one handed out, and no position belongs to two events', async () => {
    const storage = testStorage();
    const clock = makeClock();
    const S = ulidAt(T0 - SECOND);
    let record = await open(storage, clock);
    await record.append(hook(S), sessionStart(T0 - SECOND, S));
    const highest = await tools(record, S, T0, 1000);
    expect(highest).toBeGreaterThanOrEqual(1001);
    storage.cutPower();

    record = await open(storage, clock);
    const survived = await allEvents(record);
    const positions: number[] = [];
    for (let i = 0; i < 10; i++) {
      const { log_pos } = await record.append(hook(S), toolAfter(T0 + 2000 + i, 'edit', [`after/${i}.ts`], null));
      positions.push(log_pos);
    }
    // A store that takes the next log_pos from the largest one left in the table reuses the lost positions.
    const reused = positions.find((p) => p <= highest);
    expect(reused, `the first position reused after the cut: ${reused} (the highest handed out before it was ${highest})`).toBeUndefined();
    const all = await allEvents(record);
    const seen = new Map<number, string>();
    for (const e of all) {
      expect(seen.get(e.log_pos), `log_pos ${e.log_pos} belongs to two events: ${seen.get(e.log_pos)} and ${e.id}`).toBeUndefined();
      seen.set(e.log_pos, e.id);
    }
    expect(all.length).toBe(survived.length + 10);
  });
});

describe('AC20 lost stream events are found', () => {
  async function scene(storage: TestStorage, clock: Clock): Promise<{ record: RecordStore; claimA: string; claimB: string }> {
    const record = await open(storage, clock);
    const A = ulidAt(T0 - 2 * SECOND), B = ulidAt(T0 - SECOND);
    await record.append(hook(B), sessionStart(T0 - SECOND, B));
    const claimB = claimMade(T0, 'task:01K74FX2B4D6F8H0K2M4P6R8T2', 1);
    await record.append(app(B), claimB);
    await record.append(core(), runStarted(T0 + 1, claimB.id, 'app.slow-journey'));   // B's claim is open on a slow check
    await record.append(hook(A), sessionStart(T0 + 2, A));
    await record.append(hook(A), userAsk(T0 + 3, 1, 'go'));
    const claimA = claimMade(T0 + 4, 'task:01K74FX2B4D6F8H0K2M4P6R8T3', 1);
    await record.append(app(A), claimA);
    // B ends; then the hub's last synchronous=FULL commit.
    await record.append(app(B), sessionAttention(T0 + 5, B, 'finished'));
    const ask = askCreated(T0 + 6, T0 + 3600 * SECOND);
    await record.append(app(), ask);
    await record.append(core(), decisionCreated(T0 + 7, ask.id));
    // A writes 50 stream events after it, while its claim is open.
    await tools(record, A, T0 + SECOND, 50);
    return { record, claimA: claimA.id, claimB: claimB.id };
  }

  it('AC20 after a cut with no clean stop, A\'s claim is INVALID, cause events lost, and B\'s stays open', async () => {
    const storage = testStorage();
    const clock = makeClock();
    const { claimA, claimB } = await scene(storage, clock);
    storage.cutPower();
    const record = await open(storage, clock);
    // A hub that marks only claims whose surviving events come after the last FULL commit finds none of A's.
    await expectEventsLost(record, claimA, `claim ${claimA} of session A`);
    await expectOpen(record, claimB, `claim ${claimB} of session B, which ended before the last FULL commit`);
  });

  it('AC20 after a clean stop and a start, both stay open', async () => {
    const storage = testStorage();
    const clock = makeClock();
    const { record: first, claimA, claimB } = await scene(storage, clock);
    await first.close();
    const record = await open(storage, clock);
    await expectOpen(record, claimA, 'claim of session A after a clean stop');
    await expectOpen(record, claimB, 'claim of session B after a clean stop');
  });
});

describe('AC24 appends refused for 30 s', () => {
  it('AC24 a session that ran 5 tool calls while the storage refused appends, and claims done once they work, gets INVALID, cause events lost; a session with no refused appends stays open', async () => {
    const storage = testStorage();
    const clock = makeClock();
    const record = await open(storage, clock);
    const A = ulidAt(T0 - 2 * SECOND), C = ulidAt(T0 - SECOND);
    for (const s of [A, C]) {
      await record.append(hook(s), sessionStart(T0 - SECOND, s));
      await record.append(hook(s), userAsk(T0, 1, 'go'));
    }
    storage.refuseWrites = true;
    const start = clock.now();
    for (let i = 0; i < 5; i++) {
      const at = clock.tick(5 * SECOND);
      await expectRefused(record.append(hook(A), toolAfter(at, 'edit', [`src/${i}.ts`], null)), 'storage', {}, `tool call ${i + 1} in the window`);
    }
    clock.set(start + 30 * SECOND);
    storage.refuseWrites = false;
    const claimA = claimMade(clock.tick(SECOND), 'task:01K74FX2B4D6F8H0K2M4P6R8T4', 1);
    await record.append(app(A), claimA);
    const claimC = claimMade(clock.tick(SECOND), 'task:01K74FX2B4D6F8H0K2M4P6R8T5', 1);
    await record.append(app(C), claimC);
    // A hub that only turns gates watch-only during the window passes the claim.
    await expectEventsLost(record, claimA.id, `claim ${claimA.id}, made after 5 refused appends`);
    await expectOpen(record, claimC.id, 'a session whose appends were never refused');
  });
});

describe('AC25 each synchronous=FULL commit syncs with F_FULLFSYNC on macOS', () => {
  it('AC25 a scripted run: a verdict, a decision, an answer and a send\'s key each sync full, and no sync is plain', async (ctx) => {
    if (process.platform !== 'darwin') ctx.skip(`INCONCLUSIVE: F_FULLFSYNC is a macOS matter; this is ${process.platform}`);
    const storage = testStorage();
    const clock = makeClock();
    const record = await open(storage, clock);
    const S = ulidAt(T0 - SECOND);
    await record.append(hook(S), sessionStart(T0 - SECOND, S));
    const claim = claimMade(T0, 'task:01K74FX2B4D6F8H0K2M4P6R8T6', 1);
    await record.append(app(S), claim);
    await tools(record, S, T0 + 1, 100);
    const ask = askCreated(T0 + SECOND, T0 + 3600 * SECOND);
    await record.append(app(), ask);
    const sendAsk = askCreated(T0 + SECOND + 1, T0 + 3600 * SECOND, 'Send 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08 to api.github.com?');
    await record.append(app(), sendAsk);
    const fulls = [
      ['verdict.made', verdictMade(T0 + 2 * SECOND, claim.id, 'PASS', ['every requirement passed'])],
      ['decision.created', decisionCreated(T0 + 2 * SECOND + 1, ask.id)],
      ['ask.answered', askAnswered(T0 + 2 * SECOND + 2, ask.id)],
      ["a send's key (ask.answered)", askAnswered(T0 + 2 * SECOND + 3, sendAsk.id)],
    ] as const;
    for (const [name, input] of fulls) {
      const before = storage.syncs().filter((s) => s.mode === 'full').length;
      await record.append(core(), input);
      const full = storage.syncs().filter((s) => s.mode === 'full').length;
      expect(full, `the ${name} commit synced with F_FULLFSYNC`).toBeGreaterThan(before);
      // A store left at SQLite's default, fullfsync off, records a plain fsync for this commit.
      expect(storage.syncs().filter((s) => s.mode === 'plain'), `the ${name} commit asked for a plain fsync`).toEqual([]);
    }
    await record.close();
    expect(storage.syncs().filter((s) => s.mode === 'plain'), 'plain fsync for none, the close included').toEqual([]);
    expect(storage.syncs().filter((s) => s.mode === 'full').length).toBeGreaterThanOrEqual(fulls.length);
  });
});
