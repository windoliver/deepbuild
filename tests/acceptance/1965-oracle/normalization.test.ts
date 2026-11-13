// Oracle lane, criterion 2 (#1965.1d486d42): NormalizationTest.txt gives each string's NFC form, so a code item holding
// that string as its raw must display as it (e then U+0301 as U+00E9), and its byte range, as one token over the whole
// raw, must land on every glyph of it.
//
// Each distinct input of the file's five columns (c1, c2, c3 must display as c2; c4, c5 as c4) is one code item whose
// `raw` is the string and whose one token, class string, covers all its bytes. Our `check` leaves out a string no
// bundled face draws (`text.glyph_missing`, listed with its count); `raster` draws the rest, and each item's display text
// must equal the file's NFC form and each of its glyphs must be in a role other than the no-token baseline's.
import { describe, expect, it } from 'vitest';
import { drawn, drawable, hex, byteLen, normalizationCases, useBin, useDir } from './helpers.ts';
import { codeDoc, accepted, drawOne, LOOK_A, ITEM } from '../1965/helpers.ts';

const bin = useBin('deep-canvas-render');
const dir = useDir();

describe('#1965 oracle AC2 #1965.1d486d42: NormalizationTest.txt run on our code', () => {
  it('AC2 #1965.1d486d42 oracle: every drawable input displays as the file\'s NFC form, all its glyphs in its token\'s role', { timeout: 7_200_000 }, () => {
    const { cases, rows, skippedRows, conflicts } = normalizationCases();
    expect(conflicts, 'the file gives one NFC form per input').toEqual([]);
    const inputs = [...cases.keys()];
    expect(inputs.length, `the file's ${rows} rows give distinct inputs (${skippedRows} rows left out for a control code point)`).toBeGreaterThan(30_000);
    // The no-token baseline: the role the glyphs of a plain code item are drawn in.
    const base = accepted(drawOne(bin(), dir(), codeDoc('baseline', 'x', { size: 24 }), LOOK_A), 'the baseline');
    const baseRole = base.glyphs[0]!.role;
    const { ok, failures: refusals } = drawable(bin(), inputs);
    const run = inputs.filter((_, n) => ok[n]);
    expect(refusals, `check refuses some input for a reason other than a missing glyph`).toEqual([]);
    expect(run.length, `${run.length} of ${inputs.length} inputs are drawable by the bundled faces (${inputs.length - run.length} left out for text.glyph_missing)`).toBeGreaterThan(1000);
    expect(run.includes('é'), 'e, U+0301 (NormalizationTest\'s 0065 0301) is among the inputs run').toBe(true);
    const { texts, failures } = drawn(bin(), dir(), run, run.map((s) => [{ from: 0, to: byteLen(s), class: 'string' }]));
    const wrong: string[] = [...failures];
    run.forEach((s, n) => {
      const want = cases.get(s)!;
      const t = texts[n]!;
      if (t.shown !== want) wrong.push(`${hex(s)}: displays as ${hex(t.shown)}, the file says ${hex(want)}`);
      else if (t.glyphs.length === 0 || t.glyphs.some((g) => g.role === baseRole)) wrong.push(`${hex(s)}: the token over bytes [0, ${byteLen(s)}) leaves ${t.glyphs.filter((g) => g.role === baseRole).length} of ${t.glyphs.length} glyphs in the plain role ${baseRole}`);
    });
    expect(wrong, `${wrong.length} of ${run.length} inputs differ from NormalizationTest.txt (item ${ITEM}):\n  ${wrong.slice(0, 40).join('\n  ')}`).toEqual([]);
  });
});
