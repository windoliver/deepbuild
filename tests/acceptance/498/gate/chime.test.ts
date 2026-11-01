// Criterion 5: the question chime shifted up one semitone and 3 dB quieter is refused at load, naming the chime; a
// planted comparer that matches by hash admits it and fails. The chime is the app's own reserved sound, read from the
// gate (`reserved`, its WAV in the evidence store by hash); the test shifts it tape-style (played 2^(1/12) times as
// fast, so every frequency rises a semitone) and lowers it 3 dB, then opens a document whose strip plays it. "At load"
// is the document's open; a refused asset never reaches the device, even after your press of Play. The control is a
// noise burst, nothing like a chime, which loads and sounds. Also held: the Device gate's `reserved` field and "It can
// never: imitate the question chime". Through `deep-show run` (README: The surface under test). At the base
// `deep-show` has no `reserved`, `open`, `play`, `gate` or `output` call and answers every scenario here `bad_input`.
import { describe, expect, it } from 'vitest';
import {
  CLICK_UP, Driver, MS, RATE, SEC, SEMITONE, SLOTS, click, dB, decodeWav, encodeWav, firstSound, gate, gateOf, getAsset, noise,
  open, output, outputOf, peak, play, putAsset, refusal, reserved, reservedOf, sAt, sampleAt, speedUp, useEvidence, useShow,
  type JsonObject, type Planted, type ReservedSound,
} from './helpers.ts';

const show = useShow();
const evidenceDir = useEvidence();

const PANEL = 'player';
const OPEN = 10 * MS;
const PRESS = 1 * SEC;
const END = 3 * SEC;

/** The app's reserved sounds and the question chime among them, with its samples; checks the gate's `reserved` field. */
function theChime(evidence: string): { chime: ReservedSound; f: string[] } {
  const d = new Driver(show(), { evidence, panels: { [PANEL]: { rect: SLOTS[0]! } } });
  const r = d.step([reserved(MS), gate(2 * MS, PANEL)], 'the reserved sounds');
  const list = reservedOf(r[0], 'reserved');
  const questions = list.filter((s) => s.for === 'question');
  expect(questions.length, `exactly one reserved sound is for the question (the question chime): ${JSON.stringify(list)}`).toBe(1);
  const chime = questions[0]!;
  const f: string[] = [];
  const g = gateOf(r[1], 'the gate of an empty panel');
  if (!g.reserved.includes(chime.sound)) f.push(`the gate's reserved field ${JSON.stringify(g.reserved)} doesn't name the question chime ${chime.sound}`);
  for (const s of list) if (!g.reserved.includes(s.sound)) f.push(`the gate's reserved field ${JSON.stringify(g.reserved)} doesn't name the reserved sound ${s.sound}`);
  return { chime, f };
}

interface Loaded { reply: JsonObject; code: string | null; heardFirst: number | null; heardAt: string; early: string | null }
/** Opens a document whose one strip plays `asset` from the start, presses Play there, and reads the device. */
function load(evidence: string, asset: string, seconds: number, what: string, planted?: Planted): Loaded {
  const d = new Driver(show(), { evidence, panels: { [PANEL]: { rect: SLOTS[0]! } }, ...(planted ? { planted } : {}) });
  const tag = `${what}${planted ? ` (planted ${planted})` : ''}`;
  const span = Math.max(1, Math.round(seconds * SEC));
  const r1 = d.step([open(OPEN, PANEL, 'doc', [{ track: 0, asset, start: 0, in: 0, out: span }]), ...click(PRESS, PANEL, SLOTS[0]!)], `${tag}: opened`);
  const serial = typeof r1[1]!['serial'] === 'number' ? r1[1]!['serial'] : NaN;
  expect(Number.isFinite(serial), `${tag}: your click has a serial: ${JSON.stringify(r1[1])}`).toBe(true);
  const r2 = d.step([play(PRESS + CLICK_UP, PANEL, { serial }), output(0, END)], `${tag}: Play pressed`);
  const heard = outputOf(r2[1], evidence, 0, END, `${tag}: the device's output`);
  const first = firstSound(heard, 0, sampleAt(heard, END));
  const early = firstSound(heard, 0, sampleAt(heard, PRESS));
  return { reply: r1[0]!, code: refusal(r1[0], `${tag}: the open`), heardFirst: first, heardAt: first === null ? 'never' : sAt(heard, first), early: early === null ? null : sAt(heard, early) };
}

/** The criterion's check on one world: the shifted chime refused at load naming the chime, and never heard. */
function shiftedRefused(evidence: string, chime: ReservedSound, shifted: string, seconds: number, planted?: Planted): string[] {
  const l = load(evidence, shifted, seconds, 'the question chime up a semitone and 3 dB down', planted);
  const f: string[] = [];
  if (l.code === null) f.push(`the question chime shifted up one semitone and 3 dB quieter was admitted at load: ${JSON.stringify(l.reply).slice(0, 300)}`);
  else if (l.reply['reserved'] !== chime.sound) f.push(`the shifted chime was refused (${l.code}) without naming the question chime ${chime.sound}: reserved is ${JSON.stringify(l.reply['reserved'])}`);
  if (l.heardFirst !== null) f.push(`the shifted chime reached the device at ${l.heardAt} after your press of Play`);
  return f;
}

describe('criterion 5: a sound too like the question chime is refused at load, naming the chime', () => {
  it('C5 the app\'s question chime, sped up a semitone and lowered 3 dB, is refused when a document holding it opens, naming the chime, and never sounds; the chime itself is refused too; a noise burst loads and sounds; a comparer that matches by hash admits the shifted chime and fails', () => {
    const evidence = evidenceDir();
    const { chime, f: fields } = theChime(evidence);
    const wav = decodeWav(getAsset(evidence, chime.sha256, `the question chime ${chime.sound}`), `the question chime ${chime.sound}`);
    const seconds = wav.frames / wav.sampleRate;
    expect(seconds >= 0.05 && seconds <= 10, `the question chime lasts between 50 ms and 10 s, got ${seconds.toFixed(3)} s`).toBe(true);
    expect(peak(wav.channels) > 0.01, `the question chime is not silent (peak ${peak(wav.channels)})`).toBe(true);

    const shiftedSamples = wav.channels.map((c) => speedUp(c, SEMITONE).map((v) => v * dB(-3)));
    const shifted = putAsset(evidence, encodeWav(shiftedSamples, wav.sampleRate));
    const shiftedSeconds = shiftedSamples[0]!.length / wav.sampleRate;

    const f = [...fields, ...shiftedRefused(evidence, chime, shifted, shiftedSeconds)];
    // The chime itself, by its own hash: reserved sounds come only from the app.
    const same = load(evidence, chime.sha256, seconds, 'the question chime itself');
    if (same.code === null) f.push(`the question chime itself was admitted at load in a document: ${JSON.stringify(same.reply).slice(0, 300)}`);
    else if (same.reply['reserved'] !== chime.sound) f.push(`the chime itself was refused (${same.code}) without naming ${chime.sound}`);
    if (same.heardFirst !== null) f.push(`the question chime itself reached the device at ${same.heardAt}`);
    // The control: a noise burst loads and sounds after your press, so the refusal isn't of every sound.
    const burst = putAsset(evidence, encodeWav([noise(1, 0.2, 498)], RATE));
    const control = load(evidence, burst, 1, 'a noise burst');
    if (control.code !== null || control.reply['opened'] !== true) f.push(`a noise burst, nothing like the chime, wasn't admitted: ${JSON.stringify(control.reply).slice(0, 300)}`);
    if (control.heardFirst === null) f.push('a noise burst never reached the device after your press of Play');
    if (control.early !== null) f.push(`a noise burst sounded at ${control.early}, before you pressed Play`);
    expect(f, 'the shifted chime is refused at load naming the chime').toEqual([]);

    // Wrong program: a comparer that matches by hash.
    const twinEvidence = evidenceDir();
    const twinChime = theChime(twinEvidence).chime;
    const twinWav = decodeWav(getAsset(twinEvidence, twinChime.sha256, 'the chime (planted run)'), 'the chime (planted run)');
    const twinShifted = putAsset(twinEvidence, encodeWav(twinWav.channels.map((c) => speedUp(c, SEMITONE).map((v) => v * dB(-3))), twinWav.sampleRate));
    const twin = shiftedRefused(twinEvidence, twinChime, twinShifted, shiftedSeconds, 'comparer_matches_hash');
    expect(twin.some((m) => /shifted up one semitone and 3 dB quieter was admitted/.test(m)), `the planted comparer_matches_hash admits the shifted chime and fails: ${JSON.stringify(twin)}`).toBe(true);
  }, 1_800_000);
});
