// AC7: "A document check's issue carries `actual`, the value refused at its path: a `circle@1` whose `radius` is
// -2 fails with `out_of_range` at `items/c/params/radius` and `actual` -2, and a value longer than 8,192
// characters is cut there; a check that returns issues without `actual` fails this test, naming the code"
//
// Blind redraft (REDRAFT.md). The criterion's "radius" is circle@1's radius field, which the design's Circle
// section (`r: f32, u`) and the base's own code (deep-canvas-marks scene.rs and outline.rs, deep-show costs.rs,
// #373's suite) name `r`; a check faithful to the design answers a `radius` field with `unknown_field`. So the
// radius is sent as `r` and its path is `items/c/params/r`.
//
// asserts: deep_show of a board whose circle@1 `c` has radius (`r`) -2 is refused with one `out_of_range` error
// at `items/c/params/r` whose `actual` is -2, and every issue it returns carries `actual` (`actualFailures`); a
// circle with radius 40 and a 10,000-character value at `items/c/params/note`, a field circle@1 doesn't define,
// is refused with one issue there whose `actual` is that value's first 8,192 characters (code points), read
// from the reply's `issues_evidence`, and every issue carries `actual`. The planted `issues_without_actual`
// still refuses the radius -2 circle and fails `actualFailures`, naming `out_of_range`.

import { describe, expect, it } from 'vitest';
import {
  ALPHA, DOC, FULL, READ_CAP, actualFailures, allIssues, board, chars, errors, failsNaming, issues, none, outcome, run, scenario, show, useBuilds, useEvidence,
  type JsonObject,
} from './helpers.ts';

const builds = useBuilds([FULL]);
const evidence = useEvidence();

/** circle@1's radius field, as the design's Circle section and the base name it. */
const RADIUS = 'r';
const RADIUS_PATH = `items/c/params/${RADIUS}`;

const circle = (params: JsonObject): JsonObject => board('Circle', [200, 200], [
  { id: 'c', kind: 'circle@1', name: 'Circle', order: 'a0', params: { center: [100, 100], paint: { fill: { role: 'muted' } }, ...params } },
]);

/** 10,000 characters, every fourth one outside the BMP, so a cut counted in UTF-16 units lands elsewhere. */
const LONG = 'chk\u{1D11E}'.repeat(2_500);

describe('AC7 (redraft) a document check\'s issue carries actual, the value refused at its path, cut at 8,192 characters', () => {
  it('AC7 a circle@1 whose radius is -2 fails with out_of_range at items/c/params/r and actual -2', () => {
    const [reply] = run(builds.bin(FULL), scenario(evidence(), { [DOC.a]: 'main' }, [show(ALPHA.id, DOC.a, circle({ [RADIUS]: -2 }))]));
    expect(outcome(reply!), `the circle is refused: ${JSON.stringify(reply).slice(0, 1500)}`).toBe('refused');
    const list = issues(reply!);
    const hit = errors(list).filter((i) => i.code === 'out_of_range' && i.path === RADIUS_PATH);
    expect(hit.length, `an out_of_range error at ${RADIUS_PATH}: ${JSON.stringify(reply!['issues']).slice(0, 1500)}`).toBe(1);
    expect(hit[0]!.actual, 'its actual is the value refused there').toBe(-2);
    none(actualFailures(list), 'every issue carries actual');
  });

  it('AC7 a value longer than 8,192 characters is cut there: actual holds its first 8,192 characters', async () => {
    expect(chars(LONG), 'the value is longer than the read cap').toBe(10_000);
    const root = evidence();
    const [reply] = run(builds.bin(FULL), scenario(root, { [DOC.a]: 'main' }, [show(ALPHA.id, DOC.a, circle({ [RADIUS]: 40, note: LONG }))]));
    expect(outcome(reply!), `the circle with a field its kind doesn't define is refused: ${JSON.stringify(reply).slice(0, 1500)}`).toBe('refused');
    const all = await allIssues(root, reply!);
    const there = all.filter((i) => i.path === 'items/c/params/note');
    expect(there.length, `one issue at items/c/params/note: ${JSON.stringify(all.map((i) => [i.code, i.path]))}`).toBe(1);
    const actual = there[0]!.actual;
    expect(typeof actual, 'actual is the refused text').toBe('string');
    expect(chars(actual as string), 'actual is cut at 8,192 characters').toBe(READ_CAP);
    expect(actual, "actual is the value's first 8,192 characters").toBe([...LONG].slice(0, READ_CAP).join(''));
    none(actualFailures(all), 'every issue carries actual');
  });

  it('AC7 a planted check that returns issues without actual fails this test, naming the code', () => {
    const [reply] = run(builds.bin(FULL), scenario(evidence(), { [DOC.a]: 'main' }, [show(ALPHA.id, DOC.a, circle({ [RADIUS]: -2 }))], { planted: 'issues_without_actual' }));
    expect(outcome(reply!), 'the planted check still refuses the circle').toBe('refused');
    failsNaming(actualFailures(issues(reply!)), ['out_of_range'], 'the check that returns issues without actual');
  });
});
