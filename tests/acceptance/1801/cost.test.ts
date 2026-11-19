// AC5: `cost` on a fixture with one 4,096 px texture, one 200,000-triangle mesh and 300 small rects ranks the texture
// first by GPU memory and the mesh first by GPU time, and each column's rows sum to the meter's total for the frame
// within 1%. A planted table that leaves out shared assets sums short and fails, naming the asset.
//
// The cost scene (README: Fixtures) is alpha's own 3D document in the export class: the texture is a 4,096 × 2,048
// PNG in the evidence store, the base color map of one material two panels wear; the mesh is a plate of 500 × 200
// cells, two triangles each; and 300 rects. "The meter's total for the frame" is what the meter refuses on (#379):
// the same scene with its caps tightened to nothing is refused with one `over_budget` error whose `actual` is the
// meter's estimate per frame, a column each.
import { describe, expect, it } from 'vitest';
import {
  COLUMNS, DOC, FULL, MESH, TEXTURE_PNG, arr, brief, costOf, costRowName, costScene, coverage, failsNaming, isObject, none, num, obj, presented, rows, run, scenario, show,
  stored, sumFailures, useBuilds, useEvidence, type Column, type JsonObject,
} from './helpers.ts';

const builds = useBuilds([FULL]);
const evidence = useEvidence();
const EXPORT: JsonObject = { class: 'export' };
/** The same class with every cap the document may tighten set below any estimate, so the meter refuses it. */
const NOTHING_FITS: JsonObject = { class: 'export', frame_cpu_ms: 0.0001, frame_gpu_ms: 0.0001, gpu_mb: 0.0001 };

interface Read { texture: string; totals: Record<Column, number>; byMemory: JsonObject[]; byTime: JsonObject[]; memoryReply: JsonObject }

/** The scene shown in its class, its twin refused by the meter, and cost by GPU memory and by GPU time, every page of each. */
function costs(planted?: string): Read {
  const bin = builds.bin(FULL);
  const extra: JsonObject = planted ? { planted } : {};
  const texture = stored(evidence(), TEXTURE_PNG());
  const scene = show(DOC.cost, costScene(texture, EXPORT));
  const [shown, refused, byMemory, byTime] = run(bin, scenario(evidence(), { [DOC.cost]: null, [DOC.meter]: null }, [
    scene,
    show(DOC.meter, costScene(texture, NOTHING_FITS)),
    costOf(DOC.cost, 'gpu_mb'),
    costOf(DOC.cost, 'gpu_ms'),
  ], extra));
  presented(shown, 'the cost scene in the export class');
  expect(refused!['outcome'], `the twin whose caps nothing fits is refused by the meter: ${brief(refused, 1500)}`).toBe('refused');
  const over = arr(refused!['issues'], 'the refusal\'s issues').filter((i) => isObject(i) && i['code'] === 'over_budget');
  expect(over.length, `one over_budget issue: ${brief(refused!['issues'], 1500)}`).toBe(1);
  const actual = obj((over[0] as JsonObject)['actual'], 'over_budget\'s actual, the meter\'s estimate per frame');
  const totals = Object.fromEntries(COLUMNS.map((c) => [c, num(actual[c], `the meter's ${c}`)])) as Record<Column, number>;
  // A reply past 64 KB pages with `next` (#412): the rest comes from the same read with that cursor, a run each.
  const pages = (first: JsonObject, by: Column): JsonObject[] => {
    const out = rows(first, `cost by ${by}`);
    let next = first['next'];
    for (let page = 2; typeof next === 'string' && page <= 20; page++) {
      const [again, reply] = run(bin, scenario(evidence(), { [DOC.cost]: null }, [scene, { ...costOf(DOC.cost, by), cursor: next }], extra));
      presented(again, `the cost scene, for page ${page} of cost by ${by}`);
      out.push(...rows(reply, `cost by ${by}, page ${page}`));
      next = reply!['next'];
    }
    return out;
  };
  return { texture, totals, byMemory: pages(byMemory!, 'gpu_mb'), byTime: pages(byTime!, 'gpu_ms'), memoryReply: byMemory! };
}

/** Each row's `column` is no more than the row before it's: the rows are ranked by it. */
function rankFailures(list: readonly JsonObject[], column: Column): string[] {
  const out: string[] = [];
  list.forEach((r, i) => {
    if (typeof r[column] !== 'number') out.push(`${costRowName(r)} carries no ${column}`);
    else if (i > 0 && typeof list[i - 1]![column] === 'number' && (r[column] as number) > (list[i - 1]![column] as number)) out.push(`${costRowName(r)} (${String(r[column])}) is ranked below ${costRowName(list[i - 1]!)} (${String(list[i - 1]![column])}) by ${column}`);
  });
  return out;
}

describe('AC5 cost ranks the document\'s items and assets by the meter\'s own terms, and each column sums to the meter\'s total', () => {
  it('AC5 the texture is first by GPU memory and the mesh first by GPU time, and each column\'s rows sum to the meter\'s total within 1%', () => {
    const { texture, totals, byMemory, byTime, memoryReply } = costs();
    console.log(`AC5 the meter's totals: ${JSON.stringify(totals)}; first by gpu_mb ${brief(byMemory[0], 400)}; first by gpu_ms ${brief(byTime[0], 400)}`);
    for (const c of COLUMNS) expect(totals[c], `the meter's total ${c} is above 0: the fixture costs something in every column`).toBeGreaterThan(0);
    expect(byMemory.length, 'every row the coverage block counts is read, through its pages').toBe(num(coverage(memoryReply, 'cost by gpu_mb')['rows_total'], 'cost by gpu_mb: rows_total'));
    expect(new Set(byMemory.map(costRowName)).size, 'each row once').toBe(byMemory.length);

    none(rankFailures(byMemory, 'gpu_mb'), 'cost by gpu_mb is ranked by GPU memory');
    expect(costRowName(byMemory[0]!), 'the texture is first by GPU memory').toBe(`asset ${texture}`);
    none(rankFailures(byTime, 'gpu_ms'), 'cost by gpu_ms is ranked by GPU time');
    expect(costRowName(byTime[0]!), 'the 200,000-triangle mesh is first by GPU time').toBe(`item ${MESH}`);

    none(sumFailures(byMemory, totals, [{ sha256: texture, what: 'the 4,096 px texture' }]), 'each column\'s rows sum to the meter\'s total for the frame within 1%');
    for (const c of COLUMNS) {
      const shares = byMemory.map((r) => (isObject(r['share']) ? r['share'][c] ?? null : null));
      expect(shares.every((s) => typeof s === 'number' && s >= 0 && s <= 1), `each row carries its share of the document's ${c}, from 0 to 1: ${brief(shares, 300)}`).toBe(true);
      const sum = (shares as number[]).reduce((a, b) => a + b, 0);
      expect(Math.abs(sum - 1), `the rows' shares of ${c} sum to 1 within 1% (they sum to ${sum})`).toBeLessThanOrEqual(0.01);
    }
  });

  it('AC5 a planted table that leaves out shared assets sums short of the meter\'s total and fails, naming the texture', () => {
    const { texture, totals, byMemory } = costs('cost_without_shared_assets');
    failsNaming(sumFailures(byMemory, totals, [{ sha256: texture, what: 'the 4,096 px texture' }]), [texture], 'a cost table without its shared assets');
  });
});
