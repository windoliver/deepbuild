// AC8 #172.d308bc55: "With a test shim adapter that offers WebGPU's spec-default limits plus exactly the lab's `gpu_needs`
// features, the lab plays its 600-step track with step hashes equal to the app's; under a shim that offers a
// maxStorageBufferBindingSize of 1,073,741,824 bytes against the default 134,217,728, the logged device request still
// equals `gpu_needs`; and a planted player that requests the adapter's limits asks for 1,073,741,824 there and fails,
// naming maxStorageBufferBindingSize"
//
// The shim is test code put in the page before any of its scripts (README: The shim adapter): the real adapter behind a
// proxy whose limits are a default device's (WebGPU's spec defaults) with the test's values on top, and whose features
// are exactly those named; every device request is logged before it is passed on.
//
// asserts:
//   - under the default shim with `gpu_needs.features` and the first of each `any_of` set: the lab is ready, plays to
//     `ended` at step 600 with the app's step hashes and full-state hashes there, a seek to each of 20 sampled steps
//     reads the app's step hashes, and each logged device request equals `gpu_needs` (no feature or limit more or less);
//   - under the shim offering maxStorageBufferBindingSize 1,073,741,824 (its adapter reads that, a default device
//     134,217,728): each logged request still equals `gpu_needs`;
//   - the planted player `web_requests_adapter_limits` under that shim logs a request for 1,073,741,824, and the same
//     judgement fails, naming maxStorageBufferBindingSize.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, FULL, LAB_STEPS, TIMEOUT, appRecord, checkpointFailures, done, exportLab, failsNaming, labDoc, labTrack, needsShim, none, play, prebuildPhysics,
  requestFailures, seededSteps, stepFailures, useBrowsers, useShow, useTemp, type GpuNeeds, type Played,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const browsers = useBrowsers();
prebuildPhysics();
const PLANTED = 'web_requests_adapter_limits';
const BIG = 1_073_741_824;
const DEFAULT = 134_217_728;
const SAMPLED = seededSteps(1728, 20, LAB_STEPS);

/** The requests the shim logged, each judged against gpu_needs; none logged is a failure too. */
async function loggedFailures(p: Played, needs: GpuNeeds, what: string): Promise<{ failures: string[]; asked: number[] }> {
  const log = await p.tab.requestsLogged();
  if (!log || !log.requests.length) return { failures: [`${what}: the player made no device request through the shim`], asked: [] };
  return {
    failures: log.requests.flatMap((r, i) => requestFailures(r, needs, log.defaults, `${what}, request ${i + 1}`)),
    asked: log.requests.map((r) => r.requiredLimits['maxStorageBufferBindingSize'] ?? DEFAULT),
  };
}

describe(`${AC[8]} the player requests exactly gpu_needs, and plays the lab on an adapter of WebGPU's default limits`, () => {
  it(`${AC[8]} on a shim of spec-default limits and exactly the lab's gpu_needs features, the lab plays its 600 steps with the app's step hashes, and its request is gpu_needs`, async () => {
    const evidence = temp();
    const app = appRecord(shows(FULL), evidence, labDoc(evidence), labTrack(), [...SAMPLED, LAB_STEPS], 'the lab');
    const lab = exportLab(shows(FULL), evidence, join(temp(), 'bundle'), 'the lab exported to the web');
    const needs = lab.receipt.gpu_needs;
    const p = browsers(await play(lab.out, { shim: needsShim(needs) }));
    await p.tab.mustBeReady('the lab on the default shim');
    await p.tab.playToEnd('the lab on the default shim');
    const end = await p.tab.probe('the lab on the default shim, at its end');
    const failures = [...stepFailures('the default shim, played to the end', end, app, LAB_STEPS), ...checkpointFailures('the default shim, played to the end', end, app)];
    for (const k of SAMPLED) failures.push(...stepFailures(`the default shim, a seek to step ${k}`, await p.tab.seekStep(k, `the default shim, step ${k}`), app, k));
    failures.push(...(await loggedFailures(p, needs, 'the default shim')).failures);
    none(failures, 'on an adapter of WebGPU\'s default limits and the lab\'s features, the lab plays as the app, asking for gpu_needs');
    await done(p);
  }, TIMEOUT);

  it(`${AC[8]} under a shim offering maxStorageBufferBindingSize ${BIG}, the request still equals gpu_needs; the planted ${PLANTED} asks for ${BIG} and fails, naming it`, async () => {
    const lab = exportLab(shows(FULL), temp(), join(temp(), 'bundle'), 'the lab exported to the web');
    const needs = lab.receipt.gpu_needs;
    const shim = needsShim(needs, { maxStorageBufferBindingSize: BIG });
    const p = browsers(await play(lab.out, { shim }));
    await p.tab.mustBeReady('the lab on the big shim');
    const logged = await loggedFailures(p, needs, 'the big shim');
    // Read after the log: this check's own default device goes through the shim and is logged too.
    const offered = await p.tab.evaluate<{ adapter: number; device: number }>(`(async () => { const a = await navigator.gpu.requestAdapter();
      const d = await a.requestDevice(); const r = { adapter: a.limits.maxStorageBufferBindingSize, device: d.limits.maxStorageBufferBindingSize }; d.destroy(); return r; })()`);
    expect(offered, `the shim's adapter offers ${BIG}, against a default device's ${DEFAULT}`).toEqual({ adapter: BIG, device: DEFAULT });
    none(logged.failures, 'under the big shim, the logged device request equals gpu_needs');
    await done(p);

    const planted = exportLab(shows(FULL), temp(), join(temp(), 'bundle'), `the lab (planted ${PLANTED})`, PLANTED);
    const q = browsers(await play(planted.out, { shim }));
    await q.tab.ready(60_000);
    const bad = await loggedFailures(q, needs, `the planted ${PLANTED}`);
    expect(bad.asked, `the planted player asks for the adapter's ${BIG}`).toContain(BIG);
    failsNaming(bad.failures, 'maxStorageBufferBindingSize', `the planted player ${PLANTED}`);
    await done(q);
  }, TIMEOUT);
});
