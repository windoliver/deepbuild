// #379.57ab116a: a document whose estimated CPU time, GPU time or GPU memory per frame exceeds its budget
// class is refused before it shows, naming its top three contributors, and the same document gives the same
// refusal under another machine's environment; every shipped primitive declares its cost model and has a
// micro-benchmark in the local preflight.
//
// Through `deep-show run` (#393's deep_show, the full build): a board of five zigzag paths of 4,000, 3,000,
// 2,000, 20 and 10 segments in a core view whose frame caps the document tightens to 0.001 ms, so any
// estimate is over; the scenario's `machine` stands in for the machine the hub runs on (README). The
// registry's `costs` and the perf lane's tasks show the cost models and their micro-benchmarks.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { REFERENCE_MACS, REPO, arr, isObject, num, obj, showRun, str, useShowBuild, type JsonObject, type JsonValue } from './helpers.ts';

const show = useShowBuild();
const ID = '#379.57ab116a';
let evidence = '';
beforeEach(() => { evidence = mkdtempSync(join(tmpdir(), 'deep-379-ev-')); });
afterEach(() => { if (evidence) rmSync(evidence, { recursive: true, force: true }); evidence = ''; });

const DOC = '01JB379D000000000000000001';
const SESSIONS: JsonObject = { 'sess-alpha': { thread: 'thread-alpha', name: 'Claude Code: charts', process: { pid: 4100, start: 1000 } } };
const PANELS: JsonObject = { main: { rect: [0, 0, 1280, 720] } };
/** The machines the hub runs on, standing in for its environment: a reference Mac, and one that isn't. */
const MACHINES: Record<string, JsonObject> = {
  reference: { model: 'Mac15,7', chip: 'Apple M3 Pro', memoryBytes: 36 * 2 ** 30 },
  other: { model: 'Mac14,6', chip: 'Apple M2 Max', memoryBytes: 64 * 2 ** 30 },
};

/** A zigzag path of n segments across the board at row y. */
function zigzag(id: string, n: number, y: number, order: string): JsonObject {
  let d = `M0 ${y}`;
  for (let i = 1; i <= n; i++) d += ` L${((i * 1200) / n).toFixed(2)} ${y + (i % 2 ? 20 : 0)}`;
  return { id, kind: 'path@1', name: `Path ${id}`, order, params: { d, paint: { stroke: { role: 'ink', width: 2 } } } };
}
const SEGMENTS: [string, number][] = [['path-a', 4000], ['path-b', 3000], ['path-c', 2000], ['path-d', 20], ['path-e', 10]];
const TOP3 = ['path-a', 'path-b', 'path-c'];
function board(budget: JsonObject, segments = SEGMENTS): JsonObject {
  const items: JsonObject = {};
  segments.forEach(([id, n], i) => { items[id] = zigzag(id, n, 40 + i * 120, `a${i}`); });
  return { format: 1, profile: 'board', title: 'Five paths', description: 'Five zigzag paths of 4,000, 3,000, 2,000, 20 and 10 segments.', size: [1280, 720], budget, items };
}
const OVER: JsonObject = { class: 'core_view', frame_cpu_ms: 0.001, frame_gpu_ms: 0.001 };

function shown(document: JsonObject, extra: JsonObject = {}): JsonObject {
  const [reply] = showRun(show(), {
    evidence, sessions: SESSIONS, panels: PANELS, docs: { [DOC]: { panel: 'main' } },
    calls: [{ call: 'deep_show', session: 'sess-alpha', doc: DOC, document, include: ['issues', 'pixels'] }], ...extra,
  });
  return reply!;
}

/** The first place two JSON values differ, as a sentence naming its path; null when equal. */
function difference(a: JsonValue | undefined, b: JsonValue | undefined, path = ''): string | null {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (isObject(a) && isObject(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const d = difference(a[k], b[k], `${path}/${k}`);
      if (d) return d;
    }
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const d = difference(a[i], b[i], `${path}/${i}`);
      if (d) return d;
    }
  }
  return `${path || '(root)'}: ${JSON.stringify(a)?.slice(0, 200)} under one machine, ${JSON.stringify(b)?.slice(0, 200)} under the other`;
}

function overBudget(reply: JsonObject, what: string): JsonObject {
  expect(reply['outcome'], `${what}: the document over its class is refused: ${JSON.stringify(reply).slice(0, 1500)}`).toBe('refused');
  expect(arr(reply['snapshots'], `${what}: snapshots`), `${what}: refused before it shows, with no snapshot`).toEqual([]);
  const issues = arr(reply['issues'], `${what}: issues`).map((i, k) => obj(i, `${what}: issues[${k}]`));
  const over = issues.filter((i) => i['code'] === 'over_budget');
  expect(over.length, `${what}: one over_budget issue: ${JSON.stringify(issues).slice(0, 1500)}`).toBe(1);
  expect(over[0]!['severity'], `${what}: over_budget refuses (severity error)`).toBe('error');
  return over[0]!;
}

describe(`${ID} the document check's estimate refuses a document over its class`, () => {
  it(`${ID} a board over its class is refused before it shows, naming exactly its top three contributors, with the estimate from the reference Mac's coefficients`, () => {
    const issue = overBudget(shown(board(OVER)), 'the five-path board');
    expect([...arr(issue['ids'], 'over_budget: ids').map((x) => str(x, 'an ID'))].sort(), 'the top three contributors, the 4,000-, 3,000- and 2,000-segment paths').toEqual(TOP3);
    const actual = obj(issue['actual'], 'over_budget: actual (the estimate)');
    for (const k of ['cpu_ms', 'gpu_ms', 'gpu_mb']) expect(num(actual[k], `the estimate's ${k}`), `the estimate's ${k} is a non-negative number`).toBeGreaterThanOrEqual(0);
    expect(num(actual['cpu_ms'], 'cpu_ms') > 0.001 || num(actual['gpu_ms'], 'gpu_ms') > 0.001, 'the estimate exceeds a cap the document set').toBe(true);
    const fp = obj(actual['fingerprint'], 'the coefficients\' environment fingerprint');
    expect(REFERENCE_MACS.map((m) => m.model), 'the coefficients carry a reference Mac\'s fingerprint').toContain(str(fp['model'], 'fingerprint.model'));
    const fine = shown(board({ class: 'data_view' }, [['path-e', 10]]));
    expect(fine['outcome'], `the twin, one 10-segment path in a data view, is presented: ${JSON.stringify(fine['issues']).slice(0, 800)}`).toBe('presented');
  }, 900_000);

  it(`${ID} the same document gives the same refusal under another machine's environment`, () => {
    const replies = Object.fromEntries(Object.entries(MACHINES).map(([name, machine]) => [name, shown(board(OVER), { machine })]));
    const here = shown(board(OVER));
    for (const [name, r] of Object.entries(replies)) overBudget(r, `under the ${name} machine`);
    overBudget(here, 'on this machine');
    expect(difference(replies['reference']!['issues'], replies['other']!['issues']), 'the refusal under a non-reference machine is the reference Mac\'s, byte for byte').toBeNull();
    expect(difference(replies['reference']!['issues'], here['issues']), 'and this machine\'s').toBeNull();
  }, 900_000);

  it(`${ID} a planted check that estimates with the machine's own coefficients gives another refusal under another machine, and the comparison fails naming the field`, () => {
    const a = shown(board(OVER), { machine: MACHINES['reference']!, planted: 'estimates_on_this_machine' });
    const b = shown(board(OVER), { machine: MACHINES['other']!, planted: 'estimates_on_this_machine' });
    const d = difference(a['issues'] ?? null, b['issues'] ?? null) ?? difference(a['outcome'] ?? null, b['outcome'] ?? null);
    expect(d, 'the planted check refuses differently under the two machines').not.toBeNull();
    console.log(`planted estimates_on_this_machine: ${d}`);
  }, 900_000);
});

describe(`${ID} every shipped primitive declares its cost model and has a micro-benchmark in the local preflight`, () => {
  interface Task { id: string; command: string[] }
  const budgets = (): { tasks: Task[] } => JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')) as { tasks: Task[] };

  it(`${ID} the full build's registry gives every operator and every render pass a cost model whose coefficients carry a reference Mac's fingerprint and name a perf-lane task`, async () => {
    const [reg] = showRun(show(), { evidence, calls: [{ call: 'registry' }] });
    const operators = Object.keys(obj(reg!['operators'], 'registry: operators'));
    const passes = Object.keys(obj(reg!['passes'], 'registry: passes (every render pass the build registers)'));
    expect(operators.length, 'the build registers operators').toBeGreaterThan(0);
    expect(passes, 'scene3d\'s passes are listed').toEqual(expect.arrayContaining(['scene3d.geometry', 'scene3d.output']));
    const costs = obj(reg!['costs'], 'registry: costs');
    const tasks = new Map(budgets().tasks.map((t) => [t.id, t]));
    const used = new Set<string>();
    for (const name of [...operators, ...passes]) {
      const c = obj(costs[name], `the cost model of ${name}`);
      const terms = obj(c['terms'], `${name}: terms`);
      const values = Object.entries(terms).map(([k, v]) => num(v, `${name}: terms.${k}`));
      expect(values.length && values.every((v) => v >= 0) && values.some((v) => v > 0), `${name} declares at least one positive term and none negative: ${JSON.stringify(terms)}`).toBe(true);
      expect(REFERENCE_MACS.map((m) => m.model), `${name}'s coefficients carry a reference Mac's fingerprint`).toContain(str(obj(c['fingerprint'], `${name}: fingerprint`)['model'], `${name}: fingerprint.model`));
      const bench = obj(c['benchmark'], `${name}: benchmark`);
      const task = str(bench['task'], `${name}: benchmark.task`);
      expect(tasks.has(task), `${name}'s micro-benchmark ${task} is a task in benchmarks/budgets.json (the perf lane of the local preflight)`).toBe(true);
      used.add(task);
    }
    const { validateBudgets } = (await import(join(REPO, 'scripts/benchmark.mjs'))) as { validateBudgets(current: unknown, base: unknown): void };
    const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
    validateBudgets(budgets(), JSON.parse(execFileSync('git', ['show', `${base}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8' })));
    for (const id of used) {
      const [command, ...args] = tasks.get(id)!.command;
      const r = spawnSync(command!, args, { cwd: REPO, encoding: 'utf8', timeout: 900_000, maxBuffer: 256 * 1024 * 1024 });
      expect(r.status, `the micro-benchmark task ${id} runs and exits 0: ${(r.stderr ?? '').slice(-1500)}`).toBe(0);
    }
  }, 3_600_000);
});
