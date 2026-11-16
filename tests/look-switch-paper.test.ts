// #463's regression: a 2D film that switches looks (#417's look events, art@1's AC2 switches) draws each frame after
// the switch on the new look's paper. Before this change film2d built the paper once, from the look the film opened
// in, so a switch from a paper look to another kept the first look's paper under the new look's marks.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO, TIMEOUT, requireGpu, run, useBins, useDir, type JsonObject } from './acceptance/462/helpers.ts';

const bins = useBins(['deep-gpu']);
const dir = useDir();
const PACKS = [{ id: 'deepbuild/art', dir: join(REPO, 'packs', 'art-1.0.0') }];
const SCENE = (): JsonObject => (JSON.parse(readFileSync(join(REPO, 'tests', 'acceptance', '463', 'fixtures', 'scene.json'), 'utf8')) as { '2d': JsonObject })['2d'];

/** Frame 11's pixel hash of the scene's film opened in `look`, switched to `then` at frame 10 when given. */
function frame11(look: string, then?: string): string {
  const call: JsonObject = { call: 'film2d', doc: SCENE(), look, packs: PACKS, fps: 30, frames: 12, hash: true };
  if (then) call['events'] = [{ frame: 10, look: then }];
  const [reply] = run(bins.bin('deep-gpu'), dir(), [call]);
  const row = (reply!['frames'] as JsonObject[]).find((f) => f['frame'] === 11);
  expect(row, `frame 11 of ${look}${then ? ` switched to ${then}` : ''}: ${JSON.stringify(reply).slice(0, 400)}`).toBeDefined();
  return String(row!['pixel_hash']);
}

describe('a 2D look switch', () => {
  it('draws the frames after it on the new look\'s paper, as a film opened in that look does', () => {
    requireGpu();
    for (const [from, to] of [['art.flow_brush', 'art.neon_tape'], ['art.flow_brush', 'art.dab']] as const) {
      expect(frame11(from, to), `${from} switched to ${to} draws frame 11 as ${to} does from the start`).toBe(frame11(to));
    }
  }, TIMEOUT);
});
