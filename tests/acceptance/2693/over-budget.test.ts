// #2693.302a0e55: a document whose one checkpoint is larger than the budget keeps the checkpoint at its start
// and its newest one, and says so as a reading. It is never refused and never silently unbounded.
// `test.tight` declares a 16 KiB budget for its 65,536-byte checkpoints. Over a minute of play the live heap
// beyond the first frame stays within four checkpoints (the start's, the newest, the arrays the session
// steps with, and slack); on the merge base it holds all 121, about 7.9 MB, and the first test fails naming
// the bytes. The second reads the ring and seeks back, which still equals playing.
import { describe, expect, it } from 'vitest';
import { CHECKPOINT_BYTES, TIGHT_BUDGET, frozen, hashFailures, mib, probe, reading, sec, useProbes } from './helpers.ts';

const probes = useProbes(['plain', 'ring']);
const MINUTE = sec(60);
const SEEKS = [sec(59.9) + 1, sec(30) + 7, sec(0.2) + 3];

describe('#2693.302a0e55 one checkpoint larger than the budget keeps the start and the newest, says so, and is never refused or unbounded', () => {
  it('#2693.302a0e55 a document whose one checkpoint is larger than its budget is played, never refused, and holds no more than its start and newest checkpoints on the live heap', () => {
    const a = probe(probes.bin('plain'), { module: 'tight', play_to: MINUTE });
    expect(a.load_issues, 'the document loads with no issue: it is never refused').toEqual([]);
    expect(frozen(a), 'no frame froze').toEqual([]);
    expect(a.played.last.last_count, 'every step of the minute ran').toBe(3_601);
    const held = a.heap.held_since_start;
    expect(held, `a minute of play holds ${held} bytes (${mib(held)}) beyond its first frame, about ${Math.round(held / CHECKPOINT_BYTES)} checkpoints of ${CHECKPOINT_BYTES} bytes, against a budget of ${TIGHT_BUDGET}; at most ${4 * CHECKPOINT_BYTES} bytes (the start's and the newest checkpoints, the stepping arrays and slack)`).toBeLessThanOrEqual(4 * CHECKPOINT_BYTES);
  }, 3_600_000);

  it('#2693.302a0e55 the reading says the one checkpoint is over the budget and the ring holds the start and the newest, and seeks still equal playing', () => {
    const a = probe(probes.bin('ring'), { module: 'tight', play_to: MINUTE, seeks: SEEKS, play_side: true });
    expect(a.load_issues, 'the document loads with no issue: it is never refused').toEqual([]);
    expect(frozen(a), 'no frame froze').toEqual([]);
    const r = reading(a.reading, 'the tight ring after a minute');
    expect(r.budget, 'the ring\'s budget is the 16 KiB test.tight declares').toBe(TIGHT_BUDGET);
    expect(r.over_budget, 'the reading says one checkpoint is larger than the budget').toBe(true);
    expect(r.held.length, `the ring holds two checkpoints: ${JSON.stringify(r.held)}`).toBe(2);
    expect(r.held[0]!.t, 'the first is the start\'s').toBe(0);
    const newest = r.held[1]!.t;
    expect(newest <= MINUTE && MINUTE - newest <= r.spacing && newest > 0, `the second is the newest, within one spacing (${r.spacing} flicks) of the minute: ${newest}`).toBe(true);
    for (const h of r.held) expect(h.bytes, `the checkpoint at ${h.t} holds the stepping arrays, ${CHECKPOINT_BYTES} bytes or more, over the budget`).toBeGreaterThanOrEqual(CHECKPOINT_BYTES);
    expect(r.bytes, 'the reading\'s bytes are its two checkpoints\'').toBe(r.held[0]!.bytes + r.held[1]!.bytes);
    expect(hashFailures(a, 'the tight ring').map((f) => f.text), 'every seek equals playing').toEqual([]);
  }, 3_600_000);
});
