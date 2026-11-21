// The #297 Oracle lane's tools: the #297 suite's surface and fixtures (../297/helpers.ts, ../297/fixtures.ts), reused as
// they stand so both lanes ask the same binary the same way; the two upstream files the Oracle page pins, read where
// README says and checked against their pinned SHA-256s; and a reader of a bundled face's character map, which says
// which code points the fixture's faces draw. Nothing of the files is copied into this folder: they are Unicode data
// under the Unicode License v3 (https://www.unicode.org/license.txt, © Unicode, Inc.), read in place.

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { REPO, sha256 } from '../297/helpers.ts';

export * from '../297/helpers.ts';
export { entryText, piece, seatsProgram, NAME, SIZE } from '../297/fixtures.ts';

/** The pinned files, as the Oracle page links them: icu4x at commit b1cec62bb76ddd8f1f7f52616997f0f243d5eb9e. */
export const GRAPHEMES = 'icu4x-b1cec62bb7/components/segmenter/tests/testdata/GraphemeBreakTest.txt';
export const GRAPHEMES_SHA256 = 'e2d134d2c52919bace503ebb6a551c1855fe1a1faec18478c78fff254a1793ec';
export const NORMALIZATION = 'icu4x-b1cec62bb7/components/normalizer/tests/data/NormalizationTest.txt';
export const NORMALIZATION_SHA256 = '5019ffd530751a741900c849c0e010332f142a3612234639bd200b82138a87db';
/** Where the oracle checkout is: `DEEP_ORACLES` (the folder holding `vendor/`), else a sibling worktree of the `doneright`
 * branch (README: Where the lane reads the files). */
export const ORACLES = process.env['DEEP_ORACLES'] ? resolve(process.env['DEEP_ORACLES']) : resolve(REPO, '..', 'deep-oracles', 'doneright', 'oracles');

/** The pinned file's text, or BLOCKED with the one thing to do. */
export function vendored(rel: string, pin: string): string {
  const path = join(ORACLES, 'vendor', rel);
  if (!existsSync(path)) {
    throw Error(`BLOCKED: the pinned upstream file vendor/${rel} is missing at ${path}; this is not a pass.\nUnblock: check out branch doneright of DeepBuildAI/deepbuild as a worktree beside this checkout (git fetch origin doneright && git worktree add ../deep-oracles origin/doneright), or set DEEP_ORACLES to the folder that holds vendor/, then rerun.`);
  }
  const bytes = readFileSync(path);
  if (sha256(bytes) !== pin) throw Error(`the file at ${path} hashes to ${sha256(bytes)}, not the pinned ${pin}: it isn't the file the Oracle page pins`);
  return bytes.toString('utf8');
}

/** The code points a bundled face (crates/deep-text/fonts) maps to a glyph: its `cmap`'s format 4 and 12 subtables. */
export function drawnBy(file: string): Set<number> {
  const b = readFileSync(join(REPO, 'crates', 'deep-text', 'fonts', file));
  const u16 = (o: number): number => b.readUInt16BE(o);
  const u32 = (o: number): number => b.readUInt32BE(o);
  let cmap = -1;
  for (let i = 0; i < u16(4); i++) if (b.toString('latin1', 12 + 16 * i, 16 + 16 * i) === 'cmap') cmap = u32(12 + 16 * i + 8);
  const out = new Set<number>();
  for (let i = 0; cmap >= 0 && i < u16(cmap + 2); i++) {
    const off = cmap + u32(cmap + 4 + 8 * i + 4);
    if (u16(off) === 12) {
      for (let k = 0; k < u32(off + 12); k++) {
        const r = off + 16 + 12 * k;
        for (let c = u32(r); c <= u32(r + 4); c++) if (u32(r + 8) + c - u32(r) !== 0) out.add(c);
      }
    } else if (u16(off) === 4) {
      const n = u16(off + 6) / 2;
      const [ends, starts] = [off + 14, off + 16 + 2 * n];
      const [deltas, ranges] = [starts + 2 * n, starts + 4 * n];
      for (let k = 0; k < n; k++) {
        const [s, e, d, ro] = [u16(starts + 2 * k), u16(ends + 2 * k), b.readInt16BE(deltas + 2 * k), u16(ranges + 2 * k)];
        for (let c = s; c <= e && c !== 0xffff; c++) {
          let g = ro === 0 ? (c + d) & 0xffff : u16(ranges + 2 * k + ro + 2 * (c - s));
          if (ro !== 0 && g !== 0) g = (g + d) & 0xffff;
          if (g !== 0) out.add(c);
        }
      }
    }
  }
  return out;
}

/** A code point an entry may not hold alone or anywhere (README: which strings): a control, a format or other
 * default-ignorable character, a separator other than the space, a private-use, unassigned or surrogate code point. */
const HIDDEN = /[\p{Cc}\p{Cf}\p{Co}\p{Cn}\p{Cs}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/u;
const MARK = /[\p{Mn}\p{Me}]/u;
/** Whether `s` is one the #297 rules take as typed: no hidden character, a base (not a mark) first, something with ink,
 * no base with more than 4 marks (Mn or Me), every code point drawn by `faces` (the space aside), and `maxBytes` at most. */
export function takes(s: string, faces: Set<number>[], maxBytes: number): boolean {
  const cps = [...s].map((c) => c.codePointAt(0)!);
  if (!cps.length || Buffer.byteLength(s, 'utf8') > maxBytes) return false;
  if ([...s].some((c) => HIDDEN.test(c)) || /[\p{M}]/u.test([...s][0]!) || !/\S/u.test(s.replace(/\p{M}/gu, ''))) return false;
  let run = 0;
  for (const c of s) { run = MARK.test(c) ? run + 1 : 0; if (run > 4) return false; }
  return cps.every((c) => c === 0x20 || faces.some((f) => f.has(c)));
}
