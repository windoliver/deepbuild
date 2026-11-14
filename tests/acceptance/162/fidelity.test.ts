// AC11 #162.ec813bb5: "The title with a trim, a repeater, a mask and Bézier keys, exported to Lottie and rendered by the
// pinned reference Lottie renderer at 20 sampled export frames, matches the raw frames within the export.fidelity floor;
// a planted writer that drops the title's mask fails, naming the first sampled frame the mask shows in"
// AC14 #162.d1c6940c: "The title with a trim, a repeater, a mask and Bézier keys exports with an empty warnings list; a
// planted writer that drops the mask and lists it as an item Lottie can't hold fails, naming the mask; the fidelity
// frames are export frames ⌊i × n ÷ 20⌋ for i from 0 to 19"
//
// The title (helpers.ts `titleDoc`) is 48 export frames at 24 fps, so its fidelity frames are 0, 2, 4, 7, 9, 12, 14,
// 16, 19, 21, 24, … 45: frames a rounding or a fixed stride would miss. Its mask halves at 0.9375 s (frame 22.5): it first
// cuts frame 23, which isn't sampled, so the first sampled frame it shows in is 24. The renderer isn't driven here: the
// export's fidelity check is read through its receipt and its FAIL (README: The surface under test).
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { useFileTemp } from '../157/helpers.ts';
import {
  AC, FULL, TIMEOUT, TITLE, TITLE_NAMES, exportedOf, failsNaming, fidelityFrames, framesNamed, isObject, issuesOf, layerNamed, leftIn, lottieExport, none,
  readLottie, show, showRun, titleDoc, useShow, type JsonObject, type JsonValue, type Planted,
} from './helpers.ts';

const shows = useShow([FULL]);
const fileTemp = useFileTemp('162-fidelity');

interface Run { reply: JsonObject; out: string; dir: string }
function exportTitle(planted?: Planted): Run {
  const evidence = fileTemp(); const dir = fileTemp(); const out = join(dir, 'title.json');
  const [reply] = showRun(shows.bin(FULL), evidence, [titleDoc(evidence)], [lottieExport(0, out)], 'the title, exported to Lottie', planted);
  return { reply: reply!, out, dir };
}
let plain: Run | undefined;
const plainRun = (): Run => (plain ??= exportTitle());

/** AC14's judge: the title's export lists nothing, and its file keeps the mask on the masked curve's layer. */
function judgeNothingListed(run: Run, what: string): string[] {
  if (run.reply['outcome'] !== 'exported') return [`${what}: the export isn't delivered: ${show(run.reply, 800)}`];
  const { warnings } = exportedOf(run.reply, what);
  const failures = warnings.map((w) => `${what}: the warnings list ${w.item} (${w.kind}): ${w.text}; the title holds nothing Lottie can't hold and samples no key`);
  const line = layerNamed(readLottie(run.out, what), TITLE_NAMES.line, what).layer;
  const masks = Array.isArray(line['masksProperties']) ? line['masksProperties'] : [];
  if (masks.length === 0) failures.push(`${what}: the mask veil (${TITLE_NAMES.veil}) isn't written: the ${TITLE_NAMES.line} layer has no masksProperties`);
  return failures;
}

interface Fidelity { frames: number; sampled: number[]; floor: number; psnrY: number | null; ssim: number | null; worst: { frame: number; psnr_y: number | null; ssim: number | null }[] }
/** The receipt's `fidelity` (README: the receipt): #157's shape, with `sampled`, the export frames compared. */
function fidelityOf(receipt: JsonObject, what: string): Fidelity {
  const f = receipt['fidelity'];
  expect(isObject(f), `${what}: receipt.fidelity is an object: ${show(f ?? null, 600)}`).toBe(true);
  const o = f as JsonObject;
  const nn = (v: JsonValue | undefined, name: string): number | null => {
    expect(v === null || (typeof v === 'number' && Number.isFinite(v)), `${what}: receipt.fidelity.${name} is a number or null: ${show(v ?? 'undefined')}`).toBe(true);
    return v as number | null;
  };
  expect(Array.isArray(o['sampled']) && (o['sampled'] as JsonValue[]).every((k) => Number.isInteger(k)), `${what}: receipt.fidelity.sampled lists export frames: ${show(o['sampled'] ?? null)}`).toBe(true);
  expect(isObject(o['floor']) && typeof (o['floor'] as JsonObject)['psnr_y'] === 'number', `${what}: receipt.fidelity.floor.psnr_y is a number: ${show(o['floor'] ?? null)}`).toBe(true);
  expect(typeof o['frames'] === 'number' && Array.isArray(o['worst_1pct']), `${what}: receipt.fidelity has frames and worst_1pct: ${show(o, 600)}`).toBe(true);
  return {
    frames: o['frames'] as number, sampled: o['sampled'] as number[], floor: (o['floor'] as JsonObject)['psnr_y'] as number,
    psnrY: nn(o['psnr_y'], 'psnr_y'), ssim: nn(o['ssim'], 'ssim'),
    worst: (o['worst_1pct'] as JsonValue[]).filter(isObject).map((w) => ({ frame: Number(w['frame']), psnr_y: (w['psnr_y'] ?? null) as number | null, ssim: (w['ssim'] ?? null) as number | null })),
  };
}
/** export.fidelity's floor at the default quality (standard): PSNR-Y 40 dB, or SSIM 0.98 (Check input: export kinds). */
const meets = (psnr: number | null, ssim: number | null): boolean => psnr === null || psnr >= 40 || (ssim !== null && ssim >= 0.98);

describe(`${AC[14]} the title exports with an empty warnings list; the fidelity frames are ⌊i × n ÷ 20⌋`, () => {
  it(`${AC[14]} the title's warnings are empty and its file keeps the mask; its fidelity frames are 0, 2, 4, 7, … 45 of its 48`, () => {
    const run = plainRun();
    none(judgeNothingListed(run, 'the title'), 'the title holds nothing Lottie lists');
    const f = fidelityOf(exportedOf(run.reply, 'the title').receipt, 'the title');
    expect(f.sampled, 'the fidelity frames are export frames ⌊i × 48 ÷ 20⌋ for i from 0 to 19').toEqual(fidelityFrames(TITLE.frames));
  }, TIMEOUT);

  it(`${AC[14]} a planted writer that drops the mask and lists it as an item Lottie can't hold fails, naming the mask`, () => {
    const run = exportTitle('lottie_writer_lists_mask');
    failsNaming(judgeNothingListed(run, 'the title (planted lottie_writer_lists_mask)'), /\bveil\b|Veil/, 'the writer that lists the mask');
  }, TIMEOUT);
});

describe(`${AC[11]} the title rendered from its Lottie file at 20 sampled frames matches its raw frames within the floor`, () => {
  it(`${AC[11]} the export's fidelity check compares 20 sampled frames and each meets the 40 dB floor`, () => {
    const run = plainRun();
    const f = fidelityOf(exportedOf(run.reply, 'the title').receipt, 'the title');
    expect(f.frames, 'the fidelity check compared 20 frames').toBe(20);
    expect(f.sampled.length, 'twenty sampled frames').toBe(20);
    expect(f.floor, 'the floor is the default quality\'s, standard: PSNR-Y 40 dB').toBe(40);
    expect(meets(f.psnrY, f.ssim), `the lowest frame meets the floor: psnr_y ${String(f.psnrY)}, ssim ${String(f.ssim)}`).toBe(true);
    none(f.worst.filter((w) => !meets(w.psnr_y, w.ssim)).map((w) => `frame ${w.frame}: psnr_y ${String(w.psnr_y)}, ssim ${String(w.ssim)}`), 'every listed worst frame meets the floor');
  }, TIMEOUT);

  it(`${AC[11]} a planted writer that drops the mask fails export.fidelity, naming frame ${TITLE.firstMaskFrame}, the first sampled frame the mask shows in, and writes nothing`, () => {
    const run = exportTitle('lottie_writer_drops_mask');
    const what = 'the title (planted lottie_writer_drops_mask)';
    expect(run.reply['outcome'], `${what} fails: ${show(run.reply, 1500)}`).toBe('failed');
    const named = issuesOf(run.reply, 'export.fidelity').flatMap(framesNamed);
    expect(named.length, `${what}: export.fidelity names frames: ${show(run.reply['issues'] ?? null, 1500)}`).toBeGreaterThan(0);
    expect(Math.min(...named), `${what}: the first frame export.fidelity names is ${TITLE.firstMaskFrame}, the first sampled frame the mask shows in (named: ${named.join(', ')})`).toBe(TITLE.firstMaskFrame);
    none(named.filter((k) => !fidelityFrames(TITLE.frames).includes(k)).map((k) => `frame ${k} isn't a fidelity frame`), `${what}: every frame named is a sampled one`);
    expect(leftIn(run.dir), `${what}: nothing is written beside out, under its name or a temporary one`).toEqual([]);
  }, TIMEOUT);
});
