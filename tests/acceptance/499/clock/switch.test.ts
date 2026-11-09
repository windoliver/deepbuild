// Criterion 11 (#499.29cef631): a 60 Hz fixture game plays a looping strip through a test audio backend, and at
// t = 5.000 s the default output switches and the old device is removed: sound resumes on the new device within 500 ms,
// t never moves back and never jumps by more than one step (16.7 ms), exactly 600 logic steps run in the 10 s, and the
// full-state hash at step 600 equals a headless run's; a planted backend that keeps the removed device stays silent and
// fails, naming the device, and a planted clock that restarts t from the new device's sample 0 moves t back and fails,
// naming the frame.
//
// Through `deep-show run` with the test audio backend (README: The surface under test); the headless run is
// `deep-logic bake` (#531) on the same piece. At the base `deep-show` has no `audio` backend, no `transport`,
// `audio_device` or `full_state` call, and answers these scenarios `bad_input`.
import { describe, expect, it } from 'vitest';
import {
  CLICK_UP, Driver, MS, SEC, STEP, answersOf, arr, audioDevice, click, firstAtOrAfter, firstSound, frameName, fullState,
  fullStateOf, gate, gateOf, heardAt, loopAsset, num, obj, open, opened, output, outputOf, play, playing, runRaw, s,
  serialOf, str, transport, transportOf, useBin, useEvidence, type Planted, type TestDevice,
} from './helpers.ts';
import { GAME, gamePiece } from './program.ts';

const show = useBin('deep-show');
const logic = useBin('deep-logic');
const evidenceDir = useEvidence();

const SPEAKERS: TestDevice = { id: 'speakers', rate: 48_000, ppm: 0, buffer: 512, latency: 480, jitter: MS / 2, seed: 3 };
const HEADPHONES: TestDevice = { id: 'headphones', rate: 48_000, ppm: 0, buffer: 256, latency: 960, jitter: MS / 2, seed: 4 };
const PRESS = 1 * SEC;
const PLAY = PRESS + CLICK_UP;
const SWITCH_T = 5 * SEC;
const TEN = 10 * SEC;
const AT_STEP = 600;
const RUNS = `${GAME}.runs`;

/** The game played live with the switch at t = 5 s; its failures and the full-state hash it reached at step 600. */
function live(planted?: Planted): { f: string[]; deep: string | null } {
  const evidence = evidenceDir();
  const tag = `the live game${planted ? ` (planted ${planted})` : ''}`;
  const asset = loopAsset(evidence);
  const d = new Driver(show(), { evidence, devices: [SPEAKERS, HEADPHONES], default: SPEAKERS.id, ...(planted ? { planted } : {}) });
  const f: string[] = [];
  const r1 = d.step([open(MS, 'game', [{ track: 0, asset, start: 0, in: 0, out: SEC, loop: true }], gamePiece()), ...click(PRESS)], `${tag}: the game and your click`);
  if (!opened(r1[0])) f.push(`${tag}: the game didn't open: ${JSON.stringify(r1[0])}`);
  const serial = serialOf(r1[1], `${tag}: your click`);

  // Where t = 5.000 s falls on host time, read from the play's first second.
  const r2 = d.step([play(PLAY, serial), transport(0, 2 * SEC)], `${tag}: the play's first second`);
  if (!playing(r2[0])) f.push(`${tag}: your press of Play was answered ${JSON.stringify(r2[0])}, not playing`);
  const early = transportOf(r2[1], `${tag}: the transport to 2 s`).frames;
  if (early.length === 0) { f.push(`${tag}: no frame by host 2 s`); return { f, deep: null }; }
  const last = early[early.length - 1]!;
  const S = Math.round(last.at + (SWITCH_T - last.t));
  const END = S + 6 * SEC;

  const r = d.step([
    audioDevice(S, { default: HEADPHONES.id, remove: SPEAKERS.id }),
    output(SPEAKERS.id, S - SEC, S),
    output(HEADPHONES.id, PLAY, S + SEC),
    gate(S + SEC),
    transport(0, END),
    fullState(END, GAME, AT_STEP),
  ], `${tag}: the switch at t = 5 s`);

  // Sound: on the speakers before the switch, then on the headphones within 500 ms of it.
  const spk = outputOf(r[1], evidence, SPEAKERS, 0, S - SEC, S, `${tag}: the speakers`);
  if (firstSound(spk) === null) f.push(`${tag}: the looping strip wasn't sounding on \`${SPEAKERS.id}\` in the second before the switch`);
  const hp = outputOf(r[2], evidence, HEADPHONES, 0, PLAY, S + SEC, `${tag}: the headphones`);
  const at = firstAtOrAfter(HEADPHONES, 0, S);
  const before = firstSound(hp, hp.first, at);
  if (before !== null) f.push(`${tag}: \`${HEADPHONES.id}\` sounded at host ${s(heardAt(hp, before))}, before it became the default output at ${s(S)}`);
  const back = firstSound(hp, at);
  const backAt = back === null ? null : heardAt(hp, back);
  if (backAt === null || backAt > S + 500 * MS) {
    f.push(`${tag}: sound did not resume on the new default output \`${HEADPHONES.id}\` within 500 ms of the switch at t = 5.000 s (host ${s(S)}): ${backAt === null ? `none by ${s(S + SEC)}` : `its first sound plays at host ${s(backAt)}, ${((backAt - S) / MS).toFixed(1)} ms after`}; the removed device was \`${SPEAKERS.id}\``);
  }
  const g = gateOf(r[3], `${tag}: the gate 1 s after the switch`);
  if (g.state !== 'running' || g.granted_by !== serial) f.push(`${tag}: 1 s after the switch the gate is ${g.state}, granted by ${JSON.stringify(g.granted_by)}, not running on your press's serial ${serial} (no new gesture was made)`);

  // t: never back, never more than one step at a time.
  const { frames, steps } = transportOf(r[4], `${tag}: the transport`);
  let back1: string | null = null;
  let jump: string | null = null;
  for (let i = 1; i < frames.length; i++) {
    const dt = frames[i]!.t - frames[i - 1]!.t;
    if (dt < 0 && back1 === null) back1 = `${tag}: t moves back at ${frameName(i, frames[i]!)}: from ${s(frames[i - 1]!.t)} to ${s(frames[i]!.t)}`;
    if (dt > STEP && jump === null) jump = `${tag}: t jumps by ${((dt) / MS).toFixed(3)} ms at ${frameName(i, frames[i]!)}, more than one step (16.7 ms): from ${s(frames[i - 1]!.t)} to ${s(frames[i]!.t)}`;
  }
  if (back1 !== null) f.push(back1);
  if (jump !== null) f.push(jump);
  if (!frames.some((fr) => fr.t >= TEN)) f.push(`${tag}: t never reached 10 s by host ${s(END)}`);

  // Exactly steps 0 to 599, each once and in order, run by frames before t reached 10 s.
  const tAt = new Map(frames.map((fr) => [fr.at, fr.t]));
  const game = steps.filter((st) => st.item === GAME);
  const stray = game.find((st) => !tAt.has(st.at));
  if (stray !== undefined) f.push(`${tag}: step ${stray.step} ran at host ${s(stray.at)}, which is no vsync in the transport log`);
  const ran = game.filter((st) => (tAt.get(st.at) ?? Infinity) < TEN).map((st) => st.step);
  const wrong = ran.findIndex((k, i) => k !== i);
  if (ran.length !== AT_STEP || wrong !== -1) {
    f.push(`${tag}: ${ran.length} logic steps ran in the 10 s, not exactly ${AT_STEP} (steps 0 to 599 once each, in order)${wrong === -1 ? '' : `; the ${wrong}th step run was step ${ran[wrong]}`}`);
  }

  // The full state at step 600.
  const full = fullStateOf(r[5], `${tag}: the game's full state at step ${AT_STEP}`);
  if ('code' in full) { f.push(`${tag}: the game's full state at step ${AT_STEP} was answered \`${full.code}\``); return { f, deep: null }; }
  const runs = JSON.stringify(full.arrays[RUNS]);
  if (runs !== JSON.stringify([AT_STEP])) f.push(`${tag}: at step ${AT_STEP} the game's own count of its steps, ${RUNS}, is ${runs}, not [${AT_STEP}]`);
  return { f, deep: full.deep_hash };
}

/** The headless run: deep-logic's bake of the same piece, steps 0 to 599; the full-state hash at step 600. */
function headless(): string {
  const [bake] = answersOf(runRaw(logic(), [], [{ call: 'bake', piece: gamePiece(), steps: AT_STEP }]), 1, 'the headless run: deep-logic bake');
  expect(bake!['ok'], `the headless run bakes the game: ${JSON.stringify(bake).slice(0, 600)}`).toBe(true);
  const records = arr(bake!['steps'], 'the headless run: steps');
  const lastStep = obj(records.map((v, i) => obj(v, `steps[${i}]`)).find((rec) => num(rec['step'], 'step') === AT_STEP - 1), 'the headless run: step 599');
  expect(JSON.stringify(obj(lastStep['arrays'], 'the headless run: step 599 arrays')[RUNS]), `the headless run's ${RUNS} after step 599`).toBe(JSON.stringify([AT_STEP]));
  const cps = arr(obj(bake!['checkpoints'], 'the headless run: checkpoints')[GAME], `the headless run: checkpoints.${GAME}`).map((v, i) => obj(v, `checkpoints[${i}]`));
  const at = cps.find((c) => num(c['step'], 'checkpoint step') === AT_STEP);
  return str(obj(at, `the headless run's checkpoint at step ${AT_STEP}`)['deep_hash'], 'deep_hash');
}

describe('criterion 11: a game playing through a device switch keeps its clock and its steps', () => {
  it('#499.29cef631 a 60 Hz game with a looping strip on speakers, switched to headphones and the speakers removed at t = 5 s: sound resumes on the headphones within 500 ms under your first grant, t never moves back nor jumps more than 16.7 ms, steps 0 to 599 run once each before t reaches 10 s and the full-state hash at step 600 is the headless run\'s; a backend that keeps the removed device fails naming the headphones, and a clock that restarts t from the new device\'s sample 0 fails naming the frame', () => {
    const want = headless();
    const clean = live();
    const f = [...clean.f];
    if (clean.deep !== null && clean.deep !== want) f.push(`the full-state hash at step ${AT_STEP} live is ${clean.deep}; the headless run's is ${want}`);
    expect(f, 'the game plays through the switch as it would headless').toEqual([]);

    const kept = live('backend_keeps_removed_device').f;
    expect(kept.some((m) => /sound did not resume on the new default output `headphones`/.test(m)), `the planted backend_keeps_removed_device fails, naming the device: ${JSON.stringify(kept.slice(0, 4))}`).toBe(true);

    const restart = live('clock_restarts_from_sample_0').f;
    expect(restart.some((m) => /t moves back at frame \d+ \(vsync at host [\d.]+ s\)/.test(m)), `the planted clock_restarts_from_sample_0 fails, naming the frame: ${JSON.stringify(restart.slice(0, 4))}`).toBe(true);
  }, 3_600_000);
});
