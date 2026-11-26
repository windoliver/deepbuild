// #3035.e8200294: "A two-link arm, each link 0.5 m, with revolute joints limited to ±1.5708 rad converts to two hinges
// limited to ±90.000° within 0.001°. With both joints at 30° the tip is at (0.683, 0.683) m from the base in the arm's
// plane within 1e-6 m, read from evaluated data. A planted conversion that flips one joint's axis puts the tip
// elsewhere and fails, naming the joint"
//
// The fixture (README: The fixtures and their numbers) is fixtures/arm.urdf: `base`, `upper` on the revolute `shoulder`,
// `fore` on the revolute `elbow` 0.5 m along, and `tip` on the fixed `flange` 0.5 m further, along the file's +X, both
// joints about the file's −Y, so a positive angle lifts the arm toward the file's +Z. The arm's plane is the file's
// X-Z plane: with both joints at 30° the tip is 0.5 × (cos 30° + cos 60°) = 0.6830127 m along +X and
// 0.5 × (sin 30° + sin 60°) = 0.6830127 m up +Z from the base, which the issue prints to three places.
//
// The tip is read from evaluated data, never from the job's word: the converted world's joints are put at their
// angles by the base's kinematic solve, which places each body from the joints' own frames (helpers.ts `placing`), and
// the tip is the body `tip`'s origin less the body `base`'s in that bake, held to the file's point under the
// rotation the report states. Each joint is also turned 30° alone, which is what lets a failure name a joint.
//
// The planted conversion is the tool `flips-one-joint-axis@1.0.0` (README: The planted programs): the right tool, then
// the joint `elbow`'s axis with the other sign. Its judge is the kind's qualification at `deep install`, which passes
// the right tool run as it is through the same entry and refuses this one, naming `elbow`; and its conversion of this
// arm puts the tip at (0.9330127, 0.25) m, which the measure above fails, naming `elbow` and not `shoulder`.
import { describe, expect, it } from 'vitest';
import {
  AC, ARM_IDS, ARM_PLACEMENTS, FLIPPED, TIMEOUT, armJudged, convert, fixture, hingeFailures, openHub, plantedInstall, prebuild, rotationOf, said, shown, spoiled, tipOf,
  type Converted, type Hub,
} from './helpers.ts';
import { ARM, BENT, LIMIT_DEG, R0, TIP_TOLERANCE, far, inPlane, missingFrom, modelWorld, tipAt, tipInPlane, tipTwin } from './model.ts';

prebuild(['shipped']);

const ID = AC[1];
const TWIN = 'flips_one_joint_axis';
const FILE = ARM.file;

let hub: Promise<Hub | string> | undefined;
let arm: Promise<Converted | string> | undefined;
/** The file's one hub, and the arm converted in it once, for both tests. */
const converted = (): Promise<Converted | string> => {
  hub ??= openHub();
  arm ??= hub.then((h) => convert(h, FILE));
  return arm;
};

describe(`${ID} a two-link arm converts to two hinges in degrees, and its tip is where the file puts it`, () => {
  it(`${ID} a two-link arm, each link 0.5 m, with revolute joints limited to ±1.5708 rad converts to two hinges limited to ±90.000° within 0.001°, and with both joints at 30° the tip is at (0.683, 0.683) m from the base in the arm's plane within 1e-6 m, read from evaluated data`, async () => {
    // The numbers, worked by hand: 0.5 × (√3/2 + 1/2) on each axis, and 1.5708 rad × 180 ÷ π.
    const [along, up] = tipInPlane(BENT, BENT);
    expect([along, up].map((x) => Math.abs(x - 0.6830127018922193) <= 1e-12), 'the model: both joints at 30° put the tip at 0.6830127018922193 m on each axis of the plane').toEqual([true, true]);
    expect(Math.abs(LIMIT_DEG - 90.00021045914971) <= 1e-9 && Math.abs(LIMIT_DEG - 90) <= 0.001, 'the model: 1.5708 rad is 90.00021°, within 0.001° of 90.000°').toBe(true);
    expect(far([...tipTwin(BENT, BENT), 0], [along, up, 0]), 'the model\'s wrong twin, which turns the fore link by the elbow\'s angle alone, puts the tip more than 1e-6 m away').toBeGreaterThan(0.1);
    expect(missingFrom(fixture(FILE), ARM), `${FILE} holds the links, joints and numbers the model works from`).toEqual([]);

    // The measure, proved on an arm written by hand in our units: it passes that arm and fails it with either joint's
    // axis flipped, naming that joint and not the other. None of this is the work's.
    const byHand = armJudged(modelWorld(ARM, R0), R0, 'the arm written by hand');
    expect(byHand.failures, `the measure reads the arm written by hand in our units:\n  ${byHand.failures.join('\n  ')}`).toEqual([]);
    for (const [flipped, other] of [[ARM_IDS.elbow, ARM_IDS.shoulder], [ARM_IDS.shoulder, ARM_IDS.elbow]] as const) {
      const wrong = armJudged(modelWorld(ARM, R0, flipped), R0, `the arm written by hand with ${flipped}'s axis flipped`).failures;
      expect([wrong.some((f) => f.startsWith(`${flipped}: `)), wrong.some((f) => f.startsWith(`${other}: `))], `the measure fails the hand-written arm with ${flipped}'s axis flipped, naming ${flipped} and not ${other}:\n  ${wrong.join('\n  ')}`).toEqual([true, false]);
    }

    const c = await converted();
    expect(typeof c === 'string' ? c : '', `deep_job converts ${FILE} (import {from: urdf})`).toBe('');
    const done = c as Converted;
    const limits = hingeFailures(done.world, [ARM_IDS.shoulder, ARM_IDS.elbow]);
    expect(limits, `the two revolute joints are hinges limited to ±90.000° within 0.001°:\n  ${limits.join('\n  ')}`).toEqual([]);
    const r = rotationOf(done.report);
    expect(typeof r === 'string' ? r : '', 'the report states the one rotation, and it takes the file\'s +Z to our +Y').toBe('');
    const judged = armJudged(done.world, r as Exclude<typeof r, string>, 'the converted arm');
    expect(judged.failures, `the converted arm, its joints placed by the base's kinematic solve:\n  ${judged.failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  it(`${ID} (planted: ${TWIN}) a planted conversion that flips one joint's axis puts the tip elsewhere and fails, naming the joint`, async () => {
    const c = await converted();
    expect(typeof c === 'string' ? c : '', `deep_job converts ${FILE} (import {from: urdf}), which the planted tool runs first`).toBe('');
    const done = c as Converted;
    const planted = await plantedInstall(await hub!, TWIN);
    expect(planted.problem, 'the planted tool and the tool that runs the right one as it is were made and installed').toBe('');
    // The judge passes the right conversion: the right tool, run as it is through the planted tools' own entry, qualifies and is listed.
    expect([planted.control?.code, planted.controlListed], `the kind's qualification passes ${planted.asIs}, the right tool run as it is: ${planted.control ? shown(planted.control) : ''}`).toEqual([0, true]);
    // And fails the planted one, naming the joint.
    expect(planted.install?.code, `the kind's qualification refuses ${planted.tool} at install: ${planted.install ? shown(planted.install) : ''}`).not.toBe(0);
    expect(said(planted.install!).includes(FLIPPED), `the refusal names the joint ${FLIPPED}: ${shown(planted.install!)}`).toBe(true);
    expect(planted.listed.includes(planted.tool), `deep_job lists ${planted.tool} under the kind: ${planted.listed.join(', ')}`).toBe(false);

    // What it converts the arm to puts the tip elsewhere: where a flipped elbow puts it, and the measure names the elbow.
    const wrong = spoiled(TWIN, done);
    expect(typeof wrong === 'string' ? wrong : '', `${TWIN} changes the arm's document`).toBe('');
    const r = rotationOf(done.report);
    expect(typeof r === 'string' ? r : '', 'the report states the one rotation').toBe('');
    const rot = r as Exclude<typeof r, string>;
    const judged = armJudged((wrong as Exclude<typeof wrong, string>).world, rot, `the arm as ${TWIN} converts it`);
    expect([judged.failures.some((f) => f.startsWith(`${FLIPPED}: `)), judged.failures.some((f) => f.startsWith(`${ARM_IDS.shoulder}: `))], `the measure fails the planted conversion, naming ${FLIPPED} and not ${ARM_IDS.shoulder}:\n  ${judged.failures.join('\n  ')}`).toEqual([true, false]);
    const both = judged.placed[ARM_PLACEMENTS.findIndex((p) => p[ARM_IDS.shoulder] === BENT && p[ARM_IDS.elbow] === BENT)];
    expect(both, 'the bake holds the placement with both joints at 30°').toBeDefined();
    const tip = tipOf(both!);
    const read = inPlane(rot, tip);
    expect(far(tip, tipAt(rot, BENT, -BENT)), `the planted conversion puts the tip at (${read.along.toFixed(7)}, ${read.up.toFixed(7)}) m, where a flipped ${FLIPPED} puts it, (0.9330127, 0.25) m`).toBeLessThanOrEqual(TIP_TOLERANCE);
    expect(far(tip, tipAt(rot, BENT, BENT)), 'which is elsewhere: more than 1e-6 m from (0.6830127, 0.6830127) m').toBeGreaterThan(0.1);
  }, TIMEOUT);
});
