// AC3 #200.31886771: "A pack entry named dot, without its pack's name, is refused at pack check, naming the
// first-party entry it would take; and an entry the working agent wrote in its own pack, in a registry that binds
// author, is the only cover of a requirement that then stays INCONCLUSIVE with an approval ask, never PASS"
//
// asserts: in the `core,test-mark` build, test/barepack@1.0.0's entry dot is refused at pack check, its error naming
// dot and test.mark@1, while test/testpack@1.0.0 (testpack.ring) installs in the same run. In
// `core,test-mark-binds-author` (test.mark@1 with `binds: author`), alpha/agentpack@1.0.0, installed through the
// working agent's session, lists agentpack.tiny with origin agent; alpha's claim whose one requirement
// (`test.mark.fits` on agentpack.tiny) only that entry covers is INCONCLUSIVE, the requirement INCONCLUSIVE, and the
// verdict carries an approval ask naming the requirement. The same claim in `core,test-mark` (binds all) is PASS:
// the check itself passes, so INCONCLUSIVE comes from the binding alone (the wrong program: an author entry that
// binds like any other gives PASS).

import { describe, expect, it } from 'vitest';
import {
  AGENTPACK, ALPHA, BAREPACK, DOC, MARK, PACKS, TESTPACK, arr, board, installPack, isObject, listing, mentions, none, obj, packAt, packRefusedFailures,
  packRow, rect, registries, run, scenario, show, str, theEntry, theRegistry, useBuilds, useEvidence, type Build, type JsonObject,
} from './helpers.ts';

const MARKS: Build = { set: 'core', with: ['test-mark'] };
const AUTHOR: Build = { set: 'core', with: ['test-mark-binds-author'] };
const builds = useBuilds([MARKS, AUTHOR]);
const evidence = useEvidence();

const CLAIM = 'claim-alpha';
const REQ = 'req-fits';
const claims: JsonObject = {
  [CLAIM]: { session: ALPHA.id, deliverables: [DOC.a], requirements: [{ id: REQ, check: { kind: 'test.mark.fits', entry: 'agentpack.tiny' } }] },
};
/** The working agent's own board, naming its own pack. */
const agentBoard = board('The agent\'s marks', [packAt(AGENTPACK)], [rect('frame', 'Frame', [0, 0, 640, 360], 'a0')]);
const agentShow: JsonObject = { call: 'deep_show', session: ALPHA.id, doc: DOC.a, document: agentBoard, include: ['issues'] };

/** The agent's claim judged once, after the agent installs its pack and shows its board. */
function judged(bin: string): { install: JsonObject; shown: JsonObject; listed: ReturnType<typeof registries>; verdict: JsonObject } {
  const [install, shown, listed, verdict] = run(bin, scenario(evidence(), [installPack(AGENTPACK, ALPHA.id), agentShow, { call: 'registries' }, { call: 'verdict', claim: CLAIM }], { claims }));
  return { install: install!, shown: shown!, listed: registries(listed!), verdict: verdict! };
}
const requirement = (verdict: JsonObject): JsonObject => {
  const row = arr(verdict['requirements'], 'verdict: requirements').map((r, i) => obj(r, `verdict: requirements[${i}]`)).find((r) => r['id'] === REQ);
  expect(row, `the verdict lists the requirement ${REQ}: ${show(verdict)}`).toBeDefined();
  return row!;
};

describe('AC3 #200.31886771 a pack never takes a first-party name, and an entry the working agent wrote under binds author never makes a PASS alone', () => {
  it('AC3 a pack entry named dot, without its pack\'s name, is refused at pack check, naming the first-party entry dot it would take', () => {
    const [packs] = run(builds.bin(MARKS), scenario(evidence(), [PACKS], { packs: [TESTPACK, BAREPACK] }));
    expect(packRow(packs!, TESTPACK).state, 'the control: a pack entry named with its pack\'s name installs').toBe('installed');
    none(packRefusedFailures(packRow(packs!, BAREPACK), BAREPACK, ['dot', MARK]), 'the pack check of an entry named dot');
  });

  it('AC3 the working agent\'s own entry, in a registry that binds author, is the only cover of a requirement, which stays INCONCLUSIVE with an approval ask, never PASS', () => {
    const { install, shown, listed, verdict } = judged(builds.bin(AUTHOR));
    expect(str(install['outcome'], 'install_pack: outcome'), `the agent's pack installs: ${show(install)}`).toBe('installed');
    expect(shown['outcome'], `the agent's board is presented: ${show(shown)}`).toBe('presented');
    const mark = theRegistry(listed, MARK);
    expect(mark.binds, 'test.mark@1 binds author in this build').toBe('author');
    expect(theEntry(mark, 'agentpack.tiny').origin, 'the entry the working agent wrote is listed with origin agent').toBe('agent');
    const req = requirement(verdict);
    expect(req['result'], `the requirement only the agent's own entry covers is INCONCLUSIVE: ${show(req)}`).toBe('INCONCLUSIVE');
    expect(verdict['result'], 'and so is the claim, never PASS').toBe('INCONCLUSIVE');
    const asks = arr(verdict['asks'] ?? [], 'verdict: asks').filter((a) => isObject(a) && a['kind'] === 'approval' && mentions(a, REQ));
    expect(asks.length, `the verdict asks for your approval of the requirement: ${show(verdict['asks'])}`).toBeGreaterThan(0);
  });

  it('AC3 the control: the same claim in a registry that binds all passes, so the INCONCLUSIVE comes from the author binding alone', () => {
    const { install, verdict } = judged(builds.bin(MARKS));
    expect(str(install['outcome'], 'install_pack: outcome'), `the agent's pack installs: ${show(install)}`).toBe('installed');
    expect(theRegistry(listing(builds.bin(MARKS), evidence()), MARK).binds, 'test.mark@1 binds all in the test-mark build').toBe('all');
    expect(requirement(verdict)['result'], 'the requirement passes on the same entry').toBe('PASS');
  });
});
