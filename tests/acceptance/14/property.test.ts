// #14 AC3: for at least 1,000 seeded event streams, every projection after live appends equals its rebuild
// from the log a simulated day later, compared row by row in primary-key order. Streams mix ties in seq,
// clock steps back and forward inside and between turns, PostToolUse after Stop, spool batches replayed
// late and twice, and a lease and an ask passing their deadlines on the test clock.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { openRecord, PROJECTIONS, testStorage } from '../../../packages/record/src/index.ts';
import type { EventInput, RecordStore } from '../../../packages/record/src/index.ts';
import {
  agentStop, app, askAnswered, askCreated, askDefaulted, claimMade, core, DAY, firstTableDifference, hook, leaseAcquired, leaseReleased,
  leaseStale, makeClock, mulberry32, rowsBy, SECOND, seqAt, sessionStart, snapshot, T0, toolAfter, toolBefore, ulidAt, userAsk, verdictMade,
} from './helpers.ts';

const SEED = 0x14_03;
const RUNS = 1000;

const scenario = fc.record({
  seed: fc.integer({ min: 0, max: 2 ** 31 - 1 }),
  turns: fc.integer({ min: 1, max: 3 }),
  tools: fc.integer({ min: 0, max: 4 }),
  ties: fc.boolean(),
  backInTurn: fc.boolean(),
  backBetween: fc.boolean(),
  forward: fc.boolean(),
  lateAfterStop: fc.boolean(),
  spool: fc.constantFrom('none', 'late', 'twice'),
  lease: fc.constantFrom('none', 'expires', 'released', 'held'),
  ask: fc.constantFrom('none', 'answered', 'defaulted', 'open'),
  verdict: fc.boolean(),
});
type Scenario = typeof scenario extends fc.Arbitrary<infer T> ? T : never;

async function play(record: RecordStore, s: Scenario): Promise<{ leaseKey: string; askId?: string }> {
  const rng = mulberry32(s.seed);
  const clock = makeClock(T0 + Math.floor(rng() * 1000) * SECOND);
  const S = ulidAt(clock.now());
  const leaseKey = String(4000 + (s.seed % 1000));
  await record.append(hook(S), sessionStart(clock.tick(10), S));
  let askId: string | undefined;
  let held: EventInput[] = [];
  const outcomes = ['PASS', 'FAIL', 'INVALID', 'BLOCKED', 'INCONCLUSIVE'] as const;
  for (let k = 1; k <= s.turns; k++) {
    clock.tick(k > 1 && s.backBetween ? -3 * SECOND : SECOND + Math.floor(rng() * 4 * SECOND));
    await record.append(hook(S), userAsk(clock.now(), k, `prompt ${k}`));
    if (k === 1 && s.spool !== 'none') {
      // A spool batch: minted now, with these IDs and stamps, appended only after later events.
      held = [toolBefore(clock.tick(10), 'fetch', [], null), toolAfter(clock.tick(10), 'fetch', [], null)];
    }
    if (k === 1 && s.lease !== 'none') await record.append(app(S), leaseAcquired(clock.tick(10), leaseKey, S, clock.now() + 2 * SECOND));
    if (k === 1 && s.ask !== 'none') {
      const ask = askCreated(clock.tick(10), clock.now() + 2 * SECOND);
      askId = ask.id;
      await record.append(app(S), ask);
    }
    for (let i = 0; i < s.tools; i++) {
      clock.tick(i === 1 && s.backInTurn ? -500 : 200);
      const at = clock.now();
      const before = toolBefore(at, 'read', [`src/${k}/${i}.ts`], null, seqAt(at));
      const after = toolAfter(at + 50, 'read', [`src/${k}/${i}.ts`], null, s.ties ? before.seq! : seqAt(at + 50));
      await record.append(hook(S), before);
      await record.append(hook(S), after);
    }
    if (s.forward && k === 1) clock.tick(3600 * SECOND);
    const stopAt = clock.tick(SECOND);
    await record.append(hook(S), agentStop(stopAt, S, k, seqAt(stopAt)));
    if (s.lateAfterStop) await record.append(hook(S), toolAfter(clock.tick(100), 'write', [`src/${k}/late.ts`], null, seqAt(stopAt - 100)));
    const claim = claimMade(clock.tick(1), 'task:01K74FX2B4D6F8H0K2M4P6R8T0', k);
    await record.append(app(S), claim);
    if (s.verdict) await record.append(core(), verdictMade(clock.tick(1), claim.id, outcomes[Math.floor(rng() * outcomes.length)]!, ['judged']));
    if (held.length) {
      for (const e of held) await record.append(hook(S), e);           // replayed late
      if (s.spool === 'twice') for (const e of held) await record.append(hook(S), e);   // and again, after a crash
      held = [];
    }
  }
  // Deadlines pass on the test clock; the lease manager and the ask router say so with events.
  clock.tick(5 * SECOND);
  if (s.lease === 'expires') await record.append(core(S), leaseStale(clock.tick(1), leaseKey, S, clock.now() - 5 * SECOND));
  if (s.lease === 'released') await record.append(app(S), leaseReleased(clock.tick(1), leaseKey, S, clock.now() - 5 * SECOND));
  if (askId && s.ask === 'answered') await record.append(core(), askAnswered(clock.tick(1), askId));
  if (askId && s.ask === 'defaulted') await record.append(core(), askDefaulted(clock.tick(1), askId));
  return askId === undefined ? { leaseKey } : { leaseKey, askId };
}

describe('AC3 every projection after live appends equals its rebuild from the log a simulated day later', () => {
  it(`AC3 seeded property, ${RUNS} streams`, async () => {
    await fc.assert(
      fc.asyncProperty(scenario, async (s) => {
        const clock = makeClock();
        const record = await openRecord({ path: 'record.db', now: clock.now, storage: testStorage() });
        const { leaseKey, askId } = await play(record, s);
        const live = await snapshot(record, PROJECTIONS);
        // A state that comes from time comes from an event that says so, never from the clock.
        if (s.lease !== 'none') {
          const rows = rowsBy(live.get('leases')!, 'key', leaseKey);
          expect(rows, `leases has the row for key ${leaseKey}`).toHaveLength(1);
          const state = String(rows[0]!.state);
          if (s.lease === 'expires') expect(state, `leases row ${leaseKey}: stale, as its lease.stale event says`).toBe('stale');
          else expect(state, `leases row ${leaseKey}: past expires with no lease.stale event, it isn't stale`).not.toBe('stale');
        }
        if (askId) {
          const rows = rowsBy(live.get('asks')!, 'id', askId);
          expect(rows, `asks has the row ${askId}`).toHaveLength(1);
          if (s.ask === 'defaulted') expect(String(rows[0]!.outcome), `asks row ${askId}: defaulted, as its event says`).toBe('defaulted');
          else expect(String(rows[0]!.outcome), `asks row ${askId}: past its deadline with no ask.defaulted event, it isn't defaulted`).not.toBe('defaulted');
        }
        clock.set(clock.now() + DAY);
        await record.rebuild();
        const rebuilt = await snapshot(record, PROJECTIONS);
        // A projection that reads the clock for a lease's stale state differs here, named by table and row.
        const difference = firstTableDifference(live, rebuilt);
        expect(difference, `stream ${JSON.stringify(s)}: ${difference ?? ''}`).toBeUndefined();
        await record.close();
      }),
      { seed: SEED, numRuns: RUNS, endOnFailure: true },
    );
  }, 900_000);
});
