// #29 AC11: a timing check that fails while other sessions load the machine past its core count is rerun alone; the run under
// load stays in the record with its output and the load, and counts neither way; the runs alone decide as #28's do.
import { describe, expect, it } from 'vitest';
import { runTiming } from '../../../packages/gate/src/index.ts';

const CORES = 8;
/**
 * A scripted check: run n ends as `ends[n-1]`, with output `out-n`. The machine's load is 14.5 (over its 8 cores) until the second
 * run starts, and 2 after (others finish), bounded to ten readings so a runner that waits for quiet is released.
 */
function scripted(ends: boolean[]) {
  let started = 0;
  let readings = 0;
  const machine = {
    cores: CORES,
    load: (): number => (++readings <= 10 && started < 2 ? 14.5 : 2),
  };
  const check = {
    run: (): { passed: boolean; output: string } => {
      started += 1;
      if (started > ends.length) throw Error(`the runner started run ${started}, more than the ${ends.length} the case allows`);
      return { passed: ends[started - 1]!, output: `out-${started}` };
    },
  };
  return { check, machine, runs: () => started };
}

describe('AC11 a timing check that fails under load is rerun alone', () => {
  it('AC11 fails under load, then passes alone: PASS, with both runs in the record and the first marked under load with the machine\'s load', () => {
    const s = scripted([false, true]);
    const r = runTiming(s.check, s.machine);
    expect(r.outcome).toBe('PASS');
    expect(r.runs.length, 'both runs are in the record').toBe(2);
    const [loaded, alone] = r.runs as [typeof r.runs[number], typeof r.runs[number]];
    expect(loaded.under_load, 'the first run is marked under load').toBe(true);
    expect(loaded.load, 'with the machine\'s load').toBe(14.5);
    expect(loaded.cores).toBe(CORES);
    expect(loaded.outcome, 'the run under load counts neither way').toBe('uncounted');
    expect(loaded.output, 'and keeps its output').toBe('out-1');
    expect(alone.under_load).toBe(false);
    expect(alone.outcome).toBe('passed');
    expect(alone.output).toBe('out-2');
  });
  it('AC11 fails under load and fails alone: two more runs follow, and when every run alone fails it is FAIL with every run\'s output in the record', () => {
    const s = scripted([false, false, false, false]);
    const r = runTiming(s.check, s.machine);
    expect(r.outcome).toBe('FAIL');
    expect(s.runs(), 'one run under load, then the run alone and up to two more: four runs').toBe(4);
    expect(r.runs.map((x) => x.output), 'every run\'s output is in the record').toEqual(['out-1', 'out-2', 'out-3', 'out-4']);
    expect(r.runs.map((x) => x.outcome)).toEqual(['uncounted', 'failed', 'failed', 'failed']);
    expect(r.runs.map((x) => x.under_load)).toEqual([true, false, false, false]);
  });
  it('AC11 fails under load, fails alone, then a pass among the two more: INCONCLUSIVE, and the pass ends the runs', () => {
    const s = scripted([false, false, true]);
    const r = runTiming(s.check, s.machine);
    expect(r.outcome).toBe('INCONCLUSIVE');
    expect(s.runs(), 'the pass ends them: three runs, no fourth').toBe(3);
    expect(r.runs.map((x) => x.output)).toEqual(['out-1', 'out-2', 'out-3']);
    expect(r.runs.map((x) => x.outcome)).toEqual(['uncounted', 'failed', 'passed']);
  });
  it('AC11 a pass on the second of the two more runs alone is INCONCLUSIVE too, with all four runs in the record', () => {
    const s = scripted([false, false, false, true]);
    const r = runTiming(s.check, s.machine);
    expect(r.outcome).toBe('INCONCLUSIVE');
    expect(r.runs.map((x) => x.output)).toEqual(['out-1', 'out-2', 'out-3', 'out-4']);
    expect(r.runs.map((x) => x.outcome)).toEqual(['uncounted', 'failed', 'failed', 'passed']);
  });
  it('AC11 a failure while the machine is not loaded past its cores is no loaded run: three failures are FAIL, three runs, none marked under load', () => {
    let n = 0;
    const r = runTiming({ run: () => ({ passed: false, output: `out-${++n}` }) }, { load: () => 3, cores: CORES });
    expect(r.outcome).toBe('FAIL');
    expect(r.runs.length).toBe(3);
    expect(r.runs.every((x) => !x.under_load && x.outcome === 'failed')).toBe(true);
    expect(r.runs.map((x) => x.output)).toEqual(['out-1', 'out-2', 'out-3']);
  });
  it('AC11 a first pass is PASS with one run', () => {
    let n = 0;
    const r = runTiming({ run: () => ({ passed: true, output: `out-${++n}` }) }, { load: () => 3, cores: CORES });
    expect(r.outcome).toBe('PASS');
    expect(r.runs.length).toBe(1);
  });
});
