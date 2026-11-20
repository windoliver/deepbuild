// AC8 #732.6a9b72a2: "A font whose license doesn't allow embedding is named, never embedded, and the receipt says so"
//
// The named-font piece (helpers.ts `namedFontPiece`): one text in the body face, under a look (by asset) that is the
// clean look with its body face, Inter, recorded with a licence that doesn't allow embedding (`license:
// LicenseRef-no-embedding`, `embed: false`; README: Fixtures, for why the look's own record is how a font's licence
// reaches the export). Exported with `pptx.fonts: embed_allowed`: the text box's runs name the family Inter; no
// `p:embeddedFont` names Inter, and no part of the package holds font data (under ppt/fonts/, a font file's extension
// or a font content type) that an embedded font of another family doesn't list; and the receipt's slide lists
// `{family: Inter, embedded: false}` and never Inter as embedded. Wrong programs: Inter embedded because its file's own
// bits allow it, font data left in the package unlisted, the family dropped from the runs, a receipt that says
// embedded or leaves the family out.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fontParts } from './ooxml.ts';
import { AC, DOC, FULL, NAMED, TIMEOUT, deckAt, deliveredOf, namedFontPiece, none, pptxExport, show, showRun, useShow, useTemp } from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const same = (a: string | null, b: string): boolean => (a ?? '').trim().toLowerCase() === b.toLowerCase();

describe(`${AC[8]} a font whose licence doesn't allow embedding is named, never embedded, and the receipt says so`, () => {
  it(`${AC[8]} Inter, recorded as not embeddable, is named in the runs, embedded nowhere in the package, and listed as named in the receipt`, () => {
    const ev = temp(); const dir = temp(); const out = join(dir, 'deck.pptx');
    const [reply] = showRun(shows.bin(FULL), ev, [[DOC.named, namedFontPiece(ev)]], [pptxExport(DOC.named, out, { fonts: 'embed_allowed' })], 'the named-font piece');
    const { slides } = deliveredOf(reply, "the named-font piece's deck");
    const deck = deckAt(out, "the named-font piece's deck");
    const failures: string[] = [];
    const box = deck.slides[0]?.shapes.find((s) => s.kind === 'text' && s.text === NAMED.text);
    if (!box) failures.push(`slide 1 has no text box saying ${JSON.stringify(NAMED.text)}`);
    else if (!box.runs.every((r) => same(r.family, NAMED.family))) failures.push(`the text's runs don't name ${NAMED.family}: ${show(box.runs.map((r) => r.family))}`);
    const embedded = deck.fonts.filter((f) => same(f.typeface, NAMED.family));
    if (embedded.length) failures.push(`the package embeds ${NAMED.family}: ${JSON.stringify(embedded)}`);
    const listed = new Set(deck.fonts.filter((f) => !same(f.typeface, NAMED.family)).flatMap((f) => f.parts));
    const stray = fontParts(deck).filter((p) => !listed.has(p));
    if (stray.length) failures.push(`the package holds font data no other family's embedded font lists: ${stray.join(', ')}`);
    expect(slides.length, 'the receipt lists the one slide').toBe(1);
    const faces = slides[0]!.fonts.filter((f) => same(f.family, NAMED.family));
    if (!faces.some((f) => !f.embedded)) failures.push(`the receipt's slide doesn't list ${NAMED.family} as named (embedded: false): ${show(slides[0]!.fonts)}`);
    if (faces.some((f) => f.embedded)) failures.push(`the receipt's slide lists ${NAMED.family} as embedded: ${show(slides[0]!.fonts)}`);
    none(failures, `${NAMED.family}, whose licence doesn't allow embedding`);
  }, TIMEOUT);
});
