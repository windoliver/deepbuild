// AC17: with several hardware adapters, the seam picks the one that grants the most of the tier's features, ties to
// the highest reported memory, and every receipt names it. Two test adapters stand on this Mac's GPU (test-seam,
// `--adapters`), the integrated one listed first so a pick of the first enumerated is caught: once the integrated
// one lacks a gated feature but reports more memory (features decide), once both grant every feature and the
// discrete one reports more memory (memory decides). With the discrete one withheld (left out of the enumeration)
// the integrated one is picked. `--planted picks_first_adapter` picks the first enumerated and fails, the failure
// naming both. At the base there is no test-seam build.
import { describe, expect, it } from 'vitest';
import {
  ADAPTER, adapterReply, adaptersFile, gatedCall, gatedReply, requireMac, run, useBuilds, useOut, type Startup, type TestAdapter,
} from './helpers.ts';

const bins = useBuilds(['default', 'test-seam']);
const out = useOut();
const GIB = 2 ** 30;

/** What the seam picked, by the adapter call and by every receipt of a gated run on `feature`. */
function picked(feature: string, startup: Startup): { adapter: string; receipts: string[] } {
  const [a, g] = run(bins.bin('test-seam'), out(), [ADAPTER, gatedCall(feature)], startup);
  const gated = gatedReply(g!, 'the gated call');
  expect(gated.fixtures.length, 'the gated run made results with receipts').toBeGreaterThan(0);
  return { adapter: adapterReply(a!).adapter.name, receipts: gated.fixtures.map((x) => x.receipt.adapter) };
}
/** The check: the seam picked `want` and every receipt names it; a failure names both adapters. */
function pickProblems(p: { adapter: string; receipts: string[] }, want: string, other: string): string[] {
  const f: string[] = [];
  if (p.adapter !== want) f.push(`the seam picked ${p.adapter} where ${want} grants at least as many of the tier's features as ${other} and wins the tie on memory`);
  p.receipts.forEach((r, i) => { if (r !== want) f.push(`receipt ${i} names ${r}, not the picked ${want} (beside ${other})`); });
  return f;
}

describe('AC17 among several adapters the seam picks the one granting the most of the tier\'s features, ties to the highest memory, and every receipt names it', () => {
  function setup(): { all: string[]; gated: string; integratedFewer: TestAdapter; integratedTied: TestAdapter; discrete: TestAdapter } {
    const mac = adapterReply(run(bins.bin(), out(), [ADAPTER])[0]!, 'the adapter call on this Mac');
    const all = mac.table.map((r) => r.feature);
    const gated = mac.table.find((r) => !r.required)?.feature ?? '';
    expect(gated, 'the tier has a gated feature').not.toBe('');
    const base = { vendor: 4203, driver: '1.0' };
    return {
      all, gated,
      integratedFewer: { ...base, name: 'test integrated', type: 'integrated_gpu', device: 1, memory: 32 * GIB, features: all.filter((f) => f !== gated) },
      integratedTied: { ...base, name: 'test integrated', type: 'integrated_gpu', device: 1, memory: 8 * GIB, features: all },
      discrete: { ...base, name: 'test discrete', type: 'discrete_gpu', device: 2, memory: 16 * GIB, features: all },
    };
  }

  it('AC17 with a test integrated adapter listed first and a test discrete adapter granting every feature of the tier, the seam picks the discrete one and every receipt names it, whether features or memory decide', () => {
    requireMac();
    const s = setup();
    const dir = out();
    const fewer = adaptersFile(dir, 'fewer.json', [s.integratedFewer, s.discrete]);
    const tied = adaptersFile(dir, 'tied.json', [s.integratedTied, s.discrete]);
    expect(pickProblems(picked(s.gated, { adapters: fewer }), 'test discrete', 'test integrated'), 'the integrated adapter lacks a feature and reports more memory: the discrete one grants more').toEqual([]);
    expect(pickProblems(picked(s.gated, { adapters: tied }), 'test discrete', 'test integrated'), 'both grant every feature: the discrete one reports more memory').toEqual([]);
  }, 1_800_000);

  it('AC17 with the discrete adapter withheld, the seam picks the integrated one and every receipt names that', () => {
    requireMac();
    const s = setup();
    const only = adaptersFile(out(), 'integrated-only.json', [s.integratedFewer]);
    expect(pickProblems(picked(s.gated, { adapters: only }), 'test integrated', 'the withheld test discrete')).toEqual([]);
  }, 1_800_000);

  it('AC17 a planted pick of the first adapter enumerated fails, naming both', () => {
    requireMac();
    const s = setup();
    const dir = out();
    for (const [name, file] of [['fewer', adaptersFile(dir, 'fewer.json', [s.integratedFewer, s.discrete])], ['tied', adaptersFile(dir, 'tied.json', [s.integratedTied, s.discrete])]] as const) {
      const f = pickProblems(picked(s.gated, { adapters: file, planted: 'picks_first_adapter' }), 'test discrete', 'test integrated');
      expect(f.length, `${name}: the planted pick fails the check`).toBeGreaterThan(0);
      expect(f[0], `${name}: the failure names the discrete adapter`).toContain('test discrete');
      expect(f[0], `${name}: the failure names the integrated adapter`).toContain('test integrated');
    }
  }, 1_800_000);
});
