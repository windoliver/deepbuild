import { describe, expect, it } from 'vitest';
import { AC, BUILD_MS, FIXTURE, TIMES, keysOf, prebuild, run, scenario, shippedFixture, showAndEval, tempDir } from './helpers.ts';

prebuild();

describe(`${AC.stable} ${FIXTURE} keeps its content keys across two runs of one build`, () => {
  it(`${AC.stable} running ${FIXTURE} twice in one deep-show binary gives the same content key for every node at 0s, 0.5s and 1.5s`, () => {
    const { document, record } = shippedFixture(FIXTURE);
    const sc = scenario(tempDir('evidence'), [{ call: 'manifest' }, ...showAndEval(document)], record !== undefined ? { record } : {});
    const first = keysOf(run(sc), 1);
    const second = keysOf(run(sc), 1);

    for (const t of TIMES) {
      expect(Object.keys(first[t]!), `the first run's eval at ${t} lists logic.step|-`).toContain('logic.step|-');
      expect(Object.keys(second[t]!).sort(), `the second run's eval at ${t} lists the first run's nodes`).toEqual(Object.keys(first[t]!).sort());
    }

    const moved: string[] = [];
    for (const t of TIMES) {
      for (const [node, key] of Object.entries(first[t]!)) {
        if (second[t]![node] !== key) moved.push(`at ${t}: ${node} key ${key} then ${second[t]![node]}`);
      }
    }
    expect(moved, `content keys that moved between the two runs:\n  ${moved.join('\n  ')}`).toEqual([]);
  }, BUILD_MS);
});
