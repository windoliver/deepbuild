// AC15 #157.0d980b87: "A 1921×1080 H.264 export is refused at check with `export_size_odd`"
// AC16 #157.e141bc60: "The decode worker reads the moov box before the first mdat byte of every MP4 delivery"
// AC17 #157.ac47cfd5: "Every chapter start is a sync sample, and a planted delivery without one fails, naming the chapter"
// AC19 #157.e9670c64: "In a 60 s film, a strip that starts at 55 s and runs 8 s is listed with its start and 3 s lost, as
// a warning, and a brief that refuses end cuts fails the export, naming the strip"
//
// Through `deep-show run`'s `export`, this suite's own reader of the delivered file's boxes (helpers.ts `readMovie`),
// FFmpeg's reading of its key frames, and the decode worker's probe (`media_import`). The refusal names the size and
// the nearest even one (`nearest_even`); the receipt lists `chapters` (each section marker's `marker`, `name` and
// first `frame`) and `warnings` (an end cut: `{code: "end_cut", strip, start, lost}`, times in flicks); a brief is the
// export call's `brief: {refuse: ["end_cut"]}`, standing in for the locked definition's. Films: the fixture film
// (helpers.ts `filmDoc`). Planted: `muxer_writes_moov_last` (this job's twin for AC16: the base's muxer already writes
// the header first, so the check must be shown to fail on one that doesn't), `encoder_ignores_chapters`.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, FLICKS, FULL, H264_AAC, PRORES_PCM, TIMEOUT, arr, assetOf, bytesOf, exportCall, failsNaming, ffVideoFrames, filmDoc, filmRun, frameFlicks,
  isObject, issueLines, leftIn, mediaImport, none, present, presented, readMovie, receiptOf, sampleOfFrame, show, soundStrip, toneChannels, trackOf,
  useShow, useTemp, type JsonObject, type Planted,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const D = frameFlicks([24, 1]);

describe(`${AC[15]} a 4:2:0 export with an odd size is refused at check`, () => {
  it(`${AC[15]} a 1921 × 1080 H.264 export, asked as the call's size and as the document's own, is refused at check with export_size_odd naming the size and the nearest even one, and writes nothing`, () => {
    const evidence = temp(); const dir = temp();
    const odd = filmDoc(evidence, { frames: 24, size: [1921, 1080], moving: false });
    const [asked, shown, own] = filmRun(shows.bin(FULL), evidence, filmDoc(evidence, { frames: 24 }), [
      exportCall({ out: join(dir, 'asked', 'film.mp4'), size: [1921, 1080], ...H264_AAC }),
      present(DOC.b, odd),
      exportCall({ doc: DOC.b, out: join(dir, 'own', 'film.mp4'), ...H264_AAC }),
    ], 'the 1921 × 1080 exports');
    presented(shown!, 'the 1921 × 1080 film');
    for (const [reply, what] of [[asked!, 'the call asking 1921 × 1080'], [own!, 'the 1921 × 1080 document']] as const) {
      expect([reply['outcome'], reply['code']], `${what} is refused with export_size_odd: ${show(reply)}`).toEqual(['refused', 'export_size_odd']);
      expect(reply['size'], `${what}: the refusal names the size`).toEqual([1921, 1080]);
      expect([[1920, 1080], [1922, 1080]].map((s) => JSON.stringify(s)), `${what}: the refusal names the nearest even size: ${show(reply)}`).toContain(JSON.stringify(reply['nearest_even']));
    }
    expect(leftIn(dir), 'the refused exports wrote nothing').toEqual([]);
  }, TIMEOUT);
});

/** Each delivery's header first: in the file, `moov` before the first `mdat` byte, and the decode worker reads it.
 * Each failure starts `<file>: moov`. */
function moovFailures(replies: JsonObject[], outs: string[]): string[] {
  const f: string[] = [];
  outs.forEach((out, i) => {
    const name = out.split('/').pop()!;
    if (replies[2 * i]!['outcome'] !== 'exported') { f.push(`${name}: moov: the export wasn't delivered: ${issueLines(replies[2 * i]!).join(' | ').slice(0, 600)}`); return; }
    receiptOf(replies[2 * i]!, `the export ${name}`);
    const top = readMovie(bytesOf(out), name).top;
    const moov = top.find((b) => b.type === 'moov'); const mdat = top.find((b) => b.type === 'mdat');
    if (!moov || !mdat || moov.start + moov.size > mdat.start) { f.push(`${name}: moov at byte ${moov?.start} comes after the first mdat byte, ${mdat?.start} (top level: ${top.map((b) => b.type).join(', ')})`); return; }
    expect(assetOf(replies[2 * i + 1]!, `the decode worker's probe of ${name}`).streams.some((s) => s.type === 'video'), `the decode worker reads ${name}`).toBe(true);
  });
  return f;
}
function moovRun(planted?: Planted): string[] {
  const evidence = temp(); const dir = temp();
  const outs = [join(dir, 'film.mp4'), join(dir, 'film.mov')];
  const replies = filmRun(shows.bin(FULL), evidence, filmDoc(evidence, { frames: 48 }), [
    exportCall({ out: outs[0]!, ...H264_AAC }), mediaImport(outs[0]!), exportCall({ out: outs[1]!, ...PRORES_PCM }), mediaImport(outs[1]!),
  ], 'the MP4 and MOV deliveries', planted);
  return moovFailures(replies, outs);
}

describe(`${AC[16]} every MP4 and MOV delivery puts its header first`, () => {
  it(`${AC[16]} the H.264 MP4 and the ProRes MOV each hold moov before the first mdat byte, and the decode worker reads them`, () => {
    none(moovRun(), 'the deliveries\' layout');
  }, TIMEOUT);

  it(`${AC[16]} a planted muxer that writes moov after mdat fails, naming the file`, () => {
    failsNaming(moovRun('muxer_writes_moov_last'), /^film\.mp4: moov\b/, 'the planted muxer (muxer_writes_moov_last)');
  }, TIMEOUT);
});

const CHAPTERS = [{ marker: 's1', name: 'Open', frame: 0 }, { marker: 's2', name: 'Middle', frame: 29 }, { marker: 's3', name: 'End', frame: 67 }];
/** AC17's judge: delivered, the receipt listing the three chapters, and each chapter's first frame a sync sample by
 * this suite's reading of the MP4 and a key frame by FFmpeg's. Each failure starts `chapter <marker>`. */
function chapterFailures(reply: JsonObject, out: string, dir: string): string[] {
  if (reply['outcome'] !== 'exported') {
    const named = (Array.isArray(reply['issues']) ? reply['issues'] : []).filter(isObject).filter((i) => typeof i['chapter'] === 'string');
    const f = named.map((i) => `chapter ${String(i['chapter'])}: ${JSON.stringify(i)}`);
    if (leftIn(dir).length) f.push(`chapters: the FAILed export left ${leftIn(dir).join(', ')}`);
    return f.length ? f : [`chapters: the export wasn't delivered and names no chapter: ${issueLines(reply).join(' | ').slice(0, 800)}`];
  }
  const f: string[] = [];
  const listed = arr(receiptOf(reply, 'the chaptered film').raw['chapters'], 'receipt.chapters').filter(isObject).map((c) => ({ marker: c['marker'], name: c['name'], frame: c['frame'] }));
  if (JSON.stringify(listed) !== JSON.stringify(CHAPTERS)) f.push(`chapters: the receipt lists ${JSON.stringify(listed)}, not ${JSON.stringify(CHAPTERS)}`);
  const video = trackOf(readMovie(bytesOf(out), 'the chaptered MP4'), 'vide', 'the chaptered MP4');
  const sample = sampleOfFrame(video);
  const key = ffVideoFrames(out).frames.map((x) => x.key);
  for (const c of CHAPTERS) {
    const s = sample[c.frame];
    if (video.syncSamples && (s === undefined || !video.syncSamples.includes(s))) f.push(`chapter ${c.marker}: frame ${c.frame}'s sample ${String(s)} isn't in the MP4's sync samples ${JSON.stringify(video.syncSamples.slice(0, 20))}`);
    if (key[c.frame] !== true) f.push(`chapter ${c.marker}: FFmpeg doesn't read frame ${c.frame} as a key frame`);
  }
  return f;
}
function chapterRun(planted?: Planted): string[] {
  const evidence = temp(); const dir = temp(); const out = join(dir, 'chapters.mp4');
  const markers = Object.fromEntries(CHAPTERS.map((c) => [c.marker, { kind: 'section', t: c.frame * D, name: c.name }]));
  const [reply] = filmRun(shows.bin(FULL), evidence, filmDoc(evidence, { frames: 96, markers }), [exportCall({ out, ...H264_AAC })], 'the film with three sections', planted);
  return chapterFailures(reply!, out, dir);
}

describe(`${AC[17]} each chapter starts on a sync sample`, () => {
  it(`${AC[17]} the film's chapters at frames 0, 29 and 67 each start on a sync sample of its MP4`, () => {
    none(chapterRun(), 'the chapters\' first frames');
  }, TIMEOUT);

  it(`${AC[17]} a planted delivery whose chapter starts aren't sync samples fails, naming the chapter`, () => {
    failsNaming(chapterRun('encoder_ignores_chapters'), /^chapter s2\b/, 'the planted encoder (encoder_ignores_chapters)');
  }, TIMEOUT);
});

describe(`${AC[19]} the export lists each strip its end cuts, and a brief may refuse them`, () => {
  it(`${AC[19]} in the 60 s film a strip from 55 s running 8 s is listed as a warning with its start and 3 s lost; a brief that refuses end cuts FAILs the export, naming the strip, with nothing written`, () => {
    const evidence = temp(); const dir = temp();
    const tail = soundStrip(evidence, toneChannels(8 * 48_000, 48_000), 48_000, 55 * FLICKS, 1);
    const doc = filmDoc(evidence, { frames: 1440, size: [64, 64], sound: 'none', assets: { tail: { sha256: tail.sha, license: { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Test tone.' } } }, strips: { tail: tail.strip } });
    const [warned, refused] = filmRun(shows.bin(FULL), evidence, doc, [
      exportCall({ out: join(dir, 'warned', 'film.mp4'), ...H264_AAC }),
      exportCall({ out: join(dir, 'refused', 'film.mp4'), ...H264_AAC, brief: { refuse: ['end_cut'] } }),
    ], 'the 60 s film with a strip past its end');
    const warnings = arr(receiptOf(warned!, 'the export with the end cut').raw['warnings'], 'receipt.warnings').filter(isObject).filter((w) => w['code'] === 'end_cut');
    expect(warnings.map((w) => ({ strip: w['strip'], start: w['start'], lost: w['lost'] })), 'one end cut is listed: the strip tail, from 55 s, 3 s lost (flicks)')
      .toEqual([{ strip: 'tail', start: 55 * FLICKS, lost: 3 * FLICKS }]);
    expect(refused!['outcome'], `the brief that refuses end cuts FAILs the export: ${issueLines(refused!).join(' | ').slice(0, 800)}`).toBe('failed');
    expect(issueLines(refused!).some((l) => l.includes('"strip":"tail"')), `an issue names the strip tail: ${issueLines(refused!).join(' | ').slice(0, 800)}`).toBe(true);
    expect(leftIn(join(dir, 'refused')), 'the FAILed export wrote nothing').toEqual([]);
  }, TIMEOUT);
});
