// AC1: deep_query returns rows by stable ID with a coverage block, and a conclusion of absence drawn from a partial
// result is refused.
//
// Read as (README, Readings: absence): a conclusion of absence is deep_query's `expect: {none: filter}`, which asks
// it to conclude that no row matches; on a complete result it answers `absent`, true or false, and on a cut one it
// refuses with `partial_result`, since the cut rows may hold the match.
import { describe, expect, it } from 'vitest';
import {
  BLOCKS, DOC, FULL, KEY, LAMPS_PER_BLOCK, type JsonObject, board, brief, circle, city, coverage, label, presented, query, rect, rows, run, scenario, show, useBuilds, useEvidence,
} from './helpers.ts';

const builds = useBuilds([FULL]);
const evidence = useEvidence();

const PLAIN = board('Plain board', [320, 200], [
  rect('a', 'Box a', [16, 16, 64, 40], 'a0'),
  rect('b', 'Box b', [96, 16, 64, 40], 'a1'),
  rect('c', 'Box c', [176, 16, 64, 40], 'a2'),
  label('caption', 'Caption', 'Three boxes', [16, 120], 'a3'),
]);
const WITH_FOUNTAIN = board('Board with a fountain', [320, 200], [
  ...Object.values(PLAIN['items'] as Record<string, JsonObject>),
  circle('fountain', 'Fountain', [260, 150], 12, 'a4'),
]);
const NO_CIRCLE = { none: { kind: 'circle@1' } };

describe('AC1 deep_query returns rows by stable ID with a coverage block, and a conclusion of absence drawn from a partial result is refused', () => {
  it('AC1 rows asked for by ID come back keyed by those IDs, each with its kind and content key, under a complete coverage block', () => {
    const [shown, reply] = run(builds.bin(FULL), scenario(evidence(), { [DOC.a]: null }, [
      show(DOC.a, PLAIN),
      query(DOC.a, { items: ['c', 'a'] }),
    ]));
    presented(shown!, 'the plain board');
    const got = rows(reply!);
    expect(got.map((r) => r['id']).sort(), `rows for exactly the IDs asked for (${brief(got)})`).toEqual(['a', 'c']);
    for (const r of got) {
      expect(r['kind'], `row ${String(r['id'])} has the item's kind`).toBe('rect@1');
      expect(r['parent'], `row ${String(r['id'])} has the item's parent`).toBe(null);
      expect(String(r['key']), `row ${String(r['id'])} carries its content key`).toMatch(KEY);
      expect(r['children_total'], `row ${String(r['id'])} counts its children`).toBe(0);
    }
    const c = coverage(reply!);
    expect(c['complete'], `the coverage block says the result is complete (${brief(c)})`).toBe(true);
    expect([c['rows_total'], c['rows_shown']], 'the coverage block counts the rows').toEqual([2, 2]);
    expect(c['cut'], 'nothing was cut').toEqual([]);
  });

  it('AC1 absence is concluded on a complete result, and refused with partial_result on a result cut by its cap', () => {
    const tree = BLOCKS * (LAMPS_PER_BLOCK + 1);
    const [a, b, c, noCircle, hasCircle, partial] = run(builds.bin(FULL), scenario(evidence(), { [DOC.a]: null, [DOC.b]: null, [DOC.c]: null }, [
      show(DOC.a, PLAIN),
      show(DOC.b, WITH_FOUNTAIN),
      show(DOC.c, city(), { size: [1000, 200] }),
      query(DOC.a, { expect: NO_CIRCLE }),
      query(DOC.b, { expect: NO_CIRCLE }),
      query(DOC.c, { expect: NO_CIRCLE, cap: 400 }),
    ]));
    presented(a!, 'the plain board');
    presented(b!, 'the board with a fountain');
    presented(c!, 'the city');
    expect(noCircle!['absent'], `no circle on the plain board, on a complete result: ${brief(noCircle)}`).toBe(true);
    expect(coverage(noCircle!)['complete'], 'that result is complete').toBe(true);
    expect(hasCircle!['absent'], `the fountain is found: ${brief(hasCircle)}`).toBe(false);
    // The city has no circle at all, but 400 of its 5,000 rows can't show that: the conclusion is refused.
    expect(partial!['code'], `absence from 400 of the city's ${tree} rows is refused: ${brief(partial)}`).toBe('partial_result');
    expect(partial!['absent'], 'and never concluded').not.toBe(true);
    expect(coverage(partial!)['complete'], 'its coverage block says the result is partial').toBe(false);
  });
});
