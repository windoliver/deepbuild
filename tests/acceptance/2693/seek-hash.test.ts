// #2693.5e136ab2: after that hour, a seek to each of 100 seeded times gives the full-state hash that playing
// to that time gives. The seeks run in one session after the hour, each a jump back from the one before
// (descending times); the play is a fresh session played straight through every frame and every sought time.
// The full-state hash covers every carried-state row's hash and every node's result (README: The probe).
// The merge base keeps every checkpoint, so it passes the first test; the planted ring that lets go of the
// checkpoint at the start fails it on a seek into the first spacing, naming the time, which the second test
// shows.
import { describe, expect, it } from 'vitest';
import { FIRST_SPACING, HOUR, frozen, hashFailures, probe, reading, seededTimes, useProbes } from './helpers.ts';

const probes = useProbes(['plain', 'ring']);
const TIMES = seededTimes();

describe('#2693.5e136ab2 after the hour, 100 seeded seeks equal playing by full-state hash', () => {
  it('#2693.5e136ab2 after one hour of play, a seek to each of 100 seeded times gives the full-state hash playing to that time gives', () => {
    expect(TIMES.length, 'there are 100 seeded times').toBe(100);
    const a = probe(probes.bin('plain'), { module: 'ring', play_to: HOUR, seeks: TIMES, play_side: true });
    expect(frozen(a), 'no frame froze').toEqual([]);
    expect(a.seeks.map((s) => s.t), 'every seeded time was sought, in order').toEqual(TIMES);
    expect(a.play.length, 'the straight play reached every seeded time').toBe(100);
    const failures = hashFailures(a, 'after the hour');
    expect(failures.map((f) => f.text), 'every seek equals playing').toEqual([]);
  }, 3_600_000);

  it('#2693.5e136ab2 a planted ring that lets go of the checkpoint at the start fails on a seek into the first spacing, naming the time', () => {
    const a = probe(probes.bin('ring'), { module: 'ring', play_to: HOUR, seeks: TIMES, play_side: true, planted: 'ring_drops_start' });
    const r = reading(a.reading, 'the planted ring after the hour');
    const failures = hashFailures(a, 'the planted ring');
    expect(failures.length, 'the planted ring fails at least one seek').toBeGreaterThan(0);
    const first = failures[0]!;
    expect(first.t, `the planted ring's first failure is a seek into the first spacing (before ${FIRST_SPACING} flicks, the earliest the ring's second checkpoint can be): ${first.text}`).toBeLessThan(FIRST_SPACING);
    expect(first.text, 'the failure names the time').toContain(String(first.t));
    const outside = failures.filter((f) => f.t >= r.spacing);
    expect(outside.map((f) => f.text), `the planted ring fails only seeks into the first spacing (spacing ${r.spacing} flicks)`).toEqual([]);
  }, 3_600_000);
});
