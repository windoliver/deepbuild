// AC11 #233.f4f81b7b: "Budgets, on the reference Mac in the local preflight, compared with the merge base: a math@1
// document costs nothing per frame beyond the items it expands into, its frame time equal, under the frame-budget rule,
// to that of its expansion written by hand; a planted pack that expands again each frame adds work and fails, naming
// the recipe"
//
// The math document: `ax`, math.axes {x_range: [−3, 3, 1], y_range: [0, 9, 3], x_length: 8, y_length: 5}, `curve`,
// math.plot {axes: ax, f: "x^2"}, and a plain square `mover` whose x a channel moves, so every frame has work. Its twin,
// "its expansion written by hand": the drawn form `deep show` expanded it to (README: Reading the expansion), each
// derived ID's dots written as `__` (a writer's ID), naming no pack.
// The first test, by counters that hold on any machine (#222's `nodes`): one debug process presents both and evaluates
// each at 0.50 s and then 0.55 s. At the second frame every node that ran (`run: "ran"`) in the math document has its
// match, by operator and item (dots read as `__`), among those that ran in the twin; none is an instance's own (ax,
// curve); and the mover has a node that ran, so the comparison isn't empty. Under `planted: math_expands_each_frame`
// (README: The planted programs) the same judge fails, and a failure names the recipe (math.axes@1 or math.plot@1).
// The second test, the budgets: benchmarks/budgets.json holds the task `canvas-math` with this criterion's ID, which the
// lane's validator accepts against the merge base's file, and scripts/lanes.mjs times this file; then, only where the
// lane can judge a timing (a reference Mac at rest, else INCONCLUSIVE before anything is timed), `frame_budget` (#1899,
// the frame-budget rule: warm-up and five runs of 5 s at 60 fps, 1920 × 1080, look `clean`) on the math document (with
// its packs) and on its twin: the math document's run passes the frame-budget rule, and its five GPU p95s are judged
// by the lane's `judgeLimit` against 1.05 × the twin's median (the lane's smallest margin): a FAIL fails, anything but
// PASS is INCONCLUSIVE.
// Wrong programs: the base (no math@1, no task); the plant; an expansion re-run when a frame plays; a document drawn
// through a path dearer than the items it expands into.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, OFFERED, REPO, TIMEOUT, arr, brief, buildInto, docId, drawnForm, evalAt, fl, idOf, inconclusive, isObject, judgeLimit, load, mathDoc, none,
  notPresented, num, obj, present, rowsOf, run, runGpu, scenario, shippedLook, timingProblem, useBins, useFolders, validateBudgets,
  type JsonObject, type JsonValue, type P2, type Planted,
} from './helpers.ts';

const bin = useBins(['deep-show']);
const folder = useFolders();
const ID = idOf(11);
const SIZE: P2 = [1920, 1080];
const TASK = { id: 'canvas-math', command: ['node', 'benchmarks/canvas.mjs', 'math'], targets: { math_over_hand: 1.05, frame_expansions: 0 } };
const FILE = 'tests/acceptance/233/ac11-budgets.test.ts';
const INSTANCES = ['ax', 'curve'];

const mathFigure = (span: number): JsonObject => mathDoc('Axes and a parabola, and a moving square', SIZE, {
  ax: { kind: 'math.axes@1', params: { x_range: [-3, 3, 1], y_range: [0, 9, 3], x_length: 8, y_length: 5 } },
  curve: { kind: 'math.plot@1', params: { axes: 'ax', f: 'x^2' } },
  mover: { kind: 'rect@1', params: { box: [0, 0, 40, 40], paint: { fill: { role: 'ink' } } }, at: { pos: [100, 900, 0] } },
}, {
  transport: { span: `${span}s` },
  channels: { move: { target: 'items/mover/at/pos/0', type: 'f32', keys: { k0: { t: '0s', value: 100, interp: 'linear' }, k1: { t: `${span}s`, value: 1700 } } } },
});
/** "Its expansion written by hand": the drawn form, each derived ID's dots written as `__`, as a writer's document. */
function byHand(doc: JsonObject, shown: JsonObject): JsonObject {
  const drawn = drawnForm(doc, shown);
  let text = JSON.stringify(drawn);
  const ids = rowsOf(shown).flatMap((r) => Object.keys(r.derived)).sort((p, q) => q.length - p.length);
  for (const id of ids) text = text.replace(new RegExp(`(?<![A-Za-z0-9_.-])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_-])`, 'g'), id.replace(/\./g, '__'));
  const out = JSON.parse(text) as JsonObject;
  for (const k of ['id', 'layers']) delete out[k];
  for (const v of Object.values(out['items'] as JsonObject)) if (isObject(v)) delete v['layer'];
  return { ...out, title: 'Axes and a parabola, written by hand', description: 'The #233 math document\'s expansion, written by hand.' };
}
/** The nodes that ran in an `eval` reply, as `operator | item`, each item's dots read as `__`. */
function ran(reply: JsonObject, what: string): { key: string; raw: JsonObject }[] {
  expect(reply['outcome'], `${what} is evaluated: ${brief(reply, 600)}`).toBe('evaluated');
  return (Array.isArray(reply['nodes']) ? reply['nodes'] : []).filter(isObject).filter((n) => n['run'] === 'ran')
    .map((n) => ({ key: `${String(n['operator'])} | ${String(n['item'] ?? '').replace(/\./g, '__')}`, raw: n }));
}
/** Work a frame of the math document does beyond its twin's, each naming the node. */
function extraWork(planted?: Planted): { extra: string[]; mover: boolean } {
  const doc = mathFigure(1);
  const first = run(bin('deep-show'), scenario(folder(), [present(docId(1), doc)]));
  expect(first.ok, `deep-show run accepts the scenario: ${first.why}`).toBe(true);
  expect(notPresented(first.replies[0]), 'the math document is presented with no error').toBe('');
  const hand = byHand(doc, first.replies[0]!);
  const a = run(bin('deep-show'), scenario(folder(), [
    present(docId(1), doc), present(docId(2), hand),
    evalAt(docId(1), fl(0.5)), evalAt(docId(1), fl(0.55)), evalAt(docId(2), fl(0.5)), evalAt(docId(2), fl(0.55)),
  ], planted ? { planted } : {}));
  expect(a.ok, `deep-show run accepts the scenario${planted ? ` with planted ${planted}` : ''}: ${a.why}`).toBe(true);
  expect(notPresented(a.replies[0]), `the math document is presented${planted ? ` (planted ${planted})` : ''}`).toBe('');
  expect(notPresented(a.replies[1]), 'its expansion written by hand is presented with no error').toBe('');
  const mine = ran(a.replies[3]!, 'the math document at 0.55 s');
  const pool = ran(a.replies[5]!, 'the twin at 0.55 s').map((n) => n.key);
  const extra: string[] = [];
  for (const n of mine) {
    const item = String(n.raw['item'] ?? '');
    const k = pool.indexOf(n.key);
    if (INSTANCES.includes(item)) extra.push(`${brief(n.raw, 400)}: a node of the instance ${item} ran in a frame`);
    else if (k < 0) extra.push(`${brief(n.raw, 400)}: ran in the math document's frame, with no match in its twin's`);
    else pool.splice(k, 1);
  }
  return { extra, mover: mine.some((n) => n.key.endsWith('| mover')) };
}

describe(`${AC[11]} a math@1 document costs nothing per frame beyond what it expands into`, () => {
  it(`${AC[11]} per frame the math document runs only what its expansion written by hand runs; a planted pack that expands each frame fails, naming the recipe`, () => {
    const clean = extraWork();
    expect(clean.mover, 'the moving square runs in the compared frame, so the comparison isn\'t empty').toBe(true);
    none(clean.extra, 'per frame, the math document runs only what its expansion written by hand runs');
    const planted = extraWork('math_expands_each_frame');
    console.log(`${ID} the plant's extra work: ${planted.extra.join('; ')}`);
    expect(planted.extra.length, 'the plant adds work to a frame and fails').toBeGreaterThan(0);
    expect(planted.extra.some((w) => /math\.(axes|plot)@1/.test(w)), `the failure names the recipe: ${planted.extra.join('; ')}`).toBe(true);
  }, 2 * TIMEOUT);

  it(`${AC[11]} the budgets, recorded against the merge base and judged on the reference Mac: the math document's frame time equals its expansion's written by hand, under the frame-budget rule`, async () => {
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks', 'budgets.json'), 'utf8')) as JsonObject;
    const entry = arr(current['tasks'], 'budgets.json: tasks').filter(isObject).find((t) => t['id'] === TASK.id);
    expect(entry, `benchmarks/budgets.json has the task ${TASK.id}`).toBeDefined();
    expect(entry!['command'], `${TASK.id} runs its mode of the canvas bench`).toEqual(TASK.command);
    expect(entry!['targets'], `${TASK.id} holds this criterion's targets`).toEqual(TASK.targets);
    expect(entry!['margin'], `${TASK.id} compares with the merge base at the lane's margin`).toBe(0.5);
    expect(entry!['criteria'], `${TASK.id} names this criterion, so the budget window measures it`).toContain(ID);
    expect(String(entry!['initialReason']), `${TASK.id} says why, naming #233`).toMatch(/#233\b/);
    const mergeBase = spawnSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' });
    expect(mergeBase.status, `git merge-base HEAD origin/main: ${mergeBase.stderr}`).toBe(0);
    const base = spawnSync('git', ['show', `${mergeBase.stdout.trim()}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    expect(base.status, `the merge base's benchmarks/budgets.json: ${base.stderr}`).toBe(0);
    await expect(validateBudgets(current, JSON.parse(base.stdout) as JsonObject), 'the lane\'s validator accepts budgets.json against the merge base\'s').resolves.toBeUndefined();
    const lanes = (await import(join(REPO, 'scripts', 'lanes.mjs'))) as { timed: string[] };
    expect(lanes.timed, `scripts/lanes.mjs runs ${FILE} as a timed file`).toContain(FILE);

    const problem = await timingProblem();
    if (problem) inconclusive(`the budgets are judged only on a reference Mac at rest: ${problem}`);
    if (process.platform !== 'darwin') inconclusive(`the frame budget draws on macOS's Metal device; this is ${process.platform}`);
    const doc = mathFigure(5);
    const a = run(bin('deep-show'), scenario(folder(), [present(docId(1), doc)]));
    expect(a.ok && notPresented(a.replies[0]) === '', `the math document is presented: ${a.why}`).toBe(true);
    const hand = byHand(doc, a.replies[0]!);
    const gpu = buildInto('deep-gpu', false, folder());
    expect(gpu.error, 'deep-gpu builds').toBe('');
    const dir = folder();
    const budget = (twin: boolean): { verdict: string; gpu: number[] } => {
      const file = join(dir, twin ? 'hand.json' : 'math.json');
      writeFileSync(file, JSON.stringify(twin ? hand : doc));
      const call: JsonObject = {
        call: 'frame_budget', look: shippedLook('clean'), writer: 'agent:alpha', doc: file, render: { seconds: 5, pixels: SIZE }, fps: 60,
        ...(twin ? {} : { packs: OFFERED.map((p) => ({ id: p.id, dir: p.dir })) as JsonValue }),
      };
      const [reply] = runGpu(gpu.path, [call], twin ? 'the twin written by hand' : 'the math document');
      const what = twin ? 'the twin' : 'the math document';
      expect(reply!['code'], `${what}: frame_budget is answered: ${brief(reply)}`).toBeUndefined();
      const g = obj(obj(reply!['limits'], `${what}: limits`)['gpu'], `${what}: limits.gpu`);
      const runs = arr(g['runs'], `${what}: limits.gpu.runs`).map((r, i) => num(obj(r, `${what}: run ${i + 1}`)['p95_ms'], `${what}: run ${i + 1}: p95_ms`));
      return { verdict: String(reply!['verdict']), gpu: runs };
    };
    const twin = budget(true);
    const start = load();
    const mine = budget(false);
    const end = load();
    console.log(`${ID} GPU p95 ms: math ${mine.gpu.map((x) => x.toFixed(3)).join(', ')} (${mine.verdict}); by hand ${twin.gpu.map((x) => x.toFixed(3)).join(', ')} (${twin.verdict})`);
    expect(mine.verdict, 'the math document under the frame-budget rule').not.toBe('FAIL');
    const open: string[] = mine.verdict === 'PASS' ? [] : [`the math document's frame budget is ${mine.verdict}`];
    const median = [...twin.gpu].sort((p, q) => p - q)[2]!;
    const v = await judgeLimit(TASK.targets.math_over_hand * median, mine.gpu, mine.gpu.map(() => ({ start, end })));
    expect(v['status'], `the math document's GPU p95 against 1.05 × its twin's median ${median.toFixed(3)} ms: ${JSON.stringify(v)}`).not.toBe('FAIL');
    if (v['status'] !== 'PASS') open.push(`the math document against its twin: ${JSON.stringify(v)}`);
    if (open.length) inconclusive(open.join('; '));
  }, 4 * TIMEOUT);
});
