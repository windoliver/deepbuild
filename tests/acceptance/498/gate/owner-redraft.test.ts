// C9, blind redraft: a panel playing strips stops every voice within one audio block when it closes or opens another
// document, and pressing Play again is needed before any sound; a planted gate that keeps the previous document's
// voices after the switch fails, naming the panel. Drafted afresh from issue #498, the design and the README's surface;
// at the base `deep-show run` has no `open`, `close`, `play`, `gate` or `output` call and answers `bad_input`.
//
// The plain panel `player` opens doc-a: three voices on three tracks, each a pure tone at its own frequency (440 Hz on
// track 0 from 0, 550 Hz on track 1 from 0.25 s, both 6 s long; 300 Hz on track 2, a 0.4 s asset looping). Your press
// at 1 s plays it. The cut (the switch to doc-b, 660 Hz, or the close) falls at flick 120,141 × 14,700: sample 120,141
// on a 48 kHz clock, 77 samples into block 938, so a gate that stops only at a block boundary still has to stop within
// 128 samples. On whatever rate the device runs, the cut's sample is the first at or after it, and every sample from
// that one + 128 until your next press at 4 s must be silence.
//
// Why a correct player passes the signals read here:
// - The 300 Hz asset is 120 whole periods (160 samples each at 48 kHz) over its whole length, so its loop is seamless
//   and needs no edge fade; all three strips play their sources from their own start, so none needs the 5 ms edit fade.
// - The "playing before the cut" window is 80 ms ending 20 ms before the cut, so it is clear of the block in which a
//   gate may begin its stop, and in transport time (from 1.0 s, the press, or 1.06 s, the Play call, with up to 0.1 s
//   of latency) it lies within 1.24 to 1.49 s: past three wraps of the loop (so 300 Hz there proves it loops) and clear
//   of the wraps at 1.2 and 1.6 s. The windows after the new press are placed the same way (switch: 4.30 to 4.38 s,
//   transport 0.14 to 0.38 s; close: 4.62 to 4.70 s, transport 0.46 to 0.70 s, between the wraps at 0.4 and 0.8 s and
//   after the 550 Hz strip's start at 0.25 s).
// - A tone is present at 0.04 or more and absent under 0.01 (Hann-windowed single-bin amplitude). Each voice is 0.2
//   in its asset: a centre pan's −3 dB still reads about 0.14, three voices sum under the −1 dBTP ceiling, and the
//   tones are 110 Hz or more apart, nine bins of an 80 ms window, so one leaks into another's bin by well under 0.001.
// - Silence is the README's (−120 dBFS): a faithful player's stopped output is exact zero.
import { describe, expect, it } from 'vitest';
import {
  ALPHA, CLICK_UP, Driver, SEC, SLOTS, close, click, firstSound, gate, gateOf, open, opened, output, outputOf, play,
  playing, refusal, sAt, sampleAt, secs, serialOf, soundCount, toneAsset, toneIn, useEvidence, useShow,
  type Heard, type JsonObject, type Planted, type Strip,
} from './helpers.ts';

const show = useShow();
const evidence = useEvidence();

const PANEL = 'player';
const SLOT = SLOTS[0]!;
const BLOCK = 128;

const OPEN_A = secs(0.001);
const PRESS_1 = secs(1);
/** The cut: sample 120,141 on a 48 kHz clock (14,700 flicks a sample), 77 samples into block 938. */
const CUT = 120_141 * 14_700;
const PRESS_2 = secs(4);
const END = secs(5);

const VOICES_A = [
  { hz: 440, name: '440 Hz on track 0' },
  { hz: 550, name: '550 Hz on track 1' },
  { hz: 300, name: '300 Hz looping on track 2' },
] as const;
const HZ_B = 660;
const PRESENT = 0.04;
const ABSENT = 0.01;

function docA(ev: string): Strip[] {
  return [
    { track: 0, asset: toneAsset(ev, 440, 6), start: 0, in: 0, out: secs(6) },
    { track: 1, asset: toneAsset(ev, 550, 6), start: secs(0.25), in: 0, out: secs(6) },
    { track: 2, asset: toneAsset(ev, 300, 0.4), start: 0, in: 0, out: secs(0.4), loop: true },
  ];
}
const docB = (ev: string): Strip[] => [{ track: 0, asset: toneAsset(ev, HZ_B, 3), start: 0, in: 0, out: secs(3) }];

const t = (flicks: number): string => `${(flicks / SEC).toFixed(3)} s`;
const amp = (a: number): string => a.toFixed(4);

/** An 80 ms window from flick `from`, as samples on the device clock. */
const win = (h: Heard, from: number): [number, number] => [sampleAt(h, from), Math.round(0.08 * h.sampleRate)];

type Kind = 'switch' | 'close';
const AFTER: Record<Kind, string> = { switch: 'after it opened another document', close: 'after it closed' };

/** One world: doc-a playing from your press, then the cut, three refused requests, and your new press. Returns the
 * criterion's failures, each naming the panel. */
function owner(kind: Kind, planted?: Planted): string[] {
  const ev = evidence();
  const what = `C9 ${kind}${planted ? ` (planted ${planted})` : ''}`;
  const d = new Driver(show(), { evidence: ev, panels: { [PANEL]: { rect: SLOT } }, ...(planted ? { planted } : {}) });
  const f: string[] = [];
  const p = `panel ${PANEL}`;

  // Step 1: doc-a opens, and you click in the panel.
  const r1 = d.step([open(OPEN_A, PANEL, 'doc-a', docA(ev)), ...click(PRESS_1, PANEL, SLOT)], `${what}: doc-a and your press`);
  if (!opened(r1[0], `${what}: open doc-a`)) f.push(`${p}: doc-a did not open at ${t(OPEN_A)}: ${JSON.stringify(r1[0])}`);
  const serial1 = serialOf(r1[1], `${what}: your press at ${t(PRESS_1)}`);

  // Step 2: Play with that press; the cut; the panel's own request, your earlier serial and an agent; your new click.
  const PLAY_1 = PRESS_1 + CLICK_UP;
  const G_RUN = secs(1.5);
  const asks = kind === 'switch'
    ? { own: secs(3.0), old: secs(3.2), agent: secs(3.4), gate: secs(3.6) }
    : { own: secs(3.2), old: secs(3.4), agent: secs(3.6), gate: secs(3.8) };
  const REOPEN = secs(3.0);
  const closedOld = secs(2.8);
  const closedGate = secs(2.9);
  const calls: JsonObject[] = [play(PLAY_1, PANEL, { serial: serial1 }), gate(G_RUN, PANEL)];
  if (kind === 'switch') calls.push(open(CUT, PANEL, 'doc-b', docB(ev)));
  else calls.push(close(CUT, PANEL), play(closedOld, PANEL, { serial: serial1 }), gate(closedGate, PANEL), open(REOPEN, PANEL, 'doc-a', docA(ev)));
  const iAsks = calls.length;
  calls.push(play(asks.own, PANEL), play(asks.old, PANEL, { serial: serial1 }), play(asks.agent, PANEL, { session: ALPHA.id }), gate(asks.gate, PANEL));
  const iClick = calls.length;
  calls.push(...click(PRESS_2, PANEL, SLOT));
  const r2 = d.step(calls, `${what}: Play, the cut and the refused requests`);

  if (!playing(r2[0], `${what}: Play with your press`)) f.push(`${p}: Play with your press's serial at ${t(PLAY_1)} did not play doc-a: ${JSON.stringify(r2[0])}`);
  const g1 = gateOf(r2[1], `${what}: the gate while doc-a plays`);
  if (g1.owner !== PANEL || g1.state !== 'running' || g1.granted_by !== serial1) {
    f.push(`${p}: its gate at ${t(G_RUN)} is ${JSON.stringify(g1)}, not owned by ${PANEL}, running, granted by your press's serial ${serial1}`);
  }
  if (kind === 'switch') {
    if (!opened(r2[2], `${what}: open doc-b`)) f.push(`${p}: doc-b did not open at the cut: ${JSON.stringify(r2[2])}`);
  } else {
    if (refusal(r2[3], `${what}: Play on the closed panel`) === null) f.push(`${p}: Play with your earlier serial at ${t(closedOld)} on the closed panel was not refused: ${JSON.stringify(r2[3])}`);
    const gc = gateOf(r2[4], `${what}: the closed panel's gate`);
    if (gc.state !== 'suspended' || gc.granted_by !== null) f.push(`${p}: its gate at ${t(closedGate)}, closed, is ${JSON.stringify(gc)}, not suspended with no grant`);
    if (!opened(r2[5], `${what}: doc-a opened again`)) f.push(`${p}: doc-a did not open again at ${t(REOPEN)}: ${JSON.stringify(r2[5])}`);
  }
  const askers = [
    { at: asks.own, who: 'its own request to play (no serial)' },
    { at: asks.old, who: `Play with your earlier serial ${serial1}, given ${AFTER[kind].replace('after', 'before')}` },
    { at: asks.agent, who: `${ALPHA.id}'s agent's request to play` },
  ];
  askers.forEach((a, k) => {
    const reply = r2[iAsks + k];
    if (refusal(reply, `${what}: ${a.who}`) === null) f.push(`${p}: ${a.who} at ${t(a.at)} was not refused: ${JSON.stringify(reply)}`);
  });
  const g2 = gateOf(r2[iAsks + 3], `${what}: the gate after the cut`);
  if (g2.owner !== PANEL || g2.state !== 'suspended' || g2.granted_by !== null) {
    f.push(`${p}: its gate at ${t(asks.gate)}, ${AFTER[kind]}, is ${JSON.stringify(g2)}, not owned by ${PANEL}, suspended, granted_by null`);
  }
  const serial2 = serialOf(r2[iClick], `${what}: your new press at ${t(PRESS_2)}`);

  // Step 3: Play with the new press, the gate, and what reached the device.
  const PLAY_2 = PRESS_2 + CLICK_UP;
  const G_NEW = secs(4.5);
  const r3 = d.step([play(PLAY_2, PANEL, { serial: serial2 }), gate(G_NEW, PANEL), output(0, END)], `${what}: your new press of Play`);
  if (!playing(r3[0], `${what}: Play with your new press`)) f.push(`${p}: Play with your new press's serial at ${t(PLAY_2)} did not play: ${JSON.stringify(r3[0])}`);
  const g3 = gateOf(r3[1], `${what}: the gate after the new press`);
  if (g3.owner !== PANEL || g3.state !== 'running' || g3.granted_by !== serial2) {
    f.push(`${p}: its gate at ${t(G_NEW)} is ${JSON.stringify(g3)}, not owned by ${PANEL}, running, granted by your new press's serial ${serial2}`);
  }
  const h = outputOf(r3[2], ev, 0, END, `${what}: output`);
  const cutS = sampleAt(h, CUT);
  const pressS = sampleAt(h, PRESS_2);

  // Before the cut: every voice of doc-a sounds, the looping one past its asset's end, up to a block of the cut.
  const [w1, n1] = win(h, CUT - secs(0.1));
  for (const v of VOICES_A) {
    const a = toneIn(h, v.hz, w1, n1);
    if (a < PRESENT) f.push(`${p}: doc-a's voice ${v.name} reads ${amp(a)} over samples ${w1}–${w1 + n1} (${sAt(h, w1)}), before the cut, under ${PRESENT}: the panel was not playing its strips`);
  }
  const lead = 1024;
  const heard = soundCount(h, cutS - lead, cutS - BLOCK);
  if (heard < 0.98 * (lead - BLOCK)) f.push(`${p}: only ${heard} of the ${lead - BLOCK} samples from ${cutS - lead} to ${cutS - BLOCK}, just before the cut, carry sound`);

  // From the cut's sample + 128 until your new press: silence.
  const loud = firstSound(h, cutS + BLOCK, pressS);
  if (loud !== null) {
    f.push(`${p}: sound reached the device at sample ${loud} (${sAt(h, loud)}), ${loud - cutS} samples ${AFTER[kind]} at sample ${cutS}; every sample from ${cutS + BLOCK} until your new press at sample ${pressS} must be silence (${soundCount(h, cutS + BLOCK, pressS)} samples sound)`);
  }

  // After your new press: what it plays.
  if (kind === 'switch') {
    const [w2, n2] = win(h, secs(4.3));
    const b = toneIn(h, HZ_B, w2, n2);
    if (b < PRESENT) f.push(`${p}: doc-b's 660 Hz reads ${amp(b)} over samples ${w2}–${w2 + n2} (${sAt(h, w2)}) after your new press, under ${PRESENT}`);
    for (const v of VOICES_A) {
      const a = toneIn(h, v.hz, w2, n2);
      if (a >= ABSENT) f.push(`${p}: doc-a's voice ${v.name} still sounds (${amp(a)}) over samples ${w2}–${w2 + n2} (${sAt(h, w2)}), after your new press played doc-b`);
    }
  } else {
    const [w3, n3] = win(h, secs(4.62));
    for (const v of VOICES_A) {
      const a = toneIn(h, v.hz, w3, n3);
      if (a < PRESENT) f.push(`${p}: doc-a's voice ${v.name} reads ${amp(a)} over samples ${w3}–${w3 + n3} (${sAt(h, w3)}) after your new press, under ${PRESENT}`);
    }
  }
  return f;
}

describe('C9 sound stops with its owner, and playing again needs your new press', () => {
  it('C9 switch: opening doc-b in a panel playing doc-a\'s three voices silences them within one block, and only your new press of Play plays doc-b', () => {
    expect(owner('switch'), 'the switch').toEqual([]);
    // Wrong program: opening another document leaves the previous document's voices playing.
    const twin = owner('switch', 'keeps_voices_on_switch');
    expect(twin.some((m) => m.startsWith(`panel ${PANEL}: sound reached the device`) && m.includes(AFTER.switch)), `the planted keeps_voices_on_switch fails, naming panel ${PANEL}: ${JSON.stringify(twin.slice(0, 4))}`).toBe(true);
  }, 3_600_000);

  it('C9 close: closing a panel playing doc-a\'s three voices silences them within one block, and only your new press of Play plays it again', () => {
    expect(owner('close'), 'the close').toEqual([]);
    // Wrong program: closing a panel fades its voices out over 5 ms, longer than a block.
    const twin = owner('close', 'fades_on_close');
    expect(twin.some((m) => m.startsWith(`panel ${PANEL}: sound reached the device`) && m.includes(AFTER.close)), `the planted fades_on_close fails, naming panel ${PANEL}: ${JSON.stringify(twin.slice(0, 4))}`).toBe(true);
  }, 3_600_000);
});
