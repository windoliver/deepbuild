// AC7: deep_query reads `items/<id>/modifiers/<k>#out` for every k of a three-modifier stack, each equal to a clean
// evaluation of the stack cut after k; a planted read that returns the final result for k < 3 fails on a stack
// whose array modifier changes the counts.
//
// k is the modifier's index in the item's `modifiers` list, from 0 (README, Readings: prefixes), so the stack's
// three prefixes are k = 0, 1 and 2, and k = 2 is the final result. The stack is a subdivide, an array of 3 and a
// mirror; the array multiplies the parts, vertices and faces by 3. A clean evaluation is a fresh process given
// the stack cut after k, read at its own last prefix.
import { describe, expect, it } from 'vitest';
import {
  DOC, FULL, KEY, MODIFIERS, type JsonObject, type JsonValue, brief, failsNaming, hull, none, num, obj, prefixFailures, prefixPath, presented, query, run, scenario, show, str, useBuilds, useEvidence, values,
} from './helpers.ts';

const builds = useBuilds([FULL]);
const evidence = useEvidence();
const KS = MODIFIERS.map((_, k) => k);

/** Every prefix of the full stack, read in one deep_query. */
function fullReads(planted?: string): Record<number, JsonValue> {
  const [shown, reply] = run(builds.bin(FULL), scenario(evidence(), { [DOC.a]: null }, [
    show(DOC.a, hull()),
    query(DOC.a, { paths: KS.map(prefixPath) }),
  ], planted ? { planted } : {}));
  presented(shown!, 'the hull with its three modifiers');
  return Object.fromEntries(KS.map((k) => [k, values(reply!, prefixPath(k))[0] ?? null]));
}
/** The stack cut after k, evaluated clean, read at its last prefix. */
function cleanRead(k: number): JsonValue {
  const [shown, reply] = run(builds.bin(FULL), scenario(evidence(), { [DOC.a]: null }, [
    show(DOC.a, hull(k)),
    query(DOC.a, { paths: [prefixPath(k)] }),
  ]));
  presented(shown!, `the hull cut after modifier ${k}`);
  return values(reply!, prefixPath(k))[0] ?? null;
}
const counts = (v: JsonValue | undefined, what: string): { vertices: number; faces: number; parts: number } => {
  const o = obj(v, what);
  return { vertices: num(o['vertices'], `${what}.vertices`), faces: num(o['faces'], `${what}.faces`), parts: num(o['parts'], `${what}.parts`) };
};

describe('AC7 deep_query reads every prefix of a modifier stack, each equal to a clean evaluation of the stack cut there', () => {
  it('AC7 each prefix read has counts, bounds and a content key, equal to the clean evaluation of the stack cut after it', () => {
    const full = fullReads();
    const clean = Object.fromEntries(KS.map((k) => [k, cleanRead(k)])) as Record<number, JsonValue>;
    for (const k of KS) {
      const o = obj(full[k], `${prefixPath(k)} (${brief(full[k])})`);
      counts(o, prefixPath(k));
      expect(Array.isArray(o['bounds']) && o['bounds'].length === 2, `${prefixPath(k)} has its bounds as [min, max]`).toBe(true);
      expect(str(o['key'] as JsonValue, `${prefixPath(k)}.key`)).toMatch(KEY);
    }
    none(prefixFailures(full, clean), 'every prefix equals the clean evaluation of the stack cut after it');
    // The array modifier changes the counts: three copies of what the subdivide left.
    const before = counts(full[0], prefixPath(0));
    const after = counts(full[1], prefixPath(1));
    expect(after, 'the array of 3 triples the parts, vertices and faces').toEqual({ vertices: 3 * before.vertices, faces: 3 * before.faces, parts: 3 * before.parts });
  }, 600_000);

  it('AC7 a planted prefix read that returns the final result fails, naming the prefix', () => {
    const clean = Object.fromEntries(KS.map((k) => [k, cleanRead(k)])) as Record<number, JsonValue>;
    const planted = fullReads('prefix_reads_final');
    failsNaming(prefixFailures(planted, clean), [prefixPath(0)], 'a prefix read that returns the stack\'s final result');
    expect((planted[0] as JsonObject | null)?.['parts'], 'the planted read is the final result').toBe((clean[2] as JsonObject | null)?.['parts']);
  }, 600_000);
});
