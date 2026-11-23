// #1834.0e85ef5d: "A logic item that fires an input its `fires` doesn't declare is refused at check, naming the item
// and the input"
//
// The lab fixture's world `lab` declares `kick`, a launch with `on: {logic: "coach"}`: the coach fires kick, since a
// world input with `on: {logic: ID}` takes each entry that item fires (Input track entries). In one deep-show run, the
// agent's `deep_show` of three scenes that differ only in the coach's `fires` and the world's inputs:
// - the lab fixture of criterion 1, `fires: {lab: [kick]}`, is presented with no error issue;
// - the coach declaring another input it fires, `fires: {lab: [lift]}`, where `lift` is a poke of the ball the world
//   also takes `on: {logic: "coach"}`, and not kick: refused at check, with an error issue naming coach and kick;
// - the coach declaring no `fires` at all: refused at check, with an error issue naming coach and kick.
// "Naming" is #522's: the item's and the input's IDs as whole words in the issue's fields (`ids`, `path`, `actual`,
// `what`, …), not a code this suite chooses.
import { describe, expect, it } from 'vitest';
import {
  COACH, CRITERIA, DOC, FIRES, KICK, TIMEOUT, WORLD, coachProgram, issuesIn, labScene, names, obj, prebuildShows, presented, putEvidence,
  runShow, plantedScenario, show, showCall, showWith, useTemp, type JsonObject,
} from './helpers.ts';

const FULL: string[] = [];
prebuildShows([FULL]);

const ID = CRITERIA[2];
const temp = useTemp();
const LIFT: JsonObject = { lift: { kind: 'poke', targets: ['ball'], on: { logic: COACH }, push: [0, 2, 0] } };

describe(`${ID} a logic item that fires an input its fires doesn't declare is refused at check, naming the item and the input`, () => {
  it(`${ID} the coach fires kick with fires naming lift, or with no fires, and each is refused at check naming coach and kick; with fires naming kick it is presented`, () => {
    const program = coachProgram();
    const ev = temp();
    putEvidence(ev, program.bytes);
    const [declared, another, bareDoc] = [DOC(11), DOC(12), DOC(13)];
    const [shown, other, bare] = runShow(showWith(FULL), plantedScenario(ev, [declared, another, bareDoc], [
      showCall(declared, labScene(program, { fires: FIRES })),
      showCall(another, labScene(program, { fires: { [WORLD]: ['lift'] }, inputs: { ...KICK, ...LIFT } })),
      showCall(bareDoc, labScene(program)),
    ]), 'the three labs');
    presented(shown, 'the lab whose coach declares kick in its fires');
    expect(issuesIn(shown, 'the lab whose coach declares kick').filter((i) => i['severity'] === 'error').map((i) => obj(i, 'issue')), 'with no error issue').toEqual([]);

    for (const [reply, what] of [[other, 'the coach whose fires names lift and not kick'], [bare, 'the coach with no fires']] as const) {
      expect(reply?.['outcome'], `${what} is refused at check: ${show(reply)}`).toBe('refused');
      const errors = issuesIn(reply, what).filter((i) => i['severity'] === 'error');
      const naming = errors.filter((i) => names(i, COACH) && names(i, 'kick'));
      expect(naming.length, `${what}: an error issue names the item (coach) and the input (kick): ${show(errors)}`).toBeGreaterThan(0);
    }
  }, TIMEOUT);
});
