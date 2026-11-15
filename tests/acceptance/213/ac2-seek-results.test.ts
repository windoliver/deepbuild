// AC2 #213.1361c0e3: "A seek to step 31 gives the same result region and deep hash as play; and a planted module that
// writes results after step 30's checkpoint is taken fails logic.determinism, naming step 31 and the region"
//
// Through `deep-show run`'s `logic` call with this suite's `seeks`, `regions` and `at_times` (README): the static range
// and its shooter (criterion 1's), with a checkpoint every step, so step 30's checkpoint (the state before step 31) is
// the one a seek to 31 restores. Play's region is the services region as step 31 read it; the seek's the same; the deep
// hash is the first checkpoint after the seek's (32). logic.determinism samples 0.54 s, step 32, so its seek from the
// checkpoint at 31 runs step 31 again.

import { describe, expect, it } from 'vitest';
import {
  CRITERIA, DOC, TIMEOUT, arr, binOf, handleOf, int, isObject, logicCall, obj, perItem, presented, resultsOf, runShow, scenario, show,
  showCall, showSteps, str, useBuilds, useTemp, type JsonObject, type JsonValue,
} from './helpers.ts';
import { RANGE, castParams, probeHandles, rangeScene } from './fixtures.ts';
import { SHOOTER_WRITES, shooter } from './programs.ts';

const ID = CRITERIA[2];
useBuilds(['show']);
const temp = useTemp();

const STEPS = 40;
const SEEK = 31;
const AT_TIMES = [0.54];

/** The range with the shooter, a checkpoint every step; `calls` builds the logic call. */
function run(bin: string, evidence: string, call: (doc: string) => JsonObject, planted: boolean, what: string): { reply: JsonObject; wall: number } {
  const h = probeHandles(bin, evidence, (logic) => rangeScene(evidence, logic), what);
  const doc = DOC(21);
  const params = castParams(1, { writes: SHOOTER_WRITES as unknown as JsonObject, checkpoint: { every: 1 } });
  const scene = rangeScene(evidence, { shooter: { program: shooter(handleOf(h, RANGE, null, what)), params } });
  const [shown, reply] = runShow(bin, scenario(evidence, [doc], [showCall(doc, scene), call(doc)], planted ? { planted: 'results_after_checkpoint' } : {}), what);
  presented(shown, what);
  return { reply: reply!, wall: handleOf(h, RANGE, 'wall', what) };
}
const servicesOf = (v: JsonValue | undefined, what: string): string => str(obj(v, what)['services'], `${what}.services`);

describe(`${ID} the result region is memory a checkpoint holds, so a seek reads the results play read`, () => {
  it(`${ID} a seek to step 31 restores the checkpoint after step 30 and reads play's result region (one hit at 10 m), and reaches play's deep hash at checkpoint 32; logic.determinism passes`, () => {
    const what = 'the range with a seek to 31';
    const { reply, wall } = run(binOf('show'), temp(), (doc) => logicCall(doc, STEPS, { seeks: [SEEK], regions: true, check: true, atTimes: AT_TIMES }), false, what);
    const steps = showSteps(reply, STEPS, what);
    const played = servicesOf(perItem(steps[SEEK]!, 'regions', 'shooter', what), `${what}: step 31's regions.shooter`);
    const results = resultsOf(played, 1, `${what}: step 31's services region`);
    expect(results.count, 'the result region step 31 reads holds one answer').toBe(1);
    expect(results.answers[0]!.hits.map((x) => x.id), 'one hit, on the wall').toEqual([wall]);
    expect(Math.abs(results.answers[0]!.hits[0]!.distance - 10), 'at 10.000 m within 1 mm').toBeLessThanOrEqual(0.001);

    const seeks = arr(reply['seeks'], `${what}: seeks`);
    expect(seeks.length, `${what}: one seek answered`).toBe(1);
    const s = obj(seeks[0], `${what}: seeks[0]`);
    expect([s['to'], s['from']], 'the seek to 31 restores the checkpoint taken after step 30, before step 31').toEqual([SEEK, SEEK]);
    const sought = servicesOf(obj(s['regions'], `${what}: seeks[0].regions`)['shooter'], `${what}: seeks[0].regions.shooter`);
    expect(sought, 'the seek\'s step 31 reads the result region play\'s step 31 read, byte for byte').toBe(played);
    const hashes = obj(s['hashes'], `${what}: seeks[0].hashes`);
    expect(arr(hashes['shooter'], `${what}: seeks[0].hashes.shooter`)[0], 'the seek\'s step 31 has play\'s step hash').toBe(perItem(steps[SEEK]!, 'hash', 'shooter', what));
    const cp = obj(s['checkpoint'], `${what}: seeks[0].checkpoint`);
    expect(int(cp['step'], `${what}: seeks[0].checkpoint.step`), 'the first checkpoint after the seek is the one before step 32').toBe(SEEK + 1);
    const played32 = arr(obj(reply['checkpoints'], `${what}: checkpoints`)['shooter'], `${what}: checkpoints.shooter`)
      .map((c, i) => obj(c, `${what}: checkpoints.shooter[${i}]`)).find((c) => c['step'] === SEEK + 1);
    expect(played32, `${what}: play kept a checkpoint at 32`).toBeDefined();
    expect(obj(cp['deep_hash'], `${what}: seeks[0].checkpoint.deep_hash`)['shooter'], 'the seek reaches play\'s deep hash at checkpoint 32').toBe(played32!['deep_hash']);

    const check = obj(reply['check'], `${what}: check`);
    expect([check['verdict'], check['failures']], `logic.determinism at 0.54 s passes the real module: ${show(check)}`).toEqual(['PASS', []]);
  }, TIMEOUT);

  it(`${ID} (planted results_after_checkpoint) a module that writes results after step 30's checkpoint is taken fails logic.determinism, naming step 31 and the services region`, () => {
    const what = 'the range, planted';
    const { reply } = run(binOf('show'), temp(), (doc) => logicCall(doc, STEPS, { check: true, atTimes: AT_TIMES }), true, what);
    const check = obj(reply['check'], `${what}: check`);
    expect(check['verdict'], `logic.determinism fails the planted module: ${show(check)}`).toBe('FAIL');
    const failures = arr(check['failures'], `${what}: check.failures`).filter(isObject);
    const named = failures.find((f) => f['step'] === SEEK && f['region'] === 'services' && (f['item'] === undefined || f['item'] === 'shooter'));
    expect(named, `a failure names step 31 and the region "services": ${show(failures as JsonValue)}`).toBeDefined();
  }, TIMEOUT);
});
