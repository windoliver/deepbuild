// AC4: a drag shows on screen within 2 frames, and a patch within 1 frame of the latch. Counted in frames of the
// hub's virtual display clock (#96's: 120 Hz, the latch 2 ms before each vsync, 0.5 ms of the checker per patch),
// so a run reads no wall time and replays exactly; the frame clock primitive runs its own kit on such a clock. The
// frames are the ones the panel presented, from `deep-show run`'s `presented` call, each with its vsync, the
// revision it drew and the camera it drew with (README: The surface under test). At the base `deep-show` has no
// `input` or `presented` call and answers the scenario `bad_input`.
import { describe, expect, it } from 'vitest';
import {
  ALPHA, DOC, PANEL, PERIOD, SHOW_BIN, arr, camera2, down, fixture, move, num, obj, presentedCall, runShow, seeded, showScenario, ulid, up, useBins, useOut,
  type Camera2, type JsonObject, type Point, type ShowPlanted,
} from './helpers.ts';

const bins = useBins([SHOW_BIN]);
const out = useOut();
const T0 = 20 * PERIOD;

interface Shown { vsync: number; rev: number; camera: Camera2 }
function presented(reply: JsonObject, what: string): Shown[] {
  const frames = arr(reply['frames'], `${what}: frames`).map((v, i) => {
    const f = obj(v, `${what}: frames[${i}]`);
    return { vsync: num(f['vsync'], `${what}: frames[${i}].vsync`), rev: num(f['rev'], `${what}: frames[${i}].rev`), camera: camera2(f['camera'], `${what}: frames[${i}].camera`) };
  });
  expect(frames.every((f, i) => i === 0 || f.vsync > frames[i - 1]!.vsync), `${what}: frames in vsync order, one per vsync`).toBe(true);
  expect(frames.every((f) => (f.vsync % PERIOD) === 0), `${what}: every frame presents at a vsync of the clock`).toBe(true);
  return frames;
}

// ---- A drag: 40 moves of 12 px right at seeded times between 0.35 and 1.65 frames apart, so they land at every
// phase of the frame; a move whose effect first shows more than 2 frames after it fails.
const STEP = 12;
const START: Point = [180, 330];
function dragRun(planted?: ShowPlanted): { moves: { at: number; x: number }[]; frames: Shown[]; tx0: number; uPerPx: number } {
  const rand = seeded(383_004);
  const moves: { at: number; x: number }[] = [];
  let t = T0;
  for (let i = 0; i < 40; i++) { t += Math.round((0.35 + 1.3 * rand()) * PERIOD); moves.push({ at: t, x: START[0] + (i + 1) * STEP }); }
  const calls = [
    { call: 'scope', at: T0 - PERIOD, panel: 'main' },
    { call: 'input', at: T0, panel: 'main', event: down(START) },
    ...moves.map((m) => ({ call: 'input', at: m.at, panel: 'main', event: move([m.x, START[1]]) })),
    { call: 'input', at: t + 3 * PERIOD, panel: 'main', event: up([moves[39]!.x, START[1]]) },
    presentedCall(t + 20 * PERIOD, 'main'),
  ];
  const replies = runShow(bins.bin(SHOW_BIN), showScenario(out(), [{ doc: DOC, panel: 'main', rect: PANEL, document: fixture('chart.json') }], calls, planted), `the chart's drag${planted ? ` (planted ${planted})` : ''}`);
  const start = obj(obj(replies[1], 'scope')['state'], 'scope.state');
  const cam = camera2(start['camera'], 'the chart\'s camera before the drag');
  return { moves, frames: presented(replies[replies.length - 1]!, 'the chart\'s presented frames'), tx0: cam.target[0], uPerPx: cam.view_width / PANEL[2] };
}
/** Each move first shows, the content following the pointer, within 2 frames of its input; failures name the move. */
function dragFailures(r: ReturnType<typeof dragRun>): string[] {
  const f: string[] = [];
  r.moves.forEach((m, i) => {
    // The view's target moves left as the content follows the pointer right: after move i it is at or past this.
    const want = r.tx0 - (i + 1) * STEP * r.uPerPx;
    const shown = r.frames.find((fr) => fr.vsync >= m.at && fr.camera.target[0] <= want + 1e-6);
    if (!shown) f.push(`move ${i + 1} at ${m.at} never shows: no presented frame's camera reaches target x ${want}`);
    else if (shown.vsync - m.at > 2 * PERIOD) f.push(`move ${i + 1} at ${m.at} first shows at the vsync ${shown.vsync}, ${((shown.vsync - m.at) / PERIOD).toFixed(2)} frames later, past 2 frames`);
  });
  return f;
}

// ---- Patches: the agent adds 30 dots, one patch each, at seeded times; each applied patch's revision must first be drawn
// at a vsync within 1 frame of the latch it became current at.
const WORK = ulid('01JB383W', 1);
function patchRun(planted?: ShowPlanted): { patches: { rev: number; current: number }[]; frames: Shown[] } {
  const rand = seeded(383_014);
  let t = T0;
  const calls: JsonObject[] = [];
  for (let k = 0; k < 30; k++) {
    t += Math.round((0.4 + 2.2 * rand()) * PERIOD);
    calls.push({
      call: 'deep_show', session: ALPHA.id, doc: WORK, at: t,
      // Each patch adds a dot of its own on base 0, so every one rebases cleanly whenever it arrives (#96).
      patch: {
        patch: ulid('01JB383P', k + 1), doc: WORK, base: 0, reason: 'add a dot',
        ops: [{ op: 'create', item: { id: `alpha.d${k}`, kind: 'rect@1', name: `Dot ${k}`, order: `b${String(k).padStart(2, '0')}`, params: { box: [0, 0, 12, 12], paint: { fill: { role: 'ink' } } }, at: { pos: [40 + 20 * k, 300, 0] } } }],
      },
    });
  }
  calls.push(presentedCall(t + 20 * PERIOD, 'main'));
  const replies = runShow(bins.bin(SHOW_BIN), showScenario(out(), [{ doc: WORK, panel: 'main', rect: PANEL, document: fixture('work.json'), seed: true }], calls, planted), `the agent's patches${planted ? ` (planted ${planted})` : ''}`);
  const patches = replies.slice(0, 30).map((r, k) => {
    expect(r['outcome'], `patch ${k + 1} applies: ${JSON.stringify(r).slice(0, 400)}`).toBe('applied');
    return { rev: num(r['rev'], `patch ${k + 1}: rev`), current: num(r['current'], `patch ${k + 1}: current (the latch it became current at)`) };
  });
  return { patches, frames: presented(replies[30]!, 'the board\'s presented frames') };
}
function patchFailures(r: ReturnType<typeof patchRun>): string[] {
  const f: string[] = [];
  r.patches.forEach((p, k) => {
    const shown = r.frames.find((fr) => fr.rev >= p.rev);
    if (!shown) f.push(`patch ${k + 1} (revision ${p.rev}, current at ${p.current}) is never drawn`);
    else if (shown.vsync < p.current) f.push(`patch ${k + 1}'s revision ${p.rev} is drawn at ${shown.vsync}, before its latch ${p.current}`);
    else if (shown.vsync - p.current > PERIOD) f.push(`patch ${k + 1}'s revision ${p.rev}, current at the latch ${p.current}, is first drawn at ${shown.vsync}, ${((shown.vsync - p.current) / PERIOD).toFixed(2)} frames after it, past 1 frame`);
  });
  return f;
}

describe('AC4 a drag shows on screen within 2 frames, and a patch within 1 frame of the latch', () => {
  it('AC4 every move of a drag on the chart shows within 2 frames of its input, at every phase of the frame', () => {
    expect(dragFailures(dragRun()), 'each move shows within 2 frames').toEqual([]);
    // Wrong program: a drag that moves the view only when it ends fails, naming the moves.
    const twin = dragFailures(dragRun('drag_shows_on_release'));
    expect(twin.length, `the planted drag_shows_on_release fails: ${JSON.stringify(twin.slice(0, 3))}`).toBeGreaterThan(0);
  }, 600_000);

  it('AC4 every patch an agent sends shows within 1 frame of the latch it became current at', () => {
    expect(patchFailures(patchRun()), 'each patch shows within 1 frame of its latch').toEqual([]);
    // Wrong program: a revision first drawn one frame after the frame its latch begins fails, naming the patches.
    const twin = patchFailures(patchRun('patch_shows_a_frame_late'));
    expect(twin.length, `the planted patch_shows_a_frame_late fails: ${JSON.stringify(twin.slice(0, 3))}`).toBeGreaterThan(0);
  }, 600_000);
});
