// #1510: every character the CLI marks prints as an escape, and ordinary text, Chinese and emoji print unchanged.
import { describe, expect, it } from 'vitest';
import { visible } from '../src/visible.js';

/** Each marked range, first and last code point: C0, DEL and C1, the direction and invisible characters, the tags. */
const MARKED: [number, number][] = [
  [0x00, 0x1f], [0x7f, 0x9f], [0x61c, 0x61c], [0x200b, 0x200b], [0x200e, 0x200f], [0x2028, 0x202e], [0x2060, 0x2064],
  [0x2066, 0x206f], [0xfeff, 0xfeff], [0xfff9, 0xfffb], [0xe0000, 0xe007f],
];
const SHORT: Record<number, string> = { 0x0a: '\\n', 0x0d: '\\r', 0x09: '\\t' };
const escape = (n: number) => SHORT[n] ?? (n < 0x100 ? `\\x${n.toString(16).padStart(2, '0')}` : `\\u{${n.toString(16)}}`);

describe('visible', () => {
  it('writes each marked character as its escape, in place', () => {
    for (const [from, to] of MARKED) {
      for (let n = from; n <= to; n++) expect(visible(`a${String.fromCodePoint(n)}b`), `U+${n.toString(16)}`).toBe(`a${escape(n)}b`);
    }
  });

  it('leaves the characters around each range, and joiners and variation selectors, as they are', () => {
    for (const n of [0x20, 0x7e, 0xa0, 0x61b, 0x200c, 0x200d, 0x2027, 0x202f, 0x2065, 0xfe0f, 0xfffc, 0xe0080]) {
      expect(visible(String.fromCodePoint(n)), `U+${n.toString(16)}`).toBe(String.fromCodePoint(n));
    }
  });

  it('prints plain text, Chinese and emoji unchanged', () => {
    for (const text of ['Push to main?', '结账页面的标题用哪种颜色？', 'Ship it? 🚀 ✅ 👍🏽 ❤️ 👨‍👩‍👧']) expect(visible(text)).toBe(text);
  });
});
