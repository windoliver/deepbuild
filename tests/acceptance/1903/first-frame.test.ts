// #1903.c2287dc1: A test shim delays the creation of one pipeline by 500 ms. The `first frame wait` in a fresh process
// reads at least 500 ms, and the second open in the same process creates 0 pipelines and reads under 500 ms. A
// planted meter that starts its clock after warm-up reads under 500 ms in the fresh process and fails, naming the
// reading. Until you set the wait's limit the envelope is BLOCKED on it, never PASS.
//
// The envelope with `first_frame_wait` (`test-meter` build, wgpu's noop backend) under a reference Mac's environment,
// with a fresh store: it starts a fresh process that opens the scene twice, and the shim (`stub_pipeline_delay_ms`)
// makes the first pipeline that process's check creates 500 ms late. These readings are wall time, not the stub's.
// The wrong program is `--planted wait_clock_after_warmup`.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  REFERENCE, SCENE, WAIT_FRESH, WAIT_SAME, envelopeCall, envelopeOf, flat, metricRow, run, sceneDoc, stubMeter, useBuild, useOut, writeDoc,
  type Envelope, type Open, type Planted,
} from './helpers.ts';

const bin = useBuild();
const out = useOut();
const ID = '#1903.c2287dc1';
const DELAY_MS = 500;
const SECONDS = 5;

function waits(planted?: Planted): Envelope {
  const dir = out();
  const [reply] = run(bin(), dir, [envelopeCall({
    store: join(dir, 'store'), scene: writeDoc(dir, 'scene', sceneDoc()), seconds: SECONDS, first_frame_wait: true,
    stub_pipeline_delay_ms: DELAY_MS, stub_meter: stubMeter({ [SCENE]: flat(3) }), stub_environment: REFERENCE,
  })], planted ? { planted } : {});
  return envelopeOf(reply!, planted ? `the envelope, planted ${planted}` : 'the envelope');
}

/** The two opens, fresh first; a result without them fails here. */
function opens(e: Envelope): { fresh: Open; same: Open } {
  expect(e.first_frame_wait, 'the envelope reports its first frame wait').not.toBeNull();
  const fresh = e.first_frame_wait!.find((o) => o.open === 'fresh');
  const same = e.first_frame_wait!.find((o) => o.open === 'same_process');
  expect(fresh, 'the open in a fresh process').toBeDefined();
  expect(same, 'the second open in the same process').toBeDefined();
  return { fresh: fresh!, same: same! };
}

/** The criterion's check on the fresh open: each sentence names the reading. */
function freshProblems(fresh: Open): string[] {
  const out: string[] = [];
  if (fresh.ms < DELAY_MS) out.push(`the fresh process's first frame wait reads ${fresh.ms} ms, under the ${DELAY_MS} ms one of its pipelines took to create`);
  if (fresh.pipelines < 1) out.push(`the fresh process's first open creates ${fresh.pipelines} pipelines, so the delayed one isn't in its wait`);
  return out;
}

describe(`${ID} the first frame wait, from the document's check to its first presented frame`, () => {
  it(`${ID} with one pipeline's creation delayed 500 ms, the fresh process's wait reads at least 500 ms, the second open creates 0 pipelines and reads under 500 ms, and the envelope is BLOCKED on the wait until you set its limit`, () => {
    const e = waits();
    const { fresh, same } = opens(e);
    expect(freshProblems(fresh), 'the fresh open waits for the delayed pipeline').toEqual([]);
    expect(same.pipelines, 'the second open in the same process creates no pipeline').toBe(0);
    expect(same.ms, 'and reads under 500 ms').toBeLessThan(DELAY_MS);
    for (const [name, open] of [[WAIT_FRESH, fresh], [WAIT_SAME, same]] as const) {
      const m = metricRow(e, name, 'the envelope');
      expect(m.measured, `${name} is the open's reading`).toBeCloseTo(open.ms, 6);
      expect(m.limit, `${name} has no limit until you set one`).toBeNull();
      expect(m.verdict, `the envelope is BLOCKED on ${name}`).toBe('BLOCKED');
    }
    expect(e.verdict, 'never PASS').not.toBe('PASS');
    expect(e.asks.flatMap((a) => a.metrics.map((m) => m.metric)), 'the wait\'s limit is asked').toEqual(expect.arrayContaining([WAIT_FRESH, WAIT_SAME]));
  }, 1_800_000);

  it(`${ID} planted wait_clock_after_warmup reads under 500 ms in the fresh process and fails, naming the reading`, () => {
    const { fresh } = opens(waits('wait_clock_after_warmup'));
    expect(fresh.ms, 'the planted clock, started after warm-up, reads under 500 ms').toBeLessThan(DELAY_MS);
    expect(freshProblems(fresh).join('\n'), 'it fails, naming the reading').toMatch(new RegExp(`reads ${fresh.ms} ms`));
  }, 1_800_000);
});
