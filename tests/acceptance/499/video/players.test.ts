// AC12 #499.96045131: Five 1080p players at 640 × 360 show 150 frames a second with under 0.5% dropped for 8 s, with
// 0 gross allocations per frame after warm-up.
//
// Through `deep-canvas-render idle` (#854's window on the real clock, GPUI's offscreen Metal renderer) with the
// request's `store`: five image@1 items, each its own 1080p 30 fps recording, in 640 × 360 boxes on one board. A run
// watches 9 s; its first second is the warm-up, and the 8 s after it, [1 s, 9 s), are judged. `players.<id>.shown`
// lists each new source frame a player put on screen; a source frame skipped between two shown ones is dropped.
// `drawn[].allocs` is the heap allocations the process made while preparing and presenting that frame (a counting
// global allocator, every thread of the render process; the decode worker is another process). A warm-up run, then
// five runs in one process. Allocations are a count, judged on any Mac; frames shown and dropped are a timing, judged
// only on a reference Mac by #854's rule over the five runs. No wrong program is named; the base has no players.

import { describe, expect, it } from 'vitest';
import {
  AC, LOOK, TIMEOUT, asset, blocked, documentOf, idleRuns, judgeFive, players1080, putStore, useBinary, useTemp, videoItem, type IdleRun,
} from './helpers.ts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const renderBin = useBinary('deep-canvas-render');
const temp = useTemp('players');
const FROM = 1000;
const TO = 9000;
const IDS = ['p1', 'p2', 'p3', 'p4', 'p5'];

let cached: IdleRun[] | string | undefined;
function runs(): IdleRun[] {
  if (cached === undefined) {
    const dir = temp();
    const store = join(dir, 'store');
    const shas = players1080(dir).map((p) => putStore(store, readFileSync(p)));
    const boxes: [number, number, number, number][] = [[0, 0, 640, 360], [640, 0, 640, 360], [0, 360, 640, 360], [640, 360, 640, 360], [0, 720, 640, 360]];
    const doc = documentOf('players', 'board', [1280, 1080], IDS.map((id, i) => videoItem(id, shas[i]!, boxes[i]!)), Object.fromEntries(IDS.map((id, i) => [id, asset(shas[i]!)])), {}, { span: '11s' });
    cached = idleRuns(renderBin(), { doc, look: LOOK, view: { zoom: 1, theme: 'light' }, seconds: TO / 1000, store }, 'idle with five players');
  }
  if (typeof cached === 'string') blocked(cached);
  return cached;
}

/** Null when the five players showed at least 150 frames a second with under 0.5% dropped in [1 s, 9 s), else why. */
function framesFailure(run: IdleRun): string | null {
  let shown = 0; let due = 0;
  const per: string[] = [];
  for (const id of IDS) {
    const p = run.players.get(id);
    if (!p) return `player ${id} isn't reported`;
    const frames = p.shown.filter((s) => s.at_ms >= FROM && s.at_ms < TO).map((s) => s.frame);
    if (frames.some((f, i) => i > 0 && f <= frames[i - 1]!)) return `player ${id} showed its frames out of order`;
    const span = frames.length ? frames[frames.length - 1]! - frames[0]! + 1 : 0;
    shown += frames.length; due += span;
    per.push(`${id} ${frames.length}/${span}`);
  }
  const dropped = due - shown;
  const rate = shown / ((TO - FROM) / 1000);
  if (rate >= 150 * 0.995 && due > 0 && dropped / due < 0.005) return null;
  return `${shown} frames shown in 8 s (${rate.toFixed(1)} a second), ${dropped} of ${due} dropped (${((100 * dropped) / Math.max(1, due)).toFixed(2)}%); shown/due per player: ${per.join(', ')}`;
}

describe(`${AC[12]} five 1080p players at 640 × 360 on the real clock`, () => {
  it(`${AC[12]} after a 1 s warm-up, no frame of the five players' window allocates, in each of five runs`, () => {
    const list = runs();
    const failures: string[] = [];
    list.forEach((r, i) => {
      const after = r.drawn.filter((d) => d.at_ms >= FROM && d.at_ms < TO);
      if (after.length < 30 * 8) failures.push(`run ${i + 1}: only ${after.length} frames drawn in [1 s, 9 s)`);
      const bad = after.filter((d) => d.allocs !== 0);
      if (bad.length) failures.push(`run ${i + 1}: ${bad.length} frames allocate after warm-up, the first frame ${bad[0]!.frame} at ${bad[0]!.at_ms.toFixed(1)} ms with ${bad[0]!.allocs} allocations`);
    });
    expect(failures, '0 gross allocations per frame after warm-up').toEqual([]);
  }, TIMEOUT);

  it(`${AC[12]} on a reference Mac the five players show 150 frames a second with under 0.5% dropped for 8 s`, () => {
    const list = runs();
    const failures = list.map(framesFailure);
    const reading = list.map((r, i) => `run ${i + 1}: ${framesFailure(r) ?? 'pass'}`).join('; ');
    console.log(`${AC[12]} ${reading}`);
    judgeFive(failures, reading);
  }, TIMEOUT);
});
