// #3218 AC7: over 1,000 seeded sequences of asks and ends on two pools and two hosts, the table agrees at every step
// with a reference that keeps one sum per host and pool; after the hub restarts and folds the record, it holds the
// same leases with the same units. A rule stated with "never" (a pool's leases on a host never sum past n) is tested
// as a property (design: Universal rules are tested as properties).
//
// Each sequence is its own record in a temp folder, with `test.p1` as pool(10) and `test.p2` as pool(6), on `local` and
// `h2`. A step is one of:
// - an ask naming one to three distinct (pool, host) pairs, each with 1 to n units of its pool;
// - an ask naming one pair with n+1 to n+3 units, past its pool's size;
// - the end of one ask granted earlier and still held: each of its leases released (its holder is a plug-in's,
//   `ext:…`, so `release` ends it, as a package's lease on a run is ended);
// - the hub's restart: the record closed and opened again from its file, and the table opened on it (once in each
//   sequence, at a seeded step).
// The reference grants an ask when every pair it names has room for its units, BLOCKs it, naming the pair, when its
// units are past its pool's size, and otherwise refuses it naming the first pair, in the ask's order, without room.
import { rmSync } from 'node:fs';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Lease, Need, Plant, Resource } from '@deepbuild/leases';
import { json, tempDir } from './helpers.ts';
import { as, granted, grantedAsk, holding, openWorld, poolKind, TEST_PLUGIN, unitsOf, type World } from './world.ts';

const AC7 = '#3218.82a6e5ee';
const SEED = 0x3218_07;
const RUNS = 1000;
const POOLS = { 'test.p1': 10, 'test.p2': 6 } as const;
type Pool = keyof typeof POOLS;
const HOSTS = ['local', 'h2'] as const;
const PAIRS = (Object.keys(POOLS) as Pool[]).flatMap((pool) => HOSTS.map((host) => ({ pool, host })));
const resourceOf = (pair: number): Resource => ({ host: PAIRS[pair]!.host, kind: PAIRS[pair]!.pool, key: 'k' });
const sizeOf = (pair: number): number => POOLS[PAIRS[pair]!.pool];
const where = (pair: number): string => `${PAIRS[pair]!.pool} on ${PAIRS[pair]!.host}`;

type Step =
  | { op: 'ask'; needs: { pair: number; draw: number }[] }
  | { op: 'big'; pair: number; over: number }
  | { op: 'end'; pick: number }
  | { op: 'restart' };
const ask = fc.shuffledSubarray([0, 1, 2, 3], { minLength: 1, maxLength: 3 })
  .chain((pairs) => fc.array(fc.integer({ min: 0, max: 59 }), { minLength: pairs.length, maxLength: pairs.length })
    .map((draws) => ({ op: 'ask' as const, needs: pairs.map((pair, i) => ({ pair, draw: draws[i]! })) })));
const big = fc.record({ op: fc.constant('big' as const), pair: fc.integer({ min: 0, max: 3 }), over: fc.integer({ min: 1, max: 3 }) });
const end = fc.record({ op: fc.constant('end' as const), pick: fc.nat() });
const sequence = fc.tuple(
  fc.array(fc.oneof({ arbitrary: ask, weight: 6 }, { arbitrary: big, weight: 1 }, { arbitrary: end, weight: 3 }), { minLength: 4, maxLength: 14 }),
  fc.nat(),
).map(([steps, at]): Step[] => {
  const k = steps.length - (at % Math.ceil(steps.length / 2)); // the restart falls in the sequence's second half
  return [...steps.slice(0, k), { op: 'restart' }, ...steps.slice(k)];
});

interface Tally { asks: number; granted: number; refused: number; blocked: number; severalGranted: number; severalRefused: number; ends: number; restartsHolding: number; sequences: number }

/** One sequence against the reference; throws at the first step where the table and the reference disagree. */
async function play(steps: Step[], tally: Tally, plant?: Plant): Promise<void> {
  const dir = tempDir();
  const w: World = await openWorld({ dir, ...(plant ? { plant } : {}) });
  try {
    for (const [name, n] of Object.entries(POOLS)) await w.declare(TEST_PLUGIN, poolKind(name, n));
    const sums = PAIRS.map(() => 0);
    const live: { needs: { pair: number; units: number }[]; leases: Lease[] }[] = [];
    let restarted = false;
    let holder = 0;
    for (const [at, step] of steps.entries()) {
      const label = `step ${at + 1} (${step.op}${restarted ? ', after the restart' : ''})`;
      if (step.op === 'restart') {
        const before = await holding(w.table);
        if (before.some((l) => (l.units ?? 0) > 1)) tally.restartsHolding++;
        await w.restart();
        restarted = true;
        const after = new Map((await holding(w.table)).map((l) => [l.id, l]));
        for (const l of before) {
          const now = after.get(l.id);
          expect(now, `after the restart, the table no longer holds ${l.id} (${l.resource.kind} on ${l.resource.host}, ${l.units} units)`).toBeDefined();
          expect(now!.units, `after the restart, ${l.id} (${l.resource.kind} on ${l.resource.host}) holds ${now!.units} units, not ${l.units}`).toBe(l.units);
          expect(now!.resource, `after the restart, ${l.id} is on the same resource`).toEqual(l.resource);
        }
        expect(after.size, `after the restart, the table holds the ${before.length} leases it held before: ${json([...after.values()])}`).toBe(before.length);
        continue;
      }
      if (step.op === 'end') {
        if (!live.length) continue;
        const [done] = live.splice(step.pick % live.length, 1);
        for (const l of done!.leases) await w.table.release(l.id, []);
        for (const need of done!.needs) sums[need.pair]! -= need.units;
        tally.ends++;
      } else {
        const needs = step.op === 'big' ? [{ pair: step.pair, units: sizeOf(step.pair) + step.over }]
          : step.needs.map(({ pair, draw }) => ({ pair, units: 1 + (draw % sizeOf(pair)) }));
        const asked: Need[] = needs.map((need) => ({ resource: resourceOf(need.pair), mode: 'exclusive', units: need.units }));
        const who = `ext:seq-${holder++}`;
        const shown = needs.map((need) => `${need.units} of ${where(need.pair)} (${sums[need.pair]} of ${sizeOf(need.pair)} held)`).join(', ');
        const result = await w.table.ask(as(who), asked);
        tally.asks++;
        const tooBig = needs.find((need) => need.units > sizeOf(need.pair));
        const noRoom = needs.find((need) => sums[need.pair]! + need.units > sizeOf(need.pair));
        if (tooBig) {
          tally.blocked++;
          expect(result.status === 'BLOCKED' && result.reason, `${label}: an ask for ${shown} is BLOCKED by ${where(tooBig.pair)}'s size: ${json(result)}`).toBe('size');
          expect(result.status !== 'granted' && result.resource, `${label}: it names ${where(tooBig.pair)}`).toEqual(resourceOf(tooBig.pair));
        } else if (noRoom) {
          tally.refused++;
          if (needs.length > 1) tally.severalRefused++;
          expect(result.status === 'refused' && result.reason, `${label}: an ask for ${shown} is refused, as ${where(noRoom.pair)} has no room: ${json(result)}`).toBe('pool');
          expect(result.status !== 'granted' && result.resource, `${label}: it names the first pair without room, ${where(noRoom.pair)}`).toEqual(resourceOf(noRoom.pair));
        } else {
          tally.granted++;
          if (needs.length > 1) tally.severalGranted++;
          const leases = grantedAsk(result, needs.length, `${label}: an ask for ${shown}, which fits`);
          expect(leases.map((l) => [l.resource, unitsOf(l), l.holder]), `${label}: one lease per pair, in the ask's order, each with its units`)
            .toEqual(needs.map((need) => [resourceOf(need.pair), need.units, who]));
          for (const need of needs) sums[need.pair]! += need.units;
          live.push({ needs, leases });
        }
      }
      // At every step the table's sums agree with the reference's.
      const held = await holding(w.table);
      const got = PAIRS.map((pair) => held.filter((l) => l.resource.kind === pair.pool && l.resource.host === pair.host).reduce((s, l) => s + (l.units ?? NaN), 0));
      expect(got, `${label}: the table's sum on each host and pool (${PAIRS.map((_, i) => where(i)).join(', ')}) is the reference's; it holds ${json(held)}`).toEqual(sums);
    }
    tally.sequences++;
  } finally {
    await w.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

const tally = (): Tally => ({ asks: 0, granted: 0, refused: 0, blocked: 0, severalGranted: 0, severalRefused: 0, ends: 0, restartsHolding: 0, sequences: 0 });

async function restartWithSeven(plant?: Plant): Promise<void> {
  const w = await openWorld(plant ? { plant } : {});
  try {
    await w.declare(TEST_PLUGIN, poolKind('test.p1', 10));
    const seven = granted(await w.table.lease(as('ext:seven'), resourceOf(0), 'exclusive', 7), '7 units of the pool(10)');
    await w.restart();
    const r = await w.table.lease(as('ext:five'), resourceOf(0), 'exclusive', 5);
    expect(r.status, `after the restart, an ask for 5 units with 3 free is refused, but it is ${r.status}: the pool holds ${seven.id} of 7 units: ${json(r)}`).toBe('refused');
    if (r.status !== 'refused') throw Error('unreachable');
    expect(r.holders.map((l) => [l.id, unitsOf(l)]), `the refusal names ${seven.id} and its 7 units`).toEqual([[seven.id, 7]]);
  } finally {
    await w.close();
  }
}

describe(`AC7 ${AC7} the table against a reference that keeps one sum per host and pool`, () => {
  it(`AC7 ${AC7} over 1,000 seeded sequences of asks and ends on two pools and two hosts, the table agrees with the reference at every step, and after the restart holds the same leases with the same units`, async () => {
    const t = tally();
    await fc.assert(fc.asyncProperty(sequence, (steps) => play(steps, t)), { seed: SEED, numRuns: RUNS, endOnFailure: true, includeErrorInReport: true });
    console.log(`AC7 sequences: ${json(t)}`);
    expect(t.sequences, 'every sequence ran to its end').toBe(RUNS);
    // The sequences reach each answer often enough for the property to say something.
    for (const key of ['granted', 'refused', 'blocked', 'severalGranted', 'severalRefused'] as const) {
      expect(t[key], `${key} asks are at least 3% of the ${t.asks} asks: ${json(t)}`).toBeGreaterThanOrEqual(0.03 * t.asks);
    }
    expect(t.restartsHolding, `at least half the restarts hold a lease of more than one unit: ${json(t)}`).toBeGreaterThanOrEqual(RUNS / 2);
  }, 3_600_000);
  it(`AC7 ${AC7} a lease of 7 units of a pool(10): after the restart, an ask for 5 is refused naming it`, async () => {
    await restartWithSeven();
  });
  it(`AC7 ${AC7} (wrong program) a fold that drops the units grants past n after the restart and fails this test, naming the lease`, async () => {
    await expect(restartWithSeven('fold-drops-units')).rejects.toThrow(/after the restart, an ask for 5 units with 3 free is refused, but it is granted: the pool holds \S+ of 7 units/);
  });
  it(`AC7 ${AC7} (wrong program) a fold that drops the units fails the seeded sequences after the restart, naming the lease`, async () => {
    await expect(fc.assert(fc.asyncProperty(sequence, (steps) => play(steps, tally(), 'fold-drops-units')), { seed: SEED, numRuns: RUNS, endOnFailure: true, includeErrorInReport: true }))
      .rejects.toThrow(/after the restart, \S+ \(test\.p\d on (?:local|h2)\) holds \S+ units, not \d+/);
  }, 3_600_000);
});
