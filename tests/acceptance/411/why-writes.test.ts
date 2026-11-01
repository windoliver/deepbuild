// AC9: on a fixture where a channel key sets the door's angle to 80° at 1 s and a limit constraint holds it at 45°,
// the why at 1 s lists the key's write marked clamped_by the constraint and the constraint's write marked stands; a
// planted why that names only the key fails, naming the value.
//
// Each write names the document entry that made it (README: why): the key as `channels/angle/keys/k1`, the
// constraint as `constraints/stop`.
import { describe, expect, it } from 'vitest';
import { ANGLE, DOC, FULL, failsNaming, none, presented, query, run, scenario, show, stoppedDoor, useBuilds, useEvidence, values, why, whyWriteFailures } from './helpers.ts';

const builds = useBuilds([FULL]);
const evidence = useEvidence();

const EXPECTED = { path: ANGLE, t: '1s', value: 45, key: 'channels/angle/keys/k1', keyValue: 80, constraint: 'constraints/stop' };
const askWhy = { what: 'why', path: ANGLE, t: '1s' };

describe('AC9 the why lists every write to the value in evaluation order, marked stands, overwritten_by or clamped_by', () => {
  it('AC9 at 1 s the key\'s write of 80° is clamped_by the limit constraint, whose write of 45° stands', () => {
    const [shown, angle, reply] = run(builds.bin(FULL), scenario(evidence(), { [DOC.a]: null }, [
      show(DOC.a, stoppedDoor()),
      query(DOC.a, { paths: [ANGLE], at: ['1s'] }),
      query(DOC.a, askWhy),
    ]));
    presented(shown!, 'the stopped door');
    expect(values(angle!, ANGLE), 'the door is drawn at 45° at 1 s').toEqual([45]);
    none(whyWriteFailures(why(reply!), EXPECTED), 'the why at 1 s');
  });

  it('AC9 a planted why that names only the key fails, naming the value', () => {
    const [shown, reply] = run(builds.bin(FULL), scenario(evidence(), { [DOC.a]: null }, [
      show(DOC.a, stoppedDoor()),
      query(DOC.a, askWhy),
    ], { planted: 'why_names_key_only' }));
    presented(shown!, 'the stopped door');
    failsNaming(whyWriteFailures(why(reply!), EXPECTED), [`${ANGLE} = 45`], 'a why that names only the key');
  });
});
