// #1510: every character the CLI marks prints as an escape, and ordinary text, Chinese and emoji print unchanged.
// #2563: an option ID as `deep inbox` prints it is what a POSIX shell gives back as that ID.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { typed, visible } from '../src/visible.js';

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

describe('typed', () => {
  // The shells a person types into that read `$'…'`: bash (macOS /bin/sh too), zsh and ksh93, where installed. dash
  // before 0.5.13 has no `$'…'`, so an ID holding a marked character can't be typed there (#2563's platform limit).
  const shells = ['/bin/bash', '/bin/zsh', '/bin/ksh'].filter((s) => existsSync(s));
  /** What `shell` passes a command for `text` typed after it. */
  const words = (shell: string, text: string): string[] => execFileSync(shell, ['-c', `printf '%s\\0' ${text}`], { encoding: 'utf8' }).split('\0').slice(0, -1);
  const lone = /\0|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
  const odd = fc.constantFrom(' ', ',', '(', ')', "'", '"', '\\', '$', '`', '-', '=', '~', '#', '!', '*', '?', '[', '{', ';', '&', '|', '<', '\n', '\t', '\u001b', '\u007f', '\u0085', '​', '‮', '﻿', 'é', '中', '😀');
  // Digits and hex letters, so an escape followed by one is tried.
  const plain = fc.constantFrom('a', 'b', 'f', 'Z', '0', '7', '9', '_', '.', '/', ':', '@', '%', '+');
  const id = fc.string({ unit: fc.oneof(odd, plain, fc.string({ unit: 'binary', minLength: 1, maxLength: 1 })), minLength: 1, maxLength: 12 }).filter((s) => !lone.test(s));

  it('is a bare ID as itself, and one that starts with - after --', () => {
    for (const bare of ['thin', 'files', 'v1.2', 'a/b:c@d%e+f=g', '_x']) expect(typed(bare)).toBe(bare);
    expect(typed('-fast')).toBe('-- -fast');
  });

  it('gives back the ID through each shell, on one line with nothing marked, whatever the ID holds', () => {
    expect(shells, 'bash').toContain('/bin/bash');
    fc.assert(fc.property(id, (option) => {
      const t = typed(option);
      expect(visible(t)).toBe(t);
      for (const shell of shells) expect(words(shell, t), shell).toEqual(option.startsWith('-') ? ['--', option] : [option]);
    }), { numRuns: 300 });
  }, 120_000);

  it("survives interactive bash's history expansion, which bash -c skips", () => {
    const ids = ["a'b!xc\u001b", "it's!x", "'!'", 'x!y', "q'!​"];
    const lines = ids.map((option) => `printf '%s\\0' ${typed(option)}\n`).join('');
    const out = spawnSync('/bin/bash', ['--norc', '--noprofile', '-i'], { input: `${lines}exit\n`, encoding: 'utf8', env: { PATH: '/usr/bin:/bin', HOME: '/nonexistent' } });
    expect(out.stdout.split('\0').slice(0, -1), out.stderr).toEqual(ids);
  });
});
