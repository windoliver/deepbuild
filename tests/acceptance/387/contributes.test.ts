// #387.27c08b66: a test canvas module that names the transform in contributes_to moves items when it's
// in the build, while the transform's own registration and every other canvas module's digest are
// byte-identical with and without it, and a build without it seals and draws the same document's other
// items unchanged. The transform is whichever array `test.nudge.offset` names in `contributes_to`
// (README: Readings). The wrong programs: a contribution the owner ignores (nothing moves) and an owner
// that names its contributor (its registration or a digest changes). At the base neither the registry's
// new fields nor the `test-nudge` feature exist.
import { describe, expect, it } from 'vitest';
import {
  DOC, board, doc, label, presented, rect, requires, run, scenario, sealed, show, snapshotOf, sorted, useBuilds, useEvidence, type Build, type JsonObject,
} from './helpers.ts';

const FULL: Build = { set: 'full' };
const NUDGE: Build = { set: 'full', with: ['test-nudge'] };
const builds = useBuilds([FULL, NUDGE]);
const evidence = useEvidence();

const nudge = (box: number[], dx: number, dy = 0): JsonObject => ({ id: 'nudged', kind: 'test.nudge@1', name: 'Nudged box', order: 'a2', params: { box, dx, dy } });
/** The document's other items: what every build draws. */
const OTHERS = [rect('back', [0, 0, 320, 200], 'a0', 'ground'), label('cap', 'Contributions', [16, 16], 'a1'), rect('bar', [16, 150, 200, 16], 'a3', 'ink')];
const withNudge = (box: number[], dx: number): JsonObject => board('Nudge', [...OTHERS, nudge(box, dx)], requires({ 'test.nudge': '^1' }));
const BOX = [40, 60, 60, 40];

describe('#387.27c08b66 a test canvas module that contributes to the transform moves items in its build, leaves the transform\'s registration and every other module\'s digest byte-identical, and a build without it draws the other items unchanged', () => {
  it('#387.27c08b66 test.nudge.offset names the transform in contributes_to; the transform\'s registration, its writers, and every other module\'s digest and version are the same with and without test.nudge', () => {
    const without = sealed(builds.bin(FULL), evidence());
    const withIt = sealed(builds.bin(NUDGE), evidence());
    const to = withIt.arrays['test.nudge.offset']?.['contributes_to'];
    expect(typeof to, `test.nudge.offset names the array it contributes to: ${JSON.stringify(withIt.arrays['test.nudge.offset'])}`).toBe('string');
    const transform = to as string;
    expect(without.arrays[transform], `the transform ${transform} is registered in the build without test.nudge`).toBeDefined();
    expect(withIt.arrays[transform], `${transform}'s own registration is byte-identical with test.nudge in the build`).toEqual(without.arrays[transform]);
    const writers = (r: typeof without) => Object.fromEntries(Object.entries(r.operators).filter(([, o]) => o.writes.includes(transform)));
    expect(Object.keys(writers(without)).length, `some operator writes ${transform}`).toBeGreaterThan(0);
    expect(writers(withIt), `the operators that write ${transform} are registered the same, never naming their contributor`).toEqual(writers(without));
    expect(sorted(withIt.modules), 'the build with test.nudge holds the same modules plus test.nudge').toEqual(sorted([...without.modules, 'test.nudge']));
    for (const m of without.modules) {
      expect(withIt.digests[m], `${m}'s digest is byte-identical with test.nudge in the build`).toBe(without.digests[m]);
      expect(withIt.versions[m], `${m}'s version is the same`).toBe(without.versions[m]);
    }
  }, 600_000);

  it('#387.27c08b66 in the build with test.nudge its items move: dx 40 draws what a box 40 to the right with dx 0 draws, and not what the first box with dx 0 draws', () => {
    const moved = [BOX[0]! + 40, BOX[1]!, BOX[2]!, BOX[3]!];
    const replies = run(builds.bin(NUDGE), scenario(evidence(), [
      show(withNudge(BOX, 40), { doc: doc(1), pixels: true }),
      show(withNudge(moved, 0), { doc: doc(2), pixels: true }),
      show(withNudge(BOX, 0), { doc: doc(3), pixels: true }),
    ]));
    const [nudged, placed, still] = replies.map((r, i) => { presented(r, `board ${i + 1}`); return snapshotOf(r, `board ${i + 1}`); });
    expect(nudged, 'the contribution moved the item by its dx: the same pixels as the box drawn 40 to the right').toBe(placed);
    expect(nudged, 'and not where its box alone puts it').not.toBe(still);
  }, 600_000);

  it('#387.27c08b66 a build without test.nudge seals and draws the same document\'s other items unchanged: the same snapshot in full and in full,test-nudge', () => {
    const others = board('Nudge', OTHERS);
    const draw = (build: Build): string => {
      const [reply] = run(builds.bin(build), scenario(evidence(), [show(others, { doc: DOC.a, pixels: true })]));
      presented(reply!, `the other items in ${build.with?.[0] ?? build.set}`);
      return snapshotOf(reply!, `the other items in ${build.with?.[0] ?? build.set}`);
    };
    const inFull = draw(FULL);
    expect(sealed(builds.bin(FULL), evidence()).modules, 'the build without it seals without test.nudge').not.toContain('test.nudge');
    expect(draw(NUDGE), 'the other items draw the same with and without test.nudge').toBe(inFull);
  }, 600_000);
});
