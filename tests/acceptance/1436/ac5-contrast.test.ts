// Criterion 5 (README: Criteria to tests): "Text over each operator keeps its contrast floor at 60 sampled frames. A
// planted effect that drops secondary ink below its floor fails, naming the frame and the ratio."
// The grid (each operator under a line of secondary ink) drawn at 60 sampled times, t = k × 0.1 s for k = 0 … 59, in
// light and in dark, with each text's glyphs taken out (`--omit-text`, nothing else changed), so the pixels under each
// line are what the text is drawn over. At every frame, for every operator, the secondary ink composited over each pixel
// of its text's rect keeps 4.5:1 against that pixel (the floor #882's guard holds the tier to on the ground). The wrong
// program (DEEP_CHROME_PLANT=drops_secondary_ink) is an effect that, from 3 s on, covers its text's rect with the ink's
// own color: the same check fails, its first finding naming the frame and the ratio.
import { describe, expect, it } from 'vitest';
import { AC, APPEARANCES, FLOOR, OPERATORS, device, grid, lowest, replica, role, textId, textRect, useBuild, type Appearance, type Plant } from './helpers.ts';

const bin = useBuild('replica');
const TIMES = Array.from({ length: 60 }, (_, k) => Math.round(k * 100) / 1000);

function findings(appearance: Appearance, plant?: Plant): string[] {
  const fx = grid();
  const drawn = replica(bin(), fx, { appearance, at: TIMES, omitText: OPERATORS.map(textId), ...(plant ? { plant } : {}) });
  expect(drawn.pngs.length, 'one frame per sampled time').toBe(60);
  const ink = role('ink_secondary', appearance);
  const out: string[] = [];
  drawn.pngs.forEach((png, k) => {
    OPERATORS.forEach((op, i) => {
      const ratio = lowest(png, device(textRect(i), fx['scale'] as number), ink);
      if (ratio < FLOOR.ink_secondary) out.push(`frame ${k} (t ${TIMES[k]} s), ${op}: ratio ${ratio.toFixed(2)} under the secondary ink's floor of ${FLOOR.ink_secondary}`);
    });
  });
  return out;
}

describe(`#1436 AC5 ${AC[5]} text over each operator keeps its contrast floor at 60 sampled frames`, () => {
  it.each(APPEARANCES.map((a) => [a]))('AC5 in %s, the secondary ink over every operator keeps 4.5:1 at each of 60 sampled frames', (appearance) => {
    expect(findings(appearance), 'frames where text over an operator is under its floor').toEqual([]);
  }, 3_600_000);

  it('AC5 a planted effect that drops secondary ink below its floor (DEEP_CHROME_PLANT=drops_secondary_ink) fails, naming the frame and the ratio', () => {
    const found = findings('light', 'drops_secondary_ink');
    expect(found.length, 'the planted effect fails the same check').toBeGreaterThan(0);
    expect(found[0], 'the first finding names the frame and the ratio').toMatch(/^frame \d+ \(t [\d.]+ s\), [a-z_.]+: ratio \d+\.\d\d under/);
  }, 3_600_000);
});
