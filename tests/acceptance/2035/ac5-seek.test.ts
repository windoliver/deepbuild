// #2035.65049ccc: "Seeking to the first frame after the place, and to the first frame after the wrap, gives the drawn
// poses that playing gives, bit for bit on one build and architecture. A planted restore that forgets the cut blends on
// that frame and fails, naming it"
//
// The first frame after the place is criterion 1's frame 241 (half way from step 120 to step 121); after the wrap,
// criterion 4's frame 401 (half way from step 200 to step 201). Physics: playing is the character's bake at 120/1,
// stored; the seek is `seek` to that frame of the stored bake (README: `frame`), which restores a checkpoint of its
// ring and steps on. Logic: playing is the ship's view played by `play: 1/120` to frame 422; the seek is the same
// view sought back to frame 401, which restores the checkpoint at 201, the state step 200 left. Each must draw what
// playing draws there, bit for bit, and playing must draw no blend across the cut. The wrong programs are
// `deep-physics --planted restore_forgets_place` and `deep-logic --planted restore_forgets_cut`.
import { describe, expect, it } from 'vitest';
import { prebuild, scratch } from '../251/helpers.ts';
import { drawn, logicBin, prebuild as prebuildLogic } from '../545/helpers.ts';
import {
  AC, AFTER_PLACE, AFTER_WRAP, FRAME_RATE, HERO_FROM_X, HERO_NAMED, HERO_OUTPUT, HERO_TO_X, SHIP_POS, STEPS, TIMEOUT, drawnPoses, fmt,
  frameName, heroBake, heroTrack, heroWorld, namedBy, physics, playShip, poseOf, poseText, samePose, shipProgram, shipX,
  type JsonObject, type JsonValue,
} from './helpers.ts';

prebuild();
prebuildLogic(() => { logicBin(); shipProgram(); });

const ID = AC[5];

/** The character's bake, stored, then a seek of it to frame 241, in one `deep-physics`; criterion 5's judgement. */
function physicsFailures(twin?: 'restore_forgets_place'): string[] {
  const store = scratch('2035-seek');
  const seek: JsonObject = { call: 'seek', world: heroWorld(), track: heroTrack(), steps: STEPS, store, frame_rate: FRAME_RATE, frame: AFTER_PLACE, read: [] };
  const [bake, sought] = physics([heroBake({ store }), seek], twin, 'the character placed at step 120, baked and sought');
  const played = drawnPoses(bake!, HERO_OUTPUT, 'the character played (its bake)')[AFTER_PLACE]!;
  const out: string[] = [];
  const x = played.pos[0];
  if (Math.abs(x - HERO_FROM_X) > 1e-6 && Math.abs(x - HERO_TO_X) > 1e-6) out.push(`${HERO_NAMED} at ${frameName(AFTER_PLACE)}: playing draws x = ${fmt(x)} m, a blend across the place`);
  if (sought?.['ok'] !== true) return [...out, `the seek to ${frameName(AFTER_PLACE)} doesn't answer: ${JSON.stringify(sought).slice(0, 800)}`];
  const from = sought['from'];
  if (typeof from !== 'number' || from <= 0) out.push(`the seek to ${frameName(AFTER_PLACE)} restored no checkpoint of the ring (from: ${JSON.stringify(from)})`);
  const outputs = sought['outputs'];
  const got = outputs && typeof outputs === 'object' && !Array.isArray(outputs) ? (outputs as JsonObject)[HERO_OUTPUT] : undefined;
  if (got === undefined) return [...out, `the seek to ${frameName(AFTER_PLACE)} draws no ${HERO_OUTPUT} (outputs: ${JSON.stringify(outputs)})`];
  const p = poseOf(got, `the seek's outputs.${HERO_OUTPUT}`);
  if (!samePose(p, played)) out.push(`${HERO_NAMED} at ${frameName(AFTER_PLACE)}: the seek draws ${poseText(p)} where playing draws ${poseText(played)}`);
  return out;
}

/** Two drawn values the same bit for bit: the same shape, and every number the same f64 (Object.is). */
function sameBits(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => sameBits(x, b[i]));
  return typeof a === 'number' && typeof b === 'number' ? Object.is(a, b) : JSON.stringify(a) === JSON.stringify(b);
}

/** The ship played to frame 422 and sought back to frame 401; criterion 5's judgement. */
async function logicFailures(twin: 'restore_forgets_cut' | null): Promise<string[]> {
  const { frames, sought } = await playShip(twin, AFTER_WRAP);
  const played = frames.get(AFTER_WRAP)!;
  const out: string[] = [];
  const x = shipX(played, `played ${frameName(AFTER_WRAP)}`);
  if (x > 1 && x < 19) out.push(`${SHIP_POS} at ${frameName(AFTER_WRAP)}: playing draws x = ${fmt(x)} m, a blend across the wrap`);
  const [a, b] = [drawn(played, SHIP_POS, 'the played frame'), drawn(sought!, SHIP_POS, 'the sought frame')];
  if (!sameBits(a, b)) {
    out.push(`${SHIP_POS} at ${frameName(AFTER_WRAP)}: the seek draws x = ${fmt(shipX(sought!, 'the sought frame'))} m (${JSON.stringify(b)}) where playing draws x = ${fmt(x)} m (${JSON.stringify(a)})`);
  }
  return out;
}

describe(`${ID} a seek to the first frame after a cut draws what playing draws`, () => {
  it(`${ID} seeking to the first frame after the place gives the drawn pose that playing gives, bit for bit`, () => {
    const failures = physicsFailures();
    expect(failures, `the character at frame ${AFTER_PLACE}, played and sought:\n  ${failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  it(`${ID} seeking to the first frame after the wrap gives the drawn pose that playing gives, bit for bit`, async () => {
    const failures = await logicFailures(null);
    expect(failures, `the ship at frame ${AFTER_WRAP}, played and sought:\n  ${failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  it(`${ID} (twin: restore_forgets_place) a planted restore that forgets the place's cut blends on that frame and fails, naming it`, () => {
    namedBy(physicsFailures('restore_forgets_place'), new RegExp(`\\bframe ${AFTER_PLACE}\\b.*: the seek draws`), 'restore_forgets_place');
  }, TIMEOUT);

  it(`${ID} (twin: restore_forgets_cut) a planted restore that forgets the cut blends on that frame and fails, naming it`, async () => {
    namedBy(await logicFailures('restore_forgets_cut'), new RegExp(`\\bframe ${AFTER_WRAP}\\b.*: the seek draws`), 'restore_forgets_cut');
  }, TIMEOUT);
});
