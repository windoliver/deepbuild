// AC5 #1636.03118491: "`wind` reads 0 at the trunk base and 1 at the farthest tip within 1e-4; under `sway {weight: wind,
// amount: 0.3 m}` the trunk base moves 0 m and that tip 0.3 m within 1%"
//
// The fixture tree (helpers.ts `FIXTURE`), read by `geometry` with its `wind` point attribute (README: Assumed
// surfaces 4). The trunk base is the trunk's first ring; the farthest tip is the tip with the longest path from the root,
// measured along the ring centres (README: Readings: of the tips within 0.5% of the longest, the one whose last ring
// reads the most wind), its last ring's vertices.
//   - First test: every vertex of the trunk's first ring reads |wind| ≤ 1e-4, every vertex of that tip's last ring
//     |wind − 1| ≤ 1e-4, and no vertex reads below −1e-4 or above 1 + 1e-4.
//   - Second test, on the GPU: the same tree with `mod.sway@1 {amount: 0.3, weight: wind}` (its gusts' strength 0, so a
//     vertex's lean is amount × its weight × sin(2π hz t + phase) at the default 0.4 Hz; README: Readings), drawn by
//     `view3d` at 30 fps for 2.5 s (76 frames, one whole period) with `sway: [tree]` (#2016's report, positions in the
//     order `geometry` lists them, README: Assumed surfaces 9), against the same tree with its sway `enabled: false`.
//     Each trunk-base vertex's largest move is at most 1% of 0.3 m, 0.003 m; each vertex of that tip's last ring moves
//     at most 0.3 m × 1.01 and at least 0.3 m × 0.99.
// Wrong programs: the base (no tree@1, no `wind`); wind as height (the highest tip reads 1, not the farthest); wind by
// level or by ring count; the path counted from each branch's own base; wind not normalized; a sway that doesn't read
// the stored weight (its height weight moves the trunk base's ring, which isn't the lowest point, and the tip by its
// height).
import { describe, expect, it } from 'vitest';
import {
  AC, FIXTURE, PLAIN, TIMEOUT, docId, farthestTip, framesOf, geometry, len, none, obj, presented, requireMetal, runGpu, runShow, scenario, sessionDoc,
  show, sub, treeItem, treeRow, treesDoc, trunkOf, useBins, useFolders, windOf, writeJson, arr, num, type JsonObject, type V3,
} from './helpers.ts';

const ID = AC[5];
const NAME = `AC5 ${ID}`;
const bin = useBins(['deep-show', 'deep-gpu']);
const folder = useFolders();
const DOC = docId(6);
const AMOUNT = 0.3;
const FPS = 30;
const FRAMES = 76;

function fixture(): { row: ReturnType<typeof treeRow>; wind: number[] } {
  const [shown, read] = runShow(bin('deep-show'), scenario(folder(), [DOC], [show(DOC, treesDoc({ tree: treeItem(FIXTURE) })), geometry(DOC, ['tree'])]));
  presented(shown!, 'the fixture tree');
  const row = treeRow(read!, 'tree', 'the fixture tree');
  return { row, wind: windOf(row, 'the fixture tree') };
}

describe(`${NAME} the wind weight, and the sway that reads it`, () => {
  it(`${NAME} wind reads 0 at the trunk base and 1 at the farthest tip within 1e-4`, () => {
    const { row, wind } = fixture();
    const base = trunkOf(row).rings[0]!;
    const tip = farthestTip(row, wind);
    const end = tip.rings[tip.rings.length - 1]!;
    console.log(`${ID} the farthest tip is ${tip.id} (level ${tip.level}); wind there ${end.map((i) => wind[i]!.toFixed(6)).join(', ')}`);
    none(base.flatMap((i) => (Math.abs(wind[i]!) <= 1e-4 ? [] : [`trunk base vertex ${i} reads wind ${wind[i]}`])), 'wind reads 0 at the trunk base within 1e-4');
    none(end.flatMap((i) => (Math.abs(wind[i]! - 1) <= 1e-4 ? [] : [`tip ${tip.id}'s vertex ${i} reads wind ${wind[i]}`])), `wind reads 1 at the farthest tip (${tip.id}) within 1e-4`);
    none(wind.flatMap((w, i) => (w >= -1e-4 && w <= 1 + 1e-4 ? [] : [`vertex ${i} reads wind ${w}`])).slice(0, 10), 'every vertex reads wind within [0, 1]');
  }, 2 * TIMEOUT);

  it(`${NAME} under sway {weight: wind, amount: 0.3 m} the trunk base moves 0 m and the farthest tip 0.3 m within 1%`, () => {
    const { row, wind } = fixture();
    const base = trunkOf(row).rings[0]!;
    const tip = farthestTip(row, wind);
    const end = tip.rings[tip.rings.length - 1]!;
    requireMetal();
    const dir = folder();
    const doc = (swaying: boolean): string => writeJson(dir, swaying ? 'sway' : 'still', sessionDoc(`wind-1636-${swaying}`, [320, 240], {
      tree: treeItem(FIXTURE, { modifiers: [{ kind: 'mod.sway@1', enabled: swaying, params: { amount: AMOUNT, weight: 'wind', wind: { gust: { strength: 0 } }, seed: 7 } }] }),
    }));
    const call = (path: string): JsonObject => ({ call: 'view3d', doc: path, look: PLAIN, size: [320, 240], fps: FPS, from: 0, frames: FRAMES, sway: ['tree'] });
    const [swaying, still] = runGpu(bin('deep-gpu'), dir, [call(doc(true)), call(doc(false))]);
    const positions = (reply: JsonObject, what: string): V3[][] => framesOf(reply, FRAMES, what).map((f, k) => {
      const list = arr(obj(obj(f['sway'], `${what}: frame ${k}'s sway (#2016's report)`)['tree'], `${what}: frame ${k}: the tree`)['positions'], `${what}: frame ${k}: positions`);
      expect(list.length, `${what}: frame ${k} reports the tree's ${row.positions.length} vertices, in geometry's order (README: Assumed surfaces 9)`).toBe(row.positions.length);
      return [...base, ...end].map((i): V3 => { const p = arr(list[i], `${what}: vertex ${i}`); return [num(p[0], 'x'), num(p[1], 'y'), num(p[2], 'z')]; });
    });
    const [moving, rest] = [positions(swaying!, 'the swaying tree'), positions(still!, 'the still tree')];
    const largest = (k: number): number => moving.reduce((m, f) => Math.max(m, len(sub(f[k]!, rest[0]![k]!))), 0);
    const moves = [...base, ...end].map((_, k) => largest(k));
    const [baseMoves, tipMoves] = [moves.slice(0, base.length), moves.slice(base.length)];
    console.log(`${ID} largest moves over one period: trunk base ${baseMoves.map((m) => m.toFixed(5)).join(', ')} m; tip ${tip.id} ${tipMoves.map((m) => m.toFixed(5)).join(', ')} m`);
    none(baseMoves.flatMap((m, k) => (m <= 0.01 * AMOUNT ? [] : [`trunk base vertex ${base[k]} moves ${m.toFixed(5)} m`])), 'the trunk base moves 0 m within 1% of 0.3 m');
    none(tipMoves.flatMap((m, k) => (Math.abs(m - AMOUNT) <= 0.01 * AMOUNT ? [] : [`tip ${tip.id}'s vertex ${end[k]} moves at most ${m.toFixed(5)} m`])), `the farthest tip (${tip.id}) moves 0.3 m within 1%`);
  }, 2 * TIMEOUT);
});
