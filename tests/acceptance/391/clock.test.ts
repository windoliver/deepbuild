import { describe, expect, it } from 'vitest';
import { MOTION_BIN, VSYNC_60, accepted, arr, compareRuns, fixture, itemX, obj, sec, useBinaries, type JsonObject, type JsonValue } from './helpers.ts';

useBinaries('deep-motion');

const FIGURE = fixture('still-figure.json');
/** The figure's span (5 s) plus 5 s, as the scheduler's kit case runs a parity fixture. */
const TO = sec(10);
const START = sec(3);
const SETTLED = sec(4.2);

interface Run { vsyncs: JsonObject[]; raw: JsonValue[] }

function run(mode: 'armed' | 'every_vsync', planted?: string): Run {
  const out = accepted(MOTION_BIN, 'run', { doc: FIGURE, refresh_hz: 60, to: TO, mode, ...(planted ? { planted } : {}) });
  const raw = arr(out['vsyncs'], `run ${mode}: vsyncs`);
  expect(raw.length, `run ${mode}: one record per vsync from 0 to 10 s at 60 Hz`).toBe(TO / VSYNC_60 + 1);
  const vsyncs = raw.map((v, k) => {
    const r = obj(v, `run ${mode}: vsyncs[${k}]`);
    expect(r['t'], `run ${mode}: vsyncs[${k}] is at k × 1/60 s`).toBe(k * VSYNC_60);
    expect(typeof r['presented'], `run ${mode}: vsyncs[${k}].presented is a boolean`).toBe('boolean');
    return r;
  });
  return { vsyncs, raw };
}

const presentedAt = (r: Run): number[] => r.vsyncs.filter((v) => v['presented'] === true).map((v) => v['t'] as number);

describe('AC5 a still figure whose placement starts at 3 s and whose spring settles at 4.2 s presents frames at both times by the frame clock alone', () => {
  it('AC5 the armed run presents its first frame, then nothing until 3 s, every vsync while the spring moves, the settled frame at 4.2 s, and nothing after', () => {
    const armed = run('armed');
    const shown = presentedAt(armed);
    // Nothing but the frame clock arms these frames: the run has no commit, reading or input.
    expect(shown[0], 'the first frame, at 0 s').toBe(0);
    expect(shown.filter((t) => t > 0 && t < START), 'no frame between 0 s and the placement\'s start').toEqual([]);
    expect(shown.includes(START), `a frame at 3 s, when the placement starts; presented at ${JSON.stringify(shown.slice(0, 6))}…`).toBe(true);
    expect(shown.includes(SETTLED), 'a frame at 4.2 s, when the spring settles').toBe(true);
    const moving = armed.vsyncs.filter((v) => (v['t'] as number) > START && (v['t'] as number) < SETTLED);
    expect(moving.filter((v) => v['presented'] !== true).map((v) => v['t']), 'a frame at every vsync while the spring moves').toEqual([]);
    expect(shown.filter((t) => t > SETTLED), 'no frame after the spring settles').toEqual([]);
    // The frame at 0 s knows when the figure next changes: the placement's start.
    expect(armed.vsyncs[0]!['valid_until'], 'the first frame is valid until 3 s').toBe(START);
    expect(armed.vsyncs.at(-1)!['valid_until'], 'the settled frame is valid for ever (null)').toBeNull();
  });

  it('AC5 the every-vsync run\'s evaluated data equals the armed run\'s at each vsync, and the figure really moves', () => {
    const armed = run('armed');
    const every = run('every_vsync');
    expect(every.vsyncs.every((v) => v['presented'] === true), 'the every-vsync run presents at every vsync').toBe(true);
    expect(compareRuns(armed.raw, every.raw), 'the armed run shows what an every-vsync run evaluates').toBeNull();
    // A program that never moves anything would pass the comparison; the figure must do what it says.
    const x = (t: number): number => itemX(every.vsyncs[t / VSYNC_60]!, 'dot');
    expect(x(sec(2.5)), 'before its placement the dot is at its own x, 0').toBe(0);
    expect(x(START), 'at 3 s the placement puts the dot at its clip\'s first key, 20').toBe(20);
    const mid = x(sec(3.5));
    expect(mid > 20 && mid < 100, `at 3.5 s the spring is on its way: ${mid}`).toBe(true);
    expect(x(SETTLED), 'at 4.2 s the dot has settled at 100').toBe(100);
    expect(x(TO), 'and stays there').toBe(100);
  });

  it('AC5 a planted valid_until that ignores placements stops at 0 s and fails this comparison, naming the item', () => {
    const planted = run('armed', 'valid_until_ignores_placements');
    expect(presentedAt(planted), 'the planted twin presents its first frame and then stops').toEqual([0]);
    const every = run('every_vsync');
    const failure = compareRuns(planted.raw, every.raw);
    expect(failure, 'the comparison fails on the planted twin').not.toBeNull();
    expect(failure!, 'the failure names the item that moved without a frame').toMatch(/item dot\b/);
    expect(failure!, 'the failure names only the item that differs').not.toMatch(/item (card|label)\b/);
    expect(failure!, 'the failure is at the placement\'s start, 3 s').toMatch(/\(t = 2116800000 flicks/);
  });
});
