// Criterion 7: "The interface's kind kit holds: each planted twin of the reference library fails the rule its
// criterion names"
//
// Through `deep-logic first_party` and `pack_check` (README: The kind kit). The kit is the interface's `twins`, one
// for each kind rule: a planted library of the interface, a fixture of the pack's it runs, and the rule it must
// raise; criterion 1 names separation.clear for the once-a-second library and criterion 4 separation.exact for the
// solver that leaves the band. A pack's check runs the kit (#202: the kit runs at pack check; #416: an interface
// whose planted library doesn't fail is refused, naming the interface). So:
// - the interface's entry copied into an installed pack `sepcopy` installs, and its kit reads each twin raising the
//   rule it names, and that rule alone;
// - the same entry with the two twins' rules swapped is refused, naming the interface, the twin and the rule it
//   didn't raise: a kit holds only when each twin fails its own rule, not some rule.
// Criteria 1 and 4 run the same two libraries on this suite's own fixtures, beside the reference library.
import { describe, expect, it } from 'vitest';
import { TIMEOUT, arr, isObject, logicBin, obj, onHost, prebuild, refusedOf, show, type JsonObject } from '../190/helpers.ts';
import { AC, CLEAR, EXACT, SEPARATION, separation, twins, type Twin } from './helpers.ts';

prebuild(() => { logicBin(); });

describe(`${AC[7]} the interface's kind kit`, () => {
  it(`${AC[7]} the interface's kind kit holds: each planted twin of the reference library fails the rule its criterion names`, () => {
    const S = separation();
    const kit = twins(S);
    const copy = (version: string, list: Twin[]): JsonObject => ({
      call: 'pack_check', assets: S.assets,
      pack: { name: 'sepcopy', version, origin: 'installed', libs: {}, interfaces: { [SEPARATION]: { ...S.entry, twins: list as unknown as JsonObject[] } } },
    });
    const swapped = kit.map((t) => ({ ...t, expect: t.expect === CLEAR ? EXACT : CLEAR }));
    const [held, broken] = onHost([copy('1.0.0', kit), copy('1.0.1', swapped)]);

    expect([held!['ok'], held!['installed'], held!['pack']], `the interface's pack installs with its kit: ${show(held)}`).toEqual([true, true, 'sepcopy@1.0.0']);
    const judgedKit = arr(held!['interfaces'], 'pack_check.interfaces').map((i) => obj(i, 'an interface')).find((i) => i['label'] === SEPARATION);
    expect(judgedKit, `the pack check judged ${SEPARATION}: ${show(held!['interfaces'])}`).toBeDefined();
    const ran = arr(judgedKit!['kit'], `${SEPARATION}'s kit as the pack check ran it`).map((t, i) => obj(t, `kit[${i}]`));
    expect(ran.map((t) => [t['planted'], t['expect'], t['raised']]).sort(), 'each planted twin raises the rule its criterion names, and that rule alone').toEqual(kit.map((t) => [t.planted, t.expect, [t.expect]]).sort());

    const r = refusedOf(broken!, 'the pack check of the kit with its twins\' rules swapped');
    expect([r.code, r.pack], 'the pack is refused, naming it').toEqual(['pack_refused', 'sepcopy@1.0.1']);
    const named = r.refusals.filter((x) => (x['interface'] === SEPARATION || x['interface'] === `sepcopy.${SEPARATION}`) && typeof x['planted'] === 'string' && typeof x['expect'] === 'string');
    expect(named.length, `a refusal names the interface, a twin and the rule it didn't raise: ${show(r.refusals as never)}`).toBeGreaterThan(0);
    for (const x of named) {
      const twin = swapped.find((t) => t.planted === x['planted']);
      expect([twin?.expect, isObject(x) && Array.isArray(x['raised']) && !(x['raised'] as unknown[]).includes(x['expect'])], `the refusal's twin is one of the kit's, with the rule the swapped kit asks of it, which it didn't raise: ${show(x)}`).toEqual([x['expect'], true]);
    }
  }, TIMEOUT);
});
