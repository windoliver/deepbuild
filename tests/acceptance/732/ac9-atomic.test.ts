// AC9 #732.b38a3ba1: "An export stopped part way leaves no file, and exporting the same revision twice gives byte-identical
// files"
//
// Stopped part way, as #162's suite stops an export: the four-stage piece with #157's test item `test.device_loss@1
// {frame: 120}` (the build `full,test-export-guards`), which loses the GPU device as the export draws frame 120 at the
// piece's 30 fps, stage 3's settled frame, after stages 1 and 2 are drawn: the export stops (`stopped`, its issue
// `device_lost` at frame 120) and leaves nothing in out's folder, under out's name or a temporary one. Twice: the
// four-stage piece exported twice in one run and once in another, each to its own folder: the three files have one
// SHA-256 (fixed document times, nothing of the run in the file), and each folder holds only its deck. Wrong programs:
// a writer that writes the file in place as it goes, keeps a partial or temporary file, or stamps the time, a path or
// the run's ID into the package.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, FOUR, FULL, GUARDS, TIMEOUT, deliveredOf, filesUnder, fourStages, isObject, pptxExport, sha256, show, showRun, useShow, useTemp, type JsonObject,
} from './helpers.ts';

const shows = useShow([FULL, GUARDS]);
const temp = useTemp();

describe(`${AC[9]} an export stopped part way leaves no file; the same revision twice gives the same bytes`, () => {
  it(`${AC[9]} the four-stage piece that loses its device at stage 3's frame stops there and leaves nothing beside out`, () => {
    const ev = temp(); const dir = temp();
    const [reply] = showRun(shows.bin(GUARDS), ev, [[DOC.lost, fourStages(ev, { id: 'four-stages-lost', loss: true })]], [pptxExport(DOC.lost, join(dir, 'deck.pptx'))],
      'the four-stage piece that loses its device at frame 120');
    expect(reply?.['outcome'], `the export stops: ${show(reply, 1500)}`).toBe('stopped');
    const issues = (Array.isArray(reply?.['issues']) ? reply['issues'] : []).filter(isObject) as JsonObject[];
    const names = (i: JsonObject): boolean => i['frame'] === FOUR.lostFrame || (Array.isArray(i['frames']) && i['frames'].includes(FOUR.lostFrame));
    expect(issues.some((i) => i['code'] === 'device_lost' && names(i)), `the stop names the lost device at frame ${FOUR.lostFrame}: ${show(issues)}`).toBe(true);
    expect(filesUnder(dir).map(([p]) => p), "nothing is left in out's folder, under out's name or a temporary one").toEqual([]);
  }, TIMEOUT);

  it(`${AC[9]} the four-stage piece exported twice in one run and once in another gives three byte-identical files`, () => {
    const ev = temp();
    const dirs = [temp(), temp(), temp()];
    const first = showRun(shows.bin(FULL), ev, [[DOC.four, fourStages(ev)]], dirs.slice(0, 2).map((d) => pptxExport(DOC.four, join(d, 'deck.pptx'))), 'the four-stage piece, exported twice');
    const second = showRun(shows.bin(FULL), ev, [[DOC.four, fourStages(ev)]], [pptxExport(DOC.four, join(dirs[2]!, 'deck.pptx'))], 'the four-stage piece, exported in a second run');
    [...first, ...second].forEach((r, i) => deliveredOf(r, `export ${i + 1}`));
    const hashes = dirs.map((d) => sha256(readFileSync(join(d, 'deck.pptx'))));
    expect(new Set(hashes).size, `the three exports of one revision have the same bytes: ${hashes.join(', ')}`).toBe(1);
    dirs.forEach((d) => expect(filesUnder(d).map(([p]) => p), `${d}: the export leaves only its deck`).toEqual(['deck.pptx']));
  }, TIMEOUT);
});
