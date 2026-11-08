// AC10 #492.102b52ef: Long spans keep exact time: a 1 s clip keying x from 0 to 1, placed at 0 with repeat {count: 100,000,
// mode: wrap}, reads at t = 86,400 s + k/60 s, for k from 0 to 59, bit for bit what it reads at k/60 s; a planted placement
// that turns t into f32 seconds before the repeat wraps it reads 0.015625 for k = 1, where the clip reads 1/60, and fails,
// naming the placement and k.
//
// Through `deep-motion eval`. The plant `placement_f32_seconds` (README: Planted programs) goes through the check the real
// program passes. 86,400 + 1/60 in f32 is 86,400.015625 (the f32 grid there is 1/128 s). No upstream test (oracle page).
import { describe, expect, it } from 'vitest';
import { AC, FLICKS, TIMEOUT, accepted, clipOf, evalAll, evalPlanted, failsNaming, film, none, place, posOr, rect, useMotion, type Accepted } from './helpers.ts';

const motion = useMotion();

const DAY = 86_400;
const DOC = film('long-span', [rect('dot', [0, 0])], {
  clips: { unit: clipOf('x', 'at/pos/0', [[0, 0], [1, 1]]) },
  placements: { tile: place('unit', 'dot', { start: '0s', repeat: { count: 100_000, mode: 'wrap' } }) },
}, { span: '100000s' });
const K = Array.from({ length: 60 }, (_, k) => k);
const near = K.map((k) => (k * FLICKS) / 60);
const far = near.map((t) => DAY * FLICKS + t);

/** The check: at each k, the far read is the near read, bit for bit; failures name the placement and k. */
function dayFailures(nearby: Accepted, distant: Accepted): string[] {
  const failures: string[] = [];
  K.forEach((k) => {
    const a = posOr(nearby.frames[k]!, 'dot', 0); const b = posOr(distant.frames[k]!, 'dot', 0);
    if (!Object.is(a, b)) failures.push(`placement tile at k = ${k}: reads ${b} at 86,400 s + k/60 s, ${a} at k/60 s`);
  });
  return failures;
}

describe(`${AC[10]} a placement read a day in`, () => {
  it(`${AC[10]} at 86,400 s + k/60 s it reads bit for bit what it reads at k/60 s, which is k/60`, () => {
    const [one, two] = evalAll(motion.bin(), [{ doc: DOC, times: near }, { doc: DOC, times: far }]);
    const a = accepted(one!, near, 'the first second'); const b = accepted(two!, far, 'a day in');
    none(K.filter((k) => !(Math.abs(posOr(a.frames[k]!, 'dot', 0) - k / 60) <= 1e-12)).map((k) => `at k = ${k} the clip reads ${posOr(a.frames[k]!, 'dot', 0)}, not ${k / 60}`), 'the clip at k/60 s');
    none(dayFailures(a, b), 'a day in against the first second');
  }, TIMEOUT);

  it(`${AC[10]} a planted placement in f32 seconds reads 0.015625 for k = 1 and fails, naming the placement and k`, () => {
    const a = accepted(evalAll(motion.bin(), [{ doc: DOC, times: near }])[0]!, near, 'the first second');
    const plant = evalPlanted(motion.bin(), { doc: DOC, times: far, planted: 'placement_f32_seconds' }, 'a day in');
    expect(Math.fround(DAY + 1 / 60) - DAY, 'fixture: f32(86,400 + 1/60) − 86,400').toBe(0.015625);
    expect(posOr(plant.frames[1]!, 'dot', 0), 'the plant at k = 1').toBe(0.015625);
    failsNaming(dayFailures(a, plant), ['placement tile', 'k = 1:'], 'the f32 placement');
  }, TIMEOUT);
});
