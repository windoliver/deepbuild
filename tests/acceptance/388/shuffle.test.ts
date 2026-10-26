// #388.46473baa, second clause: evaluating each fixture under 8 legal orders shuffled by a seed gives
// identical hashes (parity/determinism/legal-order-shuffle.scene). In the core and r1 builds, each sealed with
// exactly its list, every canvas module of the set registers at least one fixture; each fixture is shown and
// evaluated at the scene's times unshuffled and under the scenario's `shuffle` seeds 1 to 8 (#387): every
// node's key and result, the step log and the snapshot equal the unshuffled frame's, each order is legal, and
// the shuffles are not all the unshuffled order. The wrong programs: a result that depends on tie order (a
// hash moves under a shuffle), a module laid out without fixtures, and a set holding the wrong modules. At the
// base the sets hold the wrong modules, and data, graph, record and sheet register nothing.
import { describe, expect, it } from 'vitest';
import {
  FIXTURES, REGISTRY, SET_MODULES, evalCall, evaluated, fixture, fixturesOf, hashDiff, legalityFailures, nodeId, none, num, presented, recordOf, registry, run, scenario,
  setFailures, show, str, strs, useBuilds, useEvidence, type Build, type Evaluated, type Fixture, type Registry,
} from './helpers.ts';

const SCENE = fixture('parity/determinism/legal-order-shuffle.scene');
const TIMES = strs(SCENE['times'], 'the scene\'s times');
const SEEDS = (SCENE['shuffles'] as number[]).map((s, i) => num(s, `the scene's shuffles[${i}]`));
const CORE: Build = { set: 'core' };
const R1: Build = { set: 'r1' };
const builds = useBuilds([CORE, R1]);
const evidence = useEvidence();

/** One fixture shown once and evaluated at each of the scene's times, with a snapshot, under one shuffle seed (or none). */
function frames(bin: string, f: Fixture, shuffle?: number): Evaluated[] {
  const what = `fixture ${f.module}/${f.name} under shuffle ${shuffle ?? 'none'}`;
  const replies = run(bin, scenario(evidence(), [show(f.document), ...TIMES.map((t) => evalCall(t, true))], { ...recordOf(f), ...(shuffle === undefined ? {} : { shuffle }) }));
  presented(replies[0]!, what);
  return TIMES.map((t, i) => evaluated(replies[i + 1]!, `${what} at ${t}`));
}

function shuffleCheck(build: Build, set: keyof typeof SET_MODULES): void {
  expect(str(SCENE['name'], 'the scene\'s name')).toBe('legal-order-shuffle');
  expect((SCENE['builds'] as string[]).includes(set), `the scene runs the ${set} build`).toBe(true);
  expect(SEEDS.length, 'the scene names 8 shuffle seeds').toBe(8);
  const bin = builds.bin(build);
  const replies = run(bin, scenario(evidence(), [REGISTRY, FIXTURES]));
  const reg: Registry = registry(replies[0]!);
  none(setFailures(reg, set), `the ${set} build holds exactly its list`, true);
  const fixtures = fixturesOf(replies[1]!);
  for (const m of SET_MODULES[set]) expect(fixtures.filter((f) => f.module === m).map((f) => f.name), `canvas module ${m} registers at least one fixture`).not.toEqual([]);
  for (const f of fixtures) expect(['core', ...SET_MODULES[set]], `fixture ${f.module}/${f.name} belongs to the core or a module of the ${set} set`).toContain(f.module);

  const failures: string[] = [];
  let shuffledOrders = 0;
  for (const f of fixtures) {
    const plain = frames(bin, f);
    plain.forEach((e, i) => failures.push(...legalityFailures(reg, e, `${f.module}/${f.name} at ${TIMES[i]} unshuffled`)));
    for (const seed of SEEDS) {
      const shuffled = frames(bin, f, seed);
      shuffled.forEach((e, i) => {
        const what = `${f.module}/${f.name} at ${TIMES[i]} under shuffle ${seed}`;
        failures.push(...legalityFailures(reg, e, what), ...hashDiff(plain[i]!, e, what));
        if (e.nodes.map(nodeId).join(' ') !== plain[i]!.nodes.map(nodeId).join(' ')) shuffledOrders++;
      });
    }
  }
  none(failures, `every hash of every ${set} fixture is the same under ${SEEDS.length} shuffled legal orders`);
  expect(shuffledOrders, `across the ${set} fixtures the shuffles run orders other than the unshuffled one, so ties were shuffled`).toBeGreaterThan(0);
}

describe('#388.46473baa evaluating each fixture under 8 legal orders shuffled by a seed gives identical hashes (parity/determinism/legal-order-shuffle.scene)', () => {
  it('#388.46473baa core: every fixture of the core, text and look, at 0, 0.5 and 1 s, has the same node keys and results, step log and snapshot under shuffle seeds 1 to 8 as unshuffled, each order legal', () => {
    shuffleCheck(CORE, 'core');
  }, 1_800_000);

  it('#388.46473baa r1: every fixture of the core, text, look, marks2d, data, graph, record, sheet and motion, at 0, 0.5 and 1 s, has the same node keys and results, step log and snapshot under shuffle seeds 1 to 8 as unshuffled, each order legal', () => {
    shuffleCheck(R1, 'r1');
  }, 3_600_000);
});
