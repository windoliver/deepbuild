// Criterion 9: a planted button under a sibling at step 3 of a journey fails, naming the step and the node.
//
// fixtures/panels/journey-cover: page 3 brings up "Publish" with its sibling "Promo banner" drawn over it, and the
// journey hides the banner again at step 4, so only the screen after step 3 has a node under a sibling. A check that
// audits the end screen, the launch screen or the rendered views alone sees nothing wrong; only one that audits every
// step can name step 3. The journey's own assertions pass on the plant, so they can't tell either. The twin,
// journey-cover-twin, puts the banner beside Publish and must pass. Every judgment is checked against the step's own
// snapshot, and the plant's cover against the pixels of a plain run of the same calls.
import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { checkArguments } from '../../../packages/hub/src/tools.ts';
import { Drive, FIXTURES, cleanup, decodePng, launch, must, only, requireMacos, sha256, type Box, type Obj } from './helpers.ts';
import { AC9, UNDER, coveredProblems, everyStep, journeyCheck, nodeIn, overlap, perStep, stepOf, stepsIn } from './journey-helpers.ts';
import { REFERENCE } from './ui-helpers.ts';

// The checks are shared by the tests that read them, so their files stay until the file ends.
afterAll(cleanup, 60_000);

const PLANT = `${FIXTURES}/panels/journey-cover`;
const TWIN = `${FIXTURES}/panels/journey-cover-twin`;
const NEXT = { role: 'button', name: 'Next' };
const PUBLISH = { role: 'button', name: 'Publish' };
const BANNER = { role: 'button', name: 'Promo banner' };
const HIDE = { role: 'button', name: 'Hide banner' };
/** The banner's fill (journey-cover/main.js, BANNER), drawn nowhere else. */
const ORANGE: [number, number, number] = [0xe8, 0x59, 0x0c];

/** The journey: step 1 asserts page 1, steps 2 and 3 click Next (page 3 at step 3), step 4 hides the banner, step 5 asserts Publish. */
const journey = (panel: string): Obj[] => [
  { call: 'launch', launch: { from: 'empty', panel, clock: 'virtual' } },
  { call: 'expect', locator: { text: 'Page 1 of 3' }, expect: { name: 'first-page', assert: 'visible' } },
  { call: 'act', locator: NEXT, act: { kind: 'click' } },
  { call: 'act', locator: NEXT, act: { kind: 'click' } },
  { call: 'act', locator: HIDE, act: { kind: 'click' } },
  { call: 'expect', locator: PUBLISH, expect: { name: 'publish-shown', assert: 'visible' } },
];
const STEPS = stepsIn(journey(PLANT)); // 5
const COVER = 3;

const checks = new Map<string, Promise<Obj>>();
const check = (panel: string): Promise<Obj> => {
  if (!checks.has(panel)) checks.set(panel, journeyCheck(journey(panel)));
  return checks.get(panel)!;
};

/** Pixels of `box` filled with the banner's orange. */
function orangeIn(png: string, box: Box): number {
  const image = decodePng(readFileSync(png));
  let n = 0;
  for (let y = box[1]; y < box[1] + box[3]; y++) for (let x = box[0]; x < box[0] + box[2]; x++) {
    const q = (y * image.width + x) * 4;
    if (image.rgba[q] === ORANGE[0] && image.rgba[q + 1] === ORANGE[1] && image.rgba[q + 2] === ORANGE[2]) n++;
  }
  return n;
}

/** The plain run of the journey's first `upTo` steps, with no check: what step `upTo` leaves on screen, and its picture. */
async function plain(panel: string, upTo: number): Promise<{ snapshot: Obj; png: string }> {
  const drive = await Drive.start();
  const [first, ...rest] = journey(panel);
  const replica = await launch(drive, first!.launch);
  for (const c of rest.slice(0, upTo)) await must(drive, { ...c, replica });
  const seen = await must(drive, { call: 'see', replica, see: { scope: 'window', include: ['roles', 'names', 'bounds'] } });
  const shot = await must(drive, { call: 'screenshot', replica, screenshot: { target: 'window' } });
  expect(sha256(readFileSync(shot.path)), 'the screenshot hashes to its sha256').toBe(shot.sha256);
  await drive.stop();
  return { snapshot: seen.snapshot, png: shot.path };
}

describe(`${AC9} the UI check runs at every journey step, and a button under a sibling at step 3 fails, naming the step and the node`, () => {
  it(`${AC9} a planted button under a sibling at step 3 of a journey fails, naming step 3 and the node`, async () => {
    requireMacos();
    for (const c of journey(PLANT)) expect(() => checkArguments('deep_drive', { ...c, replica: c.call === 'launch' ? null : 'replica:1x1' }), `the journey is deep_drive calls: ${JSON.stringify(c)}`).not.toThrow();
    // The plant really draws Publish under its sibling after step 3, and nothing is covered once step 4 hides the banner.
    const at3 = await plain(PLANT, COVER);
    const publish = only(at3.snapshot, 'button', 'Publish').bounds;
    const banner = only(at3.snapshot, 'button', 'Promo banner').bounds;
    expect(overlap(publish, banner), `the banner ${JSON.stringify(banner)} lies over Publish ${JSON.stringify(publish)} after step 3`).toEqual(publish);
    expect(orangeIn(at3.png, publish), 'and is drawn on top of it').toBeGreaterThan((publish[2] * publish[3]) / 2);
    const end = await plain(PLANT, STEPS);
    expect(only(end.snapshot, 'button', 'Publish').bounds, 'Publish stays put').toEqual(publish);
    expect(orangeIn(end.png, publish), 'and is uncovered at the end, so a check of the end screen alone finds nothing').toBe(0);

    const reply = await check(PLANT);
    expect(everyStep(reply, STEPS), 'the check audited every step').toEqual([]);
    expect(reply.journey?.outcome, 'the journey\'s own assertions pass: they can\'t see it').toBe('passed');
    expect(reply.claim, 'the UI claim fails').toBe('FAIL');
    expect(perStep(reply, STEPS), 'one finding, at step 3 alone').toEqual([[], [], [`${UNDER.sibling} Publish`], [], []]);
    expect(coveredProblems(reply, { k: COVER, audit: UNDER.sibling, node: PUBLISH, by: BANNER })).toEqual([]);
    expect((reply.findings as Obj[]).length, `the top-level list holds it once: ${JSON.stringify(reply.findings).slice(0, 600)}`).toBe(1);
    const [f] = reply.findings as [Obj];
    expect([f.step, f.audit, f.node.name, f.by.name], 'naming the step and the node').toEqual([COVER, UNDER.sibling, 'Publish', 'Promo banner']);
    expect([f.size, f.theme], 'at the launch\'s size and theme').toEqual([REFERENCE, 'light']);
    expect(stepOf(reply, COVER)!.id, 'the step is the journey\'s own').toBe((reply.journey.steps as Obj[])[COVER - 1]!.id);
    expect(stepOf(reply, COVER)!.id).toBe('step 3: act');
  }, 900_000);

  it(`${AC9} the twin journey, its banner beside Publish, has nothing covered at any step and passes`, async () => {
    requireMacos();
    const reply = await check(TWIN);
    expect(everyStep(reply, STEPS), 'the check audited every step').toEqual([]);
    const at3 = stepOf(reply, COVER);
    const publish = nodeIn(at3, 'button', 'Publish'), banner = nodeIn(at3, 'button', 'Promo banner');
    expect(publish && banner, `step 3 reached page 3, with Publish and the banner: ${JSON.stringify(at3?.snapshot ?? null).slice(0, 400)}`).toBeTruthy();
    expect(overlap(publish!.bounds, banner!.bounds), 'side by side').toBeNull();
    expect(reply.journey?.outcome).toBe('passed');
    expect(perStep(reply, STEPS), 'no finding at any step').toEqual([[], [], [], [], []]);
    expect([reply.claim, reply.findings], JSON.stringify(reply.findings).slice(0, 600)).toEqual(['PASS', []]);
  }, 900_000);

  it(`${AC9} the same journey with its assertions taken out ran nothing, and the check over it is INCONCLUSIVE, never PASS`, async () => {
    requireMacos();
    const bare = journey(TWIN).filter((c) => c.call !== 'expect');
    const reply = await journeyCheck(bare);
    expect(reply.journey?.outcome, 'a run with no assertion is no journey').toBe('ran_nothing');
    expect(everyStep(reply, stepsIn(bare)), 'its steps were still audited').toEqual([]);
    expect(reply.findings).toEqual([]);
    expect(reply.claim, 'and nothing is proven').toBe('INCONCLUSIVE');
  }, 900_000);
});

// ---------------------------------------------------------------------------------------------------
// The judges, on wrong programs written here: synthetic answers from a check that audits too little or names the wrong thing.
describe(`${AC9} the judges, on wrong programs`, () => {
  const node = (role: string, name: string | null, bounds: Box): Obj => ({ role, name, value: null, bounds, children: [] });
  const PUB: Box = [24, 85, 200, 56], BAN: Box = [24, 85, 220, 56];
  const screen = (covered: boolean): Obj => ({
    window: { size: REFERENCE, scale: 2 }, items: [],
    tree: { ...node('window', null, [0, 0, 3024, 1964]), children: covered ? [node('button', 'Publish', PUB), node('button', 'Promo banner', BAN)] : [node('button', 'Next', [24, 85, 160, 56])] },
  });
  const ids = ['step 1: expect', 'step 2: act', 'step 3: act', 'step 4: act', 'step 5: expect'];
  const finding = (step: number): Obj => ({ audit: UNDER.sibling, step, view: null, size: REFERENCE, theme: 'light', node: { role: 'button', name: 'Publish', bounds: PUB }, by: { role: 'button', name: 'Promo banner', bounds: BAN }, box: PUB, frame: null, text: null });
  const right = (): Obj => {
    const steps = ids.map((id, i) => ({ step: i + 1, id, snapshot: screen(i + 1 === COVER), findings: i + 1 === COVER ? [finding(COVER)] : [] }));
    return { ok: true, claim: 'FAIL', journey: { outcome: 'passed', steps: ids.map((id) => ({ id, digest: '0'.repeat(64) })) }, steps, findings: [finding(COVER)] };
  };
  const judged = (reply: Obj): string => [...everyStep(reply, STEPS), ...coveredProblems(reply, { k: COVER, audit: UNDER.sibling, node: PUBLISH, by: BANNER })].join('\n');

  it(`${AC9} the right answer passes the judges`, () => {
    expect(judged(right())).toBe('');
    expect(perStep(right(), STEPS)).toEqual([[], [], [`${UNDER.sibling} Publish`], [], []]);
  });

  it(`${AC9} a check of the end screen alone, of the launch alone, or of a skipped step fails, named`, () => {
    const end = right();
    end.steps = [{ ...end.steps.at(-1), findings: [] }];
    end.findings = [];
    end.claim = 'PASS';
    expect(judged(end)).toMatch(/step 1 was audited 0 times/);
    expect(judged(end)).toMatch(/PASS on a journey not audited at every step/);
    expect(judged(end)).toMatch(/step 3 has 0 under_sibling findings/);
    const none = { ...right(), steps: [], findings: [], claim: 'PASS' };
    expect(judged(none)).toMatch(/step 3 was audited 0 times/);
    const skipped = right();
    skipped.steps = skipped.steps.filter((s: Obj) => s.step !== 2);
    expect(judged(skipped)).toMatch(/step 2 was audited 0 times/);
    const noShot = right();
    delete noShot.steps[2].snapshot;
    expect(judged(noShot)).toMatch(/step 3's audit holds no snapshot/);
  });

  it(`${AC9} a finding at the wrong step, on the sibling instead of the button, with no cover named, or at the wrong box fails, named`, () => {
    const late = right();
    late.steps[2].findings = [];
    late.steps[3].findings = [finding(4)];
    late.findings = [finding(4)];
    late.steps[3].snapshot = screen(true);
    expect(judged(late)).toMatch(/step 3 has 0 under_sibling findings/);
    const swapped = right();
    const swap = { ...finding(COVER), node: { role: 'button', name: 'Promo banner', bounds: BAN }, by: { role: 'button', name: 'Publish', bounds: PUB } };
    swapped.steps[2].findings = [swap];
    swapped.findings = [swap];
    expect(judged(swapped)).toMatch(/0 under_sibling findings naming Publish/);
    const bare = right();
    const noBy = { ...finding(COVER), by: null };
    bare.steps[2].findings = [noBy];
    bare.findings = [noBy];
    expect(judged(bare)).toMatch(/not the button "Promo banner"/);
    const box = right();
    const off = { ...finding(COVER), box: [0, 0, 10, 10] };
    box.steps[2].findings = [off];
    box.findings = [off];
    expect(judged(box)).toMatch(/isn't the covered part/);
    const unlisted = right();
    unlisted.findings = [];
    expect(judged(unlisted)).toMatch(/isn't in the top-level list/);
    const misfiled = right();
    misfiled.steps[2].findings = [finding(2)];
    expect(judged(misfiled)).toMatch(/names step 2/);
  });
});
