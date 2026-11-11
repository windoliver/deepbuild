// AC2: A formula whose `quote` names lines 3 to 4 of a paper's LaTeX source kept as evidence passes when its `alt`
// equals those lines' bytes, and fails quote_mismatch naming line 4 when one byte of its `alt` differs there; the same
// formula with no `quote` names no source.
// The paper's source is a 5-line LaTeX file, `paper/refraction.tex`, kept as evidence: the formula quotes it by its
// handle, `ev:<sha256>` (README: How evidence reaches the check). The formula is the `vector@1` item `eq` over a
// three-term SVG (outlines only, one id per term), its `alt` lines 3 and 4, a display formula over two lines, line ends
// included. The twin's `alt` has a tab in place of the first space of line 4: the same length, one byte apart, on
// line 4 alone. Without a quote, the formula is the agent's own (Vector and formula `vector@1`: quote).
import { describe, expect, it } from 'vitest';
import { TIMEOUT, check, checkAll, envelope, keep, linesOf, listed, naming, namesLine, put, sha256, shownErrors, shownListing, useFolders, useRender, type Folders, type JsonObject } from './helpers.ts';

const render = useRender();
const folders = useFolders('formula');

const PATH = 'paper/refraction.tex';
const PAPER = [
  String.raw`\section{Refraction}`,
  String.raw`Where light crosses from air into water, its angles obey`,
  String.raw`\[ n_1 \sin\theta_1`,
  String.raw`   = n_2 \sin\theta_2 \]`,
  String.raw`with both angles measured from the normal.`,
  '',
].join('\n');
const SOURCE = Buffer.from(PAPER, 'utf8');
const ALT = linesOf(PAPER, [3, 4]);
const TWIN = ALT.replace('\n   =', '\n\t  =');
const ITEM = 'eq';
const SVG = Buffer.from([
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 60" width="300" height="60">',
  '  <path id="t1" d="M 10 10 L 90 10 L 90 50 L 10 50 Z" fill="#000000"/>',
  '  <path id="t2" d="M 110 10 L 190 10 L 190 50 L 110 50 Z" fill="#000000"/>',
  '  <path id="t3" d="M 210 10 L 290 10 L 290 50 L 210 50 Z" fill="#000000"/>',
  '</svg>',
  '',
].join('\n'), 'utf8');

/** The formula, quoting the paper's lines 3 to 4 when `quoted`; one document ID, as one document revised. */
function formula(f: Folders, alt: string, quoted: boolean): JsonObject {
  const params: JsonObject = { src: put(f, SVG), size: [300, 60], colors: { '#000000': 'ink' }, alt };
  if (quoted) params['quote'] = { source: keep(f, SOURCE), path: PATH, lines: [3, 4] };
  const item: JsonObject = { id: ITEM, kind: 'vector@1', layer: 'main', name: 'Snell\'s law', order: 'a1', at: { pos: [24, 24, 0] }, params };
  return envelope('formula-1963', [item]);
}

describe('AC2 a formula\'s `quote` holds its `alt` to the LaTeX lines it names, kept as evidence', () => {
  it('AC2 the formula passes when its alt equals the bytes of lines 3 to 4', () => {
    expect(ALT, 'lines 3 to 4 are the display formula, line ends included').toBe('\\[ n_1 \\sin\\theta_1\n   = n_2 \\sin\\theta_2 \\]\n');
    const f = folders();
    const c = check(render(), formula(f, ALT, true), f);
    expect(c.errors.map((e) => `${e.code} ${e.ids.join(',')}`), `the alt matches its source's lines 3 to 4: ${shownErrors(c)}`).toEqual([]);
    expect(c.ok, 'the check passes').toBe(true);
  }, TIMEOUT);

  it('AC2 an alt one byte off on line 4 fails quote_mismatch naming line 4', () => {
    const [a, b] = [Buffer.from(ALT), Buffer.from(TWIN)];
    expect(b.length, 'the twin is as long as the quote').toBe(a.length);
    const off = [...a.keys()].filter((i) => a[i] !== b[i]);
    expect(off, 'one byte differs: the first of line 4').toEqual([a.indexOf('\n') + 1]);
    const f = folders();
    const c = check(render(), formula(f, TWIN, true), f);
    expect(c.ok, `the check fails: ${shownErrors(c)}`).toBe(false);
    const named = naming(c, 'quote_mismatch', ITEM);
    expect(named.length, `quote_mismatch names ${ITEM}: ${shownErrors(c)}`).toBeGreaterThan(0);
    expect(named.some((e) => namesLine(e, 4)), `quote_mismatch names line 4, the source's line that differs: ${shownErrors(c)}`).toBe(true);
  }, TIMEOUT);

  it('AC2 the same formula with no quote names no source', () => {
    const f = folders();
    // The quoted formula first, in the same process, then the same document with its quote taken out.
    const [, c] = checkAll(render(), [formula(f, ALT, true), formula(f, ALT, false)], f);
    if (!c) throw Error('the check answers twice');
    expect(c.errors.map((e) => `${e.code} ${e.ids.join(',')}`), `the formula reads as the agent's own and passes: ${shownErrors(c)}`).toEqual([]);
    expect(c.ok, 'the check passes').toBe(true);
    const answer = JSON.stringify(c.raw);
    const sha = sha256(SOURCE);
    expect(answer.includes(sha) || answer.includes(PATH), `the answer names neither the paper's handle nor its path: ${answer.slice(0, 3000)}`).toBe(false);
    for (const n of ['1', '2']) {
      expect(listed(c, ITEM, n, /quot/i), `nothing lists ${ITEM}'s ${n} as quotation: ${shownListing(c)}`).toEqual([]);
    }
  }, TIMEOUT);
});
