// Criterion 6 (README: Criteria to tests): a window with 5 settled effects has 0 frames and at most 1 wakeup over 10 s.
// `deep-app --chrome idle.json --idle 10` opens the app's real window on this Mac's screen with the fixture's five frost@1
// slots, waits until every effect reports settled, then holds the window 10 s of the real clock and reports the frames it
// presented and the process's package-idle wakeups meanwhile. Five runs: every run 0 frames, on any Mac; the wakeups
// judged by scripts/benchmark.mjs's judgeLimit against 1, so they count only on a reference Mac (mains power, Low Power
// Mode off, thermal state nominal, unloaded) and are INCONCLUSIVE, which fails here, anywhere else. The wrong program
// (DEEP_CHROME_PLANT=redraws_settled_effects) asks for a frame every vsync once settled: its frames are counted.
// Runs only with DEEP_1434_LIVE=1; otherwise each test fails INCONCLUSIVE, never passing.
import { rmSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fixture, judge, live, load, requireLive, useBuild, type Obj, type Plant } from './helpers.ts';

const bin = useBuild('app');
const IDLE = fixture('idle.json');
const EFFECTS = ['fx-1', 'fx-2', 'fx-3', 'fx-4', 'fx-5'];

function idle(plant?: Plant): Obj {
  const { report, dir } = live(bin(), IDLE, ['--idle', '10'], plant);
  rmSync(dir, { recursive: true, force: true });
  expect(report['mode'], 'the idle report').toBe('idle');
  const effects = report['effects'] as { id: string; state: string }[];
  expect(effects.map((e) => e.id).sort(), 'it reports each of the five effects').toEqual(EFFECTS);
  expect(effects.filter((e) => e.state !== 'settled'), 'every effect settled before the hold').toEqual([]);
  expect(report['seconds'] as number, 'the hold lasted 10 s of the real clock').toBeGreaterThanOrEqual(10);
  expect(Number.isInteger(report['frames']) && Number.isInteger(report['wakeups']), `frames and wakeups are counts: ${JSON.stringify(report).slice(0, 400)}`).toBe(true);
  return report;
}

describe('#1434 AC6 a window with 5 settled effects has 0 frames and at most 1 wakeup over 10 s', () => {
  it('AC6 five 10 s holds of the settled window: 0 frames in every one, and at most 1 wakeup judged on the reference Mac', async () => {
    requireLive('the idle run');
    const runs: Obj[] = [];
    const loads: { start: number; end: number }[] = [];
    for (let i = 0; i < 5; i++) {
      const start = load();
      runs.push(idle());
      loads.push({ start, end: load() });
    }
    expect(runs.map((r) => r['frames']), 'frames presented in each 10 s hold').toEqual([0, 0, 0, 0, 0]);
    const verdict = await judge(1, runs.map((r) => r['wakeups'] as number), loads);
    expect(verdict['status'], `wakeups over each 10 s hold, judged against 1: ${JSON.stringify(verdict)}`).toBe('PASS');
  }, 1_800_000);

  it('AC6 a planted effect that redraws once settled (DEEP_CHROME_PLANT=redraws_settled_effects) presents frames in the hold, and fails', () => {
    requireLive('the idle run');
    expect(idle('redraws_settled_effects')['frames'] as number, 'the planted window\'s frames in its hold').toBeGreaterThan(0);
  }, 600_000);
});
