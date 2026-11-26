// AC6 #3467.43114bc0: #499's five players at 640 × 360 show their frames as on the merge base: 150 frames a second
// with under 0.5% dropped, and 0 allocations a frame in the render process after warm-up.
//
// #499's own check of its five players (tests/acceptance/499/video/players.test.ts, its criterion 12), run again
// under this criterion: the same five 1080p recordings (#499's `players1080`), the same board of five 640 × 360
// boxes, the same `deep-canvas-render idle` line held for 9 s, a warm-up run and five runs in one process, the 8 s
// after each run's first second judged. Behaviour that must not change: the merge base passes it wherever the
// machine can judge it, and so must the change. The allocations are a count, judged on any Mac. The frames shown and
// dropped are a timing: on a fit reference Mac it is judged over the five runs by #854's rule, as #499's suite has
// it; elsewhere it is a reading, INCONCLUSIVE. The criterion names no planted program.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOOK, asset, documentOf, players1080, putStore, videoItem } from '../499/video/helpers.ts';
import { TIMEOUT, render, timingOverFive, useBinary, useTemp } from './helpers.ts';
import { allocsFailure, framesFailure, shownOf, type JsonValue } from './judges.ts';

const renderBin = useBinary('deep-canvas-render');
const temp = useTemp('players');
const FROM = 1000;
const TO = 9000;
const IDS = ['p1', 'p2', 'p3', 'p4', 'p5'];
const BOXES: [number, number, number, number][] = [[0, 0, 640, 360], [640, 0, 640, 360], [0, 360, 640, 360], [640, 360, 640, 360], [0, 720, 640, 360]];

let cached: JsonValue[] | undefined;
/** Five runs' answers, after a warm-up run in the same process. */
function runs(bin: string): JsonValue[] {
  if (cached === undefined) {
    const dir = temp();
    const store = join(dir, 'store');
    const shas = players1080(dir).map((p) => putStore(store, readFileSync(p)));
    const doc = documentOf('players', 'board', [1280, 1080], IDS.map((id, i) => videoItem(id, shas[i]!, BOXES[i]!)), Object.fromEntries(IDS.map((id, i) => [id, asset(shas[i]!)])), {}, { span: '11s' });
    const line = { doc, look: LOOK, view: { zoom: 1, theme: 'light' }, seconds: TO / 1000, store };
    cached = render(bin, 'idle', Array.from({ length: 6 }, () => line), 'idle with five players').slice(1);
  }
  return cached;
}

describe('AC6 #3467.43114bc0 #499\'s five players at 640 × 360 show their frames as on the merge base', () => {
  it('AC6 #3467.43114bc0 after a 1 s warm-up, no frame of the five players\' window allocates in the render process, in each of five runs', () => {
    const list = runs(renderBin());
    const failures = list.flatMap((answer, i) => { const f = allocsFailure(answer, FROM, TO); return f === null ? [] : [`run ${i + 1}: ${f}`]; });
    expect(failures, '0 allocations a frame after warm-up').toEqual([]);
  }, TIMEOUT);

  it('AC6 #3467.43114bc0 on a fit reference Mac the five players show 150 frames a second with under 0.5% dropped', async () => {
    const list = runs(renderBin());
    const unread = list.flatMap((answer, i) => IDS.flatMap((id) => { const rows = shownOf(answer, id, 'idle'); return typeof rows === 'string' ? [`run ${i + 1}: ${rows}`] : []; }));
    expect(unread, 'every run reports each player\'s `shown` rows').toEqual([]);
    const failures = list.map((answer) => framesFailure(answer, IDS, FROM, TO));
    const reading = failures.map((f, i) => `run ${i + 1}: ${f ?? 'pass'}`).join('; ');
    console.log(`AC6 #3467.43114bc0 ${reading}`);
    await timingOverFive(failures, reading);
  }, TIMEOUT);
});
