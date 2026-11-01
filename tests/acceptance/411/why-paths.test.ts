// AC8: on a fixture whose door's drawn angle is 45° because its driver multiplies `items/door/params/open` (0.5) by
// `items/door/params/swing` (90°), the why for the drawn angle names both paths with their values, and changing
// either path changes the value it names; a value from a recipe's default names that recipe and default; and a
// planted why that names only the operator fails, naming the value.
//
// The door is an instance of the test pack's recipe door.leaf@1 (fixtures/packs/door-1.0.0), whose inputs `open`
// and `swing` are its params; the driver `swing` writes its drawn angle, items/door/at/rot/2.
import { describe, expect, it } from 'vitest';
import {
  ANGLE, DOC, DOOR_PACK_ID, DOOR_RECIPE, FULL, OPEN, SWING, arr, brief, door, failsNaming, isObject, near, none, presented, query, run, scenario, show, useBuilds, useEvidence, values, why, whySourceFailures,
} from './helpers.ts';

const builds = useBuilds([FULL]);
const evidence = useEvidence();

const askWhy = { what: 'why', path: ANGLE, t: '0s' };

describe('AC8 the why for the door\'s drawn angle names the document paths it traces to, nearest first, with their values', () => {
  it('AC8 the why for 45° names open (0.5) and swing (90), and changing either path changes the value it names', () => {
    const [s1, angle, w1, s2, w2, s3, w3] = run(builds.bin(FULL), scenario(evidence(), { [DOC.a]: null }, [
      show(DOC.a, door({ open: 0.5, swing: 90 })),
      query(DOC.a, { paths: [ANGLE], at: ['0s'] }),
      query(DOC.a, askWhy),
      show(DOC.a, door({ open: 0.25, swing: 90 })),
      query(DOC.a, askWhy),
      show(DOC.a, door({ open: 0.5, swing: 120 })),
      query(DOC.a, askWhy),
    ]));
    presented(s1!, 'the door at open 0.5, swing 90');
    expect(values(angle!, ANGLE), 'the door is drawn at 45°').toEqual([45]);
    none(whySourceFailures(why(w1!), { path: ANGLE, t: '0s', value: 45, sources: { [OPEN]: 0.5, [SWING]: 90 } }), 'the why for the drawn angle');
    presented(s2!, 'the door at open 0.25');
    none(whySourceFailures(why(w2!), { path: ANGLE, t: '0s', value: 22.5, sources: { [OPEN]: 0.25, [SWING]: 90 } }), 'after open changed');
    presented(s3!, 'the door at swing 120');
    none(whySourceFailures(why(w3!), { path: ANGLE, t: '0s', value: 60, sources: { [OPEN]: 0.5, [SWING]: 120 } }), 'after swing changed');
  });

  it('AC8 a value from the recipe\'s default names that recipe and default, and no document field', () => {
    const [shown, reply] = run(builds.bin(FULL), scenario(evidence(), { [DOC.a]: null }, [
      show(DOC.a, door({ open: 0.5 })),
      query(DOC.a, askWhy),
    ]));
    presented(shown!, 'the door with swing left to its default');
    const w = why(reply!);
    none(whySourceFailures(w, { path: ANGLE, t: '0s', value: 45, sources: { [OPEN]: 0.5 }, notSources: [SWING] }), 'the why with swing from the recipe\'s default');
    const defaults = arr(w['defaults'], `the why's defaults (${brief(w, 1500)})`).filter(isObject);
    const swing = defaults.find((d) => d['input'] === 'swing');
    expect(swing, `the why names the recipe's default for swing (${brief(defaults)})`).toBeDefined();
    expect(swing!['recipe'], 'naming the recipe').toBe(DOOR_RECIPE);
    expect(swing!['pack'], 'and its pack').toBe(DOOR_PACK_ID);
    expect(near(swing!['value'], 90), `and the default, 90 (${brief(swing)})`).toBe(true);
  });

  it('AC8 a planted why that names only the operator fails, naming the value', () => {
    const [shown, reply] = run(builds.bin(FULL), scenario(evidence(), { [DOC.a]: null }, [
      show(DOC.a, door({ open: 0.5, swing: 90 })),
      query(DOC.a, askWhy),
    ], { planted: 'why_names_operator_only' }));
    presented(shown!, 'the door');
    failsNaming(whySourceFailures(why(reply!), { path: ANGLE, t: '0s', value: 45, sources: { [OPEN]: 0.5, [SWING]: 90 } }), [`${ANGLE} = 45`], 'a why that names only the operator');
  });
});
