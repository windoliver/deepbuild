// AC3: In a city of 5,000 items where 600 name one shared material, `refs_to` under a 400-row cap returns 400 rows
// and a coverage block with the total of 600, in under 50 ms on the reference Mac.
//
// The city is alpha's own 3D document: a camera, the material `stone` and 4,998 blocks, 600 of which name `stone`
// in their `material` field (README: Fixtures). The rows and the coverage block are counts, read on any machine
// and under any load. The time is read off the dev binary, as #96's budgets are: each run is the difference between
// a `deep-show run` that shows the city and then reads refs_to n times and one that only shows it, over n; five runs
// after a warm-up, judged by the design's rule (scripts/benchmark.mjs `judgeLimit`), which reads INCONCLUSIVE off a
// reference Mac, off mains power, in Low Power Mode, at a thermal state past nominal or under load.
import { describe, expect, it } from 'vitest';
import {
  CITY_ITEMS, DOC, FULL, STONE, city, coverage, judgeWithin, num, obj, presented, reading, refsTo, rows, run, runTimed, scenario, show, stonePaths, useBuilds, useEvidence,
  type JsonObject,
} from './helpers.ts';

const builds = useBuilds([FULL]);
const evidence = useEvidence();
const CAP = 400;
const NAMERS = 600;
const LIMIT_MS = 50;

describe('AC3 refs_to a material 600 of the city\'s 5,000 items name, under a 400-row cap', () => {
  it('AC3 returns 400 of the rows that name the stone and a coverage block with the total of 600', () => {
    const doc = city();
    const namers = stonePaths(doc);
    expect(Object.keys(obj(doc['items'], 'the city\'s items')).length, 'the city holds 5,000 items').toBe(CITY_ITEMS);
    expect(namers.length, 'and 600 of them name the stone').toBe(NAMERS);

    const [shown, reply] = run(builds.bin(FULL), scenario(evidence(), { [DOC.city]: null }, [show(DOC.city, doc), refsTo(DOC.city, STONE, { cap: CAP })]));
    presented(shown, 'the city');
    const paths = rows(reply, `refs_to ${STONE}`).map((r) => String(r['path']));
    console.log(`AC3 refs_to ${STONE}: ${paths.length} rows, the first ${JSON.stringify(rows(reply, 'refs_to').slice(0, 3))}; coverage ${JSON.stringify(reply?.['coverage'])}`);
    expect(paths.length, `refs_to ${STONE} keeps ${CAP} rows under a cap of ${CAP}`).toBe(CAP);
    expect(new Set(paths).size, 'each row once').toBe(CAP);
    const strays = paths.filter((p) => !namers.includes(p));
    expect(strays, 'every row kept is a field of the city that names the stone').toEqual([]);
    expect(coverage(reply, `refs_to ${STONE}`), `the coverage block: ${CAP} of the ${NAMERS} rows, the cut named at the top level`)
      .toMatchObject({ complete: false, rows_total: NAMERS, rows_shown: CAP, cut: [{ parent: null, shown: CAP, total: NAMERS }] });
  });

  it(`AC3 refs_to the stone under a 400-row cap takes under ${LIMIT_MS} ms in five runs after a warm-up, judged on the reference Mac`, async () => {
    const bin = builds.bin(FULL);
    const doc = city();
    const only: JsonObject = scenario(evidence(), { [DOC.city]: null }, [show(DOC.city, doc)]);
    const reads = (n: number): JsonObject => scenario(evidence(), { [DOC.city]: null }, [show(DOC.city, doc), ...Array.from({ length: n }, () => refsTo(DOC.city, STONE, { cap: CAP }))]);
    /** One run: the time n reads add to a run that shows the city, per read; a difference under 0 (a read faster than the two runs' jitter) reads 0. */
    const perRead = (n: number): number => {
      const a = runTimed(bin, only);
      presented(a.replies[0], 'the city, shown alone');
      const b = runTimed(bin, reads(n));
      presented(b.replies[0], 'the city, shown before the reads');
      b.replies.slice(1).forEach((r, k) => {
        expect(rows(r, `read ${k + 1}`).length, `read ${k + 1} keeps ${CAP} rows`).toBe(CAP);
        expect(num(coverage(r, `read ${k + 1}`)['rows_total'], `read ${k + 1}: rows_total`), `read ${k + 1} counts ${NAMERS} rows`).toBe(NAMERS);
      });
      return Math.max(0, (b.ms - a.ms) / n);
    };
    // The warm-up, discarded; it also sizes n so that a run's reads take about 2 s, from 5 to 200 reads.
    const warm = perRead(5);
    const n = Math.min(200, Math.max(5, Math.round(2000 / Math.max(warm, 0.01))));
    console.log(`AC3 warm-up: ${warm.toFixed(3)} ms per read (discarded); ${n} reads a run`);
    const five = [1, 2, 3, 4, 5].map(() => reading(() => perRead(n)));
    await judgeWithin(`AC3 refs_to ${STONE} under a ${CAP}-row cap on the ${CITY_ITEMS}-item city (ms per read, ${n} reads a run)`, five, LIMIT_MS);
  }, 3_600_000);
});
