// Criterion 9 of #980 (#980.238de3e1), drafted afresh: "Budget, a proposal until measured on the reference Mac in the
// local preflight: a model of 2,000 live entities, 40 queues, 30 resources and 10 conveyors steps in under 0.3 ms a
// step."
//
// One test, through `deep-logic`'s `first_party`, `view` and `frame` (#532's live frames, which report `eval_ns`, the
// CPU time of the frame's simulate phase, and `draws`, the item's arrays as the step left them). The model is model.ts:
// ten lines of 200 cases, each line four queues, three resources of 12, 6 and 4 units held 2 s and a 10 m conveyor, the
// cases arriving one a tick so that by step 469 every queue, resource and conveyor holds work and, a belt being 1,200
// ticks long, none can be out before step 1,200. Two items of the same shape step side by side, a step a frame: the
// model (linking process@1's reference library, a `stats` call of one tick a step) and an idle one (the same arrays,
// memory and budget, no library, a step that does nothing), so a step's time is the model's frame less the idle one.
// After 600 steps of warm-up, five runs of 60 steps each take the median of each and the one-minute load at the run's
// start and end; every timed step of the model is first held to the criterion's counts from its own arrays; then
// scripts/benchmark.mjs's judgeLimit judges the five against 300 µs: PASS passes, FAIL fails, and anything else (off a
// reference Mac, under load, readings on both sides of the limit) fails as INCONCLUSIVE with its readings, never a
// pass. "In the local preflight" isn't something a test can see: it reads as this file run on the reference Mac.
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  REPO, TIMEOUT, arr, frameCall, isObject, live, logicBin, median, num, obj, onHost, prebuild, show, str, viewCall,
  type JsonObject, type Live, type Program,
} from '../190/helpers.ts';
import { assemble } from '../416/interfaces/wat.ts';
import { AC, INTERFACE, PROCESS, itemParams, piece, type Assets, type Link } from '../980/helpers.ts';
import { PAGES, WRITES_AT, processWrites, sceneProgram, type Writes } from '../980/programs.ts';
import { ALL_MADE_BY, MODEL, NONE_OUT_BEFORE, READ, WANT, builtCounts, progressProblems, stateProblems, type Step } from './model.ts';

prebuild(() => { logicBin(); });

/** The criterion's limit: 0.3 ms a step, in µs. */
const LIMIT_US = 300;
/** Steps before the first timed one, then five runs of 60 timed steps (docs/technical-design.md: five runs after warm-up). */
const WARM = 600, RUNS = 5, EACH_RUN = 60;
const STEPS = WARM + RUNS * EACH_RUN;
/** The logic item's ID in both pieces. */
const ITEM = 'model';

interface Load { start: number; end: number }
interface Verdict { status: 'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'BLOCKED'; reason?: string }
interface Benchmark { fingerprint(): Record<string, unknown>; judgeLimit(input: { limit: number; runs: number[]; fingerprint: Record<string, unknown>; loads: Load[] }): Verdict }
const benchmark = (): Promise<Benchmark> => import(join(REPO, 'scripts/benchmark.mjs')) as Promise<Benchmark>;

/** The idle item's program: the model's memory and regions, no import, and a step that does nothing. */
const idleProgram = (): Program => assemble('ac9_redraft_idle', `
(module
  (memory (export "memory") ${PAGES} ${PAGES})
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const ${WRITES_AT}))
  (func (export "init") (param i64))
  (func (export "step") (param i64)))`);
/** The idle piece: one item with the model's writes, step rate and budget, no `process` and no link. */
function idlePiece(writes: Writes): JsonObject {
  const program = idleProgram();
  const { process: _none, ...params } = itemParams(program, MODEL, writes);
  return { seed: 980, packs: [], items: { [ITEM]: { kind: 'logic@1', params } }, assets: { [program.sha]: program.b64 } };
}

/** One frame a step: the frame at k ÷ 60 s runs step k alone. Its simulate phase's CPU time in µs, and what it draws. */
async function frame(s: Live, session: string, k: number, what: string): Promise<{ us: number; draws: JsonObject }> {
  const f = await s.call(frameCall(session, k / MODEL.rate));
  const said = show({ ok: f['ok'] ?? null, code: f['code'] ?? null, what: f['what'] ?? null, want: f['want'] ?? null, at: f['at'] ?? null, steps: f['steps'] ?? null, traps: f['traps'] ?? null });
  expect([f['ok'], f['steps'], f['at'], f['traps'] ?? []], `${what}: the frame at ${k}/${MODEL.rate} s runs step ${k} alone and traps nothing: ${said}`).toEqual([true, 1, k + 1, []]);
  expect(isObject(f['draws']), `${what}: the frame of step ${k} reports the arrays it draws (draws): ${said}`).toBe(true);
  return { us: num(f['eval_ns'], `${what}: eval_ns at step ${k}`) / 1000, draws: f['draws'] as JsonObject };
}
/** One array of the item as a frame draws it: as many numbers as the item declares. */
function drawn(draws: JsonObject, name: string, count: number, what: string): number[] {
  const v = draws[`${ITEM}.${name}`];
  const ok = Array.isArray(v) && v.length === count && v.every((x) => typeof x === 'number' && Number.isFinite(x));
  expect(ok, `${what} draws ${ITEM}.${name} as ${count} numbers: ${show(v).slice(0, 300)}`).toBe(true);
  return v as number[];
}
/** The arrays the test reads of a step of the model (model.ts: READ), from the frame that ran it. */
const stepOf = (draws: JsonObject, writes: Writes, what: string): Step =>
  Object.fromEntries(READ.map((name) => [name, drawn(draws, name, writes[name]!.count, what)])) as Step;

describe(`${AC[9]} process@1's step budget on the reference Mac`, () => {
  it(`${AC[9]} a model of 2,000 live entities, 40 queues, 30 resources and 10 conveyors steps in under 0.3 ms a step`, async () => {
    // The model as its program builds it: the criterion's counts, every case made before the first timed step and
    // none able to leave before the last.
    expect(builtCounts(MODEL), 'the model\'s builder calls make 2,000 entities, 40 queues, 30 resources and 10 conveyors').toEqual(WANT);
    expect(ALL_MADE_BY < WARM && STEPS <= NONE_OUT_BEFORE, `every case is made by step ${ALL_MADE_BY}, before the timed steps ${WARM} to ${STEPS - 1}, and none can be out before step ${NONE_OUT_BEFORE}`).toBe(true);
    const writes = processWrites(MODEL);
    const program = sceneProgram(MODEL, INTERFACE);

    const idle = live(logicBin());
    let model: Live | undefined;
    try {
      // The idle item needs no process@1: it is opened and warmed first.
      const opened = await idle.call(viewCall(idlePiece(writes), STEPS / MODEL.rate));
      expect(opened['ok'], `view opened the idle piece: ${show(opened)}`).toBe(true);
      const idleSession = str(opened['session'], 'the idle view\'s session');
      for (let k = 0; k < WARM; k++) {
        const f = await frame(idle, idleSession, k, 'the idle item');
        if (k === 0) expect(stepOf(f.draws, writes, 'the idle item\'s first frame').count.every((x) => x === 0), 'the idle item writes nothing').toBe(true);
      }
      const { fingerprint, judgeLimit } = await benchmark();

      // process@1 and its reference library, as the build's first-party packs list them (../980/README.md: The
      // first-party pack).
      const [listed] = onHost([{ call: 'first_party' }]);
      expect(listed!['ok'], `first_party lists the build's first-party packs: ${show(listed)}`).toBe(true);
      const packs = arr(listed!['packs'], 'first_party.packs').map((p, i) => obj(p, `first_party.packs[${i}]`));
      const named = (p: JsonObject): string => `${String(p['name'])}@${String(p['version'])}`;
      const declaring = packs.filter((p) => isObject(p['interfaces']) && isObject(p['interfaces'][PROCESS]));
      expect(declaring.map(named), `one first-party pack declares ${PROCESS} (the build's first-party packs: ${packs.map(named).join(', ')})`).toHaveLength(1);
      const libs = Object.entries(isObject(declaring[0]!['libs']) ? declaring[0]!['libs'] : {})
        .filter(([, e]) => isObject(e) && Array.isArray(e['implements']) && e['implements'].includes(PROCESS));
      expect(libs.map(([name]) => name), `${named(declaring[0]!)} carries one reference library that implements ${PROCESS}`).toHaveLength(1);
      const ref: Link = { name: libs[0]![0], asset: str((libs[0]![1] as JsonObject)['asset'], `${libs[0]![0]}.asset`) };
      const assets = Object.fromEntries(Object.entries(obj(listed!['assets'], 'first_party.assets')).filter((e): e is [string, string] => typeof e[1] === 'string')) as Assets;

      // The model, linking the reference library through the interface, warmed to the first timed step.
      model = live(logicBin());
      const viewed = await model.call(viewCall(piece({ [ITEM]: { program, scene: MODEL, writes, links: [ref] } }, [], assets), STEPS / MODEL.rate));
      expect(viewed['ok'], `view opened the model, linking ${ref.name} through ${INTERFACE}: ${show(viewed)}`).toBe(true);
      const session = str(viewed['session'], 'the model view\'s session');
      for (let k = 0; k < WARM; k++) await frame(model, session, k, 'the model');

      // Five runs of 60 steps, the two items a step each in turn. Every timed step of the model is the criterion's
      // model: 2,000 live, and each of its 40 queues, 30 resources and 10 conveyors holding work.
      const runs: number[] = [], loads: Load[] = [], medians: string[] = [];
      let first: Step | undefined, last: Step | undefined;
      for (let run = 0; run < RUNS; run++) {
        const start = loadavg()[0]!;
        const busyUs: number[] = [], idleUs: number[] = [];
        for (let i = 0; i < EACH_RUN; i++) {
          const k = WARM + run * EACH_RUN + i;
          const f = await frame(model, session, k, 'the model');
          const a = stepOf(f.draws, writes, `the model's frame of step ${k}`);
          const wrong = stateProblems(a, k);
          expect(wrong, `step ${k}, a timed step, isn't a step of a model of 2,000 live entities, 40 queues, 30 resources and 10 conveyors, all holding work:\n  ${wrong.join('\n  ')}`).toEqual([]);
          first ??= a;
          last = a;
          busyUs.push(f.us);
          idleUs.push((await frame(idle, idleSession, k, 'the idle item')).us);
        }
        loads.push({ start, end: loadavg()[0]! });
        runs.push(median(busyUs) - median(idleUs));
        medians.push(`${median(busyUs).toFixed(1)} − ${median(idleUs).toFixed(1)}`);
      }
      const stalled = progressProblems(first!, last!);
      expect(stalled, `the model ran on between the first and the last timed step:\n  ${stalled.join('\n  ')}`).toEqual([]);

      // The budget, on the reference Mac alone.
      const machine = fingerprint();
      const result = judgeLimit({ limit: LIMIT_US, runs, fingerprint: machine, loads });
      const shown = `a step of the model, its frame's median less the idle item's over each run of ${EACH_RUN} steps: ${runs.map((r) => r.toFixed(1)).join(', ')} µs (${medians.join('; ')}) against ${LIMIT_US} µs, one-minute load at each run's start and end ${loads.map((l) => `${l.start.toFixed(1)}/${l.end.toFixed(1)}`).join(', ')}, on ${String(machine['model'])}: ${result.status}${result.reason ? ` (${result.reason})` : ''}`;
      console.log(`${AC[9]} ${shown}`);
      expect(result.status, `FAIL ${shown}`).not.toBe('FAIL');
      if (result.status === 'BLOCKED') throw Error(`BLOCKED: ${shown}`);
      if (result.status !== 'PASS') throw Error(`INCONCLUSIVE: ${shown}`);
    } finally {
      model?.stop();
      idle.stop();
    }
  }, TIMEOUT);
});
