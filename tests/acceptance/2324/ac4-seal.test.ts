// #2324 AC4: With the kit's hashes equal on the three hosts, the seal's runtime digest equals the merge base's, and a
// save made on the old engine opens and plays on to the same full-state hash. A planted engine build whose kit result
// differs on one fixture moves the digest and fails this check, naming the fixture.
//
// The digest is deep-show `full`'s `schedule.runtime_digest` beside its kit (part sandbox), judged by `sealFailures`
// against fixtures/base-seal.json and base-kit.json (AC2 runs the kit on the other two hosts). The save is the golden
// the merge base recorded (fixtures/base-golden.json; README: Surface choices). The planted engine build is deep-show
// `full,plant-engine-differs`, whose engine gives another result for `pass.subset` alone.
import { describe, expect, it } from 'vitest';
import {
  AC, BASE_GOLDEN, BASE_SEAL, KIT_CALL, L, PLANT, PLANTED_FIXTURE, S, TIMEOUT, appKit, deepShow, differing, goldenCall, kitDiffs, none,
  sealFailures, verifyCall,
} from './helpers.ts';

S.prebuild(() => { deepShow(['full']); L.logicBin(); });
const temp = S.useTemp();

describe(`${AC[4]} the runtime digest stays the merge base's while the kit gives #238's hashes, and a save from the old engine plays on`, () => {
  it(`${AC[4]} with every kit case as #238 recorded it, the seal's runtime digest is the merge base's, and the golden recorded on the old engine opens and plays on to the same full-state hashes`, () => {
    const [schedule, kitReply] = S.runShow(deepShow(['full']), S.scenario(temp(), [S.SCHEDULE, KIT_CALL]));
    const digest = S.str(schedule!['runtime_digest'], 'schedule: runtime_digest');
    none(sealFailures('the app on macOS arm64', appKit(kitReply!, 'the app\'s kit'), digest), 'the kit gives #238\'s hashes and the runtime digest is the merge base\'s');
    expect(digest, 'the seal\'s runtime digest is the merge base\'s').toBe(BASE_SEAL().full);

    const old = BASE_GOLDEN().golden;
    const [made, verified] = L.onMac([goldenCall(), verifyCall()]);
    expect(made!['ok'], `the golden of the same bake is recorded on this engine: ${S.show(made)}`).toBe(true);
    const now = S.obj(made!['golden'], 'golden');
    expect(now['runtime_digest'], 'the save\'s runtime digest is the one the logic module\'s seal gives on this engine, so it opens as it is').toBe(old['runtime_digest']);
    expect(now['checkpoint_hashes'], 'replayed on this engine, the save reaches every full-state hash it holds').toEqual(old['checkpoint_hashes']);
    expect(now['step_hashes'], 'and every step hash').toEqual(old['step_hashes']);
    expect(verified!['ok'], `golden_verify reads the old engine's golden back: ${S.show(verified)}`).toBe(true);
    expect([verified!['first_step'] ?? null, verified!['report'] ?? null], 'played on from the old engine\'s golden, no step differs').toEqual([null, null]);
  }, TIMEOUT);

  it(`${AC[4]} a planted engine build whose kit differs from #238's on ${PLANTED_FIXTURE} moves the runtime digest and fails this check, naming the fixture`, () => {
    const [schedule, kitReply] = S.runShow(deepShow(['full', PLANT]), S.scenario(temp(), [S.SCHEDULE, KIT_CALL]));
    const kit = appKit(kitReply!, 'the planted build\'s kit');
    expect(differing(kitDiffs('the planted build', kit)), `the planted engine build's kit differs from #238's on ${PLANTED_FIXTURE} alone`).toEqual([PLANTED_FIXTURE]);
    const digest = S.str(schedule!['runtime_digest'], 'schedule: runtime_digest');
    expect(digest, 'the planted engine build moves the runtime digest').not.toBe(BASE_SEAL().full);
    const failures = sealFailures('the planted build', kit, digest);
    expect(failures.some((f) => f.startsWith(`${PLANTED_FIXTURE} `)), `this check fails on the planted build, naming ${PLANTED_FIXTURE}: ${failures.join('; ')}`).toBe(true);
  }, TIMEOUT);
});
