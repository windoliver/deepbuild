// AC3 #1040.d2344cb1: "Read back from its own bytes, the lab's bundle holds every file the document, the player and the
// fallback page name, each matching its hash, and an input track whose hash equals the app's, and each clip of its
// fallback page, decoded from the bundle's bytes, passes export.fidelity with its frames and sample frames exact; a
// planted export that leaves out one font fails, naming the font, and leaves no bundle; and a bundle with a texture
// removed after export never reports ready or plays, naming the texture, and no frame draws the texture's item without
// it, other than as its proxy while files arrive"
//
// The lab (helpers.ts `labDoc`): a world whose puck the press `kick` launches, a goal cut by a cutaway, a poster whose
// material's base color map is a PNG (the texture), a 3D label (a font), a tour of two kicks, past the page's caps.
// asserts:
//   - the app's input track: the recorded kicks loaded whole into the hub (#1164's `track` call), and its hash;
//   - the lab's web export, carrying those kicks: every file its receipt names is in the bundle by hash and nothing
//     else is; every file its index page names by hash is a receipt file; the texture the document names is a bundle
//     file by its hash; a bundle file's SHA-256 is the app's track hash; the receipt marks the fallback page and every
//     file that page names (stills, clips, its index page's scripts and styles) is there by hash;
//   - each clip of the fallback page, decoded from the bundle's bytes by the app's decode worker (#498's media_decode),
//     holds exactly the frames its span gives at 30 fps and, with sound, exactly its sample frames per channel, and every
//     frame's luma is within export.fidelity's floor (35 dB, standard) of the app's own frame of that play (README:
//     Readings);
//   - the planted `web_leaves_out_font` export is not delivered, names a font file of the clean bundle (its path or its
//     SHA-256), and leaves nothing in its output's folder;
//   - a copy of the clean bundle with the texture's file removed, opened with WebGPU on: for 30 s the player never reports
//     ready, probe() never reports the poster drawn in full (README: probe()), a notice names the texture (its SHA-256 or
//     its path), and play() moves no clock.
// Wrong programs: the merge base (no fallback page; the planted name answers bad_input); the planted export; the bundle
// with its texture removed (a player that draws the poster without it, or plays, fails).
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, FULL, LAB, TIMEOUT, appTrackHash, bundleFailures, clipFailures, closeBundle, copyBundle, exportWeb, fallbackFileFailures, fallbackOf, indexFailures, isObject,
  labDoc, labTrack, mentions, none, openBundle, show, unwritten, useBrowsers, useShow, useTemp, webReceipt,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const browsers = useBrowsers();
const PLANTED = 'web_leaves_out_font';
const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

describe(`${AC[3]} the lab's bundle read back: every file by hash, the app's input track, clips true to the app's frames`, () => {
  it(`${AC[3]} the lab's bundle holds every file the document, the player and the fallback page name by hash, the app's input track by its hash, and clips that decode exactly and within export.fidelity's floor`, () => {
    const evidence = temp();
    const { doc, texture } = labDoc(evidence);
    const track = labTrack();
    const appHash = appTrackHash(shows(FULL), evidence, doc, track, 'the lab');
    const out = join(temp(), 'bundle');
    const receipt = webReceipt(exportWeb(shows(FULL), evidence, doc, out, 'the lab exported to the web', { track }), 'the lab exported to the web');
    none(bundleFailures(out, receipt, "the lab's bundle"), 'the bundle holds every file its receipt names, each by its hash, and nothing else');
    none(indexFailures(out, receipt, "the lab's index page"), "every file the index page and the player name is in the bundle, by its hash");
    expect(receipt.files.some((f) => f.sha256 === texture), `the bundle holds the texture the document names, by its hash ${texture}`).toBe(true);
    expect(receipt.files.some((f) => f.sha256 === appHash), `the bundle holds the input track whose hash is the app's, ${appHash}; its files: ${receipt.files.map((f) => f.sha256.slice(0, 12)).join(', ')}`).toBe(true);
    const fb = fallbackOf(out, receipt, "the lab's bundle");
    none(fallbackFileFailures(out, receipt, fb, "the lab's fallback page"), 'every file the fallback page names is in the bundle, by its hash');
    const clips = fb.manifest.edges.filter((e) => e.clip !== null);
    expect(clips.length, "the lab's fallback page plays clips: its tour's kicks").toBeGreaterThan(0);
    const dir = temp();
    none(clips.flatMap((e) => clipFailures(shows(FULL), evidence, doc, out, fb, e, LAB.rate, 48_000, dir, "the lab's fallback page")),
      "each clip, decoded from the bundle's bytes, holds exactly its frames and sample frames and passes export.fidelity's floor");
  }, TIMEOUT);

  it(`${AC[3]} the planted ${PLANTED} fails naming the font and leaves no bundle; a bundle with its texture removed never reports ready or plays, names the texture, and never draws the poster without it`, async () => {
    const evidence = temp();
    const { doc, texture } = labDoc(evidence);
    const track = labTrack();
    const out = join(temp(), 'bundle');
    const receipt = webReceipt(exportWeb(shows(FULL), evidence, doc, out, 'the lab exported to the web', { track }), 'the lab exported to the web');
    const fonts = receipt.files.filter((f) => /\.(ttf|otf|woff2?)$/i.test(f.path));
    expect(fonts.length, "the lab's bundle holds a font, its label's face").toBeGreaterThan(0);
    const plantedOut = join(temp(), 'bundle');
    const reply = exportWeb(shows(FULL), evidence, doc, plantedOut, `the lab (planted ${PLANTED})`, { track, planted: PLANTED });
    unwritten(reply, plantedOut, `the planted ${PLANTED}`);
    expect(fonts.some((f) => mentions(reply, f.path) || mentions(reply, f.sha256)), `the planted export's failure names the font it left out, one of ${fonts.map((f) => f.path).join(', ')}: ${show(reply)}`).toBe(true);

    const file = receipt.files.find((f) => f.sha256 === texture);
    expect(file, `the bundle holds the texture ${texture}`).toBeTruthy();
    const copy = copyBundle(out, join(temp(), 'no-texture'));
    rmSync(join(copy, file!.path));
    const o = browsers(await openBundle(copy, { webgpu: true }));
    const drawnBare: string[] = [];
    let ready = false;
    for (const until = Date.now() + 30_000; Date.now() < until; await sleep(500)) {
      if ((await o.tab.player()).ready) ready = true;
      const p = await o.tab.probe();
      const drawn = p && isObject(p['drawn']) ? p['drawn'][LAB.textured] : undefined;
      if (drawn === 'full') drawnBare.push(`a frame (${show(p?.['frames'] ?? null)} drawn) draws ${LAB.textured} in full though its texture never arrived`);
    }
    expect(ready, 'with its texture removed, the player never reports ready').toBe(false);
    const notices = (await o.tab.player()).notices;
    expect(notices.some((n) => n.includes(texture) || n.includes(file!.path)), `a notice names the texture (${texture} or ${file!.path}); the notices: ${JSON.stringify(notices)}`).toBe(true);
    const clock = await o.tab.evaluate<number>(`(async () => { const p = document.querySelector('deep-player'); if (!p) return 0; try { p.play(); } catch {} await new Promise((d) => setTimeout(d, 1000)); return p.currentTime; })()`, 30_000, true);
    expect(clock, "and it doesn't play: its clock stays at 0").toBe(0);
    none(drawnBare, 'no frame draws the textured item without its texture, other than as its proxy');
    await closeBundle(o);
  }, TIMEOUT);
});
