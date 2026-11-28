import { availableParallelism, loadavg } from 'node:os';
import { expect, it } from 'vitest';
import { titlePrefix, CRITERIA, answerForEachCall, fingerprintAtRest, bakeCall, benchmark, benchmarkTaskHolders, inconclusive, longLivedLogic, logicRelease, expectNoProblems, oneItemPiece, prebuild, run } from './helpers.ts';
import { PIECE_ITEM, WRITES_LIMIT, brief, isObject, judgeWrites, nsPerFuel, rowsByStep, judgedReadingInALine, benchmarkTaskProblems, type JsonObject, type Load, type BenchmarkTask } from './judges.ts';
import { TWIN, TWIN_SHA, twinFuel, writer } from './programs.ts';

const ID = titlePrefix(3);
prebuild(logicRelease);
const FILE = 'tests/acceptance/3530/ac3-writes.test.ts';
const TASK: BenchmarkTask = {
  id: 'logic-writes', command: ['node', 'benchmarks/canvas-world.mjs', FILE], margin: 0.5,
  targets: { writes_ns_per_fuel: WRITES_LIMIT }, criterion: CRITERIA[3], file: FILE,
};
const MERGE_BASE_REWRITTEN_TWIN_SHA256 = 'fb03507b351f1177983117aee2676f4ad210bb89b5361bbdeaab84bd2a257557';
const STEPS_A_READING = 10;
const READINGS_TAKEN = 6;

const bench = writer(TWIN.iterations);
const twin = writer(1);
const pieces: [JsonObject, JsonObject] = [oneItemPiece(bench, 0, { fuel: 10_000_000 }), oneItemPiece(twin, 0, { fuel: 10_000_000 })];
const load = (): number => loadavg()[0] ?? Number.NaN;

async function readTwinThroughLiveViews(bin: string, fuel: [number, number]): Promise<{ runs: number[]; loads: Load[] }> {
  const logic = longLivedLogic(bin, 5 * 60_000);
  try {
    const sessions: string[] = [];
    for (const [i, piece] of pieces.entries()) {
      const opened = await logic.call({ call: 'view', piece, track: [], span: 2 }, `view of ${i ? 'the one-iteration twin' : 'the twin'}`);
      expect(opened['ok'] === true && typeof opened['session'] === 'string', `view opens ${i ? 'the one-iteration twin' : 'the twin'}: ${brief(opened)}`).toBe(true);
      sessions.push(opened['session'] as string);
    }
    let frames = 0;
    const oneFrameOfEachView = async (): Promise<[number, number]> => {
      const out: number[] = [];
      for (const [i, session] of sessions.entries()) {
        const frame = await logic.call({ call: 'frame', session, ...(frames > 0 ? { play: true } : {}) }, `frame ${frames} of ${i ? 'the one-iteration twin' : 'the twin'}`);
        expect([frame['ok'], frame['steps'], Array.isArray(frame['traps']) ? frame['traps'].length : null, Number.isFinite(frame['eval_ns'])],
          `frame ${frames} of ${i ? 'the one-iteration twin' : 'the twin'} runs one step, traps nothing and reports its eval_ns: ${brief(frame, 400)}`).toEqual([true, 1, 0, true]);
        out.push(frame['eval_ns'] as number);
      }
      frames += 1;
      return [out[0]!, out[1]!];
    };
    const runs: number[] = [];
    const loads: Load[] = [];
    for (let r = 0; r < READINGS_TAKEN; r++) {
      const start = load();
      const ns: [number[], number[]] = [[], []];
      for (let s = 0; s < STEPS_A_READING; s++) { const [b, t] = await oneFrameOfEachView(); ns[0].push(b); ns[1].push(t); }
      runs.push(nsPerFuel(ns[0], ns[1], fuel));
      loads.push({ start, end: load() });
    }
    return { runs: runs.slice(1), loads: loads.slice(1) };
  } finally {
    await logic.stop();
  }
}

it(`${ID} #3445's twin that mostly writes, as a logic item's program, costs at most twice the record's ns per fuel unit in the app; the merge base's 2.5 times fails`, async () => {
  const bn = await benchmark();

  const mac = bn.references.find((r) => r.model === 'Mac17,10') ?? bn.references[0]!;
  const five = (x: number): number[] => [x, x, x, x, x];
  const calm: Load[] = Array.from({ length: 5 }, () => ({ start: 1, end: 1 }));
  const busy: Load[] = Array.from({ length: 5 }, () => ({ start: availableParallelism() + 5, end: availableParallelism() + 5 }));
  const planted = {
    'twice the record, the bound itself': judgeWrites(bn.judgeLimit, five(0.5), fingerprintAtRest(mac), calm).status,
    'the store marked inline, as #3445 read it (0.087)': judgeWrites(bn.judgeLimit, five(0.087), fingerprintAtRest(mac), calm).status,
    'the merge base, 0.622: 2.5 times': judgeWrites(bn.judgeLimit, five(0.622), fingerprintAtRest(mac), calm).status,
    "#3445's first set, 0.887 with Low Power Mode on": judgeWrites(bn.judgeLimit, five(0.887), { ...fingerprintAtRest(mac), lowPowerMode: true }, calm).status,
    "#3445's second set, 0.622 at a load above the cores": judgeWrites(bn.judgeLimit, five(0.622), fingerprintAtRest(mac), busy).status,
    'off the reference Macs': judgeWrites(bn.judgeLimit, five(0.087), { ...fingerprintAtRest(mac), model: 'Mac14,2' }, calm).status,
  };
  expect(planted, `${ID}: the judge passes a reading within twice the record's 0.25 ns per fuel unit, fails the merge base's 2.5 times, and reads anything off a reference Mac at rest as INCONCLUSIVE`).toEqual({
    'twice the record, the bound itself': 'PASS',
    'the store marked inline, as #3445 read it (0.087)': 'PASS',
    'the merge base, 0.622: 2.5 times': 'FAIL',
    "#3445's first set, 0.887 with Low Power Mode on": 'INCONCLUSIVE',
    "#3445's second set, 0.622 at a load above the cores": 'INCONCLUSIVE',
    'off the reference Macs': 'INCONCLUSIVE',
  });
  if (bench.sha !== TWIN_SHA.bench || twin.sha !== TWIN_SHA.twin) throw Error(`INVALID: this suite's twin isn't #3445's: ${bench.sha} and ${twin.sha}`);

  const h = await benchmarkTaskHolders();
  const problems = benchmarkTaskProblems(h.budgets, TASK, h.refusal, h.timed, h.runs);

  let said = '';
  let unread: Error | undefined;
  try {
    const bin = logicRelease();
    const calls = pieces.map((piece) => bakeCall(piece, 1));
    const bakes = answerForEachCall(run(bin, [], calls, 5 * 60_000), calls, 'the release deep-logic');
    expect(bakes.map((b) => b['ok']), `the twin and its one-iteration twin bake as logic items' programs: ${brief(bakes.find((b) => b['ok'] !== true) ?? null)}`).toEqual([true, true]);
    const fuel: [number, number] = [rowsByStep(bakes[0]!, PIECE_ITEM).get(0)?.fuel ?? Number.NaN, rowsByStep(bakes[1]!, PIECE_ITEM).get(0)?.fuel ?? Number.NaN];
    expect(fuel, `${ID}: a step of the twin is charged ${TWIN.instructions} fuel an iteration and 7 around them, and its one-iteration twin 210, as on the merge base: the rewrite's own code is charged none`).toEqual([twinFuel(TWIN.iterations), twinFuel(1)]);
    const item = isObject(bakes[0]!['items']) ? bakes[0]!['items'][PIECE_ITEM] : null;
    const rewritten = isObject(item) ? item['hash'] : null;
    expect(typeof rewritten === 'string' && /^[0-9a-f]{64}$/.test(rewritten), `bake names the twin's rewritten program by its SHA-256: ${brief(item)}`).toBe(true);
    if (rewritten === MERGE_BASE_REWRITTEN_TWIN_SHA256) problems.push(`the twin is still rewritten to the merge base's bytes (SHA-256 ${MERGE_BASE_REWRITTEN_TWIN_SHA256}): the program #3445 read at 2.49 times the record's ns per fuel unit, a call to the tracker after each of its 64 stores`);

    const { runs, loads } = await readTwinThroughLiveViews(bin, fuel);
    const machine = bn.fingerprint();
    const verdict = judgeWrites(bn.judgeLimit, runs, machine, loads);
    said = judgedReadingInALine("the twin that mostly writes, as a logic item's program", runs, 'ns per fuel unit', `${WRITES_LIMIT} (twice the record's 0.25)`, loads, machine, verdict);
    console.log(`${ID} ${said}`);
    if (verdict.status === 'FAIL') problems.unshift(`FAIL ${said}`);
    else if (verdict.status !== 'PASS') unread = Error(`INCONCLUSIVE: ${said}; this is not a pass`);
  } catch (error) {
    if (!(error instanceof Error) || !/^(BLOCKED|INCONCLUSIVE):/.test(error.message)) throw error;
    unread = error;
  }
  expectNoProblems(problems, `${ID}: the twin's cost and its budget${said && !problems[0]?.startsWith('FAIL') ? ` (its reading here: ${said})` : ''}`);
  if (unread) throw unread;
  if (!said) inconclusive('no reading of the twin was taken');
}, 30 * 60_000);
