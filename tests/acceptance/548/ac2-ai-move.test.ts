// #548.9932c4df: On the hex board, an AI step that moves the selected unit recomputes the previewed route in that step's
// first frame with the pointer still, and a seek to before the move shows the route from the unit's earlier cell; a
// planted preview that runs only when the hover changes keeps the old route and fails, naming the frame
//
// Criterion 1's board in a live view of `deep-logic`: played a frame at a time at 60 frames a second, the pointer set
// once at frame 100 on a hex 11 from the unit and never moved again; the AI moves the unit from U0 to U1 at step 120,
// so frame 120 (t 2 s), the first frame whose state holds step 120, must draw the route from U1; then a seek to 1.5 s
// must draw the route from U0. The expected routes are this suite's own `routeOf`. The planted
// `preview_runs_on_hover_only` keeps the route from U0 at frame 120 and fails, naming it.

import { describe, expect, it } from 'vitest';
import { HOVERS, MOVE_STEP, U0, U1, game, probe, routeOf, type Cell } from './programs.ts';
import { gamePiece } from './fixtures.ts';
import {
  AC, STEP, TIMEOUT, admitted, checkCall, failsNaming, live, logic, logicBin, none, offsetIn, openView, prebuild, same, show,
  type Frame, type LogicPlanted,
} from './helpers.ts';

prebuild(() => { logicBin(); });
const HOVER_FRAME = 100;
const PLAYED = 180;
const SEEK = 1.5;
const H: Cell = HOVERS[0]!;
const secs = (f: Frame): string => `${+(f.t / (60 * STEP)).toFixed(4)} s`;

interface Run { frames: Frame[]; sought: Frame }
async function play(planted: LogicPlanted[] = []): Promise<Run> {
  const [reply] = logic([checkCall(gamePiece(probe()))]);
  const l0 = admitted(reply!, 'check of the hex board\'s item (its preview included)')['game']!;
  const p = gamePiece(game({ unit: offsetIn(l0, 'writes', 'unit'), here: offsetIn(l0, 'writes', 'here') }));
  const l = live(planted);
  try {
    const v = await openView(l, p, 5);
    const frames: Frame[] = [];
    for (let n = 1; n <= PLAYED; n++) frames.push((await v.frame({ play: true, ...(n === HOVER_FRAME ? { hover: { place: H } } : {}) })).landed);
    const sought = (await v.frame({ seek: SEEK })).landed;
    return { frames, sought };
  } finally {
    l.stop();
  }
}
/** The criterion's judgement: from the hovered frame on, each frame draws the route from the unit's cell in the state it shows, and the seek's frame the route from U0. */
function judge(r: Run): string[] {
  const failures: string[] = [];
  for (const [i, f] of r.frames.entries()) {
    const n = i + 1;
    if (n < HOVER_FRAME) continue;
    const unit = n >= MOVE_STEP ? U1 : U0;
    const route = routeOf(unit, H);
    const first = n === MOVE_STEP ? `, the first frame of step ${MOVE_STEP}'s move` : '';
    if (!same(f.draws['game.preview.route'], route)) failures.push(`frame ${f.frame} (t ${secs(f)}${first}): the route ${show(f.draws['game.preview.route'] ?? null, 160)} isn't the route from the unit at ${show(unit)} to ${show(H)}, ${show(route)}`);
  }
  const route = routeOf(U0, H);
  if (!same(r.sought.draws['game.preview.route'], route)) failures.push(`frame ${r.sought.frame} (t ${secs(r.sought)}, the seek to ${SEEK} s before the move): the route ${show(r.sought.draws['game.preview.route'] ?? null, 160)} isn't the route from the unit's earlier cell ${show(U0)}, ${show(route)}`);
  return failures;
}

describe(`${AC[2]} the AI's move recomputes the previewed route in its step's first frame, and a seek before it shows the earlier route`, () => {
  it(`${AC[2]} with the pointer still, frame 120 draws the route from the moved unit and the seek to 1.5 s the route from its earlier cell; the planted preview_runs_on_hover_only keeps the old route and fails, naming the frame`, async () => {
    const real = await play();
    // The harness: the frames land on their times, and the AI moves the unit at step 120.
    real.frames.forEach((f, i) => expect([f.t, f.at], `frame ${i + 1} lands at ${i + 1}/60 s`).toEqual([(i + 1) * STEP, i + 2]));
    expect(real.frames[MOVE_STEP - 2]!.draws['game.unit'], 'frame 119 shows the unit at U0').toEqual([U0[0], U0[1]]);
    expect(real.frames[MOVE_STEP - 1]!.draws['game.unit'], 'frame 120 shows step 120\'s move to U1').toEqual([U1[0], U1[1]]);
    expect(real.sought.at, `the seek to ${SEEK} s lands on the state after step 90`).toBe(91);
    expect(routeOf(U0, H), 'the two routes differ').not.toEqual(routeOf(U1, H));
    none(judge(real), 'the real preview');

    const planted = judge(await play(['preview_runs_on_hover_only']));
    console.log(`${AC[2]} preview_runs_on_hover_only:\n  ${planted.join('\n  ')}`);
    failsNaming(planted, [/^frame \d+ \(t 2 s, the first frame of step 120's move\)/], 'the planted preview_runs_on_hover_only');
  }, TIMEOUT);
});
