// #2693.08c5bf8c: one hour of play of a stepping document whose arrays total 64 KB holds at most 16 MiB of
// checkpoints, counted by the test. The count is the probe's own allocator's: the live heap after the hour,
// less the live heap after the first frame, which already holds the start's checkpoint and the arrays it
// shares. Everything the session holds beyond that counts, so a ring that reports small and holds more fails
// too. On the merge base the scheduler keeps every checkpoint it takes, 7,201 of them over the hour at
// 65,536 bytes each, and the test fails naming the bytes (about 477 MB on this Mac).
import { describe, expect, it } from 'vitest';
import { CHECKPOINT_BYTES, HOUR, MIB16, frozen, mib, probe, useProbes } from './helpers.ts';

const probes = useProbes(['plain']);

describe('#2693.08c5bf8c one hour of play holds at most 16 MiB of checkpoints', () => {
  it('#2693.08c5bf8c one hour of play of a stepping document whose arrays total 64 KB holds at most 16 MiB of checkpoints, counted on the live heap', () => {
    const a = probe(probes.bin('plain'), { module: 'ring', play_to: HOUR });
    expect(a.load_issues, 'the document loads with no issue').toEqual([]);
    expect(frozen(a), 'no frame froze').toEqual([]);
    expect(a.played.steps, 'the hour played every step at 60 Hz, 0 through 1 h').toBe(216_001);
    expect(a.played.last.last_count, 'the last step counted 216,001 steps').toBe(216_001);
    const held = a.heap.held_since_start;
    expect(held, `one hour of play holds ${held} bytes (${mib(held)}) on the live heap beyond its first frame, about ${Math.round(held / CHECKPOINT_BYTES)} checkpoints of ${CHECKPOINT_BYTES} bytes; at most ${MIB16} bytes (16 MiB) may be checkpoints`).toBeLessThanOrEqual(MIB16);
  }, 3_600_000);
});
