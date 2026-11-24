// #3035.0abd59c7: "A fixture with a mimic joint, a transmission and a sensor converts, and `dropped` holds exactly
// those three rows. A planted job that drops one silently fails, naming the element"
//
// The fixture (README: The fixtures and their numbers) is fixtures/gripper.urdf: the joint `mirror`, which mimics the
// joint `pinch`; the transmission `squeeze`; the sensor `eye`; and, so that `dropped` isn't everything, the revolute
// joint `pinch`, the continuous joint `spin` and the fixed joint `glue`, which are kept.
//
// The conversion is done, and its report's `dropped` is compared as a whole set with the three rows, each
// `{element, name}`: joint mirror, transmission squeeze, sensor eye. No row is missing, none is there besides, none
// twice. What is kept is in the world: `pinch` a hinge with limits, `spin` a hinge with none, `glue` a fixed joint,
// and the links they join as bodies.
//
// The planted job is the tool `drops-one-silently@1.0.0` (README: The planted programs): the right tool, then
// `dropped` without the transmission's row. Its judge is the kind's qualification at `deep install`, which passes
// the right tool run as it is and refuses this one, naming the element, `transmission`, and its name, `squeeze`; and
// the comparison above fails its report, naming that row.
import { describe, expect, it } from 'vitest';
import {
  AC, TIMEOUT, UNLISTED, convert, droppedFailures, fixture, keptFailures, openHub, plantedInstall, said, shown, spoiled, type Converted, type Hub,
} from './helpers.ts';
import { GRIPPER } from './model.ts';

const ID = AC[4];
const TWIN = 'drops_one_silently';
const FILE = GRIPPER.file;
const ROW = GRIPPER.dropped.find((d) => d.element === UNLISTED)!;

let hub: Promise<Hub | string> | undefined;
let gripper: Promise<Converted | string> | undefined;
/** The file's one hub, and the gripper converted in it once, for both tests. */
const converted = (): Promise<Converted | string> => {
  hub ??= openHub();
  gripper ??= hub.then((h) => convert(h, FILE));
  return gripper;
};

describe(`${ID} what has no place is listed, and nothing is dropped without a row`, () => {
  it(`${ID} a fixture with a mimic joint, a transmission and a sensor converts, and dropped holds exactly those three rows`, async () => {
    const text = fixture(FILE);
    const tags = ['<joint name="mirror" type="revolute">', '<mimic joint="pinch"', '<transmission name="squeeze">', '<sensor name="eye"', '<joint name="pinch" type="revolute">', '<joint name="spin" type="continuous">', '<joint name="glue" type="fixed">'];
    expect(tags.filter((t) => !text.includes(t)), `${FILE} holds the mimic joint, the transmission, the sensor and the three joints that are kept`).toEqual([]);
    // The comparison is of the whole set: it passes the three rows in any order, and fails one fewer, one more and one twice.
    const three = GRIPPER.dropped.map((d) => ({ ...d }));
    expect(droppedFailures({ dropped: [three[2]!, three[0]!, three[1]!] }), 'the comparison passes the three rows, in any order').toEqual([]);
    expect([droppedFailures({ dropped: three.slice(1) }).length, droppedFailures({ dropped: [...three, { element: 'joint', name: 'pinch' }] }).length, droppedFailures({ dropped: [...three, three[0]!] }).length],
      'the comparison fails a row missing, a row besides the three and a row held twice').toEqual([1, 1, 1]);

    const c = await converted();
    expect(typeof c === 'string' ? c : '', `deep_job converts ${FILE} (import {from: urdf})`).toBe('');
    const done = c as Converted;
    const failures = droppedFailures(done.report);
    expect(failures, `the report's dropped holds exactly the mimic joint, the transmission and the sensor:\n  ${failures.join('\n  ')}`).toEqual([]);
    const lost = keptFailures(done.world);
    expect(lost, `what has a place is kept:\n  ${lost.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  it(`${ID} (planted: ${TWIN}) a planted job that drops one silently fails, naming the element`, async () => {
    const c = await converted();
    expect(typeof c === 'string' ? c : '', `deep_job converts ${FILE} (import {from: urdf}), which the planted tool runs first`).toBe('');
    const done = c as Converted;
    const planted = await plantedInstall(await hub!, TWIN);
    expect(planted.problem, 'the planted tool and the tool that runs the right one as it is were made and installed').toBe('');
    // The judge passes the right job: the right tool, run as it is through the planted tools' own entry, qualifies and is listed.
    expect([planted.control?.code, planted.controlListed], `the kind's qualification passes ${planted.asIs}, the right tool run as it is: ${planted.control ? shown(planted.control) : ''}`).toEqual([0, true]);
    // And fails the planted one, naming the element.
    expect(planted.install?.code, `the kind's qualification refuses ${planted.tool} at install: ${planted.install ? shown(planted.install) : ''}`).not.toBe(0);
    const text = said(planted.install!);
    expect([text.includes(ROW.element), text.includes(ROW.name)], `the refusal names the element, ${ROW.element} ${ROW.name}: ${shown(planted.install!)}`).toEqual([true, true]);
    expect(planted.listed.includes(planted.tool), `deep_job lists ${planted.tool} under the kind: ${planted.listed.join(', ')}`).toBe(false);

    // What it reports of the gripper holds no row for the transmission, and the comparison names it.
    const wrong = spoiled(TWIN, done);
    expect(typeof wrong === 'string' ? wrong : '', `${TWIN} changes the gripper's report`).toBe('');
    const failures = droppedFailures((wrong as Exclude<typeof wrong, string>).report);
    expect(failures.map((f) => f.split(':')[0]), `the comparison fails the planted job's report on the one row, ${ROW.element} ${ROW.name}:\n  ${failures.join('\n  ')}`).toEqual([`${ROW.element} ${ROW.name}`]);
  }, TIMEOUT);
});
