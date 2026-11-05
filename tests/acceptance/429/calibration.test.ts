// #429.b460869b: the release preflight's calibration run times every shipped operator and the fixture graphs, each
// in its own pass over five runs after warm-up on the reference Mac, and passes only when each estimate is within
// 25% of its measured 95th percentile; a release whose run fails ships no composed graph; a planted op table with the
// noise octave weight halved fails the run, naming each graph that uses noise.
//
// The run is `deep-gpu`'s `calibrate` call (README), which the release preflight runs as the release lane
// `operator calibration` (scripts/lanes.mjs, releaseLanes). It answers each graph it timed with its origin, whether
// it uses noise, whether it ran in its own pass, its warm-up and its five runs' 95th percentiles, its estimate and
// the run's result, and whether composed graphs ship. This test recomputes the 25% bound from those numbers and
// holds the list to every shipped operator #380's `operators` call lists. Off a reference Mac it is INCONCLUSIVE; a
// run that fails on a loaded machine is INCONCLUSIVE too. At the base there is no calibrate call and no such lane.
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { REPO, answered, inconclusive, loadPerCore, num, objs, requireReferenceMac, run1, shown, str, useBins, useOut, type JsonObject, type Planted } from './helpers.ts';

const bins = useBins();
const out = useOut();

interface Calibration { result: string; composed: string; graphs: JsonObject[]; raw: JsonObject }
function calibrate(planted?: Planted): Calibration {
  const r = answered(run1(bins.bin(), out(), { call: 'calibrate' }, planted, 3_500_000), 'calibrate');
  return { result: str(r['result'], 'result'), composed: str(r['composed'], 'composed'), graphs: objs(r['graphs'], 'graphs'), raw: r };
}
/** The graphs whose estimate is more than 25% from their measured p95 (the larger of the five runs' p95s). */
function outside(graphs: JsonObject[]): string[] {
  return graphs.filter((g) => {
    const measured = Math.max(...(g['p95_ns'] as number[]));
    return Math.abs(num(g['estimate_ns'], `${String(g['name'])}.estimate_ns`) - measured) > 0.25 * measured;
  }).map((g) => str(g['name'], 'name'));
}

describe('#429.b460869b the release calibration run holds the op table\'s weights to measurement', () => {
  it('#429.b460869b the run times every shipped operator and the fixture graphs in their own passes, five runs after warm-up, and passes with each estimate within 25% of its p95', async () => {
    requireReferenceMac();
    const { releaseLanes } = (await import(join(REPO, 'scripts/lanes.mjs'))) as { releaseLanes: { name: string; commands: string[][] }[] };
    expect(releaseLanes.some((l) => l.name === 'operator calibration'), 'the release preflight runs the calibration lane').toBe(true);
    const shipped = objs(answered(run1(bins.bin(), out(), { call: 'operators' }), 'operators')['operators'], 'operators').filter((o) => o['origin'] === 'shipped').map((o) => str(o['name'], 'name'));
    const c = calibrate();
    const names = c.graphs.map((g) => str(g['name'], 'name'));
    expect(shipped.filter((n) => !names.includes(n)), 'every shipped operator is timed').toEqual([]);
    expect(c.graphs.filter((g) => g['origin'] === 'fixture').length, 'and the fixture graphs').toBeGreaterThan(0);
    for (const g of c.graphs) {
      const at = str(g['name'], 'name');
      expect(g['own_pass'], `${at} runs in its own pass`).toBe(true);
      expect(g['warmup'], `${at} is warmed up first`).toBe(true);
      expect((g['p95_ns'] as number[] | undefined)?.length, `${at}: five runs`).toBe(5);
    }
    const off = outside(c.graphs);
    if (c.result !== 'PASS' && loadPerCore() > 1) inconclusive(`the run failed under load ${loadPerCore().toFixed(2)} a core: ${off.join(', ')}`);
    expect(off, 'every estimate within 25% of its measured p95').toEqual([]);
    expect(c.result, shown(c.raw).slice(0, 600)).toBe('PASS');
    expect(c.composed, 'a passing run ships composed graphs').toBe('ships');
  }, 3_600_000);

  it('#429.b460869b a planted op table with the noise octave weight halved (--planted noise_weight_halved) fails the run, naming each graph that uses noise, and ships no composed graph', () => {
    requireReferenceMac();
    const c = calibrate('noise_weight_halved');
    const noisy = c.graphs.filter((g) => g['uses_noise'] === true).map((g) => str(g['name'], 'name')).sort();
    expect(noisy.length, 'some timed graphs use noise').toBeGreaterThan(0);
    expect(c.result, 'the run fails').toBe('FAIL');
    expect(c.composed, 'a release whose run fails ships no composed graph').toBe('held');
    const named = objs(c.raw['outside'], 'outside').map((o) => str(o['name'], 'name')).sort();
    expect(noisy.filter((n) => !named.includes(n)), `the run names each graph that uses noise: ${named.join(', ')}`).toEqual([]);
  }, 3_600_000);
});
