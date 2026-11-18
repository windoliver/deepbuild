// Criterion 1 (an upstream physics engine's combine-rule tests back its formula only): "physics2d.lib@1's slide
// fixture, a box sliding from 5 m/s on flat ground with friction 0.2 against 0.8 under the geometric mean, expects
// 3.186 m within 3%, as the physics behavior kit states; a 2D physics library built under the subset that declares
// implements physics2d.lib@1 and lands within it links, and a planted library that averages friction lands at 2.548 m
// and is refused at link, naming physics2d.lib@1, the slide fixture, the distance array, 3.186 and the tolerance"
//
// Through `deep-logic first_party`, `check` and `bake` (README: The surface). The kit's answers are worked here from
// v² ÷ 2μg; the slide fixture is the first-party pack's own, read from its asset. `phys2d@1` is this suite's 2D physics
// library (programs.ts: physics2d), an object under the one subset; `phys2d_avg@1` is the same library with friction
// averaged. Each also ships a fixture of its own (#190's rule), worked here operation for operation, which it passes,
// so the only thing that can refuse the planted one is the interface's slide fixture.
import { describe, expect, it } from 'vitest';
import { TIMEOUT, admitted, arraysAt, bakeCall, bakeOf, checkCall, logicBin, num, onHost, prebuild, refusedOf } from '../../190/helpers.ts';
import { AC, byName, expectedAt, firstParty, fixturePiece, interfaceRuns, pack, phys2d, refusalWhere } from './helpers.ts';
import { AVERAGE, GEOMETRIC, PHYSICS2D_EXPORTS, slideAnswer } from './programs.ts';

prebuild(() => { logicBin(); });

const round3 = (x: number): number => Math.round(x * 1000) / 1000;
const within = (x: number, answer: number, rel: number): boolean => Math.abs(x - answer) <= rel * Math.abs(answer);

/** The kit's slide, from first principles: v² ÷ 2μg with μ the geometric mean of 0.2 and 0.8 (0.4), and the average (0.5). */
function kit(): { geometric: number; average: number } {
  const geometric = slideAnswer(GEOMETRIC);
  const average = slideAnswer(AVERAGE);
  expect([round3(GEOMETRIC), round3(AVERAGE)], 'the geometric mean of 0.2 and 0.8 is 0.4, their average 0.5').toEqual([0.4, 0.5]);
  expect([round3(geometric), round3(average)], 'v² ÷ 2μg from 5 m/s with g = 9.81 m/s²: 3.186 m under the geometric mean, 2.548 m averaged').toEqual([3.186, 2.548]);
  return { geometric, average };
}
/** physics2d.lib@1's slide fixture: it expects `distance` 3.186 m within 3% (its last expected step). */
function slideFixture() {
  const fp = firstParty();
  const iface = fp.iface('physics2d.lib@1');
  expect(byName(iface.exports), 'physics2d.lib@1 declares the exports README: The surface gives it').toEqual(byName(PHYSICS2D_EXPORTS));
  const slide = fp.fixture(iface, 'slide');
  expect(slide.tolerance, 'the slide fixture\'s tolerance is 3%').toEqual({ rel: 0.03 });
  const expected = expectedAt(slide, 'distance');
  expect(expected.length, 'the slide fixture expects the distance array').toBeGreaterThan(0);
  const [step, values] = expected[expected.length - 1]!;
  expect(values.length, 'distance is one value').toBe(1);
  const answer = num(values[0], 'the expected distance');
  expect(round3(answer), 'the slide fixture expects 3.186 m').toBe(3.186);
  return { fp, iface, slide, step, answer };
}

describe(`${AC[1]} physics2d.lib@1's slide fixture holds a 2D physics library to the behavior kit's answer`, () => {
  it(`${AC[1]} the slide fixture expects 3.186 m within 3%, and a 2D physics library under the subset that implements physics2d.lib@1 and lands within it links`, () => {
    kit();
    const { fp, iface, slide, step, answer } = slideFixture();
    const lib = phys2d();
    const p = fixturePiece(slide, lib, [pack('physics', [lib])], fp.assets);
    const [check, bake] = onHost([checkCall(p), bakeCall(p, slide.steps, slide.track as never)]);
    const receipt = admitted(check!, 'check of the slide fixture\'s item linking phys2d@1')['fixture']!;
    expect(receipt.libraries.map((l) => [l.name, l.hash]), 'phys2d@1 links').toEqual([['phys2d@1', lib.program.sha]]);
    expect(receipt.libraries[0]!.fixtures.map((f) => f.verdict), 'its own fixture passed').toEqual(['PASS']);
    const runs = interfaceRuns(check!, 'fixture', 'phys2d@1');
    expect(Object.keys(runs), 'its receipt records physics2d.lib@1\'s fixtures').toEqual(['physics2d.lib@1']);
    expect(runs['physics2d.lib@1']!.map((r) => [r.fixture, r.verdict]).sort(), 'every fixture of physics2d.lib@1 ran on it and passed').toEqual(iface.fixtures.map((f) => [f, 'PASS']).sort());
    const landed = num(arraysAt(bakeOf(bake!, 'the slide fixture\'s bake'), 'fixture', step)['distance']?.[0], 'the box\'s distance');
    expect(within(landed, answer, 0.03), `phys2d@1's box lands at ${landed} m, within 3% of ${answer} m`).toBe(true);
  }, TIMEOUT);

  it(`${AC[1]} a planted library that averages friction lands at 2.548 m and is refused at link, naming physics2d.lib@1, the slide fixture, the distance array, 3.186 and the tolerance`, () => {
    const { average } = kit();
    const { fp, slide, step } = slideFixture();
    const planted = phys2d(true);
    const [reply] = onHost([checkCall(fixturePiece(slide, planted, [pack('physics', [planted])], fp.assets))]);
    const r = refusedOf(reply!, 'check of the slide fixture\'s item linking phys2d_avg@1');
    expect([r.code, r.item], 'it is refused at link, naming the item').toEqual(['link_refused', 'fixture']);
    const named = refusalWhere(r.refusals, (x) => x['interface'] === 'physics2d.lib@1' && x['fixture'] === slide.id, 'a refusal names physics2d.lib@1 and the slide fixture');
    expect([named['library'], named['array'], named['step']], 'it names the library, the distance array and the step').toEqual(['phys2d_avg@1', 'distance', step]);
    expect(round3(num(named['expected'], 'the refusal\'s expected value')), 'it names 3.186').toBe(3.186);
    expect(named['tolerance'], 'it names the tolerance').toEqual({ rel: 0.03 });
    const landed = num(named['actual'], 'the planted box\'s distance');
    expect(within(landed, average, 0.03), `the planted box lands at ${landed} m: 2.548 m, within the kit's 3%`).toBe(true);
  }, TIMEOUT);
});
