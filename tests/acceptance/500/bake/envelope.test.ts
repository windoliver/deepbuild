// AC5: "An envelope bake at 24 Hz of a 960 Hz sine of amplitude 0.5 at 48 kHz, 40 whole cycles a row, reads rms 0.3536
// within 1e-4 in every row that lies inside the tone; a planted bake that reads the peak instead reads 0.5 and fails,
// naming the row"
//
// Through `media_bake` with `kind: envelope, rate: 24, outputs: [rms, centroid]` (README: The surface under test). The
// asset is 0.5 s of silence, 2 s of a 960 Hz sine of amplitude 0.5 and 0.5 s of silence, mono 16-bit at 48 kHz, so the
// tone spans rows 12 to 60 of 1/24 s (2,000 samples, 40 whole cycles each). Row r is read at t = r/24 s; since the
// design doesn't say whether row r covers the 1/24 s that ends or starts at t, "a row that lies inside the tone" is
// read as one inside under both, rows 13 to 59 (README: Readings). Each reads 0.5/√2 = 0.35355 within 1e-4. The
// planted `envelope_reads_peak` reads about 0.5 there and fails, naming row 13, the first row inside.
import { describe, expect, it } from 'vitest';
import { AC, RATE, SEC, TIMEOUT, bakes, putAsset, rowsOf, useEvidence, useShow, wav16, type Planted, type Row } from './helpers.ts';

const show = useShow();
const evidenceDir = useEvidence();

const ROW = SEC / 24; // 29,400,000 flicks
const INSIDE = Array.from({ length: 47 }, (_, i) => 13 + i);

/** Rows 13 to 59 against 0.5/√2; each line names its row. */
function judge(rows: Row[]): string[] {
  const f: string[] = [];
  for (const r of INSIDE) {
    const row = rows.find((x) => x.t === r * ROW);
    if (!row) f.push(`row ${r} (t = ${r}/24 s): no row in the bake`);
    else if (Math.abs(row.rms - 0.5 / Math.SQRT2) > 1e-4) f.push(`row ${r} (t = ${r}/24 s) reads rms ${row.rms.toFixed(6)}, not 0.3536 within 1e-4`);
  }
  return f;
}

function bake(what: string, planted?: Planted): Row[] {
  const evidence = evidenceDir();
  const x = new Float32Array(3 * RATE);
  for (let n = 0; n < 2 * RATE; n++) x[RATE / 2 + n] = 0.5 * Math.sin((2 * Math.PI * 960 * n) / RATE);
  const sha = putAsset(evidence, wav16(x));
  const [b] = bakes(show(), evidence, [{ asset: sha, kind: 'envelope', rate: 24, outputs: ['rms', 'centroid'] }], what, planted);
  return rowsOf(b!, planted ? `${what} (planted ${planted})` : what);
}

describe('AC5 an envelope bake reads a sine\'s rms in every row inside it', () => {
  it(`${AC[5]} a 24 Hz envelope bake of a 960 Hz sine of amplitude 0.5 reads rms 0.3536 within 1e-4 in rows 13 to 59; a planted bake that reads the peak reads 0.5 and fails, naming row 13`, () => {
    expect((RATE / 24) / (RATE / 960), 'a row holds 40 whole cycles').toBe(40);
    expect(judge(bake('a 960 Hz sine')), 'every row inside the tone reads its rms').toEqual([]);

    const planted: Planted = 'envelope_reads_peak';
    const w = judge(bake('a 960 Hz sine', planted));
    const first = /^row (\d+) .* reads rms ([\d.]+),/.exec(w[0] ?? '');
    expect(first !== null && first[1] === '13' && Math.abs(Number(first[2]) - 0.5) <= 5e-3, `planted ${planted} reads 0.5 and fails, naming row 13 first; got ${JSON.stringify(w.slice(0, 3))}`).toBe(true);
  }, TIMEOUT);
});
