// Criterion 9: a panel playing strips stops every voice within one audio block when it closes or opens another
// document, and pressing Play again is needed before any sound; a planted gate that keeps the previous document's voices
// after the switch fails, naming the panel. One audio block is 128 samples (Sound and video on the picture's clock:
// Blocks), measured on the device's own sample clock: every sample from the switch's (or close's) sample plus 128 on is
// silence. The first document plays three voices (440 and 550 Hz from two tracks, 330 Hz looping on a third), the next
// one a 660 Hz voice, so what plays after the new Play is read by its pitch. Also held: the Device gate's `granted_by`
// (your gesture's serial) and `state`, and "can't be granted by an agent". Through `deep-show run` (README: The surface
// under test). At the base `deep-show` has no `open`, `close`, `play`, `gate` or `output` call and answers every
// scenario here `bad_input`.
import { describe, expect, it } from 'vitest';
import {
  ALPHA, CLICK_UP, Driver, FLICKS, MS, SEC, SLOTS, click, close, firstSound, gate, gateOf, lastSound, open, output, outputOf,
  play, playing, refusal, sAt, sampleAt, serialOf, soundCount, toneAsset, toneIn, useEvidence, useShow, type Heard, type JsonObject,
  type Planted, type Strip,
} from './helpers.ts';

const show = useShow();
const evidenceDir = useEvidence();

const PANEL = 'player';
const BLOCK = 128;
const A_HZ = [440, 550, 330] as const;
const B_HZ = 660;
const OPEN = 1 * MS;
const PRESS1 = 1 * SEC;
/** Mid-block on a 48 kHz device clock: sample 96,077 is 77 samples into block 750 (each sample is 14,700 flicks). */
const CUT = 96_077 * (FLICKS / 48_000);
const PRESS2 = 4 * SEC;
const END = 5 * SEC;

function documents(evidence: string): { a: Strip[]; b: Strip[] } {
  const [a440, a550, a330] = [toneAsset(evidence, A_HZ[0], 10), toneAsset(evidence, A_HZ[1], 10), toneAsset(evidence, A_HZ[2], 0.25)];
  return {
    a: [
      { track: 0, asset: a440, start: 0, in: 0, out: 10 * SEC },
      { track: 1, asset: a550, start: 500 * MS, in: 0, out: 10 * SEC },
      { track: 2, asset: a330, start: 0, in: 0, out: 250 * MS, loop: true },
    ],
    b: [{ track: 0, asset: toneAsset(evidence, B_HZ, 10), start: 0, in: 0, out: 10 * SEC }],
  };
}

/** Every first-document voice sounds in the window before the cut: the panel was playing strips. */
function playedBefore(h: Heard, f: string[]): void {
  const from = sampleAt(h, PRESS1 + 700 * MS);
  for (const hz of A_HZ) {
    const a = toneIn(h, hz, from, 9600);
    if (a < 0.05) f.push(`before the cut the panel ${PANEL}'s ${hz} Hz voice reads amplitude ${a.toFixed(4)}: it wasn't playing`);
  }
  const cut = sampleAt(h, CUT);
  if (lastSound(h, cut - 1024, cut) === null) f.push(`the panel ${PANEL} was silent in the 1,024 samples before the cut`);
}

/** Silence from one block after the cut until your next press of Play, naming the panel. */
function stopped(h: Heard, f: string[], how: string): void {
  const cut = sampleAt(h, CUT);
  const pressed = sampleAt(h, PRESS2);
  const left = lastSound(h, cut + BLOCK, pressed);
  if (left !== null) {
    f.push(`the panel ${PANEL}'s voices still sound ${left - cut} samples after it ${how} (the last at ${sAt(h, left)}, sample ${left}; ${soundCount(h, cut + BLOCK, pressed)} samples above silence past one block of ${BLOCK})`);
  }
}

/** After your new press of Play only the document now open sounds. */
function onlyNow(h: Heard, f: string[], hz: readonly number[], gone: readonly number[]): void {
  const pressed = sampleAt(h, PRESS2);
  if (firstSound(h, pressed, sampleAt(h, END)) === null) { f.push(`after your new press of Play the panel ${PANEL} stayed silent`); return; }
  const from = sampleAt(h, PRESS2 + 600 * MS);
  for (const x of hz) if (toneIn(h, x, from, 9600) < 0.05) f.push(`after your new press of Play the panel ${PANEL}'s ${x} Hz voice isn't playing`);
  for (const x of gone) {
    const a = toneIn(h, x, from, 9600);
    if (a > 0.01) f.push(`after your new press of Play the panel ${PANEL} still plays the earlier document's ${x} Hz voice (amplitude ${a.toFixed(4)})`);
  }
}

/** Requests after the cut that aren't a new press: refused, and the gate suspended with no grant. */
function needsNewPress(r: JsonObject[], g: number, idx: { own: number; old: number; agent: number }, oldSerial: number, f: string[], how: string): void {
  for (const [k, who] of [[idx.own, 'the panel\'s own request to play'], [idx.old, `Play with the serial ${oldSerial} of your press before it ${how}`], [idx.agent, `${ALPHA.id}'s agent's request to play`]] as const) {
    if (refusal(r[k], `${who} after it ${how}`) === null) f.push(`the panel ${PANEL}: ${who} after it ${how} was answered ${JSON.stringify(r[k])}, not refused`);
  }
  const gt = gateOf(r[g], `the gate after it ${how}`);
  if (gt.state !== 'suspended') f.push(`the panel ${PANEL}'s gate after it ${how} is ${gt.state}, not suspended`);
  if (gt.granted_by !== null) f.push(`the panel ${PANEL}'s gate after it ${how} is still granted by serial ${gt.granted_by}`);
}

describe('criterion 9: sound stops with its owner', () => {
  it('C9 a panel playing three strips that opens another document mid-block is silent from one audio block after the switch until you press Play again; its own request, your earlier press and an agent don\'t restart it, and the new Play plays only the new document; a gate that keeps the previous document\'s voices fails, naming the panel', () => {
    function run(planted?: Planted): string[] {
      const evidence = evidenceDir();
      const tag = `the switch${planted ? ` (planted ${planted})` : ''}`;
      const docs = documents(evidence);
      const d = new Driver(show(), { evidence, panels: { [PANEL]: { rect: SLOTS[0]! } }, ...(planted ? { planted } : {}) });
      const r1 = d.step([open(OPEN, PANEL, 'doc-a', docs.a), ...click(PRESS1, PANEL, SLOTS[0]!), open(CUT, PANEL, 'doc-b', docs.b), ...click(PRESS2, PANEL, SLOTS[0]!)], `${tag}: documents and clicks`);
      const f: string[] = [];
      if (r1[0]!['opened'] !== true) f.push(`doc-a didn't open in ${PANEL}: ${JSON.stringify(r1[0])}`);
      if (r1[3]!['opened'] !== true) f.push(`doc-b didn't open in ${PANEL}: ${JSON.stringify(r1[3])}`);
      const s1 = serialOf(r1[1], `${tag}: your first press`);
      const s2 = serialOf(r1[4], `${tag}: your new press`);
      const r = d.step([
        play(PRESS1 + CLICK_UP, PANEL, { serial: s1 }),
        gate(1500 * MS, PANEL),
        play(2600 * MS, PANEL),
        play(2700 * MS, PANEL, { serial: s1 }),
        play(2800 * MS, PANEL, { session: ALPHA.id }),
        gate(2900 * MS, PANEL),
        play(PRESS2 + CLICK_UP, PANEL, { serial: s2 }),
        gate(PRESS2 + 200 * MS, PANEL),
        output(0, END),
      ], `${tag}: played, switched, played again`);
      if (!playing(r[0], `${tag}: your first press of Play`)) f.push(`the panel ${PANEL}: your first press of Play was answered ${JSON.stringify(r[0])}, not playing`);
      const g1 = gateOf(r[1], `${tag}: the gate while doc-a plays`);
      if (g1.owner !== PANEL || g1.state !== 'running' || g1.granted_by !== s1) f.push(`the panel ${PANEL}'s gate while doc-a plays is ${JSON.stringify(g1)}, not owned by ${PANEL}, running, granted by ${s1}`);
      needsNewPress(r, 5, { own: 2, old: 3, agent: 4 }, s1, f, 'opened another document');
      if (!playing(r[6], `${tag}: your new press of Play`)) f.push(`the panel ${PANEL}: your new press of Play was answered ${JSON.stringify(r[6])}, not playing`);
      const g2 = gateOf(r[7], `${tag}: the gate after your new press`);
      if (g2.state !== 'running' || g2.granted_by !== s2) f.push(`the panel ${PANEL}'s gate after your new press is ${JSON.stringify(g2)}, not running and granted by ${s2}`);
      const h = outputOf(r[8], evidence, 0, END, `${tag}: the device's output`);
      if (firstSound(h, 0, sampleAt(h, PRESS1)) !== null) f.push(`the panel ${PANEL} sounded before your first press of Play`);
      playedBefore(h, f);
      stopped(h, f, 'opened another document');
      onlyNow(h, f, [B_HZ], A_HZ);
      return f;
    }
    expect(run(), 'every voice stops within one block of the switch, and only a new press plays again').toEqual([]);
    // Wrong program: a gate that keeps the previous document's voices after the switch.
    const twin = run('keeps_voices_on_switch');
    expect(twin.some((m) => m.includes(`panel ${PANEL}`) && /after it opened another document/.test(m) && /still sound/.test(m)), `the planted keeps_voices_on_switch fails, naming the panel ${PANEL}: ${JSON.stringify(twin.slice(0, 6))}`).toBe(true);
  }, 1_800_000);

  it('C9 a panel playing three strips that closes mid-block is silent from one audio block after the close; reopened, it stays silent through its own request, your earlier press and an agent until you press Play again; a gate that fades its voices out over 5 ms on close fails, naming the panel', () => {
    function run(planted?: Planted): string[] {
      const evidence = evidenceDir();
      const tag = `the close${planted ? ` (planted ${planted})` : ''}`;
      const docs = documents(evidence);
      const d = new Driver(show(), { evidence, panels: { [PANEL]: { rect: SLOTS[0]! } }, ...(planted ? { planted } : {}) });
      const r1 = d.step([open(OPEN, PANEL, 'doc-a', docs.a), ...click(PRESS1, PANEL, SLOTS[0]!), close(CUT, PANEL), open(3 * SEC, PANEL, 'doc-a', docs.a), ...click(PRESS2, PANEL, SLOTS[0]!)], `${tag}: documents and clicks`);
      const f: string[] = [];
      if (r1[0]!['opened'] !== true) f.push(`doc-a didn't open in ${PANEL}: ${JSON.stringify(r1[0])}`);
      if (r1[4]!['opened'] !== true) f.push(`doc-a didn't open again in ${PANEL} after the close: ${JSON.stringify(r1[4])}`);
      const s1 = serialOf(r1[1], `${tag}: your first press`);
      const s2 = serialOf(r1[5], `${tag}: your new press`);
      const r = d.step([
        play(PRESS1 + CLICK_UP, PANEL, { serial: s1 }),
        play(2500 * MS, PANEL, { serial: s1 }),
        gate(2600 * MS, PANEL),
        play(3200 * MS, PANEL),
        play(3300 * MS, PANEL, { serial: s1 }),
        play(3400 * MS, PANEL, { session: ALPHA.id }),
        gate(3500 * MS, PANEL),
        play(PRESS2 + CLICK_UP, PANEL, { serial: s2 }),
        output(0, END),
      ], `${tag}: played, closed, reopened, played again`);
      if (!playing(r[0], `${tag}: your first press of Play`)) f.push(`the panel ${PANEL}: your first press of Play was answered ${JSON.stringify(r[0])}, not playing`);
      if (refusal(r[1], `${tag}: Play on the closed panel`) === null) f.push(`the panel ${PANEL}: Play with your earlier serial on the closed panel was answered ${JSON.stringify(r[1])}, not refused`);
      const gc = gateOf(r[2], `${tag}: the gate of the closed panel`);
      if (gc.state !== 'suspended' || gc.granted_by !== null) f.push(`the panel ${PANEL}'s gate once closed is ${JSON.stringify(gc)}, not suspended with no grant`);
      needsNewPress(r, 6, { own: 3, old: 4, agent: 5 }, s1, f, 'closed and opened again');
      if (!playing(r[7], `${tag}: your new press of Play`)) f.push(`the panel ${PANEL}: your new press of Play was answered ${JSON.stringify(r[7])}, not playing`);
      const h = outputOf(r[8], evidence, 0, END, `${tag}: the device's output`);
      playedBefore(h, f);
      stopped(h, f, 'closed');
      onlyNow(h, f, A_HZ.slice(0, 1), [B_HZ]);
      return f;
    }
    expect(run(), 'every voice stops within one block of the close, and only a new press plays again').toEqual([]);
    // Wrong program: a close that fades every voice out over 5 ms (240 samples at 48 kHz), longer than a block.
    const twin = run('fades_on_close');
    expect(twin.some((m) => m.includes(`panel ${PANEL}`) && /still sound \d+ samples after it closed/.test(m)), `the planted fades_on_close fails, naming the panel ${PANEL}: ${JSON.stringify(twin.slice(0, 6))}`).toBe(true);
  }, 1_800_000);
});
