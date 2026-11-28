import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { availableParallelism, loadavg } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { titlePrefix, CHROME, CRITERIA, REPO, fingerprintAtRest, benchmark, blocked, cargoEnv, benchmarkTaskHolders, inconclusive, logicRelease, expectNoProblems, prebuild } from './helpers.ts';
import { brief, isObject, judgeMetering, judgedReadingInALine, benchmarkTaskProblems, type Load, type MeteringRecord, type BenchmarkTask, type Verdict } from './judges.ts';

const ID = titlePrefix(4);
prebuild(logicRelease);
const FILE = 'tests/acceptance/3530/ac4-metering.test.ts';
const MERGE_BASE_MARGIN = 0.5;
const TASK: BenchmarkTask = {
  id: 'logic-metering', command: ['node', 'benchmarks/canvas-world.mjs', FILE], margin: MERGE_BASE_MARGIN,
  targets: { app_times_record: 1 + MERGE_BASE_MARGIN, web_times_record: 1 + MERGE_BASE_MARGIN }, criterion: CRITERIA[4], file: FILE,
};
const HOSTS = ['app', 'web'] as const;
const load = (): number => loadavg()[0] ?? Number.NaN;
const fiveRuns = (v: unknown): v is number[] => Array.isArray(v) && v.length === 5 && v.every((x) => typeof x === 'number' && Number.isFinite(x) && x > 0);

function meteringRecord(): MeteringRecord {
  const text: unknown = JSON.parse(readFileSync(join(REPO, 'crates', 'deep-logic', 'metering.json'), 'utf8'));
  const per = isObject(text) && isObject(text['ns_per_fuel']) ? text['ns_per_fuel'] : {};
  const machine = isObject(text) && isObject(text['fingerprint']) ? text['fingerprint'] : {};
  return { model: typeof machine['model'] === 'string' ? machine['model'] : null, app: Number(per['app']), web: Number(per['web']) };
}

it(`${ID} the metering benchmark's ns per fuel unit reads within its margin of the merge base's record, in the app and in headless Chrome`, async () => {
  const bn = await benchmark();
  const base = meteringRecord();
  expect([base.app > 0, base.web > 0, typeof base.model], `the record holds the merge base's ns per fuel unit in the app and in headless Chrome, and the Mac it was read on: ${brief(base)}`).toEqual([true, true, 'string']);

  const mac = bn.references.find((r) => r.model === base.model);
  const other = bn.references.find((r) => r.model !== base.model);
  expect(mac !== undefined && other !== undefined, `the record was read on a reference Mac (${base.model}), and the repo names another`).toBe(true);
  const five = (x: number): number[] => [x, x, x, x, x];
  const calm: Load[] = Array.from({ length: 5 }, () => ({ start: 1, end: 1 }));
  const busy: Load[] = Array.from({ length: 5 }, () => ({ start: availableParallelism() + 5, end: availableParallelism() + 5 }));
  for (const host of HOSTS) {
    const judge = (times: number, machine = fingerprintAtRest(mac!), loads = calm): Verdict['status'] => judgeMetering(bn.judgeLimit, host, five(times * base[host]), base, MERGE_BASE_MARGIN, machine, loads).status;
    const planted = {
      "the record's own value": judge(1),
      'half again, the bound itself': judge(1 + MERGE_BASE_MARGIN),
      'twice the record': judge(2),
      'off the reference Macs': judge(1, { ...fingerprintAtRest(mac!), model: 'Mac14,2' }),
      'at a load above the cores': judge(2, fingerprintAtRest(mac!), busy),
      "on another reference Mac than the record's": judge(2, fingerprintAtRest(other!)),
    };
    expect(planted, `${ID}: the judge passes ${host} readings within half again of the record's ${base[host]} ns per fuel unit, fails twice it, and reads anything that doesn't compare as INCONCLUSIVE`).toEqual({
      "the record's own value": 'PASS',
      'half again, the bound itself': 'PASS',
      'twice the record': 'FAIL',
      'off the reference Macs': 'INCONCLUSIVE',
      'at a load above the cores': 'INCONCLUSIVE',
      "on another reference Mac than the record's": 'INCONCLUSIVE',
    });
  }

  const h = await benchmarkTaskHolders();
  const problems = benchmarkTaskProblems(h.budgets, TASK, h.refusal, h.timed, h.runs);

  const lines: string[] = [];
  let unread: Error | undefined;
  try {
    if (!existsSync(CHROME)) blocked(`no headless Chrome at ${CHROME} (set CHROME_BIN); the metering benchmark reads the web player's engine there`);
    const start = load();
    const ran = spawnSync(process.execPath, ['benchmarks/logic.mjs'], { cwd: REPO, env: cargoEnv(), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 20 * 60_000, killSignal: 'SIGKILL', stdio: ['ignore', 'pipe', 'pipe'] });
    const loads: Load[] = Array.from({ length: 5 }, () => ({ start, end: load() }));
    if ((ran.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT') inconclusive('node benchmarks/logic.mjs didn\'t end within 20 minutes and was stopped');
    if (ran.status !== 0) blocked(`node benchmarks/logic.mjs exited ${ran.status ?? ran.signal}: ${(ran.stderr ?? '').slice(-1500)}`);
    const out = ran.stdout ?? '';
    let read: unknown = null;
    try { read = JSON.parse(out.slice(out.indexOf('{'))); } catch {}
    const runs = isObject(read) && isObject(read['runs']) ? read['runs'] : {};
    expect(HOSTS.map((host) => fiveRuns(runs[host])), `${ID}: the metering benchmark prints five readings of ns per fuel unit in the app and five in headless Chrome: ${brief(isObject(read) ? read['runs'] : out.slice(-600))}`).toEqual([true, true]);
    const machine = bn.fingerprint();
    for (const host of HOSTS) {
      const got = runs[host] as number[];
      const verdict = judgeMetering(bn.judgeLimit, host, got, base, MERGE_BASE_MARGIN, machine, loads);
      const said = judgedReadingInALine(`the metering benchmark in ${host === 'app' ? 'the app' : 'headless Chrome'}`, got, 'ns per fuel unit', `${1 + MERGE_BASE_MARGIN} times the record's ${base[host]}`, loads, machine, verdict);
      console.log(`${ID} ${said}`);
      lines.push(said);
      if (verdict.status === 'FAIL') problems.unshift(`FAIL ${said}`);
      else if (verdict.status !== 'PASS') unread ??= Error(`INCONCLUSIVE: ${said}; this is not a pass`);
    }
  } catch (error) {
    if (!(error instanceof Error) || !/^(BLOCKED|INCONCLUSIVE):/.test(error.message)) throw error;
    unread = error;
  }
  expectNoProblems(problems, `${ID}: the metering benchmark's reading and its budget${lines.length && !problems[0]?.startsWith('FAIL') ? ` (its readings here: ${lines.join(' | ')})` : ''}`);
  if (unread) throw unread;
  if (lines.length !== HOSTS.length) inconclusive('the metering benchmark wasn\'t read on both hosts');
}, 40 * 60_000);
