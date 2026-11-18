// AC3 #155.5d489fd3: "A generator strip whose job hasn't run is BLOCKED naming the job, and a rerun with the same key
// is a cache hit"
//
// A real hub with deepbuild/foley-render installed (README: The surface under test), deep-show reading the hub's
// evidence store, and a media document pinning deepbuild/foley@1.0.0 whose one strip `tap` plays
// `src: {generator: {job: "foley.paper.tap", output: "l2r3"}}` (Strip and track: generator sources; a variant named by
// its level and round robin *(chosen)*).
//   - `foley_plan` answers the job `foley.paper.tap`: a foley.render job on foley-render@1.0.0 with its params.
//   - With no run of it among the scenario's `jobs` (the deep_job replies the hub holds), `media_mix` is BLOCKED, its
//     reply naming `foley.paper.tap`, with no mix.
//   - deep_job runs the plan's job: done, a cache miss, its twelve variants, in a process the hub started. Run again
//     with the same params (the same key): done, a cache hit with the same key and the same twelve variants, starting
//     no process. Planned again, the job's params are the same.
//   - With the run among `jobs`, the same `media_mix` plays: its sound is not silent and equals, by hash, a strip that
//     plays the variant l2r3 by its asset hash in the same place.
// The wrong program is the merge base: no foley_plan, no generator source (`bad_media`), no foley.render kind.
import { describe, expect, it } from 'vitest';
import {
  AC, PACK_REF, TIMEOUT, cacheOf, counted, deepJob, done, foleyPlanCall, foleyPlanOf, generator, installFoley, installedOk, isBlocked, jobArgs, mixCall,
  mixOf, obj, openWorld, pcmOf, proof, runShow, scenario, secs, show, useShow, variantsOf, type JsonObject, type SegmentAsk,
} from './helpers.ts';

const bin = useShow();
const JOB = 'foley.paper.tap';
const SPAN = secs(2);

const doc = (src: JsonObject): JsonObject => ({
  transport: { sample_rate: 48_000, span: SPAN }, packs: [PACK_REF],
  strips: { tap: { track: 0, src, start: secs(0.1), in: 0 } },
});
const canonical = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v);
};

describe(`${AC[3]} a generator strip whose job hasn't run is BLOCKED naming it, and a rerun with the same key is a cache hit`, () => {
  it(`${AC[3]} the strip on foley.paper.tap's l2r3 is BLOCKED naming foley.paper.tap until the job runs; the rerun is a hit with the same key and variants and no process; then the strip plays the variant`, async () => {
    const w = await openWorld({ foley: true });
    const asks: SegmentAsk[] = [{ from: 0, to: SPAN, write: true }];
    const gen = doc(generator(JOB, 'l2r3'));
    const [installed, planned, waiting] = runShow(bin(), scenario(w.evidence, [installFoley(), foleyPlanCall(gen), mixCall(gen, asks)], { jobs: [] }), 'the generator strip before its job runs');
    installedOk(installed, 'install_pack of deepbuild/foley');
    const plan = foleyPlanOf(planned, 'foley_plan of the generator strip');
    expect(Object.keys(plan), `foley_plan answers the job ${JOB}`).toContain(JOB);
    const w8 = obj(waiting, 'media_mix before the job runs');
    expect(isBlocked(w8) && !('mix' in w8), `media_mix is BLOCKED, with no mix, while ${JOB} hasn't run; got ${show(w8, 1200)}`).toBe(true);
    expect(JSON.stringify(w8).includes(JOB), `the BLOCKED reply names the job ${JOB}: ${show(w8, 1200)}`).toBe(true);

    const first = await counted(w, () => deepJob(w, jobArgs(plan[JOB]!)));
    const variants = variantsOf(first.outcome, `the first run of ${JOB}`);
    const again = await counted(w, () => deepJob(w, jobArgs(plan[JOB]!)));
    const [, replanned] = runShow(bin(), scenario(w.evidence, [installFoley(), foleyPlanCall(gen)]), 'the generator strip planned again');
    const plan2 = foleyPlanOf(replanned, 'foley_plan again');
    proof('ac3-cache.json', { plan: plan[JOB], first: { started: first.started, reply: first.outcome.value }, again: { started: again.started, reply: again.outcome.value } });
    expect(cacheOf(first.outcome), `the first run is a miss: ${first.outcome.text.slice(0, 600)}`).toBe('miss');
    expect(first.started, 'the first run renders in a process the hub starts').toBeGreaterThanOrEqual(1);
    expect(done(again.outcome) && cacheOf(again.outcome) === 'hit', `the rerun with the same key is a cache hit: ${again.outcome.text.slice(0, 600)}`).toBe(true);
    expect(again.outcome.value.receipt?.key, 'the rerun has the same key').toBe(first.outcome.value.receipt?.key);
    expect(variantsOf(again.outcome, 'the rerun'), 'the rerun answers the same twelve variants').toEqual(variants);
    expect(again.started, 'the cache hit starts no process').toBe(0);
    expect(canonical(plan2[JOB]?.params), 'planned again, the job has the same params, so the same key').toBe(canonical(plan[JOB]!.params));

    const [, played, control] = runShow(bin(), scenario(w.evidence, [installFoley(), mixCall(gen, asks), mixCall(doc({ asset: variants['l2r3']! }), asks)], { jobs: [first.outcome.value] }), 'the generator strip after its job ran');
    const m = mixOf(played, asks, 'the generator strip, its job run');
    const c = mixOf(control, asks, 'the variant l2r3 played by its hash');
    const pcm = pcmOf(w.evidence, m.segments[0]!, 'the generator strip\'s sound');
    let peak = 0;
    for (const ch of pcm.channels) for (const v of ch) peak = Math.max(peak, Math.abs(v));
    expect(peak, 'the generator strip sounds once its job has run').toBeGreaterThan(1e-4);
    expect(m.segments[0]!.sha256, 'the generator strip plays the variant l2r3 its job made, as a strip naming that asset does').toBe(c.segments[0]!.sha256);
  }, 2 * TIMEOUT);
});
