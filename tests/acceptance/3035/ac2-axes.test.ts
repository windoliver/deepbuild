// #3035.b3b50392: "A link 1 m up the file's Z stands at y = 1 m, and a link with mass 2 kg and a stated inertia keeps
// both within 1e-9 after the change of axes. A planted conversion that copies poses as written fails, naming the link"
//
// The fixture (README: The fixtures and their numbers) is fixtures/axes.urdf: `mast` on a fixed joint 1 m up the
// file's Z from `base`, and `slab`, 2 kg with ixx 0.02, iyy 0.06 and izz 0.07 kg·m², on a fixed joint at the file's
// (0.4, 0.3, 0.5) m, turned 30° about the file's Z. The three moments differ, so a wrong change of axes shows.
//
// Read from the converted document under the rotation its report states, which must take the file's +Z to our +Y
// (README: The change of axes): `mast` stands at (0, 1, 0) m; `slab` keeps 2 kg, its moments are the file's about the
// axes the rotation takes them to (about our Y the file's izz), it stands where the rotation takes its place, and it
// is turned 30° about our Y. Each link is an item and a body. And the base's own check of the world as converted
// accepts it, so the mass, the inertia and the poses are ones the physics module runs.
//
// The planted conversion is the tool `copies-poses-as-written@1.0.0` (README: The planted programs): the right tool,
// then every body's pose as the file writes it. Its judge is the kind's qualification at `deep install`, which passes
// the right tool run as it is and refuses this one, naming `mast`; and in its conversion `mast` stands at
// (0, 0, 1) m, which the judge above fails, naming `mast`.
import { describe, expect, it } from 'vitest';
import {
  AC, AXES_IDS, AXES_TOLERANCE, MOVED, TIMEOUT, axesFailures, check, checkFailures, convert, fixture, openHub, physics, plantedInstall, posOf, prebuild, rotationOf, said,
  shown, spoiled, type Converted, type Hub,
} from './helpers.ts';
import { AXES, R0, R_DOWN, far, missingFrom, modelWorld, movedInertia, movedPose, upError } from './model.ts';

prebuild(['shipped']);

const ID = AC[2];
const TWIN = 'copies_poses_as_written';
const FILE = AXES.file;

let hub: Promise<Hub | string> | undefined;
let rig: Promise<Converted | string> | undefined;
/** The file's one hub, and the axes fixture converted in it once, for both tests. */
const converted = (): Promise<Converted | string> => {
  hub ??= openHub();
  rig ??= hub.then((h) => convert(h, FILE));
  return rig;
};

describe(`${ID} the file's Z-up axes become ours by one stated rotation`, () => {
  it(`${ID} a link 1 m up the file's Z stands at y = 1 m, and a link with mass 2 kg and a stated inertia keeps both within 1e-9 after the change of axes`, async () => {
    // The numbers, worked by hand under −90° about X, where the file's (x, y, z) is our (x, z, −y).
    expect(movedPose(AXES, AXES_IDS.mast, R0).pos, 'the model: 1 m up the file\'s Z is (0, 1, 0)').toEqual([0, 1, 0]);
    expect(movedPose(AXES, AXES_IDS.slab, R0).pos, 'the model: the file\'s (0.4, 0.3, 0.5) is (0.4, 0.5, −0.3)').toEqual([0.4, 0.5, -0.3]);
    expect(movedInertia([0.02, 0.06, 0.07], R0), 'the model: the file\'s moments (0.02, 0.06, 0.07) are (0.02, 0.07, 0.06) about our axes, with no product').toEqual({ moments: [0.02, 0.07, 0.06], product: 0 });
    // The wrong twin of that rotation takes the file's +Z down, and a test must refuse it.
    expect([upError(R0), upError(R_DOWN)], 'the model: −90° about X takes the file\'s +Z to our +Y, and +90° takes it to −Y').toEqual([0, 2]);
    expect(missingFrom(fixture(FILE), AXES), `${FILE} holds the links, joints and numbers the model works from`).toEqual([]);

    // The base's check accepts the rig written by hand in our units, so a refusal of the converted one is the work's.
    const byHand = physics([check(modelWorld(AXES, R0))]);
    expect(byHand.problem, `${byHand.what} answers the check of the rig written by hand`).toBe('');
    expect(checkFailures(byHand.replies[0], 'the rig written by hand in our units'), 'the base\'s check accepts the rig written by hand').toEqual([]);

    const c = await converted();
    expect(typeof c === 'string' ? c : '', `deep_job converts ${FILE} (import {from: urdf})`).toBe('');
    const done = c as Converted;
    const r = rotationOf(done.report);
    expect(typeof r === 'string' ? r : '', 'the report states the one rotation, and it takes the file\'s +Z to our +Y').toBe('');
    const failures = axesFailures(done.document, done.world, r as Exclude<typeof r, string>);
    expect(failures, `the converted axes fixture, under its stated rotation:\n  ${failures.join('\n  ')}`).toEqual([]);
    const run = physics([check(done.world)]);
    expect(run.problem, `${run.what} answers the check of the converted world`).toBe('');
    const refused = checkFailures(run.replies[0], 'the converted axes fixture');
    expect(refused, `the base's check accepts the world as converted:\n  ${refused.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  it(`${ID} (planted: ${TWIN}) a planted conversion that copies poses as written fails, naming the link`, async () => {
    const c = await converted();
    expect(typeof c === 'string' ? c : '', `deep_job converts ${FILE} (import {from: urdf}), which the planted tool runs first`).toBe('');
    const done = c as Converted;
    const planted = await plantedInstall(await hub!, TWIN);
    expect(planted.problem, 'the planted tool and the tool that runs the right one as it is were made and installed').toBe('');
    // The judge passes the right conversion: the right tool, run as it is through the planted tools' own entry, qualifies and is listed.
    expect([planted.control?.code, planted.controlListed], `the kind's qualification passes ${planted.asIs}, the right tool run as it is: ${planted.control ? shown(planted.control) : ''}`).toEqual([0, true]);
    // And fails the planted one, naming the link.
    expect(planted.install?.code, `the kind's qualification refuses ${planted.tool} at install: ${planted.install ? shown(planted.install) : ''}`).not.toBe(0);
    expect(said(planted.install!).includes(MOVED), `the refusal names the link ${MOVED}: ${shown(planted.install!)}`).toBe(true);
    expect(planted.listed.includes(planted.tool), `deep_job lists ${planted.tool} under the kind: ${planted.listed.join(', ')}`).toBe(false);

    // What it converts the fixture to leaves the link where the file writes it, 1 m along Z, and the judge names the link.
    const wrong = spoiled(TWIN, done);
    expect(typeof wrong === 'string' ? wrong : '', `${TWIN} changes the axes fixture's document`).toBe('');
    const spoiledDoc = wrong as Exclude<typeof wrong, string>;
    const r = rotationOf(done.report);
    expect(typeof r === 'string' ? r : '', 'the report states the one rotation').toBe('');
    const failures = axesFailures(spoiledDoc.document, spoiledDoc.world, r as Exclude<typeof r, string>);
    expect(failures.some((f) => f.startsWith(`${MOVED}: `)), `the judge fails the planted conversion, naming ${MOVED}:\n  ${failures.join('\n  ')}`).toBe(true);
    const at = posOf(spoiledDoc.world, MOVED);
    expect(at && far(at, [0, 0, 1]) <= AXES_TOLERANCE, `the planted conversion leaves ${MOVED} at the file's (0, 0, 1) m: ${JSON.stringify(at)}`).toBe(true);
  }, TIMEOUT);
});
