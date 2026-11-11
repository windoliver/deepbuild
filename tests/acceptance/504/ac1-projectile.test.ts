// #504.2171aba8: "A projectile board with angle and speed sliders and launch, top and landing stages works with no
// plug-in code per frame"
//
// The board (`board()` below) is a 2D figure, 960 × 540 u, 20 u to the metre, the launch point at (60, 480) u, y down:
//   - `angle` (15 to 75°, default 45) and `speed` (5 to 25 m/s, default 15): document-class sliders;
//   - `stage`: a stages control with `launch`, `top` and `landing`, each with its shot (an explicit 2D pose) and a `set`
//     of `data/phase`, the share of the flight it shows: 0, 0.5 and 1;
//   - closed-form drivers: the ball's x and y at τ = phase × 2v·sin θ ÷ g (g = 9.81), and `data/range` = v²·sin 2θ ÷ g;
//   - a readout, `Range {data/range} m`.
// No logic item, no physics world, no program: the board is data.
//
// asserts:
//   - through `deep-motion eval` with a recorded input track (top at 2 s, landing at 4 s, angle 30 and speed 20 at 6 s,
//     top at 8 s, launch at 10 s), 1 s after each entry and at 1 s: the ball at the closed form's point for the stage
//     and the sliders within 1e-6 u (launch, top, landing at 45° and 15 m/s, then landing, top, launch at 30° and
//     20 m/s); after each stage entry the camera on that stage's shot (`cameras.cam.shot`) at its target and view
//     width; the readout showing v²·sin 2θ ÷ g;
//   - through `deep-show run`, the board presented and evaluated at every 1/30 s frame of its first second: no frame
//     runs a fixed step of any module (`steps`) or a node of the logic or sandbox module (`nodes`), and the sandbox
//     module's counts (`sandbox`: checks, links, rewrites, runs) are the same after the frames as before them;
//   - the planted `board_runs_program_per_frame` (the scenario's `planted`: every evaluated frame of a document with
//     controls runs a program through the sandbox module, as a per-frame plug-in callback would) fails that check,
//     naming the sandbox.
import { describe, expect, it } from 'vitest';
import {
  FLICKS, TIMEOUT, arr, brief, cam2d, docId, entry, envelope, evalFrames, failsNaming, fl, isObject, itemPos, none, numbersIn, num, obj,
  poseOf, present, presented, rad, readout, rect, runShow, scenarioOf, str, useBins, useFolders, type JsonObject,
} from './helpers.ts';

/** The criterion's ID: `#504.` and the first 8 hex digits of the SHA-256 of its text (scripts/proof-change.mjs). */
const ID = '#504.2171aba8';

const bin = useBins(['motion', 'show']);
const folder = useFolders();

const G = 9.81;
const SIZE: [number, number] = [960, 540];
const DOC = docId(1);
/** Each stage's share of the flight and its shot's pose (2D: target and view width, in u). */
const STAGES = {
  launch: { phase: 0, shot: 'at-launch', target: [200, 400, 0], view_width: 480 },
  top: { phase: 0.5, shot: 'at-top', target: [480, 270, 0], view_width: 960 },
  landing: { phase: 1, shot: 'at-landing', target: [700, 420, 0], view_width: 640 },
} as const;
type Stage = keyof typeof STAGES;

function board(): JsonObject {
  const vars = { a: 'controls/angle/value', v: 'controls/speed/value', p: 'data/phase' };
  const tau = '(p * 2 * v * sin(a * pi / 180) / 9.81)';
  const stages: JsonObject = {};
  const shots: JsonObject = {};
  for (const [id, s] of Object.entries(STAGES)) {
    stages[id] = { label: id[0]!.toUpperCase() + id.slice(1), shot: s.shot, set: { 'data/phase': s.phase } };
    shots[s.shot] = { camera: 'cam', move: 'hold', target: [...s.target], view_width: s.view_width };
  }
  return envelope('projectile-board', 'figure', SIZE, [
    cam2d(SIZE),
    rect('ground', [0, 480, 960, 60], 'muted'),
    rect('cannon', [40, 464, 40, 16], 'ink'),
    rect('ball', [-6, -6, 12, 12], 'accent', { at: { pos: [60, 480, 0] } }),
    readout('range-readout', [620, 40], 'Range {data/range} m'),
  ], {
    requires: { modules: { motion: '^1', input: '^1' } },
    transport: { span: '12s', frame_rate: [60, 1] },
    data: { phase: 0, range: 0 },
    controls: {
      angle: { kind: 'slider', class: 'document', label: 'Angle', role: 'slider', range: [15, 75], default: 45, increment: 1 },
      speed: { kind: 'slider', class: 'document', label: 'Speed', role: 'slider', range: [5, 25], default: 15, increment: 0.5 },
      stage: { kind: 'stages', class: 'document', label: 'Flight', role: 'group', default: 'launch', stages },
    },
    shots,
    drivers: {
      x: { target: 'items/ball/at/pos/0', expr: `60 + 20 * v * cos(a * pi / 180) * ${tau}`, vars },
      y: { target: 'items/ball/at/pos/1', expr: `480 - 20 * (v * sin(a * pi / 180) * ${tau} - 4.905 * ${tau} * ${tau})`, vars },
      range: { target: 'data/range', expr: 'v * v * sin(2 * a * pi / 180) / 9.81', vars: { a: vars.a, v: vars.v } },
    },
  });
}

/** The ball's point in u at a share of the flight, in closed form. */
function ball(a: number, v: number, phase: number): [number, number] {
  const tau = (phase * 2 * v * Math.sin(rad(a))) / G;
  return [60 + 20 * v * Math.cos(rad(a)) * tau, 480 - 20 * (v * Math.sin(rad(a)) * tau - (G / 2) * tau * tau)];
}
const rangeOf = (a: number, v: number): number => (v * v * Math.sin(rad(2 * a))) / G;

/** The recorded input track, and what each check time must show. */
const TRACK = [
  entry(2, 'stage', 'top'), entry(4, 'stage', 'landing'), entry(6, 'angle', 30, 0), entry(6, 'speed', 20, 1),
  entry(8, 'stage', 'top'), entry(10, 'stage', 'launch'),
];
const CHECKS: { t: number; a: number; v: number; stage: Stage; entered: boolean }[] = [
  { t: 1, a: 45, v: 15, stage: 'launch', entered: false },
  { t: 3, a: 45, v: 15, stage: 'top', entered: true },
  { t: 5, a: 45, v: 15, stage: 'landing', entered: true },
  { t: 7, a: 30, v: 20, stage: 'landing', entered: true },
  { t: 9, a: 30, v: 20, stage: 'top', entered: true },
  { t: 11, a: 30, v: 20, stage: 'launch', entered: true },
];

/** The check that no plug-in code ran per frame: no fixed step, no logic or sandbox node, the sandbox's counts unchanged. */
function perFrameFailures(replies: JsonObject[], times: number[], what: string): string[] {
  presented(replies[0]!, `${what}: the board`);
  const counts = (r: JsonObject, which: string): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const k of ['checks', 'links', 'rewrites', 'runs']) out[k] = num(r[k], `${what}: the sandbox module's ${k} ${which} the frames (${brief(r)})`);
    return out;
  };
  const before = counts(replies[1]!, 'before');
  const after = counts(replies[replies.length - 1]!, 'after');
  const failures: string[] = [];
  for (const k of Object.keys(before)) if (after[k] !== before[k]) failures.push(`the sandbox ran plug-in code during the frames: its ${k} went from ${before[k]} to ${after[k]} over ${times.length} frames`);
  times.forEach((t, i) => {
    const r = replies[2 + i]!;
    if (r['outcome'] !== 'evaluated') { failures.push(`the frame at ${t} flicks is ${String(r['outcome'])}, not evaluated: ${brief(r, 600)}`); return; }
    for (const s of arr(r['steps'] ?? [], `${what}: steps at ${t}`).filter(isObject)) {
      if (typeof s['count'] !== 'number' || s['count'] > 0) failures.push(`the frame at ${t} flicks ran ${String(s['count'])} fixed steps of the ${String(s['module'])} module: ${brief(s)}`);
    }
    for (const n of arr(r['nodes'] ?? [], `${what}: nodes at ${t}`).filter(isObject)) {
      if (n['module'] === 'logic' || n['module'] === 'sandbox') failures.push(`the frame at ${t} flicks evaluated a node of the ${String(n['module'])} module, ${String(n['operator'])} on ${String(n['item'])}`);
    }
  });
  return failures;
}

describe(`${ID} a projectile board of sliders, stages and closed-form drivers works with no plug-in code per frame`, () => {
  it(`${ID} the stages and sliders move the ball to the closed form's launch, top and landing points, frame each stage's shot and fill the range readout`, () => {
    const times = CHECKS.map((c) => fl(c.t));
    const frames = evalFrames(bin('motion'), { doc: board(), times, track: TRACK }, 'the projectile board');
    const failures: string[] = [];
    CHECKS.forEach((c, i) => {
      const f = frames[i]!;
      const what = `at ${c.t} s (${c.stage}, ${c.a}°, ${c.v} m/s)`;
      const [x, y] = ball(c.a, c.v, STAGES[c.stage].phase);
      const pos = itemPos(f, 'ball', what);
      if (Math.abs(pos[0] - x) > 1e-6 || Math.abs(pos[1] - y) > 1e-6) failures.push(`${what}: the ball is at (${pos[0]}, ${pos[1]}) u, not the closed form's (${x}, ${y})`);
      if (c.entered) {
        const cam = poseOf(f, 'cam', what);
        const s = STAGES[c.stage];
        if (cam.shot !== s.shot) failures.push(`${what}: the camera is on shot ${String(cam.shot)}, not the stage's ${s.shot}`);
        if (Math.max(...cam.target.map((v, k) => Math.abs(v - s.target[k]!))) > 1e-6 || Math.abs(cam.view_width - s.view_width) > 1e-6) {
          failures.push(`${what}: the camera's target ${brief(cam.target)} and view width ${cam.view_width} aren't the ${s.shot} shot's ${brief([...s.target])} and ${s.view_width}`);
        }
      }
      const text = f.readouts['range-readout'];
      const shown = typeof text === 'string' ? numbersIn(text) : [];
      const range = rangeOf(c.a, c.v);
      if (shown.length !== 1 || Math.abs(shown[0]! - range) > 1e-9 * range) failures.push(`${what}: the range readout reads ${brief(text ?? null)}, not ${range} m`);
    });
    none(failures, 'the board on its recorded input track');
  }, TIMEOUT);

  it(`${ID} a play of the board runs no plug-in code in any frame; a planted board that runs a program each frame fails the check, naming the sandbox`, () => {
    const times = Array.from({ length: 31 }, (_, k) => (k * FLICKS) / 30);
    const calls = (): JsonObject[] => [present(DOC, board()), { call: 'sandbox' }, ...times.map((t) => ({ call: 'eval', doc: DOC, t })), { call: 'sandbox' }];
    const play = (planted?: string): JsonObject[] =>
      runShow(bin('show'), scenarioOf({ evidence: folder(), panels: { main: [0, 0, 960, 540] }, docs: { [DOC]: { panel: 'main' } }, calls: calls(), ...(planted ? { planted } : {}) }), `the board's play${planted ? ` (planted ${planted})` : ''}`);
    const replies = play();
    expect(str(obj(replies[1], 'the sandbox call')['module'], 'the sandbox call names its module'), 'the sandbox call reports the sandbox module').toBe('sandbox');
    none(perFrameFailures(replies, times, 'the board'), 'no plug-in code runs in any frame of the board');
    failsNaming(perFrameFailures(play('board_runs_program_per_frame'), times, 'the planted board'), ['sandbox'], 'the planted board that runs a program each frame');
  }, TIMEOUT);
});
