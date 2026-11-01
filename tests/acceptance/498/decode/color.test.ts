// AC8: an untagged 1080p fixture of 75% bars is probed with `color.assumed` naming the matrix and range, and decodes
// to RGB within ±2 code values of the BT.709 reference; a planted decoder that assumes BT.601 misses by more and fails,
// naming the field. Scope held here: untagged color is assumed under one written rule and named, BT.709 and limited
// range at heights of 720 and over and BT.601 below; a tagged stream assumes nothing.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assetOf, barsErrors, barsMp4, decodedOf, mediaDecode, mediaImport, probeFixture, runShow, str, useShow, useTemp, videoStream,
  type Planted,
} from './helpers.ts';

const show = useShow();
const temp = useTemp('color');

const UNSPECIFIED = ['primaries', 'transfer', 'matrix', 'range'];

interface Case { name: string; path: string; w: number; h: number; tagged: boolean; matrix: 'bt709' | 'bt601' }

function caseProblems(c: Case, imported: Parameters<typeof assetOf>[0], decodedReply: Parameters<typeof assetOf>[0], out: string): string[] {
  const f: string[] = [];
  const v = videoStream(assetOf(imported, `probing ${c.name}`), `probing ${c.name}`);
  const col = v.color!;
  if (col.matrix !== c.matrix) f.push(`${c.name}: color.matrix is ${col.matrix}, not ${c.matrix}${c.tagged ? ' as tagged' : ` as the rule assumes at height ${c.h}`}`);
  if (col.range !== 'limited') f.push(`${c.name}: color.range is ${col.range}, not limited`);
  if (c.tagged) {
    if (col.assumed.length !== 0) f.push(`${c.name}: color.assumed is ${JSON.stringify(col.assumed)} on a tagged stream, which assumes nothing`);
  } else {
    for (const field of ['matrix', 'range']) if (!col.assumed.includes(field)) f.push(`${c.name}: color.assumed ${JSON.stringify(col.assumed)} doesn't name ${field}, which the stream leaves untagged`);
    const extra = col.assumed.filter((x) => !UNSPECIFIED.includes(x));
    const missing = UNSPECIFIED.filter((x) => !col.assumed.includes(x));
    if (extra.length > 0 || missing.length > 0) f.push(`${c.name}: color.assumed is ${JSON.stringify(col.assumed)}, not the four fields the stream leaves unspecified ${JSON.stringify(UNSPECIFIED)}`);
    if (c.h >= 720 && (col.primaries !== 'bt709' || col.transfer !== 'bt709')) f.push(`${c.name}: color.primaries ${col.primaries} and color.transfer ${col.transfer}, not bt709 as the rule assumes at height ${c.h}`);
  }
  const d = decodedOf(decodedReply, out, `decoding ${c.name} to BGRA`);
  const frame = d.video[0]?.frames[0];
  if (!frame) return [...f, `${c.name}: no frame decoded`];
  expect(d.video[0]!.size, `${c.name}: decoded size`).toEqual([c.w, c.h]);
  const bytes = readFileSync(frame.file);
  expect(bytes.length, `${c.name}: a BGRA8 frame is w × h × 4 bytes`).toBe(c.w * c.h * 4);
  for (const e of barsErrors(bytes, c.w, c.h, 2)) {
    f.push(`${c.name}: color.matrix ${col.matrix}: the ${e.bar} bar decodes to RGB (${e.got.join(', ')}), ${e.off} code values from the 75% bars' (${e.want.join(', ')}) under ${c.matrix}, over ±2`);
  }
  return f;
}

describe('AC8 untagged color is assumed under one written rule and named, and decodes true to it', () => {
  it('AC8 an untagged 1080p MP4 of 75% bars probes with color.assumed naming the matrix and range (BT.709, limited) and decodes within ±2 code values of the bars; an untagged 480-line one assumes BT.601; a tagged BT.709 one assumes nothing', () => {
    const dir = temp();
    const cases: Case[] = [
      { name: 'the untagged 1080p bars', path: join(dir, 'bars-1080p-untagged.mp4'), w: 1920, h: 1080, tagged: false, matrix: 'bt709' },
      { name: 'the untagged 480-line bars', path: join(dir, 'bars-480-untagged.mp4'), w: 720, h: 480, tagged: false, matrix: 'bt601' },
      { name: 'the tagged BT.709 1080p bars', path: join(dir, 'bars-1080p-tagged.mp4'), w: 1920, h: 1080, tagged: true, matrix: 'bt709' },
    ];
    for (const c of cases) {
      barsMp4(c.path, c.w, c.h, c.matrix, c.tagged);
      // The fixture is what its recipe says: untagged ones carry no color description in stream or container.
      const p = probeFixture(c.path);
      expect([p.width, p.height], `fixture ${c.path}: ffprobe's size`).toEqual([c.w, c.h]);
      const tags = ['color_range', 'color_space', 'color_transfer', 'color_primaries'].map((k) => (p.color[k] === undefined ? 'unknown' : str(p.color[k], `fixture ${k}`)));
      if (c.tagged) expect(tags, `fixture ${c.path}: tagged BT.709 limited (the recipe broke if not)`).toEqual(['tv', 'bt709', 'bt709', 'bt709']);
      else expect(tags, `fixture ${c.path}: untagged (the recipe broke if not)`).toEqual(['unknown', 'unknown', 'unknown', 'unknown']);
    }
    const check = (planted?: Planted): string[] => {
      const out = join(dir, planted ?? 'clean');
      const calls = cases.flatMap((c, i) => [mediaImport(c.path), mediaDecode(c.path, join(out, String(i)), { format: 'bgra', video_frames: 1 })]);
      const { replies } = runShow(show(), { evidence: temp(), ...(planted ? { planted } : {}) }, calls, planted ? `planted ${planted}` : 'the bars');
      return cases.flatMap((c, i) => caseProblems(c, replies[2 * i]!, replies[2 * i + 1]!, join(out, String(i))));
    };
    expect(check(), 'each probe names what it assumed, and each decode is true to the bars').toEqual([]);
    // The wrong program: a decoder that assumes BT.601 for untagged 1080p misses the bars by more than 2 and this check
    // fails, naming the field.
    const wrong = check('assumes_bt601');
    expect(wrong.some((s) => s.startsWith('the untagged 1080p bars: color.matrix')), `planted assumes_bt601 fails on the untagged 1080p bars, naming color.matrix; got ${JSON.stringify(wrong)}`).toBe(true);
    expect(wrong.some((s) => s.startsWith('the untagged 1080p bars: color.matrix') && /code values from the 75% bars/.test(s)), `planted assumes_bt601 misses the BT.709 reference by more than 2; got ${JSON.stringify(wrong)}`).toBe(true);
  }, 900_000);
});
