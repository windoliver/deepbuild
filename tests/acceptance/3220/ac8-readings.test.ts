// #3220 AC8: in the sample repo, five sessions each claim with three checks; the host's reading shows memory reserved
// and memory used for the run, and the two differ by under a quarter (drafted); on the merge base nothing is recorded
// to compare. The sample repo's spec names three checks, each a Node test that holds 200, 300 or 400 MiB for 4 s and
// declares the memory it takes (the allocation and Node's own, measured on this Mac: README, How each criterion is
// read). Five sessions in five worktrees change NOTES.md and stop together. The host's readings are `reading.recorded`
// events whose source names `memory reserved` or `memory used` and the host, `local` (README, Seams).
import { afterAll, describe, expect, it } from 'vitest';
import { AC8, claimed, claimOf, cleanup, peakOf, ready, runsIn, said, sampleFiles, shownRun, sleep, World, type Ev, type SpecCheck } from './helpers.ts';

afterAll(cleanup, 120_000);

const CHECKS: SpecCheck[] = [
  { name: 'small', mib: 200, holdMs: 4000, memoryMb: 290 },
  { name: 'medium', mib: 300, holdMs: 4000, memoryMb: 390 },
  { name: 'large', mib: 400, holdMs: 4000, memoryMb: 490 },
];
const SESSIONS = 5;

/** The newest reading whose source starts with `what` and names the host. */
const readingOf = (events: readonly Ev[], what: string): Ev | undefined =>
  events.filter((e) => e.kind === 'reading.recorded' && new RegExp(`^${what}\\b`, 'i').test(String(e.data.source ?? '')) && /\blocal\b/.test(String(e.data.source ?? ''))).at(-1);

describe(`${AC8} the host's reading shows memory reserved against memory used`, () => {
  it(`${AC8} five sessions each claim with three checks: the host's readings of memory reserved and used differ by under a quarter`, async () => {
    const w = new World({ files: sampleFiles(CHECKS), worktrees: SESSIONS, memMb: 16_000 });
    await w.startHub();
    let events: Ev[] = [];
    try {
      const ks = [];
      for (const [i, tree] of w.worktrees.entries()) ks.push(await ready(w, tree, `# notes\n\n- first\n- session ${i + 1}\n`));
      await Promise.all(ks.map((k) => k.s.stop()));
      const ran = await claimed(w, ks, CHECKS.map((c) => c.name));
      const runs = ks.flatMap((k) => { const claim = claimOf(ran, k); return runsIn(ran).filter((r) => r.claim === claim && CHECKS.some((c) => c.name === r.check)); });
      if (runs.length !== SESSIONS * CHECKS.length || runs.some((r) => r.outcome !== 'passed')) throw Error(`BLOCKED: each of the ${SESSIONS} claims must run its ${CHECKS.length} checks once, each passing: ${runs.map(shownRun).join('; ')}`);
      // The readings land with the runs' ends; a moment for the last.
      await sleep(5000);
      events = await w.events();
      for (const r of runsIn(events).filter((x) => runs.some((y) => y.run === x.run))) {
        expect(peakOf(r), `each check run must record its peak on its end, so the host's reading has something to compare: ${shownRun(r)}`).toBeTypeOf('number');
      }
    } finally {
      await w.stopHub();
    }
    const reserved = readingOf(events, 'memory reserved');
    const used = readingOf(events, 'memory used');
    const readings = events.filter((e) => e.kind === 'reading.recorded').map(said).join('; ').slice(0, 2000) || 'none';
    expect(reserved, `the host's reading must show the memory reserved for the runs: a reading.recorded whose source starts "memory reserved" and names the host, local; the record's readings: ${readings}`).toBeDefined();
    expect(used, `the host's reading must show the memory used by the runs: a reading.recorded whose source starts "memory used" and names the host, local; the record's readings: ${readings}`).toBeDefined();
    const r = Number(reserved!.data.value);
    const u = Number(used!.data.value);
    expect(r > 0 && u > 0, `both readings must be numbers above 0: ${said(reserved)}; ${said(used)}`).toBe(true);
    expect(used!.data.unit, `both readings must be in one unit: ${said(reserved)}; ${said(used)}`).toBe(reserved!.data.unit);
    expect(Math.abs(r - u), `memory reserved, ${r}, and memory used, ${u}, must differ by under a quarter of what was reserved: ${said(reserved)}; ${said(used)}`).toBeLessThan(r / 4);
  }, 3_600_000);
});
