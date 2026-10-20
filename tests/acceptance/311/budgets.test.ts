// #311 AC12, timing half: validating an event against its schema takes under 20 µs at p95.
// Judged by the design's budget rule: five runs after a warm-up; PASS when all five are within the limit,
// FAIL when all five are over it by more than the margin (the larger of 5% and the five runs' spread),
// otherwise INCONCLUSIVE. Off a reference Mac, on battery, with Low Power Mode on or unknown, or with a
// thermal warning, the result is a reading only and the test skips. It never passes by skipping.
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { validate } from '../../../packages/contracts/src/index.ts';
import { eventFixture, kindSchema } from './helpers.ts';

const LIMIT_US = 20;
const KINDS = ['user.ask', 'verdict.made', 'session.child_started'];
const CALLS_PER_KIND = 2000;
const RUNS = 5;
const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
];

const read = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8' }).trim();

function environmentProblem(): string | null {
  let model: string, chip: string, gib: number, batt: string, power: string, therm: string;
  try {
    model = read('sysctl', '-n', 'hw.model');
    chip = read('sysctl', '-n', 'machdep.cpu.brand_string');
    gib = Math.round(Number(read('sysctl', '-n', 'hw.memsize')) / 2 ** 30);
    batt = read('pmset', '-g', 'batt');
    power = read('pmset', '-g');
    therm = read('pmset', '-g', 'therm');
  } catch (e) {
    return `cannot read the machine: ${(e as Error).message}`;
  }
  const fingerprint = `${model} / ${chip} / ${gib} GiB`;
  if (!REFERENCE_MACS.some((m) => m.model === model && m.chip === chip && m.gib === gib)) return `not a reference Mac: ${fingerprint}`;
  if (!/'AC Power'/.test(batt)) return `not on mains power: ${batt.split('\n')[0]}`;
  const lpm = /^\s*lowpowermode\s+(\d)/m.exec(power);
  if (!lpm) return 'Low Power Mode state unknown (no lowpowermode line in pmset -g)';
  if (lpm[1] !== '0') return 'Low Power Mode is on';
  const limited = [...therm.matchAll(/_Limit\s*=\s*(\d+)/g)].some((m) => Number(m[1]) < 100);
  if (limited || !/No thermal warning level/.test(therm)) return `thermal state not nominal: ${therm.replace(/\s+/g, ' ')}`;
  return null;
}

function p95Microseconds(): number {
  const samples: number[] = [];
  for (const kind of KINDS) {
    const name = kindSchema(kind);
    const event = eventFixture(kind);
    for (let i = 0; i < CALLS_PER_KIND; i++) {
      const t0 = process.hrtime.bigint();
      const r = validate(name, event);
      samples.push(Number(process.hrtime.bigint() - t0) / 1000);
      if (!r.ok) throw new Error(`fixture for ${kind} does not validate against ${name}; nothing to time`);
    }
  }
  samples.sort((a, b) => a - b);
  return samples[Math.min(samples.length - 1, Math.ceil(samples.length * 0.95) - 1)];
}

describe('#311 AC12: schema validation budget', () => {
  it(`validate(event) p95 is under ${LIMIT_US} µs on a reference Mac`, (ctx) => {
    const problem = environmentProblem();
    if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);
    console.log(`warm-up p95 ${p95Microseconds().toFixed(2)} µs (discarded)`);
    const runs = Array.from({ length: RUNS }, () => p95Microseconds());
    runs.forEach((p95, i) => console.log(`run ${i + 1}: p95 ${p95.toFixed(2)} µs over ${KINDS.length * CALLS_PER_KIND} calls`));
    const margin = Math.max(0.05, (Math.max(...runs) - Math.min(...runs)) / LIMIT_US);
    const allWithin = runs.every((p95) => p95 <= LIMIT_US);
    const allOver = runs.every((p95) => p95 > LIMIT_US * (1 + margin));
    const summary = `runs ${runs.map((r) => r.toFixed(2)).join(', ')} µs; limit ${LIMIT_US} µs; margin ${(margin * 100).toFixed(1)}%`;
    if (allOver) expect.fail(`FAIL: all five runs over the limit by more than the margin (${summary})`);
    if (!allWithin) ctx.skip(`INCONCLUSIVE: runs straddle the limit (${summary})`);
    expect(allWithin, `PASS: ${summary}`).toBe(true);
  });
});
