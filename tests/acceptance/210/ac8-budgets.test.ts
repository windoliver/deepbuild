// AC8 #210.91594eec: "Budgets, on the reference Mac in the local preflight, compared with the merge base: a port delivers a
// step's entries within 2 ms of the step (p99), an each reading of 16 values adds under 0.05 ms a step, and a piece with
// no port and only latest readings gains no work per frame"
//
// Split as #213's and #1636's budgets are (README: Criterion 8):
//   1. The record the perf lane and the budget window compare with the merge base: benchmarks/budgets.json holds a task
//      naming this criterion with the issue's three numbers as its targets, which the lane's validator accepts against
//      the merge base's file; scripts/lanes.mjs runs this file as a timed one. No build.
//   2. On any machine, debug builds, so what is timed is the clause's work: the drum pad with its port open, a note every
//      50 ms for 3 s, delivers Out messages each with its `delay_ns` (from the end of its step's run to its handoff to
//      the plug-in); the sensor piece baked with 16 values a step reports each step's `read_ns`; and the drum pad with
//      no port, played the same, does port work in no frame (`transport`'s `port_work` 0), where the same piece with its
//      port open does some.
//   3. Only where the lane can judge a timing (a reference Mac at rest, else INCONCLUSIVE before anything is timed):
//      release builds, a warm-up and five runs, judged by scripts/benchmark.mjs's judgeLimit: each run's p99 delay over
//      a 10 s play against 2 ms; each run's median read_ns with 16 values a step less without against 0.05 ms.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { timingProblem } from '../1636/helpers.ts';
import { benchmark } from '../172/helpers.ts';
import {
  AC, Driver, GAUGE_WRITES, GEAR, HITS, MS, NOTES, REPO, STEP, SYNTH_OUT, TIMEOUT, bakeCall, connect, deepShow, gaugeProgram, inconclusive, install,
  layoutOf, logicPiece, none, note, obj, onLogic, onLogicAt, outsOf, perStep, pieceDoc, playPiece, playWorld, portCall, portOf, presented, releaseBin,
  secs, show, showPiece, transport, useTemp, type JsonObject, type JsonValue, type Source,
} from './helpers.ts';

const ID = AC[8];
const FILE = 'tests/acceptance/210/ac8-budgets.test.ts';
const TARGETS = { port_out_p99_ms: 2, each16_step_ms: 0.05, idle_work: 0 };
const temp = useTemp();

/** The drum pad played from 0.4 s, with `synth` open (or no port), a note every 50 ms for `seconds` s. */
interface PortPlay { evidence: string; calls: JsonObject[]; port: JsonObject | null; work: JsonObject; reply: (c: JsonObject) => JsonObject }
function portPlay(open: boolean, seconds: number): PortPlay {
  const evidence = temp();
  const d = new Driver(deepShow(['full']), { evidence });
  const doc = pieceDoc(evidence, open ? { synth: { plugin: GEAR.id, out: SYNTH_OUT } } : undefined);
  const setup = [install(MS, GEAR, { synth: { entries: [NOTES], rows: [HITS], sources: [], sound: false } }), showPiece(2 * MS, doc)];
  let first: JsonObject[] = setup;
  if (open) {
    const s = d.click(secs(0.1), 'stage', 'AC8: your Connect click', setup);
    first = [connect(secs(0.15), 'synth', { serial: s })];
  }
  const sPlay = d.click(secs(0.3), 'stage', 'AC8: your click on Play', first);
  const end = secs(0.5 + seconds);
  const notes = Array.from({ length: seconds * 20 }, (_, i) => note(secs(0.5 + 0.05 * i), 40 + (i % 80)));
  const port = open ? portCall(end + MS, 'synth') : null;
  const work = transport(secs(0.4), end);
  d.step([playPiece(secs(0.4), sPlay), ...notes, work, ...(port ? [port] : [])], `AC8: the drum pad ${open ? 'with its port open' : 'with no port'}`);
  presented(d.reply(setup[1]!, 'AC8'), 'AC8: the drum pad');
  return { evidence, calls: d.calls, port, work, reply: (c) => d.reply(c, 'AC8') };
}
const delaysOf = (reply: JsonObject, what: string): number[] => outsOf(portOf(reply, what), what).map((o, i) => {
  expect(o.delay_ns !== null && o.delay_ns >= 0, `${what}: Out ${i} (step ${o.step}) carries delay_ns, a whole number of ns: ${String(o.delay_ns)}`).toBe(true);
  return o.delay_ns!;
});
const portWorkOf = (reply: JsonObject, what: string): JsonValue | undefined => obj(obj(reply, what)['transport'], `${what}: transport`)['port_work'];
const p99 = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.max(0, Math.ceil(0.99 * xs.length) - 1)] ?? NaN;
const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2; };

const READING = 'reading:sensor';
const SOURCES: Record<string, Source> = { sensor: { shape: 'scalar', delivery: 'each', max_per_step: 16 } };
/** A bake of the sensor piece over `steps` steps, its recorded track holding `values` values at each step. */
function sensorBake(steps: number, values: number): JsonObject {
  const layout = layoutOf('gauge', [READING], GAUGE_WRITES, SOURCES);
  const piece = logicPiece(210_08, { gauge: { program: gaugeProgram(layout, READING), reads: [READING], writes: GAUGE_WRITES } }, SOURCES);
  const track: JsonObject[] = [];
  for (let k = 0; k < steps; k++) {
    for (let j = 0; j < values; j++) track.push({ t: k * STEP, seq: j, reading: READING, value: (k * 16 + j) / 4, as_of: 1_000_000 + (k * 16 + j) * 100, writer: 'plugin', player: 1 });
  }
  return bakeCall(piece, track, steps);
}
const readNsOf = (reply: JsonObject, what: string): number[] => {
  expect(reply['ok'], `${what}: the bake runs: ${show(reply, 600)}`).toBe(true);
  return perStep(reply, 'gauge', 'read_ns', what).map(({ step, value }) => {
    expect(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0, `${what}: step ${step}'s read_ns is a whole number of ns, got ${show(value)}`).toBe(true);
    return value as number;
  });
};

describe(`AC8 ${ID} budgets: a port's delivery, an each reading's cost, and no work for a piece without either`, () => {
  it(`AC8 ${ID} the perf lane's task names this criterion with the issue's numbers, valid against the merge base, and runs this file as timed`, async () => {
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks', 'budgets.json'), 'utf8')) as { tasks: JsonObject[] };
    const task = current.tasks.find((t) => Array.isArray(t['criteria']) && t['criteria'].includes(ID));
    expect(task, `benchmarks/budgets.json has a task whose criteria name ${ID}`).toBeDefined();
    expect(task!['targets'], 'the task holds the issue\'s numbers as its targets').toEqual(TARGETS);
    expect(task!['margin'], 'the task compares with the merge base at the lane\'s margin').toBe(0.5);
    expect(String(task!['initialReason']), 'the task says why, naming #210').toMatch(/#210\b/);
    const mergeBase = spawnSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' });
    expect(mergeBase.status, `git merge-base HEAD origin/main: ${mergeBase.stderr}`).toBe(0);
    const base = spawnSync('git', ['show', `${mergeBase.stdout.trim()}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    expect(base.status, `the merge base's benchmarks/budgets.json: ${base.stderr}`).toBe(0);
    const { validateBudgets } = await benchmark();
    expect(() => validateBudgets(current, JSON.parse(base.stdout)), 'the lane\'s validator accepts budgets.json against the merge base\'s').not.toThrow();
    const lanes = (await import(join(REPO, 'scripts', 'lanes.mjs'))) as { timed: string[] };
    expect(lanes.timed, `scripts/lanes.mjs runs ${FILE} as a timed file`).toContain(FILE);
  }, TIMEOUT);

  it(`AC8 ${ID} each Out carries its delay, each step its read_ns, a piece without a port does no port work, and on the reference Mac the p99 delay is under 2 ms and 16 values add under 0.05 ms a step`, async () => {
    // 2. The work each clause times, on any machine.
    const f: string[] = [];
    const open = portPlay(true, 3);
    const delays = delaysOf(open.reply(open.port!), 'AC8: synth');
    if (delays.length < 60) f.push(`synth delivered ${delays.length} Out messages for 60 notes, too few to read a p99 from`);
    const busy = portWorkOf(open.reply(open.work), 'AC8: the drum pad with its port open');
    if (!(typeof busy === 'number' && busy > 0)) f.push(`the drum pad with its port open reads port_work ${show(busy)}: the counter counts nothing`);
    const idle = portPlay(false, 3);
    const idleWork = portWorkOf(idle.reply(idle.work), 'AC8: the drum pad with no port');
    if (idleWork !== TARGETS.idle_work) f.push(`the drum pad with no port reads port_work ${show(idleWork)} over 3 s of play, not 0`);
    const ns16 = readNsOf(onLogic([sensorBake(120, 16)])[0]!, 'AC8: 16 values a step');
    readNsOf(onLogic([sensorBake(120, 0)])[0]!, 'AC8: no values');
    if (ns16.length !== 120 || ns16.some((x) => x <= 0)) f.push(`the bake with 16 values a step reports read_ns ${JSON.stringify(ns16.slice(0, 8))}…: not a time above 0 at each of its 120 steps`);
    none(f, `AC8 ${ID}: the work the budgets time`);

    // 3. The timings, only where the lane can judge them.
    const problem = await timingProblem();
    if (problem) inconclusive(`the delivery and read timings are judged only on a reference Mac at rest: ${problem}`);
    const show10 = releaseBin('deep-show');
    const logic = releaseBin('deep-logic');
    const ten = portPlay(true, 10);
    const bakes = [sensorBake(600, 16), sensorBake(600, 0)];
    const once = (): { delay: number; read: number } => {
      const r = playWorld(show10, { evidence: ten.evidence }, ten.calls, 'AC8 timed');
      const delay = p99(delaysOf(r.get(ten.port!)!, 'AC8 timed: synth')) / 1e6;
      const [a, b] = bakes.map((c) => readNsOf(onLogicAt(logic, [c])[0]!, 'AC8 timed').slice(1));
      return { delay, read: (median(a!) - median(b!)) / 1e6 };
    };
    once();
    const runs: { delay: number; read: number }[] = [];
    const loads: { start: number; end: number }[] = [];
    for (let k = 0; k < 5; k++) { const start = loadavg()[0]!; runs.push(once()); loads.push({ start, end: loadavg()[0]! }); }
    const { fingerprint, judgeLimit } = await benchmark();
    const machine = fingerprint();
    const verdicts = ([['a step\'s entries delivered, p99', TARGETS.port_out_p99_ms, runs.map((r) => r.delay)], ['an each reading of 16 values, added a step', TARGETS.each16_step_ms, runs.map((r) => r.read)]] as const)
      .map(([what, limit, xs]) => ({ what, limit, xs, v: judgeLimit({ limit, runs: [...xs], fingerprint: machine, loads }) }));
    const readings = verdicts.map((x) => `${x.what}: ${x.xs.map((n) => n.toFixed(4)).join(', ')} ms against ${x.limit} ms: ${x.v.status}${x.v.reason ? ` (${x.v.reason})` : ''}`);
    console.log(`${ID} on ${String(machine['model'])}:\n  ${readings.join('\n  ')}`);
    expect(verdicts.filter((x) => x.v.status === 'FAIL').map((x) => x.what), `AC8 ${ID}: no budget is over its limit:\n  ${readings.join('\n  ')}`).toEqual([]);
    if (verdicts.some((x) => x.v.status !== 'PASS')) inconclusive(readings.join('; '));
  }, 4 * TIMEOUT);
});
