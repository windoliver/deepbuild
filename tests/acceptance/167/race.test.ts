// AC1 #167.18793458: "A race over keys a, b and c with periods 2000 (a 10, b 20, c 30) and 2001 (a 40, b 25, c 15),
// whose at runs linearly from 2000 at 0 s to 2001 at 1 s, evaluates at 0.25 s to values a 17.5, b 21.25 and c 26.25 and
// standings a 2.5, b 2.0 and c 1.5, identical whether played or seeked, and a value label on an integer column shows
// 18, 21 and 26"
//
// `geometry`'s rows give the values and standings at t; the labels set reads the bars through rows_of, and `raster`'s
// `texts` give what each label shows. Played: every 60 Hz frame to 0.25 s in order, in one process. Sought: a fresh
// process asked only for 0.25 s, and another that goes to 1 s and back. Rows must match as JSON and frames byte for
// byte, and the frame at 0 s must differ, so the check can see a frame drawn for the wrong time. Where `at` rests on a
// period, the rows equal that period's exactly (Scale and encode). No upstream test (oracle page).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AC, LOOK, TIMEOUT, canonical, column, fl, frames60, near, passes, raceDoc, rasterAt, rowsAt, sha256, shownText, useRender, useTemp, type JsonValue } from './helpers.ts';

const render = useRender();
const temp = useTemp('race');
const ID = AC[1];
const T = fl(0.25);
const doc = raceDoc();
const KEYS = ['a', 'b', 'c'] as const;

describe(`${ID} a race evaluates at 0.25 s to the mixed values and standings, played or seeked`, () => {
  it(`${ID} (mixed) at 0.25 s the values are 17.5, 21.25 and 26.25 and the standings 2.5, 2.0 and 1.5, and a rest on a period shows its rows exactly`, () => {
    const bin = render();
    passes(bin, doc, LOOK, 'the race');
    const [at0, mixed, at1] = rowsAt(bin, doc, 'race', [0, T, fl(1)], LOOK);
    expect(Object.keys(mixed!).sort(), 'one row per key after the transforms').toEqual([...KEYS]);
    const value = { a: 17.5, b: 21.25, c: 26.25 };
    const standing = { a: 2.5, b: 2, c: 1.5 };
    for (const k of KEYS) {
      near(column(mixed![k]!, 'value', k), value[k], 1e-4, `${k}'s value at 0.25 s`);
      near(column(mixed![k]!, 'standing', k), standing[k], 1e-4, `${k}'s standing at 0.25 s`);
    }
    const exactly = { a: [10, 3, 40, 1], b: [20, 2, 25, 2], c: [30, 1, 15, 3] };
    for (const k of KEYS) {
      const read = [column(at0![k]!, 'value', k), column(at0![k]!, 'standing', k), column(at1![k]!, 'value', k), column(at1![k]!, 'standing', k)];
      expect(read, `${k} at 2000 and at 2001, exactly each period's row`).toEqual(exactly[k]);
    }
  }, TIMEOUT);

  it(`${ID} (seek) the rows and the frame at 0.25 s are identical played or seeked, forward or back`, () => {
    const bin = render();
    const played = frames60(0.25);
    expect(played.at(-1), 'the frames end on 0.25 s').toBe(T);
    const rows = (times: number[]): string => canonical(rowsAt(bin, doc, 'race', times, LOOK).at(-1) as unknown as JsonValue);
    const rowsPlayed = rows(played);
    expect(rows([T]), 'sought rows equal played rows').toBe(rowsPlayed);
    expect(rows([fl(1), T]), 'rows after seeking back equal played rows').toBe(rowsPlayed);
    const hashes = (name: string, times: number[]): string[] => rasterAt(bin, doc, times, LOOK, temp(), name).map((f) => sha256(readFileSync(f.out)));
    const framesPlayed = hashes('played', played);
    const last = framesPlayed.at(-1);
    expect(hashes('sought', [T]).at(-1), 'the sought frame hashes as the played one').toBe(last);
    expect(hashes('back', [fl(1), T]).at(-1), 'the frame after seeking back hashes as the played one').toBe(last);
    expect(framesPlayed[0], 'the frame at 0 s differs, so a frame for the wrong time would show').not.toBe(last);
  }, TIMEOUT);

  it(`${ID} (labels) a value label on the integer column shows 18, 21 and 26 at 0.25 s`, () => {
    const answer = rasterAt(render(), doc, [T], LOOK, temp(), 'labels')[0]!.answer;
    expect(KEYS.map((k) => shownText(answer, `labels#${k}`, 'the race at 0.25 s')), 'the labels of a, b and c').toEqual(['18', '21', '26']);
  }, TIMEOUT);
});
