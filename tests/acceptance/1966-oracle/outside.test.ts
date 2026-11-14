// The Oracle lane for #1966's AC2 (#1966.bbe0ca22): the pinned upstream list test, run on our code.
//
// The pinned upstream file (read in place, never copied: README) draws one list item with an outside marker whose
// two lines are the same words, in a box with a 50 px left padding. It passes "if the two lines of text are lined up
// with each other and there is a single bullet to the left of the lines of text". Here its two lines are read from
// the file and set as one item of our bullet list, `list: {marker: bullet, indent: <its padding>}`, in a box that holds
// the first line after the indent, so the item wraps where the file breaks it. Through `raster`, the file's assertion is
// judged on our glyphs and pixels by #1966's list judge: the item takes the file's two lines, the second starts at the
// first's x within 0.5 u, and one marker sits left of them, beside the first.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ORACLES, vendored } from '../1965-oracle/helpers.ts';
import { AC, LIST, LOOK, accepted, listDoc, listFailures, none, rasterAll, useBin, useDir, type Pt } from '../1966/helpers.ts';

const ID = AC[2];
const bin = useBin('deep-canvas-render');
const dir = useDir();

/** The pin: the upstream project's commit, as the Oracle page gives it, and the file's path in that project. */
const PIN = '2f57f45d21';
const FILE = 'css/CSS2/lists/list-style-position-021.xht';
/** The pinned file's text, from the vendor folder of the pin, or BLOCKED with the one thing to do (README). */
function pinned(): string {
  const vendor = join(ORACLES, 'vendor');
  const folder = existsSync(vendor) ? readdirSync(vendor).find((d) => d.endsWith(`-${PIN}`)) : undefined;
  return vendored(`${folder ?? `*-${PIN}`}/${FILE}`);
}

const SIZE = 16;
const AT: Pt = [60, 40];

describe(`${ID} the pinned upstream list test on our code`, () => {
  it(`${ID} the two lines of the pinned file's outside-marker item line up with each other, a single marker to their left`, () => {
    const file = pinned();
    expect(/list-style-position:\s*outside/.test(file), 'the pinned file sets its marker outside the item').toBe(true);
    const indent = Number(/padding-left:\s*(\d+)px/.exec(file)?.[1]);
    expect(indent, 'the pinned file gives its box a left padding in px').toBeGreaterThan(0);
    const body = /<span>([\s\S]*?)<\/span>/.exec(file)?.[1] ?? '';
    const lines = body.split(/<br\s*\/?>/).map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l !== '');
    expect(lines.length, `the pinned file's item has two lines: ${JSON.stringify(lines)}`).toBe(2);

    // The width of the file's first line, set alone in the same face and size, so the item's box holds it after the indent.
    const [alone] = rasterAll(bin(), dir(), [listDoc('line-1966', [lines[0]!], { size: SIZE, at: AT, w: 1000, page: [1100, 120] })], LOOK, undefined, LIST).map((d) => accepted(d, 'the first line alone'));
    const width = Math.max(...alone!.glyphs.map((g) => g.x + g.advance));
    const item = [lines.join(' ')];
    const [drawn] = rasterAll(bin(), dir(), [
      listDoc('outside-1966', item, { list: { marker: 'bullet', indent }, size: SIZE, at: AT, w: indent + width + 2, page: [Math.ceil(AT[0] + indent + width + 40), 200] }),
    ], LOOK, undefined, LIST).map((d) => accepted(d, 'the pinned file\'s item as our bullet list'));
    none(listFailures(drawn!, AT, item, 0, 2), 'the pinned file\'s assertion on our list');
  });
});
