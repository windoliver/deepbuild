import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO, TEXT_BIN, fitAll, fixture, isObject, number, one, useBinaries, type JsonObject, type JsonValue } from './helpers.ts';

useBinaries('deep-text');

interface FitCase { name: string; input: JsonObject; expect: { fits: boolean; shown?: string; lines?: number; ellipsized?: boolean } }

const ELLIPSIS = '…';

describe('AC2 bound numbers use tabular figures and are never cut short, and text that does not fit its widest string fails the fit check', () => {
  it('AC2 the fit fixtures: a number never fits by being cut, a widest string that does not fit fails, plain text is ellipsized', () => {
    const cases = fixture<{ cases: FitCase[] }>('fit.json').cases;
    const outs = fitAll(cases.map((c) => c.input));
    cases.forEach((c, i) => {
      const out = outs[i]!;
      const what = `${c.name} (${JSON.stringify(c.input)}) gave ${JSON.stringify(out)}`;
      expect(out['fits'], `fits: ${what}`).toBe(c.expect.fits);
      const shown = out['shown'];
      expect(typeof shown, `shown is the text as drawn: ${what}`).toBe('string');
      if (c.expect.shown !== undefined) {
        // A mutant that ellipsizes or truncates a number fails here: a number is shown whole or not at all.
        expect(shown, `shown whole, never cut: ${what}`).toBe(c.expect.shown);
      }
      if (c.expect.lines !== undefined) {
        // A mutant that wraps a number onto a second line fails here.
        expect(out['lines'], `lines: ${what}`).toBe(c.expect.lines);
      }
      if (c.expect.ellipsized) {
        const text = String(c.input['text']);
        expect((shown as string).endsWith(ELLIPSIS), `plain text over its line ends in an ellipsis: ${what}`).toBe(true);
        expect((shown as string).length < text.length, `the ellipsized text is shorter than the text: ${what}`).toBe(true);
      }
      expect(number(out['width'], `width: ${what}`) > 0, `a positive width: ${what}`).toBe(true);
    });
  });

  it('AC2 the widest string governs: a box one pixel narrower than the widest string fails the fit check that the text alone passes', () => {
    const [widest, text] = fitAll([{ text: '100,000.00', number: true }, { text: '42', number: true }]);
    const widestWidth = number(widest!['width'], 'the widest string\'s measured width');
    const textWidth = number(text!['width'], 'the text\'s measured width');
    expect(textWidth > 0 && widestWidth > textWidth, `"100,000.00" (${widestWidth}) measures wider than "42" (${textWidth})`).toBe(true);
    const box = { w: Math.floor(widestWidth) - 1, h: 40 };
    const [withWidest, alone, roomy] = fitAll([
      { text: '42', number: true, widest: '100,000.00', box },
      { text: '42', number: true, box },
      { text: '42', number: true, widest: '100,000.00', box: { w: Math.ceil(widestWidth) + 1, h: 40 } },
    ]);
    // A program that checks only the text in the box, not its widest string, fails here.
    expect(withWidest!['fits'], `"42" with widest "100,000.00" in a ${box.w} px box does not fit: ${JSON.stringify(withWidest)}`).toBe(false);
    expect(alone!['fits'], `"42" alone in a ${box.w} px box fits: ${JSON.stringify(alone)}`).toBe(true);
    expect(roomy!['fits'], `"42" with its widest string in a box one pixel wider than the widest string fits: ${JSON.stringify(roomy)}`).toBe(true);
    expect(withWidest!['shown'], 'the text is shown whole whether or not it fits').toBe('42');
  });

  it('AC2 tabular figures: every digit has one advance in a bound number, at 13 px and at 24 px', () => {
    for (const size of [13, 24]) {
      const digits = '0123456789'.split('');
      const outs = fitAll(digits.map((d) => ({ text: d.repeat(4), number: true, size })));
      const widths = outs.map((o, i) => number(o['width'], `width of ${digits[i]!.repeat(4)} at ${size} px`));
      const spread = Math.max(...widths) - Math.min(...widths);
      // A mutant that shapes bound numbers with proportional figures fails here for any face whose
      // "1" is narrower than its "0" (the bundled body face among them).
      expect(spread <= 0.01, `tabular figures at ${size} px: four of each digit measure ${JSON.stringify(Object.fromEntries(digits.map((d, i) => [d, widths[i]])))}, a spread of ${spread}`).toBe(true);
      expect(widths[0]! > 0, 'a positive width').toBe(true);
    }
  });

  it('AC2 numerals tabular on plain text gives the same one advance per digit, and the width scales with the count', () => {
    const outs = fitAll([
      { text: '1111', numerals: 'tabular' }, { text: '8888', numerals: 'tabular' },
      { text: '11111111', numerals: 'tabular' },
    ]);
    const ones = number(outs[0]!['width'], 'width of 1111'); const eights = number(outs[1]!['width'], 'width of 8888');
    const eightOnes = number(outs[2]!['width'], 'width of 11111111');
    expect(Math.abs(ones - eights) <= 0.01, `1111 (${ones}) and 8888 (${eights}) measure alike with tabular numerals`).toBe(true);
    expect(Math.abs(eightOnes - 2 * ones) <= 0.5, `11111111 (${eightOnes}) measures about twice 1111 (${ones}): one advance per digit`).toBe(true);
  });
});

describe('It can never: use a system font, or shape text in a face the look does not bundle', () => {
  it('fonts lists the body role with a font file bundled in the repo', () => {
    const out = one(TEXT_BIN, ['fonts'], {});
    expect(out['ok'], `fonts answers ok: ${JSON.stringify(out)}`).toBe(true);
    const fonts = out['fonts'];
    expect(Array.isArray(fonts), `fonts is a list: ${JSON.stringify(out)}`).toBe(true);
    const list = (fonts as JsonValue[]).filter(isObject);
    const body = list.find((f) => f['role'] === 'body');
    expect(body, `a body role among ${JSON.stringify(list)}`).toBeDefined();
    for (const font of list) {
      const file = String(font['file']);
      const path = join(REPO, file);
      expect(existsSync(path), `the ${String(font['role'])} face's file ${file} exists in the checkout`).toBe(true);
      const magic = readFileSync(path).subarray(0, 4);
      const tags = ['OTTO', 'true', 'ttcf', 'wOF2', 'wOFF'];
      const isFont = tags.includes(magic.toString('latin1')) || magic.equals(Buffer.from([0, 1, 0, 0]));
      expect(isFont, `${file} starts with a font signature, got ${magic.toString('hex')}`).toBe(true);
    }
  });

  it('a font role the look does not bundle is refused with bad_font, never resolved from the system', () => {
    const outs = ['system-ui', 'Helvetica', 'Arial', '.AppleSystemUIFont'].map((font) => one(TEXT_BIN, ['fit'], { text: 'Ready', font }));
    for (const out of outs) {
      expect(out['ok'], `refused: ${JSON.stringify(out)}`).toBe(false);
      expect(out['code'], `code bad_font: ${JSON.stringify(out)}`).toBe('bad_font');
    }
  });

  it('a line that lacks text is answered with bad_input and no panic', () => {
    const outs = one(TEXT_BIN, ['fit'], { box: { w: 10 } });
    expect(outs['ok']).toBe(false);
    expect(outs['code']).toBe('bad_input');
  });
});
