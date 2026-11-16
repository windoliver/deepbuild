// AC4 #162.b38a3ba1: "An export stopped part way leaves no file, and exporting the same revision twice gives
// byte-identical files"
//
// "Stopped part way": #157's test item `test.device_loss@1 {frame: 24}` (the build `full,test-export-guards`) loses the
// GPU when the export draws frame 24, which the Lottie export draws only for its fidelity check, after its writer has
// written the file under its temporary name: the export must stop naming frame 24 and leave nothing in out's folder.
// "Twice": the title exported twice in one run and once in another, each to its own folder, as JSON and as a dotLottie
// container; every file of one form has the same bytes (SHA-256).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, FULL, GUARDS, TIMEOUT, framesNamed, isObject, item, leftIn, lottieExport, sha256, show, showRun, titleDoc, useShow, useTemp, type JsonObject,
} from './helpers.ts';

const shows = useShow([FULL, GUARDS]);
const temp = useTemp();

describe(`${AC[4]} an export stopped part way leaves no file; the same revision twice gives the same bytes`, () => {
  it(`${AC[4]} the title whose device is lost at frame 24, in its fidelity check, stops naming frame 24 and leaves nothing beside out`, () => {
    const evidence = temp(); const dir = temp();
    const doc = titleDoc(evidence, 'bezier', [item('loss', 'test.device_loss@1', 'Device loss', 'a09', { frame: 24 })], { modules: { 'test.guards': '^1' } });
    const [reply] = showRun(shows.bin(GUARDS), evidence, [doc], [lottieExport(0, join(dir, 'title.json'))], 'the title that loses its device at frame 24');
    expect(reply!['outcome'], `the export stops: ${show(reply!, 1500)}`).toBe('stopped');
    const issues = (Array.isArray(reply!['issues']) ? reply!['issues'] : []).filter(isObject) as JsonObject[];
    expect(issues.some((i) => i['code'] === 'device_lost' && framesNamed(i).includes(24)), `the stop names the lost device at frame 24: ${show(issues)}`).toBe(true);
    expect(leftIn(dir), 'nothing is left in out\'s folder, under out\'s name or a temporary one').toEqual([]);
  }, TIMEOUT);

  it(`${AC[4]} the title exported twice in one run and again in another writes the same bytes each time, as JSON and as dotLottie`, () => {
    const evidence = temp();
    const dirs = [temp(), temp(), temp()];
    const calls = (d: string[]): JsonObject[] => d.flatMap((dir) => [
      lottieExport(0, join(dir, 'title.json')),
      lottieExport(0, join(dir, 'title.lottie'), { lottie: { container: 'dotlottie', images: 'embed' } }),
    ]);
    const first = showRun(shows.bin(FULL), evidence, [titleDoc(evidence)], calls(dirs.slice(0, 2)), 'the title, exported twice');
    const second = showRun(shows.bin(FULL), evidence, [titleDoc(evidence)], calls(dirs.slice(2)), 'the title, exported in a second run');
    [...first, ...second].forEach((r, i) => expect(r['outcome'], `export ${i + 1} is delivered: ${show(r, 800)}`).toBe('exported'));
    for (const name of ['title.json', 'title.lottie']) {
      const hashes = dirs.map((d) => sha256(readFileSync(join(d, name))));
      expect(new Set(hashes).size, `${name}: the three exports of one revision have the same bytes: ${hashes.join(', ')}`).toBe(1);
      dirs.forEach((d) => expect(leftIn(d), `${d}: the export leaves only its two files`).toEqual(['title.json', 'title.lottie']));
    }
  }, TIMEOUT);
});
