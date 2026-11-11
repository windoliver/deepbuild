// AC2 #535.098d9861: A logic item that writes 70,000 at index 12 of an array a tile column reads as u16 at step 30, and
// 5 there at step 40, hides row 12 for steps 30 to 39 while every other row draws, and raises column.out_of_range
// naming the set, the column tile, row 12, the value 70,000 and step 30; −1 read as u8 and an f64 NaN read as f32 hide
// their rows the same way; and a planted narrowing that wraps draws tile 4,464 (70,000 − 65,536) at row 12 and fails,
// naming the row and the step
//
// The logic item `nums` (programs.ts `narrowProgram`) writes `tile` (row 12: 70,000 at steps 30 to 39, then 5), `flip`
// (row 3: −1 at steps 30 to 39) and `fine` (row 7: NaN at steps 30 to 39). `units` reads tile as u16, `flips` reads flip
// as u8 (its flip column), `drift` reads fine as f32 (its free rows' x). Each frame is `eval` on the live session at a
// step's time, played forward; its picture is read at each row's pixel on the code atlas, whose cell colors spell their
// tile, and the issues are the frame's (README: `eval`'s issues).
import { describe, expect, it } from 'vitest';
import { BAD_FROM, BAD_TO, FINE_ROW, FLIP_ROW, GOOD_AGAIN, NARROW_ROWS, TILE_ROW, narrowProgram, tileValue } from './programs.ts';
import { DRIFT_TILE, FLIPS_TILE, NARROW_EMPTY, codeAtlas, driftPixel, flipsPixel, narrowDoc, tileOfColor, unitsPixel } from './fixtures.ts';
import {
  AC, DOC, at, binOf, evalCall, failsNaming, issuesOf, near, none, once, pixel, pngOf, prebuild, presented, putEvidence, runShow, sOf, scenario,
  show, showCall, snapshotOf, useTemp, type Image, type JsonObject, type JsonValue, type Planted,
} from './helpers.ts';

prebuild(['full']);
const temp = useTemp();
const D = DOC(1);
/** The steps read: before, at the first bad step, inside, at the last, and when good again. */
const STEPS = [BAD_FROM - 1, BAD_FROM, 35, BAD_TO, GOOD_AGAIN];

interface Frame { step: number; image: Image; issues: JsonObject[] }
function narrowRun(ev: string, unitsOnly: boolean, planted?: Planted): Frame[] {
  const program = narrowProgram();
  putEvidence(ev, program.bytes);
  const atlas = putEvidence(ev, codeAtlas());
  const replies = runShow(binOf(), scenario(ev, [D], [showCall(D, narrowDoc(program, atlas, unitsOnly)), ...STEPS.map((k) => evalCall(D, at(k)))], planted ? { planted } : {}), 'AC2 the narrowing fixture');
  presented(replies[0]!, 'the narrowing fixture');
  return STEPS.map((k, n) => {
    const reply = replies[n + 1]!;
    return { step: k, image: pngOf(ev, snapshotOf(reply, `eval at step ${k}`), `the frame at step ${k}`), issues: issuesOf(reply) };
  });
}

/** The tile a pixel shows, `hidden` where it shows the ground, or `none` where it spells no tile. */
function shownAt(im: Image, [x, y]: [number, number]): number | 'hidden' | 'none' {
  const p = pixel(im, x, y);
  if (near(p, pixel(im, ...NARROW_EMPTY))) return 'hidden';
  return tileOfColor(p) ?? 'none';
}
/** One set's rows at one frame: `hide(i)` rows show the ground; the rest show `tile(i)`. Each failure names the row and the step. */
function rowFailures(f: Frame, set: string, where: (i: number) => [number, number], tile: (i: number) => number, hide: (i: number) => boolean): string[] {
  const out: string[] = [];
  for (let i = 0; i < NARROW_ROWS; i++) {
    const shown = shownAt(f.image, where(i));
    const tag = `${set} row ${i} at step ${f.step} (${sOf(at(f.step))})`;
    if (hide(i)) { if (shown !== 'hidden') out.push(`${tag}: draws ${typeof shown === 'number' ? `tile ${shown}` : 'something'} where it should hide`); }
    else if (shown !== tile(i)) out.push(`${tag}: shows ${typeof shown === 'number' ? `tile ${shown}` : shown}, not tile ${tile(i)}`);
  }
  return out;
}
const bad = (k: number): boolean => k >= BAD_FROM && k <= BAD_TO;

/** The frame's column.out_of_range issues for `set`'s `column` at `row`, its fields read at the issue's top level or
 * under `actual`, the set under `set` or `reader` (Mark set: logic columns; Array and table: column view). */
function outOfRange(f: Frame, set: string, column: string, row: number): JsonObject[] {
  return f.issues.filter((i) => i['code'] === 'column.out_of_range').map((i) => ({ ...(typeof i['actual'] === 'object' && i['actual'] !== null && !Array.isArray(i['actual']) ? i['actual'] : {}), ...i } as JsonObject))
    .filter((i) => (i['set'] ?? i['reader']) === set && i['column'] === column && i['row'] === row);
}
function issueFailures(frames: Frame[], set: string, column: string, row: number, value: (v: JsonValue | undefined) => boolean, valueText: string): string[] {
  const first = frames.find((f) => f.step === BAD_FROM)!;
  const found = outOfRange(first, set, column, row);
  if (!found.length) return [`no column.out_of_range at step ${BAD_FROM} names the set ${set}, the column ${column} and row ${row}: the frame's issues ${show(first.issues, 2000)}`];
  const out: string[] = [];
  if (!found.some((i) => value(i['value']))) out.push(`the column.out_of_range for ${set}.${column} row ${row} doesn't name the value ${valueText}: ${show(found)}`);
  if (!found.some((i) => i['step'] === BAD_FROM)) out.push(`the column.out_of_range for ${set}.${column} row ${row} doesn't name step ${BAD_FROM}: ${show(found)}`);
  return out;
}

const honest = once(() => { const ev = temp(); return narrowRun(ev, false); });

describe(`${AC[2]} narrowing logic arrays by the column view's one rule: a row whose value can't narrow hides while it lasts and raises column.out_of_range`, () => {
  it(`${AC[2]} 70,000 read as u16 at row 12 hides it for steps 30 to 39 while every other row draws, then 5 draws, and column.out_of_range names units, tile, row 12, 70,000 and step 30`, () => {
    const frames = honest();
    const failures = frames.flatMap((f) => rowFailures(f, 'units', unitsPixel, (i) => tileValue(i, f.step), (i) => i === TILE_ROW && bad(f.step)));
    failures.push(...issueFailures(frames, 'units', 'tile', TILE_ROW, (v) => v === 70_000, '70,000'));
    none(failures, 'units across steps 29, 30, 35, 39 and 40');
  }, 1_800_000);

  it(`${AC[2]} −1 read as u8 (a flip column) and an f64 NaN read as f32 (a free row's x) hide their rows for steps 30 to 39 the same way, each raising column.out_of_range at step 30`, () => {
    const frames = honest();
    const failures = frames.flatMap((f) => [
      ...rowFailures(f, 'flips', flipsPixel, () => FLIPS_TILE, (i) => i === FLIP_ROW && bad(f.step)),
      ...rowFailures(f, 'drift', driftPixel, () => DRIFT_TILE, (i) => i === FINE_ROW && bad(f.step)),
    ]);
    failures.push(...issueFailures(frames, 'flips', 'flip', FLIP_ROW, (v) => v === -1, '−1'));
    // JSON holds no NaN: the value is named by whatever stands for it, never a finite number.
    failures.push(...issueFailures(frames, 'drift', 'x', FINE_ROW, (v) => v === null || (typeof v === 'string' && /nan/i.test(v)), 'NaN'));
    none(failures, 'flips and drift across steps 29, 30, 35, 39 and 40');
  }, 1_800_000);

  it(`${AC[2]} planted narrowing_wraps draws tile 4,464 (70,000 − 65,536) at row 12 and the criterion's check fails naming the row and the step`, () => {
    const ev = temp();
    const frames = narrowRun(ev, true, 'narrowing_wraps');
    const at30 = frames.find((f) => f.step === BAD_FROM)!;
    expect(shownAt(at30.image, unitsPixel(TILE_ROW)), 'the wrapping narrowing draws tile 4,464 at row 12 at step 30').toBe(70_000 - 65_536);
    const failures = frames.flatMap((f) => rowFailures(f, 'units', unitsPixel, (i) => tileValue(i, f.step), (i) => i === TILE_ROW && bad(f.step)));
    failsNaming(failures, [/units row 12 /, /step 30 /], 'units under narrowing_wraps');
  }, 1_800_000);
});
