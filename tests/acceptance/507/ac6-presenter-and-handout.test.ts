// AC6 #507.3b8c5798: "With two displays, the presenter view shows stage 3's notes, the next stage's first frame, the stage
// number and name and the elapsed time while stage 3 holds, and neither notes nor an ask ever draw on the presented
// display; the `pdf` handout of a 9-stage piece is a 9-page PDF whose pages, read back by a pinned PDF reader apart from
// the writer, hash equal to `still {marker}` exports of the stages, with notes only when `notes: true`, and a planted
// writer that skips stage 4 fails that fidelity check, naming stage 4"
//
// The nine-stage piece (helpers.ts `ninePiece`): stage k at 4(k − 1) s, each with a name and notes. Presented on B, → at
// 1 s and 6 s bring it to stage 3 (8 s), which holds from about 10 s; Shift+P at 11 s opens the presenter view, and an
// ask is created at 12 s. The handout is read back by poppler (pdfinfo, pdfimages, pdftotext), which DeepBuild never
// calls: each page's image, decoded, against stage k's still exported as PNG; its text layer against the notes. The
// planted writer is the scenario's `planted: "pdf_writer_skips_stage_4"`. Wrong programs: a presenter view on the
// presented display, with another stage's notes or frame, or a clock that doesn't run; notes or the card drawn on B; a
// page per frame or per section, a page drawn again at another size or compressed with loss, notes always or never; an
// export whose fidelity check doesn't run or doesn't name the stage it misses.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  A, ASK, B, DISPLAY_A, DISPLAY_B, DOC, Driver, NINE_NAMES, TIMEOUT, arr, cardState, enterPresent, evalAt, fl, int, key, mentions, ninePiece,
  noteOf, none, obj, pdfPageImages, pdfPageText, pdfPages, plainScenario, popplerTools, positionOf, present, presented, presenterState,
  framesOf, presentEntry, rgbOf, runShow, secs, sha256, show, shownFrames, stageAt, stillPng, str, useShow, useTemp, ENTER, type JsonObject,
} from './helpers.ts';

const ID = 'AC6 #507.3b8c5798';
const bin = useShow();
const temp = useTemp();

const still = (out: string, k: number, when?: number): JsonObject =>
  ({ call: 'export', doc: DOC.nine, out, range: { still: { marker: `s${k}` } }, video: { codec: 'png_seq' }, ...(when === undefined ? {} : { at: when }) });
const handout = (out: string, notes: boolean): JsonObject => ({ call: 'export', doc: DOC.nine, out, range: 'stages', video: { codec: 'pdf' }, pdf: { notes } });
const frameHash = (r: JsonObject | undefined, what: string): string => {
  expect(obj(r, what)['outcome'], `${what} is exported: ${show(r)}`).toBe('exported');
  return str(arr(obj(r!['receipt'], `${what}: receipt`)['frame_hashes'], `${what}: frame_hashes`)[0], `${what}: frame_hashes[0]`);
};

describe(`${ID} the presenter view on the other display, and the pdf handout read back apart from its writer`, () => {
  it(`${ID} while stage 3 holds the presenter view on A shows its notes, the next stage's first frame, its number and name and the time; nothing of it or an ask draws on B`, () => {
    const ev = temp(); const out = temp();
    const d = new Driver(bin(), {
      evidence: ev, displays: [DISPLAY_A, DISPLAY_B], doc: DOC.nine,
      card: { ask: ASK, question: 'Take questions after stage three?', options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }], size: [360, 180], at: fl(12), deadline: fl(60) },
    });
    enterPresent(d, DOC.nine, ninePiece(), B, 'the nine-stage piece on B');
    const r = d.step([
      key(fl(1), 'ArrowRight'), key(fl(6), 'ArrowRight'), key(fl(11), 'P', ['shift']),
      presenterState(fl(13)), evalAt(fl(13), DOC.nine), cardState(fl(13.5)), presenterState(fl(15)), framesOf(fl(15)),
      still(join(out, 's4'), 4, fl(15.5)),
    ], 'stage 3 held with the presenter view open');
    presentEntry(r[0], 'advance', '→ on stage 1');
    presentEntry(r[1], 'advance', '→ on stage 2');
    const failures: string[] = [];
    if (positionOf(r[4], 'eval at 13 s') !== fl(stageAt(3))) failures.push(`at 13 s the timeline isn't held at stage 3 (${stageAt(3)} s)`);
    const view = (x: JsonObject | undefined, what: string): JsonObject => obj(obj(x, what)['presenter'], `${what}: presenter`);
    const v13 = view(r[3], 'the presenter view at 13 s');
    const v15 = view(r[6], 'the presenter view at 15 s');
    const next = obj(v13['next'], 'the presenter view: next');
    const s4 = frameHash(r[8], "stage 4's still");
    const want: [string, unknown, unknown][] = [
      ['display', v13['display'], A], ['stage', v13['stage'], 's3'], ['number', v13['number'], 3], ['name', v13['name'], NINE_NAMES[2]],
      ['notes', v13['notes'], noteOf(3)], ['next stage', next['stage'], 's4'], ["next stage's first frame", next['hash'], s4],
    ];
    for (const [what, got, w] of want) if (got !== w) failures.push(`the presenter view's ${what} is ${JSON.stringify(got)}, not ${JSON.stringify(w)}`);
    const [e13, e15] = [int(v13['elapsed'], 'elapsed at 13 s'), int(v15['elapsed'], 'elapsed at 15 s')];
    if (Math.abs(e13 - (fl(13) - ENTER)) > fl(0.1)) failures.push(`at 13 s the elapsed time is ${secs(e13)}, not ${secs(fl(13) - ENTER)} since present mode began`);
    if (Math.abs(e15 - e13 - fl(2)) > fl(0.1)) failures.push(`from 13 s to 15 s the elapsed time runs ${secs(e15 - e13)}, not 2 s`);
    if (v15['stage'] !== 's3') failures.push(`at 15 s the presenter view shows ${show(v15['stage'] ?? null)}, not stage 3 still holding`);
    const card = obj(obj(r[5], 'the card at 13.5 s')['card'], 'card');
    if (card['display'] !== A) failures.push(`the ask's card opens on ${show(card['display'] ?? null)}, not on A beside the presenter view`);
    const onB = shownFrames(r[7], "the piece's frames").filter((f) => f.display === B);
    if (onB.length === 0) failures.push('B presented no frame of the piece');
    for (const f of onB) for (const o of ['notes', 'card', 'presenter']) if (f.over.includes(o)) failures.push(`B's frame at ${secs(f.vsync)} draws ${o}`);
    none(failures, 'the presenter view');
  }, TIMEOUT);

  it(`${ID} the handout of the 9-stage piece is 9 pages, each its stage's still, read back by poppler; notes only with notes: true`, () => {
    const tools = popplerTools();
    const ev = temp(); const out = temp();
    const stills = Array.from({ length: 9 }, (_, i) => join(out, `still-${i + 1}`));
    const replies = runShow(bin(), plainScenario(ev, [DOC.nine], [
      present(DOC.nine, ninePiece()),
      ...stills.map((s, i) => still(s, i + 1)),
      handout(join(out, 'plain.pdf'), false),
      handout(join(out, 'notes.pdf'), true),
    ]), 'the stills and the two handouts');
    presented(replies[0], 'the nine-stage piece');
    const pictures = stills.map((s, i) => { frameHash(replies[i + 1], `stage ${i + 1}'s still`); return stillPng(s, `stage ${i + 1}'s still`); });
    console.log(`${ID}: the handouts are read by ${tools.version}`);
    const failures: string[] = [];
    for (const [i, name, notes] of [[10, 'plain.pdf', false], [11, 'notes.pdf', true]] as const) {
      expect(obj(replies[i], name)['outcome'], `the handout ${name} is exported: ${show(replies[i])}`).toBe('exported');
      const pdf = join(out, name);
      const pages = pdfPages(pdf, name);
      if (pages !== 9) { failures.push(`${name} has ${pages} pages, not 9`); continue; }
      const dir = temp();
      const images = pdfPageImages(pdf, dir, name);
      for (let k = 1; k <= 9; k++) {
        const img = images.get(k); const ref = pictures[k - 1]!;
        if (!img) { failures.push(`${name} page ${k} holds no image`); continue; }
        if (img.width !== ref.width || img.height !== ref.height) { failures.push(`${name} page ${k}'s image is ${img.width} × ${img.height}, not the still's ${ref.width} × ${ref.height}`); continue; }
        const [got, want] = [sha256(rgbOf(img)), sha256(rgbOf(ref))];
        if (got !== want) failures.push(`${name} page ${k}'s image (sha256 ${got.slice(0, 12)} of its RGB) isn't stage ${k}'s still (${want.slice(0, 12)})`);
        const text = pdfPageText(pdf, k, name);
        for (let j = 1; j <= 9; j++) {
          const has = text.includes(noteOf(j));
          if (has && !(notes && j === k)) failures.push(`${name} page ${k} holds stage ${j}'s notes`);
          if (!has && notes && j === k) failures.push(`${name} page ${k} lacks stage ${k}'s notes: its text is ${JSON.stringify(text.slice(0, 200))}`);
        }
      }
    }
    none(failures, 'the handouts, read back');
  }, TIMEOUT);

  it(`${ID} a planted writer that skips stage 4 fails the handout's fidelity check, naming stage 4`, () => {
    const ev = temp(); const out = temp();
    const pdf = join(out, 'handout.pdf');
    const replies = runShow(bin(), plainScenario(ev, [DOC.nine], [present(DOC.nine, ninePiece()), handout(pdf, false)], 'pdf_writer_skips_stage_4'), 'the planted writer');
    presented(replies[0], 'the nine-stage piece');
    const r = obj(replies[1], 'the handout from the planted writer');
    expect(r['outcome'], `the handout isn't delivered: ${show(r)}`).not.toBe('exported');
    const issues = arr(r['issues'], 'the handout: issues').map((x, i) => obj(x, `issues[${i}]`));
    expect(issues.some((i) => mentions(i, '"s4"') || /stage 4\b/i.test(JSON.stringify(i))), `an issue names stage 4: ${show(issues)}`).toBe(true);
    expect(existsSync(pdf), "no handout is left at the handout's path").toBe(false);
    expect(readdirSync(out), "nothing is left beside it, at a temporary name or another").toEqual([]);
  }, TIMEOUT);
});
