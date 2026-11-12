// AC3 #1965.47bbd705: A 2,000-line file of 120 bytes a line (240,000 bytes, 238,000 characters of display text) loads
// as one code item with its tokens and shows any of its lines, never refused for text@1's 4,096 characters; the same
// file grown to 262,145 bytes is refused, naming the item, its 262,145 bytes and the 256 KiB cap; and a text item whose
// own text runs to 4,097 characters is still refused, naming text@1's cap
//
// Four tests: the 240,000-byte file (checked, and its lines and tokens read as the anchors `#line:n` and `#tok:k` through
// `geometry`); the file at 262,145 bytes (refused) and at exactly 262,144 (loads); the cap counted in
// bytes, not characters (131,072 é of two bytes each load, one more is refused); and the text item at 4,097 and 4,096.
// The file's lines are letters only: an unquoted code item's digits count as numbers (Honest numbers), and this
// criterion is about the cap.
import { describe, expect, it } from 'vitest';
import { AC, ITEM, LOOK_A, ORIGIN, checkOne, codeDoc, describe as errors, geometryOf, naming, useBin, words, type Checked, type Token } from './helpers.ts';
import { backdrop, doc, item, shown } from '../467/helpers.ts';

const ID = AC[3];
const bin = useBin('deep-canvas-render');

const CAP = 262_144;
/** Line `i` of the file: `def `, a four-letter number, then letters, 119 characters and an LF: 120 bytes, no digit. */
function fileLine(i: number): string {
  let n = i; let id = '';
  for (let k = 0; k < 4; k++) { id = String.fromCharCode(97 + (n % 26)) + id; n = Math.floor(n / 26); }
  return `def ${id} ${'abcdefghij '.repeat(12)}`.slice(0, 119) + '\n';
}
const FILE = Array.from({ length: 2000 }, (_, i) => fileLine(i)).join('');
/** The file grown by whole 120-byte lines and a last short line to `total` bytes. */
function grown(total: number): string {
  let s = FILE; let i = 2000;
  while (Buffer.byteLength(s) + 120 <= total) s += fileLine(i++);
  const rest = total - Buffer.byteLength(s);
  return rest > 0 ? `${s}${'z'.repeat(rest - 1)}\n` : s;
}
const tokensOf = (lines: number): Token[] => Array.from({ length: lines }, (_, i) => ({ from: 120 * i, to: 120 * i + 3, class: 'keyword' }));
const mentions = (c: Checked, id: string, ...parts: (string | RegExp)[]): string[] => {
  const hits = naming(c, id).filter((e) => !(e.code === 'honest_numbers'));
  if (hits.length === 0) return [`no error names the item ${id}: ${errors(c)}`];
  const text = hits.map((e) => words(e).replace(/(\d),(\d)/g, '$1$2')).join(' ');
  return parts.filter((p) => (typeof p === 'string' ? !text.includes(p) : !p.test(text))).map((p) => `no error names ${id} with ${String(p)}: ${errors(c)}`);
};

describe(`${ID} the code cap and text@1's 4,096 characters`, () => {
  it(`${ID} a 2,000-line file of 120 bytes a line loads as one code item with its tokens and shows its lines and tokens`, () => {
    expect(Buffer.byteLength(FILE), 'the file is 240,000 bytes').toBe(240_000);
    expect(FILE.length - 2000, 'and 238,000 characters of display text (line ends aside)').toBe(238_000);
    const tokens = tokensOf(2000);
    const document = codeDoc('big-1965', FILE, { tokens, size: 12 });
    const c = checkOne(bin(), document, LOOK_A);
    expect(c.errors.map((e) => `${e.code} ${e.ids.join(',')} ${e.path}`), `the 240,000-byte file isn't refused (not for text@1's 4,096 characters, not for anything): ${errors(c)}`).toEqual([]);
    expect(c.ok, 'the check passes').toBe(true);

    // It shows any of its lines: each line is the anchor `#line:n` (1-based), each token `#tok:k` (0-based, as `tokens` is),
    // read through `geometry`, whose boxes are in document u. Rasterising 238,000 glyphs is minutes in the base's debug build, so
    // the glyphs aren't drawn here (README: Readings).
    const SIZE_U = 12; const LINE_H = Math.round(1.3 * SIZE_U); const ADVANCE = 0.6 * SIZE_U; // JetBrains Mono's advance is 0.6 em
    const ask = [`${ITEM}#line:1000`, `${ITEM}#line:2000`, `${ITEM}#line:2001`, `${ITEM}#tok:1999`];
    const boxes = geometryOf(bin(), document, LOOK_A, ask);
    const failures: string[] = [];
    const want = (n: number): [number, number] => [ORIGIN[0], ORIGIN[1] + (n - 1) * LINE_H];
    for (const [anchor, n] of [[ask[0]!, 1000], [ask[1]!, 2000]] as const) {
      const b = boxes.get(anchor);
      if (!b) { failures.push(`${anchor}: no box`); continue; }
      const [x, y] = want(n);
      if (Math.abs(b[0] - x) > 0.5 || Math.abs(b[1] - y) > 0.5) failures.push(`${anchor}: box at (${b[0]}, ${b[1]}), line ${n} is at (${x}, ${y})`);
      if (Math.abs(b[3] - LINE_H) > 0.5) failures.push(`${anchor}: box ${b[3]} u high, a line is ${LINE_H} u`);
      if (b[2] < 119 * ADVANCE - 1) failures.push(`${anchor}: box ${b[2]} u wide, its 119 characters are ${119 * ADVANCE} u`);
    }
    for (const [anchor, n] of [[ask[3]!, 2000]] as const) {
      const b = boxes.get(anchor);
      if (!b) { failures.push(`${anchor}: no box (a token's anchor)`); continue; }
      const [x, y] = want(n);
      if (Math.abs(b[0] - x) > 0.5 || Math.abs(b[1] - y) > 0.5 || Math.abs(b[2] - 3 * ADVANCE) > 0.5) failures.push(`${anchor}: box [${b.join(', ')}], the def of line ${n} is at (${x}, ${y}), ${3 * ADVANCE} u wide`);
    }
    if (boxes.get(ask[2]!)) failures.push(`${ask[2]}: the file has 2,000 lines, but line 2001 has a box`);
    expect(failures, `${failures.length} of the file's lines and tokens aren't shown where they are:\n  ${failures.join('\n  ')}`).toEqual([]);
  }, 1_800_000);

  it(`${ID} the file grown to 262,145 bytes is refused naming the item, 262,145 bytes and the 256 KiB cap; 262,144 bytes loads`, () => {
    const over = grown(CAP + 1);
    const at = grown(CAP);
    expect([Buffer.byteLength(over), Buffer.byteLength(at)], 'the files are 262,145 and 262,144 bytes').toEqual([262_145, 262_144]);
    const refused = checkOne(bin(), codeDoc('over-1965', over, { tokens: tokensOf(2000) }), LOOK_A);
    expect(refused.ok, `the check refuses the 262,145-byte item: ${errors(refused)}`).toBe(false);
    expect(mentions(refused, ITEM, '262145', /262144|256 ?KiB/), 'the refusal names the item, its 262,145 bytes and the cap').toEqual([]);
    const fix = naming(refused, ITEM).map((e) => String(e.raw['fix'] ?? '')).join(' ');
    expect(fix, 'its fix is to quote only the lines a film shows').toMatch(/quot/i);
    expect(fix, 'its fix is to quote only the lines a film shows').toMatch(/line/i);
    const exact = checkOne(bin(), codeDoc('at-1965', at, { tokens: tokensOf(2000) }), LOOK_A);
    expect(exact.errors.map((e) => `${e.code} ${e.ids.join(',')}`), `a raw of exactly 256 KiB (262,144 bytes) holds: ${errors(exact)}`).toEqual([]);
  });

  it(`${ID} the cap counts bytes: 131,072 é (262,144 bytes, half as many characters) loads and 131,073 are refused naming 262,146 bytes`, () => {
    const ok = checkOne(bin(), codeDoc('bytes-ok', 'é'.repeat(131_072)), LOOK_A);
    expect(ok.errors.map((e) => `${e.code} ${e.ids.join(',')}`), `131,072 é are 262,144 bytes and hold: ${errors(ok)}`).toEqual([]);
    const over = checkOne(bin(), codeDoc('bytes-over', 'é'.repeat(131_073)), LOOK_A);
    expect(over.ok, `131,073 é are 262,146 bytes and are refused: ${errors(over)}`).toBe(false);
    expect(mentions(over, ITEM, '262146', /262144|256 ?KiB/), 'the refusal names the item, its 262,146 bytes and the cap').toEqual([]);
  });

  it(`${ID} a text item whose own text runs to 4,097 characters is refused naming text@1's cap; 4,096 characters hold`, () => {
    const textDoc = (n: number): ReturnType<typeof doc> => doc(`text-${n}`, [900, 260], [backdrop([900, 260]), item(ITEM, 'text@1', 'a1', { text: 'abcdefghij '.repeat(n).slice(0, n), font: 'body', size: 12, box: { w: 800, h: 200 } }, { at: { pos: [20, 20, 0] } })]);
    const over = checkOne(bin(), textDoc(4097), LOOK_A);
    expect(over.ok, `the check refuses the 4,097-character text: ${errors(over)}`).toBe(false);
    expect(mentions(over, ITEM, /4096/), 'the refusal names the item and text@1\'s cap, 4,096 characters').toEqual([]);
    const at = checkOne(bin(), textDoc(4096), LOOK_A);
    expect(at.errors.filter((e) => e.ids.includes(ITEM)).map((e) => `${e.code}: ${shown(e.raw)}`), 'a text of exactly 4,096 characters holds').toEqual([]);
  });
});
