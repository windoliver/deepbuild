// Criterion 1 (#499.85ea1101): while audio plays, the transport follows the audio clock within one audio block over a
// 10-minute play, t stays monotonic and continuous when a strip starts at 3 s and the master passes from the display to
// the audio device, and a device change sets an interrupted state with a notice instead of drifting.
//
// Through `deep-show run` with the test audio backend (README: The surface under test). The truth is each test device's
// own sample clock, which runs 100 ppm off host time, so following the display instead of the device drifts by more
// than a block within 27 s. At the base `deep-show` has no `audio` backend and no `transport` call, and answers these
// scenarios `bad_input`.
import { describe, expect, it } from 'vitest';
import {
  BLOCK, CLICK_UP, Driver, MS, SAMPLE, SEC, audioDevice, click, firstSound, frameName, gate, gateOf, heardAt, lastSound,
  loopAsset, open, opened, output, outputOf, play, playing, positionAt, s, serialOf, transport, transportOf, useBin,
  useEvidence, type Frame, type Planted, type TestDevice,
} from './helpers.ts';

const show = useBin('deep-show');
const evidenceDir = useEvidence();

// Callback timestamps off by up to 0.5 ms (24 samples), seeded: the clock must pair and smooth them.
const SPEAKERS: TestDevice = { id: 'speakers', rate: 48_000, ppm: 100, buffer: 512, latency: 480, jitter: MS / 2, seed: 1 };
const HEADPHONES: TestDevice = { id: 'headphones', rate: 48_000, ppm: -100, buffer: 256, latency: 960, jitter: MS / 2, seed: 2 };
const PRESS = 1 * SEC;
const PLAY = PRESS + CLICK_UP;

/** The vsync period of the log, and its failures: frames on every vsync of the panel's display, one apart, through the
 * play to `end`. */
function cadence(frames: Frame[], end: number, tag: string, f: string[]): number {
  if (frames.length < 2) { f.push(`${tag}: the transport log holds ${frames.length} frames over the play`); return 1; }
  const v = frames[1]!.at - frames[0]!.at;
  const gap = frames.findIndex((fr, i) => i > 0 && fr.at - frames[i - 1]!.at !== v);
  if (v <= 0 || gap !== -1) f.push(`${tag}: the transport log isn't one frame a vsync: ${gap === -1 ? `a period of ${v} flicks` : `${frameName(gap, frames[gap]!)} follows ${s(frames[gap - 1]!.at)}`}`);
  if (frames[0]!.at > PLAY + v) f.push(`${tag}: the transport log starts at host ${s(frames[0]!.at)}, not at Play (${s(PLAY)})`);
  if (frames[frames.length - 1]!.at < end - v) f.push(`${tag}: the transport log ends at host ${s(frames[frames.length - 1]!.at)}, before ${s(end)}`);
  return v;
}

/** Monotonic and continuous: each frame's t is later than the one before by the host time between them, within one
 * block. */
function smooth(frames: Frame[], tag: string, f: string[]): void {
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1]!;
    const b = frames[i]!;
    if (b.t <= a.t) { f.push(`${tag}: t moves back or stalls at ${frameName(i, b)}: ${s(a.t)} then ${s(b.t)}`); return; }
    const off = b.t - a.t - (b.at - a.at);
    if (Math.abs(off) > BLOCK) { f.push(`${tag}: t jumps at ${frameName(i, b)}: it moves ${s(b.t - a.t)} over ${s(b.at - a.at)} of host time (${(off / SAMPLE).toFixed(1)} samples, more than one block)`); return; }
  }
}

/** Frames in [from, to] of host time against the clock `expect(at)` gives, led by `master` (on `device`); failures name
 * the first frame off by more than one block. */
function follows(frames: Frame[], from: number, to: number, master: string, device: string | null, expected: (at: number) => number, what: string, tag: string, f: string[]): void {
  const led: string[] = [];
  const off: string[] = [];
  let worst = 0;
  for (let i = 0; i < frames.length; i++) {
    const fr = frames[i]!;
    if (fr.at < from || fr.at > to) continue;
    if (fr.master !== master || fr.device !== device) led.push(`${frameName(i, fr)} is led by ${fr.master}${fr.device ? ` (${fr.device})` : ''}, not ${master}${device ? ` (${device})` : ''}`);
    const e = expected(fr.at);
    const by = fr.t - e;
    if (Math.abs(by) > BLOCK) {
      worst = Math.max(worst, Math.abs(by));
      off.push(`${frameName(i, fr)} shows t = ${s(fr.t)}, but ${what} gives t = ${s(e)} then: off the audio clock by ${(by / SAMPLE).toFixed(1)} samples, more than one block (128)`);
    }
  }
  if (led.length > 0) f.push(`${tag}: ${led[0]} (${led.length} frames so)`);
  if (off.length > 0) f.push(`${tag}: ${off[0]}; ${off.length} frames off, the worst by ${(worst / SAMPLE).toFixed(1)} samples`);
}

const STRIP_AT = 3 * SEC;
const TEN_MINUTES = 600 * SEC;
const END = 606 * SEC;

/** A looping strip from 3 s, played for 10 minutes on the speakers; its failures. */
function tenMinutes(planted?: Planted): string[] {
  const evidence = evidenceDir();
  const tag = `ten minutes${planted ? ` (planted ${planted})` : ''}`;
  const asset = loopAsset(evidence);
  const d = new Driver(show(), { evidence, devices: [SPEAKERS], default: SPEAKERS.id, ...(planted ? { planted } : {}) });
  const r1 = d.step([open(MS, 'follow', [{ track: 0, asset, start: STRIP_AT, in: 0, out: SEC, loop: true }]), ...click(PRESS)], `${tag}: the document and your click`);
  const f: string[] = [];
  if (!opened(r1[0])) f.push(`${tag}: the document didn't open: ${JSON.stringify(r1[0])}`);
  const serial = serialOf(r1[1], `${tag}: your click`);
  const r = d.step([play(PLAY, serial), output(SPEAKERS.id, 0, 6 * SEC), transport(0, END)], `${tag}: the play`);
  if (!playing(r[0])) f.push(`${tag}: your press of Play was answered ${JSON.stringify(r[0])}, not playing`);
  const heard = outputOf(r[1], evidence, SPEAKERS, 0, 0, 6 * SEC, `${tag}: the speakers`);
  const { frames } = transportOf(r[2], `${tag}: the transport`);
  const v = cadence(frames, END, tag, f);
  smooth(frames, tag, f);

  const ks = firstSound(heard);
  if (ks === null) { f.push(`${tag}: the strip at 3 s never sounded on the speakers by 6 s`); return f; }
  const hs = heardAt(heard, ks);
  // While silent the display leads, advanced by the elapsed host time.
  const silent = frames.filter((fr) => fr.at <= hs - v);
  if (silent.length === 0) f.push(`${tag}: no frame was shown before the strip sounded at host ${s(hs)}`);
  else {
    const dd = silent[0]!.t - silent[0]!.at;
    const bad = silent.findIndex((fr) => fr.master !== 'display' || Math.abs(fr.t - fr.at - dd) > 1);
    if (bad !== -1) f.push(`${tag}: before the strip sounded, ${frameName(bad, silent[bad]!)} isn't on the display clock (t = ${s(silent[bad]!.t)}, master ${silent[bad]!.master})`);
    if (Math.abs(hs + dd - STRIP_AT) > BLOCK) f.push(`${tag}: the strip's first sample played at host ${s(hs)}, where the display clock gave t = ${s(hs + dd)}, not 3 s`);
  }
  // While audio plays, t is the position the speakers play at each frame's presentation, from the strip's first sample.
  follows(frames, hs + v, END, 'audio', SPEAKERS.id, (at) => STRIP_AT + (positionAt(SPEAKERS, 0, at) - ks) * SAMPLE, 'the speakers\' clock', tag, f);
  if (frames.length > 0 && frames[frames.length - 1]!.at < hs + TEN_MINUTES) f.push(`${tag}: the audio played ${s(frames[frames.length - 1]!.at - hs)}, not 10 minutes`);
  return f;
}

const LOST = 20 * SEC;
const BACK = 60 * SEC;
const END_B = 120 * SEC;

/** The speakers go away at 20 s, with no output until headphones arrive at 60 s; its failures. */
function deviceChange(): string[] {
  const evidence = evidenceDir();
  const tag = 'device change';
  const asset = loopAsset(evidence);
  const d = new Driver(show(), { evidence, devices: [SPEAKERS], default: SPEAKERS.id });
  const r1 = d.step([open(MS, 'change', [{ track: 0, asset, start: SEC, in: 0, out: SEC, loop: true }]), ...click(PRESS)], `${tag}: the document and your click`);
  const f: string[] = [];
  if (!opened(r1[0])) f.push(`${tag}: the document didn't open: ${JSON.stringify(r1[0])}`);
  const serial = serialOf(r1[1], `${tag}: your click`);
  const r = d.step([
    play(PLAY, serial),
    gate(19 * SEC),
    audioDevice(LOST, { remove: SPEAKERS.id }),
    gate(40 * SEC),
    audioDevice(BACK, { add: HEADPHONES, default: HEADPHONES.id }),
    gate(70 * SEC),
    output(SPEAKERS.id, 0, 21 * SEC),
    output(HEADPHONES.id, BACK, 70 * SEC),
    transport(0, END_B),
  ], `${tag}: the play`);
  if (!playing(r[0])) f.push(`${tag}: your press of Play was answered ${JSON.stringify(r[0])}, not playing`);

  // The gate: running, then interrupted with a notice naming the speakers, then running again on your first grant.
  const before = gateOf(r[1], `${tag}: the gate at 19 s`);
  if (before.state !== 'running' || before.notice !== null) f.push(`${tag}: the gate at 19 s is ${before.state} with notice ${JSON.stringify(before.notice)}, not running with none`);
  const lost = gateOf(r[3], `${tag}: the gate at 40 s`);
  if (lost.state !== 'interrupted') f.push(`${tag}: with the speakers gone, the gate at 40 s is ${lost.state}, not interrupted`);
  if (lost.notice?.device !== SPEAKERS.id) f.push(`${tag}: with the speakers gone, the gate at 40 s shows notice ${JSON.stringify(lost.notice)}, not one naming ${SPEAKERS.id}`);
  if (lost.granted_by !== serial) f.push(`${tag}: interrupted, the gate is granted by ${JSON.stringify(lost.granted_by)}, not your press's serial ${serial}`);
  const after = gateOf(r[5], `${tag}: the gate at 70 s`);
  if (after.state !== 'running' || after.granted_by !== serial) f.push(`${tag}: with headphones the gate at 70 s is ${after.state}, granted by ${JSON.stringify(after.granted_by)}, not running on your press's serial ${serial}`);

  const spk = outputOf(r[6], evidence, SPEAKERS, 0, 0, 21 * SEC, `${tag}: the speakers`);
  const hp = outputOf(r[7], evidence, HEADPHONES, BACK, BACK, 70 * SEC, `${tag}: the headphones`);
  const { frames } = transportOf(r[8], `${tag}: the transport`);
  const v = cadence(frames, END_B, tag, f);
  smooth(frames, tag, f);

  const k0 = firstSound(spk);
  const kl = lastSound(spk);
  const kr = firstSound(hp);
  if (k0 === null || kl === null) { f.push(`${tag}: the strip never sounded on the speakers`); return f; }
  const h0 = heardAt(spk, k0);
  const hl = heardAt(spk, kl);
  if (hl < LOST - 100 * MS) f.push(`${tag}: the speakers fell silent at host ${s(hl)}, before they went away at ${s(LOST)}`);
  const tl = SEC + (kl - k0) * SAMPLE; // t of the last sample played
  follows(frames, h0 + v, hl - v, 'audio', SPEAKERS.id, (at) => SEC + (positionAt(SPEAKERS, 0, at) - k0) * SAMPLE, 'the speakers\' clock', tag, f);
  if (kr === null) { f.push(`${tag}: sound never came back on the headphones between ${s(BACK)} and 70 s`); return f; }
  const hr = heardAt(hp, kr);
  // With no output, the display leads from the last sample played: t keeps on with host time, neither stopped nor
  // drifting on the lost device's clock.
  follows(frames, hl + v, hr - v, 'display', null, (at) => tl + (at - hl), 'the display clock from the last sample played', tag, f);
  // On the headphones, t follows their clock from the display's t at their first sample.
  const tr = tl + (hr - hl);
  follows(frames, hr + v, END_B, 'audio', HEADPHONES.id, (at) => tr + (positionAt(HEADPHONES, BACK, at) - kr) * SAMPLE, 'the headphones\' clock', tag, f);
  return f;
}

describe('criterion 1: while audio plays the transport follows the audio clock, and a device change interrupts it without drift', () => {
  it('#499.85ea1101 a looping strip from 3 s on speakers 100 ppm fast: t follows the display until the strip\'s first sample, takes 3 s there, then follows the speakers\' clock within one block for 10 minutes, monotonic and continuous; with the speakers gone the gate is interrupted with a notice naming them and the display leads from the last sample played until headphones 100 ppm slow arrive and lead within a block; a clock that follows the display fails, naming the frame', () => {
    const clean = [...tenMinutes(), ...deviceChange()];
    expect(clean, 'the transport follows the audio clock, and a device change interrupts it without drift').toEqual([]);

    const twin = tenMinutes('clock_follows_display');
    expect(twin.some((m) => /frame \d+ \(vsync at host [\d.]+ s\) shows t = .*off the audio clock by/.test(m)), `the planted clock_follows_display fails, naming the frame: ${JSON.stringify(twin.slice(0, 4))}`).toBe(true);
  }, 3_600_000);
});
