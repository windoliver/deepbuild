// AC2 #157.e50d5c52: "A planted NaN in one pixel of one frame fails naming the frame and item, and a forced device loss
// at frame 100 leaves no file and an issue naming frame 100"
// AC26 #157.65f8ee56: "In a delivery of the 60 s fixture film at 24 fps, a test item that draws a different color on
// its second draw of frame 1,000 stops the export in export.fidelity, with an issue naming frame 1,000 and no file left;
// a planted export.fidelity that compares with frames kept from the export's own pass, instead of drawing them again,
// passes that film and fails this test, naming frame 1,000"
//
// One build, `full,test-export-guards` (README: Cargo features): the shipped set with the test canvas module
// `test.guards`, whose items are the faults these criteria plant in a film: `test.nonfinite@1` writes one NaN into one
// pixel of the frame's float target on one frame, `test.device_loss@1` loses the GPU device when the export draws one
// frame, and `test.redraw@1` draws a rect in one colour, and in another the second time a process draws one frame.
// Through `deep-show run`'s `export`. The fixture films are 160 × 90 at 24 fps (helpers.ts `filmDoc`): 5 s for AC2,
// and for AC26 the 60 s fixture film with 48 kHz stereo, H.264 with AAC. Planted: `fidelity_keeps_frames`.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, GUARDS, H264_AAC, TIMEOUT, exportCall, failsNaming, filmDoc, filmRun, framesNamed, isObject, issueLines, issuesOf, leftIn, none, order, receiptOf,
  show, useShow, useTemp, type JsonObject, type Planted,
} from './helpers.ts';

const shows = useShow([GUARDS]);
const temp = useTemp();
const REQUIRES: JsonObject = { modules: { 'test.guards': '^1' } };
const guardItem = (id: string, kind: string, params: JsonObject): JsonObject => ({ id, kind, name: `Test ${id}`, order: order(20), params });

function exportOf(document: (evidence: string) => JsonObject, what: string, planted?: Planted): { reply: JsonObject; dir: string } {
  const evidence = temp(); const dir = temp();
  const [reply] = filmRun(shows.bin(GUARDS), evidence, document(evidence), [exportCall({ out: join(dir, 'film.mp4'), ...H264_AAC })], what, planted);
  return { reply: reply!, dir };
}

describe(`${AC[2]} a non-finite pixel fails naming its frame and item, and a lost device stops the export with no file left`, () => {
  it(`${AC[2]} the film delivers with an empty nonfinite list and the adapter named; a NaN in one pixel of frame 30 FAILs frames.finite naming frame 30 and the item nan; a device lost at frame 100 leaves no file and an issue naming frame 100`, () => {
    const clean = exportOf((e) => filmDoc(e, { frames: 120 }), 'the 5 s film');
    const r = receiptOf(clean.reply, 'the 5 s film').raw;
    expect(r['nonfinite'], 'the receipt lists no non-finite fallback').toEqual([]);
    const a = r['adapter'];
    expect(isObject(a) && typeof a['name'] === 'string' && typeof a['driver'] === 'string' && typeof a['backend'] === 'string' && a['software'] === false,
      `the receipt names the GPU adapter: {name, driver, backend, software: false}; got ${show(a ?? null)}`).toBe(true);

    const nan = exportOf((e) => filmDoc(e, { frames: 120, requires: REQUIRES, items: [guardItem('nan', 'test.nonfinite@1', { frame: 30, pixel: [10, 10] })] }), 'the film with a NaN on frame 30');
    expect(nan.reply['outcome'], `the NaN FAILs the export: ${issueLines(nan.reply).join(' | ').slice(0, 800)}`).toBe('failed');
    const finite = issuesOf(nan.reply, 'frames.finite');
    expect(finite.some((i) => framesNamed(i).includes(30) && i['item'] === 'nan'), `frames.finite names frame 30 and the item nan: ${issueLines(nan.reply).join(' | ').slice(0, 800)}`).toBe(true);
    expect(leftIn(nan.dir), 'the FAILed export wrote nothing').toEqual([]);

    const lost = exportOf((e) => filmDoc(e, { frames: 120, requires: REQUIRES, items: [guardItem('loss', 'test.device_loss@1', { frame: 100 })] }), 'the film whose device is lost at frame 100');
    expect(['stopped', 'failed'], `a lost device stops the export: ${issueLines(lost.reply).join(' | ').slice(0, 800)}`).toContain(lost.reply['outcome']);
    const named = (Array.isArray(lost.reply['issues']) ? lost.reply['issues'] : []).filter(isObject).filter((i) => i['code'] === 'device_lost' && framesNamed(i).includes(100));
    expect(named.length, `an issue device_lost names frame 100: ${issueLines(lost.reply).join(' | ').slice(0, 800)}`).toBe(1);
    expect(leftIn(lost.dir), 'no file is left at the output path or at a temporary name').toEqual([]);
  }, TIMEOUT);
});

/** The 60 s fixture film at 24 fps (1,440 frames, 48 kHz stereo), with the redraw item when `redraw`. */
const fixture60 = (redraw: boolean) => (evidence: string): JsonObject => filmDoc(evidence, {
  frames: 1440, ...(redraw ? { requires: REQUIRES, items: [guardItem('redraw', 'test.redraw@1', { box: [8, 60, 24, 24], fill: 'accent', again: 'white', frame: 1000 })] } : {}),
});
/** The judge: export.fidelity stops the export naming frame 1,000, and nothing is left. Each failure starts
 * `export.fidelity: frame 1000`. */
function redrawFailures(reply: JsonObject, dir: string): string[] {
  const at = 'export.fidelity: frame 1000';
  if (reply['outcome'] === 'exported') return [`${at}: the item draws frame 1000 in another colour the second time, and the export was delivered`];
  const f: string[] = [];
  if (!issuesOf(reply, 'export.fidelity').some((i) => framesNamed(i).includes(1000))) f.push(`${at}: no export.fidelity issue names frame 1000: ${issueLines(reply).join(' | ').slice(0, 800)}`);
  const left = leftIn(dir);
  if (left.length) f.push(`${at}: the stopped export left ${left.join(', ')}`);
  return f;
}

describe(`${AC[26]} export.fidelity draws each frame again, and a frame that draws differently stops the export`, () => {
  it(`${AC[26]} a test item that draws another colour on its second draw of frame 1,000 stops the export in export.fidelity, naming frame 1,000, with no file left`, () => {
    const { reply, dir } = exportOf(fixture60(true), 'the 60 s film with the redraw item');
    none(redrawFailures(reply, dir), 'the second draw of frame 1,000');
  }, TIMEOUT);

  it(`${AC[26]} a planted export.fidelity that compares with the frames kept from the export's own pass passes the 60 s film and fails this test, naming frame 1,000`, () => {
    const plain = exportOf(fixture60(false), 'the 60 s film', 'fidelity_keeps_frames');
    expect(receiptOf(plain.reply, 'the 60 s film under the planted fidelity').frame_hashes.length, 'the planted fidelity passes the 60 s film: 1,440 frames delivered').toBe(1440);
    const { reply, dir } = exportOf(fixture60(true), 'the 60 s film with the redraw item', 'fidelity_keeps_frames');
    failsNaming(redrawFailures(reply, dir), /^export\.fidelity: frame 1000\b/, 'the planted fidelity (fidelity_keeps_frames)');
  }, TIMEOUT);
});
