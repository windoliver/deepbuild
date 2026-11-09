import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  RENDER_BIN, diffPixels, isObject, one, readPng, requireMacos, useBinaries, type JsonObject, type JsonValue, type Rgb,
} from './helpers.ts';

useBinaries('deep-text-render');

const PAGE_BYTES = 1_048_576;
const CARD: Rgb = [24, 24, 24];
const WHITE: Rgb = [255, 255, 255];
const scratch = mkdtempSync(join(tmpdir(), 'deep-1480-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

// ---------------------------------------------------------------------------------------------------
// The surfaces read (see README.md, "Surfaces these tests read"): request fields `windows`, `upload`,
// `frames`; report fields `frames[i].new_glyphs` and, per window, `upload_bytes`, `upload_rects`,
// `upload_whole_pages`, `page_allocs`, `pages`.

type Mode = 'rect' | 'whole_page';
interface Label { text: string; x: number; y: number; size: number; weight: number; font: string; color: Rgb }
interface Frame { labels: Label[]; out?: string[] }
interface WindowReport { upload_bytes: number; upload_rects: { page: number; x: number; y: number; w: number; h: number }[]; upload_whole_pages: number; page_allocs: number; pages: number[] }
interface FrameReport { new_glyphs: { w: number; h: number }[]; windows: WindowReport[] }

let serial = 0;
const label = (text: string, size = 26, x = 16, y = 16): Label => ({ text, x, y, size, weight: 400, font: 'body', color: WHITE });
const paths = (windows: number, tag: string): string[] => Array.from({ length: windows }, (_, w) => join(scratch, `${tag}-${serial++}-w${w}.png`));

function num(value: JsonValue | undefined, what: string): number {
  expect(typeof value, `SURFACE MISSING: ${what} must be a number, got ${JSON.stringify(value)}`).toBe('number');
  return value as number;
}

/** One render process (a cold atlas) over `frames`; returns the parsed per-frame reports. */
function run(frames: Frame[], windows: number, upload: Mode | undefined, card = { w: 640, h: 120 }): FrameReport[] {
  requireMacos();
  const request: JsonObject = { card: { ...card, color: CARD }, windows, frames: frames as unknown as JsonValue };
  if (upload !== undefined) request['upload'] = upload;
  const report = one(RENDER_BIN, ['render'], request);
  if (report['ok'] !== true && report['code'] === 'unsupported_platform') expect.fail('INCONCLUSIVE: the render reports unsupported_platform; this is not a pass');
  expect(report['ok'], `render refused the request (a missing \`frames\`/\`windows\`/\`upload\` surface answers bad_input): ${JSON.stringify(report)}`).toBe(true);
  const list = report['frames'];
  expect(Array.isArray(list) && list.length === frames.length, `SURFACE MISSING: report.frames has one entry per frame: ${JSON.stringify(report).slice(0, 400)}`).toBe(true);
  return (list as JsonValue[]).map((entry, i) => {
    expect(isObject(entry), `report.frames[${i}] is an object`).toBe(true);
    const f = entry as JsonObject;
    const glyphs = f['new_glyphs'];
    expect(Array.isArray(glyphs), `SURFACE MISSING: frames[${i}].new_glyphs`).toBe(true);
    const wins = f['windows'];
    expect(Array.isArray(wins) && wins.length === windows, `SURFACE MISSING: frames[${i}].windows has one entry per window`).toBe(true);
    return {
      new_glyphs: (glyphs as JsonValue[]).map((g) => ({ w: num((g as JsonObject)['w'], 'new_glyphs[].w'), h: num((g as JsonObject)['h'], 'new_glyphs[].h') })),
      windows: (wins as JsonValue[]).map((w, k) => {
        const o = w as JsonObject;
        const rects = o['upload_rects'];
        expect(Array.isArray(rects), `SURFACE MISSING: frames[${i}].windows[${k}].upload_rects`).toBe(true);
        const pages = o['pages'];
        expect(Array.isArray(pages), `SURFACE MISSING: frames[${i}].windows[${k}].pages`).toBe(true);
        return {
          upload_bytes: num(o['upload_bytes'], `frames[${i}].windows[${k}].upload_bytes`),
          upload_rects: rects as WindowReport['upload_rects'],
          upload_whole_pages: num(o['upload_whole_pages'], `frames[${i}].windows[${k}].upload_whole_pages`),
          page_allocs: num(o['page_allocs'], `frames[${i}].windows[${k}].page_allocs`),
          pages: pages as number[],
        };
      }),
    };
  });
}

/** The criterion-1 check, as a pure function so the planted twin can be put through the same one. '' is a pass. */
function uploadFault(win: WindowReport, glyph: { w: number; h: number }): string {
  const allowed = (glyph.w + 2) * (glyph.h + 2);
  if (win.upload_bytes <= allowed) return '';
  const whole = win.upload_whole_pages > 0 || win.upload_bytes >= PAGE_BYTES;
  return `a ${glyph.w}x${glyph.h} glyph may upload at most ${allowed} bytes, but the window uploaded ${win.upload_bytes.toLocaleString('en-US')} bytes${whole ? ` (a whole page is ${PAGE_BYTES.toLocaleString('en-US')} bytes)` : ''}`;
}

/** 26 lowercase letters, set at each size and at four horizontal sub-pixel offsets: more than 1,000 distinct raster variants. */
function many(sizes: number[]): Label[] {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  const out: Label[] = [];
  for (const size of sizes) for (const phase of [0, 0.25, 0.5, 0.75]) {
    const i = out.length;
    out.push(label(letters, size, 8 + (i % 3) * 560 + phase, 8 + Math.floor(i / 3) * 52));
  }
  return out;
}
const MANY_CARD = { w: 1700, h: 760 };

const warm: Frame = { labels: [label('abc')] };
const WINDOWS = 2;

describe('AC1 one new 26 px glyph on a warm page uploads at most (w + 2) x (h + 2) bytes', () => {
  it('AC1 the new glyph\'s own rectangle goes up in each of two windows, and nothing else', () => {
    const frames = run([warm, { labels: [label('abcQ')] }], WINDOWS, 'rect');
    const second = frames[1]!;
    expect(second.new_glyphs.length, `exactly one glyph is new in the second frame: ${JSON.stringify(second.new_glyphs)}`).toBe(1);
    const glyph = second.new_glyphs[0]!;
    expect(glyph.w > 0 && glyph.h > 0 && glyph.h >= 15, `a 26 px Q has a real raster size, got ${JSON.stringify(glyph)}`).toBe(true);
    second.windows.forEach((win, k) => {
      expect(uploadFault(win, glyph), `window ${k}`).toBe('');
      expect(win.upload_bytes > 0, `window ${k} did upload the new glyph (zero bytes would draw nothing): ${win.upload_bytes}`).toBe(true);
      expect(win.upload_whole_pages, `window ${k} uploads no whole page`).toBe(0);
    });
    // A frame that adds nothing uploads nothing.
    const again = run([warm, { labels: [label('abc')] }], WINDOWS, 'rect')[1]!;
    again.windows.forEach((win, k) => expect(win.upload_bytes, `window ${k}: a frame with no new glyph uploads no bytes`).toBe(0));
  }, 300_000);

  it('AC1 the planted whole-page upload fails the same check, naming 1,048,576 bytes', () => {
    const frames = run([warm, { labels: [label('abcQ')] }], WINDOWS, 'whole_page');
    const second = frames[1]!;
    expect(second.new_glyphs.length, 'one new glyph in the planted twin too').toBe(1);
    second.windows.forEach((win, k) => {
      const fault = uploadFault(win, second.new_glyphs[0]!);
      expect(fault, `window ${k}: the planted whole-page twin must be refused by the upload check`).not.toBe('');
      expect(fault, `window ${k}: the refusal names a whole page`).toContain('1,048,576');
      expect(win.upload_bytes, `window ${k}: the planted twin uploads one whole page`).toBe(PAGE_BYTES);
    });
  }, 300_000);
});

describe('AC2 over 1,000 new glyphs on one page in a frame, total bytes never exceed one page', () => {
  it('AC2 1,000+ new glyphs in one frame upload at most one page in each of two windows', () => {
    const frames = run([warm, { labels: many([14, 15, 16, 17, 18, 19, 20, 21, 22, 23]) }], WINDOWS, 'rect', MANY_CARD);
    const burst = frames[1]!;
    expect(burst.new_glyphs.length >= 1000, `the frame adds at least 1,000 new glyphs, added ${burst.new_glyphs.length}`).toBe(true);
    burst.windows.forEach((win, k) => {
      expect(win.pages.length, `window ${k}: the glyphs sit on one atlas page: ${JSON.stringify(win.pages)}`).toBe(1);
      expect(win.upload_bytes <= PAGE_BYTES, `window ${k}: ${win.upload_bytes} bytes uploaded, more than one page (${PAGE_BYTES})`).toBe(true);
      expect(win.upload_bytes > 0, `window ${k} uploaded the glyphs`).toBe(true);
    });
  }, 300_000);

  it('AC2 the ring holds 32 rects: 32 new glyphs upload rects only, 33 take one whole-page upload', () => {
    const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345';
    expect(upper.length).toBe(32);
    const at32 = run([warm, { labels: [label(upper, 26, 8, 8)] }], WINDOWS, 'rect', { w: 900, h: 120 })[1]!;
    expect(at32.new_glyphs.length, 'the frame adds 32 new glyphs').toBe(32);
    at32.windows.forEach((win, k) => {
      expect(win.upload_whole_pages, `window ${k}: 32 rects fit the ring, no whole page`).toBe(0);
      expect(win.upload_rects.length, `window ${k}: 32 rects uploaded`).toBe(32);
      const allowed = at32.new_glyphs.reduce((sum, g) => sum + (g.w + 2) * (g.h + 2), 0);
      expect(win.upload_bytes <= allowed, `window ${k}: ${win.upload_bytes} bytes for 32 glyphs, at most ${allowed}`).toBe(true);
    });
    const at33 = run([warm, { labels: [label(`${upper}6`, 26, 8, 8)] }], WINDOWS, 'rect', { w: 900, h: 120 })[1]!;
    expect(at33.new_glyphs.length, 'the frame adds 33 new glyphs').toBe(33);
    at33.windows.forEach((win, k) => {
      expect(win.upload_whole_pages, `window ${k}: more than 32 rects take one whole-page upload`).toBe(1);
      expect(win.upload_bytes <= PAGE_BYTES, `window ${k}: and no more than one page: ${win.upload_bytes}`).toBe(true);
    });
  }, 300_000);
});

describe('AC3 a frame that adds a glyph clones no page, by the counting allocator', () => {
  it('AC3 the counting allocator sees no page-sized allocation while a frame with a new glyph paints, in either window', () => {
    const frame = run([warm, { labels: [label('abcQ')] }], WINDOWS, 'rect')[1]!;
    expect(frame.new_glyphs.length, 'the frame adds a glyph').toBe(1);
    frame.windows.forEach((win, k) => expect(win.page_allocs, `window ${k}: allocations of ${PAGE_BYTES}+ bytes while painting`).toBe(0));
  }, 300_000);

  it('AC3 the allocator can see a clone: the planted whole-page twin allocates a page in each window', () => {
    const frame = run([warm, { labels: [label('abcQ')] }], WINDOWS, 'whole_page')[1]!;
    frame.windows.forEach((win, k) => expect(win.page_allocs >= 1, `window ${k}: the whole-page twin clones a page, the counter reads ${win.page_allocs}`).toBe(true));
  }, 300_000);
});

describe('AC4 pixels are byte-equal to the whole-page path over a typing journey on two windows', () => {
  const typed = ['T', 'Ty', 'Typ', 'Typi', 'Typin', 'Typing', 'Typin', 'Typed', 'Typed!'];
  const journey = (mode: Mode): { frames: Frame[] } => {
    const frames: Frame[] = typed.map((text) => ({ labels: [label(text, 26, 16, 16)], out: paths(WINDOWS, `${mode}-typing`) }));
    // Churn: three bursts of new glyphs, so pages fill and restart, then the first word again.
    for (const sizes of [[14, 15, 16, 17, 18, 19, 20, 21, 22, 23], [24, 25, 26, 27, 28, 29, 30, 31, 32, 33], [34, 35, 36, 37, 38, 39, 40, 41, 42, 43]]) {
      frames.push({ labels: [label('Typed!', 26, 16, 16), ...many(sizes).map((l) => ({ ...l, y: l.y + 60 }))] });
    }
    frames.push({ labels: [label('Typing', 26, 16, 16)], out: paths(WINDOWS, `${mode}-final`) });
    return { frames };
  };

  it('AC4 every captured frame in both windows equals the whole-page path\'s, and each shows only its own text', () => {
    const card = { w: 1700, h: 820 };
    const rect = journey('rect');
    const whole = journey('whole_page');
    run(rect.frames, WINDOWS, 'rect', card);
    run(whole.frames, WINDOWS, 'whole_page', card);
    let compared = 0;
    rect.frames.forEach((frame, i) => {
      if (!frame.out) return;
      frame.out.forEach((file, k) => {
        const mine = readPng(file);
        const theirs = readPng(whole.frames[i]!.out![k]!);
        const d = diffPixels(mine, theirs);
        expect(d.count, `frame ${i} window ${k}: ${d.count} pixels differ from the whole-page path, first at ${JSON.stringify(d.first)}`).toBe(0);
        const other = diffPixels(mine, readPng(frame.out![0]!));
        expect(other.count, `frame ${i}: window ${k} differs from window 0 in ${other.count} pixels`).toBe(0);
        compared++;
      });
    });
    expect(compared, 'both windows of the ten captured frames were compared').toBe(WINDOWS * 10);
  }, 600_000);

  it('AC4 a frame after a glyph was updated shows the new glyph and none of the old: each equals a cold render of the same text', () => {
    const card = { w: 1700, h: 820 };
    const rect = journey('rect');
    run(rect.frames, WINDOWS, 'rect', card);
    // Frames 5 (Typing), 6 (Typin), 7 (Typed: the last glyphs updated in place), 8 and the final one.
    for (const [i, text] of [[5, 'Typing'], [6, 'Typin'], [7, 'Typed'], [8, 'Typed!'], [rect.frames.length - 1, 'Typing']] as [number, string][]) {
      const cold = paths(1, 'cold');
      run([{ labels: [label(text, 26, 16, 16)], out: cold }], 1, 'rect', card);
      for (const [k, file] of rect.frames[i]!.out!.entries()) {
        const d = diffPixels(readPng(file), readPng(cold[0]!));
        expect(d.count, `frame ${i} (${text}) in window ${k}: ${d.count} pixels differ from a cold render, first at ${JSON.stringify(d.first)}`).toBe(0);
      }
    }
  }, 600_000);
});
