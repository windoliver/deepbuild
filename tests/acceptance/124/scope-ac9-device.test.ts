// Scope: the UI check at every journey step adds two more findings, a node under a system bar and a node under the
// on-screen keyboard. They have no criterion of their own. A replica gets both from its launch: `launch.device` gives
// it a system bar over the window's top edge and an on-screen keyboard that rises over the bottom edge while a text
// input has focus (README: Criterion 9). fixtures/panels/device-insets ignores both: "Account" sits under the bar from
// launch on, and "Send" comes under the keyboard once step 2 focuses the field. Its twin keeps clear of both. Every
// judgment is checked against the step's own snapshot and the device's geometry in device pixels.
import { afterAll, describe, expect, it } from 'vitest';
import { checkArguments } from '../../../packages/hub/src/tools.ts';
import { FIXTURES, cleanup, requireMacos, type Box, type Obj } from './helpers.ts';
import { UNDER, coveredProblems, everyStep, journeyCheck, nodeIn, overlap, perStep, stepOf, stepsIn } from './journey-helpers.ts';
import { REFERENCE, REFERENCE_SCALE } from './ui-helpers.ts';

afterAll(cleanup, 60_000);

const PLANT = `${FIXTURES}/panels/device-insets`;
const TWIN = `${FIXTURES}/panels/device-insets-twin`;
/** A device with a 24-point system bar and a 300-point on-screen keyboard, in points. */
const DEVICE = { system_bar: 24, keyboard: 300 };
const [W, H] = REFERENCE;
const S = REFERENCE_SCALE;
/** Where they lie in the reference window, in device pixels: the bar over the top edge, the keyboard over the bottom. */
const BAR: Box = [0, 0, W * S, DEVICE.system_bar * S];
const KEYS: Box = [0, (H - DEVICE.keyboard) * S, W * S, DEVICE.keyboard * S];
const ACCOUNT = { role: 'button', name: 'Account' };
const SEND = { role: 'button', name: 'Send' };

/** Step 1 asserts the composer, step 2 focuses the field (the keyboard rises), step 3 asserts the composer again. */
const journey = (panel: string, device: Obj | null = DEVICE): Obj[] => [
  { call: 'launch', launch: { from: 'empty', panel, clock: 'virtual', ...(device ? { device } : {}) } },
  { call: 'expect', locator: { text: 'Compose a message' }, expect: { name: 'compose-shown', assert: 'visible' } },
  { call: 'act', locator: { label: 'Message' }, act: { kind: 'click' } },
  { call: 'expect', locator: { text: 'Compose a message' }, expect: { name: 'still-composing', assert: 'visible' } },
];
const STEPS = stepsIn(journey(PLANT)); // 3

describe('scope: the UI check at every journey step names a node under a system bar and a node under the on-screen keyboard', () => {
  it('a button under the system bar is named at every step, and a button under the keyboard from the step that raised it', async () => {
    requireMacos();
    expect(() => checkArguments('deep_drive', { ...journey(PLANT)[0], replica: null }), 'launch.device is a deep_drive launch field the hub\'s strict check takes').not.toThrow();
    const reply = await journeyCheck(journey(PLANT));
    expect(everyStep(reply, STEPS), 'the check audited every step').toEqual([]);
    expect(reply.journey?.outcome, 'the journey\'s own assertions pass').toBe('passed');
    expect(reply.claim, 'the UI claim fails').toBe('FAIL');
    expect(perStep(reply, STEPS), 'Account under the bar throughout; Send under the keyboard once the field has focus').toEqual([
      [`${UNDER.bar} Account`],
      [`${UNDER.keyboard} Send`, `${UNDER.bar} Account`],
      [`${UNDER.keyboard} Send`, `${UNDER.bar} Account`],
    ]);
    for (let k = 1; k <= STEPS; k++) {
      expect(coveredProblems(reply, { k, audit: UNDER.bar, node: ACCOUNT, by: { role: 'system_bar', name: null, bounds: BAR } }), `step ${k}`).toEqual([]);
      if (k >= 2) expect(coveredProblems(reply, { k, audit: UNDER.keyboard, node: SEND, by: { role: 'keyboard', name: null, bounds: KEYS } }), `step ${k}`).toEqual([]);
    }
    // Before the field had focus, Send sat where the keyboard would come: only the keyboard covers it, never its place.
    expect(overlap(nodeIn(stepOf(reply, 1), 'button', 'Send')!.bounds, KEYS), 'Send lies where the keyboard rises').not.toBeNull();
  }, 900_000);

  it('the twin, clear of the bar and the keyboard, has nothing covered at any step and passes', async () => {
    requireMacos();
    const reply = await journeyCheck(journey(TWIN));
    expect(everyStep(reply, STEPS)).toEqual([]);
    for (const [name] of [['Account'], ['Send']]) {
      const at = nodeIn(stepOf(reply, STEPS), 'button', name!);
      expect(at, `the twin draws ${name}`).toBeTruthy();
      expect([overlap(at!.bounds, BAR), overlap(at!.bounds, KEYS)], `${name} is clear of both`).toEqual([null, null]);
    }
    expect(reply.journey?.outcome).toBe('passed');
    expect(perStep(reply, STEPS)).toEqual([[], [], []]);
    expect([reply.claim, reply.findings], JSON.stringify(reply.findings).slice(0, 600)).toEqual(['PASS', []]);
  }, 900_000);

  it('with no device the replica has no system bar or keyboard, so the same panel gets neither finding', async () => {
    requireMacos();
    const reply = await journeyCheck(journey(PLANT, null));
    expect(everyStep(reply, STEPS)).toEqual([]);
    expect(perStep(reply, STEPS)).toEqual([[], [], []]);
    expect([reply.claim, reply.findings], JSON.stringify(reply.findings).slice(0, 600)).toEqual(['PASS', []]);
  }, 900_000);
});
