// #2693.769d2c70: a seek steps forward at most one spacing's steps, counted by the test, and the spacing after
// an hour is in the reading. The steps are those the seek's frame ran of the stepping module, as the
// scheduler's frame report lists them; the spacing and the checkpoints held are the ring's reading
// (README: The reading). The planted ring that keeps only the newest checkpoint has none at or before an
// earlier seek, steps from wherever it can for every one of them, and fails naming the steps; it gets five
// seeks, the five latest seeded times, since each costs most of an hour's steps.
import { describe, expect, it } from 'vitest';
import { FIRST_SPACING, HOUR, MIB16, STEP, frozen, probe, reading, seededTimes, stepFailures, useProbes } from './helpers.ts';

const probes = useProbes(['ring']);
const TIMES = seededTimes();

describe('#2693.769d2c70 a seek steps forward at most one spacing\'s steps, and the spacing after an hour is in the reading', () => {
  it('#2693.769d2c70 after one hour of play the reading names the spacing, and each of 100 seeded seeks steps forward at most one spacing\'s steps', () => {
    const a = probe(probes.bin('ring'), { module: 'ring', play_to: HOUR, seeks: TIMES });
    expect(frozen(a), 'no frame froze').toEqual([]);
    const r = reading(a.reading, 'the ring after the hour');
    const doublings = Math.log2(r.spacing / FIRST_SPACING);
    expect(Number.isInteger(doublings) && doublings >= 0, `the spacing after the hour (${r.spacing} flicks) is 0.5 s doubled a whole number of times`).toBe(true);
    expect(r.budget, 'the ring\'s budget is the 16 MiB test.ring declares').toBe(MIB16);
    expect(r.bytes, `the ring holds ${r.bytes} bytes, within its budget`).toBeLessThanOrEqual(MIB16);
    expect(r.over_budget, 'one checkpoint fits the budget').toBe(false);
    expect(r.held[0]?.t, 'the ring holds the checkpoint at the start').toBe(0);
    const gaps = r.held.slice(1).map((h, i) => ({ from: r.held[i]!.t, to: h.t })).filter((g) => g.to - g.from > r.spacing);
    expect(gaps, `no two held checkpoints are more than one spacing (${r.spacing} flicks) apart`).toEqual([]);
    expect(HOUR - r.held[r.held.length - 1]!.t, 'the newest checkpoint is within one spacing of the hour').toBeLessThanOrEqual(r.spacing);
    const most = Math.floor(r.spacing / STEP);
    const stepped = a.seeks.reduce((n, s) => Math.max(n, s.steps), 0);
    expect(stepped, 'the seeks step forward at all (none lands on a checkpoint by accident every time)').toBeGreaterThan(0);
    expect(stepFailures(a, r.spacing, 'after the hour'), `every seek steps at most ${most} steps`).toEqual([]);
  }, 3_600_000);

  it('#2693.769d2c70 a planted ring that keeps only the newest checkpoint steps from it for every earlier seek and fails, naming the steps', () => {
    const latest = TIMES.slice(0, 5);
    const a = probe(probes.bin('ring'), { module: 'ring', play_to: HOUR, seeks: latest, planted: 'ring_newest_only' });
    const r = reading(a.reading, 'the planted ring after the hour');
    expect(r.held.length, 'the planted ring holds one checkpoint, its newest').toBe(1);
    const most = Math.floor(r.spacing / STEP);
    // Each seek earlier than the newest checkpoint the planted ring held as it began has no checkpoint at or
    // before it, so it must step more than one spacing's steps.
    const earlier = a.seeks.filter((s, i) => {
      const before = reading(i === 0 ? a.reading : a.seeks[i - 1]!.reading, `the planted ring before the seek to ${s.t}`);
      return s.t < before.held[before.held.length - 1]!.t;
    });
    expect(earlier[0]?.t, 'the first seek, back from the hour, is earlier than the newest checkpoint').toBe(latest[0]);
    const failures = stepFailures(a, r.spacing, 'the planted ring');
    expect(failures.length, `the planted ring fails: ${failures.join('; ')}`).toBeGreaterThan(0);
    for (const s of earlier) expect(s.steps, `the planted ring's seek to ${s.t} flicks, earlier than its newest checkpoint, stepped ${s.steps} steps, over one spacing's ${most}`).toBeGreaterThan(most);
    for (const [i, f] of failures.entries()) expect(f, 'each failure names the steps').toContain(`${a.seeks.filter((s) => s.steps > most)[i]!.steps} steps`);
  }, 3_600_000);
});
