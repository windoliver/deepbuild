// AC2 #1968.161c44a9: "Budgets, on the reference Mac in the local preflight, compared with the merge base: tokens for a
// 2,000-line file map to runs in under 5 ms on change, a diff of two 400-line versions aligns in under 20 ms at check, a
// seek into a 10-minute terminal recording takes under 5 ms, and a still code item costs nothing per frame"
//
// A timed file (README: The budget record). Per docs/parallel-proof.md §12a the budget window measures a budget criterion
// that says "in the local preflight" on a reference Mac against the merge base once a task of benchmarks/budgets.json
// names it, and anything a count can judge is judged on any machine. In order:
//   0. Each judge fails its planted wrong programs and passes its clean twin: the record judge on the merge base's
//      budgets.json with the task added (so the shape below is one the lane's own validator takes) and changed, the
//      count on planted frames.
//   1. The count, on any machine: through `deep-show run`'s `frames` (six frames, one 60 fps frame apart), a film with a
//      dot moving every frame and the still code item (README: The still code item) against the same film without it;
//      frames 2 to 6 run no more nodes with it than without it.
//   2. The record: benchmarks/budgets.json holds the task `canvas-code-film` (`node benchmarks/canvas.mjs code-film`),
//      its targets the issue's four numbers, the lane's margin 0.5, a reason naming #1968 and this criterion's ID; the
//      lane's validator takes the file against the merge base's.
//   3. Only on a reference Mac at rest (scripts/benchmark.mjs's judgeLimit rule, read for the machine and the load alone,
//      before anything is timed), the task's own judge on this checkout: its four targets judged, a FAIL fails, anything
//      but PASS is INCONCLUSIVE. Off the reference Mac or under load the test is INCONCLUSIVE, never PASS.
import { describe, expect, it } from 'vitest';
import {
  AC, CODE_FILM_TASK, DOC, TIMEOUT, binOf, budgetFiles, failsNaming, idOf, inconclusive, judgeTask, load, none, prebuild, presented, recordFailures,
  runShow, scenario, show, showCall, standing, stillFilm, stillSteps, useTemp, type JsonObject, type JsonValue,
} from './helpers.ts';

prebuild(['full']);
const temp = useTemp();
const ID = AC[2];

describe(`${ID} the code film's budgets: recorded for the budget window, the still code item counted on any machine`, () => {
  it(`${ID} a still code item costs no step per frame, counted on any machine; the task canvas-code-film records the issue's four numbers for this criterion; and on a reference Mac at rest its judge passes them`, async () => {
    const start = load();
    const criterion = idOf(ID);

    // 0. The judges against their planted wrong programs.
    const { current, base } = budgetFiles();
    const clean: JsonObject = { ...base, tasks: [...(base['tasks'] as JsonValue[]), { ...CODE_FILM_TASK, margin: 0.5, limits: {}, criteria: [criterion], initialReason: 'Issue #1968 first measurement: the merge base has no such task.' }] };
    none(await recordFailures(clean, base, CODE_FILM_TASK, criterion), 'the record judge passes the merge base with the task added');
    const planted = (change: (task: JsonObject) => JsonObject): JsonObject => ({ ...clean, tasks: (clean['tasks'] as JsonObject[]).map((t) => (t['id'] === CODE_FILM_TASK.id ? change(t) : t)) });
    failsNaming(await recordFailures(planted((t) => ({ ...t, targets: { ...CODE_FILM_TASK.targets, diff_400_lines_ms: 40 } })), base, CODE_FILM_TASK, criterion), [/the issue's numbers/], 'planted: a target loosened');
    failsNaming(await recordFailures(planted((t) => ({ ...t, criteria: [] })), base, CODE_FILM_TASK, criterion), [/never measures it/], 'planted: the criterion not named');
    failsNaming(await recordFailures(planted((t) => ({ ...t, margin: 1 })), base, CODE_FILM_TASK, criterion), [/margin/], 'planted: another margin');
    failsNaming(await recordFailures(planted((t) => ({ ...t, initialReason: '' })), base, CODE_FILM_TASK, criterion), [/initialReason|validator/], 'planted: no reason');
    failsNaming(await recordFailures({ ...clean, tasks: (clean['tasks'] as JsonObject[]).slice(1) }, base, CODE_FILM_TASK, criterion), [/validator refuses/], 'planted: a frozen task removed');
    none(stillSteps([16, 5, 5, 5, 5, 5], [5, 5, 5, 5, 5, 5]).failures, 'the count passes a code item that runs only on its first frame');
    failsNaming(stillSteps([16, 6, 6, 6, 6, 6], [5, 5, 5, 5, 5, 5]).failures, [/runs 5 steps/], 'planted: a code item that maps its tokens every frame');

    // 1. The count, on any machine.
    const [withCode, without] = [DOC(1), DOC(2)];
    const r = runShow(binOf(), scenario(temp(), [withCode, without], [
      showCall(withCode, stillFilm(true)), { call: 'frames', doc: withCode, count: 6, step: '1f', pixels: false },
      showCall(without, stillFilm(false)), { call: 'frames', doc: without, count: 6, step: '1f', pixels: false },
    ]), 'the still code item');
    presented(r[0]!, 'the film with the still code item');
    presented(r[2]!, 'the film without it');
    const ran = (reply: JsonObject, what: string): number[] => {
      const frames = reply['frames'];
      expect(Array.isArray(frames), `${what}: frames: ${show(reply)}`).toBe(true);
      return (frames as JsonObject[]).map((f) => f['ran'] as number);
    };
    none(stillSteps(ran(r[1]!, 'with the code item'), ran(r[3]!, 'without it')).failures, 'a still code item costs nothing per frame');

    // 2. The record.
    none(await recordFailures(current, base, CODE_FILM_TASK, criterion), `benchmarks/budgets.json records ${CODE_FILM_TASK.id} for the budget window`);

    // 3. The times, on a reference Mac at rest only.
    const here = await standing({ start, end: load() });
    if (here.status !== 'PASS') inconclusive(`the times are judged only on a reference Mac at rest: ${here.reason}`);
    const judged = await judgeTask(CODE_FILM_TASK);
    const targets = judged['targets'];
    expect(Object.keys(typeof targets === 'object' && targets !== null ? targets : {}).sort(), `the task's judge judges its four targets: ${show(judged)}`).toEqual(Object.keys(CODE_FILM_TASK.targets).sort());
    expect(judged['status'], `the task's judge: ${show(judged)}`).not.toBe('FAIL');
    if (judged['status'] !== 'PASS') inconclusive(`the task's judge reads ${String(judged['status'])}: ${show(judged)}`);
  }, 2 * TIMEOUT);
});
