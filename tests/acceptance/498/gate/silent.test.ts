// Criterion 1: no panel plays sound before you start it, checked across every shipped plug-in. The shipped plug-ins are
// the app's shipped panels as its own inventory lists them (crates/deep-app/inventory.json, checked current against the
// app's source by `node scripts/app-inventory.mjs --check`). Each is mounted in a panel slot with a document of strips
// open in it, and everything that isn't your press of Play there asks it to sound: the panel's own request, an agent's,
// and Play with the serial of your click in another panel. What reached the device is read sample by sample; then your
// press of Play in that panel is the control that it can sound at all. Also held: the Device gate's `owner`,
// `granted_by` (your gesture's serial), `state`, and "can't be granted by an agent". Through `deep-show run` (README:
// The surface under test). At the base `deep-show` has no `open`, `play`, `gate` or `output` call and answers every
// scenario here `bad_input`.
import { describe, expect, it } from 'vitest';
import {
  ALPHA, CLICK_UP, Driver, MS, SEC, SLOTS, answerOf, click, firstSound, gate, gateOf, open, output, outputOf, play, refusal,
  runRaw, sAt, sampleAt, scenario, serialOf, shippedPlugins, soundCount, toneAsset, toneIn, useEvidence, useShow, playing,
  type Planted,
} from './helpers.ts';

const show = useShow();
const evidenceDir = useEvidence();

const HZ = 440;
const OPEN = 1 * MS;
const OWN = 1 * SEC; // the panel's own request to play
const AGENT = 1500 * MS; // alpha's agent asks
const ELSEWHERE = 2 * SEC; // your click in the other panel
const WITH_OTHER = ELSEWHERE + 100 * MS; // Play asked with that click's serial
const BEFORE = 3 * SEC; // the gate read before your press
const PRESS = 4 * SEC; // your press of Play in the panel
const AFTER = PRESS + 200 * MS;
const END = 5 * SEC;

/** One shipped plug-in's panel through every way to sound that isn't your press of Play in it; its failures, each
 * starting with the plug-in's ID. */
function sweep(id: string, planted?: Planted): string[] {
  const evidence = evidenceDir();
  const tag = `${id}${planted ? ` (planted ${planted})` : ''}`;
  const steady = toneAsset(evidence, HZ, 8);
  const loop = toneAsset(evidence, 660, 0.5);
  const d = new Driver(show(), { evidence, panels: { p: { rect: SLOTS[0]!, shipped: id }, other: { rect: SLOTS[1]! } }, ...(planted ? { planted } : {}) });
  const strips = [
    { track: 0, asset: steady, start: 0, in: 0, out: 8 * SEC },
    { track: 1, asset: loop, start: 0, in: 0, out: 500 * MS, loop: true },
  ];
  const r1 = d.step([open(OPEN, 'p', 'sweep', strips), ...click(ELSEWHERE, 'other', SLOTS[1]!), ...click(PRESS, 'p', SLOTS[0]!)], `${tag}: the panel, your clicks`);
  const f: string[] = [];
  if (r1[0]!['opened'] !== true) f.push(`${id}: the document of strips didn't open in its panel: ${JSON.stringify(r1[0])}`);
  const other = serialOf(r1[1], `${tag}: your click in the other panel`);
  const mine = serialOf(r1[3], `${tag}: your press of Play in its panel`);

  const r = d.step([
    gate(500 * MS, 'p'),
    play(OWN, 'p'),
    play(AGENT, 'p', { session: ALPHA.id }),
    play(WITH_OTHER, 'p', { serial: other }),
    gate(BEFORE, 'p'),
    play(PRESS + CLICK_UP, 'p', { serial: mine }),
    gate(AFTER, 'p'),
    output(0, END),
  ], `${tag}: asked to sound`);

  // The gate's fields before your press: owned by the plug-in, granted by nothing, suspended.
  for (const [k, when] of [[0, 'at 0.5 s'], [4, 'at 3 s, after every request but yours']] as const) {
    const g = gateOf(r[k], `${tag}: the gate ${when}`);
    if (g.owner !== id) f.push(`${id}: the gate ${when} names its owner ${JSON.stringify(g.owner)}, not the plug-in`);
    if (g.granted_by !== null) f.push(`${id}: the gate ${when} is granted by serial ${g.granted_by} before you pressed Play`);
    if (g.state !== 'suspended') f.push(`${id}: the gate ${when} is ${g.state}, not suspended, before you pressed Play`);
  }
  // Every request that isn't yours is refused.
  for (const [k, who] of [[1, 'the panel\'s own request to play'], [2, `${ALPHA.id}'s agent's request to play`], [3, `Play with the serial ${other} of your click in another panel`]] as const) {
    if (refusal(r[k], `${tag}: ${who}`) === null) f.push(`${id}: ${who} was answered ${JSON.stringify(r[k])}, not refused`);
  }
  // Your press starts it, and the gate says so.
  if (!playing(r[5], `${tag}: your press of Play`)) f.push(`${id}: your press of Play (serial ${mine}) was answered ${JSON.stringify(r[5])}, not playing`);
  const g = gateOf(r[6], `${tag}: the gate after your press`);
  if (g.owner !== id) f.push(`${id}: the gate after your press names its owner ${JSON.stringify(g.owner)}, not the plug-in`);
  if (g.granted_by !== mine) f.push(`${id}: the gate after your press is granted by ${JSON.stringify(g.granted_by)}, not your press's serial ${mine}`);
  if (g.state !== 'running') f.push(`${id}: the gate after your press is ${g.state}, not running`);

  // What reached the device: nothing before your press, your strips after it.
  const heard = outputOf(r[7], evidence, 0, END, `${tag}: the device's output`);
  const pressed = sampleAt(heard, PRESS);
  const early = firstSound(heard, 0, pressed);
  if (early !== null) {
    f.push(`${id}: its panel sounded at ${sAt(heard, early)} (sample ${early}), before you pressed Play at ${sAt(heard, pressed)}; ${soundCount(heard, 0, pressed)} samples above silence`);
  }
  const late = firstSound(heard, pressed, sampleAt(heard, END));
  if (late === null) f.push(`${id}: after your press of Play its panel stayed silent to ${END / SEC} s`);
  else {
    const a = toneIn(heard, HZ, sampleAt(heard, PRESS + 300 * MS), 4800);
    if (a < 0.02) f.push(`${id}: after your press of Play its ${HZ} Hz strip reads amplitude ${a.toFixed(4)} at 4.3 s, not playing`);
  }
  return f;
}

describe('criterion 1: no panel plays sound before you start it, checked across every shipped plug-in', () => {
  it('C1 every shipped plug-in in the app\'s inventory, mounted with a document of strips, stays silent at the device through its own request, an agent\'s and a click elsewhere, its gate suspended and owned by it, until you press Play in its panel, which grants the gate by that press\'s serial and sounds', () => {
    const ids = shippedPlugins();
    const f = ids.flatMap((id) => sweep(id));
    expect(f, `every shipped plug-in (${ids.join(', ')}) is silent until you press Play`).toEqual([]);

    // The sweep reads the real list: a slot naming a panel the app doesn't ship is bad input.
    const evidence = evidenceDir();
    const bogus = answerOf(runRaw(show(), scenario({ evidence, panels: { p: { rect: SLOTS[0]!, shipped: 'deepbuild/not-a-shipped-panel' } } }, [gate(MS, 'p')])), 'a slot naming a panel the app does not ship');
    expect(bogus, 'a slot naming a panel the app does not ship is refused as bad input').toEqual({ ok: false, code: 'bad_input' });

    // Wrong program: a gate that trusts a shipped panel, so its own request sounds with no gesture.
    const twin = ids.flatMap((id) => sweep(id, 'shipped_panels_ungated'));
    for (const id of ids) {
      expect(twin.some((m) => m.startsWith(`${id}:`) && /before you pressed Play/.test(m)), `the planted shipped_panels_ungated fails, naming ${id}: ${JSON.stringify(twin.slice(0, 6))}`).toBe(true);
    }
  }, 1_800_000);
});
