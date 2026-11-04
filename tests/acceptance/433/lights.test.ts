// AC4: "Lights written through the pack expand to our lumens: a point light of 1 cd or power 4π lm, and a spot of
// 1 cd or power π lm, each become power 4π lm (12.566 lm); a spot of power 800 becomes 3,200 lm, 63.7 lx on its axis
// at 2 m, and a planted pack that copies the spot's 800 (15.9 lx at 2 m) fails, naming the light. A word or value the
// pack doesn't map, such as a point light's decay of 1, is refused with a notice naming it and is never drawn with
// another falloff"
//
// Five familiar lights in the library's words (`intensity` in candela or `power` in lumens, src/lights/PointLight.js
// and SpotLight.js at the pin: a point's power is 4π × intensity, a spot's π × intensity) expand to light.point@1 and
// light.spot@1, whose `power` counts the whole sphere (canvas primitives: Light). Each expanded power must be the
// criterion's within 1e-9 relative; the lux on the axis at 2 m is that power ÷ 4π ÷ 2². The planted
// familiar_copies_spot_power must fail, naming `spot800`. A point light with `decay: 1` (the library's default is 2,
// the inverse square) is presented alone and must be refused at `items/decay1/params/decay`, with nothing drawn.

import { describe, expect, it } from 'vitest';
import { AC, DOC, PACKS, SLOW, admitted, failsNaming, none, num, oneOfKind, paramOf, refusalProblems, runShow, scenario, sceneDoc, show, useDir, useShow, type JsonObject, type ShowPlanted } from './helpers.ts';
import { axisLux, fmt } from './reference.ts';

const bin = useShow();
const dir = useDir();

const FOUR_PI = 4 * Math.PI;
/** Each light, its words, the kind it expands to and the power it must have. */
const LIGHTS: { id: string; item: JsonObject; kind: string; power: number }[] = [
  { id: 'point1cd', item: { kind: 'familiar.point_light@1', params: { intensity: 1 } }, kind: 'light.point@1', power: FOUR_PI },
  { id: 'point4pi', item: { kind: 'familiar.point_light@1', params: { power: FOUR_PI } }, kind: 'light.point@1', power: FOUR_PI },
  { id: 'spot1cd', item: { kind: 'familiar.spot_light@1', params: { intensity: 1 } }, kind: 'light.spot@1', power: FOUR_PI },
  { id: 'spotpi', item: { kind: 'familiar.spot_light@1', params: { power: Math.PI } }, kind: 'light.spot@1', power: FOUR_PI },
  { id: 'spot800', item: { kind: 'familiar.spot_light@1', params: { power: 800 } }, kind: 'light.spot@1', power: 3200 },
];

/** The point light with a decay the pack doesn't map, in a document of its own. */
const DECAY = sceneDoc('A point light with decay 1', { decay1: { kind: 'familiar.point_light@1', params: { intensity: 1, decay: 1 } } }, [PACKS.familiar]);

interface Read { problems: string[]; lux: Map<string, number>; decay: JsonObject }
function read(planted?: ShowPlanted): Read {
  const items: Record<string, JsonObject> = {};
  for (const l of LIGHTS) items[l.id] = l.item;
  const [reply, decay] = runShow(bin(), scenario(dir(), [DOC.a, DOC.b], [show(DOC.a, sceneDoc('Familiar lights', items, [PACKS.familiar])), show(DOC.b, DECAY)], [PACKS.familiar], planted));
  admitted(reply!, 'the familiar lights');
  const problems: string[] = [];
  const lux = new Map<string, number>();
  for (const l of LIGHTS) {
    const { found, problem } = oneOfKind(reply!, l.id, l.kind);
    if (!found) { problems.push(problem!); continue; }
    const power = num(paramOf(found, 'power'), `${found.id}.params.power`);
    lux.set(l.id, axisLux(power, 2));
    if (!(Math.abs(power - l.power) <= 1e-9 * l.power)) {
      problems.push(`${l.id}: power ${fmt(power, 9)} lm, not ${fmt(l.power, 9)} lm (${fmt(axisLux(power, 2), 3)} lx on its axis at 2 m, not ${fmt(axisLux(l.power, 2), 3)})`);
    }
  }
  return { problems, lux, decay: decay! };
}

describe(`${AC[4]} familiar lights expand to our lumens`, () => {
  it(`${AC[4]} point 1 cd and 4π lm and spot 1 cd and π lm become 4π lm, a spot of 800 becomes 3,200 lm and 63.7 lx at 2 m, and a point light's decay of 1 is refused, naming it, and not drawn`, () => {
    const r = read();
    none(r.problems, 'the familiar lights\' power');
    expect(fmt(FOUR_PI, 5), '4π lm').toBe('12.566');
    expect(fmt(r.lux.get('spot800') ?? NaN, 3), 'spot800 on its axis at 2 m').toBe('63.7');
    none(refusalProblems(r.decay, 'decay1', 'decay'), 'a point light with decay 1');
  }, SLOW);

  it(`${AC[4]} the planted familiar_copies_spot_power copies the spot's 800 (15.9 lx at 2 m) and fails, naming spot800`, () => {
    const r = read('familiar_copies_spot_power');
    failsNaming(r.problems, ['spot800'], 'the planted familiar_copies_spot_power');
    expect(fmt(r.lux.get('spot800') ?? NaN, 3), 'the copied spot on its axis at 2 m').toBe('15.9');
  }, SLOW);
});
