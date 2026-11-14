// #1417.b17a643a: "A planted `layout` that declares no cost fails the module's check".
//
// `deep-show` with the test feature `test-graph-layout-no-cost` seals a planted graph@1 implementation, under its own
// name, whose `layout` operator lays out exactly as the reference does but declares no cost (README: Assumed
// surfaces). The kit (#138's `kit` call, the graph module) fails it with a failure naming `graph.layout` outside the
// `bit` part, while its `bit` part, if run, passes (the layout itself is unchanged); the shipped build passes the same
// call, so the failure is the missing cost's.
import { describe, expect, it } from 'vitest';
import { OPERATOR, kitCall, kitFailures, kitModule, obj, show, showRun, str, useEvidence, useShowBuilds } from './helpers.ts';

const ID = '#1417.b17a643a';
const FULL = ['full'];
const PLANT = ['full', 'test-graph-layout-no-cost'];
const build = useShowBuilds([FULL, PLANT]);
const evidence = useEvidence();

describe(`${ID} a planted layout that declares no cost`, () => {
  it(`${ID} fails the graph module's kit, naming ${OPERATOR}, while the shipped graph module passes it`, () => {
    const [schedule, kit] = showRun(build(PLANT), { evidence: evidence(), calls: [{ call: 'schedule' }, kitCall(['graph'])] });
    const iface = obj(obj(schedule!['interfaces'], 'schedule: interfaces')['graph@1'], 'schedule: interfaces["graph@1"]');
    const name = str(obj(iface['implementation'], 'graph@1.implementation')['name'], 'graph@1.implementation.name');
    expect(name, 'the build sealed the planted implementation, not the reference').not.toBe(str(iface['reference'], 'graph@1.reference'));

    const m = kitModule(kit!, 'graph');
    const failures = kitFailures(m);
    expect(m.verdict, `the planted graph module fails its kit: ${show(failures.slice(0, 5), 1500)}`).toBe('FAIL');
    const bit = m.parts.find((p) => p.part === 'bit');
    if (bit) expect(bit.verdict, `the plant lays out as the reference does, so its bit part passes: ${show(bit.failures, 800)}`).toBe('PASS');
    const naming = failures.filter((f) => f.part !== 'bit' && JSON.stringify(f.failure).includes(OPERATOR));
    console.log(`${ID}: the kit's failures on the plant: ${show(failures, 2000)}`);
    expect(naming.length, `a failure names the operator ${OPERATOR}: ${show(failures, 2000)}`).toBeGreaterThan(0);

    const [shipped] = showRun(build(FULL), { evidence: evidence(), calls: [kitCall(['graph'])] });
    const s = kitModule(shipped!, 'graph');
    expect(s.verdict, `the shipped graph module passes the same kit call: ${show(kitFailures(s).slice(0, 5), 1500)}`).toBe('PASS');
  }, 7_200_000);
});
