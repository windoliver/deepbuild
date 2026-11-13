// #504.2171aba8: "A projectile board with angle and speed sliders and launch, top and landing stages works with no
// plug-in code per frame"
//
// The board (helpers.ts `board`; README: The board) is a 2D figure written as data: a ball; two document-class sliders,
// angle (15 to 75°, default 45) and speed (5 to 30 m/s, default 20); a stages control whose launch, top and landing
// stages each set the flight's moment (`data/phase` 0, 0.5 and 1) and name their own shot; four drivers that compute
// the flight in closed form and move the ball by it; and a readout whose template shows the angle, the speed and the
// distance and height the drivers compute. Its input track: top at 1 s, angle 60 at 2 s, speed 25 at 3 s, landing at
// 4 s, launch at 6 s.
//
// One `deep-show run` per program: the agent shows the board, its frames are evaluated at 0.5, 1.4, 1.9, 2.9, 3.9,
// 4.9, 5.9 and 7.9 s, and the ball and the readout are read at 0.5, 1.9, 2.9, 3.9, 5.9 and 7.9 s, each with the track.
// "Works": the sliders and the stages put the ball where a projectile's closed form puts it, each stage flies the
// camera to its own shot, gliding there, and the readout shows the numbers that move the ball. "No plug-in code per
// frame": in every frame nothing ran but operators the build sealed, no stepping module stepped and the sandbox ran
// nothing. Each test also runs its named planted program and must fail on it.
import { describe, it } from 'vitest';
import {
  AC1, GLIDE_S, QUERY_TIMES, READOUT_NUMBERS, SHOTS, TIMEOUT, ballAt, brief, failsNaming, isObject, none, numbersIn,
  readoutAt, runBoard, stageChangeAt, stateAt, useShow, xy, type Board,
} from './helpers.ts';

const show = useShow();

/** Each program's run, made once per file (the right program's is shared by the four tests). */
const runs = new Map<string, Board | Error>();
function boardOf(planted?: string): Board {
  const key = planted ?? '';
  let r = runs.get(key);
  if (r === undefined) {
    try { r = runBoard(show.bin(), show.folder(), planted); } catch (e) { r = e as Error; }
    runs.set(key, r);
  }
  if (r instanceof Error) throw r;
  return r;
}

/** Ball positions and camera targets agree within this, u. */
const NEAR_U = 0.01;
/** A readout's number agrees within this much of the expected value, or 2% of it, whichever is larger (README: Readings). */
const NEAR_SHOWN = 0.05;
const near = (a: number, b: number, tol: number): boolean => Math.abs(a - b) <= tol;
const fmt = (p: readonly number[]): string => `(${p.map((v) => v.toFixed(3)).join(', ')})`;

/** Where the ball is at each of `times` against where the closed form puts it. */
function ballFailures(b: Board, times: readonly number[]): string[] {
  const failures: string[] = [];
  for (const s of times) {
    const got = xy(b.ball[QUERY_TIMES.indexOf(s)]);
    const want = ballAt(s);
    const st = stateAt(s);
    const at = `the ball at ${s} s (${st.stage} stage, angle ${st.angle}°, speed ${st.speed} m/s)`;
    if (got === null) failures.push(`${at} reads ${brief(b.ball[QUERY_TIMES.indexOf(s)], 300)}, not a position`);
    else if (!near(got[0], want[0], NEAR_U) || !near(got[1], want[1], NEAR_U)) failures.push(`${at} is at ${fmt(got)} u, not at ${fmt(want)} u where the closed form puts it`);
  }
  return failures;
}

/** The camera at each evaluated frame: on its stage's shot once the glide is over, between the two shots during it. */
function cameraFailures(b: Board): string[] {
  const failures: string[] = [];
  for (const f of b.frames) {
    const at = `the camera at ${f.s} s`;
    const target = xy(f.camera?.['target']);
    if (f.camera === null || target === null) { failures.push(`${at} has no pose with a target in the film block: ${brief(f.raw['film'], 600)}`); continue; }
    const change = stageChangeAt(f.s);
    if (change !== null && f.s - change.s < GLIDE_S) {
      // Gliding from the shot shown at the entry to the new stage's: strictly between them, at least a tenth of the way
      // from either end on each axis (README: Readings; the glide's exact path is criterion 5's).
      const from = SHOTS[change.from].target;
      const to = SHOTS[change.to].target;
      for (const k of [0, 1] as const) {
        const lo = Math.min(from[k], to[k]);
        const hi = Math.max(from[k], to[k]);
        const margin = (hi - lo) / 10;
        if (!(target[k]! >= lo + margin && target[k]! <= hi - margin)) {
          failures.push(`${at}, ${(f.s - change.s).toFixed(1)} s into the ${change.to} stage's glide, has its target at ${fmt(target)} u, not between the ${change.from} shot's ${fmt(from)} and the ${change.to} shot's ${fmt(to)}`);
          break;
        }
      }
      continue;
    }
    const stage = stateAt(f.s).stage;
    const want = SHOTS[stage];
    if (!near(target[0], want.target[0], NEAR_U) || !near(target[1], want.target[1], NEAR_U)) failures.push(`${at} (${stage} stage) has its target at ${fmt(target)} u, not on the ${want.id} pose ${fmt(want.target)}`);
    if (f.camera['shot'] !== want.id) failures.push(`${at} (${stage} stage) names the shot ${brief(f.camera['shot'])}, not ${want.id}`);
  }
  return failures;
}

/** What the readout shows at each read time against the angle, the speed and the closed form's distance and height. */
function readoutFailures(b: Board): string[] {
  const failures: string[] = [];
  QUERY_TIMES.forEach((s, i) => {
    const text = b.readout[i];
    const at = `the readout at ${s} s`;
    if (typeof text !== 'string') { failures.push(`${at} shows ${brief(text, 300)}, not a text`); return; }
    const shown = numbersIn(text);
    const want = readoutAt(s);
    if (shown.length !== want.length) { failures.push(`${at} shows ${shown.length} numbers, not the ${READOUT_NUMBERS.join(', ')}: "${text}"`); return; }
    READOUT_NUMBERS.forEach((name, k) => {
      const tol = Math.max(NEAR_SHOWN, 0.02 * Math.abs(want[k]!));
      if (!near(shown[k]!, want[k]!, tol)) failures.push(`${at} shows the ${name} ${shown[k]}, not ${want[k]!.toFixed(4)}: "${text}"`);
    });
  });
  return failures;
}

/** Every frame ran only what the build sealed: each node one of the registry's operators, of its module; no stepping
 * module's step; no sandboxed program between the first frame and the last. */
function codeFailures(b: Board): string[] {
  const failures: string[] = [];
  const sealed = new Set([...b.modules, 'core']);
  for (const f of b.frames) {
    const at = `the frame at ${f.s} s`;
    if (f.rev !== b.rev) failures.push(`${at} evaluates revision ${brief(f.rev)}, not the board's ${b.rev}`);
    if (f.nodes.length === 0) failures.push(`${at} lists no nodes, so nothing says what its evaluation ran`);
    for (const n of f.nodes) {
      const op = typeof n['operator'] === 'string' ? n['operator'] : '';
      const entry = b.operators[op];
      const module = n['module'];
      if (!isObject(entry) || entry['module'] !== module || typeof module !== 'string' || !sealed.has(module)) {
        failures.push(`${at} ran ${brief(n, 300)}, which isn't an operator the build sealed`);
      }
    }
    if (f.steps.length > 0) failures.push(`${at}: a stepping module stepped: ${brief(f.steps, 600)}`);
  }
  if (typeof b.runsBefore !== 'number' || b.runsBefore !== b.runsAfter) {
    failures.push(`the sandbox ran programs during the frames: its runs went from ${brief(b.runsBefore)} to ${brief(b.runsAfter)}`);
  }
  return failures;
}

describe(`${AC1} a projectile board works with no plug-in code per frame`, () => {
  it(`${AC1} the angle and speed sliders move the ball where a projectile's closed form puts it`, () => {
    // At the top stage: the defaults (1.9 s), the angle at 60° (2.9 s), the speed at 25 m/s too (3.9 s); landing (5.9 s).
    const times = [1.9, 2.9, 3.9, 5.9];
    none(ballFailures(boardOf(), times), 'the ball as the sliders move');
    failsNaming(ballFailures(boardOf('slider_entries_ignored'), times), /the ball at (2\.9|3\.9|5\.9) s/, 'slider_entries_ignored');
  }, TIMEOUT);

  it(`${AC1} the launch, top and landing stages put the ball at their moment and glide the camera to their own shot`, () => {
    // Launch by default (0.5 s), top (1.9 s), landing (5.9 s), launch again (7.9 s); the camera at every frame.
    const times = [0.5, 1.9, 5.9, 7.9];
    const right = boardOf();
    none([...ballFailures(right, times), ...cameraFailures(right)], 'the stages');
    const setsNothing = boardOf('stage_sets_nothing');
    failsNaming([...ballFailures(setsNothing, times), ...cameraFailures(setsNothing)], /the ball at (1\.9|5\.9) s/, 'stage_sets_nothing');
    const cuts = boardOf('stage_shot_cuts');
    failsNaming([...ballFailures(cuts, times), ...cameraFailures(cuts)], /the camera at 1\.4 s/, 'stage_shot_cuts');
  }, TIMEOUT);

  it(`${AC1} the readout shows the angle, the speed and the distance and height that move the ball`, () => {
    none(readoutFailures(boardOf()), 'the readout');
    failsNaming(readoutFailures(boardOf('readout_reads_defaults')), /the readout at/, 'readout_reads_defaults');
  }, TIMEOUT);

  it(`${AC1} no plug-in code runs in any frame of the board`, () => {
    none(codeFailures(boardOf()), 'what ran in the board\'s frames');
    failsNaming(codeFailures(boardOf('plugin_code_per_frame')), /isn't an operator the build sealed|stepping module stepped|sandbox ran programs/, 'plugin_code_per_frame');
  }, TIMEOUT);
});
