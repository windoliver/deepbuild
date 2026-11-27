// AC3 #1042.5bc230da: "A piece whose text shows 40 distinct Han graphemes bundles a subset of the CJK face under
// 200 KB, and the bundle's fonts render that text identically to the app's within one code value"
//
// The scroll (helpers.ts: The pieces) shows forty Han graphemes, counted here, which the look's fallback list sets in
// the bundled CJK face. Two tests, one a clause:
//   - the subset: the bundle of the scroll's web export names one font cut from the CJK face; that font's file is
//     under 200,000 bytes and keeps the face's name and licence (its family name, copyright line, licence and
//     licence address, read from both files' name tables); the face's licence text is in the bundle; and the whole
//     face is not.
//   - the render: the app's own render of the scroll's first frame (a still export) and the same frame as the
//     bundle's player draws it in headless Chrome, where the bundle's fonts are the only fonts there are, read back
//     from the player's canvas. The app's render must show the text; then every pixel's every channel is within one
//     code value. A copy of the bundle whose CJK font names another glyph of the face for each of the forty
//     graphemes (the face's character map moved by one glyph, made here) is ready and draws its frame too, and
//     fails the same check by its pixels.
// Wrong programs these fail: the merge base, on the first test (it bundles the whole face, 8,331,336 bytes); a
// subset that drops the face's name or licence records; a subset whose glyphs aren't the ones the text shows (cut
// with its glyphs renumbered and its character map left as it was, or lacking one), a player that draws the text in
// another face, and a blank frame, on the second. The second passes at the merge base, as it should: there the
// bundle's CJK font is the app's whole face.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, CJK_FACE, HAN_TEXT, SCROLL_BOX, SCROLL_INK, SCROLL_SIZE, TIMEOUT, appStill, bundleBytes, bundleWithFont, cjkFace, cjkLicence, codePoints, exportWeb, failsNaming,
  filesUnder, graphemes, manifestOf, none, receiptOf, scrollDoc, sha256, useShow, useTemp, useWeb,
} from './helpers.ts';
import { decodePng, renderFailures, shiftFailures, shiftedFace, subsetFailures, type Image } from './judges.ts';
import type { Browser } from './web.ts';

const show = useShow();
const temp = useTemp();
const web = useWeb();

/** "Under 200 KB": under 200,000 bytes, the font file's own size. */
const LIMIT = 200_000;

/** The scroll's text is what the criterion names: 40 graphemes, all distinct, each of the Han script. */
function countedText(): void {
  const all = graphemes(HAN_TEXT);
  expect(all.length, 'the scroll shows 40 graphemes').toBe(40);
  expect(new Set(all).size, 'all 40 are distinct').toBe(40);
  expect(all.filter((g) => !/^\p{Script=Han}$/u.test(g)), 'each is one Han character').toEqual([]);
}
/** The frame at the scroll's start as the player of the bundle in `folder` draws it, or why it drew none. */
async function drawn(browser: Browser, origin: string, folder: string, what: string): Promise<Image | string> {
  const page = await browser.page(`${origin}/${folder}/index.html`);
  try {
    await page.ready(what, 180_000);
    const canvas = await page.canvas(0);
    return canvas ? decodePng(canvas.png) : 'the page has no canvas';
  } catch (e) {
    if ((e as Error).message.startsWith('BLOCKED')) throw e;
    return (e as Error).message;
  } finally { await page.close(); }
}

describe(`${AC[3]} forty Han graphemes bundle a subset of the CJK face under 200 KB, and the bundle's fonts draw them as the app does, within one code value`, () => {
  it(`${AC[3]} the scroll's bundle holds one font cut from the CJK face, under 200 KB, that keeps the face's name and licence, and not the whole face`, () => {
    countedText();
    const out = join(temp(), 'scroll');
    receiptOf(exportWeb(show(), temp(), scrollDoc(), out, 'the scroll exported to the web'), out, 'the scroll exported to the web');
    const manifest = manifestOf(out, "the scroll's bundle");
    const cut = manifest.fonts.filter((f) => f.file === CJK_FACE);
    expect(cut.length, `the bundle names one font of the CJK face ${CJK_FACE}; its fonts: ${JSON.stringify(manifest.fonts)}`).toBe(1);
    const subset = bundleBytes(out, manifest, cut[0]!.sha256, "the bundle's CJK font");
    const face = cjkFace();

    const failures = subsetFailures(subset, face, LIMIT);
    const whole = sha256(face);
    for (const f of manifest.files) if (f.keyed === whole) failures.push(`the bundle still holds the whole CJK face (${f.path}, ${face.length.toLocaleString('en-US')} bytes)`);
    if (!manifest.files.some((f) => f.keyed === sha256(cjkLicence()))) failures.push("the bundle doesn't hold the CJK face's licence text (crates/deep-text/fonts/LICENSE-NotoSansSC.txt, byte for byte)");
    none(failures, `the bundle holds a subset of the CJK face under ${LIMIT.toLocaleString('en-US')} bytes that keeps the face's name and licence (${filesUnder(out).length} files)`);
  }, TIMEOUT);

  it(`${AC[3]} the bundle's fonts draw the forty graphemes as the app does, every pixel within one code value; a bundle whose CJK font names other glyphs for them does not`, async () => {
    countedText();
    const evidence = temp();
    const root = temp();
    const out = join(root, 'scroll');
    receiptOf(exportWeb(show(), evidence, scrollDoc(), out, 'the scroll exported to the web'), out, 'the scroll exported to the web');
    const app = appStill(show(), evidence, scrollDoc(), '0s', SCROLL_SIZE, [30, 1], temp(), "the app's render of the scroll");
    // The wrong program: the same bundle with, where its CJK font was, the face with its character map moved by one
    // glyph for the text's code points, so the player sets each grapheme in the glyph after its own.
    const face = cjkFace();
    const wrong = shiftedFace(face, codePoints(HAN_TEXT));
    if (typeof wrong === 'string') return expect.fail(`the wrong font can't be made from ${CJK_FACE}: ${wrong}`);
    none(shiftFailures(face, wrong, codePoints(HAN_TEXT)), 'the wrong font names, for each of the forty graphemes, the glyph after the one the face names');
    bundleWithFont(out, join(root, 'wrong'), wrong, 'the bundle with a CJK font that names other glyphs');

    const bundle = await web.serve(root);
    const browser = await web.browser();
    none(renderFailures(app, await drawn(browser, bundle.origin, 'scroll', 'the scroll'), SCROLL_BOX, SCROLL_INK), "the bundle's fonts render the forty graphemes as the app's do, within one code value");
    // It must fail by what it draws: a copy whose player drew no frame would prove nothing about the fonts.
    failsNaming(renderFailures(app, await drawn(browser, bundle.origin, 'wrong', 'the scroll with a CJK font that names other glyphs'), SCROLL_BOX, SCROLL_INK), 'more than one code value', 'a bundle whose CJK font names other glyphs for the text');
  }, TIMEOUT);
});
