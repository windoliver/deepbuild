// AC3 #3265.5fc6d08d: "`differ` with `piece_seed: own` is refused at check, naming both fields. A depth one run reached
// reads INCONCLUSIVE, naming it"
//
// - Refused: the generator (`clean`) under differ 0.9 with a playtest whose piece_seed is own, and with one that leaves
//   it out, which is own (Check input: playtest: `piece_seed: own | run = own`). Through the hub, each ends not passed
//   with no run counted and no replica call playing a step, its failure a refusal naming `differ` and `piece_seed`, and
//   no grid.same (its floors are one, but no run was played to say so).
// - The single-run depth: the generator `stairs`, of whose 20 runs exactly one goes to depth 2 (read back by this suite's
//   own plays). Under differ 0.9, depths [1, 2] both generated, depth 1's 20 floors all distinct: the outcome is
//   `uncounted`, which the hub and the verdict never read as PASS, with one failure, starting INCONCLUSIVE: and naming
//   depth 2; nothing fails grid.same, and coverage and distinct count the one run.
// The wrong programs: the base, which reads no differ and passes all three; a check that plays the runs and fails
// grid.same on own; one that takes a missing piece_seed as run; one that passes 1 floor of 1 run as distinct, or fails it.
import { describe, expect, it } from 'vitest';
import { judge } from '../184/helpers.ts';
import { AC, DIFFER, TIMEOUT, bench, counted, failuresOf, keep, ranNoStep, reachOf, reachSpec, runCheck, told, word } from './helpers.ts';
import { RUNS, SEED, playtest, reach } from './programs.ts';

describe(`${AC[3]} differ is refused with piece_seed own, and a depth one run reached is INCONCLUSIVE`, () => {
  for (const [how, pieceSeed] of [['own', 'own'], ['left out, which is own', null]] as const) {
    it(`${AC[3]} differ with piece_seed ${how}: refused before any run, naming both fields`, async () => {
      const { pool, hub, play } = await bench();
      const clean = keep('clean');
      const before = pool.log.length;
      const r = await runCheck(hub, reachSpec(reach(DIFFER, [1]), playtest(clean, play, SEED.plain, pieceSeed)));
      expect(r.outcome, `differ with piece_seed ${how} is refused, never passed: ${told(r)}`).not.toBe('passed');
      expect(r.testsRun, `no run is counted: ${told(r)}`).toBe(0);
      expect(pool.log.slice(before).filter((p) => !ranNoStep(p)).map((p) => `a play of ${String(p.reply['steps'])} steps`), 'and none was played').toEqual([]);
      const refused = r.failures.filter((f) => /\brefused\b/.test(f.message) && word('differ').test(f.message) && word('piece_seed').test(f.message));
      expect(refused.length, `one failure is a refusal naming differ and piece_seed: ${told(r)}`).toBe(1);
      expect(failuresOf(r, 'grid.same'), 'and none is grid.same').toEqual([]);
    }, TIMEOUT);
  }

  it(`${AC[3]} a depth only one run generated reads INCONCLUSIVE, naming the depth, never PASS`, async () => {
    const { pool, hub, play } = await bench();
    const stairs = keep('stairs');
    expect(await counted(pool, stairs, SEED.plain), 'one run of the 20 generates depth 2, as this suite plays them').toEqual({ 1: { runs: RUNS, floors: RUNS }, 2: { runs: 1, floors: 1 } });
    const r = await runCheck(hub, reachSpec(reach(DIFFER, [1, 2]), playtest(stairs, play, SEED.plain)));
    expect(r.outcome, `depth 2, which one run generated, leaves the check INCONCLUSIVE (uncounted): ${told(r)}`).toBe('uncounted');
    expect(r.failures.filter((f) => f.message.startsWith('INCONCLUSIVE:') && word('depth 2').test(f.message)).length, `naming depth 2: ${told(r)}`).toBe(1);
    expect(r.failures.length, `and nothing else is reported, depth 1's 20 floors being distinct: ${told(r)}`).toBe(1);
    expect([r.testsRun, reachOf(r).coverage, reachOf(r).distinct], 'the 20 runs are counted, with one run and one floor at depth 2').toEqual([RUNS, { 1: RUNS, 2: 1 }, { 1: RUNS, 2: 1 }]);
    const v = judge(r, 'definition');
    expect([v.outcome, v.requirements[0]?.outcome], `the verdict on a requirement it covers is never PASS: ${JSON.stringify(v.reasons).slice(0, 600)}`).not.toContain('PASS');
  }, TIMEOUT);
});
