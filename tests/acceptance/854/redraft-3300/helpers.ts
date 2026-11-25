// #3300's blind redraft of #854's made-up readings (README). Everything of the first draft's helpers is used as
// written (`export *` below): the lane's runner and judge, the report checks, the reference-Mac gate and the design's
// rule. Only its made-up readings are redrafted: `patchRun` and `synthetic` here are the first draft's, line for line,
// save that every made-up run carries the one-minute load at its start and end, `loadStart` and `loadEnd` as `node
// benchmarks/canvas.mjs judge` reads them (benchmarks/canvas-judge.mjs `loadsOf`), and every made-up idle run a window
// shown throughout, `window.state` `shown` as the idle judge reads it (`shownWindow`).
import { join } from 'node:path';
import {
  AGENT_ADAPTERS, IDLE_SECONDS, ITEMS, PAGE_ROWS, PATCHES, REPO, RUNS, TASKS, isObject, percentile, readJson, referenceFingerprint,
  type JsonObject, type JsonValue, type PatchSample, type TaskKey,
} from '../helpers.ts';

export * from '../helpers.ts';

/**
 * A made-up run's one-minute load at its start and at its end: at rest. judgeLimit reads a run as loaded when a load is
 * above the core count of the machine that judges, and no machine has under one core, so a made-up reading's verdict
 * is the same on every Mac.
 */
export const LOAD_AT_REST = 1;
/** A made-up idle run's window: shown throughout its 60.01 s, as the idle task records a window held on screen (#1551). */
export const SHOWN = { state: 'shown', shown_ms: 60_010 } as const;

/** A patch-settled run: 200 samples of `ms` (split 3:1 CPU:GPU), each its own frame, running `ran`; at rest. */
export function patchRun(run: number, msOf: (patch: number) => number, ranOf: (patch: number) => Record<string, number>): JsonObject {
  const samples: PatchSample[] = Array.from({ length: PATCHES }, (_, k) => {
    const ms = msOf(k + 1);
    return { patch: k + 1, item: `r${String(k).padStart(5, '0')}`, frame: 100 * run + 2 * (k + 1), cpu_ms: ms * 0.75, gpu_ms: ms * 0.25, ms, ran: ranOf(k + 1) };
  });
  return { p95_ms: percentile(samples.map((s) => s.ms), 0.95), samples: samples as unknown as JsonValue[], loadStart: LOAD_AT_REST, loadEnd: LOAD_AT_REST };
}

/** The tokenizer the first agent adapter's facts pin, as a report names it; a made-up one where none is pinned. */
function pinnedTokenizer(): JsonObject {
  for (const adapter of AGENT_ADAPTERS) {
    try {
      const t = (readJson(join(REPO, 'adapters', `${adapter}.facts.json`)) as JsonObject)['tokenizer'];
      if (isObject(t) && typeof t['name'] === 'string' && typeof t['version'] === 'string') return { adapter, name: t['name'], version: t['version'] };
    } catch { /* no facts file */ }
  }
  return { adapter: 'claude-code', name: 'made-up', version: '1.0.0' };
}

/** A reading of `key`'s task within every target, on a reference Mac's fingerprint whose build is `profile` (none when null); every run at rest. */
export function synthetic(key: TaskKey, profile: string | null = 'release'): JsonObject {
  const base = { task: TASKS[key].id, fingerprint: referenceFingerprint(profile) };
  const five = <T>(make: (run: number) => T): T[] => Array.from({ length: RUNS }, (_, i) => make(i + 1));
  switch (key) {
    case 'patch':
      return { ...base, items: ITEMS, patches: PATCHES, runs: five((r) => patchRun(r, () => 1, () => ({ 'core.transform': 1, 'marks2d.frame': 1 }))) };
    case 'read':
      return { ...base, items: ITEMS, tokenizer: pinnedTokenizer(),
        runs: five(() => ({ summary: { ms: 5, tokens: 800, bytes: 3_200, rows: 0 }, page: { ms: 20, tokens: 30_000, bytes: 120_000, rows: PAGE_ROWS, next: 'c1000' }, loadStart: LOAD_AT_REST, loadEnd: LOAD_AT_REST })) };
    case 'idle':
      return { ...base, fixture: 'benchmarks/canvas/figure.json', seconds: IDLE_SECONDS,
        runs: five(() => ({ opened_frames: 1, seconds: 60.01, frames: 0, drawn: [], wakeups: 0, cpu_ms: 6, cpu_fraction: 6 / 60_010, window: { ...SHOWN }, loadStart: LOAD_AT_REST, loadEnd: LOAD_AT_REST })) };
    case 'replica':
      return { ...base, fixture: 'benchmarks/canvas/figure.json',
        runs: five(() => ({ ms: 150, pipelines: [{ name: 'marks2d.fill', on_first_frame: false }, { name: 'text.glyphs', on_first_frame: false }], loadStart: LOAD_AT_REST, loadEnd: LOAD_AT_REST })) };
  }
}
