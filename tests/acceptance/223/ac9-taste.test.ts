// AC9 #223.85ce0afe: "Shown to you: screenshots of the 21 × 21 line grid warped by cmul(z, z), the homotopy line and an
// arrow under shear, taken by the check run from the canvas's own frames, with a recording of the homotopy as mix
// moves, are attached to the PR and shown to you in the session. Whether they look right is one taste call, recorded;
// without it the run stays INCONCLUSIVE, never PASS, and no criterion above reads a picture to judge it"
//
// Three screenshots, each `deep-canvas-render raster`'s own PNG (Vello CPU, the canvas's frame), kept byte for byte:
// criterion 1's grid under cmul(z, z) at mix 1, criterion 4's homotopy at 0.75 s, and criterion 5's arrow under the
// shear with `ends: redraw`. One recording: the homotopy with its mix keyed from 0 to 1 over its 1 s, the raster's
// own frames at 30 fps (frames 0 to 29), put into one animated PNG unchanged. They are kept in DEEPBUILD_EVIDENCE_DIR
// (else a folder under the temporary folder) and their paths printed, for the PR and the session.
// The taste call is a file you record, named by DEEPBUILD_TASTE_223: {"criterion": "#223.85ce0afe", "by": "you",
// "screenshots": [sha256 × 3], "recordings": [sha256 × 1], "call": "looks_right" | "looks_wrong"}. With no record, or
// one made on other files, the test fails as INCONCLUSIVE; looks_wrong fails it. No other test reads a picture.
// Nobody but you records the call; this job records none.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, FLICKS, TIMEOUT, Z_SQUARED, apng, arrowDoc, decodePng, evidenceDir, fl, gridDoc, homotopyDoc, inconclusive, rasterPlay, sha256, useBins,
  useFolders, type JsonObject,
} from './helpers.ts';

const bin = useBins(['render']);
const folder = useFolders();
const ID = AC[9].split(' ')[1]!;
const REC_FPS = 30;

describe(`${AC[9]} one taste call on the canvas's own screenshots and recording`, () => {
  it(`${AC[9]} the grid under cmul(z, z), the homotopy line and the sheared arrow, with a recording of the homotopy as its mix moves, and the recorded taste call says they look right`, () => {
    const dir = folder();
    const shots: [string, JsonObject, number][] = [
      ['grid-z-squared', gridDoc('warp-taste-grid', Z_SQUARED(1)), 0],
      ['homotopy-line', homotopyDoc('warp-taste-homotopy'), fl(0.75)],
      ['arrow-shear', arrowDoc('warp-taste-arrow', 'redraw'), 0],
    ];
    const keep = evidenceDir();
    mkdirSync(keep, { recursive: true });
    const screenshots: string[] = [];
    for (const [name, doc, t] of shots) {
      const png = readFileSync(rasterPlay(bin('render'), dir, doc, [t], name)[0]!);
      const file = join(keep, `${name}-${sha256(png)}.png`);
      writeFileSync(file, png);
      screenshots.push(sha256(png));
      console.log(`for the taste call: ${file}`);
    }
    const times = Array.from({ length: REC_FPS }, (_, k) => Math.round((k * FLICKS) / REC_FPS));
    const frames = rasterPlay(bin('render'), dir, homotopyDoc('warp-taste-homotopy-mix', [[0, 0], [1, 1]]), times, 'the homotopy as its mix moves');
    const anim = apng(frames.map((f) => decodePng(readFileSync(f))), REC_FPS);
    const recFile = join(keep, `homotopy-mix-${sha256(anim)}.apng`);
    writeFileSync(recFile, anim);
    const recordings = [sha256(anim)];
    console.log(`for the taste call: ${recFile}`);

    const path = process.env['DEEPBUILD_TASTE_223'];
    const files = `screenshots ${screenshots.join(', ')}; recordings ${recordings.join(', ')}`;
    if (!path || !existsSync(path)) inconclusive(`no taste call is recorded on these files (${files}); record yours in a file named by DEEPBUILD_TASTE_223`);
    const record = JSON.parse(readFileSync(path, 'utf8')) as { criterion?: string; by?: string; screenshots?: string[]; recordings?: string[]; call?: string };
    const same = (a: string[] | undefined, b: string[]): boolean => JSON.stringify([...(a ?? [])].sort()) === JSON.stringify([...b].sort());
    if (record.criterion !== ID || record.by !== 'you' || !same(record.screenshots, screenshots) || !same(record.recordings, recordings)) {
      inconclusive(`the recorded taste call at ${path} isn't yours on these files (${files})`);
    }
    expect(record.call, 'your taste call').toBe('looks_right');
  }, TIMEOUT);
});
