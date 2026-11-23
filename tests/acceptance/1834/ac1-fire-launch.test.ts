// #1834.9a12b06c: "On a lab fixture, a logic item that fires `launch` at its step 240 launches the ball at the world's
// first step at or after it, and a replay gives the same step hashes; a planted logic module that writes the fire one
// step late fails, naming the step"
//
// The lab fixture (README: The lab fixture) is #522's ball-and-goal lab as a 4 s scene, its ball at rest at the kick
// spot, its world `lab` declaring `kick`, a launch of the ball at (6, 3, 0.4) m/s with `on: {logic: "coach"}`. The
// logic item `coach` steps at 70 Hz and its program marks a fire of `kick` at its step 240 through its fire region
// (`fires: {lab: [kick]}`, `fires_at`). Logic step 240's time is 240/70 s, 411.43 world steps at 120 Hz, so the
// world's first step at or after it is step 412 (not 411, the one before it or the nearest). One deep-show run presents
// the scene, evaluates its ball first at frame 207 (a seek straight past the launch), then at frames 0, 205, 206, 207,
// 208 and 239 in order (played) and at 206 again (a seek back), and answers `physics_bake` for `lab`: its step hashes
// and the entries it keeps. The judge: the bake keeps one launch, from `logic:coach` to `kick`, at step 412, and its
// step hashes equal a `deep-physics` bake of the world with that one launch at step 412 on its track; each failure names
// a step. The replay is `deep-physics`'s bake of the same world with the kept entries as its track (#522's reading:
// derived entries aren't stored, so a replay applies the same ones): the same step hashes, the ball at rest after step
// 412 and launched at 6 m/s after 413, and the scene's ball at each frame f the replay's ball after step 2f.
// The planted twin is the deep-show scenario's `planted: "fire_one_step_late"` (README: The planted twin): the logic
// module writes each fire as if its step had marked it one logic step later, so the launch reaches the world at step
// 414, the first at or after logic step 241; the judge must fail it, naming step 412.
import { describe, expect, it } from 'vitest';
import {
  BALL_PATH, CRITERIA, DOC, FIRES, FIRE_STEP, LATE, LINEAR, REPLAY, STEPS, TIMEOUT, ask, asTrack, bakeCall, bakedOf, coachProgram, evalCall,
  firstDiffering, firstWorldStep, hashesOf, keptText, labScene, launchAt, none, physicsBakeCall, plantedScenario, prebuild, prebuildShows,
  presented, putEvidence, runShow, show, showCall, showWith, statesOf, useTemp, valuesOf, type Baked, type JsonValue,
} from './helpers.ts';

prebuild();
const FULL: string[] = [];
prebuildShows([FULL]);

const ID = CRITERIA[1];
const temp = useTemp();
/** The world's first step at or after the coach's step 240: 412. */
const AT = firstWorldStep(FIRE_STEP);
/** Where the planted module's late fire lands: the first world step at or after logic step 241, 414. */
const LATE_AT = firstWorldStep(FIRE_STEP + 1);
const FROM = 'logic:coach';
const TOL = 0.15;
const POSE_TOL = 1e-6;
/** The frames evaluated, in call order: a seek past the launch, the frames played in order, a seek back. */
const FRAMES = [207, 0, 205, 206, 207, 208, 239, 206];

/**
 * The judge: the bake keeps exactly one launch, from the coach to `kick`, at step AT, and its step hashes equal
 * `reference`'s (a deep-physics bake with that launch at AT). Each failure names a step.
 */
function launchFailures(b: Baked, reference: readonly string[]): string[] {
  const out: string[] = [];
  const launches = b.kept.filter((k) => k.kind === 'launch');
  if (launches.length !== 1) out.push(`step ${AT}: the bake keeps ${launches.length} launches (${keptText(launches)}), want one, at step ${AT}`);
  for (const l of launches) {
    if (l.step !== AT) out.push(`step ${AT}: the launch the coach fires at its step ${FIRE_STEP} is kept at step ${l.step}, not at step ${AT}, the world's first step at or after it`);
    if (l.from !== FROM || l.input !== 'kick' || l.target !== 'ball') out.push(`step ${l.step}: the launch is kept from ${l.from} to ${l.input} of ${l.target}, want from ${FROM} to kick of ball`);
  }
  const k = firstDiffering(b.hashes, reference);
  if (k !== null) out.push(`step ${k - 1}: the state after it, step_hashes[${k}], is ${b.hashes[k] ?? 'missing'}; a bake with the launch at step ${AT} has ${reference[k] ?? 'missing'}`);
  return out;
}

describe(`${ID} a logic item's launch at its step 240 reaches the lab at the world's first step at or after it, replays the same, and a fire written one step late fails naming the step`, () => {
  it(`${ID} the coach's launch at its step ${FIRE_STEP} (70 Hz) launches the ball at world step ${AT}, kept from ${FROM}; played and seeked the scene shows it, and a replay of the kept entries gives the same step hashes`, () => {
    expect([AT, LATE_AT], 'logic step 240 at 70 Hz is world step 411.43 at 120 Hz, so the first at or after it is 412; logic step 241 is 413.14, so 414').toEqual([412, 414]);
    const program = coachProgram();
    const ev = temp();
    putEvidence(ev, program.bytes);
    const doc = DOC(1);
    const r = runShow(showWith(FULL), plantedScenario(ev, [doc], [
      showCall(doc, labScene(program, { fires: FIRES })), ...FRAMES.map((f) => evalCall(doc, f, [BALL_PATH])), physicsBakeCall(doc),
    ]), 'the lab kicked by the coach');
    presented(r[0], 'the lab kicked by the coach');
    const b = bakedOf(r[r.length - 1], 'the lab kicked by the coach');
    const launches = b.kept.filter((k) => k.kind === 'launch');
    expect(launches.map((l) => [l.step, l.target, l.input, l.from, l.data['linear']]), `the bake keeps the coach's launch as a derived entry at world step ${AT}: ${keptText(b.kept)}`)
      .toEqual([[AT, 'ball', 'kick', FROM, LINEAR]]);

    const [replay, reference] = ask([bakeCall(REPLAY, asTrack(b.kept), STEPS), bakeCall(REPLAY, [launchAt(AT, LINEAR)], STEPS)]);
    expect(hashesOf(replay, 'the replay of the kept entries'), 'a replay of the kept entries gives the same step hashes').toEqual(b.hashes);
    none(launchFailures(b, hashesOf(reference, `deep-physics's bake with the launch at step ${AT}`)), 'the judge, on the coach\'s bake');

    const ball = statesOf(replay!, 'ball', STEPS + 1, 'the replay');
    const rest = ball[AT]!;
    expect(Math.hypot(...rest.linear) < 0.05 && Math.abs(rest.pos[0]) < 0.01, `after step ${AT} the ball still rests at the kick spot: ${show(rest as unknown as JsonValue)}`).toBe(true);
    const off = ball[AT + 1]!;
    expect(Math.abs(off.linear[0] - LINEAR[0]) <= TOL && Math.abs(off.pos[0] - rest.pos[0] - LINEAR[0] / 120) <= 0.01, `after step ${AT + 1} it is launched at 6 m/s along x: ${show(off as unknown as JsonValue)}`).toBe(true);

    const fails: string[] = [];
    FRAMES.forEach((f, i) => {
      const pos = valuesOf(r[1 + i], `the scene at frame ${f}`)[BALL_PATH];
      const want = ball[2 * f]!.pos;
      if (!Array.isArray(pos) || pos.length !== 3 || pos.some((x, j) => typeof x !== 'number' || Math.abs(x - want[j]!) > POSE_TOL)) {
        fails.push(`frame ${f} (call ${i + 1}): the scene's ball is at ${show(pos)}, the replay's ball after step ${2 * f} at ${show(want)}`);
      }
    });
    none(fails, 'the scene played and seeked');
  }, TIMEOUT);

  it(`${ID} a planted logic module that writes the fire one step late (${LATE}) fails the judge, naming step ${AT}`, () => {
    const program = coachProgram();
    const ev = temp();
    putEvidence(ev, program.bytes);
    const doc = DOC(2);
    const r = runShow(showWith(FULL), plantedScenario(ev, [doc], [showCall(doc, labScene(program, { fires: FIRES })), physicsBakeCall(doc)], LATE), `the lab kicked by the coach under ${LATE}`);
    presented(r[0], `the lab under ${LATE}`);
    const b = bakedOf(r[1], `the lab under ${LATE}`);
    expect(b.kept.filter((k) => k.kind === 'launch').map((l) => [l.step, l.from]), `the planted module writes the fire one logic step late: the launch reaches the world at step ${LATE_AT}, the first at or after logic step ${FIRE_STEP + 1}: ${keptText(b.kept)}`)
      .toEqual([[LATE_AT, FROM]]);
    const [reference] = ask([bakeCall(REPLAY, [launchAt(AT, LINEAR)], STEPS)]);
    const failures = launchFailures(b, hashesOf(reference, `deep-physics's bake with the launch at step ${AT}`));
    expect(failures.length, 'the judge fails the fire written one step late').toBeGreaterThan(0);
    expect(failures.some((f) => new RegExp(`^step ${AT}\\b`).test(f)), `a failure names step ${AT}: ${show(failures)}`).toBe(true);
  }, TIMEOUT);
});
