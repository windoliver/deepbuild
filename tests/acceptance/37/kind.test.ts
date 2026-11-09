// AC13: the journey check kind passes check.kind@1 (#13's kit, shipped by #314 in @deepbuild/conformance), run
// through the supervisor as host@1; and the kit's planted runners that the criterion names, built from this check
// kind as the kit builds them from its reference, each fail it with their own message. Slow: the kit spawns suites.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runKit, slotKits, type CheckRunnerFill, type SlotKit, type SlotReport } from '../../../packages/conformance/src/index.ts';
import { journey, openWorld, type World } from './helpers.ts';
import { BENDS, bent, remembering } from './wrong.ts';

let world: World;
beforeAll(async () => { world = await openWorld(); });
afterAll(async () => { await world?.close(); });
let loaded: CheckRunnerFill | undefined;
/** The journey check kind on the world's supervisor, remembering its runs across the kit's cases. */
async function fill(): Promise<CheckRunnerFill> {
  if (!loaded) {
    const { journeyCheckKind } = await journey();
    loaded = remembering(journeyCheckKind(world.sup));
  }
  return loaded;
}

const kit = (): SlotKit<CheckRunnerFill> => {
  const found = slotKits().find((k) => k.slot === 'check.kind@1');
  if (!found) throw Error('BLOCKED: @deepbuild/conformance ships no check.kind@1 kit');
  return found as SlotKit<CheckRunnerFill>;
};
const notPassing = (report: SlotReport): string[] => report.cases.filter((c) => c.outcome !== 'PASS').map((c) => `${c.id} (${c.part}): ${c.outcome} ${c.message}`);

describe('AC13 #37.f105223d passes check.kind@1 (#13), whose planted runners, past-deadline, crashed-suite and type-error-as-assertion, each fail it with their own message', () => {
  it('AC13 the journey check kind fills check.kind@1 for the kind `journey` and passes every fixed and seeded case of the kit', async () => {
    const f = await fill();
    expect(f.slot).toBe('check.kind@1');
    expect(f.kind).toBe('journey');
    const report = await runKit(kit(), f, { seed: 37 });
    expect(notPassing(report), 'every case of the kit passes').toEqual([]);
    expect(report.verdict).toBe('PASS');
  }, 600_000);

  for (const bend of BENDS) {
    it(`AC13 (wrong program) the planted runner ${bend}, built from the journey check kind, fails the kit with its own message`, async () => {
      const planted = kit().planted.find((p) => p.name === bend);
      if (!planted) throw Error(`BLOCKED: check.kind@1 ships no planted runner ${bend}`);
      const report = await runKit(kit(), bent(await fill(), bend), { seed: 37 });
      expect(report.verdict, `${bend} fails the kit`).toBe('FAIL');
      const failed = report.cases.filter((c) => c.outcome === 'FAIL');
      expect(failed.length).toBeGreaterThan(0);
      expect(failed.map((c) => c.message).join('\n'), `${bend} fails with its own message: ${planted.message}`).toContain(planted.message);
    }, 600_000);
  }
});
