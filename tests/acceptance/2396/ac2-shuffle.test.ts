// #2396.9c791087: "A shuffle of a moving-rest document's items leaves every node's key and result unchanged."
//
// Fixture (helpers.ts, `liftedDoc`): the issue's moving-rest document (a vase resting on a table a channel lifts
// 0 → 0.25 m over 2 s, a camera and a slab), listed in ID order and in shuffled orders: the reproduction's order
// (cam, table, vase, flag), the reverse of ID order, and the orders a seeded shuffle draws for seeds 1 to 12, each
// order once. IDs, order keys and fields never change, so every listing is the same document (Order keys: a map has no
// order of its own). Each listing is shown by the working agent in a run of its own under the same document ID, then
// evaluated at 0, 1 and 2 s with the `eval` call, whose reply lists every node with its `key` and `result`.
//
// asserts:
//   - property: for every listing, the show is presented, and at each of 0, 1 and 2 s the multiset of nodes, each as
//     (operator, module, phase, item, key, result), equals the ID-order document's;
//   - the property is about something: the ID-order document's nodes are many, each with a key and a result, some
//     on the vase and the table, and the results at 1 s differ from those at 0 s (the rest moves).
//
// Wrong programs this fails on:
//   - the base: the reproduction's order is refused with no_support, so its show isn't presented;
//   - a program that reads each item's program slot right but whose node keys or results take the listing (a key
//     hashing the document as written, or a rest result in listing order): a node's key or result differs;
//   - a program that evaluates nothing or keys nothing: the ID-order guards fail.
import { describe, expect, it } from 'vitest';
import {
  AC, ID_ORDER, REPRO_ORDER, TIMEOUT, TIMES, arr, brief, evalAt, isObject, liftedDoc, presented, run, scenarioOf, show, shuffled, useFolders, useShow,
  type JsonObject,
} from './helpers.ts';

const ID = AC[2];
const bin = useShow();
const folder = useFolders();
const SEEDS = Array.from({ length: 12 }, (_, k) => k + 1);

/** The listings: the reproduction's, the reverse of ID order and the seeded draws, each once, ID order left out. */
function listings(): string[][] {
  const drawn = [[...REPRO_ORDER], [...ID_ORDER].reverse(), ...SEEDS.map((s) => shuffled(ID_ORDER, s))];
  const seen = new Set([ID_ORDER.join()]);
  return drawn.filter((l) => !seen.has(l.join()) && Boolean(seen.add(l.join())));
}

/** A frame's nodes, each as one text of (operator, module, phase, item, key, result), sorted: a multiset to compare. */
function nodesOf(reply: JsonObject, what: string): string[] {
  expect(reply['outcome'], `${what}: the frame is evaluated: ${brief(reply, 2000)}`).toBe('evaluated');
  return arr(reply['nodes'], `${what}: the frame's nodes`).filter(isObject)
    .map((n) => JSON.stringify([n['operator'] ?? null, n['module'] ?? null, n['phase'] ?? null, n['item'] ?? null, n['key'] ?? null, n['result'] ?? null]))
    .sort();
}

/** One listing shown in a run of its own and evaluated at 0, 1 and 2 s: its nodes at each time. */
function nodesAtTimes(listing: readonly string[]): string[][] {
  const what = `the document listed ${listing.join(', ')}`;
  const [shown, ...frames] = run(bin(), scenarioOf(folder(), [show(liftedDoc(listing)), ...TIMES.map(evalAt)]));
  presented(shown!, what);
  return frames.map((f, k) => nodesOf(f, `${what} at ${TIMES[k]}`));
}

/** Where `got` and `want` differ, as the nodes only one of them has. */
function differences(got: readonly string[], want: readonly string[]): string[] {
  const count = new Map<string, number>();
  for (const n of want) count.set(n, (count.get(n) ?? 0) + 1);
  const extra: string[] = [];
  for (const n of got) { const c = count.get(n) ?? 0; if (c > 0) count.set(n, c - 1); else extra.push(`only shuffled: ${n}`); }
  const missing = [...count].flatMap(([n, c]) => Array.from({ length: c }, () => `only ID order: ${n}`));
  return [...extra, ...missing];
}

describe(`${ID} a shuffle of a moving-rest document's items leaves every node's key and result unchanged`, () => {
  it(`${ID} for the reproduction's order, the reverse and seeded shuffles, every node's key and result at 0, 1 and 2 s equal the ID-order document's`, () => {
    // The differences judge fails a planted change: one result changed, one node dropped.
    expect(differences(['a', 'b', 'b'], ['a', 'b', 'b']), 'the judge passes the same multiset in any order').toEqual([]);
    expect(differences(['a', 'b', 'c'], ['a', 'b', 'b']).length, 'the judge fails a node whose result changed').toBe(2);
    expect(differences(['a', 'b'], ['a', 'b', 'b']).length, 'the judge fails a node dropped').toBe(1);

    const orders = listings();
    expect(orders.length, `the shuffles draw at least 6 orders other than ID order: ${brief(orders)}`).toBeGreaterThanOrEqual(6);
    expect(orders[0], 'the first is the reproduction\'s order').toEqual([...REPRO_ORDER]);

    // The order the base refuses goes first, so the base fails on its no_support.
    const [repro, ...rest] = orders;
    const reproNodes = nodesAtTimes(repro!);
    const want = nodesAtTimes(ID_ORDER);
    const parsed = want[0]!.map((n) => JSON.parse(n) as (string | null)[]);
    expect(parsed.length, 'the ID-order document runs nodes at 0 s').toBeGreaterThan(3);
    expect(parsed.filter((n) => typeof n[4] !== 'string' || n[4] === '' || typeof n[5] !== 'string' || n[5] === '').map((n) => brief(n)), 'every node has a key and a result').toEqual([]);
    expect(parsed.some((n) => n[3] === 'vase') && parsed.some((n) => n[3] === 'table'), `nodes work on the vase and on the table: ${brief(parsed.map((n) => [n[0] ?? null, n[3] ?? null]))}`).toBe(true);
    expect(want[1], 'the rest moves: the nodes\' results at 1 s differ from those at 0 s').not.toEqual(want[0]);

    for (const [listing, got] of [[repro!, reproNodes] as const, ...rest.map((l) => [l, nodesAtTimes(l)] as const)]) {
      for (const [k, t] of TIMES.entries()) {
        const diff = differences(got[k]!, want[k]!);
        expect(diff, `listed ${listing.join(', ')}, at ${t} every node's key and result equal ID order's:\n  ${diff.slice(0, 12).join('\n  ')}`).toEqual([]);
      }
    }
  }, TIMEOUT);
});
