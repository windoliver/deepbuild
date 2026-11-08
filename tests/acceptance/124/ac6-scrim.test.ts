// Criterion 6: with a fixture dialog's transparent scrim covering the panel's Save button, a click on Save is refused,
// naming the scrim, and the fixture's draft is unchanged; with the scrim gone the click is delivered and its result says
// delivered; the probe on Save names the scrim without dismissing it; a planted driver that clicks Save's box centre
// without the hit test dismisses the dialog, discards the draft and fails, naming the scrim.
//
// fixtures/panels/scrim-dialog: Save stays visible, enabled and still under the scrim and the scrim draws nothing, so the
// waits an action already has can't tell; only a hit test can. The panel's "Scrim events <n>" line counts every pointer
// event the scrim is sent, moves included, so "nothing is sent" and "read-only" are read off the panel. Every name the
// judge uses comes from the probe's real answer, and every box from `see`. The wrong program is DEEP_DRIVE_PLANT=no-hit-test.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { checkArguments } from '../../../packages/hub/src/tools.ts';
import {
  Drive, JOURNEY_CHECK, cleanup, decodePng, inside, judge, launch, must, nodesOf, requireMacos, type Box, type Node, type Obj,
} from './helpers.ts';
import { AC, SCRIM_PANEL, differing } from './ui-helpers.ts';

afterEach(cleanup, 60_000);

const SAVE = { role: 'button', name: 'Save' };
const SCRIM = { role: 'button', name: 'Scrim' };
const KEEP = { role: 'button', name: 'Keep editing' };
const IGNORES = { role: 'button', name: 'Ignores clicks' };
const DRAFT = 'Draft: Release notes, second pass';
const CLICK = { kind: 'click' };

interface State { scrim: Node | null; save: Node; draft: string | null; saved: string | null; events: number; sha256: string }

/** What the panel shows right now, read from `see`. */
async function state(drive: Drive, replica: string): Promise<State> {
  const seen = await must(drive, { call: 'see', replica, see: { scope: 'window', include: ['roles', 'names', 'bounds'] } });
  const nodes = nodesOf(seen.snapshot);
  const named = (name: string): Node | null => nodes.find((n) => n.role === 'button' && n.name === name) ?? null;
  const line = (re: RegExp): string | null => nodes.map((n) => n.name ?? '').find((name) => re.test(name)) ?? null;
  const save = named('Save');
  expect(save, 'the panel draws its Save button').toBeTruthy();
  return {
    scrim: named('Scrim'),
    save: save!,
    draft: line(/^Draft/),
    saved: line(/^(Saved|Not saved)/),
    events: Number(/(\d+)$/.exec(line(/^Scrim events \d+$/) ?? '')?.[1] ?? -1),
    sha256: seen.sha256 as string,
  };
}

async function open(plant?: string): Promise<{ drive: Drive; replica: string }> {
  const drive = await Drive.start(plant ? { plant } : {});
  const replica = await launch(drive, { from: 'fixture', panel: SCRIM_PANEL, clock: 'virtual' });
  return { drive, replica };
}

/** Every way a click on Save under the thing `probed` names went wrong; none for a refusal that left the panel alone. */
function scrimProblems(o: { probed: Obj; reply: Obj; after: State }): string[] {
  const problems: string[] = [];
  const name = String(o.probed.receiver?.name);
  if (o.reply.ok !== false) problems.push(`the click on Save was delivered to ${name}: ${JSON.stringify(o.reply).slice(0, 200)}`);
  else if (o.reply.error?.code !== 'refused') problems.push(`the click failed as ${String(o.reply.error?.code)}, not refused`);
  else if (o.reply.error?.covered_by?.name !== name) problems.push(`the refusal names ${JSON.stringify(o.reply.error?.covered_by)}, not ${name}`);
  if (!o.after.scrim) problems.push(`${name} is gone: the click dismissed the dialog`);
  if (o.after.draft !== DRAFT) problems.push(`the click on ${name} discarded the draft: the panel reads ${JSON.stringify(o.after.draft)}`);
  if (o.after.saved !== 'Not saved') problems.push(`Save ran under ${name}: the panel reads ${JSON.stringify(o.after.saved)}`);
  if (o.after.events !== 0) problems.push(`${name} was sent ${o.after.events} pointer events`);
  return problems;
}

describe(`${AC.scrim} a click on Save under a transparent scrim is refused naming it, delivered once it is gone, and the probe names it without dismissing it`, () => {
  it(`${AC.scrim} with the scrim over Save the click is refused, naming the scrim, nothing is sent and the draft is unchanged`, async () => {
    requireMacos();
    const { drive, replica } = await open();
    const before = await state(drive, replica);
    expect(before.scrim, 'the fixture opens with its scrim up').toBeTruthy();
    expect(before.draft, 'and its draft written').toBe(DRAFT);
    expect(before.events, 'the panel counts what the scrim is sent').toBe(0);
    const scrim = before.scrim!.bounds, save = before.save.bounds;
    expect(inside([save[0] + 1, save[1] + 1], scrim) && inside([save[0] + save[2] - 1, save[1] + save[3] - 1], scrim), `the scrim ${JSON.stringify(scrim)} covers Save ${JSON.stringify(save)}`).toBe(true);
    // An action's own waits can't refuse this one: Save is visible and enabled, and has been still since launch.
    const enabled = await must(drive, { call: 'expect', replica, locator: SAVE, expect: { name: 'save-enabled', assert: 'state', state: 'enabled' }, timeout: 100 });
    expect(enabled.assertion.passed, `Save is enabled under the scrim: ${JSON.stringify(enabled.assertion)}`).toBe(true);

    const { reply } = await drive.call({ call: 'act', replica, locator: SAVE, act: CLICK, timeout: 1000 });
    expect(reply.ok, `the click is refused: ${JSON.stringify(reply).slice(0, 400)}`).toBe(false);
    expect(reply.error.code, 'as a refusal, not a timeout').toBe('refused');
    expect(reply.error.covered_by?.role, `the refusal names what would get the event: ${JSON.stringify(reply.error).slice(0, 400)}`).toBe('button');
    expect(reply.error.covered_by?.name, 'by its name').toBe('Scrim');
    expect(reply.error.covered_by?.bounds, 'and its real bounds').toEqual(scrim);
    expect(reply.error.message, 'in words too').toMatch(/Scrim/);
    expect(Array.isArray(reply.error.point) && inside(reply.error.point as [number, number], save), `the point it tested ${JSON.stringify(reply.error.point)} is on Save ${JSON.stringify(save)}`).toBe(true);
    const after = await state(drive, replica);
    expect(scrimProblems({ probed: { receiver: { name: 'Scrim' } }, reply, after })).toEqual([]);
    expect(after.sha256, 'the panel is as it was, node for node').toBe(before.sha256);
  }, 600_000);

  it(`${AC.scrim} every pointer action under the scrim is refused the same way: double click, hover, drag, scroll, and typing into the covered target`, async () => {
    requireMacos();
    const { drive, replica } = await open();
    const before = await state(drive, replica);
    const acts: Obj[] = [
      { kind: 'double_click' }, { kind: 'hover' }, { kind: 'drag', to_point: [100, 700] }, { kind: 'scroll', dx: 0, dy: 40 }, { kind: 'type', text: 'x' },
    ];
    for (const act of acts) {
      const { reply } = await drive.call({ call: 'act', replica, locator: SAVE, act, timeout: 1000 });
      expect([reply.ok, reply.error?.code, reply.error?.covered_by?.name], `${act.kind} under the scrim: ${JSON.stringify(reply).slice(0, 300)}`).toEqual([false, 'refused', 'Scrim']);
    }
    const after = await state(drive, replica);
    expect(after.events, 'nothing reached the scrim').toBe(0);
    expect(after.sha256, 'and the panel is as it was').toBe(before.sha256);
  }, 600_000);

  it(`${AC.scrim} with the scrim gone the click is delivered and its result says delivered, never that the target handled it`, async () => {
    requireMacos();
    const { drive, replica } = await open();
    const up = await must(drive, { call: 'screenshot', replica, screenshot: { target: 'window' } });
    const before = await state(drive, replica);
    // The dialog's own button is inside the scrim's box and above it: the hit test is the top element, not any that holds the point.
    const kept = await must(drive, { call: 'act', replica, locator: KEEP, act: CLICK }, 'Keep editing, above the scrim');
    expect(kept.result, `the dialog's button gets its click: ${JSON.stringify(kept).slice(0, 300)}`).toBe('delivered');
    const gone = await state(drive, replica);
    expect(gone.scrim, 'Keep editing closes the dialog').toBeNull();
    expect(gone.draft, 'and keeps the draft').toBe(DRAFT);
    // The scrim is transparent: Save is drawn the same with it up and with it gone.
    const down = await must(drive, { call: 'screenshot', replica, screenshot: { target: 'window' } });
    expect(differing(decodePng(readFileSync(up.path)), decodePng(readFileSync(down.path)), before.save.bounds), 'the scrim draws nothing over Save').toBe(0);

    const saved = await must(drive, { call: 'act', replica, locator: SAVE, act: CLICK }, 'the click on Save with the scrim gone');
    expect(saved.result, `its result says delivered: ${JSON.stringify(saved).slice(0, 300)}`).toBe('delivered');
    expect(inside(saved.point as [number, number], gone.save.bounds), 'at a point on Save').toBe(true);
    expect((await state(drive, replica)).saved, 'and Save ran').toBe('Saved Release notes, second pass');
    expect(Object.keys(saved).filter((k) => /handl|saved|success|consum/i.test(k)), 'the result says nothing about what the target did').toEqual([]);

    // A target that does nothing with the click gets the same word: delivered, not handled.
    const seen = await state(drive, replica);
    const ignored = await must(drive, { call: 'act', replica, locator: IGNORES, act: CLICK }, 'the click on a button with no handler');
    expect(ignored.result, 'delivered, though nothing handled it').toBe('delivered');
    expect((await state(drive, replica)).sha256, 'and nothing changed').toBe(seen.sha256);
  }, 600_000);

  it(`${AC.scrim} the probe on Save names the scrim without dismissing it, and answers the same hit test as the click`, async () => {
    requireMacos();
    expect(() => checkArguments('deep_drive', { call: 'probe', replica: 'replica:1x1', locator: SAVE }), 'probe is a deep_drive call the hub\'s strict check takes').not.toThrow();
    const { drive, replica } = await open();
    const before = await state(drive, replica);
    await must(drive, { call: 'record', replica, record: { action: 'start', fps: 30, marks: 'per_action', mask: [], mask_kind: 'fill' } });
    const probed = await must(drive, { call: 'probe', replica, locator: SAVE }, 'the probe on Save');
    expect(await must(drive, { call: 'probe', replica, locator: SAVE }, 'a second probe'), 'a probe changes nothing, so it answers the same again').toMatchObject({ point: probed.point, receiver: probed.receiver });
    const stop = await must(drive, { call: 'record', replica, record: { action: 'stop' } });
    expect(stop.actions, 'a probe is no action').toEqual([]);
    expect(probed.receiver?.name, `the probe names what would get the event: ${JSON.stringify(probed).slice(0, 300)}`).toBe('Scrim');
    expect(probed.receiver?.role).toBe('button');
    expect(probed.receiver?.bounds, 'with its real bounds').toEqual(before.scrim!.bounds);
    expect(probed.clear, 'and says the target wouldn\'t get it').toBe(false);
    expect(probed.box, 'the target\'s box').toEqual(before.save.bounds);
    expect(inside(probed.point as [number, number], before.save.bounds), 'the point it tested').toBe(true);
    const after = await state(drive, replica);
    expect(after.scrim, 'the scrim is still up').toBeTruthy();
    expect(after.draft, 'the draft is unchanged').toBe(DRAFT);
    expect(after.events, 'the scrim was sent nothing, not even a move').toBe(0);
    expect(after.sha256, 'the panel is as it was').toBe(before.sha256);

    // The same hit test as the action: the refusal's answer, and with the scrim gone the point the click really uses.
    const { reply } = await drive.call({ call: 'act', replica, locator: SAVE, act: CLICK, timeout: 1000 });
    expect([reply.error?.covered_by, reply.error?.point], 'the click refused names what the probe named, at the point it tested').toEqual([probed.receiver, probed.point]);
    const own = await must(drive, { call: 'probe', replica, locator: KEEP }, 'the probe on the dialog\'s button, above the scrim');
    expect([own.receiver?.name, own.clear], 'the top element gets it').toEqual(['Keep editing', true]);
    await must(drive, { call: 'act', replica, locator: KEEP, act: CLICK });
    const clear = await must(drive, { call: 'probe', replica, locator: SAVE }, 'the probe on Save with the scrim gone');
    expect([clear.receiver?.name, clear.clear], 'Save gets it now').toEqual(['Save', true]);
    const click = await must(drive, { call: 'act', replica, locator: SAVE, act: CLICK });
    expect(click.point, 'at the very point the probe tested').toEqual(clear.point);
  }, 600_000);

  it(`${AC.scrim} a journey that clicks under the scrim fails, its failure naming the scrim`, async () => {
    requireMacos();
    const { drive, replica } = await open();
    await drive.call({ call: 'act', replica, locator: SAVE, act: CLICK, timeout: 1000 });
    const closed = await must(drive, { call: 'close', replica });
    expect(closed.journey.outcome, 'a refused action fails the journey').toBe('failed');
    expect(JSON.stringify(closed.journey.failures), 'naming the scrim').toMatch(/Scrim/);
    expect(judge(closed.journey).outcome).toBe('FAIL');
  }, 600_000);

  it(`${AC.scrim} a planted driver that clicks Save's box centre without the hit test dismisses the dialog, discards the draft and fails, naming the scrim`, async () => {
    requireMacos();
    const { drive, replica } = await open('no-hit-test');
    const before = await state(drive, replica);
    expect(before.draft, 'the planted run starts as the honest one').toBe(DRAFT);
    const probed = await must(drive, { call: 'probe', replica, locator: SAVE }, 'the probe, which the plant leaves alone');
    expect(probed.receiver?.name, 'the probe still names the scrim').toBe('Scrim');
    const { reply } = await drive.call({ call: 'act', replica, locator: SAVE, act: CLICK, timeout: 1000 });
    const [x, y, w, h] = before.save.bounds as Box;
    expect(reply.ok, `the planted driver sends the click: ${JSON.stringify(reply).slice(0, 300)}`).toBe(true);
    expect(reply.point, 'at Save\'s box centre').toEqual([x + Math.floor(w / 2), y + Math.floor(h / 2)]);
    const after = await state(drive, replica);
    const problems = scrimProblems({ probed, reply, after });
    expect(after.scrim, `the event went to the scrim, which dismissed the dialog: ${problems.join('; ')}`).toBeNull();
    expect(after.draft, 'and discarded the draft').not.toBe(DRAFT);
    expect(after.saved, 'and Save never ran').toBe('Not saved');
    expect(problems.join('\n'), 'the judge fails it').toMatch(/delivered to Scrim/);
    expect(problems.join('\n')).toMatch(/Scrim is gone: the click dismissed the dialog/);
    expect(problems.join('\n')).toMatch(/click on Scrim discarded the draft/);
    // And the journey that holds the same expectations fails, sent back naming the scrim.
    await must(drive, { call: 'expect', replica, locator: SCRIM, expect: { name: 'scrim-still-up', assert: 'visible' }, timeout: 100 });
    await must(drive, { call: 'expect', replica, locator: { text: DRAFT }, expect: { name: 'draft-unchanged', assert: 'visible' }, timeout: 100 });
    const closed = await must(drive, { call: 'close', replica });
    expect((closed.journey.failures as Obj[]).map((f) => f.test), 'the journey\'s failures').toEqual(expect.arrayContaining(['scrim-still-up', 'draft-unchanged']));
    const v = judge(closed.journey);
    expect(v.outcome, 'the verdict engine fails the claim').toBe('FAIL');
    expect(v.send_backs.some((b) => b.checks.includes(JOURNEY_CHECK) && `${b.cause} ${b.smallest}`.includes('scrim-still-up')), `naming the scrim: ${JSON.stringify(v.send_backs).slice(0, 600)}`).toBe(true);
  }, 600_000);
});
