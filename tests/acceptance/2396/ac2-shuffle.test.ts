import { describe, expect, it } from 'vitest';
import {
  AC, ID_ORDER, REPRO_ORDER, TIMEOUT, TIMES, arr, brief, evalAt, isObject, liftedDoc, presented, run, scenarioOf, show, shuffled, useFolders, useShow,
  type JsonObject,
} from './helpers.ts';

const ID = AC[2];
const bin = useShow();
const folder = useFolders();
const SEEDS = Array.from({ length: 12 }, (_, k) => k + 1);

function listings(): string[][] {
  const drawn = [[...REPRO_ORDER], [...ID_ORDER].reverse(), ...SEEDS.map((s) => shuffled(ID_ORDER, s))];
  const seen = new Set([ID_ORDER.join()]);
  return drawn.filter((l) => !seen.has(l.join()) && Boolean(seen.add(l.join())));
}

function nodesOf(reply: JsonObject, what: string): string[] {
  expect(reply['outcome'], `${what}: the frame is evaluated: ${brief(reply, 2000)}`).toBe('evaluated');
  return arr(reply['nodes'], `${what}: the frame's nodes`).filter(isObject)
    .map((n) => JSON.stringify([n['operator'] ?? null, n['module'] ?? null, n['phase'] ?? null, n['item'] ?? null, n['key'] ?? null, n['result'] ?? null]))
    .sort();
}

function nodesAtTimes(listing: readonly string[]): string[][] {
  const what = `the document listed ${listing.join(', ')}`;
  const [shown, ...frames] = run(bin(), scenarioOf(folder(), [show(liftedDoc(listing)), ...TIMES.map(evalAt)]));
  presented(shown!, what);
  return frames.map((f, k) => nodesOf(f, `${what} at ${TIMES[k]}`));
}

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
    expect(differences(['a', 'b', 'b'], ['a', 'b', 'b']), 'the judge passes the same multiset in any order').toEqual([]);
    expect(differences(['a', 'b', 'c'], ['a', 'b', 'b']).length, 'the judge fails a node whose result changed').toBe(2);
    expect(differences(['a', 'b'], ['a', 'b', 'b']).length, 'the judge fails a node dropped').toBe(1);

    const orders = listings();
    expect(orders.length, `the shuffles draw at least 6 orders other than ID order: ${brief(orders)}`).toBeGreaterThanOrEqual(6);
    expect(orders[0], 'the first is the reproduction\'s order').toEqual([...REPRO_ORDER]);

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
