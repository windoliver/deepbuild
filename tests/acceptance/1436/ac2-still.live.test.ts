// Criterion 2 (README: Criteria to tests), its live half: "Under reduced motion every operator holds its still pose,
// with 0 frames after the first."
// `deep-app --chrome <grid> --reduce-motion --after-first 5` opens the app's real window with all 24 operators, the app's
// reduced motion on, and counts the frames the window presents in the 5 s after the first frame it presents once shown,
// that frame not counted. Under reduced motion: every effect painted in that first frame, and 0 frames after it. The same
// window without reduced motion presents frames in those 5 s, so the count can see a window that keeps drawing.
// Runs only with DEEP_1436_LIVE=1; otherwise each test fails INCONCLUSIVE, never passing.
import { describe, expect, it } from 'vitest';
import { AC, OPERATORS, grid, live, requireLive, tileId, useBuild, type Obj } from './helpers.ts';

const bin = useBuild('app');

function afterFirst(reduceMotion: boolean): Obj {
  const report = live(bin(), grid(), ['--after-first', '5'], { reduceMotion });
  expect(report['mode'], 'the after-first report').toBe('after_first');
  expect(report['seconds'] as number, 'it counted 5 s of the real clock').toBeGreaterThanOrEqual(5);
  expect(Number.isInteger(report['frames']), `frames is a count: ${JSON.stringify(report).slice(0, 400)}`).toBe(true);
  const effects = report['effects'] as { id: string; state: string }[];
  expect(effects.map((e) => e.id).sort(), 'it reports each of the 24 effects').toEqual(OPERATORS.map(tileId).sort());
  expect(effects.filter((e) => e.state === 'unpainted'), 'every effect painted in the first frame').toEqual([]);
  return report;
}

describe(`#1436 AC2 ${AC[2]} under reduced motion the live window presents 0 frames after the first`, () => {
  it('AC2 with reduced motion on, the window of all 24 operators presents 0 frames in the 5 s after its first', () => {
    requireLive('the reduced-motion run');
    expect(afterFirst(true)['frames'], 'frames presented after the first').toBe(0);
  }, 1_800_000);

  it('AC2 the same window without reduced motion presents frames after its first', () => {
    requireLive('the reduced-motion run');
    expect(afterFirst(false)['frames'] as number, 'frames presented after the first').toBeGreaterThan(0);
  }, 1_800_000);
});
