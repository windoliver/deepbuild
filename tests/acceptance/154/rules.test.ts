// AC6 #154.74061b19: "A sustained pad at MIDI 40 not marked bass is refused naming the event, and a held note of 61 s
// is refused"
//
// asserts, through `deep show` of a film holding one score.music@1 item (each case its own deep-show run, so no
// earlier revision carries an issue): a note at MIDI 40 on the synth preset `pad` is refused with score.pad_too_low,
// the issue naming the event; so is one at 47.52 (1% under the threshold: the boundary's planted twin), and one at 40
// on a library preset marked `sustained`; MIDI 48 on `pad` (the clean twin), MIDI 40 on `pad` marked `bass`, and MIDI
// 40 on a library preset that isn't sustained are presented with no score.pad_too_low. A note held 61 s is refused
// with score.note_too_long, naming the event, and so is one of 60.6 s (1% over); one of 60 s is presented with none.
import { describe, expect, it } from 'vitest';
import {
  AC, TIMEOUT, check, film, issuesOf, sampled, scoreItem, show, synth, tempo, tempDir, useShow, writeLibrary, CC0, roundRobinTake, hz, wav16, ref,
  type Ev, type Inst, type JsonObject, type Library, type PackDir,
} from './helpers.ts';

const showBin = useShow();
const PAD_LOW = 'score.pad_too_low';
const TOO_LONG = 'score.note_too_long';

/** test/drones: `drone`, a library preset marked sustained, and `low`, one that isn't, both rooted at MIDI 40. Its
 * takes are listed and never fetched: the check reads the pack's manifest. */
function drones(): Library {
  const t = (name: string) => ({ path: `${name}.wav`, bytes: wav16(roundRobinTake(0, hz(40), 0.5)) });
  return { id: 'test/drones', version: '1.0.0', license: CC0, presets: { drone: { sustained: true, zones: [{ lo: 0, hi: 127, root: 40, takes: [t('drone')] }] }, low: { zones: [{ lo: 0, hi: 127, root: 40, takes: [t('low')] }] } } };
}
/** A film whose score holds `event` on `inst`, beside one note no rule touches. */
function oneNote(inst: Inst, id: string, event: Ev, packs: string[] = []): JsonObject {
  const events: Record<string, Ev> = { [id]: event, ok_note: { at: '2:1', inst: 'keep', pitch: 64, dur: '1s', vel: 0.5 } };
  return film([scoreItem('rules', { voice: inst, keep: synth('sine', 'other') }, events)], { tempo: tempo(90), packs, span: '70s' });
}
interface Case { id: string; doc: JsonObject; packs: PackDir[]; code: string; refused: boolean }
function judge(bin: string, c: Case): string[] {
  const evidence = tempDir();
  const reply = check(bin, evidence, c.doc, c.packs, `the case ${c.id}`);
  const hits = issuesOf(reply).filter((i) => i['code'] === c.code);
  if (c.refused) {
    if (reply['outcome'] !== 'refused') return [`${c.id}: deep show answers ${String(reply['outcome'])}, not refused: ${show(reply, 600)}`];
    if (!hits.some((i) => JSON.stringify(i).includes(c.id))) return [`${c.id}: no ${c.code} issue names the event ${c.id}: ${show(issuesOf(reply) as unknown as JsonObject, 900)}`];
    return [];
  }
  if (reply['outcome'] !== 'presented') return [`${c.id}: deep show answers ${String(reply['outcome'])}, not presented: ${show(reply, 900)}`];
  if (hits.length) return [`${c.id}: presented with ${c.code}: ${show(hits as unknown as JsonObject, 600)}`];
  return [];
}

describe(`${AC[6]} pads below MIDI 48 and notes held over 60 s`, () => {
  it(`${AC[6]} a sustained pad at MIDI 40 not marked bass is refused naming the event; MIDI 48 passes, bass passes, a pad of a library preset is held to the same rule`, () => {
    const bin = showBin();
    const lib = drones();
    const dir = writeLibrary(tempDir(), { host: '127.0.0.1:9', serve: () => undefined }, lib);
    const packs: PackDir[] = [{ id: lib.id, dir }];
    const note = (pitch: number): Ev => ({ at: '1:1', inst: 'voice', pitch, dur: '2s', vel: 0.5 });
    const cases: Case[] = [
      { id: 'pad_e40', doc: oneNote(synth('pad', 'pads'), 'pad_e40', note(40)), packs: [], code: PAD_LOW, refused: true },
      { id: 'pad_e47_52', doc: oneNote(synth('pad', 'pads'), 'pad_e47_52', note(47.52)), packs: [], code: PAD_LOW, refused: true },
      { id: 'pad_e48', doc: oneNote(synth('pad', 'pads'), 'pad_e48', note(48)), packs: [], code: PAD_LOW, refused: false },
      { id: 'bass_e40', doc: oneNote(synth('pad', 'pads', true), 'bass_e40', note(40)), packs: [], code: PAD_LOW, refused: false },
      { id: 'drone_e40', doc: oneNote(sampled(ref(lib), 'drone', 'pads'), 'drone_e40', note(40), [ref(lib)]), packs, code: PAD_LOW, refused: true },
      { id: 'low_e40', doc: oneNote(sampled(ref(lib), 'low', 'pads'), 'low_e40', note(40), [ref(lib)]), packs, code: PAD_LOW, refused: false },
    ];
    const failures = cases.flatMap((c) => judge(bin, c));
    expect(failures, failures.join(' | ')).toEqual([]);
  }, TIMEOUT);

  it(`${AC[6]} a note held 61 s is refused naming the event, as is 60.6 s; 60 s passes`, () => {
    const bin = showBin();
    const held = (dur: string): Ev => ({ at: '1:1', inst: 'voice', pitch: 60, dur, vel: 0.5 });
    const cases: Case[] = [
      { id: 'held61', doc: oneNote(synth('sine', 'lead'), 'held61', held('61s')), packs: [], code: TOO_LONG, refused: true },
      { id: 'held60_6', doc: oneNote(synth('sine', 'lead'), 'held60_6', held('60.6s')), packs: [], code: TOO_LONG, refused: true },
      { id: 'held60', doc: oneNote(synth('sine', 'lead'), 'held60', held('60s')), packs: [], code: TOO_LONG, refused: false },
    ];
    const failures = cases.flatMap((c) => judge(bin, c));
    expect(failures, failures.join(' | ')).toEqual([]);
  }, TIMEOUT);
});
