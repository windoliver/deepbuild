import { execFileSync } from 'node:child_process';
import { expect, type TestContext } from 'vitest';

// ---- The reference Macs (design: The reference Macs), as #20's budgets read them.
const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
];
const sh = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8', env: { ...process.env, PATH: '/usr/bin:/bin:/usr/sbin:/sbin' } }).trim();
/** Why this machine's timings are a reading only, or null on a reference Mac in a fit state. */
export function environmentProblem(): string | null {
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  let model: string, chip: string, gib: number, batt: string, power: string, therm: string;
  try {
    model = sh('/usr/sbin/sysctl', '-n', 'hw.model');
    chip = sh('/usr/sbin/sysctl', '-n', 'machdep.cpu.brand_string');
    gib = Math.round(Number(sh('/usr/sbin/sysctl', '-n', 'hw.memsize')) / 2 ** 30);
    batt = sh('/usr/bin/pmset', '-g', 'batt');
    power = sh('/usr/bin/pmset', '-g');
    therm = sh('/usr/bin/pmset', '-g', 'therm');
  } catch (e) {
    return `cannot read the machine: ${(e as Error).message}`;
  }
  if (!REFERENCE_MACS.some((m) => m.model === model && m.chip === chip && m.gib === gib)) return `not a reference Mac: ${model} / ${chip} / ${gib} GiB`;
  if (!/'AC Power'/.test(batt)) return `not on mains power: ${batt.split('\n')[0]}`;
  const lpm = /^\s*lowpowermode\s+(\d)/m.exec(power);
  if (!lpm || lpm[1] !== '0') return 'Low Power Mode on or unknown';
  if ([...therm.matchAll(/_Limit\s*=\s*(\d+)/g)].some((m) => Number(m[1]) < 100) || !/No thermal warning level/.test(therm)) return 'thermal state not nominal';
  const one = Number(sh('/usr/sbin/sysctl', '-n', 'vm.loadavg').replace(/[{}]/g, '').trim().split(/\s+/)[0]);
  const cores = Number(sh('/usr/sbin/sysctl', '-n', 'hw.ncpu'));
  return one > cores ? `loaded past its core count: 1-minute load ${one.toFixed(1)} on ${cores} cores` : null;
}
/** PASS when every run is within the limit; FAIL when every run is over it by more than the margin; else INCONCLUSIVE. */
export function judge(ctx: TestContext, name: string, runs: number[], limit: number): void {
  const spread = (Math.max(...runs) - Math.min(...runs)) / Math.max(Math.min(...runs), 1e-9);
  const margin = Math.max(0.05, spread);
  const shown = `${name}: ${runs.map((r) => r.toFixed(1)).join(', ')} against ${limit} (margin ${(margin * 100).toFixed(0)}%)`;
  console.log(shown);
  if (runs.every((r) => r < limit)) return;
  expect(runs.every((r) => r > limit * (1 + margin)), `FAIL ${shown}`).toBe(false);
  ctx.skip(`INCONCLUSIVE ${shown}`);
}
