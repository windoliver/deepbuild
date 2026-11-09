// Blind redraft of module.test.ts's second AC2 test (REDRAFT-test-dial.md). It replaces that test; nothing else in
// module.test.ts changes.
//
// AC2 #308: "control@1 seals with its first nine entries, slider, toggle, choice, stages, transport, drag_along,
// turn, press and hover, each passing the kit; a planted test kind whose entry is computed again from the camera at
// replay fails the kit's replay part at the seal, naming the kind; one with no keyboard path is refused, naming it;
// one whose entry an agent's input writes is refused, naming it; and a pack that declares an entry of control@1 is
// refused at pack check, naming the registry and who may fill it"
//
// The test kind `test.dial` is an entry the input module itself fills into control@1 in a build with feature
// `test-control-kind`: control@1 is declared by the input module, and the seal refuses a canvas module's entry in a
// registry another canvas module declares (canvas-primitives.md, Registry and seal: registries).
import { describe, expect, it } from 'vitest';
import { REGISTRIES, listedRegistry, none, refusalFailures, run, scenario, sealFailures, startup, useBuilds, useEvidence, type Build } from '../helpers.ts';

const TEST_KIND: Build = { set: 'full', with: ['test-control-kind'] };
const builds = useBuilds([TEST_KIND]);
const evidence = useEvidence();

describe('AC2 #308 control@1 seals with its first nine entries; kinds come only from canvas modules and pass the kit', () => {
  it('AC2 a planted test kind computed again from the camera at replay fails the replay part at the seal, naming the kind; one with no keyboard path is refused, naming it; one an agent\'s input writes is refused, naming it; the same kind unplanted seals (redraft)', () => {
    const bin = builds.bin(TEST_KIND);
    none(sealFailures(startup(bin), 'the test kind test.dial'), 'the control kind test.dial, unplanted');
    const [reply] = run(bin, scenario(evidence(), [REGISTRIES]));
    const dial = listedRegistry(reply!, 'control@1').entries.find((e) => e.name === 'test.dial');
    expect([dial?.module, dial?.kit.verdict], 'test.dial is filled by the input module, which declares control@1, and passes the kit').toEqual(['input', 'PASS']);
    for (const [planted, part] of [['control_kind_recompute', 'replay'], ['control_kind_no_keyboard', 'keyboard'], ['control_kind_agent_input', 'input']] as const) {
      none(refusalFailures(startup(bin, planted), { reasons: ['entry_refused'], registry: 'control@1', entries: ['test.dial'], rules: [part] }), `the kind test.dial planted as ${planted}`);
    }
  }, 1_800_000);
});
