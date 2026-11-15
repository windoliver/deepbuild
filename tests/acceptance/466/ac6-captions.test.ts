// AC6 #466.84cc08bc: A caption designed by the look keeps its profile's timing and line limits and passes
// render.contrast, and a caption pointing at an intertitle draws no second copy while the .srt still carries its line.
//
// A 480 × 270 film at 24 fps, 8 s, in English, with two caption-only lines (no speech job, no `say`) under the profile
// netflix-en-adult (max_chars 42, max_lines 2, min_dur 5/6 s, max_cps 20, gap_frames 2):
//   - `note` at 0.5 s, "Captions belong to the world they are drawn in" (46 characters): by the layout rule
//     (Narration and captions) one caption `note.1` of two lines, "Captions belong to the world they are" and "drawn
//     in", from frame 12 to frame 68 (⌈(0.5 + 46 ÷ 20) × 24⌉);
//   - `act` at 4.2 s, "Meanwhile at the harbour" (24 characters): `act.1` from frame 100 to frame 130, whose words the
//     intertitle `card` already shows from 4 s to 6 s, so `script.captions.shown_by` names `card`.
// The designed film's look is the clean look with `captions: {plate: "card", entrance: "unfold", text_after: 0.4,
// anchor: [0.5, 0.85], stage: "after_finish"}`; its twins: the same film under the clean look (the captions not
// designed), without the line `act`, and without `shown_by`. Through `deep-show run` (`full`): each exported as PNG
// frames at 24 fps with open captions and an .srt (#501's `export`, #502's `captions` and receipt), and the designed one
// judged by a claim whose requirement is `{kind: "render.contrast"}` (#1938's check, #407's verdict).
//   - Timing and line limits: the designed export's `receipt.captions.cues` are exactly the two above, each line
//     within 42 characters and each caption within 2 lines, and equal the undesigned twin's cues. The planted
//     `designed_caption_after_entrance` times a designed caption from the end of its entrance, and the same judge
//     fails, naming note.1.
//   - render.contrast PASSes with no error or warning; under the planted `caption_plate_in_text_role` (the plate drawn
//     in the caption text's own role) it FAILs, naming note.1.
//   - No second copy: frames 100 to 129 of the designed export are byte for byte the twin's without `act`, while the
//     twin without `shown_by` draws something else there (the caption would draw); its .srt still carries act.1, at
//     4,166 to 5,416 ms with its text. The planted `shown_by_ignored` draws the caption anyway, and the same judge fails,
//     naming act.1.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { docId, judge, passFailures } from '../407/helpers.ts';
import { pngFrames, receiptOf, useTemp } from '../501/helpers.ts';
import { captionsOf, parseSrt, sidecar, sidecarText, type Cue } from '../502/helpers.ts';
import {
  AC, DOC, FRAME24, FULL, TIMEOUT, asStored, camera2d, clone, failsNaming, film, fl, lookFrom, none, present, presented, rect, show1, useEvidence,
  useShow, withLook, type JsonObject, type Planted,
} from './helpers.ts';

const shows = useShow([FULL]);
const evidence = useEvidence();
const temp = useTemp();
const CARD = 'Meanwhile at the harbour';
const NOTE = 'Captions belong to the world they are drawn in';
/** The layout rule's captions, worked by hand (header): name, line, its lines, in and out frames at 24 fps. */
const EXPECTED = [
  { name: 'note.1', line: 'note', lines: ['Captions belong to the world they are', 'drawn in'], in: 12, out: 68 },
  { name: 'act.1', line: 'act', lines: [CARD], in: 100, out: 130 },
] as const;
const DESIGN: JsonObject = { plate: 'card', entrance: 'unfold', text_after: 0.4, anchor: [0.5, 0.85], stage: 'after_finish' };
const NARRATOR: JsonObject = {
  name: 'Fixture voice', synthetic: false,
  license: { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Made by the films-in-time acceptance tests.' },
};

type Variant = 'designed' | 'plain' | 'without_act' | 'without_shown_by';
function captionFilm(v: Variant): JsonObject {
  const card: JsonObject = {
    id: 'card', kind: 'text@1', name: 'Intertitle', order: 'c1', at: { pos: [40, 110, 0] },
    params: { text: CARD, font: 'body', size: 32, box: { w: 400, h: 50 }, align: 'center' },
  };
  const lines: JsonObject = { note: { t: '0.5s', text: NOTE, kind: 'caption' }, act: { t: '4.2s', text: CARD, kind: 'caption' } };
  if (v === 'without_act') delete lines['act'];
  const captions: JsonObject = { profile: 'netflix-en-adult', font: 'body', size: 14, shown_by: 'card' };
  if (v === 'without_shown_by') delete captions['shown_by'];
  const doc = film(`captions-${v.replace(/_/g, '-')}`, [camera2d([480, 270]), rect('back', [0, 0, 480, 270], 'ground'), card], {
    channels: { card_shows: { target: 'items/card/adjust/opacity', type: 'f32', keys: { k0: { t: '0s', value: 0, interp: 'hold' }, k1: { t: '4s', value: 1, interp: 'hold' }, k2: { t: '6s', value: 0, interp: 'hold' } } } },
    script: { narrator: clone(NARRATOR), lines, captions },
  }, { span: '8s', frame_rate: '24/1' });
  const look = v === 'plain' ? lookFrom('captions-plain') : lookFrom('captions-designed', { captions: DESIGN });
  return withLook(evidence(), doc, { [String(look['id'])]: look }, String(look['id']));
}

interface Exported { cues: Cue[]; frames: Buffer[]; srt: string }
/** Each variant exported as PNG frames at 24 fps, open captions and an .srt. */
function exportAll(variants: Variant[], planted?: Planted): Record<string, Exported> {
  const dir = temp();
  const ids = [DOC.a, DOC.b, DOC.c, DOC.d];
  const outs = variants.map((v) => join(dir, v, 'frames'));
  const calls = [
    ...variants.map((v, i) => present(ids[i]!, captionFilm(v))),
    ...variants.map((_, i) => ({ call: 'export', doc: ids[i]!, out: outs[i]!, video: { codec: 'png_seq' }, frame_rate: [24, 1], range: [0, fl(8)], captions: { profile: 'netflix-en-adult', mode: 'open', files: ['srt'] } })),
  ];
  const replies = show1(shows.bin(FULL), evidence(), calls, planted);
  const got: Record<string, Exported> = {};
  variants.forEach((v, i) => {
    presented(replies[i]!, `the ${v} film`);
    const receipt = receiptOf(replies[variants.length + i]!, `the ${v} film's export`);
    got[v] = { cues: captionsOf(receipt.raw, `the ${v} film's export`).cues, frames: pngFrames(outs[i]!, `the ${v} film's export`), srt: sidecarText(sidecar(outs[i]!, 'srt'), `the ${v} film's export`) };
  });
  return got;
}
const graphemes = (s: string): number => [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(s)].length;

/** The designed captions against the profile's layout and the undesigned twin's, each failure naming its caption. */
function timingFailures(designed: Cue[], plain: Cue[]): string[] {
  const f: string[] = [];
  if (designed.length !== EXPECTED.length) f.push(`the designed export lists ${designed.length} captions (${designed.map((c) => c.name).join(', ')}), not note.1 and act.1`);
  EXPECTED.forEach((w, i) => {
    const g = designed[i];
    const at = `caption ${w.name}`;
    if (!g) return;
    if (g.name !== w.name || g.line !== w.line) f.push(`${at}: the receipt's caption ${i + 1} is ${g.name} of line ${g.line}`);
    if (g.text !== w.lines.join('\n')) f.push(`${at}: its text is ${JSON.stringify(g.text)}, not ${JSON.stringify(w.lines.join('\n'))}`);
    if (g.in !== w.in * FRAME24) f.push(`${at}: its in-time is ${g.in} flicks, not frame ${w.in} (${w.in * FRAME24})`);
    if (g.out !== w.out * FRAME24) f.push(`${at}: its out-time is ${g.out} flicks, not frame ${w.out} (${w.out * FRAME24})`);
    const rows = g.text.split('\n');
    if (rows.length > 2) f.push(`${at}: ${rows.length} lines, over max_lines 2`);
    for (const r of rows) if (graphemes(r) > 42) f.push(`${at}: the line ${JSON.stringify(r)} has ${graphemes(r)} characters, over max_chars 42`);
  });
  if (JSON.stringify(designed) !== JSON.stringify(plain)) f.push(`caption timing: the designed captions ${JSON.stringify(designed)} differ from the undesigned film's ${JSON.stringify(plain)}`);
  return f;
}
/** The intertitle's caption: no second copy in the designed frames, the twin without shown_by drawing one; act.1 in the .srt. */
function shownByFailures(got: Record<string, Exported>): string[] {
  const f: string[] = [];
  const [d, without, drawn] = [got['designed']!, got['without_act']!, got['without_shown_by']!];
  if (d.frames.length !== 192 || without.frames.length !== 192) f.push(`act.1: the exports wrote ${d.frames.length} and ${without.frames.length} frames, not 192`);
  const differing = [];
  for (let k = 100; k < 130; k++) if (!(d.frames[k] && without.frames[k] && d.frames[k]!.equals(without.frames[k]!))) differing.push(k);
  if (differing.length) f.push(`act.1: frames ${differing.join(', ')} of the designed export differ from the film without the line act: the caption draws a second copy of the intertitle's words`);
  if (![...Array(30).keys()].some((i) => drawn.frames[100 + i] && without.frames[100 + i] && !drawn.frames[100 + i]!.equals(without.frames[100 + i]!))) f.push('act.1: without shown_by the caption draws nothing either, so the comparison shows nothing');
  const srt = parseSrt(d.srt, 'the designed export\'s .srt');
  const cue = srt[1];
  if (!cue) f.push(`act.1: the .srt holds ${srt.length} cues, not two`);
  else {
    if (cue.lines.join('\n') !== CARD) f.push(`act.1: the .srt's second cue reads ${JSON.stringify(cue.lines)}, not ${JSON.stringify([CARD])}`);
    if (cue.start !== Math.floor((100 * 1000) / 24) || cue.end !== Math.floor((130 * 1000) / 24)) f.push(`act.1: the .srt times it ${cue.start} to ${cue.end} ms, not 4166 to 5416`);
  }
  return f;
}
function contrastFailures(planted?: Planted): string[] {
  const { judged } = judge(shows.bin(FULL), evidence(), [{ name: 'the designed caption film', doc: docId(1), document: asStored(captionFilm('designed'), docId(1)), check: { kind: 'render.contrast' } }], planted ? { planted } : {});
  return passFailures(judged['the designed caption film']?.row, 'render.contrast on the designed caption film');
}

describe(`${AC[6]} captions the look designs, still timed by their profile`, () => {
  it(`${AC[6]} the designed captions keep the profile's times and line limits, the undesigned twin's exactly`, () => {
    const got = exportAll(['designed', 'plain']);
    none(timingFailures(got['designed']!.cues, got['plain']!.cues), 'the designed captions\' timing');
  }, TIMEOUT);

  it(`${AC[6]} (planted) a designed caption timed from the end of its entrance fails, naming note.1`, () => {
    const got = exportAll(['designed', 'plain'], 'designed_caption_after_entrance');
    failsNaming(timingFailures(got['designed']!.cues, got['plain']!.cues), ['caption note.1'], 'the planted designed_caption_after_entrance');
  }, TIMEOUT);

  it(`${AC[6]} the designed captions pass render.contrast`, () => {
    none(contrastFailures(), 'render.contrast on the designed captions');
  }, TIMEOUT);

  it(`${AC[6]} (planted) a plate drawn in the caption text's role fails render.contrast, naming note.1`, () => {
    const failures = contrastFailures('caption_plate_in_text_role');
    failsNaming(failures, ['note.1'], 'the planted caption_plate_in_text_role');
    expect(failures.join(' '), 'the row is FAIL').toContain('is FAIL');
  }, TIMEOUT);

  it(`${AC[6]} a caption pointing at the intertitle draws no second copy, and the .srt still carries its line`, () => {
    none(shownByFailures(exportAll(['designed', 'without_act', 'without_shown_by'])), 'the caption the intertitle shows');
  }, TIMEOUT);

  it(`${AC[6]} (planted) a caption that ignores shown_by draws a second copy and fails, naming act.1`, () => {
    failsNaming(shownByFailures(exportAll(['designed', 'without_act', 'without_shown_by'], 'shown_by_ignored')), ['act.1: frames'], 'the planted shown_by_ignored');
  }, TIMEOUT);
});
