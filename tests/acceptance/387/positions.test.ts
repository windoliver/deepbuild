// #387.45eee1e5: in a data view whose mark set of 100,000 points takes its positions from a layout
// operator, the draw operator's key takes the layout operator's key, and a counting hash sees no pass
// over the positions' values to make it; the source column the layout reads is hashed once when a new
// batch arrives, never per frame; and the document reached by two patch histories gets byte-identical
// keys. The mark set is the test module `test.scatter`'s, its layout `test.scatter.layout` and its draw
// `test.scatter.draw`; the counting hash is the `hashes` list of the `batch` and `eval` replies (README:
// Readings). The wrong program is the planted `key_hashes_positions`, which passes the history part and
// fails the counting hash. At the base the `test-scatter` feature doesn't exist.
import { describe, expect, it } from 'vitest';
import {
  DOC, arr, board, evalCall, evaluated, f64Base64, num, obj, presented, run, sameNodes, scenario, show, str, useBuilds, useEvidence,
  type Build, type Evaluated, type Hashed, type JsonObject, type Node, type ScenarioExtra,
} from './helpers.ts';

const SCATTER: Build = { set: 'full', with: ['test-scatter'] };
const builds = useBuilds([SCATTER]);
const evidence = useEvidence();

const N = 100_000;
const POSITIONS = 'test.scatter.positions';
const COLUMN = 'pts.v';
const scatter = (n: number, box: number[]): JsonObject => ({ id: 'sc', kind: 'test.scatter@1', name: 'Scatter', order: 'a0', params: { box, source: 'pts', column: 'v', n } });
const chart = (n = N, box = [8, 8, 304, 184]): JsonObject => ({ ...board('Scatter', [scatter(n, box)], { requires: { modules: { 'test.scatter': '^1' } } }), profile: 'chart' });
const values = (salt: number): number[] => Array.from({ length: N }, (_, i) => ((i * salt) % 1000) / 1000);
const batch = (id: string, v: number[]): JsonObject => ({ call: 'batch', doc: id, source: 'pts', columns: { v: { dtype: 'f64', len: v.length, data: f64Base64(v) } } });
const V1 = values(7919);
const V2 = values(104_729);

function hashesOf(reply: JsonObject, what: string): Hashed[] {
  return arr(reply['hashes'], `${what}: hashes`).map((h, i) => {
    const o = obj(h, `${what}: hashes[${i}]`);
    return { of: str(o['of'], `${what}: hashes[${i}].of`), bytes: num(o['bytes'], `${what}: hashes[${i}].bytes`) };
  });
}
/** The counting hash's check: a frame that passes over the positions' or the source column's values to make a key fails, naming the array. */
function countingHashFailures(frames: { what: string; e: Evaluated }[]): string[] {
  return frames.flatMap(({ what, e }) => e.hashes.filter((h) => h.of === POSITIONS || h.of === COLUMN).map((h) => `${what} passed over the values of ${h.of} (${h.bytes} bytes) to make a key`));
}
const node = (e: Evaluated, operator: string): Node => {
  const n = e.nodes.find((x) => x.operator === operator && x.item === 'sc');
  expect(n, `${operator} has a node on the scatter`).toBeDefined();
  return n!;
};

/** One process: the chart, a batch, frames, a new batch, frames, the same batch again, a frame. */
function session(extra: ScenarioExtra = {}) {
  const calls = [
    show(chart()), batch(DOC.a, V1), evalCall(DOC.a, { t: '0s' }), evalCall(DOC.a, { t: '0.5s' }), evalCall(DOC.a, { t: '1s' }),
    batch(DOC.a, V2), evalCall(DOC.a, { t: '1.5s' }), evalCall(DOC.a, { t: '2s' }), batch(DOC.a, V2), evalCall(DOC.a, { t: '2.5s' }),
  ];
  const replies = run(builds.bin(SCATTER), scenario(evidence(), calls, extra));
  presented(replies[0]!, 'the 100,000-point chart');
  const frames = [2, 3, 4, 6, 7, 9].map((i) => ({ what: `the frame at call ${i}`, e: evaluated(replies[i]!, `the frame at call ${i}`) }));
  const batches = [1, 5, 8].map((i) => ({ what: `the batch at call ${i}`, hashes: hashesOf(replies[i]!, `the batch at call ${i}`) }));
  return { frames, batches };
}

/** Two documents reach the same chart by two revision histories, each sent the same batch; their last frames. */
function histories(extra: ScenarioExtra = {}): { a: Evaluated; b: Evaluated } {
  const calls = [
    show(chart(N, [0, 0, 100, 100]), { doc: DOC.a }), batch(DOC.a, V1), evalCall(DOC.a, { t: '1s' }), show(chart(), { doc: DOC.a }), evalCall(DOC.a, { t: '1s' }),
    show(chart(N, [16, 16, 280, 160]), { doc: DOC.b }), batch(DOC.b, V1), evalCall(DOC.b, { t: '1s' }), show(chart(N, [20, 20, 200, 100]), { doc: DOC.b }), evalCall(DOC.b, { t: '1s' }),
    show(chart(), { doc: DOC.b }), evalCall(DOC.b, { t: '1s' }),
  ];
  const replies = run(builds.bin(SCATTER), scenario(evidence(), calls, extra));
  for (const i of [0, 3, 5, 8, 10]) presented(replies[i]!, `revision call ${i}`);
  return { a: evaluated(replies[4]!, 'the first history\'s last frame'), b: evaluated(replies[11]!, 'the second history\'s last frame') };
}

describe('#387.45eee1e5 a 100,000-point mark set placed by a layout operator: the draw\'s key takes the layout\'s, no pass over the positions makes it, the source column is hashed once per batch and never per frame, two histories give the same keys, and a planted key that hashes the positions fails naming the array', () => {
  it('#387.45eee1e5 each batch is hashed once on arrival; no frame passes over the source column or the positions to make a key; the draw\'s key moves exactly when the layout\'s does', () => {
    const { frames, batches } = session();
    for (const b of batches) expect(b.hashes.filter((h) => h.of === COLUMN).length, `${b.what}: the source column ${COLUMN} is hashed exactly once when it arrives`).toBe(1);
    expect(countingHashFailures(frames), 'the counting hash sees no pass over the positions or the source column in any frame').toEqual([]);
    const layout = frames.map((f) => node(f.e, 'test.scatter.layout').key);
    const draw = frames.map((f) => node(f.e, 'test.scatter.draw').key);
    expect(new Set(layout.slice(0, 3)).size, 'with the first batch the layout\'s key holds across frames').toBe(1);
    expect(new Set(draw.slice(0, 3)).size, 'and so does the draw\'s').toBe(1);
    expect(layout[3], 'a batch with other values moves the layout\'s key').not.toBe(layout[2]);
    expect(draw[3], 'and the draw\'s, which takes it').not.toBe(draw[2]);
    expect([layout[5], draw[5]], 'the same values sent again move neither key').toEqual([layout[4], draw[4]]);
    expect(layout[4], 'frames between batches keep the layout\'s key').toBe(layout[3]);
  }, 600_000);

  it('#387.45eee1e5 the chart reached by two revision histories, each sent the same batch, gets byte-identical keys', () => {
    const { a, b } = histories();
    expect(sameNodes(a, b, 'the two histories\' last frames'), 'byte-identical keys and results').toEqual([]);
  }, 600_000);

  it('#387.45eee1e5 a planted key that hashes the positions array (key_hashes_positions) passes the history fixture and fails this test, naming test.scatter.positions', () => {
    const { a, b } = histories({ planted: 'key_hashes_positions' });
    expect(sameNodes(a, b, 'the planted key\'s two histories', { key: true, result: false }), 'the planted key passes the history part: the same keys').toEqual([]);
    const failures = countingHashFailures(session({ planted: 'key_hashes_positions' }).frames);
    expect(failures.length, 'the counting hash catches the planted key\'s pass over the positions').toBeGreaterThan(0);
    expect(failures.join('\n'), 'naming the array').toContain(POSITIONS);
  }, 600_000);
});
