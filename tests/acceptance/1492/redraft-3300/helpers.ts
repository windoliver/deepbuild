// #3300's blind redraft of #1492's made-up idle reading (README). Everything of the first draft's helpers is used as
// written (`export *` below): the panel host, the test panels and the lane's judge. Only `idleReport` is redrafted: the
// first draft's, line for line, save that every made-up run carries the one-minute load at its start and end,
// `loadStart` and `loadEnd` as `node benchmarks/canvas.mjs judge` reads them (benchmarks/canvas-judge.mjs `loadsOf`),
// and a window shown throughout, `window.state` `shown` as the idle judge reads it (`shownWindow`).
import type { Json, Line } from '../helpers.ts';

export * from '../helpers.ts';

/**
 * A made-up run's one-minute load at its start and at its end: at rest. judgeLimit reads a run as loaded when a load is
 * above the core count of the machine that judges, and no machine has under one core, so the verdict is the same on
 * every Mac.
 */
export const LOAD_AT_REST = 1;

export function idleReport(energy: (run: number) => Json): Line {
  const run = (i: number): Line => ({ opened_frames: 1, seconds: 60.01, frames: 0, drawn: [], wakeups: 0, cpu_ms: 6, cpu_fraction: 6 / 60_010, energy: energy(i) as Json, window: { state: 'shown', shown_ms: 60_010 }, loadStart: LOAD_AT_REST, loadEnd: LOAD_AT_REST });
  return {
    task: 'canvas-idle', fixture: 'benchmarks/canvas/still.json', seconds: 60,
    fingerprint: { model: 'Mac15,7', chip: 'Apple M3 Pro', memoryBytes: 36 * 2 ** 30, power: 'ac', lowPowerMode: false, thermalState: 'nominal', macosBuild: '25G241', build: { profile: 'release', toolchain: 'rustc 1.99.1 (58cf8f9c3 2026-10-13)' } },
    runs: [1, 2, 3, 4, 5].map(run),
  };
}
