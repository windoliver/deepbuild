// AC6 #161.729a03cd: Budgets, on the reference Mac in the local preflight, compared with the merge base: the pack checks
// in under 2 s, each operator compiles in under 20 ms off the UI thread, and a still canvas dispatches none.
//
// The criterion's parts that read no clock, which run anywhere the binaries do; `ac6-timed.test.ts` holds the two
// times, on a reference Mac.
//   1. "Compared with the merge base" is the perf lane's: benchmarks/budgets.json holds the task `canvas-fx-pack`, run
//      as `node benchmarks/canvas.mjs fx-pack`, with the issue's three numbers as its targets, the lane's 50% margin,
//      this criterion in its `criteria` and #161 in its `initialReason`, and the file passes the lane's own validator
//      against the merge base's (the earlier tasks stay frozen).
//   2. Each of the 70 graphs, as `pack.json` holds it, goes through `check_operator` (#380's call with #429's
//      `timing`): accepted, and compiled on a thread that isn't the UI thread.
//   3. A still canvas: a figure whose one group's passes name `fx.levels@1`, `fx.radial_blur@1` and
//      `fx.turbulent_displace@1` (the issue's proof line: levels, radial blur and turbulent displace), shown as
//      a `live` session for 60 frames with `report: ["passes"]`. Each of the three runs as a pass that names it
//      (`operator`) while the figure first draws, and from frame 4 on none is dispatched. The same figure with its
//      card sliding dispatches all three at every frame from 4 on, so the report sees a dispatch when there is one.
//
// Wrong programs: the base (17 operators, no pass named by its operator in a 2D session's report, no task); a canvas
// that redraws a still group.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, ALL, REPO, TIMEOUT, buildLine, checkCall, criterion, document, group, isObject, lane, listProblems, liveCall, liveFrames, look1, packOperators, payload, rect, refusal, requireGpu,
  runGpu, sessionRow, shown, useBin, useDir, writeJson, type JsonObject, type JsonValue,
} from './helpers.ts';

const ID = AC[6];
const gpu = useBin('deep-gpu');
const dir = useDir();
const TASK = { id: 'canvas-fx-pack', command: ['node', 'benchmarks/canvas.mjs', 'fx-pack'], targets: { pack_check_ms: 2000, operator_compile_ms: 20, still_dispatches: 0 } };
const LOOK = look1('still-161', { panel: [214, 218, 224], accent: [26, 163, 200], plate: [90, 160, 110] });
const STILL_OPS = ['fx.levels@1', 'fx.radial_blur@1', 'fx.turbulent_displace@1'];
const SIZE = [256, 144] as const;

function stillDoc(id: string, moving: boolean): JsonObject {
  const doc = document(id, SIZE, [
    group('graded', 'a1', STILL_OPS.map((op): JsonValue => ({ op, params: {} }))),
    rect('card', 'a2', [48, 32, 96, 64], 'accent', 1, { parent: 'graded', at: { pos: [0, 0, 0] } }),
    rect('bar', 'a3', [80, 48, 32, 32], 'plate', 1, { parent: 'graded' }),
  ]);
  if (moving) doc['channels'] = { slide: { target: 'items/card/at/pos/0', type: 'f32', keys: { k0: { t: '0s', value: 0, interp: 'linear' }, k1: { t: '4s', value: 40, interp: 'linear' } } } };
  return doc;
}

describe(`${ID} fx@1's budgets`, () => {
  it(`${ID} budgets.json holds the task canvas-fx-pack with the issue's numbers, compared with the merge base at the lane's margin, and passes the lane's validator`, () => {
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks', 'budgets.json'), 'utf8')) as { tasks: JsonObject[] };
    const entry = current.tasks.find((t) => t['id'] === TASK.id);
    expect(entry, `budgets.json has the task ${TASK.id}`).toBeDefined();
    expect(entry!['command'], `${TASK.id} runs its mode of the canvas bench`).toEqual(TASK.command);
    expect(entry!['targets'], `${TASK.id} holds the issue's numbers: 2 s, 20 ms, no dispatch`).toEqual(TASK.targets);
    expect(entry!['margin'], `${TASK.id} compares with the merge base at the lane's margin`).toBe(0.5);
    expect(entry!['criteria'], `${TASK.id} proves this criterion`).toEqual([criterion(6)]);
    expect(String(entry!['initialReason']), `${TASK.id} says why, naming #161`).toMatch(/#161\b/);
    const mergeBase = spawnSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' });
    expect(mergeBase.status, `git merge-base HEAD origin/main: ${mergeBase.stderr}`).toBe(0);
    const base = spawnSync('git', ['show', `${mergeBase.stdout.trim()}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    expect(base.status, `the merge base's benchmarks/budgets.json: ${base.stderr}`).toBe(0);
    expect(lane('b.validateBudgets(input.current, input.base); return "valid";', { current: current as unknown as JsonObject, base: JSON.parse(base.stdout) as JsonObject }), 'the lane\'s validator accepts budgets.json against the merge base\'s').toBe('valid');
  }, TIMEOUT);

  it(`${ID} each of the 70 graphs passes the operator check and compiles off the UI thread`, () => {
    const operators = packOperators();
    expect(listProblems(operators), 'packs/fx-1.0.0 holds the issue\'s 69 operators and fx.slice_shift@1, each by its ID').toEqual([]);
    requireGpu();
    expect(gpu().error, buildLine('deep-gpu')).toBe('');
    const ran = runGpu(gpu().bin, dir(), ALL.map((id) => checkCall(operators[id]!)));
    expect(ran.problem, 'deep-gpu checks the 70 graphs').toBe('');
    const found = ALL.flatMap((id, i) => {
      const r = ran.replies[i]!;
      const refused = refusal(r, id);
      if (refused) return [refused];
      if (r['outcome'] !== 'accepted') return [`${id}: the operator check answers ${shown(r['outcome'])}: ${shown(r['issues'], 300)}`];
      const t = isObject(r['timing']) ? r['timing'] : {};
      if (typeof t['thread'] !== 'string' || typeof t['ui_thread'] !== 'string') return [`${id}: no timing.thread and timing.ui_thread: ${shown(r['timing'])}`];
      return t['thread'] === t['ui_thread'] ? [`${id}: compiled on the UI thread, ${t['ui_thread']}`] : [];
    });
    expect(found, found.slice(0, 20).join('\n  ')).toEqual([]);
  }, TIMEOUT);

  it(`${ID} a still canvas dispatches no operator once it has drawn; the same canvas moving dispatches each at every frame`, () => {
    expect(listProblems(packOperators()).filter((p) => STILL_OPS.some((op) => p.includes(op))), `the pack holds ${STILL_OPS.join(', ')}`).toEqual([]);
    requireGpu();
    expect(gpu().error, buildLine('deep-gpu')).toBe('');
    const out = dir();
    const calls = [false, true].map((moving) => liveCall(LOOK, [{ session: 's', doc: writeJson(out, `${moving ? 'moving' : 'still'}.json`, payload(stillDoc(moving ? 'moving-161' : 'still-161', moving))), size: [...SIZE] }], { frames: 60, report: ['passes'] }));
    const ran = runGpu(gpu().bin, out, calls);
    expect(ran.problem, 'deep-gpu runs the two live calls').toBe('');
    const [still, moving] = ran.replies;
    expect([refusal(still, 'the still figure'), refusal(moving, 'the moving figure')], 'both live calls answer').toEqual(['', '']);
    expect([sessionRow(still, 's')?.['state'], sessionRow(moving, 's')?.['state']], `both figures are live: ${shown(sessionRow(still, 's'), 400)}`).toEqual(['live', 'live']);
    /** The frames, of those listed, in which a pass of the session names `op`. */
    const dispatched = (reply: JsonObject | undefined, op: string): number[] => liveFrames(reply, 's').filter((f) => f.passes.some((p) => p['operator'] === op)).map((f) => f.frame);
    // The live call numbers its frames from 1: frames 4 to 60.
    const later = Array.from({ length: 57 }, (_, k) => k + 4);
    for (const op of STILL_OPS) {
      expect(dispatched(still, op).some((f) => f <= 3), `${op} runs as a pass that names it while the still figure first draws`).toBe(true);
      expect(later.filter((f) => !dispatched(moving, op).includes(f)), `${op} is dispatched at every frame from 4 on while the card slides; frames without it`).toEqual([]);
    }
    expect(STILL_OPS.flatMap((op) => dispatched(still, op).filter((f) => f > 3).map((f) => `frame ${f}: ${op}`)), 'from frame 4 on, the still canvas dispatches no operator').toEqual([]);
  }, TIMEOUT);
});
